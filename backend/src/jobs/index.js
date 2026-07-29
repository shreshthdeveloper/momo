import { Topic, Match, User, Replay, Question, Space, Challenge } from '../models/index.js';
import { rebuildPeriodSnapshot } from '../services/leaderboardService.js';
import { runMonthlyCycleIfDue } from '../services/seasonService.js';
import { notify } from '../services/notificationService.js';
import { runContestLifecycle } from '../services/contestService.js';
import { remindDueAssignments } from '../services/assignmentService.js';
import { istYesterdayKey } from '../lib/dates.js';
import { logger } from '../lib/logger.js';
import { QUESTION_STATUS } from '../shared/constants.js';

/**
 * Background jobs (tech.md §10).
 *
 * A minimal in-process scheduler rather than a queue: v1 is a single Node
 * process (tech.md §12) and adding a broker for eleven periodic tasks would be
 * infrastructure without a payer. Each job is idempotent, so a restart mid-run
 * costs nothing, and when the game module is split out these move with it
 * unchanged.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const timers = [];

function every(intervalMs, name, fn, { runAtStart = false } = {}) {
  const run = async () => {
    const started = Date.now();
    try {
      const result = await fn();
      logger.debug({ job: name, ms: Date.now() - started, result }, 'job complete');
    } catch (err) {
      logger.error({ err, job: name }, 'job failed');
    }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  timers.push(timer);
  if (runAtStart) setTimeout(run, 5_000).unref?.();
}

/** Runs `fn` once a day at the given IST hour. */
function dailyAt(istHour, istMinute, name, fn) {
  every(MINUTE, `${name}:tick`, async () => {
    const now = new Date(Date.now() + 330 * MINUTE);
    if (now.getUTCHours() !== istHour || now.getUTCMinutes() !== istMinute) return;
    const started = Date.now();
    try {
      await fn();
      logger.info({ job: name, ms: Date.now() - started }, 'daily job complete');
    } catch (err) {
      logger.error({ err, job: name }, 'daily job failed');
    }
  });
}

export function startJobs() {
  // Topic stats rollup — hourly.
  every(HOUR, 'topic-stats', rollUpTopicStats, { runAtStart: true });

  // Leaderboard snapshots — hourly.
  every(HOUR, 'leaderboard-snapshots', rebuildLeaderboards, { runAtStart: true });

  // Question stats reconciliation — reconciles the inline counters written on
  // match completion, catching anything a crashed finalize missed.
  every(6 * HOUR, 'question-reconcile', reconcileQuestionStats);

  // Stale live matches — a deploy kills matches in flight (tech.md §12, an
  // accepted limitation at launch). This stops those rows sitting as "live"
  // for ever.
  every(5 * MINUTE, 'stale-matches', closeStaleMatches, { runAtStart: true });

  // Expired challenges.
  /**
   * Every minute, not every fifteen.
   *
   * The window is two minutes now (constants.js), so a quarter-hour sweep left
   * a dead challenge looking alive for up to seven times its own lifetime.
   * Reads re-check the date and are always correct; this is what stops the
   * stored status from lying in between.
   */
  every(MINUTE, 'expire-challenges', expireChallenges);

  /**
   * Contest lifecycle — every minute (tech.md §10).
   *
   * This is the only job whose lateness a user would notice: a contest that
   * opens a minute late is a contest a class is sitting in front of, waiting.
   * It runs at start-up too, so a restart during a contest window reopens it
   * immediately rather than at the next tick.
   */
  every(MINUTE, 'contest-lifecycle', () => runContestLifecycle(), { runAtStart: true });

  // Daily 09:00 IST — "assignment due tomorrow" (prd.md §6.9).
  dailyAt(9, 0, 'assignment-reminders', () => remindDueAssignments());

  // Daily 00:05 IST — break streaks with no match yesterday.
  dailyAt(0, 5, 'streak-evaluation', evaluateStreaks);

  // Daily 20:00 IST — notify players whose streak is about to break.
  dailyAt(20, 0, 'streak-reminder', remindStreaks);

  // Daily 03:00 IST — purge accounts past the 30-day grace period.
  dailyAt(3, 0, 'account-deletion', purgeDeletedAccounts);

  /**
   * The monthly turnover (coins-and-cosmetics.md §5) — checked hourly rather
   * than fired at a precise minute on the 1st. It is the biggest thing the
   * product does to itself and it must not be skippable by a deploy window, so
   * the trigger is "the month is not the one the chests were rolled for",
   * which stays true until the work is actually done.
   */
  every(HOUR, 'monthly-cycle', runMonthlyCycleIfDue, { runAtStart: true });

  // Weekly-ish — prune replays older than 90 days where newer ones exist.
  every(24 * HOUR, 'replay-pruning', pruneReplays);

  logger.info({ jobs: timers.length }, 'background jobs started');
}

export function stopJobs() {
  for (const timer of timers) clearInterval(timer);
  timers.length = 0;
}

// ── Job implementations ────────────────────────────────────────────────────

export async function rollUpTopicStats() {
  const rows = await Match.aggregate([
    { $match: { status: 'complete', completedAt: { $gte: new Date(Date.now() - 30 * 24 * HOUR) } } },
    { $unwind: '$rounds' },
    { $unwind: '$rounds.answers' },
    {
      $group: {
        _id: '$topicId',
        answered: { $sum: { $cond: [{ $ne: ['$rounds.answers.optionIndex', null] }, 1, 0] } },
        correct: { $sum: { $cond: ['$rounds.answers.isCorrect', 1, 0] } },
        avgResponseMs: { $avg: '$rounds.answers.elapsedMs' },
        players: { $addToSet: '$rounds.answers.userId' },
      },
    },
  ]);

  const ghostRows = await Match.aggregate([
    { $match: { createdAt: { $gte: new Date(Date.now() - 7 * 24 * HOUR) } } },
    {
      $group: {
        _id: '$topicId',
        total: { $sum: 1 },
        ghosted: { $sum: { $cond: [{ $anyElementTrue: '$players.isGhost' }, 1, 0] } },
      },
    },
  ]);
  const ghostById = new Map(ghostRows.map((r) => [String(r._id), r]));

  // "Active players" is a 7-day figure — design.md §6.4 shows it on the topic
  // card, where a lifetime number would be meaningless.
  const activeRows = await Match.aggregate([
    { $match: { createdAt: { $gte: new Date(Date.now() - 7 * 24 * HOUR) } } },
    { $unwind: '$players' },
    { $match: { 'players.isGhost': { $ne: true } } },
    { $group: { _id: { topicId: '$topicId', userId: '$players.userId' } } },
    { $group: { _id: '$_id.topicId', n: { $sum: 1 } } },
  ]);
  const activeById = new Map(activeRows.map((r) => [String(r._id), r.n]));

  const ops = rows.map((r) => {
    const ghost = ghostById.get(String(r._id));
    return {
      updateOne: {
        filter: { _id: r._id },
        update: {
          $set: {
            'stats.avgAccuracy': r.answered ? r.correct / r.answered : 0,
            'stats.avgResponseMs': Math.round(r.avgResponseMs ?? 0),
            'stats.uniquePlayers': new Set(r.players.map(String)).size,
            'stats.activePlayers': activeById.get(String(r._id)) ?? 0,
            'stats.ghostRatio': ghost?.total ? ghost.ghosted / ghost.total : 0,
          },
        },
      },
    };
  });

  if (ops.length) await Topic.bulkWrite(ops, { ordered: false });

  // tech.md §14 — alert when a topic with real traffic is mostly ghosts.
  for (const [topicId, row] of ghostById) {
    if (row.total >= 10 && row.ghosted / row.total > 0.8) {
      logger.warn(
        { evt: 'alert.liquidity', topicId, matches: row.total, ratio: row.ghosted / row.total },
        'ghost ratio above 80% — topic lacks real liquidity',
      );
    }
  }

  return { topics: ops.length };
}

export async function rebuildLeaderboards() {
  const spaces = await Space.find({ status: 'active' }, { _id: 1 }).lean();
  let built = 0;

  for (const space of spaces) {
    const scope = { spaceId: space._id, isPublic: false };
    for (const period of ['week', 'month']) {
      await rebuildPeriodSnapshot({ scope, topicId: null, scopeType: 'global', period }).catch(() => {});
      built += 1;
    }

    // Only the topics people actually played this week are worth materialising.
    const activeTopics = await Match.distinct('topicId', {
      spaceId: space._id,
      completedAt: { $gte: new Date(Date.now() - 7 * 24 * HOUR) },
    });
    for (const topicId of activeTopics.slice(0, 100)) {
      for (const period of ['week', 'month']) {
        await rebuildPeriodSnapshot({ scope, topicId, scopeType: 'global', period }).catch(() => {});
        built += 1;
      }
    }
  }
  return { snapshots: built };
}

export async function reconcileQuestionStats() {
  const stale = await Question.find(
    { status: QUESTION_STATUS.PUBLISHED, servedEver: true },
    { _id: 1 },
  )
    .limit(500)
    .lean();
  if (!stale.length) return { reconciled: 0 };

  const ids = stale.map((q) => q._id);
  const rows = await Match.aggregate([
    { $match: { status: 'complete', questionIds: { $in: ids } } },
    { $unwind: '$rounds' },
    { $match: { 'rounds.questionId': { $in: ids } } },
    {
      $group: {
        _id: '$rounds.questionId',
        served: { $sum: 1 },
        correct: {
          $sum: {
            $size: { $filter: { input: '$rounds.answers', cond: '$$this.isCorrect' } },
          },
        },
      },
    },
  ]);

  const ops = rows.map((r) => ({
    updateOne: {
      filter: { _id: r._id },
      update: { $set: { 'stats.served': r.served, 'stats.correctCount': r.correct } },
    },
  }));
  if (ops.length) await Question.bulkWrite(ops, { ordered: false });
  return { reconciled: ops.length };
}

export async function closeStaleMatches() {
  const cutoff = new Date(Date.now() - 15 * MINUTE);
  const result = await Match.updateMany(
    { status: 'live', createdAt: { $lt: cutoff } },
    { $set: { status: 'abandoned', isVoid: true, completedAt: new Date() } },
  );
  if (result.modifiedCount) {
    logger.warn({ count: result.modifiedCount }, 'closed stale live match records');
  }
  return { closed: result.modifiedCount };
}

/**
 * Both open states expire, not just `pending`.
 *
 * An ACCEPTED challenge that never became a match was previously expired by
 * nothing at all: this only ever matched `pending`, so those rows stayed
 * `accepted` for ever. `playableChallenge` refuses them on their deadline, so
 * the match was correctly impossible — but the row still looked live to every
 * query that did not itself re-check the date, which is how the Friends screen
 * ended up listing invitations that could never be played.
 */
export async function expireChallenges() {
  const result = await Challenge.updateMany(
    { status: { $in: ['pending', 'accepted'] }, expiresAt: { $lt: new Date() } },
    { $set: { status: 'expired' } },
  );
  return { expired: result.modifiedCount };
}

/** tech.md §10 — daily 00:05 IST. Streaks with no match yesterday break. */
export async function evaluateStreaks() {
  const yesterday = istYesterdayKey();
  const result = await User.updateMany(
    { 'streak.current': { $gt: 0 }, 'streak.lastPlayedOn': { $nin: [yesterday, null] } },
    { $set: { 'streak.current': 0 } },
  );
  return { broken: result.modifiedCount };
}

/** tech.md §10 — daily 20:00 IST. Notify players at risk of losing a streak. */
export async function remindStreaks() {
  const yesterday = istYesterdayKey();
  const atRisk = await User.find(
    {
      'streak.current': { $gte: 2 },
      'streak.lastPlayedOn': yesterday,
      status: 'active',
      'notificationPrefs.streakAtRisk': true,
    },
    { _id: 1, streak: 1 },
  )
    .limit(20_000)
    .lean();

  for (const user of atRisk) {
    await notify(user._id, {
      type: 'streak_at_risk',
      prefKey: 'streakAtRisk',
      title: `${user.streak.current}-day streak`,
      body: 'One match keeps it going.',
    }).catch(() => {});
  }
  return { notified: atRisk.length };
}

/** prd.md F6.1.6 — purge accounts past the 30-day grace period. */
export async function purgeDeletedAccounts() {
  const cutoff = new Date(Date.now() - 30 * 24 * HOUR);
  const due = await User.find(
    { deletionRequestedAt: { $ne: null, $lt: cutoff }, status: { $ne: 'deleted' } },
    { _id: 1 },
  ).lean();

  for (const user of due) {
    // Anonymised rather than removed: matches the person played are part of
    // someone else's history too, and replays keep the game alive. Nothing
    // identifying survives.
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          status: 'deleted',
          deletedAt: new Date(),
          displayName: 'Deleted player',
          displayNameLower: null,
          phone: null,
          email: null,
          avatarUrl: null,
          city: null,
          dateOfBirth: null,
          deviceId: null,
          pushTokens: [],
          googleId: null,
          appleId: null,
        },
      },
    );
    await Replay.updateMany(
      { userId: user._id },
      { $set: { displayName: 'Deleted player', avatarUrl: null } },
    );
  }
  return { purged: due.length };
}

/** tech.md §10 — prune replays older than 90 days where newer ones exist. */
export async function pruneReplays() {
  const cutoff = new Date(Date.now() - 90 * 24 * HOUR);
  const topics = await Replay.distinct('topicId', { createdAt: { $lt: cutoff } });
  let removed = 0;

  for (const topicId of topics) {
    const fresh = await Replay.countDocuments({ topicId, createdAt: { $gte: cutoff } });
    // Never prune a topic down to nothing — an old ghost beats no opponent.
    if (fresh < 20) continue;
    const result = await Replay.deleteMany({ topicId, createdAt: { $lt: cutoff } });
    removed += result.deletedCount;
  }
  return { removed };
}

import mongoose from 'mongoose';
import {
  Contest,
  ContestEntry,
  Topic,
  Question,
  SpaceMember,
  Batch,
  Space,
} from '../models/index.js';
import { notify } from './notificationService.js';
import { assertPermission } from './spaceService.js';
import { NotFoundError, BadRequestError, ConflictError, ForbiddenError } from '../lib/errors.js';
import { shuffle } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import {
  CONTEST_STATUS,
  STANDINGS_VISIBILITY,
  CONTEST_MIN_QUESTIONS,
  CONTEST_MAX_QUESTIONS,
  QUESTION_STATUS,
  SPACE_ROLE,
  MAX_ROUND_SCORE,
} from '../shared/constants.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Contests (prd.md §8.5 for the admin side, F7.5 for the student side).
 *
 * Three rules hold this together, and everything else follows from them:
 *
 * 1. **The question set is frozen, once.** Every entrant sits the same paper in
 *    the same order, because a standings table over different papers ranks luck.
 * 2. **The clock owns the lifecycle.** `scheduled → live → finished` is driven
 *    by `startsAt`/`endsAt` via the lifecycle job, so an admin who schedules a
 *    contest and then goes home still runs a correct contest.
 * 3. **A contest never moves Elo.** prd.md §6.3 gives the contest match its own
 *    standings; a student's public rating must not move because their organization
 *    set a hard paper.
 *
 * Every read here is scoped by `scope.spaceId`, never by an id from the client.
 */

// ── Admin: authoring ───────────────────────────────────────────────────────

function assertWindow(startsAt, endsAt) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new BadRequestError('Give the contest a start and an end time.');
  }
  if (end <= start) {
    throw new BadRequestError('The contest must end after it starts.');
  }
  if (end - start < 5 * 60_000) {
    throw new BadRequestError('A contest window shorter than five minutes is not playable.');
  }
  return { start, end };
}

/** Topics must live in this space — a contest can never reach another bank. */
async function assertTopicsInScope(scope, topicIds) {
  if (!topicIds?.length) throw new BadRequestError('Pick at least one topic.');
  const topics = await Topic.find({
    _id: { $in: topicIds.map(oid) },
    spaceId: scope.spaceId,
  }).lean();
  if (topics.length !== topicIds.length) {
    throw new BadRequestError('One of those topics is not in this space.', 'TOPIC_NOT_IN_SPACE');
  }
  return topics;
}

export async function createContest(scope, user, input) {
  assertPermission(scope, 'manageContests');
  const { start, end } = assertWindow(input.startsAt, input.endsAt);
  const topics = await assertTopicsInScope(scope, input.topicIds);

  const questionCount = Math.min(
    CONTEST_MAX_QUESTIONS,
    Math.max(CONTEST_MIN_QUESTIONS, Number(input.questionCount) || CONTEST_MIN_QUESTIONS),
  );

  const contest = await Contest.create({
    spaceId: scope.spaceId,
    name: input.name,
    description: input.description,
    topicIds: topics.map((t) => t._id),
    questionCount,
    selectionMode: input.selectionMode === 'manual' ? 'manual' : 'auto',
    questionIds: [],
    startsAt: start,
    endsAt: end,
    roundDurationMs: input.roundDurationMs ?? null,
    batchIds: (input.batchIds ?? []).map(oid),
    standingsVisibility: input.standingsVisibility ?? STANDINGS_VISIBILITY.LIVE,
    status: input.publish ? CONTEST_STATUS.SCHEDULED : CONTEST_STATUS.DRAFT,
    createdBy: user._id,
  });

  if (input.selectionMode === 'manual' && input.questionIds?.length) {
    await setContestQuestions(scope, contest._id, input.questionIds);
    return getContest(scope, contest._id);
  }

  return shapeContest(contest);
}

export async function updateContest(scope, contestId, input) {
  assertPermission(scope, 'manageContests');
  const contest = await findInScope(scope, contestId);

  // Once entrants exist the paper is settled. Changing the window or the
  // questions underneath them would invalidate every entry already recorded.
  const entrants = await ContestEntry.countDocuments({
    contestId: contest._id,
    spaceId: scope.spaceId,
  });
  const locked = entrants > 0 || contest.status === CONTEST_STATUS.FINISHED;

  if (locked && (input.topicIds || input.questionCount || input.startsAt || input.questionIds)) {
    throw new ConflictError(
      'Students have already entered. You can still rename it, change its description, or change who sees the standings.',
      'CONTEST_LOCKED',
    );
  }

  if (input.name !== undefined) contest.name = input.name;
  if (input.description !== undefined) contest.description = input.description;
  if (input.standingsVisibility) contest.standingsVisibility = input.standingsVisibility;
  if (input.batchIds) contest.batchIds = input.batchIds.map(oid);
  if (input.roundDurationMs !== undefined) contest.roundDurationMs = input.roundDurationMs;

  if (!locked) {
    if (input.topicIds) {
      const topics = await assertTopicsInScope(scope, input.topicIds);
      contest.topicIds = topics.map((t) => t._id);
      // The paper was drawn from the old topics; it is no longer valid.
      contest.questionIds = [];
      contest.questionsLockedAt = null;
    }
    if (input.questionCount) {
      contest.questionCount = Math.min(
        CONTEST_MAX_QUESTIONS,
        Math.max(CONTEST_MIN_QUESTIONS, Number(input.questionCount)),
      );
    }
    if (input.startsAt || input.endsAt) {
      const { start, end } = assertWindow(
        input.startsAt ?? contest.startsAt,
        input.endsAt ?? contest.endsAt,
      );
      contest.startsAt = start;
      contest.endsAt = end;
    }
  } else if (input.endsAt) {
    // Extending a running contest is the one clock change that is always safe.
    const end = new Date(input.endsAt);
    if (end <= contest.startsAt) throw new BadRequestError('The contest must end after it starts.');
    contest.endsAt = end;
  }

  if (input.status === CONTEST_STATUS.CANCELLED) contest.status = CONTEST_STATUS.CANCELLED;
  else if (input.publish && contest.status === CONTEST_STATUS.DRAFT) {
    contest.status = CONTEST_STATUS.SCHEDULED;
  }

  await contest.save();
  return shapeContest(contest);
}

/** prd.md F8.5.2 — curated manually. Validates every id against this space. */
export async function setContestQuestions(scope, contestId, questionIds) {
  assertPermission(scope, 'manageContests');
  const contest = await findInScope(scope, contestId);

  if (contest.questionsLockedAt) {
    throw new ConflictError('This contest has already started.', 'CONTEST_LOCKED');
  }

  const ids = [...new Set(questionIds.map(String))].map(oid);
  if (ids.length < CONTEST_MIN_QUESTIONS) {
    throw new BadRequestError(`A contest needs at least ${CONTEST_MIN_QUESTIONS} questions.`);
  }
  if (ids.length > CONTEST_MAX_QUESTIONS) {
    throw new BadRequestError(`A contest takes at most ${CONTEST_MAX_QUESTIONS} questions.`);
  }

  // prd.md §5.1 rule 3 — a contest may use central questions and its own
  // space's questions. Never another space's, which is what this proves.
  const allowedOrigins = await allowedOriginsForContest(contest);
  const found = await Question.countDocuments({
    _id: { $in: ids },
    origin: { $in: allowedOrigins },
    status: QUESTION_STATUS.PUBLISHED,
  });
  if (found !== ids.length) {
    throw new BadRequestError(
      'One of those questions is not a published question this space can use.',
      'QUESTION_NOT_USABLE',
    );
  }

  contest.questionIds = ids;
  contest.questionCount = ids.length;
  contest.selectionMode = 'manual';
  await contest.save();
  return shapeContest(contest);
}

async function allowedOriginsForContest(contest) {
  const topics = await Topic.find(
    { _id: { $in: contest.topicIds }, spaceId: contest.spaceId },
    { questionSources: 1, spaceId: 1 },
  ).lean();
  const origins = new Set();
  const { publicSpaceId } = await import('../models/index.js');
  for (const topic of topics) {
    if (topic.questionSources?.central) origins.add(String(publicSpaceId));
    if (topic.questionSources?.own) origins.add(String(topic.spaceId));
  }
  return [...origins].map(oid);
}

/**
 * Freeze the paper. Idempotent — the first caller wins and everyone else reads
 * back the same ids, which matters because both the lifecycle job and a very
 * early entrant can reach this at the same instant.
 */
export async function lockContestQuestions(contest) {
  if (contest.questionsLockedAt && contest.questionIds?.length) return contest.questionIds;

  let ids = contest.questionIds ?? [];

  if (!ids.length) {
    const origins = await allowedOriginsForContest(contest);
    const pool = await Question.aggregate([
      {
        $match: {
          topicIds: { $in: contest.topicIds.map(oid) },
          origin: { $in: origins },
          status: QUESTION_STATUS.PUBLISHED,
        },
      },
      { $sample: { size: contest.questionCount } },
      { $project: { _id: 1 } },
    ]);
    ids = shuffle(pool.map((q) => q._id));
  }

  if (ids.length < CONTEST_MIN_QUESTIONS) {
    throw new BadRequestError(
      'This contest does not have enough published questions to run.',
      'CONTEST_NOT_ENOUGH_QUESTIONS',
    );
  }

  // A conditional update: whoever gets there first sets the paper, and a second
  // caller falls through to reading it rather than overwriting it.
  const result = await Contest.findOneAndUpdate(
    { _id: contest._id, spaceId: contest.spaceId, questionsLockedAt: null },
    { $set: { questionIds: ids, questionCount: ids.length, questionsLockedAt: new Date() } },
    { new: true },
  );

  const settled = result ?? (await Contest.findById(contest._id));
  return settled.questionIds;
}

export async function deleteContest(scope, contestId) {
  assertPermission(scope, 'manageContests');
  const contest = await findInScope(scope, contestId);
  const entrants = await ContestEntry.countDocuments({
    contestId: contest._id,
    spaceId: scope.spaceId,
  });
  if (entrants > 0) {
    // Same rule as questions (prd.md F8.2.4): once it has been played it is
    // someone's record, so it is cancelled rather than erased.
    contest.status = CONTEST_STATUS.CANCELLED;
    await contest.save();
    return { cancelled: true, entrants };
  }
  await Contest.deleteOne({ _id: contest._id, spaceId: scope.spaceId });
  return { deleted: true };
}

// ── Reads ──────────────────────────────────────────────────────────────────

async function findInScope(scope, contestId) {
  if (!mongoose.isValidObjectId(contestId)) throw new NotFoundError('No such contest.');
  const contest = await Contest.findOne({ _id: oid(contestId), spaceId: scope.spaceId });
  if (!contest) throw new NotFoundError('No such contest.');
  return contest;
}

export async function listContests(scope, { status, limit = 50 } = {}) {
  const filter = { spaceId: scope.spaceId };
  if (status) filter.status = status;

  const rows = await Contest.find(filter)
    .sort({ startsAt: -1 })
    .limit(Math.min(limit, 100))
    .populate('topicIds', 'name')
    .lean();

  return { items: rows.map((c) => shapeContest(c)) };
}

export async function getContest(scope, contestId) {
  const contest = await Contest.findOne({ _id: oid(contestId), spaceId: scope.spaceId })
    .populate('topicIds', 'name coverUrl')
    .lean();
  if (!contest) throw new NotFoundError('No such contest.');

  const [entrants, completed, batches] = await Promise.all([
    ContestEntry.countDocuments({ contestId: contest._id, spaceId: scope.spaceId }),
    ContestEntry.countDocuments({
      contestId: contest._id,
      spaceId: scope.spaceId,
      status: 'complete',
    }),
    contest.batchIds?.length
      ? Batch.find({ _id: { $in: contest.batchIds }, spaceId: scope.spaceId }, { name: 1 }).lean()
      : [],
  ]);

  return {
    ...shapeContest(contest),
    batches: batches.map((b) => ({ id: String(b._id), name: b.name })),
    entrants,
    completed,
  };
}

export function shapeContest(contest) {
  const doc = contest.toObject?.() ?? contest;
  const now = Date.now();
  const startsAt = new Date(doc.startsAt);
  const endsAt = new Date(doc.endsAt);

  return {
    id: String(doc._id),
    name: doc.name,
    description: doc.description ?? null,
    topics: (doc.topicIds ?? []).map((t) =>
      t?._id ? { id: String(t._id), name: t.name, coverUrl: t.coverUrl ?? null } : { id: String(t) },
    ),
    questionCount: doc.questionCount,
    selectionMode: doc.selectionMode,
    questionsLocked: Boolean(doc.questionsLockedAt),
    startsAt: doc.startsAt,
    endsAt: doc.endsAt,
    roundDurationMs: doc.roundDurationMs ?? null,
    batchIds: (doc.batchIds ?? []).map(String),
    standingsVisibility: doc.standingsVisibility,
    status: doc.status,
    /** Derived, so a client never has to compare clocks to render a state. */
    phase:
      doc.status === CONTEST_STATUS.CANCELLED
        ? 'cancelled'
        : now < startsAt.getTime()
          ? 'upcoming'
          : now < endsAt.getTime()
            ? 'open'
            : 'closed',
    msUntilStart: Math.max(0, startsAt.getTime() - now),
    msUntilEnd: Math.max(0, endsAt.getTime() - now),
    stats: doc.stats ?? { entrants: 0, completed: 0, avgScore: 0, topScore: 0 },
    finalisedAt: doc.finalisedAt ?? null,
    createdAt: doc.createdAt,
  };
}

// ── Student side (prd.md F7.5) ─────────────────────────────────────────────

/**
 * Contests this student can see: their space, and either space-wide or
 * targeted at their batch. Cancelled and draft contests never appear.
 */
export async function listContestsForStudent(scope, userId, { limit = 20 } = {}) {
  const filter = {
    spaceId: scope.spaceId,
    status: { $in: [CONTEST_STATUS.SCHEDULED, CONTEST_STATUS.LIVE, CONTEST_STATUS.FINISHED] },
    endsAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  };
  if (scope.role === SPACE_ROLE.STUDENT) {
    filter.$or = [{ batchIds: { $size: 0 } }, { batchIds: scope.batchId ?? null }];
  }

  const contests = await Contest.find(filter)
    .sort({ startsAt: 1 })
    .limit(limit)
    .populate('topicIds', 'name coverUrl')
    .lean();

  if (!contests.length) return [];

  const entries = await ContestEntry.find({
    contestId: { $in: contests.map((c) => c._id) },
    spaceId: scope.spaceId,
    userId: oid(userId),
  }).lean();
  const byContest = new Map(entries.map((e) => [String(e.contestId), e]));

  return contests.map((c) => {
    const entry = byContest.get(String(c._id));
    return {
      ...shapeContest(c),
      yourEntry: entry
        ? {
            status: entry.status,
            score: entry.score,
            correctCount: entry.correctCount,
            rank: entry.finalRank,
            matchId: entry.matchId ? String(entry.matchId) : null,
          }
        : null,
    };
  });
}

/**
 * The eligibility check, run before a contest match is created. Everything a
 * student could get wrong is answered here with a sentence they can act on.
 */
export async function assertCanEnter(scope, contest, userId) {
  if (contest.status === CONTEST_STATUS.CANCELLED) {
    throw new ConflictError('This contest was cancelled.', 'CONTEST_CANCELLED');
  }
  const now = Date.now();
  if (now < new Date(contest.startsAt).getTime()) {
    throw new ConflictError('This contest has not started yet.', 'CONTEST_NOT_OPEN');
  }
  if (now >= new Date(contest.endsAt).getTime()) {
    throw new ConflictError('This contest has closed.', 'CONTEST_CLOSED');
  }
  if (contest.batchIds?.length && scope.role === SPACE_ROLE.STUDENT) {
    const eligible = contest.batchIds.some((b) => String(b) === String(scope.batchId));
    if (!eligible) {
      throw new ForbiddenError('This contest is for a different batch.', 'CONTEST_NOT_ELIGIBLE');
    }
  }

  const existing = await ContestEntry.findOne({
    contestId: contest._id,
    spaceId: contest.spaceId,
    userId: oid(userId),
  }).lean();
  if (existing) {
    throw new ConflictError(
      existing.status === 'complete'
        ? 'You have already played this contest.'
        : 'You already have an entry in progress.',
      'CONTEST_ALREADY_ENTERED',
    );
  }
  return true;
}

/**
 * Claim the single entry. `upsert` with a unique index does the locking, so two
 * taps a millisecond apart cannot produce two entries — the second gets a
 * duplicate-key error and is told it already entered.
 */
export async function openEntry({ contest, scope, user, matchId }) {
  try {
    return await ContestEntry.create({
      contestId: contest._id,
      spaceId: contest.spaceId,
      userId: oid(user.id ?? user._id),
      batchId: scope.batchId ?? null,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl ?? null,
      matchId: matchId ? oid(matchId) : null,
      status: 'in_progress',
    });
  } catch (err) {
    if (err.code === 11000) {
      throw new ConflictError('You have already entered this contest.', 'CONTEST_ALREADY_ENTERED');
    }
    throw err;
  }
}

/**
 * Record a finished run. Called from the match finaliser, so a contest entry is
 * written by the same code path that writes the match — there is no separate
 * "submit" the client could skip or replay.
 */
export async function recordEntryResult({ contestId, spaceId, userId, matchId, player, answers }) {
  const totalResponseMs = answers.reduce((sum, a) => sum + (a.elapsedMs ?? 0), 0);
  const answeredCount = answers.filter((a) => a.optionIndex !== null).length;

  await ContestEntry.updateOne(
    { contestId: oid(contestId), spaceId: oid(spaceId), userId: oid(userId) },
    {
      $set: {
        matchId: oid(matchId),
        score: player.score,
        correctCount: player.correctCount,
        answeredCount,
        totalResponseMs,
        status: 'complete',
        completedAt: new Date(),
      },
    },
  );

  const agg = await ContestEntry.aggregate([
    { $match: { contestId: oid(contestId), spaceId: oid(spaceId), status: 'complete' } },
    { $group: { _id: null, n: { $sum: 1 }, avg: { $avg: '$score' }, top: { $max: '$score' } } },
  ]);
  const row = agg[0];

  await Contest.updateOne(
    { _id: oid(contestId), spaceId: oid(spaceId) },
    {
      $set: {
        'stats.completed': row?.n ?? 0,
        'stats.avgScore': Math.round(row?.avg ?? 0),
        'stats.topScore': row?.top ?? 0,
      },
      $inc: { 'stats.entrants': 0 },
    },
  );
}

/**
 * Where one run placed, for the result screen. Computed from the same sort the
 * standings use, so the number a player is shown at the end of their match is
 * the number they will see on the board a second later.
 */
export async function contestPlacementFor(contestId, spaceId, userId) {
  const mine = await ContestEntry.findOne({
    contestId: oid(contestId),
    spaceId: oid(spaceId),
    userId: oid(userId),
  }).lean();
  if (!mine) return null;

  const [ahead, total, contest] = await Promise.all([
    ContestEntry.countDocuments({
      contestId: oid(contestId),
      spaceId: oid(spaceId),
      status: 'complete',
      $or: [
        { score: { $gt: mine.score } },
        { score: mine.score, totalResponseMs: { $lt: mine.totalResponseMs } },
      ],
    }),
    ContestEntry.countDocuments({
      contestId: oid(contestId),
      spaceId: oid(spaceId),
      status: 'complete',
    }),
    Contest.findOne(
      { _id: oid(contestId), spaceId: oid(spaceId) },
      { name: 1, standingsVisibility: 1, endsAt: 1 },
    ).lean(),
  ]);

  const closed = contest ? Date.now() >= new Date(contest.endsAt).getTime() : false;
  const showRank =
    contest?.standingsVisibility === STANDINGS_VISIBILITY.LIVE ||
    (contest?.standingsVisibility === STANDINGS_VISIBILITY.AFTER && closed);

  return {
    contestId: String(contestId),
    name: contest?.name ?? null,
    score: mine.score,
    /** Withheld rather than faked when the admin keeps standings private. */
    rank: showRank ? ahead + 1 : null,
    entrants: showRank ? total : null,
    provisional: !closed,
  };
}

// ── Standings (prd.md F8.5.3, F8.5.4) ──────────────────────────────────────

/**
 * Ranked entries. Sorted by score desc, then total response time asc — the
 * faster of two equal scores is genuinely the better performance, and it is
 * the same idea the round scoring already encodes.
 *
 * `viewer` is optional; when given, their row is returned pinned even if it
 * falls outside the page (prd.md F6.6.4 applies here too).
 */
export async function standings(scope, contestId, { limit = 50, viewerId, isAdmin = false } = {}) {
  const contest = await Contest.findOne({ _id: oid(contestId), spaceId: scope.spaceId }).lean();
  if (!contest) throw new NotFoundError('No such contest.');

  const closed = Date.now() >= new Date(contest.endsAt).getTime();
  const visible =
    isAdmin ||
    contest.standingsVisibility === STANDINGS_VISIBILITY.LIVE ||
    (contest.standingsVisibility === STANDINGS_VISIBILITY.AFTER && closed);

  if (!visible) {
    return {
      contest: shapeContest(contest),
      hidden: true,
      reason:
        contest.standingsVisibility === STANDINGS_VISIBILITY.AFTER
          ? 'Standings appear when the contest closes.'
          : 'Your organization keeps these standings private.',
      rows: [],
      you: null,
    };
  }

  const all = await ContestEntry.find({ contestId: contest._id, spaceId: scope.spaceId })
    .sort({ score: -1, totalResponseMs: 1, completedAt: 1 })
    .limit(500)
    .lean();

  const ranked = all.map((entry, i) => ({
    rank: entry.finalRank ?? i + 1,
    userId: String(entry.userId),
    displayName: entry.displayName,
    avatarUrl: entry.avatarUrl ?? null,
    batchId: entry.batchId ? String(entry.batchId) : null,
    score: entry.score,
    correctCount: entry.correctCount,
    totalResponseMs: entry.totalResponseMs,
    status: entry.status,
    isYou: viewerId ? String(entry.userId) === String(viewerId) : false,
  }));

  const you = viewerId ? (ranked.find((r) => r.isYou) ?? null) : null;

  return {
    contest: shapeContest(contest),
    hidden: false,
    total: ranked.length,
    maxScore: contest.questionCount * MAX_ROUND_SCORE,
    rows: ranked.slice(0, limit),
    you,
  };
}

/**
 * Write final ranks once, when the window closes. After this the standings are
 * read from `finalRank` rather than recomputed, so a student's rank cannot move
 * because someone's entry was reconciled later.
 */
export async function finaliseContest(contestId) {
  const contest = await Contest.findById(oid(contestId));
  if (!contest || contest.finalisedAt) return { finalised: false };

  const entries = await ContestEntry.find({
    contestId: contest._id,
    spaceId: contest.spaceId,
  })
    .sort({ score: -1, totalResponseMs: 1, completedAt: 1 })
    .lean();

  if (entries.length) {
    await ContestEntry.bulkWrite(
      entries.map((entry, i) => ({
        updateOne: {
          filter: { _id: entry._id },
          update: {
            $set: {
              finalRank: i + 1,
              // An entry still "in progress" when the clock ran out did not
              // finish; it keeps whatever it scored and stops being live.
              ...(entry.status === 'in_progress' ? { status: 'abandoned' } : {}),
            },
          },
        },
      })),
      { ordered: false },
    );
  }

  contest.status = CONTEST_STATUS.FINISHED;
  contest.finalisedAt = new Date();
  contest.stats.entrants = entries.length;
  contest.stats.completed = entries.filter((e) => e.status === 'complete').length;
  await contest.save();

  // Tell the entrants where they came. This is the moment the contest is worth
  // having entered, so it is worth a notification even under a strict default.
  const top = entries.slice(0, 200);
  for (const [i, entry] of top.entries()) {
    await notify(entry.userId, {
      type: 'contest_result',
      prefKey: 'contestNew',
      title: `${contest.name} — you finished ${ordinal(i + 1)}`,
      body: `${entry.score} points out of ${entries.length} entrants.`,
      spaceId: contest.spaceId,
      data: { contestId: String(contest._id) },
    }).catch(() => {});
  }

  logger.info({ contestId: String(contest._id), entrants: entries.length }, 'contest finalised');
  return { finalised: true, entrants: entries.length };
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

// ── Lifecycle (tech.md §10 — "contest lifecycle, every minute") ────────────

/**
 * Open contests whose start time has passed, close those whose end time has,
 * and send the two notifications prd.md §6.9 asks for. Idempotent: every
 * transition is guarded by the status it moves out of, and every notification
 * by a timestamp that is set when it is sent.
 */
export async function runContestLifecycle(now = new Date()) {
  const result = { opened: 0, closed: 0, notifiedSoon: 0 };

  // 1. Starting in 15 minutes.
  /**
   * tenant-ok: the lifecycle job is platform-wide by definition — it advances
   * every organization's clock on the same tick. It reads only scheduling fields
   * and never returns a row to a caller; everything it hands on downstream is
   * re-scoped by the contest's own `spaceId`.
   */
  const soon = await Contest.find({
    status: CONTEST_STATUS.SCHEDULED,
    startingSoonNotifiedAt: null,
    startsAt: { $gt: now, $lte: new Date(now.getTime() + 15 * 60_000) },
  }).lean();

  for (const contest of soon) {
    await notifyEligible(contest, {
      type: 'contest_starting',
      prefKey: 'contestStarting',
      title: `${contest.name} starts in 15 minutes`,
      body: 'Be ready.',
    });
    await Contest.updateOne({ _id: contest._id }, { $set: { startingSoonNotifiedAt: now } });
    result.notifiedSoon += 1;
  }

  // 2. Open. The paper is frozen here rather than at the first entry, so the
  //    first student in does not pay for the sampling.
  /**
   * tenant-ok: the lifecycle job is platform-wide by definition — it advances
   * every organization's clock on the same tick. It reads only scheduling fields
   * and never returns a row to a caller; everything it hands on downstream is
   * re-scoped by the contest's own `spaceId`.
   */
  const due = await Contest.find({
    status: CONTEST_STATUS.SCHEDULED,
    startsAt: { $lte: now },
    endsAt: { $gt: now },
  });

  for (const contest of due) {
    try {
      await lockContestQuestions(contest);
      await Contest.updateOne(
        { _id: contest._id, status: CONTEST_STATUS.SCHEDULED },
        { $set: { status: CONTEST_STATUS.LIVE } },
      );
      if (!contest.openedNotifiedAt) {
        await notifyEligible(contest, {
          type: 'contest_open',
          prefKey: 'contestNew',
          title: `${contest.name} is open`,
          body: 'Play it before it closes.',
        });
        await Contest.updateOne({ _id: contest._id }, { $set: { openedNotifiedAt: now } });
      }
      result.opened += 1;
    } catch (err) {
      // A contest that cannot draw a paper must not sit "scheduled" for ever
      // pretending it will run.
      logger.error({ err, contestId: String(contest._id) }, 'contest could not open');
      await Contest.updateOne(
        { _id: contest._id },
        { $set: { status: CONTEST_STATUS.CANCELLED } },
      );
    }
  }

  // 3. Close and finalise.
  /**
   * tenant-ok: the lifecycle job is platform-wide by definition — it advances
   * every organization's clock on the same tick. It reads only scheduling fields
   * and never returns a row to a caller; everything it hands on downstream is
   * re-scoped by the contest's own `spaceId`.
   */
  const over = await Contest.find({
    status: { $in: [CONTEST_STATUS.LIVE, CONTEST_STATUS.SCHEDULED] },
    endsAt: { $lte: now },
  }).lean();

  for (const contest of over) {
    await finaliseContest(contest._id).catch((err) =>
      logger.error({ err, contestId: String(contest._id) }, 'contest finalise failed'),
    );
    result.closed += 1;
  }

  return result;
}

async function notifyEligible(contest, payload) {
  const filter = { spaceId: contest.spaceId, status: 'active' };
  if (contest.batchIds?.length) filter.batchId = { $in: contest.batchIds };

  const members = await SpaceMember.find(filter, { userId: 1 }).limit(5_000).lean();
  const space = await Space.findById(contest.spaceId, { name: 1 }).lean();

  for (const member of members) {
    await notify(member.userId, {
      ...payload,
      spaceId: contest.spaceId,
      data: { contestId: String(contest._id), spaceName: space?.name },
    }).catch(() => {});
  }
  return members.length;
}

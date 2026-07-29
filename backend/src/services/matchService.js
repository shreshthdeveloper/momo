import mongoose from 'mongoose';
import { Match, Replay, Question, Topic, User } from '../models/index.js';
import { applyMatchOutcome, applyRankedOutcome, rankedRatingsFor } from './ratingService.js';
import { advanceStreak, evaluateAchievements, ACHIEVEMENT_BY_KEY } from './achievementService.js';
import { notify } from './notificationService.js';
import { recordEntryResult, contestPlacementFor } from './contestService.js';
import { applyMatchToAssignments } from './assignmentService.js';
import { outcomeFor, verdictFor } from '../shared/scoring.js';
import { ratingBandOf } from '../shared/elo.js';
import { coinsForMatch, effectiveAccountLevel } from '../shared/mastery.js';
import { nextUnlock } from '../shared/perks.js';
import { promotionAward } from '../shared/league.js';
import { progression, rewardsForLevels } from './progressionService.js';
import { awardChests } from './chestService.js';
import { MATCH_MODE, ROUNDS_PER_MATCH, MAX_ROUND_SCORE, RANKED_START } from '../shared/constants.js';
import { logger } from '../lib/logger.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/** Minimum rounds answered before a match is worth replaying as a ghost. */
const REPLAY_MIN_ANSWERED = 5;

/**
 * A `live` row written when the match starts, so in-flight matches are visible
 * to observability and a process crash leaves an auditable trace rather than
 * nothing. Updated in place on completion.
 */
export async function createLiveMatchRecord({
  matchId,
  topicId,
  spaceId,
  mode,
  language,
  players,
  questionIds,
  roundDurationMs,
  challengeId = null,
  contestId = null,
}) {
  return Match.create({
    _id: oid(matchId),
    topicId: oid(topicId),
    spaceId: oid(spaceId),
    mode,
    language,
    status: 'live',
    roundDurationMs,
    challengeId,
    contestId: contestId ? oid(contestId) : null,
    questionIds: questionIds.map(oid),
    players: players.map((p) => ({
      userId: oid(p.userId),
      displayName: p.displayName,
      avatarUrl: p.avatarUrl,
      isGhost: Boolean(p.isGhost),
      sourceMatchId: p.sourceMatchId ? oid(p.sourceMatchId) : null,
      ratingBefore: p.rating,
    })),
  });
}

/**
 * Everything that happens after the last round. Called by the engine's
 * onComplete hook; the engine itself stays free of database concerns.
 */
export async function finalizeMatch(summary) {
  const perPlayer = {};
  /**
   * leagues-and-progression.md §6 — **only ranked moves a rating**, and it
   * moves both of them (the ladder and the topic) together.
   *
   * Quick play carries no stakes by design. A contest has its own standings
   * and must never touch a public rating: a student's league cannot drop
   * because their organization set a hard paper, and an organization must not
   * be able to inflate its students' standing. Practice counts for nothing,
   * and a voided match had no result to count. Every one of them still pays
   * XP — that measures play, not skill, which is why it never falls.
   */
  const rated = summary.mode === MATCH_MODE.RANKED && !summary.isVoid;

  /**
   * Both players' ladder ratings, read ONCE before anybody's is written.
   *
   * Scoring player B against A's freshly-updated rating would quietly break
   * the zero-sum property: the winner's +16 and the loser's −16 have to be
   * computed from the same pair of pre-match numbers. It is read for every
   * mode, not only ranked, because the result screen shows the league badge
   * after a quick match too — it simply does not move.
   */
  const preMatchRanked = await rankedRatingsFor(
    summary.players.filter((p) => !p.isGhost).map((p) => p.userId),
  ).catch((err) => {
    logger.error({ err, matchId: summary.matchId }, 'ranked rating read failed');
    return new Map();
  });

  const rounds = summary.rounds.map((r) => ({
    questionIndex: r.questionIndex,
    questionId: r.questionId,
    correctIndex: r.correctIndex,
    optionOrder: r.optionOrder,
    durationMs: r.durationMs,
    answers: r.answers.map((a) => ({
      userId: oid(a.userId),
      optionIndex: a.optionIndex,
      elapsedMs: a.elapsedMs,
      points: a.points,
      isCorrect: a.isCorrect,
      flagged: a.flagged,
    })),
  }));

  for (const player of summary.players) {
    // prd.md F6.7.6 — the replayed player's rating never moves.
    if (player.isGhost) continue;

    const opponent = summary.players.find((p) => p.userId !== player.userId);
    const opponentRating = opponent?.rating ?? player.rating;
    const verdict = summary.isVoid
      ? 'draw'
      : summary.winnerId
        ? summary.winnerId === player.userId
          ? 'won'
          : 'lost'
        : 'draw';

    const myAnswers = rounds
      .map((r) => r.answers.find((a) => String(a.userId) === player.userId))
      .filter(Boolean);
    const totalAnswers = myAnswers.filter((a) => a.optionIndex !== null).length;
    const totalResponseMs = myAnswers.reduce((sum, a) => sum + (a.elapsedMs ?? 0), 0);

    const score = outcomeFor(player.score, opponent?.score ?? 0);
    const myRanked = preMatchRanked.get(player.userId) ?? RANKED_START;
    /**
     * A ghost has no account and therefore no ladder of its own. Its replay
     * carries the rating the player held in this topic when the run was
     * recorded, which is the closest honest measure of how strong that run
     * was; with nothing at all to go on, scoring against yourself gives an
     * expected score of 0.5 and no free points either way.
     */
    const opponentRankedRating = !opponent
      ? myRanked
      : opponent.isGhost
        ? (opponent.rating ?? myRanked)
        : (preMatchRanked.get(opponent.userId) ?? RANKED_START);

    const outcome = {
      ratingBefore: player.rating,
      ratingAfter: player.rating,
      ratingDelta: 0,
      // Reported for every mode so the result screen can always draw the
      // league badge; only a ranked match makes these three differ.
      rankedBefore: myRanked,
      rankedAfter: myRanked,
      rankedDelta: 0,
    };

    try {
      Object.assign(
        outcome,
        await applyMatchOutcome({
          userId: player.userId,
          topicId: summary.topicId,
          spaceId: summary.spaceId,
          opponentRating,
          outcome: score,
          verdict,
          correctCount: player.correctCount,
          totalAnswers,
          totalResponseMs,
          rated,
          mode: summary.mode,
        }),
      );
    } catch (err) {
      logger.error({ err, userId: player.userId }, 'rating update failed');
    }

    if (rated) {
      try {
        Object.assign(
          outcome,
          await applyRankedOutcome({
            userId: player.userId,
            opponentRankedRating,
            outcome: score,
          }),
        );
      } catch (err) {
        logger.error({ err, userId: player.userId }, 'ranked rating update failed');
      }

      /**
       * Chests hang off the ranked rating, so this is the moment to look —
       * and the test is "has reached", not "just crossed": a chest added to
       * the config today should still find the players already above it.
       *
       * Nothing is granted here. The row is written and the player opens it
       * on the rewards screen, because a gift that unwraps itself in a corner
       * of the result screen is not a gift.
       */
      try {
        const won = await awardChests({
          userId: player.userId,
          rankedRating: outcome.rankedAfter,
        });
        if (won.length) {
          outcome.chestsWon = won.map((c) => ({ key: c.key, name: c.name, triggerLabel: c.triggerLabel }));
          for (const chest of won) {
            await notify(player.userId, {
              type: 'chest',
              title: `${chest.name} unlocked`,
              body: `${chest.triggerLabel}. Open it on your rewards screen.`,
            }).catch(() => {});
          }
        }
      } catch (err) {
        logger.error({ err, userId: player.userId }, 'chest evaluation failed');
      }

      /**
       * Climbing pays (coins-and-cosmetics.md §3.1). Read from the ratings
       * either side of this match rather than from a stored league, because
       * there is no stored league — a standing is a band of a number, and a
       * promotion is that number crossing a floor.
       */
      const promotion = promotionAward(
        outcome.rankedBefore,
        outcome.rankedAfter,
        progression().ladder,
      );
      if (promotion) {
        outcome.promotion = {
          kind: promotion.kind,
          coins: promotion.coins,
          label: promotion.league.label,
        };
      }
    }

    perPlayer[player.userId] = outcome;

    try {
      // The account level and its unlocks fall out of the XP write, so they
      // are computed where that write happens rather than read back after it.
      Object.assign(
        outcome,
        (await updatePlayerProfile({ summary, player, verdict, outcome, opponentRating, myAnswers })) ?? {},
      );
    } catch (err) {
      logger.error({ err, userId: player.userId }, 'profile update failed');
    }

    // ── Phase 3 ────────────────────────────────────────────────────────────
    // Both of these hang off match completion rather than off a button the
    // client presses: a contest entry the player forgot to submit, or an
    // assignment that only advances when someone opens a tab, are both bugs
    // waiting to be reported as "it didn't count".

    if (summary.contestId) {
      try {
        await recordEntryResult({
          contestId: summary.contestId,
          spaceId: summary.spaceId,
          userId: player.userId,
          matchId: summary.matchId,
          player,
          answers: myAnswers,
        });
        outcome.contest = await contestPlacementFor(
          summary.contestId,
          summary.spaceId,
          player.userId,
        );
      } catch (err) {
        logger.error({ err, contestId: summary.contestId }, 'contest entry write failed');
      }
    }

    try {
      outcome.assignmentsCompleted = await applyMatchToAssignments({
        spaceId: summary.spaceId,
        topicId: summary.topicId,
        userId: player.userId,
        correctCount: player.correctCount,
        answeredCount: totalAnswers,
        level: outcome.level ?? 0,
        playedAt: new Date(summary.completedAt),
      });
    } catch (err) {
      logger.error({ err, userId: player.userId }, 'assignment progress failed');
    }
  }

  await Match.updateOne(
    { _id: oid(summary.matchId) },
    {
      $set: {
        status: summary.isVoid ? 'void' : summary.abandonedBy ? 'abandoned' : 'complete',
        rounds,
        winnerId: summary.winnerId ? oid(summary.winnerId) : null,
        isDraw: summary.isDraw,
        isVoid: summary.isVoid,
        completedAt: new Date(summary.completedAt),
        players: summary.players.map((p) => ({
          userId: oid(p.userId),
          displayName: p.displayName,
          avatarUrl: p.avatarUrl,
          isGhost: p.isGhost,
          sourceMatchId: p.sourceMatchId ? oid(p.sourceMatchId) : null,
          score: p.score,
          correctCount: p.correctCount,
          ratingBefore: perPlayer[p.userId]?.ratingBefore ?? p.rating,
          ratingAfter: perPlayer[p.userId]?.ratingAfter ?? p.rating,
          xpEarned: perPlayer[p.userId]?.xpEarned ?? 0,
          coinsEarned: perPlayer[p.userId]?.coinsEarned ?? 0,
          // The ladder and the account level, as they stood for this match.
          // A ghost has neither, so these stay unset for it.
          rankedBefore: perPlayer[p.userId]?.rankedBefore,
          rankedAfter: perPlayer[p.userId]?.rankedAfter,
          rankedDelta: perPlayer[p.userId]?.rankedDelta,
          accountLevelBefore: perPlayer[p.userId]?.accountLevelBefore,
          accountLevel: perPlayer[p.userId]?.accountLevel,
          accountLevelUp: perPlayer[p.userId]?.accountLevelUp ?? false,
          unlocked: perPlayer[p.userId]?.unlocked?.length
            ? perPlayer[p.userId].unlocked
            : undefined,
          totalXpAfter: perPlayer[p.userId]?.totalXpAfter,
          forfeited: p.forfeited,
        })),
      },
    },
  );

  await Promise.allSettled([
    rollUpQuestionStats(rounds),
    Topic.updateOne({ _id: oid(summary.topicId) }, { $inc: { 'stats.matchesPlayed': 1 } }),
    maybeCreateReplays(summary, rounds),
  ]);

  return { perPlayer };
}

/**
 * The account-wide half of one player's result: streak, achievements, the XP
 * that feeds the **account level**, and whatever crossing that level handed
 * over (leagues-and-progression.md §4–5).
 *
 * @returns {Promise<object|undefined>} progression fields to merge into the outcome
 */
async function updatePlayerProfile({ summary, player, verdict, outcome, opponentRating, myAnswers }) {
  const user = await User.findById(oid(player.userId));
  if (!user) return undefined;

  const streak = advanceStreak(user.streak, new Date(summary.completedAt));
  // At or above, not equal to: the bonus round pays double, so a perfect
  // answer on the closing round scores 80 and an equality test misses the
  // fastest answer in the match.
  const maxSpeedAnswer = myAnswers.some((a) => a.points >= MAX_ROUND_SCORE);

  /**
   * Both levels are read from the XP total, before and after this match's
   * award — nothing about the level itself is stored, so there is no second
   * number that can disagree with the XP that earned it. Unlocks are the
   * difference between the two, which is exactly what the result screen
   * should celebrate.
   */
  const { accountCurve, catalogue } = progression();
  const floor = user.accountLevelFloor ?? 1;
  const totalXpBefore = user.totalXp ?? 0;
  const totalXpAfter = totalXpBefore + (outcome.xpEarned ?? 0);
  const accountLevelBefore = effectiveAccountLevel(totalXpBefore, floor, accountCurve);
  const accountLevel = effectiveAccountLevel(totalXpAfter, floor, accountCurve);

  /**
   * What the match and the levels it crossed pay in coins.
   *
   * Both are computed here so they can be banked in the SAME write that stores
   * the XP that earned them. Two writes would leave a window in which a player
   * had levelled up and not been paid for it, and the only way to detect that
   * afterwards would be the transaction history this system deliberately does
   * not keep.
   */
  const levelRewards = rewardsForLevels({
    catalogue,
    before: accountLevelBefore,
    after: accountLevel,
    granted: user.grantedPerks ?? [],
  });
  /**
   * A void match pays nothing.
   *
   * When both players drop, ratings do not move and `match:end` reports the
   * match as unranked — but coins were still computed from a ranked DRAW, so a
   * match that officially did not count credited both accounts 25. Beyond the
   * inconsistency it is farmable: two accounts dropping together, repeatedly,
   * is free money. Now this case is reachable at all (the void branch used to
   * be dead), it has to be right.
   */
  const matchCoins = summary.isVoid ? 0 : coinsForMatch({ verdict, mode: summary.mode });
  const coinsEarned = matchCoins + levelRewards.coins + (outcome.promotion?.coins ?? 0);

  const earned = await evaluateAchievements({
    user,
    verdict,
    correctCount: player.correctCount,
    opponentRating,
    ratingBefore: outcome.ratingBefore,
    level: outcome.level ?? 1,
    maxSpeedAnswer,
    // The streak this match just made, not the one it started with.
    streak,
  });

  await User.updateOne(
    { _id: user._id },
    {
      $inc: {
        matchesPlayed: 1,
        matchesWon: verdict === 'won' ? 1 : 0,
        totalXp: outcome.xpEarned ?? 0,
        coins: coinsEarned,
        cheatFlags: player.flags ?? 0,
      },
      $set: {
        'streak.current': streak.current,
        'streak.longest': streak.longest,
        'streak.lastPlayedOn': streak.lastPlayedOn,
        lastActiveAt: new Date(),
      },
      // The milestone drop is a real grant: unlike a title, it is not derivable
      // from the level, so if it is not written down it did not happen.
      ...(levelRewards.drops.length
        ? { $addToSet: { grantedPerks: { $each: levelRewards.drops.map((d) => d.key) } } }
        : {}),
    },
  );

  if (earned.length) logger.info({ userId: player.userId, earned }, 'achievements earned');
  if (levelRewards.levels.length) {
    logger.info(
      {
        userId: player.userId,
        accountLevel,
        coins: levelRewards.coins,
        titles: levelRewards.titles.map((t) => t.key),
        drops: levelRewards.drops.map((d) => d.key),
      },
      'account level rewards',
    );
  }

  await notifyProgress(player.userId, {
    earned,
    accountLevelBefore,
    accountLevel,
    levelRewards,
  });

  /**
   * `unlocked` is what the result screen celebrates, and it is now the titles
   * and the drops together — the two things a level actually hands over. The
   * coins are reported separately because they are a number, not a thing.
   */
  return {
    accountLevelBefore,
    accountLevel,
    accountLevelUp: accountLevel > accountLevelBefore,
    unlocked: [...levelRewards.titles, ...levelRewards.drops],
    coinsEarned,
    coinsFromMatch: matchCoins,
    coinsFromLevels: levelRewards.coins,
    coinsAfter: (user.coins ?? 0) + coinsEarned,
    /** What the next level opens — the catalogue is config, so it is sent. */
    nextUnlock: nextUnlock(catalogue, accountLevel),
    totalXpAfter,
  };
}

/**
 * What this match handed over, written to the inbox.
 *
 * ── Why these are written but never pushed ───────────────────────────────────
 *
 * Every one of them is already on the result screen, animating, at the exact
 * moment this runs. A push would be a banner over the celebration it duplicates.
 * What the row buys is the thing the result screen cannot: it is still there
 * tomorrow. A player who closed the app on the level-up, or who was reading the
 * score and missed the badge, has somewhere to find it — and until now there was
 * nowhere, because achievements and titles were announced once, in an animation,
 * and then only ever existed as a silent count on the profile.
 *
 * Failures are swallowed. A notification must never take down the write that
 * banked the XP which earned it.
 */
async function notifyProgress(userId, { earned, accountLevelBefore, accountLevel, levelRewards }) {
  try {
    for (const key of earned) {
      const achievement = ACHIEVEMENT_BY_KEY[key];
      if (!achievement) continue;
      await notify(userId, {
        type: 'achievement',
        push: false,
        title: `Achievement unlocked — ${achievement.title}`,
        body: achievement.detail,
        data: { achievement: key },
      });
    }

    if (accountLevel > accountLevelBefore) {
      /**
       * One row for the level, naming what it opened, rather than a row per
       * thing. Levelling from 6 to 7 with a title and a drop is ONE event to a
       * player — three rows would read as three separate pieces of news.
       */
      const titles = levelRewards.titles.map((t) => t.name).filter(Boolean);
      const drops = levelRewards.drops.map((d) => d.name).filter(Boolean);
      const opened = [...titles, ...drops];

      await notify(userId, {
        type: 'level_up',
        push: false,
        title: `You reached level ${accountLevel}`,
        body: opened.length
          ? `${opened.join(' and ')} unlocked.`
          : levelRewards.coins > 0
            ? `${levelRewards.coins} coins banked.`
            : undefined,
        data: { level: accountLevel, titles: levelRewards.titles.map((t) => t.key) },
      });
    }
  } catch (err) {
    logger.error({ err, userId }, 'progress notification failed');
  }
}

/**
 * Item analysis counters (prd.md F8.2.10).
 *
 * tech.md §10 schedules this as a 15-minute rollup. It runs inline instead:
 * it is seven upserts once per match, it keeps admin item analysis correct the
 * moment a match ends, and it removes the need for a watermark to track what
 * has already been counted. The scheduled job in jobs/ reconciles drift.
 *
 * Counts are attributed to CANONICAL option indices, not the shuffled
 * positions the players saw — otherwise option distribution would be noise.
 */
async function rollUpQuestionStats(rounds) {
  const ops = [];
  for (const round of rounds) {
    if (!round.questionId) continue;
    const inc = { 'stats.served': 1 };
    const answered = round.answers.filter((a) => a.optionIndex !== null);
    let responseTotal = 0;

    for (const answer of round.answers) {
      if (answer.optionIndex === null) {
        inc['stats.timeoutCount'] = (inc['stats.timeoutCount'] ?? 0) + 1;
        continue;
      }
      const canonical = round.optionOrder?.[answer.optionIndex] ?? answer.optionIndex;
      inc[`stats.optionCounts.${canonical}`] = (inc[`stats.optionCounts.${canonical}`] ?? 0) + 1;
      if (answer.isCorrect) inc['stats.correctCount'] = (inc['stats.correctCount'] ?? 0) + 1;
      responseTotal += answer.elapsedMs ?? 0;
    }

    ops.push({
      updateOne: {
        filter: { _id: round.questionId },
        update: {
          $inc: inc,
          $set: {
            servedEver: true,
            ...(answered.length
              ? { 'stats.avgResponseMs': Math.round(responseTotal / answered.length) }
              : {}),
          },
        },
      },
    });
  }
  if (ops.length) await Question.bulkWrite(ops, { ordered: false });
}

/**
 * prd.md F6.7.1 — every completed match is stored as a replay. tech.md §3.9
 * adds the qualifier that matters: only matches where the player answered at
 * least 5 of 7 rounds. A replay of someone who quit makes a terrible opponent.
 */
async function maybeCreateReplays(summary, rounds) {
  if (summary.mode === MATCH_MODE.PRACTICE || summary.isVoid) return;

  for (const player of summary.players) {
    if (player.isGhost || player.forfeited) continue;

    const answers = rounds.map((r) => {
      const mine = r.answers.find((a) => String(a.userId) === player.userId);
      return {
        // Canonical index, so the replay stays correct under a different shuffle.
        optionIndex:
          mine?.optionIndex === null || mine?.optionIndex === undefined
            ? null
            : (r.optionOrder?.[mine.optionIndex] ?? mine.optionIndex),
        elapsedMs: mine?.elapsedMs ?? null,
        isCorrect: Boolean(mine?.isCorrect),
      };
    });

    const answered = answers.filter((a) => a.optionIndex !== null).length;
    if (answered < REPLAY_MIN_ANSWERED || rounds.length < ROUNDS_PER_MATCH) continue;

    const rating = player.rating;
    await Replay.updateOne(
      { matchId: oid(summary.matchId), userId: oid(player.userId) },
      {
        $setOnInsert: {
          matchId: oid(summary.matchId),
          userId: oid(player.userId),
          topicId: oid(summary.topicId),
          spaceId: oid(summary.spaceId),
          playerRating: rating,
          ratingBand: ratingBandOf(rating),
          /**
           * The level they were at when they played this, not after — the run
           * being stored is the one that earned the XP, so pairing a future
           * opponent against the post-match level would place it one step too
           * high.
           */
          playerLevel: player.level ?? null,
          displayName: player.displayName,
          avatarUrl: player.avatarUrl,
          /** So a future opponent gets the same flag a live one would have. */
          country: player.country ?? null,
          city: player.city ?? null,
          questionIds: summary.questionIds.map(oid),
          answers,
          finalScore: player.score,
          usedCount: 0,
          /**
           * Partitions the ghost pool. A contest run is only ever served back
           * inside that contest — see the field comment on the Replay model.
           */
          contestId: summary.contestId ? oid(summary.contestId) : null,
        },
      },
      { upsert: true },
    ).catch((err) => {
      // A duplicate is genuinely fine (the finalizer is idempotent); anything
      // else means the topic quietly stops producing ghosts, which shows up
      // later as an unexplained rise in synthetic opponents.
      if (err.code !== 11000) logger.error({ err, matchId: summary.matchId }, 'replay write failed');
    });
  }
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function listMatchesForUser(userId, { limit = 20, before, topicId } = {}) {
  const filter = { 'players.userId': oid(userId), status: { $in: ['complete', 'abandoned'] } };
  if (before) filter.createdAt = { $lt: new Date(before) };
  if (topicId) filter.topicId = oid(topicId);

  const matches = await Match.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 50))
    .populate('topicId', 'name slug coverUrl')
    .lean();

  return matches.map((m) => shapeMatchSummary(m, userId));
}

/**
 * The verdict word for one player. `winnerId` wins over raw scores because it
 * already accounts for forfeits — see the same rule in game/matchEngine.js.
 */
export function verdictOfMatch(match, viewerId) {
  if (match.isVoid) return 'void';
  if (match.winnerId) return String(match.winnerId) === String(viewerId) ? 'won' : 'lost';
  if (match.isDraw) return 'draw';
  const me = match.players.find((p) => String(p.userId) === String(viewerId));
  const them = match.players.find((p) => String(p.userId) !== String(viewerId));
  return verdictFor(me?.score ?? 0, them?.score ?? 0);
}

export function shapeMatchSummary(match, viewerId) {
  const me = match.players.find((p) => String(p.userId) === String(viewerId));
  const them = match.players.find((p) => String(p.userId) !== String(viewerId));
  return {
    id: String(match._id),
    topic: match.topicId?._id
      ? {
          id: String(match.topicId._id),
          name: match.topicId.name,
          slug: match.topicId.slug,
          coverUrl: match.topicId.coverUrl,
        }
      : { id: String(match.topicId) },
    mode: match.mode,
    /** Whether the ladder was at stake — the history list says so per row. */
    ranked: match.mode === MATCH_MODE.RANKED,
    verdict: verdictOfMatch(match, viewerId),
    you: me
      ? {
          score: me.score,
          correctCount: me.correctCount,
          ratingDelta: (me.ratingAfter ?? 0) - (me.ratingBefore ?? 0),
          /**
           * The ladder move, which is a different number from the topic Elo
           * above it: history lists matches across every topic, so the figure
           * a player recognises from their profile is the ranked one
           * (leagues-and-progression.md §2).
           */
          rankedDelta: (me.rankedAfter ?? 0) - (me.rankedBefore ?? 0),
        }
      : null,
    opponent: them
      ? {
          id: String(them.userId),
          displayName: them.displayName,
          avatarUrl: them.avatarUrl,
          score: them.score,
        }
      : null,
    playedAt: match.completedAt ?? match.createdAt,
  };
}

/**
 * prd.md F6.4.20 — the full review. This is the only endpoint that returns the
 * answer key, and it is gated on the match being over and the viewer having
 * played in it.
 */
export async function getMatchForReview(matchId, viewerId) {
  const match = await Match.findById(oid(matchId))
    .populate('topicId', 'name slug coverUrl spaceId')
    .lean();
  if (!match) return null;

  const isParticipant = match.players.some((p) => String(p.userId) === String(viewerId));
  if (!isParticipant) return null;
  if (match.status === 'live') return null;

  const questions = await Question.find({ _id: { $in: match.questionIds } }).lean();
  const byId = new Map(questions.map((q) => [String(q._id), q]));
  const language = match.language ?? 'en';

  const me = match.players.find((p) => String(p.userId) === String(viewerId));
  const them = match.players.find((p) => String(p.userId) !== String(viewerId));

  const rounds = match.rounds.map((round) => {
    const question = byId.get(String(round.questionId));
    const content = question?.content?.[language] ?? question?.content?.[question?.defaultLanguage];
    // Re-render the options in the order this match actually showed them, so
    // the review matches what the player saw.
    const shownOptions = round.optionOrder?.length
      ? round.optionOrder.map((canonical) => content?.options?.[canonical] ?? '')
      : (content?.options ?? []);

    const mine = round.answers.find((a) => String(a.userId) === String(viewerId));
    const theirs = round.answers.find((a) => String(a.userId) !== String(viewerId));

    return {
      roundIndex: round.questionIndex,
      questionId: String(round.questionId),
      text: content?.text ?? '',
      imageUrl: question?.imageUrl ?? null,
      options: shownOptions,
      correctIndex: round.correctIndex,
      explanation: content?.explanation ?? null,
      difficulty: question?.difficulty,
      you: {
        optionIndex: mine?.optionIndex ?? null,
        points: mine?.points ?? 0,
        elapsedMs: mine?.elapsedMs ?? null,
        isCorrect: Boolean(mine?.isCorrect),
      },
      opponent: {
        optionIndex: theirs?.optionIndex ?? null,
        points: theirs?.points ?? 0,
        elapsedMs: theirs?.elapsedMs ?? null,
        isCorrect: Boolean(theirs?.isCorrect),
      },
    };
  });

  return {
    id: String(match._id),
    topic: match.topicId
      ? { id: String(match.topicId._id), name: match.topicId.name, coverUrl: match.topicId.coverUrl }
      : null,
    mode: match.mode,
    status: match.status,
    verdict: verdictOfMatch(match, viewerId),
    scores: { you: me?.score ?? 0, opponent: them?.score ?? 0 },
    ratingDelta: (me?.ratingAfter ?? 0) - (me?.ratingBefore ?? 0),
    rankedDelta: (me?.rankedAfter ?? 0) - (me?.rankedBefore ?? 0),
    ranked: match.mode === MATCH_MODE.RANKED,
    xpEarned: me?.xpEarned ?? 0,
    you: me ? { id: String(me.userId), displayName: me.displayName, avatarUrl: me.avatarUrl } : null,
    opponent: them
      ? { id: String(them.userId), displayName: them.displayName, avatarUrl: them.avatarUrl }
      : null,
    rounds,
    playedAt: match.completedAt ?? match.createdAt,
  };
}

/** prd.md F6.8.3 — head-to-head record, shown under a rival's name. */
export async function headToHead(userA, userB) {
  const matches = await Match.find(
    {
      /**
       * A forfeit counts. It is stored as `abandoned` rather than `complete`,
       * and filtering on `complete` alone quietly dropped every match decided
       * that way — while the verdict, the ratings and the match history all
       * count them, so the versus screen would announce "First meeting"
       * against a rival the player had already beaten.
       *
       * Void matches (both players dropped) are excluded on purpose: nothing
       * moved for either side, so there is no result to record.
       */
      status: { $in: ['complete', 'abandoned'] },
      isVoid: { $ne: true },
      'players.userId': { $all: [oid(userA), oid(userB)] },
    },
    { players: 1, winnerId: 1, isDraw: 1 },
  )
    .limit(200)
    .lean();

  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const m of matches) {
    if (m.isDraw) draws += 1;
    else if (String(m.winnerId) === String(userA)) wins += 1;
    else if (String(m.winnerId) === String(userB)) losses += 1;
  }
  return { played: matches.length, wins, losses, draws };
}

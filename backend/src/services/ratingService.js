import mongoose from 'mongoose';
import { Rating, User } from '../models/index.js';
import { nextRating, overallRatingFrom } from '../shared/elo.js';
import { levelForXp, xpForMatch } from '../shared/mastery.js';
import {
  ELO_START,
  OVERALL_RATING_TOPIC_COUNT,
  RANKED_START,
  isUnrecordedMode,
} from '../shared/constants.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/** Read-or-create the (user, topic) rating row. */
export async function getOrCreateRating(userId, topicId, spaceId) {
  const filter = { userId: oid(userId), topicId: oid(topicId) };
  const existing = await Rating.findOne(filter);
  if (existing) return existing;
  return Rating.findOneAndUpdate(
    filter,
    { $setOnInsert: { ...filter, spaceId: oid(spaceId), rating: ELO_START } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export async function getRatingValue(userId, topicId) {
  return (await getRatingEntry(userId, topicId)).rating;
}

/**
 * The pair matchmaking needs, in one read: the topic LEVEL that pairing runs
 * on, and the topic RATING that ghost selection and the match record still
 * carry. A player who has never touched this topic is level 1 at the starting
 * rating, exactly as the Rating model would create them.
 */
export async function getRatingEntry(userId, topicId) {
  const row = await Rating.findOne(
    { userId: oid(userId), topicId: oid(topicId) },
    { rating: 1, level: 1, xp: 1 },
  ).lean();
  if (!row) return { rating: ELO_START, level: 1 };
  return {
    rating: row.rating ?? ELO_START,
    // `level` is denormalised from `xp`; a row written before it existed reads
    // as level 1 and would silently pool every veteran with the beginners.
    level: row.level ?? levelForXp(row.xp ?? 0),
  };
}

/** Ratings for many topics at once — used by the home feed and topic lists. */
export async function ratingsForTopics(userId, topicIds) {
  if (!userId || !topicIds?.length) return new Map();
  const rows = await Rating.find({
    userId: oid(userId),
    topicId: { $in: topicIds.map(oid) },
  }).lean();
  return new Map(rows.map((r) => [String(r.topicId), r]));
}

/**
 * Apply one match's outcome to one player, for one topic.
 *
 * prd.md F6.7.6 — a ghost match affects the live player's rating, never the
 * replayed player's, so this is only ever called for a non-ghost player.
 * Every other mode does reach here, including practice and quick play: they
 * arrive with `rated: false` and take the XP without moving the rating, which
 * is the whole shape of leagues-and-progression.md §6.
 */
export async function applyMatchOutcome({
  userId,
  topicId,
  spaceId,
  opponentRating,
  outcome, // 1 | 0.5 | 0
  verdict, // 'won' | 'lost' | 'draw'
  correctCount,
  totalAnswers,
  totalResponseMs,
  rated = true,
  mode,
}) {
  const row = await getOrCreateRating(userId, topicId, spaceId);
  const ratingBefore = row.rating;
  const ratingAfter = rated ? nextRating(ratingBefore, opponentRating, outcome) : ratingBefore;

  // The mode decides the win bonus, not `rated` — a contest is unrated but is
  // still played for keeps, whereas quick play is the one mode paid for
  // participation alone (leagues-and-progression.md §1).
  const xpEarned = xpForMatch({ verdict, correctCount, mode });
  const levelBefore = row.level;
  const xpAfter = row.xp + xpEarned;
  const levelAfter = levelForXp(xpAfter);

  row.rating = ratingAfter;
  row.peakRating = Math.max(row.peakRating ?? ratingBefore, ratingAfter);
  if (ratingAfter !== ratingBefore) row.reachedRatingAt = new Date();
  /**
   * A drill is play, not a match. So is a self-race.
   *
   * The XP and the answer counts below are the whole point of both — they are
   * what makes the mastery bar move and what the weakest-topic report reads. The
   * win/loss record is a different kind of number: there was no opponent, so
   * none of the three columns is true, and falling through to `draws` would
   * claim the scores were level with somebody who was never there.
   *
   * `matchesPlayed` stays put for a less obvious reason — it is the leaderboard's
   * tiebreak, where FEWER matches ranks higher at equal rating. Counting drills
   * there would quietly penalise the mode we most want people to use.
   *
   * ── Why the mode, and not just the verdict ─────────────────────────────────
   *
   * This tested `verdict !== 'solo'` alone, and a self-race is not solo: it has
   * two entries, so it ends in a real `won`/`lost`/`draw` against the recording.
   * Every one of those was landing in this topic's W–L–D and bumping
   * `matchesPlayed` — a win over nobody, bankable on demand by re-running your
   * own best until you beat it, and moving a leaderboard tiebreak while doing so.
   *
   * `matchService` has always gated the ACCOUNT-level `matchesPlayed/matchesWon`
   * on `unrecorded`, which is `verdict === 'solo' || isUnrecordedMode(mode)`. The
   * per-topic row is the same record at a smaller scale and now asks the same
   * question, so the two can no longer disagree about the same match.
   */
  const unrecorded = verdict === 'solo' || isUnrecordedMode(mode);
  if (!unrecorded) {
    row.matchesPlayed += 1;
    if (verdict === 'won') row.wins += 1;
    else if (verdict === 'lost') row.losses += 1;
    else row.draws += 1;
  }
  row.xp = xpAfter;
  row.level = levelAfter;
  row.correctAnswers += correctCount;
  row.totalAnswers += totalAnswers;
  row.totalResponseMs += totalResponseMs;
  row.lastPlayedAt = new Date();
  await row.save();

  await recomputeOverallRating(userId);

  return {
    ratingBefore,
    ratingAfter,
    ratingDelta: ratingAfter - ratingBefore,
    xpEarned,
    xp: xpAfter,
    level: levelAfter,
    levelUp: levelAfter > levelBefore,
  };
}

/**
 * The ranked ratings of several players at once, keyed by id string.
 *
 * finalizeMatch reads BOTH sides through this before it writes either of them.
 * Scoring the second player against a rating the first player's own update has
 * already moved is not a rounding error — it silently breaks the zero-sum
 * property the ladder rests on.
 */
export async function rankedRatingsFor(userIds) {
  const ids = (userIds ?? []).filter(Boolean).map(oid);
  if (!ids.length) return new Map();
  const rows = await User.find({ _id: { $in: ids } }, { rankedRating: 1 }).lean();
  return new Map(rows.map((r) => [String(r._id), r.rankedRating ?? RANKED_START]));
}

/**
 * The global ladder (leagues-and-progression.md §2).
 *
 * One Elo for the whole account, moved by ranked matches only, whatever the
 * topic. Same K and same floor as the per-topic rating — `nextRating` clamps
 * to it, so a bad run bottoms out at Bronze III rather than falling forever.
 *
 * @param {object} input
 * @param {number} input.opponentRankedRating the opponent's PRE-match rating
 * @param {1 | 0.5 | 0} input.outcome
 */
export async function applyRankedOutcome({ userId, opponentRankedRating, outcome }) {
  const user = await User.findById(oid(userId), { rankedRating: 1 }).lean();
  const rankedBefore = user?.rankedRating ?? RANKED_START;
  // A ghost carries no ladder of its own; scoring against yourself makes the
  // expected score 0.5, which is the fairest reading of "unknown opponent".
  const opponent = Number.isFinite(opponentRankedRating) ? opponentRankedRating : rankedBefore;
  const rankedAfter = nextRating(rankedBefore, opponent, outcome);

  await User.updateOne(
    { _id: oid(userId) },
    { $set: { rankedRating: rankedAfter }, $inc: { rankedMatches: 1 } },
  );

  return { rankedBefore, rankedAfter, rankedDelta: rankedAfter - rankedBefore };
}

/** prd.md F6.5.3 — overall rating derives from the five strongest topics. */
export async function recomputeOverallRating(userId) {
  const top = await Rating.find({ userId: oid(userId) }, { rating: 1 })
    .sort({ rating: -1 })
    .limit(OVERALL_RATING_TOPIC_COUNT)
    .lean();
  const overall = overallRatingFrom(top.map((r) => r.rating));
  await User.updateOne({ _id: oid(userId) }, { $set: { overallRating: overall } });
  return overall;
}

/** The viewer's strongest topics, for the profile screen. */
export async function topTopicsFor(userId, limit = 5) {
  return Rating.find({ userId: oid(userId) })
    .sort({ rating: -1 })
    .limit(limit)
    .populate('topicId', 'name slug coverUrl spaceId')
    .lean();
}

import mongoose from 'mongoose';
import { Match, Question, SpaceMember, Topic, publicSpaceId } from '../models/index.js';
import { allowedOriginsFor } from '../game/questionSelector.js';
import { QUESTION_STATUS, ROUNDS_PER_MATCH } from '../shared/constants.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * The mistakes deck — the questions you got wrong and have not since got right.
 *
 * This is spaced repetition assembled out of parts the product already had, and
 * it needed no new writes at all: every answer a player has ever given is already
 * on `Match.rounds[].answers[]` with the round's `questionId` beside it, and
 * practice is already a solo drill over an arbitrary set of questions. What was
 * missing was only the query between them. Nothing else in the app helps a player
 * retry what they got wrong, which for a study product is a strange gap.
 *
 * ── What counts as a mistake you still owe ──────────────────────────────────
 *
 * The LAST answer decides, not any answer. A question you once missed and have
 * since got right is not a mistake any more — it is the system working, and
 * keeping it in the deck would mean the deck only ever grows. A deck that drains
 * is the entire motivation to open it.
 *
 * Only rounds the player actually answered count. A timed-out round is left out
 * on purpose: a blank can mean "did not know it" but it can equally mean the app
 * went to the background or a bus went into a tunnel, and one abandoned match
 * would otherwise dump seven questions into the deck that the player may know
 * perfectly well. Being wrong is a signal; being absent is not.
 */

/**
 * The aggregation shared by both readers below.
 *
 * `$sort` before `$group` is what makes `$last` mean "most recent answer". It is
 * the whole correctness argument of this file, which is why it is here once
 * rather than copied into two pipelines that could drift apart.
 */
function outstandingMistakes({ userId, topicId = null }) {
  const uid = oid(userId);
  return [
    {
      $match: {
        'players.userId': uid,
        status: { $in: ['complete', 'abandoned'] },
        ...(topicId ? { topicId: oid(topicId) } : {}),
      },
    },
    { $unwind: '$rounds' },
    { $unwind: '$rounds.answers' },
    // This player's own answers, and only the ones they actually gave.
    {
      $match: {
        'rounds.answers.userId': uid,
        'rounds.answers.optionIndex': { $ne: null },
      },
    },
    // Oldest first, so `$last` in the group below is the newest.
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: '$rounds.questionId',
        topicId: { $last: '$topicId' },
        lastCorrect: { $last: '$rounds.answers.isCorrect' },
        lastSeenAt: { $last: '$createdAt' },
        /** How many times it has been missed, ever — the deck's priority. */
        timesWrong: {
          $sum: { $cond: [{ $eq: ['$rounds.answers.isCorrect', false] }, 1, 0] },
        },
      },
    },
    { $match: { lastCorrect: false } },
  ];
}

/**
 * What is owed, grouped by topic — the deck's index screen.
 *
 * Grouped by topic because a match belongs to exactly one topic: `Match.topicId`
 * is what the mastery write, the assignment hook and the leaderboards all read.
 * A single deck mixing algebra and history would have to credit one topic with
 * the XP for both, which is a worse lie than making the player choose a subject.
 * Revision is per subject anyway.
 */
export async function mistakesByTopic(userId) {
  const owed = await Match.aggregate([
    ...outstandingMistakes({ userId }),
    { $project: { _id: 1, topicId: 1, lastSeenAt: 1 } },
  ]);
  if (!owed.length) return [];

  const topicIds = [...new Set(owed.map((r) => String(r.topicId)))];

  /**
   * Scoped to where this player can still actually play.
   *
   * The topic ids above come from their own match history, so nothing here can
   * reach another tenant's data — but history is permanent and membership is not.
   * A student who has left an organization would otherwise keep seeing its topics
   * in their deck forever, and every row would be a button that fails: the queue
   * resolves the topic through `resolvePlayableTopic`, which correctly refuses it.
   * Offering a drill that cannot start is worse than not offering it.
   *
   * The Public Arena is always in scope — nobody is a member of it and everybody
   * can play it.
   */
  // tenant-ok: this is the query that ESTABLISHES the scope — "which spaces is
  // this player in" is deliberately cross-space, and everything below is filtered
  // by its answer.
  const memberships = await SpaceMember.find(
    { userId: oid(userId), status: 'active' },
    { spaceId: 1 },
  ).lean();
  const reachable = new Set([
    String(publicSpaceId),
    ...memberships.map((m) => String(m.spaceId)),
  ]);
  /**
   * One question query and one topic query for the whole screen.
   *
   * The obvious shape here was a loop calling `mistakeQuestionIds` per topic,
   * which is correct and is an aggregation per topic — thirty round trips to draw
   * one list. Validating every owed question at once and grouping in memory costs
   * two queries whatever the player's history looks like.
   */
  const [live, topics] = await Promise.all([
    Question.find(
      { _id: { $in: owed.map((r) => r._id) }, status: QUESTION_STATUS.PUBLISHED },
      { _id: 1, topicIds: 1, origin: 1 },
    ).lean(),
    // tenant-ok: the ids come from this player's own match history and are then
    // intersected with their live memberships below, so the result is bounded by
    // both what they have played and where they can still play it.
    Topic.find(
      { _id: { $in: topicIds.map(oid) } },
      { name: 1, slug: 1, coverUrl: 1, spaceId: 1, questionSources: 1 },
    ).lean(),
  ]);

  const questionById = new Map(live.map((q) => [String(q._id), q]));
  const topicById = new Map(
    topics.filter((t) => reachable.has(String(t.spaceId))).map((t) => [String(t._id), t]),
  );
  /** Per topic, the banks it is allowed to draw from — the tenant boundary. */
  const originsByTopic = new Map(
    topics.map((t) => [String(t._id), allowedOriginsFor(t).map(String)]),
  );

  const tally = new Map();
  for (const row of owed) {
    const key = String(row.topicId);
    const question = questionById.get(String(row._id));
    /**
     * A mistake is a historical fact; a question bank is editable. Anything that
     * has since been unpublished, pulled out of this topic, or whose origin bank
     * this topic no longer draws from cannot be served — so it must not be
     * counted either. A deck offering "12 to revisit" that deals five and pads
     * the rest with questions you have never seen is worse than no deck.
     */
    if (!question) continue;
    if (!question.topicIds?.some((t) => String(t) === key)) continue;
    if (!(originsByTopic.get(key) ?? []).includes(String(question.origin))) continue;

    const agg = tally.get(key) ?? { count: 0, lastMissedAt: null };
    agg.count += 1;
    if (!agg.lastMissedAt || row.lastSeenAt > agg.lastMissedAt) agg.lastMissedAt = row.lastSeenAt;
    tally.set(key, agg);
  }

  return [...tally.entries()]
    .map(([topicId, agg]) => {
      const topic = topicById.get(topicId);
      if (!topic) return null;
      return {
        topic: {
          id: topicId,
          name: topic.name,
          slug: topic.slug,
          coverUrl: topic.coverUrl ?? null,
          spaceId: String(topic.spaceId),
        },
        count: agg.count,
        /** Whether there are enough to fill a whole drill without padding. */
        full: agg.count >= ROUNDS_PER_MATCH,
        lastMissedAt: agg.lastMissedAt,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.count - a.count || new Date(b.lastMissedAt) - new Date(a.lastMissedAt));
}

/**
 * The questions to deal for one topic's drill, hardest-earned first.
 *
 * Ordered by how often it has been missed, then by how long ago — a question
 * missed four times is the one that most needs the seat, and among equals the
 * stalest is the one the player is least likely to still be carrying in memory
 * from the match they just played.
 *
 * The published/topic/language re-check is not paranoia about the aggregation.
 * A mistake is a historical fact and a question bank is editable: the row it
 * refers to may since have been unpublished by moderation, rewritten, or removed
 * from this topic entirely, and serving any of those would be a leak in the same
 * way that serving another space's question would be.
 */
export async function mistakeQuestionIds(userId, topicId, { limit = ROUNDS_PER_MATCH, origins = null, language = null } = {}) {
  const rows = await Match.aggregate([
    ...outstandingMistakes({ userId, topicId }),
    { $sort: { timesWrong: -1, lastSeenAt: 1 } },
    { $limit: Math.max(1, Math.min(limit, 200)) },
    { $project: { _id: 1, timesWrong: 1 } },
  ]);
  if (!rows.length) return [];

  const rank = new Map(rows.map((r, i) => [String(r._id), i]));
  const live = await Question.find(
    {
      _id: { $in: rows.map((r) => r._id) },
      topicIds: oid(topicId),
      status: QUESTION_STATUS.PUBLISHED,
      ...(origins ? { origin: { $in: origins } } : {}),
      ...(language ? { [`content.${language}`]: { $exists: true } } : {}),
    },
    { _id: 1 },
  ).lean();

  // The aggregation's order is the one that matters, and an `$in` query does not
  // preserve it.
  return live
    .map((q) => String(q._id))
    .sort((a, b) => rank.get(a) - rank.get(b))
    .map((id) => oid(id));
}

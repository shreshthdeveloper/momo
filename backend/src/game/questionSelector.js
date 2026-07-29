import mongoose from 'mongoose';
import { Question, Match, publicSpaceId } from '../models/index.js';
import {
  ROUNDS_PER_MATCH,
  QUESTION_STATUS,
  DEFAULT_LANGUAGE,
} from '../shared/constants.js';
import { shuffle } from '../lib/crypto.js';

/**
 * Question selection (tech.md §9.1).
 *
 * The tenant boundary is enforced here and nowhere else on this path: the
 * origin list is derived from the topic document read server-side, never from
 * anything the client sent. A question whose origin is some third space
 * cannot enter the pool because no such origin is ever added to the filter.
 */

/**
 * prd.md F6.4.6 — difficulty is balanced across the match and weighted toward
 * the players' average skill. Every mix sums to ROUNDS_PER_MATCH.
 */
export function difficultyMixFor(avgRating) {
  if (avgRating < 1000) return { easy: 4, medium: 3, hard: 0 };
  if (avgRating < 1200) return { easy: 3, medium: 3, hard: 1 };
  if (avgRating < 1400) return { easy: 2, medium: 3, hard: 2 };
  if (avgRating < 1600) return { easy: 1, medium: 3, hard: 3 };
  return { easy: 1, medium: 2, hard: 4 };
}

/**
 * prd.md §5.1 rules 2 and 3. A Space topic may draw from the Central Bank,
 * its own Space Bank, or both — never from another Space's bank.
 */
export function allowedOriginsFor(topic) {
  const origins = [];
  if (topic.questionSources?.central) origins.push(publicSpaceId);
  if (topic.questionSources?.own) origins.push(topic.spaceId);
  // A topic with neither source configured is a misconfiguration, not an
  // invitation to widen the pool.
  return origins.filter(Boolean);
}

/**
 * When these players last saw each question — `questionId` → epoch ms.
 *
 * A Map rather than a Set, and that is the point. The exclusion below only ever
 * needs the keys, but the FALLBACK needs the values: once a topic's pool is
 * exhausted the exclusion cannot be honoured, and the only thing that makes the
 * repeat bearable is serving the question nobody has seen for longest. A Set
 * cannot answer that question, so the old version fell back to a uniform draw
 * in which a question from ten minutes ago was exactly as likely as one from
 * four weeks ago.
 *
 * `sort({ createdAt: -1 })` is not decoration. Without it the `limit(120)`
 * takes whatever 120 rows the chosen plan happens to emit first — the compound
 * index makes that newest-first *in practice*, but a plan change would silently
 * turn this into "the oldest 120 matches", which is the worst possible window
 * to exclude and would fail no test.
 */
export async function recentlySeenAt(userIds, days = 30) {
  if (!userIds?.length) return new Map();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await Match.find(
    { 'players.userId': { $in: userIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
      createdAt: { $gte: since } },
    { questionIds: 1, createdAt: 1 },
  )
    .sort({ createdAt: -1 })
    .limit(120)
    .lean();

  const seen = new Map();
  for (const row of rows) {
    const at = new Date(row.createdAt).getTime();
    for (const q of row.questionIds ?? []) {
      const key = String(q);
      // Rows arrive newest-first, so the first sighting of a key is the most
      // recent one. Keeping the max anyway costs nothing and survives a
      // caller that passes them in another order.
      if (!seen.has(key) || seen.get(key) < at) seen.set(key, at);
    }
  }
  return seen;
}

/** Question ids these players have seen recently, so matches do not repeat. */
export async function recentlySeenQuestionIds(userIds, days = 30) {
  const seen = await recentlySeenAt(userIds, days);
  return [...seen.keys()].map((id) => new mongoose.Types.ObjectId(id));
}

async function sampleByDifficulty({ topicId, origins, difficulty, count, exclude, language }) {
  if (count <= 0) return [];
  return Question.aggregate([
    {
      $match: {
        topicIds: topicId,
        origin: { $in: origins },
        status: QUESTION_STATUS.PUBLISHED,
        difficulty,
        [`content.${language}`]: { $exists: true },
        ...(exclude.length ? { _id: { $nin: exclude } } : {}),
      },
    },
    { $sample: { size: count } },
  ]);
}

/**
 * @returns {Promise<Array>} raw question documents, shuffled, length up to
 * ROUNDS_PER_MATCH. Throws only when the topic has no usable questions at all.
 */
export async function selectQuestions(topic, players, options = {}) {
  const {
    count = ROUNDS_PER_MATCH,
    language = DEFAULT_LANGUAGE,
    excludeSeen = true,
  } = options;

  const origins = allowedOriginsFor(topic);
  if (!origins.length) return [];

  const topicId = new mongoose.Types.ObjectId(String(topic._id));
  const userIds = (players ?? []).filter((p) => p?.userId && !p.isGhost).map((p) => p.userId);

  const seenAt = excludeSeen ? await recentlySeenAt(userIds, 30) : new Map();
  const seen = [...seenAt.keys()].map((id) => new mongoose.Types.ObjectId(id));
  const avgRating = players?.length
    ? players.reduce((sum, p) => sum + (p.rating ?? 1200), 0) / players.length
    : 1200;
  const mix = difficultyMixFor(avgRating);

  const picked = [];
  const pickedIds = new Set();
  const take = (docs) => {
    for (const doc of docs) {
      const id = String(doc._id);
      if (!pickedIds.has(id)) {
        pickedIds.add(id);
        picked.push(doc);
      }
    }
  };

  for (const [difficulty, want] of Object.entries(mix)) {
    take(
      await sampleByDifficulty({
        topicId,
        origins,
        difficulty,
        count: want,
        exclude: seen,
        language,
      }),
    );
  }

  // A difficulty tier may be thin. Backfill from any tier before relaxing the
  // "recently seen" constraint — a mistimed difficulty is a smaller problem
  // than a repeated question.
  if (picked.length < count) {
    take(
      await Question.aggregate([
        {
          $match: {
            topicIds: topicId,
            origin: { $in: origins },
            status: QUESTION_STATUS.PUBLISHED,
            [`content.${language}`]: { $exists: true },
            _id: { $nin: [...seen, ...[...pickedIds].map((id) => new mongoose.Types.ObjectId(id))] },
          },
        },
        { $sample: { size: count - picked.length } },
      ]),
    );
  }

  /**
   * tech.md §9.1 — if exclusion leaves too few, relax it rather than fail the
   * match. A repeated question is far better than no match.
   *
   * ── Which repeat, though ─────────────────────────────────────────────────
   *
   * This step used to `$sample` uniformly over everything, which made a
   * question served ten minutes ago exactly as likely as one served four weeks
   * ago. That is why repeats were so noticeable: a topic holds fifty questions
   * and a match spends seven, so the pool is exhausted after about seven plays
   * and EVERY match after that was drawn from this branch — at which point the
   * app was, in effect, choosing at random from everything the player had just
   * finished seeing.
   *
   * It now prefers whatever has gone longest unseen. Not strictly oldest-first,
   * which would make consecutive exhausted matches near-identical: the oldest
   * half of the candidates is shuffled and drawn from, so the choice is still
   * unpredictable while the recent handful stays out of it.
   */
  if (picked.length < count) {
    const need = count - picked.length;
    const candidates = await Question.find(
      {
        topicIds: topicId,
        origin: { $in: origins },
        status: QUESTION_STATUS.PUBLISHED,
        [`content.${language}`]: { $exists: true },
        _id: { $nin: [...pickedIds].map((id) => new mongoose.Types.ObjectId(id)) },
      },
      // Sorted in memory below, so the whole document is not needed to rank —
      // but it IS needed to serve, and a topic's pool is tens of rows, not
      // thousands. A projection plus a second fetch would cost more.
      null,
    ).lean();

    // Never seen sorts first (`-Infinity`), then oldest to newest.
    const ranked = candidates.sort(
      (a, b) =>
        (seenAt.get(String(a._id)) ?? -Infinity) - (seenAt.get(String(b._id)) ?? -Infinity),
    );
    const staleHalf = ranked.slice(0, Math.max(need, Math.ceil(ranked.length / 2)));
    take(shuffle(staleHalf).slice(0, need));
  }

  return shuffle(picked).slice(0, count);
}

/**
 * Turn a stored question into the per-match round definition.
 *
 * tech.md §9.1 — option order is shuffled per match and `correctIndex`
 * remapped, so position is never a tell across repeated plays. `optionOrder`
 * keeps the mapping back to canonical indices, which item analysis needs and
 * which ghost replays need to stay correct under a different shuffle.
 */
export function buildRound(questionDoc, { language = DEFAULT_LANGUAGE, durationMs }) {
  const content =
    questionDoc.content?.[language] ??
    questionDoc.content?.[questionDoc.defaultLanguage] ??
    questionDoc.content?.[DEFAULT_LANGUAGE];

  if (!content) throw new Error(`Question ${questionDoc._id} has no usable content`);

  const positions = shuffle(content.options.map((_, i) => i));
  const options = positions.map((canonical) => content.options[canonical]);
  const correctIndex = positions.indexOf(questionDoc.correctIndex);

  return {
    questionId: questionDoc._id,
    text: content.text,
    imageUrl: questionDoc.imageUrl ?? null,
    options,
    /** Position within the shuffled options. Never leaves the server pre-resolution. */
    correctIndex,
    /** optionOrder[shownPosition] = canonical index */
    optionOrder: positions,
    canonicalCorrectIndex: questionDoc.correctIndex,
    explanation: content.explanation ?? null,
    difficulty: questionDoc.difficulty,
    durationMs: questionDoc.timeLimitOverrideMs ?? durationMs,
  };
}

/** canonical option index → the position it occupies in this match. */
export function canonicalToShown(round, canonicalIndex) {
  if (canonicalIndex === null || canonicalIndex === undefined) return null;
  const idx = round.optionOrder.indexOf(canonicalIndex);
  return idx === -1 ? null : idx;
}

/** position shown in this match → canonical option index. */
export function shownToCanonical(round, shownIndex) {
  if (shownIndex === null || shownIndex === undefined) return null;
  return round.optionOrder[shownIndex] ?? null;
}

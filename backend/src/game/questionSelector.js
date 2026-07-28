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

/** Question ids these players have seen recently, so matches do not repeat. */
export async function recentlySeenQuestionIds(userIds, days = 30) {
  if (!userIds?.length) return [];
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await Match.find(
    { 'players.userId': { $in: userIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
      createdAt: { $gte: since } },
    { questionIds: 1 },
  )
    .limit(120)
    .lean();
  const seen = new Set();
  for (const row of rows) for (const q of row.questionIds ?? []) seen.add(String(q));
  return [...seen].map((id) => new mongoose.Types.ObjectId(id));
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

  const seen = excludeSeen ? await recentlySeenQuestionIds(userIds, 30) : [];
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

  // tech.md §9.1 — if exclusion leaves too few, relax it rather than fail the
  // match. A repeated question is far better than no match.
  if (picked.length < count) {
    take(
      await Question.aggregate([
        {
          $match: {
            topicIds: topicId,
            origin: { $in: origins },
            status: QUESTION_STATUS.PUBLISHED,
            [`content.${language}`]: { $exists: true },
            _id: { $nin: [...pickedIds].map((id) => new mongoose.Types.ObjectId(id)) },
          },
        },
        { $sample: { size: count - picked.length } },
      ]),
    );
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

import mongoose from 'mongoose';
import { Question, Topic } from '../models/index.js';
import { validateQuestionInput, findDuplicates } from './questionService.js';
import { assertPermission } from './spaceService.js';
import { env } from '../config/env.js';
import { contentHashOf } from '../lib/crypto.js';
import { BadRequestError, NotFoundError, AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import {
  QUESTION_STATUS,
  DIFFICULTY,
  OPTIONS_PER_QUESTION,
  QUESTION_TEXT_SOFT_MAX,
  DEFAULT_LANGUAGE,
} from '../shared/constants.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * AI-assisted drafting (prd.md F8.2.6).
 *
 * The requirement has one hard edge: **nothing goes live without explicit human
 * approval.** So this file can only ever produce documents in `in_review`, and
 * it does not have — and must not be given — a path to `published`. Publishing
 * stays behind the `publishQuestions` permission, exactly as it is for a
 * question an admin typed by hand.
 *
 * Two more decisions worth naming:
 *
 * - **No key, no drafts.** Without `ANTHROPIC_API_KEY` this refuses and says
 *   which setting is missing. The tempting alternative — a local generator that
 *   invents plausible-looking questions — would fill an organization's review
 *   queue with confident nonsense, and a reviewer skimming forty drafts is
 *   exactly the person who would let it through.
 * - **Every draft is validated as if a human wrote it.** The model's output
 *   goes through the same `validateQuestionInput` as the editor, plus the
 *   quality rules in prd.md §10.2, plus duplicate detection. A rejected draft
 *   is reported with its reason rather than silently dropped, because the
 *   pattern in the rejections is what tells an admin to change the prompt.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/** The model must answer through this shape. No prose, no markdown fences. */
const DRAFT_TOOL = {
  name: 'submit_questions',
  description: 'Submit the drafted multiple-choice questions.',
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The question. Under 140 characters.' },
            options: {
              type: 'array',
              items: { type: 'string' },
              minItems: OPTIONS_PER_QUESTION,
              maxItems: OPTIONS_PER_QUESTION,
            },
            correctIndex: { type: 'integer', minimum: 0, maximum: OPTIONS_PER_QUESTION - 1 },
            difficulty: { type: 'string', enum: Object.values(DIFFICULTY) },
            explanation: { type: 'string', description: 'One or two sentences. Why that answer.' },
          },
          required: ['text', 'options', 'correctIndex', 'difficulty'],
        },
      },
    },
    required: ['questions'],
  },
};

/**
 * The rules are the PRD's own content rules, stated as constraints rather than
 * suggestions — a model given "prefer short options" writes long ones.
 */
function buildPrompt({ topicName, topicDescription, difficulty, count, notes, existingTexts }) {
  const lines = [
    `Write ${count} multiple-choice questions for a fast-paced quiz game on the topic "${topicName}".`,
    topicDescription ? `Topic description: ${topicDescription}` : null,
    difficulty === 'mixed'
      ? 'Mix the difficulty: roughly a third easy, a third medium, a third hard.'
      : `Every question should be ${difficulty} difficulty.`,
    '',
    'Hard constraints. A question that breaks any of these is unusable:',
    `- Exactly ${OPTIONS_PER_QUESTION} options, exactly one correct.`,
    `- The question text must be under ${QUESTION_TEXT_SOFT_MAX} characters. Players read it under a ten-second timer.`,
    '- Options must be mutually exclusive and similar in length. A conspicuously longer correct option is a tell.',
    '- Never use "all of the above", "none of the above", or "both A and B".',
    '- No question whose answer changes over time unless the text carries a date qualifier.',
    '- Every fact must be one you are confident is correct. A wrong answer key is worse than a missing question.',
    '- Include a one-sentence explanation. Post-match review is where the learning happens.',
    '',
    'Audience: students in India, roughly 15 to 25. Write in plain English.',
  ];

  if (notes) lines.push('', `Additional instruction from the organization: ${notes}`);

  if (existingTexts.length) {
    lines.push(
      '',
      'These questions already exist in this topic. Do not repeat them or ask the same fact a different way:',
      ...existingTexts.slice(0, 40).map((t) => `- ${t}`),
    );
  }

  return lines.filter((l) => l !== null).join('\n');
}

async function callModel({ prompt, count }) {
  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: env.AI_MODEL,
      max_tokens: Math.min(8000, 400 * count + 1000),
      tools: [DRAFT_TOOL],
      tool_choice: { type: 'tool', name: DRAFT_TOOL.name },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error({ status: response.status, body: body.slice(0, 500) }, 'AI draft request failed');
    // The admin can act on "the key is wrong" and on "try again"; they cannot
    // act on an upstream stack trace, so they are not shown one.
    if (response.status === 401 || response.status === 403) {
      throw new AppError(502, 'AI_UNAVAILABLE', 'The AI key was rejected. Check ANTHROPIC_API_KEY.');
    }
    if (response.status === 429) {
      throw new AppError(429, 'AI_RATE_LIMITED', 'The AI service is busy. Try again in a minute.');
    }
    throw new AppError(502, 'AI_UNAVAILABLE', 'The AI service did not respond. Try again.');
  }

  const payload = await response.json();
  const toolUse = payload.content?.find((block) => block.type === 'tool_use');
  if (!toolUse?.input?.questions?.length) {
    throw new AppError(502, 'AI_EMPTY', 'The AI returned nothing usable. Try again.');
  }
  return toolUse.input.questions;
}

// ── The public call ────────────────────────────────────────────────────────

export async function draftQuestions(scope, actor, input) {
  assertPermission(scope, 'createQuestions');

  if (!env.ANTHROPIC_API_KEY) {
    throw new AppError(
      503,
      'AI_NOT_CONFIGURED',
      'AI drafting is not switched on. Set ANTHROPIC_API_KEY on the server, then reload this page.',
    );
  }

  const topic = await Topic.findOne({ _id: oid(input.topicId), spaceId: scope.spaceId }).lean();
  if (!topic) throw new NotFoundError('That topic is not in this space.', 'TOPIC_NOT_IN_SPACE');

  const count = Math.min(env.AI_MAX_DRAFTS_PER_REQUEST, Math.max(1, Number(input.count) || 10));
  const difficulty = ['easy', 'medium', 'hard', 'mixed'].includes(input.difficulty)
    ? input.difficulty
    : 'mixed';
  const language = input.language ?? DEFAULT_LANGUAGE;

  // Showing the model what already exists is the cheapest duplicate prevention
  // there is — far cheaper than detecting duplicates afterwards and throwing
  // half the batch away.
  const existing = await Question.find(
    { topicIds: topic._id, origin: scope.spaceId, status: { $ne: QUESTION_STATUS.ARCHIVED } },
    { content: 1, defaultLanguage: 1 },
  )
    .sort({ createdAt: -1 })
    .limit(40)
    .lean();

  const existingTexts = existing
    .map((q) => q.content?.[q.defaultLanguage ?? language]?.text)
    .filter(Boolean);

  const prompt = buildPrompt({
    topicName: topic.name,
    topicDescription: topic.description,
    difficulty,
    count,
    notes: input.notes,
    existingTexts,
  });

  const drafts = await callModel({ prompt, count });

  const accepted = [];
  const rejected = [];

  for (const draft of drafts.slice(0, count)) {
    const candidate = {
      text: String(draft.text ?? '').trim(),
      options: (draft.options ?? []).map((o) => String(o ?? '').trim()),
      correctIndex: Number(draft.correctIndex),
      difficulty: Object.values(DIFFICULTY).includes(draft.difficulty)
        ? draft.difficulty
        : DIFFICULTY.MEDIUM,
      explanation: draft.explanation ? String(draft.explanation).trim() : undefined,
      topicIds: [String(topic._id)],
    };

    const check = validateQuestionInput(candidate, { language });
    if (!check.valid) {
      rejected.push({ text: candidate.text, reason: check.problems[0]?.problem ?? 'Failed validation.' });
      continue;
    }

    const duplicates = await findDuplicates({
      scope,
      text: candidate.text,
      options: candidate.options,
      topicIds: [String(topic._id)],
    });
    if (duplicates.length) {
      rejected.push({ text: candidate.text, reason: 'This question already exists in the topic.' });
      continue;
    }

    // Also reject against the rest of THIS batch. The model occasionally asks
    // the same fact twice in one response, and importing both would put two
    // near-identical questions in the review queue.
    const hash = contentHashOf(candidate.text, candidate.options);
    if (accepted.some((a) => a.hash === hash)) {
      rejected.push({ text: candidate.text, reason: 'Duplicated within this batch.' });
      continue;
    }

    accepted.push({ ...candidate, hash, warnings: check.warnings });
  }

  if (!accepted.length) {
    return {
      created: [],
      rejected,
      /** design.md §10 — say what happened and what to do next. */
      message: 'Nothing in that batch was usable. Try a narrower instruction, or a different difficulty.',
    };
  }

  const created = await Question.insertMany(
    accepted.map((a) => ({
      // The origin is the resolved scope. An AI draft is subject to exactly the
      // same tenant rule as anything else written here.
      origin: scope.spaceId,
      topicIds: [topic._id],
      content: {
        [language]: { text: a.text, options: a.options, explanation: a.explanation },
      },
      defaultLanguage: language,
      correctIndex: a.correctIndex,
      difficulty: a.difficulty,
      tags: ['ai-draft'],
      /**
       * prd.md F8.2.6 — "generated questions land in a review queue. Nothing
       * goes live without explicit human approval." This is the line that
       * enforces it, and it is deliberately not configurable.
       */
      status: QUESTION_STATUS.IN_REVIEW,
      source: 'ai',
      contentHash: a.hash,
      createdBy: oid(actor._id),
      searchText: [a.text, ...a.options].join(' • '),
    })),
    { ordered: false },
  );

  logger.info(
    { spaceId: String(scope.spaceId), topicId: String(topic._id), created: created.length, rejected: rejected.length },
    'ai drafts created',
  );

  return {
    created: created.map((q) => ({
      id: String(q._id),
      text: q.content?.get?.(language)?.text ?? q.content?.[language]?.text,
      difficulty: q.difficulty,
      status: q.status,
    })),
    rejected,
    message: `${created.length} ${created.length === 1 ? 'draft' : 'drafts'} added to review.${
      rejected.length ? ` ${rejected.length} discarded.` : ''
    }`,
  };
}

/** Whether the portal should offer the button at all. */
export function aiDraftingStatus() {
  return {
    available: Boolean(env.ANTHROPIC_API_KEY),
    model: env.ANTHROPIC_API_KEY ? env.AI_MODEL : null,
    maxPerRequest: env.AI_MAX_DRAFTS_PER_REQUEST,
    reason: env.ANTHROPIC_API_KEY ? null : 'ANTHROPIC_API_KEY is not set on the server.',
  };
}

/**
 * The review queue itself (prd.md F8.2.8). Drafts from any source, oldest
 * first — a queue sorted newest-first is a queue whose bottom never gets read.
 */
export async function reviewQueue(scope, { source, limit = 50 } = {}) {
  const filter = {
    origin: scope.spaceId,
    status: QUESTION_STATUS.IN_REVIEW,
  };
  if (source) filter.source = source;

  const [rows, total, aiPending] = await Promise.all([
    Question.find(filter)
      .sort({ createdAt: 1 })
      .limit(Math.min(limit, 100))
      .populate('topicIds', 'name')
      .populate('createdBy', 'displayName')
      .lean(),
    Question.countDocuments(filter),
    Question.countDocuments({ ...filter, source: 'ai' }),
  ]);

  return {
    total,
    aiPending,
    items: rows.map((q) => {
      const content = q.content?.[q.defaultLanguage ?? DEFAULT_LANGUAGE] ?? {};
      return {
        id: String(q._id),
        text: content.text ?? '',
        options: content.options ?? [],
        explanation: content.explanation ?? null,
        correctIndex: q.correctIndex,
        difficulty: q.difficulty,
        /**
         * A picture question carries its subject in the image — "which emblem
         * is this?" is unanswerable without it. Omitting this from the review
         * payload meant a reviewer approving a picture question saw four
         * options and no picture, which is not reviewing it, it is guessing.
         */
        imageUrl: q.imageUrl ?? null,
        /** The clock this question is answered against, when it overrides. */
        timeLimitOverrideMs: q.timeLimitOverrideMs ?? null,
        source: q.source,
        topics: (q.topicIds ?? []).map((t) => (t?.name ? t.name : String(t))),
        createdBy: q.createdBy?.displayName ?? null,
        createdAt: q.createdAt,
      };
    }),
  };
}

/**
 * Approve or reject a whole batch in one call, because a reviewer working
 * through forty AI drafts should not make forty round trips.
 *
 * Gated on `publishQuestions` when approving — a sub-admin who may draft is not
 * thereby someone who may publish (prd.md F8.2.8).
 */
export async function reviewBatch(scope, actor, { ids, action, note }) {
  if (!['publish', 'archive', 'draft'].includes(action)) {
    throw new BadRequestError('Unknown review action.');
  }
  if (action === 'publish') assertPermission(scope, 'publishQuestions');
  else assertPermission(scope, 'createQuestions');

  const objectIds = (ids ?? []).filter((id) => mongoose.isValidObjectId(id)).map(oid);
  if (!objectIds.length) throw new BadRequestError('Select at least one question.');

  const status =
    action === 'publish'
      ? QUESTION_STATUS.PUBLISHED
      : action === 'archive'
        ? QUESTION_STATUS.ARCHIVED
        : QUESTION_STATUS.DRAFT;

  // Scoped by `origin`, so a batch of ids from another space matches nothing
  // rather than being reviewed by the wrong organization.
  const affected = await Question.find(
    { _id: { $in: objectIds }, origin: scope.spaceId },
    { topicIds: 1 },
  ).lean();

  await Question.updateMany(
    { _id: { $in: objectIds }, origin: scope.spaceId },
    {
      $set: {
        status,
        reviewedBy: oid(actor._id),
        reviewedAt: new Date(),
        ...(note ? { reviewNote: note } : {}),
      },
    },
  );

  const { recountTopics } = await import('./questionService.js');
  const topicIds = [...new Set(affected.flatMap((q) => q.topicIds.map(String)))].map(oid);
  if (topicIds.length) await recountTopics(topicIds);

  return { updated: affected.length, status };
}

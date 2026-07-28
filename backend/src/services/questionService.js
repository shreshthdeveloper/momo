import mongoose from 'mongoose';
import { Question, Topic, AuditLog, publicSpaceId, isPublicSpace } from '../models/index.js';
import {
  QUESTION_STATUS,
  DIFFICULTY,
  OPTIONS_PER_QUESTION,
  QUESTION_TEXT_HARD_MAX,
  QUESTION_TEXT_SOFT_MAX,
  OPTION_TEXT_MAX,
  MIN_PUBLISHED_QUESTIONS_TO_LIVE,
  DEFAULT_LANGUAGE,
} from '../shared/constants.js';
import { contentHashOf } from '../lib/crypto.js';
import { BadRequestError, NotFoundError, ForbiddenError, ConflictError } from '../lib/errors.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * The question bank (prd.md §8.2).
 *
 * Every function takes a resolved `scope` and filters by `scope.spaceId`. The
 * one deliberate exception is the central-bank browser (F8.2.9), which reads
 * `origin: publicSpaceId` and is explicitly read-only — a central question can
 * be forked into a space bank, never edited in place.
 */

// ── Validation (prd.md §10.2) ──────────────────────────────────────────────

const BANNED_OPTION_PATTERNS = [/^all of the above$/i, /^none of the above$/i, /^both a and b$/i];

export function validateQuestionInput(input, { language = DEFAULT_LANGUAGE } = {}) {
  const problems = [];
  const text = String(input.text ?? '').trim();
  const options = (input.options ?? []).map((o) => String(o ?? '').trim());

  if (!text) problems.push({ field: 'text', problem: 'Question text is required.' });
  if (text.length > QUESTION_TEXT_HARD_MAX) {
    problems.push({
      field: 'text',
      problem: `Keep it under ${QUESTION_TEXT_HARD_MAX} characters — nobody can read more in ten seconds.`,
    });
  }

  if (options.length !== OPTIONS_PER_QUESTION) {
    problems.push({ field: 'options', problem: `Exactly ${OPTIONS_PER_QUESTION} options are required.` });
  }
  options.forEach((option, i) => {
    if (!option) problems.push({ field: `options.${i}`, problem: 'This option is empty.' });
    if (option.length > OPTION_TEXT_MAX) {
      problems.push({ field: `options.${i}`, problem: `Keep options under ${OPTION_TEXT_MAX} characters.` });
    }
    if (BANNED_OPTION_PATTERNS.some((re) => re.test(option))) {
      problems.push({
        field: `options.${i}`,
        problem: 'No "all of the above" or "none of the above" — they do not work under a timer.',
      });
    }
  });

  const unique = new Set(options.map((o) => o.toLowerCase()));
  if (options.length && unique.size !== options.length) {
    problems.push({ field: 'options', problem: 'Two options are identical.' });
  }

  const correctIndex = Number(input.correctIndex);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= OPTIONS_PER_QUESTION) {
    problems.push({ field: 'correctIndex', problem: 'Mark exactly one option correct.' });
  }

  if (input.difficulty && !Object.values(DIFFICULTY).includes(input.difficulty)) {
    problems.push({ field: 'difficulty', problem: 'Difficulty must be easy, medium or hard.' });
  }

  if (!input.topicIds?.length) {
    problems.push({ field: 'topicIds', problem: 'Assign the question to at least one topic.' });
  }

  // prd.md §10.2 — a conspicuously longer correct option is a tell. A warning
  // rather than an error; some correct answers really are longer.
  const warnings = [];
  if (options.length === OPTIONS_PER_QUESTION && Number.isInteger(correctIndex)) {
    const lengths = options.map((o) => o.length);
    const correctLength = lengths[correctIndex];
    const othersMax = Math.max(...lengths.filter((_, i) => i !== correctIndex));
    if (correctLength > othersMax * 1.8 && correctLength - othersMax > 12) {
      warnings.push({
        field: `options.${correctIndex}`,
        problem: 'The correct option is much longer than the others — that is a tell.',
      });
    }
  }
  if (text.length > QUESTION_TEXT_SOFT_MAX && text.length <= QUESTION_TEXT_HARD_MAX) {
    warnings.push({
      field: 'text',
      problem: `Over ${QUESTION_TEXT_SOFT_MAX} characters — this will render at a smaller size.`,
    });
  }

  return { valid: problems.length === 0, problems, warnings, language };
}

// ── Duplicate detection (prd.md F8.2.7) ────────────────────────────────────

export async function findDuplicates({ scope, text, options, topicIds, excludeId }) {
  const hash = contentHashOf(text, options);
  const filter = {
    contentHash: hash,
    origin: scope.spaceId,
    status: { $ne: QUESTION_STATUS.ARCHIVED },
    ...(excludeId ? { _id: { $ne: oid(excludeId) } } : {}),
    ...(topicIds?.length ? { topicIds: { $in: topicIds.map(oid) } } : {}),
  };
  const matches = await Question.find(filter).limit(5).lean();
  return matches.map((q) => ({
    id: String(q._id),
    text: q.content?.[q.defaultLanguage]?.text ?? '',
    status: q.status,
  }));
}

// ── CRUD ───────────────────────────────────────────────────────────────────

async function assertTopicsInScope(scope, topicIds) {
  const topics = await Topic.find(
    { _id: { $in: topicIds.map(oid) }, spaceId: scope.spaceId },
    { _id: 1 },
  ).lean();
  if (topics.length !== topicIds.length) {
    throw new ForbiddenError('One of those topics is not in this space.', 'TOPIC_OUT_OF_SCOPE');
  }
  return topics;
}

export async function createQuestion(scope, actor, input) {
  const language = input.language ?? DEFAULT_LANGUAGE;
  const result = validateQuestionInput(input, { language });
  if (!result.valid) {
    throw new BadRequestError('Fix the highlighted fields.', 'VALIDATION_FAILED', result.problems);
  }

  await assertTopicsInScope(scope, input.topicIds);

  const duplicates = await findDuplicates({
    scope,
    text: input.text,
    options: input.options,
    topicIds: input.topicIds,
  });
  if (duplicates.length && !input.allowDuplicate) {
    throw new ConflictError('A very similar question already exists in this topic.', 'DUPLICATE_QUESTION', {
      duplicates,
    });
  }

  const question = await Question.create({
    // The origin is the resolved scope, never anything the client sent.
    origin: scope.spaceId,
    topicIds: input.topicIds.map(oid),
    content: {
      [language]: {
        text: input.text.trim(),
        options: input.options.map((o) => String(o).trim()),
        explanation: input.explanation?.trim() || undefined,
      },
    },
    defaultLanguage: language,
    correctIndex: input.correctIndex,
    difficulty: input.difficulty ?? DIFFICULTY.MEDIUM,
    tags: (input.tags ?? []).map((t) => String(t).toLowerCase().trim()).filter(Boolean),
    imageUrl: input.imageUrl,
    timeLimitOverrideMs: input.timeLimitOverrideMs ?? null,
    status: input.status === QUESTION_STATUS.PUBLISHED ? QUESTION_STATUS.PUBLISHED : (input.status ?? QUESTION_STATUS.DRAFT),
    contentHash: contentHashOf(input.text, input.options),
    source: input.source ?? 'manual',
    createdBy: oid(actor._id),
    ...(input.status === QUESTION_STATUS.PUBLISHED
      ? { reviewedBy: oid(actor._id), reviewedAt: new Date() }
      : {}),
  });

  if (question.status === QUESTION_STATUS.PUBLISHED) {
    await recountTopics(question.topicIds);
  }

  await audit(scope, actor, 'question.create', question._id, question.content.get(language)?.text);
  return { question, warnings: result.warnings };
}

export async function updateQuestion(scope, actor, questionId, input) {
  const question = await Question.findOne({ _id: oid(questionId), origin: scope.spaceId });
  if (!question) throw new NotFoundError('That question does not exist.');

  const language = input.language ?? question.defaultLanguage ?? DEFAULT_LANGUAGE;
  const existing = question.content.get(language);

  const merged = {
    text: input.text ?? existing?.text,
    options: input.options ?? existing?.options,
    correctIndex: input.correctIndex ?? question.correctIndex,
    difficulty: input.difficulty ?? question.difficulty,
    topicIds: input.topicIds ?? question.topicIds.map(String),
  };

  const result = validateQuestionInput(merged, { language });
  if (!result.valid) {
    throw new BadRequestError('Fix the highlighted fields.', 'VALIDATION_FAILED', result.problems);
  }

  if (input.topicIds) await assertTopicsInScope(scope, input.topicIds);

  const previousTopicIds = [...question.topicIds];
  const wasPublished = question.status === QUESTION_STATUS.PUBLISHED;

  question.content.set(language, {
    text: merged.text.trim(),
    options: merged.options.map((o) => String(o).trim()),
    explanation:
      input.explanation !== undefined ? input.explanation?.trim() || undefined : existing?.explanation,
  });
  question.markModified('content');
  question.correctIndex = merged.correctIndex;
  question.difficulty = merged.difficulty;
  if (input.topicIds) question.topicIds = input.topicIds.map(oid);
  if (input.tags) question.tags = input.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean);
  if (input.imageUrl !== undefined) question.imageUrl = input.imageUrl;
  if (input.timeLimitOverrideMs !== undefined) question.timeLimitOverrideMs = input.timeLimitOverrideMs;
  if (input.status) question.status = input.status;
  question.contentHash = contentHashOf(merged.text, merged.options);
  await question.save();

  if (wasPublished || question.status === QUESTION_STATUS.PUBLISHED) {
    await recountTopics([...new Set([...previousTopicIds, ...question.topicIds].map(String))].map(oid));
  }

  await audit(scope, actor, 'question.update', question._id, merged.text);
  return { question, warnings: result.warnings };
}

/**
 * prd.md F8.2.8 — draft → in review → published → archived. Publishing may be
 * restricted to the Admin, which the route enforces via the granular
 * `publishQuestions` permission.
 */
export async function setQuestionStatus(scope, actor, questionId, status, note) {
  if (!Object.values(QUESTION_STATUS).includes(status)) {
    throw new BadRequestError('Unknown status.');
  }
  const question = await Question.findOne({ _id: oid(questionId), origin: scope.spaceId });
  if (!question) throw new NotFoundError('That question does not exist.');

  const before = [...question.topicIds];
  question.status = status;
  if (status === QUESTION_STATUS.PUBLISHED || status === QUESTION_STATUS.ARCHIVED) {
    question.reviewedBy = oid(actor._id);
    question.reviewedAt = new Date();
  }
  if (note) question.reviewNote = note;
  await question.save();

  await recountTopics(before);
  await audit(scope, actor, `question.${status}`, question._id);
  return question;
}

/** prd.md F8.2.4 — hard delete only for questions never served in a match. */
export async function deleteQuestion(scope, actor, questionId) {
  const question = await Question.findOne({ _id: oid(questionId), origin: scope.spaceId });
  if (!question) throw new NotFoundError('That question does not exist.');

  if (question.servedEver || question.stats?.served > 0) {
    question.status = QUESTION_STATUS.ARCHIVED;
    await question.save();
    await recountTopics(question.topicIds);
    await audit(scope, actor, 'question.archive', question._id);
    return { archived: true, deleted: false };
  }

  const topicIds = [...question.topicIds];
  await question.deleteOne();
  await recountTopics(topicIds);
  await audit(scope, actor, 'question.delete', questionId);
  return { archived: false, deleted: true };
}

export async function duplicateQuestion(scope, actor, questionId) {
  const source = await Question.findOne({ _id: oid(questionId), origin: scope.spaceId }).lean();
  if (!source) throw new NotFoundError('That question does not exist.');

  const copy = await Question.create({
    ...source,
    _id: undefined,
    status: QUESTION_STATUS.DRAFT,
    stats: { served: 0, correctCount: 0, avgResponseMs: 0, optionCounts: [0, 0, 0, 0], timeoutCount: 0 },
    servedEver: false,
    reportCount: 0,
    reviewedBy: null,
    reviewedAt: null,
    createdBy: oid(actor._id),
    createdAt: undefined,
    updatedAt: undefined,
  });
  await audit(scope, actor, 'question.duplicate', copy._id);
  return copy;
}

/**
 * prd.md F8.2.9 — central questions are read-only, but may be forked into the
 * Space bank and edited. The fork is a genuine copy with `forkedFrom` set, so
 * the provenance survives (and prd.md Q6 has somewhere to land).
 */
export async function forkFromCentral(scope, actor, questionId, topicIds) {
  if (isPublicSpace(scope.spaceId)) {
    throw new BadRequestError('Central questions are already in this bank.');
  }
  const source = await Question.findOne({
    _id: oid(questionId),
    origin: publicSpaceId,
    status: QUESTION_STATUS.PUBLISHED,
  }).lean();
  if (!source) throw new NotFoundError('That central question does not exist.');

  await assertTopicsInScope(scope, topicIds);

  const forked = await Question.create({
    ...source,
    _id: undefined,
    origin: scope.spaceId,
    topicIds: topicIds.map(oid),
    forkedFrom: source._id,
    status: QUESTION_STATUS.DRAFT,
    stats: { served: 0, correctCount: 0, avgResponseMs: 0, optionCounts: [0, 0, 0, 0], timeoutCount: 0 },
    servedEver: false,
    reportCount: 0,
    createdBy: oid(actor._id),
    reviewedBy: null,
    reviewedAt: null,
    createdAt: undefined,
    updatedAt: undefined,
  });

  await audit(scope, actor, 'question.fork', forked._id, `forked from ${source._id}`);
  return forked;
}

// ── Listing ────────────────────────────────────────────────────────────────

/** Allow-list, so a caller cannot sort by an arbitrary path. */
const ALLOWED_SORTS = new Set([
  '-updatedAt',
  'updatedAt',
  '-createdAt',
  'createdAt',
  '-stats.served',
  'stats.served',
  'difficulty',
  'status',
]);

export async function listQuestions(scope, rawFilters = {}) {
  // Coerce every scalar filter to a primitive before it can reach a query.
  // Belt and braces alongside the route schemas — a filter value must never be
  // an object, because an object is where `{ $ne: null }` lives.
  const str = (v) => (v === undefined || v === null ? undefined : String(v));
  const filters = {
    topicId: str(rawFilters.topicId),
    difficulty: str(rawFilters.difficulty),
    status: str(rawFilters.status),
    tag: str(rawFilters.tag),
    createdBy: str(rawFilters.createdBy),
    q: str(rawFilters.q),
    from: str(rawFilters.from),
    to: str(rawFilters.to),
    page: Number(rawFilters.page) || 0,
    pageSize: Number(rawFilters.pageSize) || 25,
    sort: ALLOWED_SORTS.has(String(rawFilters.sort)) ? String(rawFilters.sort) : '-updatedAt',
    origin: rawFilters.origin === 'central' ? 'central' : 'own',
  };

  const {
    topicId,
    difficulty,
    status,
    tag,
    createdBy,
    q,
    from,
    to,
    page,
    pageSize,
    sort,
    origin,
  } = filters;

  const filter = {
    // F8.2.9 — the central browser is the only view that reads another origin,
    // and it is read-only.
    origin: origin === 'central' ? publicSpaceId : scope.spaceId,
  };
  if (topicId && mongoose.isValidObjectId(topicId)) filter.topicIds = oid(topicId);
  if (difficulty) filter.difficulty = difficulty;
  if (status) filter.status = status;
  else if (origin === 'central') filter.status = QUESTION_STATUS.PUBLISHED;
  if (tag) filter.tags = String(tag).toLowerCase();
  if (createdBy && mongoose.isValidObjectId(createdBy)) filter.createdBy = oid(createdBy);
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }
  // F8.2.2 — full-text across question and option text, via the denormalised
  // searchText field so it works across every language at once.
  if (q) filter.$text = { $search: String(q) };

  const size = Math.min(Number(pageSize) || 25, 100);
  const skip = (Number(page) || 0) * size;

  const [rows, total] = await Promise.all([
    Question.find(filter)
      .sort(q ? { score: { $meta: 'textScore' } } : sort)
      .skip(skip)
      .limit(size)
      .populate('topicIds', 'name slug')
      .populate('createdBy', 'displayName')
      .lean(),
    Question.countDocuments(filter),
  ]);

  return {
    total,
    page: Number(page) || 0,
    pageSize: size,
    items: rows.map((row) => shapeQuestionRow(row)),
  };
}

export function shapeQuestionRow(row) {
  const language = row.defaultLanguage ?? DEFAULT_LANGUAGE;
  const content = row.content?.[language] ?? Object.values(row.content ?? {})[0] ?? {};
  return {
    id: String(row._id),
    text: content.text ?? '',
    options: content.options ?? [],
    explanation: content.explanation ?? null,
    languages: Object.keys(row.content ?? {}),
    defaultLanguage: language,
    correctIndex: row.correctIndex,
    difficulty: row.difficulty,
    status: row.status,
    tags: row.tags ?? [],
    imageUrl: row.imageUrl ?? null,
    timeLimitOverrideMs: row.timeLimitOverrideMs ?? null,
    topics: (row.topicIds ?? []).map((t) =>
      t?.name ? { id: String(t._id), name: t.name, slug: t.slug } : { id: String(t) },
    ),
    createdBy: row.createdBy?.displayName ?? null,
    stats: row.stats,
    itemAnalysis: itemAnalysisFor(row),
    servedEver: row.servedEver,
    reportCount: row.reportCount ?? 0,
    forkedFrom: row.forkedFrom ? String(row.forkedFrom) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * prd.md F8.2.10 — automatically flags questions where under 20% choose the
 * marked-correct option (likely a wrong answer key) or over 95% do (too easy
 * to discriminate).
 */
export function itemAnalysisFor(row) {
  const served = row.stats?.served ?? 0;
  if (served < 10) return { sampleSize: served, flag: null };

  const counts = row.stats?.optionCounts ?? [0, 0, 0, 0];
  const answered = counts.reduce((a, b) => a + b, 0);
  if (!answered) return { sampleSize: served, flag: null };

  const pCorrect = (counts[row.correctIndex] ?? 0) / answered;

  let flag = null;
  if (pCorrect < 0.2) flag = 'suspect_key';
  else if (pCorrect > 0.95) flag = 'too_easy';

  return {
    sampleSize: served,
    percentCorrect: Number((pCorrect * 100).toFixed(1)),
    avgResponseMs: row.stats?.avgResponseMs ?? 0,
    optionDistribution: counts.map((c) => (answered ? Number(((c / answered) * 100).toFixed(1)) : 0)),
    timeoutRate: served ? Number((((row.stats?.timeoutCount ?? 0) / (served * 2)) * 100).toFixed(1)) : 0,
    flag,
    flagLabel:
      flag === 'suspect_key'
        ? 'Almost nobody picks the marked answer. Check the key.'
        : flag === 'too_easy'
          ? 'Nearly everyone gets this. It no longer separates players.'
          : null,
  };
}

export async function getQuestion(scope, questionId, { allowCentral = false } = {}) {
  const origins = allowCentral ? [scope.spaceId, publicSpaceId] : [scope.spaceId];
  const question = await Question.findOne({ _id: oid(questionId), origin: { $in: origins } });
  if (!question) throw new NotFoundError('That question does not exist.');
  return question;
}

/**
 * `publishedQuestionCount` is maintained rather than computed, because
 * prd.md F8.3.3 gates a topic going live on it and the UI shows progress
 * toward 21 on every topic screen.
 */
export async function recountTopics(topicIds) {
  const ids = [...new Set((topicIds ?? []).map(String))].map(oid);
  if (!ids.length) return;

  const counts = await Question.aggregate([
    { $match: { topicIds: { $in: ids }, status: QUESTION_STATUS.PUBLISHED } },
    { $unwind: '$topicIds' },
    { $match: { topicIds: { $in: ids } } },
    { $group: { _id: '$topicIds', count: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.count]));

  await Topic.bulkWrite(
    ids.map((id) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { publishedQuestionCount: byId.get(String(id)) ?? 0 } },
      },
    })),
    { ordered: false },
  );
}

export { MIN_PUBLISHED_QUESTIONS_TO_LIVE };

async function audit(scope, actor, action, targetId, summary) {
  await AuditLog.create({
    spaceId: scope.spaceId,
    actorId: oid(actor._id),
    impersonatedBy: scope.viaSuperadmin ? oid(actor._id) : null,
    action,
    targetType: 'question',
    targetId: targetId ? oid(targetId) : undefined,
    summary: summary?.slice(0, 200),
  }).catch(() => {});
}

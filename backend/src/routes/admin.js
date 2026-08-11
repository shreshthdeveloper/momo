import mongoose from 'mongoose';
import { authenticate } from '../middleware/auth.js';
import { spaceAdminGuard, spacePermissionGuard } from '../middleware/tenantGuard.js';
import {
  createQuestion,
  updateQuestion,
  setQuestionStatus,
  deleteQuestion,
  duplicateQuestion,
  forkFromCentral,
  listQuestions,
  getQuestion,
  shapeQuestionRow,
  recountTopics,
  validateQuestionInput,
} from '../services/questionService.js';
import {
  validateImport,
  commitImport,
  importTemplateCsv,
  errorReportCsv,
  toCsv,
} from '../services/csvService.js';
import {
  spaceSummary,
  engagementSeries,
  weakestTopics,
  studentActivity,
  recentActivity,
  pendingAlerts,
  topicReport,
  studentReport,
  itemAnalysisReport,
  batchComparison,
} from '../services/analyticsService.js';
import { generateUniqueJoinCode, syncMembershipDenormalisation } from '../services/spaceService.js';
import { generatedCoverFor } from '../services/storageService.js';
import { notify } from '../services/notificationService.js';
import {
  Topic,
  Category,
  Space,
  SpaceMember,
  Batch,
  Report,
  AuditLog,
  Question,
  User,
} from '../models/index.js';
import { NotFoundError, BadRequestError, ForbiddenError } from '../lib/errors.js';
import {
  TOPIC_STATUS,
  QUESTION_STATUS,
  SPACE_ROLE,
  SPACE_ACCENTS,
  MIN_PUBLISHED_QUESTIONS_TO_LIVE,
  JOIN_MODE,
} from '../shared/constants.js';

const ok = (data) => ({ data });
const oid = (v) => new mongoose.Types.ObjectId(String(v));

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

async function audit(request, action, { targetType, targetId, summary, meta } = {}) {
  await AuditLog.create({
    spaceId: request.scope.spaceId,
    actorId: request.user._id,
    impersonatedBy: request.scope.viaSuperadmin ? request.user._id : null,
    action,
    targetType,
    targetId: targetId ? oid(targetId) : undefined,
    summary,
    meta,
    ip: request.ip,
  }).catch(() => {});
}

/**
 * The Organization Admin portal API (prd.md §8).
 *
 * Every route is behind `spaceAdminGuard` or a granular permission guard, both
 * of which run `tenantGuard` first. Handlers read `request.scope.spaceId` and
 * never a client-supplied id — see middleware/tenantGuard.js.
 */
export default async function adminRoutes(app) {
  app.addHook('preHandler', authenticate);

  // ── Dashboard (prd.md §8.1) ──────────────────────────────────────────────

  app.get('/dashboard', { preHandler: spaceAdminGuard }, async (request) => {
    const [summary, series, weakest, activity, feed, alerts] = await Promise.all([
      spaceSummary(request.scope),
      engagementSeries(request.scope, { days: Number(request.query.days) || 30 }),
      weakestTopics(request.scope),
      studentActivity(request.scope),
      recentActivity(request.scope),
      pendingAlerts(request.scope),
    ]);
    return ok({ summary, series, weakest, ...activity, activity: feed, alerts });
  });

  // ── Questions (prd.md §8.2) ──────────────────────────────────────────────

  app.get('/questions', { preHandler: spaceAdminGuard }, async (request) =>
    ok(await listQuestions(request.scope, request.query)),
  );

  app.get('/questions/:id', { preHandler: spaceAdminGuard }, async (request) => {
    const question = await getQuestion(request.scope, request.params.id, {
      allowCentral: request.query.origin === 'central',
    });
    return ok(question.toAdminJson());
  });

  const questionBody = {
    type: 'object',
    properties: {
      spaceId: { type: 'string' },
      text: { type: 'string', maxLength: 400 },
      options: { type: 'array', items: { type: 'string', maxLength: 200 } },
      correctIndex: { type: 'integer', minimum: 0, maximum: 3 },
      difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
      topicIds: { type: 'array', items: { type: 'string' } },
      tags: { type: 'array', items: { type: 'string', maxLength: 30 } },
      explanation: { type: 'string', maxLength: 600 },
      // Nullable: the editor sends `null` to mean "this question has no
      // picture", which is the majority of them and the only way to clear one.
      // Without this the schema rejected every save of an image-less question.
      imageUrl: { type: 'string', maxLength: 500, nullable: true },
      timeLimitOverrideMs: { type: 'integer', minimum: 5000, maximum: 60000, nullable: true },
      status: { type: 'string', enum: ['draft', 'in_review', 'published', 'archived'] },
      language: { type: 'string', maxLength: 8 },
      allowDuplicate: { type: 'boolean' },
      source: { type: 'string', enum: ['manual', 'import', 'ai'] },
    },
  };

  /** Live validation for the editor, so warnings appear as the admin types. */
  app.post(
    '/questions/validate',
    { preHandler: spaceAdminGuard, schema: { body: questionBody } },
    async (request) => ok(validateQuestionInput(request.body)),
  );

  app.post(
    '/questions',
    {
      preHandler: spacePermissionGuard('createQuestions'),
      schema: { body: { ...questionBody, required: ['text', 'options', 'correctIndex', 'topicIds'] } },
    },
    async (request, reply) => {
      // prd.md F8.2.8 — publishing may be restricted to the Admin.
      if (request.body.status === QUESTION_STATUS.PUBLISHED) {
        assertCanPublish(request.scope);
      }
      const { question, warnings } = await createQuestion(request.scope, request.user, request.body);
      reply.code(201);
      return ok({ ...question.toAdminJson(), warnings });
    },
  );

  app.patch(
    '/questions/:id',
    { preHandler: spacePermissionGuard('createQuestions'), schema: { body: questionBody } },
    async (request) => {
      if (request.body.status === QUESTION_STATUS.PUBLISHED) assertCanPublish(request.scope);
      const { question, warnings } = await updateQuestion(
        request.scope,
        request.user,
        request.params.id,
        request.body,
      );
      return ok({ ...question.toAdminJson(), warnings });
    },
  );

  app.post(
    '/questions/:id/status',
    {
      // Moving a question between draft, review, published and archived is
      // editing the bank, so it takes the same grant every other edit does.
      // Only PUBLISHING was ever checked, which left archiving — the one that
      // takes questions away from players — open to any sub-admin at all.
      preHandler: spacePermissionGuard('createQuestions'),
      schema: {
        body: {
          type: 'object',
          required: ['status'],
          properties: {
            spaceId: { type: 'string' },
            status: { type: 'string', enum: ['draft', 'in_review', 'published', 'archived'] },
            note: { type: 'string', maxLength: 300 },
          },
        },
      },
    },
    async (request) => {
      if (request.body.status === QUESTION_STATUS.PUBLISHED) assertCanPublish(request.scope);
      const question = await setQuestionStatus(
        request.scope,
        request.user,
        request.params.id,
        request.body.status,
        request.body.note,
      );
      return ok(question.toAdminJson());
    },
  );

  app.post('/questions/:id/duplicate', { preHandler: spacePermissionGuard('createQuestions') }, async (request) =>
    ok((await duplicateQuestion(request.scope, request.user, request.params.id)).toAdminJson()),
  );

  /** prd.md F8.2.9 — fork a central question into this space's bank. */
  app.post(
    '/questions/:id/fork',
    {
      preHandler: spacePermissionGuard('createQuestions'),
      schema: {
        body: {
          type: 'object',
          required: ['topicIds'],
          properties: {
            spaceId: { type: 'string' },
            topicIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
          },
        },
      },
    },
    async (request) =>
      ok(
        (
          await forkFromCentral(request.scope, request.user, request.params.id, request.body.topicIds)
        ).toAdminJson(),
      ),
  );

  app.delete('/questions/:id', { preHandler: spacePermissionGuard('createQuestions') }, async (request) =>
    ok(await deleteQuestion(request.scope, request.user, request.params.id)),
  );

  /** Bulk status change — admins work in batches, so the API does too. */
  app.post(
    '/questions/bulk',
    {
      // Same grant as the single-question version, and for a sharper reason:
      // this one takes up to 500 ids, so an ungranted sub-admin could archive
      // an organization's entire published bank in one call, dropping every
      // topic under the 21-question line and off every player's screen.
      preHandler: spacePermissionGuard('createQuestions'),
      schema: {
        body: {
          type: 'object',
          required: ['ids', 'action'],
          properties: {
            spaceId: { type: 'string' },
            ids: { type: 'array', items: { type: 'string' }, maxItems: 500 },
            action: { type: 'string', enum: ['publish', 'archive', 'draft', 'review'] },
          },
        },
      },
    },
    async (request) => {
      const map = {
        publish: QUESTION_STATUS.PUBLISHED,
        archive: QUESTION_STATUS.ARCHIVED,
        draft: QUESTION_STATUS.DRAFT,
        review: QUESTION_STATUS.IN_REVIEW,
      };
      const status = map[request.body.action];
      if (status === QUESTION_STATUS.PUBLISHED) assertCanPublish(request.scope);

      const ids = request.body.ids.filter((id) => mongoose.isValidObjectId(id)).map(oid);
      const affected = await Question.find(
        { _id: { $in: ids }, origin: request.scope.spaceId },
        { topicIds: 1 },
      ).lean();

      const result = await Question.updateMany(
        { _id: { $in: ids }, origin: request.scope.spaceId },
        { $set: { status, reviewedBy: request.user._id, reviewedAt: new Date() } },
      );
      await recountTopics(affected.flatMap((q) => q.topicIds));
      await audit(request, `question.bulk.${request.body.action}`, { meta: { count: result.modifiedCount } });
      return ok({ updated: result.modifiedCount });
    },
  );

  // ── CSV import (prd.md F8.2.5) ───────────────────────────────────────────

  app.get('/questions/import/template', { preHandler: spaceAdminGuard }, async (request, reply) => {
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="mimo-question-template.csv"');
    return importTemplateCsv();
  });

  /** Step 2 of design.md §9.4 — validate every row, nothing is written yet. */
  app.post('/questions/import/validate', { preHandler: spacePermissionGuard('createQuestions') }, async (request) => {
    const file = await request.file();
    if (!file) throw new BadRequestError('Upload a CSV file.', 'NO_FILE');
    const text = (await file.toBuffer()).toString('utf8');
    const defaultTopicId = file.fields?.topicId?.value;
    return ok(await validateImport(request.scope, text, { defaultTopicId }));
  });

  /** Step 3 — commit only the rows the admin accepted. */
  app.post(
    '/questions/import/commit',
    {
      preHandler: spacePermissionGuard('createQuestions'),
      schema: {
        body: {
          type: 'object',
          required: ['rows'],
          properties: {
            spaceId: { type: 'string' },
            status: { type: 'string', enum: ['draft', 'in_review', 'published'] },
            // ajv runs with removeAdditional: 'all', which strips every key
            // not named in `properties` — additionalProperties: true does NOT
            // protect against it. Both accepted layouts (a validate-response
            // row carrying `data`, or a bare data object) are spelled out so
            // the rows survive validation intact.
            rows: {
              type: 'array',
              maxItems: 2000,
              items: {
                type: 'object',
                properties: {
                  row: { type: 'integer' },
                  data: {
                    type: 'object',
                    properties: {
                      text: { type: 'string' },
                      options: { type: 'array', items: { type: 'string' } },
                      correctIndex: { type: 'integer' },
                      difficulty: { type: 'string' },
                      explanation: { type: 'string' },
                      tags: { type: 'array', items: { type: 'string' } },
                      topicId: { type: ['string', 'null'] },
                      topicName: { type: 'string' },
                    },
                  },
                  text: { type: 'string' },
                  options: { type: 'array', items: { type: 'string' } },
                  correctIndex: { type: 'integer' },
                  difficulty: { type: 'string' },
                  explanation: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                  topicId: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const status = request.body.status ?? QUESTION_STATUS.DRAFT;
      if (status === QUESTION_STATUS.PUBLISHED) assertCanPublish(request.scope);
      const result = await commitImport(request.scope, request.user, request.body.rows, { status });
      await audit(request, 'question.import', { meta: { imported: result.imported } });
      return ok(result);
    },
  );

  app.post('/questions/import/errors.csv', { preHandler: spaceAdminGuard }, async (request, reply) => {
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="import-errors.csv"');
    return errorReportCsv(request.body);
  });

  // ── Categories and topics (prd.md §8.3) ──────────────────────────────────

  app.get('/categories', { preHandler: spaceAdminGuard }, async (request) => {
    const items = await Category.find({ spaceId: request.scope.spaceId }).sort({ order: 1 }).lean();
    return ok({ items: items.map((c) => ({ ...c, id: String(c._id) })) });
  });

  app.post(
    '/categories',
    {
      preHandler: spacePermissionGuard('manageTopics'),
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            spaceId: { type: 'string' },
            name: { type: 'string', minLength: 2, maxLength: 60 },
            order: { type: 'integer' },
            color: { type: 'string', maxLength: 9 },
            iconUrl: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const category = await Category.create({
        spaceId: request.scope.spaceId,
        name: request.body.name,
        slug: slugify(request.body.name),
        order: request.body.order ?? 0,
        color: request.body.color,
        iconUrl: request.body.iconUrl,
      });
      await audit(request, 'category.create', { targetType: 'category', targetId: category._id });
      reply.code(201);
      return ok({ ...category.toObject(), id: String(category._id) });
    },
  );

  app.patch('/categories/:id', { preHandler: spacePermissionGuard('manageTopics') }, async (request) => {
    const category = await Category.findOne({ _id: request.params.id, spaceId: request.scope.spaceId });
    if (!category) throw new NotFoundError('That category does not exist.');
    for (const key of ['name', 'order', 'color', 'iconUrl', 'status']) {
      if (request.body[key] !== undefined) category[key] = request.body[key];
    }
    if (request.body.name) category.slug = slugify(request.body.name);
    await category.save();
    await audit(request, 'category.update', { targetType: 'category', targetId: category._id });
    return ok({ ...category.toObject(), id: String(category._id) });
  });

  app.get('/topics', { preHandler: spaceAdminGuard }, async (request) => {
    const filter = { spaceId: request.scope.spaceId };
    if (request.query.status) filter.status = request.query.status;
    if (request.query.categoryId) filter.categoryId = oid(request.query.categoryId);

    const items = await Topic.find(filter)
      .sort({ order: 1, name: 1 })
      .populate('categoryId', 'name color')
      .lean();

    return ok({
      items: items.map((t) => ({
        id: String(t._id),
        name: t.name,
        slug: t.slug,
        description: t.description,
        coverUrl: t.coverUrl,
        status: t.status,
        categoryId: t.categoryId ? String(t.categoryId._id) : null,
        categoryName: t.categoryId?.name,
        questionSources: t.questionSources,
        publishedQuestionCount: t.publishedQuestionCount,
        // prd.md F8.3.3 — progress toward 21 is shown in the UI.
        readiness: {
          published: t.publishedQuestionCount,
          required: MIN_PUBLISHED_QUESTIONS_TO_LIVE,
          remaining: Math.max(0, MIN_PUBLISHED_QUESTIONS_TO_LIVE - t.publishedQuestionCount),
          isLive:
            t.status === TOPIC_STATUS.PUBLISHED &&
            t.publishedQuestionCount >= MIN_PUBLISHED_QUESTIONS_TO_LIVE,
        },
        batchIds: (t.batchIds ?? []).map(String),
        stats: t.stats,
        order: t.order,
        featured: Boolean(t.featured),
      })),
    });
  });

  const topicBody = {
    type: 'object',
    properties: {
      spaceId: { type: 'string' },
      name: { type: 'string', minLength: 2, maxLength: 60 },
      categoryId: { type: 'string' },
      description: { type: 'string', maxLength: 280 },
      coverUrl: { type: 'string', maxLength: 5000 },
      status: { type: 'string', enum: ['draft', 'published', 'archived'] },
      order: { type: 'integer' },
      batchIds: { type: 'array', items: { type: 'string' } },
      questionSources: {
        type: 'object',
        properties: { central: { type: 'boolean' }, own: { type: 'boolean' } },
      },
    },
  };

  app.post(
    '/topics',
    {
      preHandler: spacePermissionGuard('manageTopics'),
      schema: { body: { ...topicBody, required: ['name', 'categoryId'] } },
    },
    async (request, reply) => {
      const category = await Category.findOne({
        _id: request.body.categoryId,
        spaceId: request.scope.spaceId,
      }).lean();
      if (!category) throw new BadRequestError('That category is not in this space.');

      const topic = await Topic.create({
        spaceId: request.scope.spaceId,
        categoryId: category._id,
        name: request.body.name,
        slug: slugify(request.body.name),
        description: request.body.description,
        // design.md §12 — a generated fallback covers topics without art.
        coverUrl: request.body.coverUrl ?? generatedCoverFor(request.body.name, category.color),
        status: TOPIC_STATUS.DRAFT,
        questionSources: request.body.questionSources ?? { central: false, own: true },
        batchIds: (request.body.batchIds ?? []).map(oid),
        order: request.body.order ?? 0,
        createdBy: request.user._id,
      });
      await audit(request, 'topic.create', { targetType: 'topic', targetId: topic._id, summary: topic.name });
      reply.code(201);
      return ok({ ...topic.toJSON(), id: String(topic._id) });
    },
  );

  app.patch(
    '/topics/:id',
    { preHandler: spacePermissionGuard('manageTopics'), schema: { body: topicBody } },
    async (request) => {
      const topic = await Topic.findOne({ _id: request.params.id, spaceId: request.scope.spaceId });
      if (!topic) throw new NotFoundError('That topic does not exist.');

      /**
       * prd.md F8.3.3 — the 21-question gate is enforced here, not just shown.
       *
       * It applies to PUBLISHING, not to saving a topic that is already
       * published. A topic can fall under the threshold after the fact (archive
       * a few questions and it does), and the editor sends `status` on every
       * save — so a topic in that state could not have its name, description or
       * cover corrected at all: every save came back demanding 21 questions,
       * and the only way out was to demote it to draft first.
       */
      const publishing =
        request.body.status === TOPIC_STATUS.PUBLISHED && topic.status !== TOPIC_STATUS.PUBLISHED;
      if (publishing && topic.publishedQuestionCount < MIN_PUBLISHED_QUESTIONS_TO_LIVE) {
        throw new BadRequestError(
          `This topic needs ${MIN_PUBLISHED_QUESTIONS_TO_LIVE} published questions before it goes live. It has ${topic.publishedQuestionCount}.`,
          'TOPIC_NOT_READY',
          { published: topic.publishedQuestionCount, required: MIN_PUBLISHED_QUESTIONS_TO_LIVE },
        );
      }

      for (const key of ['name', 'description', 'coverUrl', 'status', 'order']) {
        if (request.body[key] !== undefined) topic[key] = request.body[key];
      }
      if (request.body.name) topic.slug = slugify(request.body.name);
      if (request.body.categoryId) {
        const category = await Category.findOne({
          _id: request.body.categoryId,
          spaceId: request.scope.spaceId,
        }).lean();
        if (!category) throw new BadRequestError('That category is not in this space.');
        topic.categoryId = category._id;
      }
      if (request.body.questionSources) {
        topic.questionSources = { ...topic.questionSources, ...request.body.questionSources };
      }
      if (request.body.batchIds) topic.batchIds = request.body.batchIds.map(oid);

      await topic.save();
      await audit(request, 'topic.update', { targetType: 'topic', targetId: topic._id, summary: topic.name });
      return ok({ ...topic.toJSON(), id: String(topic._id) });
    },
  );

  // ── Students (prd.md §8.4) ───────────────────────────────────────────────

  app.get('/students', { preHandler: spaceAdminGuard }, async (request) => {
    const filter = { spaceId: request.scope.spaceId };
    if (request.query.status) filter.status = request.query.status;
    if (request.query.batchId) filter.batchId = oid(request.query.batchId);
    if (request.query.role) filter.role = request.query.role;

    /**
     * The search runs against the DATABASE, not against the page.
     *
     * It used to filter the rows that had already been paged out, so a name
     * that was not in the first fifty simply could not be found — and the
     * `total` beside the results still counted the whole roster, so the
     * numbers disagreed with the list. The name lives on the user document,
     * so the ids are resolved first and the membership query narrowed by them.
     */
    const needle = String(request.query.q ?? '').trim().toLowerCase();
    if (needle) {
      const safe = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = await User.find({ displayNameLower: { $regex: safe } }, { _id: 1 })
        .limit(500)
        .lean();
      filter.userId = { $in: matches.map((u) => u._id) };
    }

    const page = Number(request.query.page) || 0;
    const pageSize = Math.min(Number(request.query.pageSize) || 50, 100);

    const [members, total] = await Promise.all([
      SpaceMember.find(filter)
        .sort({ createdAt: -1 })
        .skip(page * pageSize)
        .limit(pageSize)
        .populate('userId', 'displayName avatarUrl phone city lastActiveAt matchesPlayed overallRating')
        .populate('batchId', 'name')
        .lean(),
      SpaceMember.countDocuments(filter),
    ]);

    const rows = members.filter((m) => m.userId);

    return ok({
      total,
      page,
      pageSize,
      items: rows.map((m) => ({
        membershipId: String(m._id),
        userId: String(m.userId._id),
        displayName: m.userId.displayName,
        avatarUrl: m.userId.avatarUrl,
        // The phone is masked — an admin needs to identify a student, not to
        // hold their contact details.
        phone: m.userId.phone ? `••••${String(m.userId.phone).slice(-4)}` : null,
        city: m.userId.city,
        role: m.role,
        status: m.status,
        externalId: m.externalId,
        batch: m.batchId ? { id: String(m.batchId._id), name: m.batchId.name } : null,
        matchesPlayed: m.userId.matchesPlayed,
        overallRating: m.userId.overallRating,
        lastActiveAt: m.userId.lastActiveAt,
        joinedAt: m.joinedAt,
      })),
    });
  });

  /** prd.md F8.4.3 — approve or reject, individually or in bulk. */
  app.post(
    '/students/decision',
    {
      preHandler: spacePermissionGuard('manageStudents'),
      schema: {
        body: {
          type: 'object',
          required: ['membershipIds', 'decision'],
          properties: {
            spaceId: { type: 'string' },
            membershipIds: { type: 'array', items: { type: 'string' }, maxItems: 200 },
            decision: { type: 'string', enum: ['approve', 'reject', 'suspend', 'remove', 'restore'] },
            batchId: { type: 'string' },
          },
        },
      },
    },
    async (request) => {
      const { membershipIds, decision, batchId } = request.body;
      const ids = membershipIds.filter((id) => mongoose.isValidObjectId(id)).map(oid);

      const members = await SpaceMember.find({
        _id: { $in: ids },
        spaceId: request.scope.spaceId,
      });

      const statusFor = {
        approve: 'active',
        restore: 'active',
        reject: 'left',
        remove: 'left',
        suspend: 'suspended',
      };

      for (const member of members) {
        // An admin cannot demote or remove themselves by accident.
        if (String(member.userId) === String(request.user._id)) continue;
        member.status = statusFor[decision];
        if (decision === 'approve') {
          member.approvedAt = new Date();
          if (batchId) member.batchId = oid(batchId);
        }
        if (decision === 'reject' || decision === 'remove') member.leftAt = new Date();
        await member.save();
        await syncMembershipDenormalisation(member.userId);

        if (decision === 'approve') {
          await notify(member.userId, {
            type: 'space_approved',
            title: `You are in ${request.scope.space?.name ?? 'your space'}`,
            body: 'Your topics are ready to play.',
            spaceId: request.scope.spaceId,
            force: true,
          }).catch(() => {});
        }
      }

      await audit(request, `student.${decision}`, { meta: { count: members.length } });
      return ok({ updated: members.length });
    },
  );

  app.post(
    '/students/:membershipId/batch',
    {
      preHandler: spacePermissionGuard('manageStudents'),
      schema: {
        body: {
          type: 'object',
          properties: { spaceId: { type: 'string' }, batchId: { type: 'string', nullable: true } },
        },
      },
    },
    async (request) => {
      const member = await SpaceMember.findOne({
        _id: request.params.membershipId,
        spaceId: request.scope.spaceId,
      });
      if (!member) throw new NotFoundError('That student is not in this space.');
      member.batchId = request.body.batchId ? oid(request.body.batchId) : null;
      await member.save();
      await audit(request, 'student.batch', { targetType: 'member', targetId: member._id });
      return ok({ updated: true });
    },
  );

  app.get('/students/:userId/report', { preHandler: spaceAdminGuard }, async (request) => {
    const report = await studentReport(request.scope, request.params.userId);
    if (!report) throw new NotFoundError('That student is not in this space.');
    return ok(report);
  });

  /** prd.md F8.4.2 — invite by code, link, QR, or a bulk CSV of phone numbers. */
  app.get('/invite', { preHandler: spaceAdminGuard }, async (request) => {
    const space = await Space.findById(request.scope.spaceId);
    if (!space.joinCode) {
      space.joinCode = await generateUniqueJoinCode();
      await space.save();
    }
    return ok({
      joinCode: space.joinCode,
      joinMode: space.joinMode,
      link: `${process.env.APP_LINK_BASE ?? 'https://wms.distrx.io'}/join/${space.joinCode}`,
    });
  });

  app.post('/invite/rotate', { preHandler: spacePermissionGuard('manageSettings') }, async (request) => {
    const space = await Space.findById(request.scope.spaceId);
    space.joinCode = await generateUniqueJoinCode();
    await space.save();
    await audit(request, 'space.rotate_join_code');
    return ok({ joinCode: space.joinCode });
  });

  // ── Batches (prd.md F8.4.5) ──────────────────────────────────────────────

  app.get('/batches', { preHandler: spaceAdminGuard }, async (request) => {
    const batches = await Batch.find({ spaceId: request.scope.spaceId }).sort({ name: 1 }).lean();
    const counts = await SpaceMember.aggregate([
      { $match: { spaceId: request.scope.spaceId, status: 'active', batchId: { $ne: null } } },
      { $group: { _id: '$batchId', n: { $sum: 1 } } },
    ]);
    const byId = new Map(counts.map((c) => [String(c._id), c.n]));
    return ok({
      items: batches.map((b) => ({
        id: String(b._id),
        name: b.name,
        description: b.description,
        year: b.year,
        studentCount: byId.get(String(b._id)) ?? 0,
      })),
    });
  });

  app.post(
    '/batches',
    {
      preHandler: spacePermissionGuard('manageStudents'),
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            spaceId: { type: 'string' },
            name: { type: 'string', minLength: 1, maxLength: 60 },
            description: { type: 'string', maxLength: 200 },
            year: { type: 'string', maxLength: 20 },
          },
        },
      },
    },
    async (request, reply) => {
      const batch = await Batch.create({
        spaceId: request.scope.spaceId,
        name: request.body.name,
        description: request.body.description,
        year: request.body.year,
        createdBy: request.user._id,
      });
      await audit(request, 'batch.create', { targetType: 'batch', targetId: batch._id });
      reply.code(201);
      return ok({ id: String(batch._id), name: batch.name });
    },
  );

  app.patch(
    '/batches/:id',
    {
      preHandler: spacePermissionGuard('manageStudents'),
      schema: {
        body: {
          type: 'object',
          properties: {
            spaceId: { type: 'string' },
            name: { type: 'string', minLength: 1, maxLength: 60 },
            description: { type: 'string', maxLength: 200, nullable: true },
            year: { type: 'string', maxLength: 20, nullable: true },
          },
        },
      },
    },
    async (request) => {
      const batch = await Batch.findOne({ _id: request.params.id, spaceId: request.scope.spaceId });
      if (!batch) throw new NotFoundError('That batch does not exist.');
      for (const key of ['name', 'description', 'year']) {
        if (request.body[key] !== undefined) batch[key] = request.body[key];
      }
      await batch.save();
      await audit(request, 'batch.update', { targetType: 'batch', targetId: batch._id, summary: batch.name });
      return ok({ id: String(batch._id), name: batch.name, description: batch.description, year: batch.year });
    },
  );

  app.delete('/batches/:id', { preHandler: spacePermissionGuard('manageStudents') }, async (request) => {
    const batch = await Batch.findOne({ _id: request.params.id, spaceId: request.scope.spaceId });
    if (!batch) throw new NotFoundError('That batch does not exist.');
    // Students are unassigned rather than removed — deleting a batch must
    // never delete people.
    await SpaceMember.updateMany({ spaceId: request.scope.spaceId, batchId: batch._id }, { $set: { batchId: null } });
    await batch.deleteOne();
    await audit(request, 'batch.delete', { targetType: 'batch', targetId: request.params.id });
    return ok({ deleted: true });
  });

  // ── Reports (prd.md §8.6) ────────────────────────────────────────────────

  app.get('/reports/topic/:topicId', { preHandler: spaceAdminGuard }, async (request) => {
    const report = await topicReport(request.scope, request.params.topicId);
    if (!report) throw new NotFoundError('That topic does not exist.');
    return ok(report);
  });

  app.get('/reports/items', { preHandler: spaceAdminGuard }, async (request) =>
    ok(await itemAnalysisReport(request.scope, { flaggedOnly: request.query.flagged === '1' })),
  );

  app.get('/reports/batches', { preHandler: spaceAdminGuard }, async (request) =>
    ok({ items: await batchComparison(request.scope, { days: Number(request.query.days) || 30 }) }),
  );

  /** prd.md F8.6.6 — every report exportable as CSV. */
  app.get('/reports/students.csv', { preHandler: spaceAdminGuard }, async (request, reply) => {
    const members = await SpaceMember.find({ spaceId: request.scope.spaceId, status: 'active' })
      .populate('userId', 'displayName city matchesPlayed overallRating lastActiveAt')
      .populate('batchId', 'name')
      .lean();

    const rows = members
      .filter((m) => m.userId)
      .map((m) => ({
        name: m.userId.displayName,
        batch: m.batchId?.name ?? '',
        city: m.userId.city ?? '',
        matches: m.userId.matchesPlayed ?? 0,
        rating: m.userId.overallRating ?? '',
        lastActive: m.userId.lastActiveAt?.toISOString?.() ?? '',
        joined: m.joinedAt?.toISOString?.() ?? '',
      }));

    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="students.csv"');
    return toCsv(['name', 'batch', 'city', 'matches', 'rating', 'lastActive', 'joined'], rows);
  });

  // ── Moderation queue for this space's own bank ───────────────────────────

  app.get('/reports/queue', { preHandler: spaceAdminGuard }, async (request) => {
    const reports = await Report.find({
      spaceId: request.scope.spaceId,
      status: request.query.status ?? 'open',
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('reporterId', 'displayName')
      .lean();

    const questionIds = reports.filter((r) => r.targetType === 'question').map((r) => r.targetId);
    const questions = await Question.find({ _id: { $in: questionIds }, origin: request.scope.spaceId }).lean();
    const byId = new Map(questions.map((q) => [String(q._id), q]));

    return ok({
      items: reports.map((r) => ({
        id: String(r._id),
        targetType: r.targetType,
        targetId: String(r.targetId),
        reason: r.reason,
        note: r.note,
        status: r.status,
        reportedBy: r.reporterId?.displayName,
        at: r.createdAt,
        question: byId.get(String(r.targetId))
          ? shapeQuestionRow(byId.get(String(r.targetId)))
          : null,
      })),
    });
  });

  app.post(
    '/reports/:id/resolve',
    {
      preHandler: spaceAdminGuard,
      schema: {
        body: {
          type: 'object',
          required: ['resolution'],
          properties: {
            spaceId: { type: 'string' },
            resolution: { type: 'string', enum: ['fixed', 'archived', 'dismissed'] },
            note: { type: 'string', maxLength: 300 },
          },
        },
      },
    },
    async (request) => {
      const report = await Report.findOne({ _id: request.params.id, spaceId: request.scope.spaceId });
      if (!report) throw new NotFoundError('That report does not exist.');

      report.status = request.body.resolution === 'dismissed' ? 'dismissed' : 'resolved';
      report.resolution = request.body.resolution;
      report.resolvedBy = request.user._id;
      report.resolvedAt = new Date();
      await report.save();

      if (request.body.resolution === 'archived' && report.targetType === 'question') {
        await setQuestionStatus(
          request.scope,
          request.user,
          report.targetId,
          QUESTION_STATUS.ARCHIVED,
          request.body.note,
        );
      }
      await audit(request, 'report.resolve', { targetType: 'report', targetId: report._id });
      return ok({ resolved: true });
    },
  );

  // ── Settings (prd.md §8.7) ───────────────────────────────────────────────

  app.get('/settings', { preHandler: spaceAdminGuard }, async (request) => {
    const space = await Space.findById(request.scope.spaceId).lean();
    const admins = await SpaceMember.find({
      spaceId: request.scope.spaceId,
      role: { $in: [SPACE_ROLE.ADMIN, SPACE_ROLE.SUB_ADMIN] },
      status: 'active',
    })
      .populate('userId', 'displayName avatarUrl phone')
      .lean();
    const seatsUsed = await SpaceMember.countDocuments({ spaceId: request.scope.spaceId, status: 'active' });

    return ok({
      space: {
        id: String(space._id),
        name: space.name,
        slug: space.slug,
        logoUrl: space.logoUrl,
        accentColor: space.accentColor,
        joinMode: space.joinMode,
        joinCode: space.joinCode,
        settings: space.settings,
        status: space.status,
        /**
         * When the organization was set up. Its own console shows it nowhere,
         * but the platform's tenant screen leads with it, and serving it here
         * is what lets that screen read one space instead of listing all two
         * hundred to find one date.
         */
        createdAt: space.createdAt,
      },
      plan: { ...space.plan, seatsUsed },
      accents: SPACE_ACCENTS,
      admins: admins
        .filter((a) => a.userId)
        .map((a) => ({
          membershipId: String(a._id),
          userId: String(a.userId._id),
          displayName: a.userId.displayName,
          avatarUrl: a.userId.avatarUrl,
          role: a.role,
          permissions: a.permissions,
          isYou: String(a.userId._id) === String(request.user._id),
        })),
    });
  });

  app.patch(
    '/settings',
    {
      preHandler: spacePermissionGuard('manageSettings'),
      schema: {
        body: {
          type: 'object',
          properties: {
            spaceId: { type: 'string' },
            name: { type: 'string', minLength: 2, maxLength: 80 },
            logoUrl: { type: 'string', maxLength: 500 },
            // design.md §3.3 — a curated set only. Free colour entry is not offered.
            accentColor: { type: 'string', enum: SPACE_ACCENTS },
            joinMode: { type: 'string', enum: Object.values(JOIN_MODE) },
            settings: {
              type: 'object',
              properties: {
                roundDurationMs: { type: 'integer', minimum: 5000, maximum: 60000 },
                allowGhosts: { type: 'boolean' },
                /** One automatic paper a day for the whole organization. */
                dailyChallenge: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const space = await Space.findById(request.scope.spaceId);
      for (const key of ['name', 'logoUrl', 'accentColor', 'joinMode']) {
        if (request.body[key] !== undefined) space[key] = request.body[key];
      }
      if (request.body.settings) {
        space.settings = { ...space.settings.toObject(), ...request.body.settings };
      }
      await space.save();
      await audit(request, 'space.settings', { meta: request.body });
      return ok(space.toBrand());
    },
  );

  /** prd.md F8.7.3 — sub-admin management with granular permissions. */
  app.post(
    '/admins',
    {
      preHandler: spacePermissionGuard('manageSettings'),
      schema: {
        body: {
          type: 'object',
          required: ['userId', 'role'],
          properties: {
            spaceId: { type: 'string' },
            userId: { type: 'string' },
            role: { type: 'string', enum: [SPACE_ROLE.STUDENT, SPACE_ROLE.SUB_ADMIN, SPACE_ROLE.ADMIN] },
            permissions: { type: 'object', additionalProperties: { type: 'boolean' } },
          },
        },
      },
    },
    async (request) => {
      // Only a full Admin may create another full Admin.
      if (request.body.role === SPACE_ROLE.ADMIN && request.scope.role !== SPACE_ROLE.ADMIN) {
        throw new ForbiddenError('Only a space admin can promote someone to admin.');
      }
      const member = await SpaceMember.findOne({
        spaceId: request.scope.spaceId,
        userId: oid(request.body.userId),
      });
      if (!member) throw new NotFoundError('That person is not in this space.');

      if (
        String(member.userId) === String(request.user._id) &&
        request.body.role !== SPACE_ROLE.ADMIN
      ) {
        throw new BadRequestError('You cannot remove your own admin access.');
      }

      member.role = request.body.role;
      member.status = 'active';
      if (request.body.permissions) {
        member.permissions = { ...member.permissions.toObject(), ...request.body.permissions };
      }
      await member.save();
      await audit(request, 'admin.role', {
        targetType: 'member',
        targetId: member._id,
        summary: request.body.role,
      });
      return ok({ updated: true, role: member.role, permissions: member.permissions });
    },
  );

  /** prd.md F8.7.5 — the audit log. */
  app.get('/audit', { preHandler: spaceAdminGuard }, async (request) => {
    const rows = await AuditLog.find({ spaceId: request.scope.spaceId })
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(request.query.limit) || 100, 200))
      .populate('actorId', 'displayName')
      .lean();
    return ok({
      items: rows.map((r) => ({
        id: String(r._id),
        action: r.action,
        actor: r.actorId?.displayName ?? 'Unknown',
        // F9.1.4 — an impersonation session is visible in the space's own log.
        impersonated: Boolean(r.impersonatedBy),
        targetType: r.targetType,
        summary: r.summary,
        at: r.createdAt,
      })),
    });
  });
}

function assertCanPublish(scope) {
  if (scope.role === SPACE_ROLE.ADMIN) return;
  if (!scope.permissions?.publishQuestions) {
    throw new ForbiddenError(
      'Your role can create questions but not publish them. Submit for review instead.',
      'CANNOT_PUBLISH',
    );
  }
}

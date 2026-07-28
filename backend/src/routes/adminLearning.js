import mongoose from 'mongoose';
import { authenticate } from '../middleware/auth.js';
import { spaceAdminGuard, spacePermissionGuard } from '../middleware/tenantGuard.js';
import {
  createContest,
  updateContest,
  setContestQuestions,
  deleteContest,
  listContests,
  getContest,
  standings,
  finaliseContest,
} from '../services/contestService.js';
import {
  createAssignment,
  updateAssignment,
  archiveAssignment,
  listAssignments,
  getAssignment,
} from '../services/assignmentService.js';
import { draftQuestions, aiDraftingStatus, reviewQueue, reviewBatch } from '../services/aiDraftService.js';
import { periodComparison } from '../services/analyticsService.js';
import { toCsv } from '../services/csvService.js';
import { AuditLog, Contest } from '../models/index.js';
import { CONTEST_STATUS, STANDINGS_VISIBILITY } from '../shared/constants.js';

const ok = (data) => ({ data });
const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Phase 3 admin surface: contests, assignments, AI drafting and the review
 * queue, plus the comparison reports (prd.md §8.5, F8.2.6, F8.2.8, F8.6.5).
 *
 * Registered under the same `/admin` prefix as `routes/admin.js` and behind
 * the same guards. It is a separate file for the same reason the PRD gives
 * them separate sections — they are separate jobs, and one 1,500-line route
 * file is where mistakes hide.
 */
export default async function adminLearningRoutes(app) {
  app.addHook('preHandler', authenticate);

  async function audit(request, action, { targetType, targetId, summary } = {}) {
    await AuditLog.create({
      spaceId: request.scope.spaceId,
      actorId: request.user._id,
      impersonatedBy: request.scope.viaSuperadmin ? request.user._id : null,
      action,
      targetType,
      targetId: targetId ? oid(targetId) : undefined,
      summary,
      ip: request.ip,
    }).catch(() => {});
  }

  const contestGuard = spacePermissionGuard('manageContests');

  // ── Contests (prd.md §8.5) ───────────────────────────────────────────────

  app.get('/contests', { preHandler: spaceAdminGuard }, async (request) =>
    ok(await listContests(request.scope, { status: request.query.status })),
  );

  app.get('/contests/:id', { preHandler: spaceAdminGuard }, async (request) =>
    ok(await getContest(request.scope, request.params.id)),
  );

  app.post(
    '/contests',
    {
      preHandler: contestGuard,
      schema: {
        body: {
          type: 'object',
          required: ['name', 'topicIds', 'startsAt', 'endsAt'],
          properties: {
            spaceId: { type: 'string' },
            name: { type: 'string', minLength: 2, maxLength: 80 },
            description: { type: 'string', maxLength: 400 },
            topicIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10 },
            questionCount: { type: 'integer' },
            selectionMode: { type: 'string', enum: ['auto', 'manual'] },
            questionIds: { type: 'array', items: { type: 'string' } },
            startsAt: { type: 'string' },
            endsAt: { type: 'string' },
            roundDurationMs: { type: 'integer', minimum: 5000, maximum: 60000 },
            batchIds: { type: 'array', items: { type: 'string' } },
            standingsVisibility: {
              type: 'string',
              enum: Object.values(STANDINGS_VISIBILITY),
            },
            publish: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const contest = await createContest(request.scope, request.user, request.body);
      await audit(request, 'contest.create', {
        targetType: 'contest',
        targetId: contest.id,
        summary: contest.name,
      });
      reply.code(201);
      return ok(contest);
    },
  );

  app.patch(
    '/contests/:id',
    {
      preHandler: contestGuard,
      schema: {
        body: {
          type: 'object',
          properties: {
            spaceId: { type: 'string' },
            name: { type: 'string', minLength: 2, maxLength: 80 },
            description: { type: 'string', maxLength: 400 },
            topicIds: { type: 'array', items: { type: 'string' } },
            questionCount: { type: 'integer' },
            startsAt: { type: 'string' },
            endsAt: { type: 'string' },
            roundDurationMs: { type: 'integer', minimum: 5000, maximum: 60000 },
            batchIds: { type: 'array', items: { type: 'string' } },
            standingsVisibility: { type: 'string', enum: Object.values(STANDINGS_VISIBILITY) },
            status: { type: 'string', enum: Object.values(CONTEST_STATUS) },
            publish: { type: 'boolean' },
          },
        },
      },
    },
    async (request) => {
      const contest = await updateContest(request.scope, request.params.id, request.body);
      await audit(request, 'contest.update', { targetType: 'contest', targetId: contest.id });
      return ok(contest);
    },
  );

  /** prd.md F8.5.2 — curate the paper by hand. */
  app.put(
    '/contests/:id/questions',
    {
      preHandler: contestGuard,
      schema: {
        body: {
          type: 'object',
          required: ['questionIds'],
          properties: {
            spaceId: { type: 'string' },
            questionIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 21 },
          },
        },
      },
    },
    async (request) => {
      const contest = await setContestQuestions(
        request.scope,
        request.params.id,
        request.body.questionIds,
      );
      await audit(request, 'contest.questions', { targetType: 'contest', targetId: contest.id });
      return ok(contest);
    },
  );

  app.delete('/contests/:id', { preHandler: contestGuard }, async (request) => {
    const result = await deleteContest(request.scope, request.params.id);
    await audit(request, result.deleted ? 'contest.delete' : 'contest.cancel', {
      targetType: 'contest',
      targetId: request.params.id,
    });
    return ok(result);
  });

  /** prd.md F8.5.3 — live standings during the window. Admins always see them. */
  app.get('/contests/:id/standings', { preHandler: spaceAdminGuard }, async (request) =>
    ok(await standings(request.scope, request.params.id, { isAdmin: true, limit: 200 })),
  );

  /** prd.md F8.5.4 — final results, exportable. */
  app.get('/contests/:id/standings.csv', { preHandler: spaceAdminGuard }, async (request, reply) => {
    const board = await standings(request.scope, request.params.id, { isAdmin: true, limit: 500 });
    const rows = board.rows.map((r) => ({
      rank: r.rank,
      name: r.displayName,
      score: r.score,
      correct: r.correctCount,
      totalSeconds: (r.totalResponseMs / 1000).toFixed(1),
      status: r.status,
    }));

    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header(
      'content-disposition',
      `attachment; filename="${slug(board.contest.name)}-standings.csv"`,
    );
    return toCsv(['rank', 'name', 'score', 'correct', 'totalSeconds', 'status'], rows);
  });

  /**
   * Close a contest early. The clock normally does this; this exists for the
   * case where an admin needs it over now — a leaked paper, a wrong window.
   */
  app.post('/contests/:id/finalise', { preHandler: contestGuard }, async (request) => {
    const contest = await Contest.findOne({
      _id: oid(request.params.id),
      spaceId: request.scope.spaceId,
    });
    if (!contest) return ok({ finalised: false });

    if (contest.endsAt > new Date()) contest.endsAt = new Date();
    await contest.save();

    const result = await finaliseContest(contest._id);
    await audit(request, 'contest.finalise', { targetType: 'contest', targetId: contest._id });
    return ok(result);
  });

  // ── Assignments (prd.md F8.5.5, F8.5.6) ──────────────────────────────────

  app.get('/assignments', { preHandler: spaceAdminGuard }, async (request) =>
    ok(await listAssignments(request.scope, { status: request.query.status })),
  );

  app.get('/assignments/:id', { preHandler: spaceAdminGuard }, async (request) =>
    ok(await getAssignment(request.scope, request.params.id)),
  );

  app.post(
    '/assignments',
    {
      preHandler: contestGuard,
      schema: {
        body: {
          type: 'object',
          required: ['title', 'topicId', 'dueAt'],
          properties: {
            spaceId: { type: 'string' },
            title: { type: 'string', minLength: 2, maxLength: 80 },
            description: { type: 'string', maxLength: 400 },
            topicId: { type: 'string' },
            dueAt: { type: 'string' },
            batchIds: { type: 'array', items: { type: 'string' } },
            requirement: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['matches', 'accuracy', 'mastery'] },
                matches: { type: 'integer' },
                minAccuracy: { type: 'integer' },
                level: { type: 'integer' },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const assignment = await createAssignment(request.scope, request.user, request.body);
      await audit(request, 'assignment.create', {
        targetType: 'assignment',
        targetId: assignment.id,
        summary: assignment.title,
      });
      reply.code(201);
      return ok(assignment);
    },
  );

  app.patch(
    '/assignments/:id',
    {
      preHandler: contestGuard,
      schema: {
        body: {
          type: 'object',
          properties: {
            spaceId: { type: 'string' },
            title: { type: 'string', minLength: 2, maxLength: 80 },
            description: { type: 'string', maxLength: 400 },
            dueAt: { type: 'string' },
            status: { type: 'string', enum: ['active', 'archived'] },
            requirement: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['matches', 'accuracy', 'mastery'] },
                matches: { type: 'integer' },
                minAccuracy: { type: 'integer' },
                level: { type: 'integer' },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const assignment = await updateAssignment(request.scope, request.params.id, request.body);
      await audit(request, 'assignment.update', { targetType: 'assignment', targetId: assignment.id });
      return ok(assignment);
    },
  );

  app.delete('/assignments/:id', { preHandler: contestGuard }, async (request) => {
    const result = await archiveAssignment(request.scope, request.params.id);
    await audit(request, 'assignment.archive', {
      targetType: 'assignment',
      targetId: request.params.id,
    });
    return ok(result);
  });

  app.get('/assignments/:id/progress.csv', { preHandler: spaceAdminGuard }, async (request, reply) => {
    const assignment = await getAssignment(request.scope, request.params.id);
    const rows = assignment.students.map((s) => ({
      name: s.displayName,
      progress: s.label,
      matches: s.matchesPlayed,
      accuracy: `${s.accuracy}%`,
      complete: s.complete ? 'yes' : 'no',
      late: s.late ? 'yes' : '',
      completedAt: s.completedAt ? new Date(s.completedAt).toISOString() : '',
    }));

    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header(
      'content-disposition',
      `attachment; filename="${slug(assignment.title)}-progress.csv"`,
    );
    return toCsv(
      ['name', 'progress', 'matches', 'accuracy', 'complete', 'late', 'completedAt'],
      rows,
    );
  });

  // ── AI drafting and the review queue (prd.md F8.2.6, F8.2.8) ─────────────

  app.get('/ai/status', { preHandler: spaceAdminGuard }, async () => ok(aiDraftingStatus()));

  app.post(
    '/ai/draft',
    {
      preHandler: spacePermissionGuard('createQuestions'),
      // Drafting is the most expensive call in the portal, in tokens and in
      // review time. A tight limit keeps an accidental double-click cheap.
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
      schema: {
        body: {
          type: 'object',
          required: ['topicId'],
          properties: {
            spaceId: { type: 'string' },
            topicId: { type: 'string' },
            count: { type: 'integer', minimum: 1, maximum: 20 },
            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard', 'mixed'] },
            notes: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
    async (request) => {
      const result = await draftQuestions(request.scope, request.user, request.body);
      await audit(request, 'question.ai_draft', {
        targetType: 'topic',
        targetId: request.body.topicId,
        summary: result.message,
      });
      return ok(result);
    },
  );

  app.get('/review', { preHandler: spaceAdminGuard }, async (request) =>
    ok(await reviewQueue(request.scope, { source: request.query.source })),
  );

  app.post(
    '/review/batch',
    {
      preHandler: spaceAdminGuard,
      schema: {
        body: {
          type: 'object',
          required: ['ids', 'action'],
          properties: {
            spaceId: { type: 'string' },
            ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100 },
            action: { type: 'string', enum: ['publish', 'archive', 'draft'] },
            note: { type: 'string', maxLength: 300 },
          },
        },
      },
    },
    async (request) => {
      const result = await reviewBatch(request.scope, request.user, request.body);
      await audit(request, `question.review.${request.body.action}`, {
        targetType: 'question',
        summary: `${result.updated} questions`,
      });
      return ok(result);
    },
  );

  // ── Comparison reporting (prd.md F8.6.5) ─────────────────────────────────

  /** Period vs period. Batch vs batch already lives at /reports/batches. */
  app.get('/reports/periods', { preHandler: spaceAdminGuard }, async (request) =>
    ok(
      await periodComparison(request.scope, {
        days: Number(request.query.days) || 30,
        topicId: request.query.topicId,
      }),
    ),
  );
}

const slug = (s) =>
  String(s ?? 'export')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'export';

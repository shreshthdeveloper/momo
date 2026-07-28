import { authenticate } from '../middleware/auth.js';
import { tenantGuard } from '../middleware/tenantGuard.js';
import {
  joinByCode,
  leaveSpace,
  listMySpaces,
  joinSpace,
} from '../services/spaceService.js';
import {
  listContestsForStudent,
  standings,
} from '../services/contestService.js';
import {
  listAssignmentsForStudent,
  assignmentSummaryFor,
} from '../services/assignmentService.js';
import { spacePerformanceFor } from '../services/analyticsService.js';
import { Space, SpaceMember, Topic, Batch } from '../models/index.js';
import { NotFoundError } from '../lib/errors.js';
import { TOPIC_STATUS, MIN_PUBLISHED_QUESTIONS_TO_LIVE, SPACE_ROLE } from '../shared/constants.js';

const ok = (data) => ({ data });

export default async function spaceRoutes(app) {
  app.addHook('preHandler', authenticate);

  /** prd.md F6.2.5 — the space switcher reads this. */
  app.get('/spaces/mine', async (request) => ok({ items: await listMySpaces(request.user._id) }));

  /**
   * Preview a join code before committing. Returns branding only — never the
   * member list, never the topic list.
   */
  app.get('/spaces/lookup/:code', async (request) => {
    const space = await Space.findOne(
      { joinCode: String(request.params.code).toUpperCase(), status: 'active' },
      { name: 1, logoUrl: 1, accentColor: 1, joinMode: 1 },
    ).lean();
    if (!space) throw new NotFoundError('No space matches that code.', 'BAD_JOIN_CODE');
    return ok({
      id: String(space._id),
      name: space.name,
      logoUrl: space.logoUrl,
      accentColor: space.accentColor,
      requiresApproval: space.joinMode === 'approval',
    });
  });

  /** prd.md F7.1 — join by 6-character code, invite link, or QR. */
  app.post(
    '/spaces/join',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
      schema: {
        body: {
          type: 'object',
          required: ['code'],
          properties: { code: { type: 'string', minLength: 4, maxLength: 12 } },
        },
      },
    },
    async (request) => {
      const { membership, space } = await joinByCode(request.user, request.body.code);
      return ok({
        space: space.toBrand(),
        status: membership.status,
        // prd.md F7.2 — approval mode means a wait, and the copy says so.
        message:
          membership.status === 'pending'
            ? 'Request sent. Your organization will approve you shortly.'
            : `You joined ${space.name}.`,
      });
    },
  );

  /** prd.md F6.1.5 — an invite link resolves to a space id rather than a code. */
  app.post('/spaces/:spaceId/join', async (request) => {
    const space = await Space.findOne({ _id: request.params.spaceId, status: 'active' });
    if (!space || space.joinMode === 'invite') {
      throw new NotFoundError('That space is not accepting members.', 'BAD_INVITE');
    }
    const { membership } = await joinSpace(request.user, space);
    return ok({ space: space.toBrand(), status: membership.status });
  });

  /** prd.md F7.8 — a student may always leave. */
  app.delete('/spaces/:spaceId/membership', async (request) => {
    await leaveSpace(request.user, request.params.spaceId);
    return ok({ left: true });
  });

  /**
   * prd.md F7.3 / design.md §8.12 — space home. A sibling of Home: same
   * components, same spacing, different content and one accent.
   */
  app.get('/spaces/:spaceId/home', { preHandler: tenantGuard }, async (request) => {
    const scope = request.scope;

    const [assignments, contests, performance] = await Promise.all([
      listAssignmentsForStudent(scope, request.user._id).catch(() => []),
      listContestsForStudent(scope, request.user._id).catch(() => []),
      spacePerformanceFor(scope, request.user._id).catch(() => null),
    ]);

    const [space, topics, batch, memberCount] = await Promise.all([
      Space.findById(scope.spaceId).lean(),
      Topic.find({
        spaceId: scope.spaceId,
        status: TOPIC_STATUS.PUBLISHED,
        publishedQuestionCount: { $gte: MIN_PUBLISHED_QUESTIONS_TO_LIVE },
        ...(scope.role === SPACE_ROLE.STUDENT && scope.batchId
          ? { $or: [{ batchIds: { $size: 0 } }, { batchIds: scope.batchId }] }
          : {}),
      })
        .sort({ order: 1, name: 1 })
        .limit(30)
        .populate('categoryId', 'name color')
        .lean(),
      scope.batchId ? Batch.findById(scope.batchId).lean() : null,
      SpaceMember.countDocuments({ spaceId: scope.spaceId, status: 'active' }),
    ]);

    return ok({
      space: {
        ...space.toBrand?.() ,
        id: String(space._id),
        name: space.name,
        logoUrl: space.logoUrl,
        accentColor: space.accentColor,
        roundDurationMs: space.settings?.roundDurationMs,
      },
      role: scope.role,
      batch: batch ? { id: String(batch._id), name: batch.name } : null,
      memberCount,
      topics: topics.map((t) => ({
        id: String(t._id),
        name: t.name,
        coverUrl: t.coverUrl,
        categoryName: t.categoryId?.name,
        categoryColor: t.categoryId?.color,
        publishedQuestionCount: t.publishedQuestionCount,
      })),
      /**
       * design.md §8.12 — "pending assignments with progress, upcoming or live
       * contests, assigned topics, class leaderboard, personal progress
       * summary", in that order. The order is the point: work first, then
       * events, then the open-ended stuff.
       */
      assignments,
      contests,
      performance,
    });
  });

  // ── Contests (prd.md F7.5) ───────────────────────────────────────────────

  app.get('/spaces/:spaceId/contests', { preHandler: tenantGuard }, async (request) =>
    ok({ items: await listContestsForStudent(request.scope, request.user._id) }),
  );

  app.get(
    '/spaces/:spaceId/contests/:contestId/standings',
    { preHandler: tenantGuard },
    async (request) =>
      ok(
        await standings(request.scope, request.params.contestId, {
          viewerId: request.user._id,
          // A student sees the board on the contest's own terms — the admin
          // flag is never derived from anything the client sent.
          isAdmin:
            request.scope.role === SPACE_ROLE.ADMIN || request.scope.role === SPACE_ROLE.SUB_ADMIN,
          limit: 100,
        }),
      ),
  );

  // ── Assignments (prd.md F7.4) ────────────────────────────────────────────

  app.get('/spaces/:spaceId/assignments', { preHandler: tenantGuard }, async (request) => {
    const [items, summary] = await Promise.all([
      listAssignmentsForStudent(request.scope, request.user._id),
      assignmentSummaryFor(request.scope, request.user._id),
    ]);
    return ok({ items, summary });
  });

  /** prd.md F7.6 — the student's own performance inside this space. */
  app.get('/spaces/:spaceId/performance', { preHandler: tenantGuard }, async (request) =>
    ok(await spacePerformanceFor(request.scope, request.user._id)),
  );
}

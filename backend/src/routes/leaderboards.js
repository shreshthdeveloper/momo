import { authenticate } from '../middleware/auth.js';
import { tenantGuard } from '../middleware/tenantGuard.js';
import { getLeaderboard } from '../services/leaderboardService.js';
import { classTable } from '../services/classTableService.js';
import { Topic } from '../models/index.js';
import { NotFoundError, BadRequestError } from '../lib/errors.js';

const ok = (data) => ({ data });

export default async function leaderboardRoutes(app) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', tenantGuard);

  const querystring = {
    type: 'object',
    properties: {
      spaceId: { type: 'string' },
      scope: { type: 'string', enum: ['global', 'country', 'city', 'friends', 'space', 'batch'] },
      scopeValue: { type: 'string' },
      period: { type: 'string', enum: ['all', 'week', 'month'] },
      page: { type: 'string' },
    },
  };

  const params = (request) => ({
    scopeType: request.query.scope ?? (request.scope.isPublic ? 'global' : 'space'),
    scopeValue: request.query.scopeValue ?? null,
    period: request.query.period ?? 'all',
    page: Math.max(0, Number(request.query.page) || 0),
  });

  /** prd.md §6.6 — per-topic board. */
  app.get('/leaderboards/topic/:topicId', { schema: { querystring } }, async (request) => {
    // The topic must be inside the resolved scope; asking for another space's
    // topic returns not-found rather than an empty board, so the endpoint
    // cannot be used to probe which topic ids exist elsewhere.
    const topic = await Topic.findOne(
      { _id: request.params.topicId, spaceId: request.scope.spaceId },
      { _id: 1, name: 1, coverUrl: 1 },
    ).lean();
    if (!topic) throw new NotFoundError('That topic does not exist.');

    const board = await getLeaderboard({
      scope: request.scope,
      viewer: request.user,
      topicId: topic._id,
      ...params(request),
    });
    return ok({ topic: { id: String(topic._id), name: topic.name, coverUrl: topic.coverUrl }, ...board });
  });

  /**
   * Class against class, inside one organization.
   *
   * Refused in the Public Arena rather than returned empty: there are no batches
   * there and never will be, so an empty table would read as "your class has not
   * played" to somebody who has no class.
   */
  app.get(
    '/leaderboards/classes',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            spaceId: { type: 'string' },
            period: { type: 'string', enum: ['week', 'month', 'all'] },
          },
        },
      },
    },
    async (request) => {
      if (request.scope.isPublic) {
        throw new BadRequestError('Class tables only exist inside an organization.', 'NO_SPACE');
      }
      return ok(
        await classTable(request.scope, {
          period: request.query.period ?? 'week',
          viewerId: request.user._id,
        }),
      );
    },
  );

  /** prd.md F6.6.2 — the overall board, across every topic in scope. */
  app.get('/leaderboards/overall', { schema: { querystring } }, async (request) =>
    ok(
      await getLeaderboard({
        scope: request.scope,
        viewer: request.user,
        topicId: null,
        ...params(request),
      }),
    ),
  );
}

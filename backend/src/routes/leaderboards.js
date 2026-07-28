import { authenticate } from '../middleware/auth.js';
import { tenantGuard } from '../middleware/tenantGuard.js';
import { getLeaderboard } from '../services/leaderboardService.js';
import { Topic } from '../models/index.js';
import { NotFoundError } from '../lib/errors.js';

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

import { authenticate } from '../middleware/auth.js';
import { tenantGuard } from '../middleware/tenantGuard.js';
import {
  listTopics,
  listCategories,
  buildHomeFeed,
  getTopicDetail,
} from '../services/topicService.js';
import { friendIdsOf } from '../services/leaderboardService.js';

const ok = (data) => ({ data });

/**
 * Categories, topics, and the home feed.
 *
 * Every handler goes through `tenantGuard` first, so `request.scope.spaceId`
 * is a validated membership rather than whatever the client put in the query
 * string. Handlers never read `request.query.spaceId` directly.
 */
export default async function catalogRoutes(app) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', tenantGuard);

  const spaceQuery = {
    type: 'object',
    properties: { spaceId: { type: 'string' } },
  };

  /** prd.md F6.2.1 — the home feed. */
  app.get('/home', { schema: { querystring: spaceQuery } }, async (request) => {
    const friendIds = await friendIdsOf(request.user._id).catch(() => []);
    const feed = await buildHomeFeed(request.scope, request.user, { friendIds });
    return ok({
      space: {
        id: String(request.scope.spaceId),
        isPublic: request.scope.isPublic,
        name: request.scope.space?.name ?? 'Public Arena',
        logoUrl: request.scope.space?.logoUrl ?? null,
        accentColor: request.scope.space?.accentColor ?? null,
      },
      ...feed,
    });
  });

  /** prd.md F6.2.2 */
  app.get('/categories', { schema: { querystring: spaceQuery } }, async (request) =>
    ok({ items: await listCategories(request.scope) }),
  );

  /** prd.md F6.2.3 — topic search, typo-tolerant. */
  app.get(
    '/topics',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            spaceId: { type: 'string' },
            categoryId: { type: 'string' },
            q: { type: 'string', maxLength: 60 },
            limit: { type: 'string' },
            skip: { type: 'string' },
          },
        },
      },
    },
    async (request) =>
      ok({
        items: await listTopics(request.scope, {
          categoryId: request.query.categoryId,
          q: request.query.q,
          limit: Number(request.query.limit) || 40,
          skip: Number(request.query.skip) || 0,
          viewerId: request.user._id,
        }),
      }),
  );

  app.get('/topics/:id', { schema: { querystring: spaceQuery } }, async (request) =>
    ok(await getTopicDetail(request.scope, request.params.id, request.user._id)),
  );
}

import { authenticate } from '../middleware/auth.js';
import { listMatchesForUser, getMatchForReview } from '../services/matchService.js';
import { NotFoundError } from '../lib/errors.js';

const ok = (data) => ({ data });

/**
 * Match history and review.
 *
 * tech.md §6 — live gameplay never touches REST; it is entirely over sockets.
 * These endpoints only ever read finished matches.
 */
export default async function matchRoutes(app) {
  app.addHook('preHandler', authenticate);

  app.get(
    '/matches',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'string' },
            before: { type: 'string' },
            topicId: { type: 'string' },
          },
        },
      },
    },
    async (request) =>
      ok({
        items: await listMatchesForUser(request.user._id, {
          limit: Number(request.query.limit) || 20,
          before: request.query.before,
          topicId: request.query.topicId,
        }),
      }),
  );

  /**
   * prd.md F6.4.20 — the full review, and the only endpoint that returns the
   * answer key. `getMatchForReview` returns null unless the caller played in
   * the match and the match is over, so neither a spectator nor a player
   * mid-match can read it.
   */
  app.get('/matches/:id', async (request) => {
    const match = await getMatchForReview(request.params.id, request.user._id);
    if (!match) throw new NotFoundError('That match is not available.');
    return ok(match);
  });
}

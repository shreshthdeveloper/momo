import { authenticate } from '../middleware/auth.js';
import {
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  listFriends,
  recentOpponents,
  createChallenge,
  listChallenges,
  respondToChallenge,
} from '../services/friendService.js';
import { getPublicProfile, searchUsers } from '../services/userService.js';
import { Report, Question, Match } from '../models/index.js';
import { BadRequestError } from '../lib/errors.js';

const ok = (data) => ({ data });

export default async function socialRoutes(app) {
  app.addHook('preHandler', authenticate);

  // ── Profiles ─────────────────────────────────────────────────────────────

  app.get('/users/search', async (request) =>
    ok({ items: await searchUsers(request.query.q, request.user) }),
  );

  app.get('/users/:id', async (request) =>
    ok(await getPublicProfile(request.params.id, request.user)),
  );

  // ── Friends (prd.md §6.8) ────────────────────────────────────────────────

  app.get('/friends', async (request) => ok(await listFriends(request.user)));

  /**
   * People to add, drawn from who you have just played. This is what stands
   * between the Friends tab and a dead end: an empty list with a search field
   * asks the player to already know a name.
   */
  app.get('/friends/suggestions', async (request) =>
    ok({ items: await recentOpponents(request.user) }),
  );

  app.post(
    '/friends/request',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
      schema: {
        body: { type: 'object', required: ['userId'], properties: { userId: { type: 'string' } } },
      },
    },
    async (request) => {
      const friendship = await sendFriendRequest(request.user, request.body.userId);
      return ok({ id: String(friendship._id), status: friendship.status });
    },
  );

  app.post('/friends/:id/accept', async (request) => {
    const friendship = await acceptFriendRequest(request.user, request.params.id);
    return ok({ id: String(friendship._id), status: friendship.status });
  });

  app.post('/friends/:id/decline', async (request) => {
    const friendship = await declineFriendRequest(request.user, request.params.id);
    return ok({ id: String(friendship._id), status: friendship.status });
  });

  app.delete('/friends/:userId', async (request) =>
    ok(await removeFriend(request.user, request.params.userId)),
  );

  // ── Challenges (prd.md §6.3) ─────────────────────────────────────────────

  app.get('/challenges', async (request) => ok({ items: await listChallenges(request.user) }));

  app.post(
    '/challenges',
    {
      schema: {
        body: {
          type: 'object',
          required: ['userId', 'topicId'],
          properties: { userId: { type: 'string' }, topicId: { type: 'string' } },
        },
      },
    },
    async (request) => {
      const challenge = await createChallenge(request.user, {
        toUserId: request.body.userId,
        topicId: request.body.topicId,
      });
      return ok({ id: String(challenge._id), expiresAt: challenge.expiresAt });
    },
  );

  app.post('/challenges/:id/accept', async (request) =>
    ok({ status: (await respondToChallenge(request.user, request.params.id, true)).status }),
  );

  app.post('/challenges/:id/decline', async (request) =>
    ok({ status: (await respondToChallenge(request.user, request.params.id, false)).status }),
  );

  // ── Reports (prd.md F6.4.21, F6.8.4) ─────────────────────────────────────

  /**
   * design.md §10 — "Reported. We'll review it." Nothing more; the copy does
   * not thank the user for feedback, it states what happened.
   */
  app.post(
    '/reports',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
      schema: {
        body: {
          type: 'object',
          required: ['targetType', 'targetId', 'reason'],
          properties: {
            targetType: { type: 'string', enum: ['question', 'user', 'displayName'] },
            targetId: { type: 'string' },
            reason: {
              type: 'string',
              enum: ['wrong_answer', 'typo', 'offensive', 'duplicate', 'cheating', 'harassment', 'other'],
            },
            note: { type: 'string', maxLength: 500 },
            matchId: { type: 'string' },
          },
        },
      },
    },
    async (request) => {
      const { targetType, targetId, reason, note, matchId } = request.body;

      // A question report is only accepted from someone who was actually
      // served the question — otherwise the queue fills with drive-by reports.
      let spaceId;
      if (targetType === 'question') {
        const question = await Question.findById(targetId, { origin: 1 }).lean();
        if (!question) throw new BadRequestError('That question does not exist.');
        spaceId = question.origin;

        if (matchId) {
          const played = await Match.exists({
            _id: matchId,
            'players.userId': request.user._id,
            questionIds: targetId,
          });
          if (!played) throw new BadRequestError('You did not play that question.', 'NOT_A_PARTICIPANT');
        }
      }

      try {
        await Report.create({
          reporterId: request.user._id,
          targetType,
          targetId,
          reason,
          note,
          matchId,
          spaceId,
        });
      } catch (err) {
        // The unique index on (reporter, target) means a second report is a
        // no-op, not an error the user needs to see.
        if (err.code !== 11000) throw err;
        return ok({ reported: true, message: "Reported. We'll review it." });
      }

      if (targetType === 'question') {
        await Question.updateOne({ _id: targetId }, { $inc: { reportCount: 1 } });
      }

      return ok({ reported: true, message: "Reported. We'll review it." });
    },
  );
}

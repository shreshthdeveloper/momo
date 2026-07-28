import { authenticate } from '../middleware/auth.js';
import {
  updateProfile,
  setInterests,
  requestDeletion,
  cancelDeletion,
  exportUserData,
  blockUser,
  unblockUser,
  listBlocked,
  titleNameFor,
} from '../services/userService.js';
import {
  listNotifications,
  markRead,
  unreadCount,
  registerPushToken,
  removePushToken,
} from '../services/notificationService.js';
import { topTopicsFor } from '../services/ratingService.js';
import { revokeAllSessions } from '../services/authService.js';
import { listInterestCandidates } from '../services/topicService.js';
import { levelForXp, accountProgress } from '../shared/mastery.js';
import { leagueFor } from '../shared/league.js';
import { shelfFor, nextUnlock } from '../shared/perks.js';
import { achievementShelf } from '../shared/achievements.js';
import { progression, buyCosmetic } from '../services/progressionService.js';
import { chestsFor, claimChest, unopenedChestCount } from '../services/chestService.js';
import {
  COSMETIC_TYPE,
  COSMETIC_TYPES,
  RANKED_START,
  RARITY_META,
} from '../shared/constants.js';

const ok = (data) => ({ data });

export default async function meRoutes(app) {
  app.addHook('preHandler', authenticate);

  app.get('/me', async (request) => ok(request.user.toPrivateProfile()));

  app.patch(
    '/me',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            displayName: { type: 'string', minLength: 2, maxLength: 24 },
            avatarUrl: { type: 'string', maxLength: 500 },
            banner: { type: 'string', maxLength: 500 },
            /**
             * The equipped title's perk key, or null to wear none. It must be
             * declared: ajv runs with removeAdditional: 'all', so anything not
             * named here is stripped before the handler ever sees it.
             */
            title: { type: ['string', 'null'], maxLength: 60 },
            country: { type: 'string', minLength: 2, maxLength: 2 },
            city: { type: 'string', maxLength: 60 },
            dateOfBirth: { type: 'string' },
            locale: { type: 'string', maxLength: 8 },
            notificationPrefs: { type: 'object', additionalProperties: true },
            privacy: {
              type: 'object',
              properties: {
                profileVisibility: { type: 'string', enum: ['public', 'friends', 'private'] },
                contactDiscovery: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const user = await updateProfile(request.user, request.body);
      return ok(user.toPrivateProfile());
    },
  );

  /** prd.md F6.1.6 — deletion with a 30-day grace period. */
  app.delete('/me', async (request) => ok(await requestDeletion(request.user)));

  app.post('/me/restore', async (request) => ok(await cancelDeletion(request.user)));

  /** prd.md §6.10 / §13 — DPDP data export. */
  app.get('/me/export', async (request, reply) => {
    const data = await exportUserData(request.user._id);
    reply.header('content-disposition', 'attachment; filename="mimo-data-export.json"');
    return ok(data);
  });

  app.post('/me/logout-all', async (request) => {
    await revokeAllSessions(request.user._id);
    return ok({ revoked: true });
  });

  // ── Interests (prd.md F6.1.4) ────────────────────────────────────────────

  app.get('/me/interests/candidates', async () => ok(await listInterestCandidates()));

  app.put(
    '/me/interests',
    {
      schema: {
        body: {
          type: 'object',
          required: ['topicIds'],
          properties: {
            topicIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 },
          },
        },
      },
    },
    async (request) => ok({ interests: await setInterests(request.user, request.body.topicIds) }),
  );

  // ── Progression ──────────────────────────────────────────────────────────

  app.get('/me/stats', async (request) => {
    const [topics, unopenedChests] = await Promise.all([
      topTopicsFor(request.user._id, 10),
      unopenedChestCount(request.user._id),
    ]);
    /**
     * leagues-and-progression.md §7 — the profile headline is the league badge
     * over the account level bar, with the topic ratings below as before.
     * `overallRating` stays in the payload while the clients that read it move.
     */
    const { accountCurve, ladder, catalogue } = progression();
    const rankedRating = request.user.rankedRating ?? RANKED_START;
    /** The floor can only ever raise this — see User.accountLevelFloor. */
    const progress = accountProgress(
      request.user.totalXp,
      accountCurve,
      request.user.accountLevelFloor,
    );
    const level = progress.level;
    return ok({
      overallRating: request.user.overallRating,
      rankedRating,
      league: leagueFor(rankedRating, ladder),
      accountLevel: level,
      accountProgress: progress,
      /** The name, so the profile never has to know what a perk key is. */
      title: titleNameFor(request.user.title),
      /** What they are climbing toward — the bar means nothing without it. */
      nextPerk: nextUnlock(catalogue, level),
      totalXp: request.user.totalXp,
      matchesPlayed: request.user.matchesPlayed,
      matchesWon: request.user.matchesWon,
      winRate: request.user.matchesPlayed
        ? Number((request.user.matchesWon / request.user.matchesPlayed).toFixed(3))
        : 0,
      streak: request.user.streak,
      /**
       * Every achievement, earned or not.
       *
       * The earned keys alone were never enough for a screen: a player with
       * none saw an empty space where the feature should be, and one with three
       * had no way to learn there were four more or what they were for.
       */
      achievements: achievementShelf(request.user.achievements),
      /** The balance, so the profile can show it beside the level that pays it. */
      coins: request.user.coins ?? 0,
      /**
       * Chests earned but never opened.
       *
       * Here rather than only on `/me/rewards` because the profile is where a
       * player looks for "did I miss something?", and until this existed the
       * honest answer — yes, and it is still waiting — was only discoverable by
       * opening a screen you had no reason to open.
       */
      unopenedChests,
      topTopics: topics
        .filter((r) => r.topicId)
        .map((r) => ({
          topicId: String(r.topicId._id),
          name: r.topicId.name,
          coverUrl: r.topicId.coverUrl,
          rating: r.rating,
          peakRating: r.peakRating,
          level: r.level ?? levelForXp(r.xp),
          xp: r.xp,
          matchesPlayed: r.matchesPlayed,
          wins: r.wins,
          losses: r.losses,
          draws: r.draws,
          accuracy: r.totalAnswers ? Number((r.correctAnswers / r.totalAnswers).toFixed(3)) : null,
          avgResponseMs: r.totalAnswers ? Math.round(r.totalResponseMs / r.totalAnswers) : null,
        })),
    });
  });

  /**
   * leagues-and-progression.md §7 — the rewards screen: what is unlocked, what
   * is next, and what equips. One request, because it is one screen, and the
   * shelves carry locked items too — seeing what is coming is the point.
   */
  app.get('/me/rewards', async (request) => {
    const { accountCurve, ladder, catalogue, version } = progression();
    const rankedRating = request.user.rankedRating ?? RANKED_START;
    const { level, ...progress } = accountProgress(
      request.user.totalXp,
      accountCurve,
      request.user.accountLevelFloor,
    );
    const granted = request.user.grantedPerks ?? [];

    /**
     * One context for every shelf. Ownership can turn on any of three things —
     * a level, a league, or a key already granted — and the shelves must agree
     * with `PATCH /me` about all three, so both read it the same way.
     */
    const ctx = { level, granted, rankedRating, ladder };
    const chests = await chestsFor(request.user._id);

    return ok({
      accountLevel: level,
      totalXp: request.user.totalXp,
      progress,
      league: leagueFor(rankedRating, ladder),
      rankedRating,
      /** The balance every price on this screen is measured against. */
      coins: request.user.coins ?? 0,
      /** Tier names, colours and bands, so the client never hard-codes them. */
      rarities: RARITY_META,
      /** The key, not the name — this screen equips, so it speaks in keys. */
      title: request.user.title || null,
      shelves: {
        avatars: shelfFor(catalogue, COSMETIC_TYPE.AVATAR, ctx),
        banners: shelfFor(catalogue, COSMETIC_TYPE.BANNER, ctx),
        titles: shelfFor(catalogue, COSMETIC_TYPE.TITLE, ctx),
      },
      /** Unopened first: the whole point of the screen is the one waiting. */
      chests: chests.sort((a, b) => Number(Boolean(a.claimedAt)) - Number(Boolean(b.claimedAt))),
      next: nextUnlock(catalogue, level),
      configVersion: version,
    });
  });

  /**
   * Open a chest.
   *
   * The grant was written when the rating crossed; this is the moment it
   * becomes owned. Idempotent by way of a `claimedAt: null` filter, so two
   * taps race and exactly one of them wins.
   */
  app.post(
    '/me/chests/:key/claim',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (request) =>
      ok(
        await claimChest(request.user._id, request.params.key, {
          owned: request.user.grantedPerks ?? [],
        }),
      ),
  );

  /**
   * Buy one cosmetic (coins-and-cosmetics.md §3.2).
   *
   * Rate-limited because it is the only endpoint that spends: a client bug that
   * fires it in a loop should cost a player one item, not their balance. The
   * spend itself is already safe — the update is conditional on the balance —
   * so this is about noise, not correctness.
   */
  app.post(
    '/me/shop/buy',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
      schema: {
        body: {
          type: 'object',
          required: ['type', 'key'],
          properties: {
            type: { type: 'string', enum: COSMETIC_TYPES },
            key: { type: 'string', maxLength: 40 },
          },
        },
      },
    },
    async (request) => {
      const { item, coins, spent } = await buyCosmetic(request.user, request.body);
      return ok({
        item: { type: item.type, key: item.key, name: item.name, rarity: item.rarity },
        coins,
        spent,
      });
    },
  );

  // ── Notifications (prd.md §6.9) ──────────────────────────────────────────

  app.get('/me/notifications', async (request) =>
    ok({
      items: await listNotifications(request.user._id, {
        limit: Number(request.query.limit) || 30,
        unreadOnly: request.query.unread === '1',
      }),
      unread: await unreadCount(request.user._id),
    }),
  );

  app.post(
    '/me/notifications/read',
    {
      schema: {
        body: {
          type: 'object',
          properties: { ids: { type: 'array', items: { type: 'string' } } },
        },
      },
    },
    async (request) => ok(await markRead(request.user._id, request.body?.ids)),
  );

  app.post(
    '/me/push-token',
    {
      schema: {
        body: {
          type: 'object',
          required: ['token', 'platform'],
          properties: {
            token: { type: 'string', maxLength: 400 },
            platform: { type: 'string', enum: ['ios', 'android', 'web'] },
          },
        },
      },
    },
    async (request) => {
      await registerPushToken(request.user, request.body);
      return ok({ registered: true });
    },
  );

  app.delete(
    '/me/push-token',
    {
      schema: {
        body: { type: 'object', required: ['token'], properties: { token: { type: 'string' } } },
      },
    },
    async (request) => {
      await removePushToken(request.user, request.body.token);
      return ok({ removed: true });
    },
  );

  // ── Blocking (prd.md F6.8.4) ─────────────────────────────────────────────

  app.get('/me/blocked', async (request) => ok({ items: await listBlocked(request.user) }));

  app.post('/me/blocked/:userId', async (request) =>
    ok(await blockUser(request.user, request.params.userId)),
  );

  app.delete('/me/blocked/:userId', async (request) =>
    ok(await unblockUser(request.user, request.params.userId)),
  );
}

import mongoose from 'mongoose';
import { authenticate, requireSuperadmin } from '../middleware/auth.js';
import {
  Space,
  SpaceMember,
  User,
  Topic,
  Question,
  Report,
  AuditLog,
  Match,
  publicSpaceId,
} from '../models/index.js';
import { platformAnalytics, ghostRatioByTopic } from '../services/analyticsService.js';
import { generateUniqueJoinCode, syncMembershipDenormalisation } from '../services/spaceService.js';
import { signAccessToken } from '../services/authService.js';
import { shapeQuestionRow } from '../services/questionService.js';
import { registry } from '../game/registry.js';
import {
  progression,
  saveAccountCurve,
  saveLeagues,
  saveDivisions,
  saveCosmetic,
  deleteCosmetic,
  saveChest,
  deleteChest,
} from '../services/progressionService.js';
import { NotFoundError, BadRequestError } from '../lib/errors.js';
import {
  ACCOUNT_MAX_LEVEL,
  CHEST_SLOT_COUNT,
  CHEST_RECURRENCES,
  CHEST_TRIGGERS,
  COSMETIC_TYPES,
  QUESTION_STATUS,
  RANKED_FLOOR,
  RARITIES,
  SPACE_ACCENTS,
  SPACE_ROLE,
  UNLOCK_KINDS,
} from '../shared/constants.js';

const ok = (data) => ({ data });
const oid = (v) => new mongoose.Types.ObjectId(String(v));

const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60);

/**
 * A display name for a freshly created owner, if one was given and is free.
 *
 * Names are unique, and a clash must not stop an organization being created
 * over something this cosmetic — so a taken name is quietly dropped and the
 * owner is asked for one when they first sign in, which is the behaviour that
 * existed before this field.
 */
async function ownerNameFields(ownerName) {
  const name = String(ownerName ?? '').trim();
  if (name.length < 2) return {};
  const taken = await User.exists({ displayNameLower: name.toLowerCase() });
  if (taken) return {};
  return { displayName: name, displayNameLower: name.toLowerCase() };
}

async function audit(request, action, extra = {}) {
  await AuditLog.create({
    actorId: request.user._id,
    action: `super.${action}`,
    ip: request.ip,
    ...extra,
  }).catch(() => {});
}

/** The Superadmin portal API (prd.md §9). */
export default async function superRoutes(app) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireSuperadmin);

  // ── Tenants (prd.md §9.1) ────────────────────────────────────────────────

  app.get('/spaces', async (request) => {
    const filter = { isPublic: false };
    if (request.query.status) filter.status = request.query.status;
    if (request.query.q) {
      // Escaped, exactly as /super/users does it: an unescaped "(" typed into
      // the search field is an invalid regex, and Mongo throws rather than
      // matching nothing — the list blanked behind an error until the
      // character was deleted.
      const safe = String(request.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.name = { $regex: safe, $options: 'i' };
    }

    const spaces = await Space.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    const counts = await SpaceMember.aggregate([
      { $match: { spaceId: { $in: spaces.map((s) => s._id) }, status: 'active' } },
      { $group: { _id: '$spaceId', n: { $sum: 1 } } },
    ]);
    const byId = new Map(counts.map((c) => [String(c._id), c.n]));

    return ok({
      items: spaces.map((s) => ({
        id: String(s._id),
        name: s.name,
        slug: s.slug,
        logoUrl: s.logoUrl,
        accentColor: s.accentColor,
        status: s.status,
        joinMode: s.joinMode,
        plan: s.plan,
        seatsUsed: byId.get(String(s._id)) ?? 0,
        stats: s.stats,
        createdAt: s.createdAt,
      })),
    });
  });

  app.post(
    '/spaces',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'ownerPhone'],
          properties: {
            name: { type: 'string', minLength: 2, maxLength: 80 },
            ownerPhone: { type: 'string' },
            /**
             * Optional, and worth filling in: an owner created without a name
             * has to be asked for one before they can reach their own console.
             */
            ownerName: { type: 'string', minLength: 2, maxLength: 24 },
            accentColor: { type: 'string', enum: SPACE_ACCENTS },
            seatLimit: { type: 'integer', minimum: 1 },
            tier: { type: 'string', enum: ['trial', 'starter', 'growth', 'institution'] },
          },
        },
      },
    },
    async (request, reply) => {
      const { normalisePhone } = await import('../services/authService.js');
      const phone = normalisePhone(request.body.ownerPhone);

      let owner = await User.findOne({ phone });
      if (!owner) {
        owner = await User.create({
          phone,
          role: 'player',
          ...(await ownerNameFields(request.body.ownerName)),
        });
      } else if (request.body.ownerName && !owner.displayName) {
        // An existing account that never finished sign-up still benefits.
        const fields = await ownerNameFields(request.body.ownerName);
        if (fields.displayName) {
          await User.updateOne({ _id: owner._id }, { $set: fields });
        }
      }

      const space = await Space.create({
        name: request.body.name,
        slug: slugify(request.body.name),
        ownerId: owner._id,
        accentColor: request.body.accentColor ?? SPACE_ACCENTS[0],
        joinCode: await generateUniqueJoinCode(),
        status: 'active',
        approvedAt: new Date(),
        approvedBy: request.user._id,
        plan: {
          tier: request.body.tier ?? 'trial',
          seatLimit: request.body.seatLimit ?? 50,
          status: 'trialing',
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      await SpaceMember.create({
        spaceId: space._id,
        userId: owner._id,
        role: SPACE_ROLE.ADMIN,
        status: 'active',
        approvedAt: new Date(),
      });
      await syncMembershipDenormalisation(owner._id);
      await audit(request, 'space.create', { spaceId: space._id, targetId: space._id, summary: space.name });

      reply.code(201);
      return ok({ ...space.toBrand(), joinCode: space.joinCode, ownerPhone: phone });
    },
  );

  /** prd.md F9.1.1 — approve or reject with a reason. */
  app.post(
    '/spaces/:id/decision',
    {
      schema: {
        body: {
          type: 'object',
          required: ['decision'],
          properties: {
            decision: { type: 'string', enum: ['approve', 'reject', 'suspend', 'reactivate'] },
            reason: { type: 'string', maxLength: 300 },
          },
        },
      },
    },
    async (request) => {
      const space = await Space.findById(request.params.id);
      if (!space || space.isPublic) throw new NotFoundError('That space does not exist.');

      const map = { approve: 'active', reject: 'rejected', suspend: 'suspended', reactivate: 'active' };
      space.status = map[request.body.decision];
      if (request.body.decision === 'approve') {
        space.approvedAt = new Date();
        space.approvedBy = request.user._id;
        if (!space.joinCode) space.joinCode = await generateUniqueJoinCode();
      }
      if (request.body.reason) space.rejectionReason = request.body.reason;
      await space.save();

      await audit(request, `space.${request.body.decision}`, {
        spaceId: space._id,
        targetId: space._id,
        summary: request.body.reason,
      });
      return ok({ status: space.status });
    },
  );

  app.patch('/spaces/:id/plan', async (request) => {
    const space = await Space.findById(request.params.id);
    if (!space) throw new NotFoundError('That space does not exist.');
    space.plan = { ...space.plan.toObject(), ...request.body };
    await space.save();
    await audit(request, 'space.plan', { spaceId: space._id, meta: request.body });
    return ok(space.plan);
  });

  /**
   * prd.md F9.1.4 — impersonate an admin for support. Every session is logged
   * and written into that organization's own audit log, so the impersonation is
   * visible to the people being impersonated rather than only to us.
   */
  app.post(
    '/spaces/:id/impersonate',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: {
        body: {
          type: 'object',
          required: ['reason'],
          properties: { reason: { type: 'string', minLength: 4, maxLength: 300 } },
        },
      },
    },
    async (request) => {
      const space = await Space.findById(request.params.id).lean();
      if (!space) throw new NotFoundError('That space does not exist.');

      const admin = await SpaceMember.findOne({
        spaceId: space._id,
        role: SPACE_ROLE.ADMIN,
        status: 'active',
      })
        .populate('userId')
        .lean();
      if (!admin?.userId) throw new NotFoundError('That space has no active admin.');

      await AuditLog.create({
        spaceId: space._id,
        actorId: admin.userId._id,
        impersonatedBy: request.user._id,
        action: 'super.impersonate',
        summary: request.body.reason,
        ip: request.ip,
      });

      // A short-lived token only — impersonation is a support action, not a
      // standing capability.
      const token = signAccessToken({ ...admin.userId, _id: admin.userId._id });
      return ok({
        accessToken: token,
        actingAs: { id: String(admin.userId._id), displayName: admin.userId.displayName },
        space: { id: String(space._id), name: space.name },
        note: 'This session is recorded in the organization audit log.',
      });
    },
  );

  // ── Central content (prd.md §9.2) ────────────────────────────────────────

  /**
   * The superadmin's own space scope is the Public Space, so the whole admin
   * API works unchanged for central content — the portal simply points at
   * spaceId = public.
   */
  app.get('/central/summary', async () => {
    const [topics, questions, published, categories] = await Promise.all([
      Topic.countDocuments({ spaceId: publicSpaceId }),
      Question.countDocuments({ origin: publicSpaceId }),
      Question.countDocuments({ origin: publicSpaceId, status: QUESTION_STATUS.PUBLISHED }),
      (await import('../models/index.js')).Category.countDocuments({ spaceId: publicSpaceId }),
    ]);
    return ok({ topics, questions, publishedQuestions: published, categories });
  });

  /** prd.md F9.2.3 — curate the public home feed. */
  app.post(
    '/central/topics/:id/feature',
    {
      schema: {
        body: {
          type: 'object',
          required: ['featured'],
          properties: { featured: { type: 'boolean' }, order: { type: 'integer' } },
        },
      },
    },
    async (request) => {
      const topic = await Topic.findOne({ _id: request.params.id, spaceId: publicSpaceId });
      if (!topic) throw new NotFoundError('That topic does not exist.');
      topic.featured = request.body.featured;
      if (request.body.order !== undefined) topic.order = request.body.order;
      await topic.save();
      await audit(request, 'central.feature', { targetId: topic._id, summary: topic.name });
      return ok({ featured: topic.featured });
    },
  );

  // ── Moderation (prd.md §9.3) ─────────────────────────────────────────────

  app.get('/moderation/reports', async (request) => {
    const filter = { status: request.query.status ?? 'open' };
    if (request.query.targetType) filter.targetType = request.query.targetType;

    const reports = await Report.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('reporterId', 'displayName')
      .populate('spaceId', 'name')
      .lean();

    const questionIds = reports.filter((r) => r.targetType === 'question').map((r) => r.targetId);
    const userIds = reports.filter((r) => r.targetType !== 'question').map((r) => r.targetId);

    const [questions, users] = await Promise.all([
      Question.find({ _id: { $in: questionIds } }).lean(),
      User.find({ _id: { $in: userIds } }, { displayName: 1, avatarUrl: 1, status: 1, cheatFlags: 1 }).lean(),
    ]);
    const qById = new Map(questions.map((q) => [String(q._id), q]));
    const uById = new Map(users.map((u) => [String(u._id), u]));

    return ok({
      items: reports.map((r) => ({
        id: String(r._id),
        targetType: r.targetType,
        targetId: String(r.targetId),
        reason: r.reason,
        note: r.note,
        status: r.status,
        space: r.spaceId?.name ?? 'Public Arena',
        reportedBy: r.reporterId?.displayName,
        at: r.createdAt,
        question: qById.get(String(r.targetId)) ? shapeQuestionRow(qById.get(String(r.targetId))) : null,
        user: uById.get(String(r.targetId))
          ? {
              id: String(r.targetId),
              displayName: uById.get(String(r.targetId)).displayName,
              status: uById.get(String(r.targetId)).status,
              cheatFlags: uById.get(String(r.targetId)).cheatFlags,
            }
          : null,
      })),
    });
  });

  app.post(
    '/moderation/reports/:id/resolve',
    {
      schema: {
        body: {
          type: 'object',
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['dismiss', 'archive_question', 'warn_user', 'suspend_user', 'ban_user'],
            },
            note: { type: 'string', maxLength: 300 },
          },
        },
      },
    },
    async (request) => {
      const report = await Report.findById(request.params.id);
      if (!report) throw new NotFoundError('That report does not exist.');

      /**
       * The action has to match what was reported.
       *
       * Nothing checked, so `suspend_user` on a QUESTION report ran an update
       * against a question's id, matched no user, changed nothing — and the
       * report was still marked resolved with that resolution recorded. The
       * queue emptied and the enforcement never happened.
       */
      const allowed = {
        question: ['archive_question', 'dismiss'],
        user: ['suspend_user', 'ban_user', 'warn_user', 'dismiss'],
        displayName: ['warn_user', 'suspend_user', 'ban_user', 'dismiss'],
      }[report.targetType] ?? ['dismiss'];
      if (!allowed.includes(request.body.action)) {
        throw new BadRequestError(
          `A ${report.targetType} report cannot be resolved with "${request.body.action}".`,
          'WRONG_ACTION',
        );
      }

      switch (request.body.action) {
        case 'archive_question':
          await Question.updateOne(
            { _id: report.targetId },
            { $set: { status: QUESTION_STATUS.ARCHIVED, reviewedBy: request.user._id, reviewedAt: new Date() } },
          );
          break;
        case 'suspend_user':
        case 'ban_user':
          await User.updateOne(
            { _id: report.targetId },
            { $set: { status: 'suspended', suspendedReason: request.body.note ?? report.reason } },
          );
          break;
        case 'warn_user':
          await (await import('../services/notificationService.js')).notify(report.targetId, {
            type: 'moderation_warning',
            title: 'A report about your account was upheld',
            body: request.body.note ?? 'Please review the community rules.',
            force: true,
          });
          break;
        default:
          break;
      }

      report.status = request.body.action === 'dismiss' ? 'dismissed' : 'resolved';
      report.resolution = request.body.action;
      report.resolvedBy = request.user._id;
      report.resolvedAt = new Date();
      await report.save();

      await audit(request, `moderation.${request.body.action}`, { targetId: report.targetId });
      return ok({ resolved: true });
    },
  );

  /** prd.md F9.3.4 — automated flags: suspected cheating, abnormal rating gain. */
  app.get('/moderation/flags', async () => {
    const suspects = await User.find(
      { cheatFlags: { $gte: 5 }, status: 'active' },
      { displayName: 1, avatarUrl: 1, cheatFlags: 1, matchesPlayed: 1, overallRating: 1 },
    )
      .sort({ cheatFlags: -1 })
      .limit(50)
      .lean();

    return ok({
      items: suspects.map((u) => ({
        id: String(u._id),
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        flags: u.cheatFlags,
        matchesPlayed: u.matchesPlayed,
        overallRating: u.overallRating,
        reason: 'Sub-300ms answers recorded across multiple matches.',
      })),
    });
  });

  // ── Users (prd.md F9.4.2) ────────────────────────────────────────────────

  app.get('/users', async (request) => {
    const filter = {};
    if (request.query.q) {
      const safe = String(request.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { displayNameLower: { $regex: safe.toLowerCase() } },
        { phone: { $regex: safe } },
      ];
    }
    if (request.query.status) filter.status = request.query.status;
    /**
     * Everybody who has joined one organization.
     *
     * `spaceMemberships` is denormalised onto the user for exactly this kind
     * of question, so "show me this org's players" is one indexed read rather
     * than a join through SpaceMember.
     */
    if (request.query.spaceId) filter.spaceMemberships = oid(request.query.spaceId);

    const page = Number(request.query.page) || 0;
    const pageSize = Math.min(Number(request.query.pageSize) || 50, 100);

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(page * pageSize)
        .limit(pageSize)
        .lean(),
      User.countDocuments(filter),
    ]);
    return ok({
      total,
      page,
      pageSize,
      items: users.map((u) => ({
        id: String(u._id),
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        phone: u.phone,
        status: u.status,
        role: u.role,
        matchesPlayed: u.matchesPlayed,
        overallRating: u.overallRating,
        rankedRating: u.rankedRating,
        cheatFlags: u.cheatFlags,
        /** How many organizations they belong to — the operator's first question. */
        organizations: (u.spaceMemberships ?? []).length,
        createdAt: u.createdAt,
        lastActiveAt: u.lastActiveAt,
      })),
    });
  });

  app.post(
    '/users/:id/status',
    {
      schema: {
        body: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['active', 'suspended'] },
            reason: { type: 'string', maxLength: 300 },
          },
        },
      },
    },
    async (request) => {
      if (String(request.params.id) === String(request.user._id)) {
        throw new BadRequestError('You cannot suspend yourself.');
      }
      const user = await User.findByIdAndUpdate(
        oid(request.params.id),
        { $set: { status: request.body.status, suspendedReason: request.body.reason } },
        { new: true },
      );
      if (!user) throw new NotFoundError('No such user.');
      await audit(request, 'user.status', { targetId: user._id, summary: request.body.status });
      return ok({ status: user.status });
    },
  );

  // ── Platform (prd.md §9.4) ───────────────────────────────────────────────

  app.get('/analytics', async (request) =>
    ok(await platformAnalytics({ days: Number(request.query.days) || 30 })),
  );

  /** tech.md §14 — ghost ratio per topic is the liquidity alarm. */
  app.get('/analytics/liquidity', async () => ok({ items: await ghostRatioByTopic() }));

  app.get('/system', async () => {
    const mem = process.memoryUsage();
    const [liveMatches, matchesToday] = await Promise.all([
      Match.countDocuments({ status: 'live' }),
      Match.countDocuments({ createdAt: { $gte: new Date(Date.now() - 86_400_000) } }),
    ]);
    /**
     * A record the DATABASE thinks is live that the engine is not running.
     *
     * This used to report every live match, so the "stale records — attention"
     * alarm fired constantly during perfectly normal play and the one alert
     * built to catch matches orphaned by a crash became the one an operator
     * learns to ignore. Clamped at zero: the registry can briefly lead the
     * database, and a negative count is not a thing to show anybody.
     */
    const stats = registry.stats();
    const stale = Math.max(0, liveMatches - (stats.liveMatches ?? 0));
    return ok({
      game: stats,
      staleLiveRecords: stale,
      matchesToday,
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      },
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
    });
  });

  /** prd.md F9.4.5 — push an announcement to all users or a segment. */
  app.post(
    '/announce',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
      schema: {
        body: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', maxLength: 80 },
            body: { type: 'string', maxLength: 200 },
            segment: { type: 'string', enum: ['all', 'active_7d', 'inactive_7d'] },
            spaceId: { type: 'string' },
          },
        },
      },
    },
    async (request) => {
      const { notify } = await import('../services/notificationService.js');
      const filter = { status: 'active' };
      if (request.body.segment === 'active_7d') {
        filter.lastActiveAt = { $gte: new Date(Date.now() - 7 * 86_400_000) };
      } else if (request.body.segment === 'inactive_7d') {
        filter.lastActiveAt = { $lt: new Date(Date.now() - 7 * 86_400_000) };
      }
      if (request.body.spaceId) filter.spaceMemberships = oid(request.body.spaceId);

      const users = await User.find(filter, { _id: 1 }).limit(50_000).lean();
      let sent = 0;
      for (const u of users) {
        await notify(u._id, {
          type: 'announcement',
          title: request.body.title,
          body: request.body.body,
        }).catch(() => {});
        sent += 1;
      }
      await audit(request, 'announce', { meta: { sent, segment: request.body.segment } });
      return ok({ sent });
    },
  );

  // ── Progression (leagues-and-progression.md §9) ──────────────────────────
  //
  // The one part of the platform an operator tunes rather than deploys: what
  // can be worn, what it costs, where the leagues sit and what the chests
  // hold. Every write bumps a version the clients watch, and every write is
  // audited — a curve edit moves every player on the platform at once.

  app.get('/progression', async () => {
    const { version, accountCurve, ladder, catalogue, chests, updatedAt } = progression();
    return ok({
      version,
      updatedAt,
      accountCurve,
      maxAccountLevel: ACCOUNT_MAX_LEVEL,
      leagues: ladder.leagues,
      divisions: ladder.divisions,
      divisionWidth: ladder.divisionWidth,
      ratingFloor: RANKED_FLOOR,
      /** Disabled rows included here — this is the screen that re-enables them. */
      cosmetics: catalogue,
      chests,
    });
  });

  app.put(
    '/progression/curve',
    {
      schema: {
        body: {
          type: 'object',
          required: ['curve'],
          properties: {
            curve: {
              type: 'array',
              minItems: 2,
              maxItems: ACCOUNT_MAX_LEVEL,
              items: { type: 'number' },
            },
          },
        },
      },
    },
    async (request) => {
      const { config, floored } = await saveAccountCurve(request.body.curve, {
        actorId: request.user._id,
      });
      await audit(request, 'progression.curve', {
        summary: `Account XP curve saved (${request.body.curve.length} levels)`,
        meta: { floored },
      });
      // `floored` is how many players were pinned at their existing level so
      // the new curve could not demote them — worth surfacing, since a big
      // number means the edit was a steepening.
      return ok({ version: config.version, accountCurve: config.accountCurve, floored });
    },
  );

  app.put(
    '/progression/leagues',
    {
      schema: {
        body: {
          type: 'object',
          required: ['leagues'],
          properties: {
            leagues: {
              type: 'array',
              minItems: 2,
              maxItems: 10,
              items: {
                type: 'object',
                required: ['key', 'name', 'floor'],
                properties: {
                  key: { type: 'string', maxLength: 24 },
                  name: { type: 'string', maxLength: 24 },
                  floor: { type: 'number' },
                  color: { type: ['string', 'null'], maxLength: 9 },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const config = await saveLeagues(request.body.leagues, { actorId: request.user._id });
      await audit(request, 'progression.leagues', {
        summary: `League bands saved (${request.body.leagues.length})`,
      });
      return ok({ version: config.version, leagues: config.ladder.leagues });
    },
  );

  app.put(
    '/progression/divisions',
    {
      schema: {
        body: {
          type: 'object',
          required: ['divisions', 'divisionWidth'],
          properties: {
            divisions: { type: 'number' },
            divisionWidth: { type: 'number' },
          },
        },
      },
    },
    async (request) => {
      const config = await saveDivisions(request.body, { actorId: request.user._id });
      await audit(request, 'progression.divisions', {
        summary: `${request.body.divisions} divisions of ${request.body.divisionWidth}`,
      });
      return ok({
        version: config.version,
        divisions: config.ladder.divisions,
        divisionWidth: config.ladder.divisionWidth,
      });
    },
  );

  app.put(
    '/progression/cosmetics',
    {
      schema: {
        body: {
          type: 'object',
          required: ['type', 'key'],
          properties: {
            type: { type: 'string', enum: COSMETIC_TYPES },
            key: { type: 'string', maxLength: 40 },
            name: { type: 'string', maxLength: 40 },
            unlockKind: { type: 'string', enum: UNLOCK_KINDS },
            unlockLevel: { type: 'number' },
            unlockLeague: { type: ['string', 'null'], maxLength: 24 },
            rarity: { type: ['string', 'null'], enum: [...RARITIES, null] },
            price: { type: ['number', 'null'] },
            imageUrl: { type: ['string', 'null'], maxLength: 500 },
            enabled: { type: 'boolean' },
            order: { type: 'number' },
          },
        },
      },
    },
    async (request) => {
      const saved = await saveCosmetic(request.body, { actorId: request.user._id });
      await audit(request, 'progression.cosmetic', {
        summary: `${request.body.type} "${request.body.key}" saved`,
      });
      return ok(saved);
    },
  );

  app.delete('/progression/cosmetics/:type/:key', async (request) => {
    const result = await deleteCosmetic(request.params.type, request.params.key, {
      actorId: request.user._id,
    });
    await audit(request, 'progression.cosmetic.delete', {
      summary: `${request.params.type} "${request.params.key}" removed`,
    });
    return ok(result);
  });

  app.put(
    '/progression/chests',
    {
      schema: {
        body: {
          type: 'object',
          required: ['key', 'rewards'],
          properties: {
            key: { type: 'string', maxLength: 40 },
            name: { type: 'string', maxLength: 40 },
            description: { type: 'string', maxLength: 160 },
            triggerKind: { type: 'string', enum: CHEST_TRIGGERS },
            triggerRating: { type: ['number', 'null'] },
            triggerLeague: { type: ['string', 'null'], maxLength: 24 },
            /** Monthly is the two built-in chests only; anything made here is once. */
            recurrence: { type: 'string', enum: CHEST_RECURRENCES },
            /**
             * The slots, up to the twenty a chest holds. A slot is a cosmetic
             * or an amount of coins — opening draws one of them, so this list
             * IS the drop table an operator is editing.
             */
            rewards: {
              type: 'array',
              minItems: 1,
              maxItems: CHEST_SLOT_COUNT,
              items: {
                type: 'object',
                required: ['type'],
                properties: {
                  type: { type: 'string', enum: [...COSMETIC_TYPES, 'coins'] },
                  key: { type: ['string', 'null'], maxLength: 40 },
                  amount: { type: ['number', 'null'] },
                },
              },
            },
            enabled: { type: 'boolean' },
            order: { type: 'number' },
          },
        },
      },
    },
    async (request) => {
      const saved = await saveChest(request.body, { actorId: request.user._id });
      await audit(request, 'progression.chest', { summary: `Chest "${request.body.key}" saved` });
      return ok(saved);
    },
  );

  app.delete('/progression/chests/:key', async (request) => {
    const result = await deleteChest(request.params.key, { actorId: request.user._id });
    await audit(request, 'progression.chest.delete', {
      summary: `Chest "${request.params.key}" removed`,
    });
    return ok(result);
  });

  app.get('/audit', async (request) => {
    const rows = await AuditLog.find(request.query.spaceId ? { spaceId: oid(request.query.spaceId) } : {})
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('actorId', 'displayName')
      .populate('spaceId', 'name')
      .lean();
    return ok({
      items: rows.map((r) => ({
        id: String(r._id),
        action: r.action,
        actor: r.actorId?.displayName,
        space: r.spaceId?.name ?? 'Platform',
        summary: r.summary,
        impersonated: Boolean(r.impersonatedBy),
        at: r.createdAt,
      })),
    });
  });
}

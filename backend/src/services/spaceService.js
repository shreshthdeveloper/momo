import mongoose from 'mongoose';
import { Space, SpaceMember, User, Topic, publicSpaceId, isPublicSpace } from '../models/index.js';
import { ForbiddenError, NotFoundError, ConflictError, BadRequestError } from '../lib/errors.js';
import { SPACE_ROLE, JOIN_MODE, PLATFORM_ROLE, TOPIC_STATUS } from '../shared/constants.js';
import { randomJoinCode } from '../lib/crypto.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Tenant scope resolution — the single enforcement point (tech.md §4).
 *
 * **The client never supplies a spaceId that is trusted.** A requested id is
 * validated against memberships read live from the database before any query
 * runs, and callers receive a resolved scope object rather than the raw id
 * they asked for. Both the REST middleware and the socket gateway route
 * through here, so there is exactly one place this can be got wrong.
 *
 * Membership is read from `spaceMembers`, not from the denormalised
 * `user.spaceMemberships` array — that array exists to make a *negative* check
 * fast, never to authorise access on its own.
 */
export async function resolveScope(user, requestedSpaceId) {
  // No space requested, or the Public Arena: open to every signed-in user.
  if (!requestedSpaceId || isPublicSpace(requestedSpaceId)) {
    // The Central Bank is the public space's question bank, and the platform
    // operator administers it. Only an EXPLICIT request for the public space
    // elevates — a superadmin browsing the app with no spaceId plays as an
    // ordinary player.
    if (requestedSpaceId && user?.role === PLATFORM_ROLE.SUPERADMIN) {
      const space = await Space.findById(publicSpaceId).lean();
      return {
        spaceId: publicSpaceId,
        isPublic: true,
        role: SPACE_ROLE.ADMIN,
        batchId: null,
        permissions: null,
        viaSuperadmin: true,
        space,
      };
    }
    return {
      spaceId: publicSpaceId,
      isPublic: true,
      role: null,
      batchId: null,
      permissions: null,
    };
  }

  if (!mongoose.isValidObjectId(requestedSpaceId)) {
    throw new ForbiddenError('You are not a member of that space.', 'NOT_A_MEMBER');
  }

  // A superadmin may act in any space, but the access is explicit and logged
  // rather than implicit — see auditLog on every admin write.
  if (user?.role === PLATFORM_ROLE.SUPERADMIN) {
    const space = await Space.findById(oid(requestedSpaceId)).lean();
    if (!space) throw new NotFoundError('That space does not exist.');
    return {
      spaceId: space._id,
      isPublic: Boolean(space.isPublic),
      role: SPACE_ROLE.ADMIN,
      batchId: null,
      permissions: null,
      viaSuperadmin: true,
      space,
    };
  }

  const member = await SpaceMember.findOne({
    spaceId: oid(requestedSpaceId),
    userId: oid(user.id ?? user._id),
    status: 'active',
  }).lean();

  if (!member) throw new ForbiddenError('You are not a member of that space.', 'NOT_A_MEMBER');

  const space = await Space.findById(oid(requestedSpaceId)).lean();
  if (!space) throw new NotFoundError('That space does not exist.');
  if (space.status === 'suspended') {
    throw new ForbiddenError('This space is suspended.', 'SPACE_SUSPENDED');
  }

  return {
    spaceId: space._id,
    isPublic: Boolean(space.isPublic),
    role: member.role,
    batchId: member.batchId ?? null,
    permissions: member.permissions ?? null,
    space,
  };
}

/** Admin-or-better inside a resolved scope. */
export function assertSpaceAdmin(scope) {
  if (scope.role !== SPACE_ROLE.ADMIN && scope.role !== SPACE_ROLE.SUB_ADMIN) {
    throw new ForbiddenError('Only space admins can do this.');
  }
  return scope;
}

/** prd.md F8.7.3 — sub-admin permissions are granular; admins hold them all. */
export function assertPermission(scope, permission) {
  assertSpaceAdmin(scope);
  if (scope.role === SPACE_ROLE.ADMIN) return scope;
  if (!scope.permissions?.[permission]) {
    throw new ForbiddenError('Your role does not include that permission.', 'MISSING_PERMISSION');
  }
  return scope;
}

/**
 * Resolve a topic *and* prove the caller may play it.
 *
 * prd.md §5.1 rule 4 — matchmaking for a space topic draws only from that
 * space's members, which starts with only that space's members being able to
 * reach the topic at all.
 */
export async function resolvePlayableTopic(user, topicId, requestedSpaceId) {
  if (!mongoose.isValidObjectId(topicId)) throw new NotFoundError('That topic does not exist.');

  const topic = await Topic.findById(oid(topicId));
  if (!topic) throw new NotFoundError('That topic does not exist.');

  // The scope comes from the TOPIC, not from what the client claimed. If they
  // disagree, the topic wins and membership is checked against it.
  const scope = await resolveScope(user, topic.spaceId);
  if (requestedSpaceId && String(topic.spaceId) !== String(scope.spaceId)) {
    throw new ForbiddenError('That topic is not in this space.', 'NOT_A_MEMBER');
  }

  if (topic.status !== TOPIC_STATUS.PUBLISHED) {
    throw new NotFoundError('That topic is not available.', 'TOPIC_UNAVAILABLE');
  }

  // prd.md F8.3.4 — a batch-scoped topic is invisible to other batches.
  if (topic.batchIds?.length && scope.role === SPACE_ROLE.STUDENT) {
    const inBatch = topic.batchIds.some((b) => String(b) === String(scope.batchId));
    if (!inBatch) throw new NotFoundError('That topic is not available.', 'TOPIC_UNAVAILABLE');
  }

  return { topic, scope };
}

// ── Membership lifecycle ───────────────────────────────────────────────────

/** prd.md F7.1 — join via 6-character code. */
export async function joinByCode(user, code) {
  const space = await Space.findOne({ joinCode: String(code).toUpperCase().trim() });
  if (!space) throw new NotFoundError('No space matches that code.', 'BAD_JOIN_CODE');
  if (space.status !== 'active') {
    throw new ForbiddenError('That space is not accepting members right now.');
  }
  if (space.joinMode === JOIN_MODE.INVITE) {
    throw new ForbiddenError('That space is invite-only. Ask your organization for a link.');
  }
  return joinSpace(user, space);
}

export async function joinSpace(user, space) {
  const userId = oid(user.id ?? user._id);
  const existing = await SpaceMember.findOne({ spaceId: space._id, userId });

  if (existing) {
    if (existing.status === 'active') throw new ConflictError('You are already in this space.');
    if (existing.status === 'suspended') {
      throw new ForbiddenError('Your access to this space was suspended.');
    }
    // Re-joining after leaving: prd.md F7.8 makes leaving free, so re-entry
    // goes back through whatever the space's join mode requires.
    existing.status = space.joinMode === JOIN_MODE.OPEN ? 'active' : 'pending';
    existing.joinedAt = new Date();
    existing.leftAt = null;
    await existing.save();
    await syncMembershipDenormalisation(userId);
    return { membership: existing, space };
  }

  const activeCount = await SpaceMember.countDocuments({ spaceId: space._id, status: 'active' });
  if (activeCount >= (space.plan?.seatLimit ?? Infinity)) {
    throw new ForbiddenError('This space has no seats left. Ask your organization to add more.');
  }

  const membership = await SpaceMember.create({
    spaceId: space._id,
    userId,
    role: SPACE_ROLE.STUDENT,
    status: space.joinMode === JOIN_MODE.OPEN ? 'active' : 'pending',
    approvedAt: space.joinMode === JOIN_MODE.OPEN ? new Date() : undefined,
  });

  await syncMembershipDenormalisation(userId);
  return { membership, space };
}

/** prd.md F7.8 — a student may always leave, without admin permission. */
export async function leaveSpace(user, spaceId) {
  const userId = oid(user.id ?? user._id);
  const membership = await SpaceMember.findOne({ spaceId: oid(spaceId), userId });
  if (!membership) throw new NotFoundError('You are not in that space.');

  if (membership.role === SPACE_ROLE.ADMIN) {
    const otherAdmins = await SpaceMember.countDocuments({
      spaceId: oid(spaceId),
      role: SPACE_ROLE.ADMIN,
      status: 'active',
      _id: { $ne: membership._id },
    });
    if (!otherAdmins) {
      throw new BadRequestError(
        'You are the only admin. Make someone else an admin first, or ask support to close the space.',
        'LAST_ADMIN',
      );
    }
  }

  membership.status = 'left';
  membership.leftAt = new Date();
  await membership.save();
  await syncMembershipDenormalisation(userId);
  return membership;
}

/**
 * prd.md §5.1 rule 6 — leaving removes access and leaderboard presence but
 * does not delete the account. Ratings stay; they are simply filtered out by
 * the membership check on every space-scoped read.
 */
export async function syncMembershipDenormalisation(userId) {
  // tenant-ok: this IS the query that resolves which spaces a user belongs
  // to. It is keyed by userId and returns only spaceIds, and its result is
  // what every later scope check is validated against.
  const active = await SpaceMember.find(
    { userId: oid(userId), status: 'active' },
    { spaceId: 1 },
  ).lean();
  await User.updateOne(
    { _id: oid(userId) },
    { $set: { spaceMemberships: active.map((m) => m.spaceId) } },
  );
  return active.map((m) => m.spaceId);
}

export async function listMySpaces(userId) {
  // tenant-ok: the space switcher (F6.2.5) lists the caller's own
  // memberships across every space, keyed by their own userId.
  const memberships = await SpaceMember.find({
    userId: oid(userId),
    status: { $in: ['active', 'pending'] },
  })
    .populate('spaceId')
    .lean();

  return memberships
    .filter((m) => m.spaceId)
    .map((m) => ({
      id: String(m.spaceId._id),
      name: m.spaceId.name,
      slug: m.spaceId.slug,
      logoUrl: m.spaceId.logoUrl,
      accentColor: m.spaceId.accentColor,
      isPublic: Boolean(m.spaceId.isPublic),
      role: m.role,
      status: m.status,
      batchId: m.batchId ? String(m.batchId) : null,
      // Granular sub-admin grants (F8.7.3): the client gates what it SHOWS on
      // these; every /admin route re-checks them server-side.
      permissions: m.permissions ?? null,
      roundDurationMs: m.spaceId.settings?.roundDurationMs,
      joinedAt: m.joinedAt,
    }));
}

export async function generateUniqueJoinCode(attempts = 8) {
  for (let i = 0; i < attempts; i += 1) {
    const code = randomJoinCode(6);
    const taken = await Space.exists({ joinCode: code });
    if (!taken) return code;
  }
  throw new Error('Could not allocate a join code');
}

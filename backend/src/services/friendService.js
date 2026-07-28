import mongoose from 'mongoose';
import { User } from '../models/index.js';
import { Friendship, Challenge } from '../models/social.js';
import { Topic, Match } from '../models/index.js';
import { headToHead } from './matchService.js';
import { notify } from './notificationService.js';
import { BadRequestError, NotFoundError, ConflictError, ForbiddenError } from '../lib/errors.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Friends and challenges (prd.md §6.8, §6.3).
 *
 * Friendships are stored one row per pair with `userA < userB`, so two people
 * pressing "add friend" at the same instant produce one row, not two.
 */

export async function sendFriendRequest(user, targetId) {
  if (String(user._id) === String(targetId)) {
    throw new BadRequestError('You cannot add yourself.');
  }
  const target = await User.findById(oid(targetId), { status: 1, blockedUsers: 1, isMinor: 1 }).lean();
  if (!target || target.status !== 'active') throw new NotFoundError('No such player.');

  if ((target.blockedUsers ?? []).some((id) => String(id) === String(user._id))) {
    // Deliberately indistinguishable from "no such player" — telling someone
    // they have been blocked is itself a form of contact.
    throw new NotFoundError('No such player.');
  }
  if ((user.blockedUsers ?? []).some((id) => String(id) === String(targetId))) {
    throw new BadRequestError('Unblock them first.');
  }

  const pair = Friendship.pairOf(user._id, targetId);
  const existing = await Friendship.findOne({ userA: oid(pair.userA), userB: oid(pair.userB) });

  if (existing) {
    if (existing.status === 'accepted') throw new ConflictError('You are already friends.');
    if (existing.status === 'blocked') throw new ForbiddenError('You cannot add this player.');
    if (existing.status === 'pending') {
      // They already asked us — treat a second request as an accept, which is
      // what the person pressing the button means.
      if (String(existing.requestedBy) !== String(user._id)) {
        return acceptFriendRequest(user, existing._id);
      }
      throw new ConflictError('Request already sent.');
    }
    existing.status = 'pending';
    existing.requestedBy = oid(user._id);
    existing.respondedAt = null;
    await existing.save();
    await notifyRequest(user, targetId);
    return existing;
  }

  const friendship = await Friendship.create({
    userA: oid(pair.userA),
    userB: oid(pair.userB),
    requestedBy: oid(user._id),
    status: 'pending',
  });
  await notifyRequest(user, targetId);
  return friendship;
}

async function notifyRequest(from, toUserId) {
  await notify(toUserId, {
    type: 'friend_request',
    prefKey: 'friendChallenge',
    title: `${from.displayName} wants to be friends`,
    data: { userId: String(from._id) },
  });
}

export async function acceptFriendRequest(user, friendshipId) {
  const friendship = await Friendship.findById(oid(friendshipId));
  if (!friendship) throw new NotFoundError('That request no longer exists.');

  const involved = [String(friendship.userA), String(friendship.userB)];
  if (!involved.includes(String(user._id))) throw new ForbiddenError('That is not your request.');
  if (String(friendship.requestedBy) === String(user._id)) {
    throw new BadRequestError('They have not accepted yet.');
  }

  friendship.status = 'accepted';
  friendship.respondedAt = new Date();
  await friendship.save();

  await notify(friendship.requestedBy, {
    type: 'friend_accepted',
    prefKey: 'friendAccepted',
    title: `${user.displayName} accepted your request`,
    data: { userId: String(user._id) },
  });

  return friendship;
}

export async function declineFriendRequest(user, friendshipId) {
  const friendship = await Friendship.findById(oid(friendshipId));
  if (!friendship) throw new NotFoundError('That request no longer exists.');
  const involved = [String(friendship.userA), String(friendship.userB)];
  if (!involved.includes(String(user._id))) throw new ForbiddenError('That is not your request.');

  friendship.status = 'declined';
  friendship.respondedAt = new Date();
  await friendship.save();
  return friendship;
}

export async function removeFriend(user, targetId) {
  const pair = Friendship.pairOf(user._id, targetId);
  await Friendship.deleteOne({ userA: oid(pair.userA), userB: oid(pair.userB), status: 'accepted' });
  return { removed: true };
}

export async function listFriends(user) {
  const rows = await Friendship.find({
    $or: [{ userA: user._id }, { userB: user._id }],
    status: { $in: ['pending', 'accepted'] },
  }).lean();

  const otherIds = rows.map((r) =>
    String(r.userA) === String(user._id) ? r.userB : r.userA,
  );
  const users = await User.find(
    { _id: { $in: otherIds }, status: 'active' },
    { displayName: 1, avatarUrl: 1, city: 1, overallRating: 1, rankedRating: 1, lastActiveAt: 1 },
  ).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));

  const friends = [];
  const incoming = [];
  const outgoing = [];

  for (const row of rows) {
    const otherId = String(row.userA) === String(user._id) ? row.userB : row.userA;
    const other = byId.get(String(otherId));
    if (!other) continue;

    const entry = {
      friendshipId: String(row._id),
      id: String(other._id),
      displayName: other.displayName,
      avatarUrl: other.avatarUrl,
      city: other.city,
      overallRating: other.overallRating,
      // The friends list shows a league badge, which reads from the global
      // ladder rather than the mean-of-topics figure.
      rankedRating: other.rankedRating,
      // "Online" is a five-minute window — precise presence would need the
      // socket registry, which does not survive the process.
      isOnline: other.lastActiveAt && Date.now() - new Date(other.lastActiveAt) < 5 * 60 * 1000,
      since: row.respondedAt ?? row.createdAt,
    };

    if (row.status === 'accepted') friends.push(entry);
    else if (String(row.requestedBy) === String(user._id)) outgoing.push(entry);
    else incoming.push(entry);
  }

  return { friends, incoming, outgoing };
}

/**
 * Who to suggest, for a player whose friend list is empty or nearly so.
 *
 * The answer is the people they have just played. It beats every other source
 * available to us — there is no contact import, no mutual-friend graph worth
 * traversing at this size, and "players near your rating" suggests strangers.
 * Somebody you went seven questions with ten minutes ago is a person, and the
 * screen can say why they are being suggested, which is what makes a suggestion
 * something other than noise.
 *
 * Excluded: ghosts (they have no account), anyone already in a `Friendship` row
 * in ANY state — accepted, pending, declined, blocked — because re-offering
 * someone who declined is the exact behaviour that makes people distrust a
 * suggestion list, and blocks are mutual and silent.
 */
export async function recentOpponents(user, { limit = 8, lookbackDays = 60 } = {}) {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const rows = await Match.aggregate([
    {
      $match: {
        // `complete`, not `completed` — the enum on the Match schema. Getting
        // this wrong is silent: the pipeline matches nothing and the endpoint
        // returns an empty list that looks exactly like "no recent opponents".
        status: 'complete',
        createdAt: { $gte: since },
        'players.userId': oid(user._id),
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: 120 },
    { $unwind: '$players' },
    // The viewer's own row, and every ghost, drop out here rather than after
    // the group — a ghost has no userId, so it would otherwise group to null.
    {
      $match: {
        'players.isGhost': { $ne: true },
        'players.userId': { $exists: true, $ne: oid(user._id) },
      },
    },
    {
      $group: {
        _id: '$players.userId',
        matches: { $sum: 1 },
        lastPlayedAt: { $max: '$createdAt' },
      },
    },
    { $sort: { lastPlayedAt: -1 } },
    { $limit: limit * 3 },
  ]);
  if (!rows.length) return [];

  const known = await Friendship.find(
    {
      $or: [
        { userA: user._id, userB: { $in: rows.map((r) => r._id) } },
        { userB: user._id, userA: { $in: rows.map((r) => r._id) } },
      ],
    },
    { userA: 1, userB: 1 },
  ).lean();

  const skip = new Set([
    ...known.flatMap((f) => [String(f.userA), String(f.userB)]),
    ...(user.blockedUsers ?? []).map(String),
    String(user._id),
  ]);

  const candidates = rows.filter((r) => !skip.has(String(r._id))).slice(0, limit);
  if (!candidates.length) return [];

  const users = await User.find(
    { _id: { $in: candidates.map((r) => r._id) }, status: 'active' },
    { displayName: 1, avatarUrl: 1, city: 1, rankedRating: 1, blockedUsers: 1 },
  ).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));

  return candidates
    .map((row) => {
      const other = byId.get(String(row._id));
      if (!other) return null;
      // Same rule as `sendFriendRequest`: somebody who blocked you is not
      // shown to you at all, rather than shown and then refused.
      if ((other.blockedUsers ?? []).some((id) => String(id) === String(user._id))) return null;
      return {
        id: String(other._id),
        displayName: other.displayName,
        avatarUrl: other.avatarUrl ?? null,
        city: other.city ?? null,
        rankedRating: other.rankedRating,
        matches: row.matches,
        lastPlayedAt: row.lastPlayedAt,
      };
    })
    .filter(Boolean);
}

// ── Challenges (prd.md §6.3, F6.8.1) ───────────────────────────────────────

const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;

export async function createChallenge(user, { toUserId, topicId }) {
  const friendship = await Friendship.findOne({
    ...Friendship.pairOf(user._id, toUserId),
    status: 'accepted',
  }).lean();
  if (!friendship) throw new ForbiddenError('You can only challenge friends.');

  const topic = await Topic.findById(oid(topicId)).lean();
  if (!topic || topic.status !== 'published') throw new NotFoundError('That topic is not available.');

  const open = await Challenge.findOne({
    fromUserId: user._id,
    toUserId: oid(toUserId),
    status: 'pending',
    expiresAt: { $gt: new Date() },
  }).lean();
  if (open) throw new ConflictError('You already have a challenge open with them.');

  const challenge = await Challenge.create({
    fromUserId: user._id,
    toUserId: oid(toUserId),
    topicId: topic._id,
    spaceId: topic.spaceId,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });

  await notify(toUserId, {
    type: 'challenge',
    prefKey: 'friendChallenge',
    title: `${user.displayName} challenged you`,
    body: `${topic.name} — you have 24 hours.`,
    data: { challengeId: String(challenge._id), topicId: String(topic._id) },
  });

  return challenge;
}

export async function listChallenges(user) {
  const rows = await Challenge.find({
    $or: [{ fromUserId: user._id }, { toUserId: user._id }],
    status: { $in: ['pending', 'accepted'] },
    expiresAt: { $gt: new Date() },
  })
    .populate('topicId', 'name coverUrl')
    .populate('fromUserId', 'displayName avatarUrl')
    .populate('toUserId', 'displayName avatarUrl')
    .sort({ createdAt: -1 })
    .lean();

  return rows.map((c) => ({
    id: String(c._id),
    direction: String(c.fromUserId._id) === String(user._id) ? 'outgoing' : 'incoming',
    topic: c.topicId ? { id: String(c.topicId._id), name: c.topicId.name, coverUrl: c.topicId.coverUrl } : null,
    opponent:
      String(c.fromUserId._id) === String(user._id)
        ? { id: String(c.toUserId._id), displayName: c.toUserId.displayName, avatarUrl: c.toUserId.avatarUrl }
        : { id: String(c.fromUserId._id), displayName: c.fromUserId.displayName, avatarUrl: c.fromUserId.avatarUrl },
    status: c.status,
    expiresAt: c.expiresAt,
  }));
}

/**
 * The challenge a player is about to actually play, or a reason they cannot.
 *
 * Accepting a challenge used to be where the feature stopped: it set a status
 * and nothing anywhere turned that into a match. This is the missing step —
 * the orchestrator calls it to find out whether this person may enter this
 * challenge's private queue, and the topic comes from the CHALLENGE rather
 * than from the client, so neither side can quietly play a different one.
 */
export async function playableChallenge(user, challengeId) {
  const userId = String(user._id ?? user.id);
  if (!mongoose.isValidObjectId(challengeId)) {
    throw new NotFoundError('That challenge no longer exists.');
  }

  const challenge = await Challenge.findById(oid(challengeId)).lean();
  if (!challenge) throw new NotFoundError('That challenge no longer exists.');

  const mine =
    String(challenge.fromUserId) === userId || String(challenge.toUserId) === userId;
  if (!mine) throw new ForbiddenError('That challenge is not yours.');

  if (challenge.status === 'complete') {
    throw new BadRequestError('You have already played that challenge.', 'CHALLENGE_PLAYED');
  }
  if (challenge.status !== 'accepted') {
    throw new BadRequestError(
      'They have not accepted that challenge yet.',
      'CHALLENGE_NOT_ACCEPTED',
    );
  }
  if (challenge.expiresAt < new Date()) {
    throw new BadRequestError('That challenge expired.', 'CHALLENGE_EXPIRED');
  }

  return challenge;
}

/**
 * Spend the challenge, at the moment the two of them are actually paired.
 *
 * Marked on START rather than on completion, and deliberately: threading a
 * challenge id through the engine, the match record and the summary would be
 * four files of plumbing to answer a question that is already settled here —
 * these two met, so the challenge has been honoured. A match somebody then
 * walks out of is a forfeit, which is a result, not an unplayed challenge.
 */
export async function markChallengePlayed(challengeId) {
  await Challenge.updateOne(
    { _id: oid(challengeId), status: 'accepted' },
    { $set: { status: 'complete', playedAt: new Date() } },
  );
}

export async function respondToChallenge(user, challengeId, accept) {
  const challenge = await Challenge.findById(oid(challengeId));
  if (!challenge) throw new NotFoundError('That challenge no longer exists.');
  if (String(challenge.toUserId) !== String(user._id)) {
    throw new ForbiddenError('That challenge is not yours.');
  }
  if (challenge.expiresAt < new Date()) {
    challenge.status = 'expired';
    await challenge.save();
    throw new BadRequestError('That challenge expired.', 'CHALLENGE_EXPIRED');
  }

  challenge.status = accept ? 'accepted' : 'declined';
  challenge.respondedAt = new Date();
  await challenge.save();
  return challenge;
}

export { headToHead };

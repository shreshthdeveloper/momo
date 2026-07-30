import mongoose from 'mongoose';
import { User, Notification } from '../models/index.js';
import { Friendship, Challenge } from '../models/social.js';
import { Topic, Match } from '../models/index.js';
import { headToHead, headToHeadMany as headToHeadHelper } from './matchService.js';
import { notify } from './notificationService.js';
import { BadRequestError, NotFoundError, ConflictError, ForbiddenError } from '../lib/errors.js';
import {
  CHALLENGE_ACCEPT_WINDOW_MS,
  CHALLENGE_PLAY_WINDOW_MS,
  CHALLENGE_ACCEPT_WINDOW_LABEL,
  FRIEND_REACTIONS,
  FRIEND_REACTION_COOLDOWN_MS,
} from '../shared/constants.js';

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

  /**
   * The record against each friend — "you are 4–3 against Garv".
   *
   * `headToHead` was computed and sent on the versus screen and on a profile, and
   * nowhere in the app said it on the list where you choose who to challenge. A
   * rivalry is the thing that makes a friends list worth opening twice, and the
   * number was already being calculated.
   *
   * Friends only. A pending request is not a rivalry, and offering a scoreline to
   * somebody who has not accepted you yet reads as needling.
   */
  const records = await headToHeadHelper(user._id, friends.map((f) => f.id));
  for (const friend of friends) {
    // Absent rather than zeroed when they have never played: the row draws
    // nothing at all, which is the truth, instead of a 0–0 that looks like a
    // rivalry yet to start.
    friend.headToHead = records.get(friend.id) ?? null;
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

// ── Reactions (constants.js — FRIEND_REACTIONS) ────────────────────────────

/**
 * Send one of the fixed reactions to a friend.
 *
 * The whole surface is a key from a list this file also owns, so there is no
 * user-authored text anywhere in the path — which is the entire reason this
 * exists in place of chat. See the note on `FRIEND_REACTIONS`.
 *
 * It rides the notification system rather than inventing a second inbox: quiet
 * hours, the per-category toggle, the in-app list and the sixty-day TTL are all
 * already correct there, and a reaction that ignored quiet hours would be the
 * single most annoying thing the app could do.
 */
export async function sendReaction(user, targetId, key) {
  const reaction = FRIEND_REACTIONS.find((r) => r.key === key);
  if (!reaction) throw new BadRequestError('That is not a reaction.');
  if (String(user._id) === String(targetId)) {
    throw new BadRequestError('You cannot react to yourself.');
  }
  if (!mongoose.isValidObjectId(targetId)) throw new NotFoundError('No such player.');

  const friendship = await Friendship.findOne({
    ...Friendship.pairOf(user._id, targetId),
    status: 'accepted',
  }).lean();
  if (!friendship) throw new ForbiddenError('You can only react to friends.');

  // Same rule as `sendFriendRequest`: a block is silent and indistinguishable
  // from the player not existing, because "you have been blocked" is itself a
  // message from the person who blocked you.
  const target = await User.findById(oid(targetId), { status: 1, blockedUsers: 1 }).lean();
  if (!target || target.status !== 'active') throw new NotFoundError('No such player.');
  if ((target.blockedUsers ?? []).some((id) => String(id) === String(user._id))) {
    throw new NotFoundError('No such player.');
  }

  /**
   * The cooldown is measured against what was actually DELIVERED, not against a
   * counter kept somewhere else, so it cannot drift out of step with the inbox
   * the recipient is looking at. The `(userId, createdAt)` index carries it.
   */
  const recent = await Notification.findOne(
    {
      userId: oid(targetId),
      type: 'friend_reaction',
      'data.userId': String(user._id),
      createdAt: { $gt: new Date(Date.now() - FRIEND_REACTION_COOLDOWN_MS) },
    },
    { createdAt: 1 },
  ).lean();
  if (recent) {
    const waitMs = FRIEND_REACTION_COOLDOWN_MS - (Date.now() - new Date(recent.createdAt));
    throw new ConflictError(
      `Give them a moment — you can send another in ${Math.max(1, Math.ceil(waitMs / 1000))}s.`,
      'REACTION_COOLDOWN',
    );
  }

  await notify(targetId, {
    type: 'friend_reaction',
    prefKey: 'friendReaction',
    title: `${user.displayName} ${reaction.message}`,
    data: { userId: String(user._id), reaction: reaction.key },
  });

  return { sent: true, key: reaction.key };
}

// ── Challenges (prd.md §6.3, F6.8.1) ───────────────────────────────────────

export async function createChallenge(user, { toUserId, topicId }) {
  const friendship = await Friendship.findOne({
    ...Friendship.pairOf(user._id, toUserId),
    status: 'accepted',
  }).lean();
  if (!friendship) throw new ForbiddenError('You can only challenge friends.');

  const topic = await Topic.findById(oid(topicId)).lean();
  if (!topic || topic.status !== 'published') throw new NotFoundError('That topic is not available.');

  /**
   * `accepted` counts as open too. It did not, so a challenge that had been
   * accepted but not yet played left the door open for a second one to the
   * same person — two live invitations between two people, only one of which
   * either of them could act on.
   *
   * Re-sending after the window lapses is deliberately allowed, and is the
   * normal way to use this: the invitation is cheap and short-lived, so
   * "they missed it, ask again" is one tap rather than an error.
   */
  const open = await Challenge.findOne({
    fromUserId: user._id,
    toUserId: oid(toUserId),
    status: { $in: ['pending', 'accepted'] },
    expiresAt: { $gt: new Date() },
  }).lean();
  if (open) throw new ConflictError('You already have a challenge open with them.');

  const challenge = await Challenge.create({
    fromUserId: user._id,
    toUserId: oid(toUserId),
    topicId: topic._id,
    spaceId: topic.spaceId,
    expiresAt: new Date(Date.now() + CHALLENGE_ACCEPT_WINDOW_MS),
  });

  await notify(toUserId, {
    type: 'challenge',
    prefKey: 'friendChallenge',
    title: `${user.displayName} challenged you`,
    body: `${topic.name} — join in the next ${CHALLENGE_ACCEPT_WINDOW_LABEL}.`,
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

/**
 * Withdraw an open challenge, from either side.
 *
 * `respondToChallenge` is the recipient's answer and is restricted to them,
 * which left two states with no way out at all: a challenger who thought better
 * of it could not take it back, and once accepted NEITHER of them could — the
 * row simply sat there being offered until its deadline passed. Two minutes is
 * short enough that waiting it out is survivable and long enough that being
 * unable to clear a challenge you are not going to play is an irritation on the
 * one screen this feature lives on.
 *
 * Either participant may call it, and only while the challenge is still open —
 * a played challenge is history and is not rewritten.
 */
export async function cancelChallenge(user, challengeId) {
  const challenge = await Challenge.findById(oid(challengeId));
  if (!challenge) throw new NotFoundError('That challenge no longer exists.');

  const userId = String(user._id ?? user.id);
  const mine =
    String(challenge.fromUserId) === userId || String(challenge.toUserId) === userId;
  if (!mine) throw new ForbiddenError('That challenge is not yours.');

  if (!['pending', 'accepted'].includes(challenge.status)) {
    throw new BadRequestError('That challenge is already closed.', 'CHALLENGE_CLOSED');
  }

  challenge.status = 'cancelled';
  challenge.respondedAt = new Date();
  await challenge.save();
  return challenge;
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
  /**
   * Accepting restarts the clock rather than inheriting what is left of the
   * accept window.
   *
   * Two separate things are being timed and they were sharing one deadline:
   * "will they answer" and, once answered, "will the two of them actually meet
   * in the queue". A player who accepted with four seconds left had no chance
   * at the second, and an accepted challenge was never expired by anything at
   * all — `expireChallenges` only ever looked at `pending` — so it sat in the
   * list as a live-looking invitation that `playableChallenge` would refuse.
   */
  if (accept) challenge.expiresAt = new Date(Date.now() + CHALLENGE_PLAY_WINDOW_MS);
  await challenge.save();

  /**
   * The challenger is told, because they are the one who has to be in the app
   * for this to work and they have two minutes to find out. Without it the
   * accept is silent and the window burns while they look at another screen.
   */
  if (accept) {
    const topic = await Topic.findById(challenge.topicId).lean();
    await notify(challenge.fromUserId, {
      type: 'challenge',
      prefKey: 'friendChallenge',
      title: `${user.displayName} accepted`,
      body: `${topic?.name ?? 'Your challenge'} — play now, ${CHALLENGE_ACCEPT_WINDOW_LABEL} left.`,
      data: { challengeId: String(challenge._id), topicId: String(challenge.topicId) },
    }).catch(() => {});
  }

  return challenge;
}

export { headToHead };

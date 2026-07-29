import mongoose from 'mongoose';
import { User, Rating, Match, Topic, publicSpaceId } from '../models/index.js';
import { Friendship } from '../models/social.js';
import { headToHead } from './matchService.js';
import { levelForXp, effectiveAccountLevel } from '../shared/mastery.js';
import { leagueFor } from '../shared/league.js';
import { findCosmetic, ownsCosmetic, lockedMessage } from '../shared/perks.js';
import { progression } from './progressionService.js';
import {
  COSMETIC_TYPE,
  INTERESTS_MIN,
  INTERESTS_MAX,
  RANKED_START,
} from '../shared/constants.js';
import { BadRequestError, NotFoundError, ConflictError, ForbiddenError } from '../lib/errors.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

const RESERVED_NAMES = new Set(['admin', 'mimo', 'support', 'moderator', 'official', 'system']);

// ── Perks (leagues-and-progression.md §5) ──────────────────────────────────

/**
 * The catalogue entry behind a stored key.
 *
 * The catalogue is configuration now (leagues-and-progression.md §9), so this
 * reads the snapshot rather than a constant — one lookup path for everything,
 * including the league-gated and chest-only rows that used to be special
 * cases in this file.
 */
function perkFor(type, key) {
  return findCosmetic(progression().catalogue, type, key);
}

/** The display name for an equipped title key, or null when nothing is worn. */
export function titleNameFor(key) {
  return perkFor(COSMETIC_TYPE.TITLE, key)?.name ?? null;
}

/**
 * A preset avatar or banner is stored as `mimo:avatar/<key>` — the same key
 * perks.js measures ownership by, so there is no parallel id space to keep in
 * step. Anything else is an upload, which belongs to the player who made it.
 */
function presetKeyOf(type, value) {
  const prefix = `mimo:${type}/`;
  const raw = String(value ?? '');
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : null;
}

/**
 * Refuse to equip something the player has not earned.
 *
 * `granted` is checked first throughout: a perk already owned is owned
 * forever, whatever the level says. That is how migration grandfathers the
 * avatars and banners people are already wearing, and how a claimed chest
 * survives the demotion that follows it.
 */
function assertOwned(type, key, { level, granted, rankedRating }) {
  if (!key) return;
  if (granted.includes(key)) return;

  const item = perkFor(type, key);

  // Titles have no equivalent of an uploaded image: every legitimate one is in
  // the catalogue. An unknown key would otherwise become free text printed
  // under the player's name, so it is refused rather than treated as free.
  if (type === COSMETIC_TYPE.TITLE && !item) {
    throw new BadRequestError('That title does not exist.', 'UNKNOWN_PERK');
  }

  // A disabled row is still wearable by whoever owns it, but it can no longer
  // be picked up: withdrawing something from the shelf is not confiscation.
  if (item?.enabled === false && !granted.includes(key)) {
    throw new ForbiddenError('That is no longer available.', 'PERK_WITHDRAWN');
  }

  if (ownsCosmetic(item, { level, granted, rankedRating, ladder: progression().ladder })) return;
  throw new ForbiddenError(lockedMessage(item), 'PERK_LOCKED');
}

export async function updateProfile(user, input) {
  if (input.displayName !== undefined) {
    const name = String(input.displayName).trim();
    if (name.length < 2 || name.length > 24) {
      throw new BadRequestError('Names are between 2 and 24 characters.', 'BAD_NAME');
    }
    if (!/^[\p{L}\p{N} ._-]+$/u.test(name)) {
      throw new BadRequestError('Use letters, numbers, spaces, dots, dashes or underscores.', 'BAD_NAME');
    }
    if (RESERVED_NAMES.has(name.toLowerCase())) {
      throw new ConflictError('That name is not available.', 'NAME_RESERVED');
    }
    const taken = await User.exists({
      displayNameLower: name.toLowerCase(),
      _id: { $ne: user._id },
    });
    if (taken) throw new ConflictError('That name is taken. Try another.', 'NAME_TAKEN');
    user.displayName = name;
  }

  /**
   * Everything a player wears is checked against what they have unlocked. The
   * check lives here rather than in the route because this is the only door a
   * profile changes through, and a locked perk must not be reachable by any
   * client that simply forgot to hide the button.
   */
  const owned = {
    level: effectiveAccountLevel(user.totalXp, user.accountLevelFloor, progression().accountCurve),
    granted: user.grantedPerks ?? [],
    rankedRating: user.rankedRating ?? RANKED_START,
  };

  if (input.avatarUrl !== undefined) {
    assertOwned('avatar', presetKeyOf('avatar', input.avatarUrl), owned);
    user.avatarUrl = input.avatarUrl;
  }
  if (input.banner !== undefined) {
    const banner = String(input.banner).slice(0, 500);
    assertOwned('banner', presetKeyOf('banner', banner), owned);
    user.banner = banner;
  }
  if (input.title !== undefined) {
    // `null` and `''` both mean "wear nothing" — the profile screen clears the
    // field with whichever of the two it happens to have.
    const title = input.title === null ? '' : String(input.title).trim();
    assertOwned('title', title, owned);
    user.title = title;
  }
  if (input.country !== undefined) {
    const code = String(input.country).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) {
      throw new BadRequestError('Country is a two-letter code.', 'BAD_COUNTRY');
    }
    user.country = code;
  }
  if (input.city !== undefined) user.city = String(input.city).trim().slice(0, 60);
  if (input.dateOfBirth !== undefined) user.dateOfBirth = new Date(input.dateOfBirth);
  if (input.locale !== undefined) user.locale = input.locale;

  if (input.notificationPrefs) {
    user.notificationPrefs = { ...user.notificationPrefs.toObject(), ...input.notificationPrefs };
  }
  if (input.privacy) {
    user.privacy = { ...user.privacy.toObject(), ...input.privacy };
    // prd.md §13 — minors are excluded from contact discovery regardless of
    // what the client asks for.
    if (user.isMinor) user.privacy.contactDiscovery = false;
  }

  await user.save();
  return user;
}

/** prd.md F6.1.4 — pick 3 to 8 topics on first run. */
export async function setInterests(user, topicIds) {
  const ids = [...new Set((topicIds ?? []).map(String))];
  if (ids.length < INTERESTS_MIN || ids.length > INTERESTS_MAX) {
    throw new BadRequestError(
      `Pick between ${INTERESTS_MIN} and ${INTERESTS_MAX} topics.`,
      'BAD_INTEREST_COUNT',
    );
  }
  // Interests seed the PUBLIC home feed (F6.1.4), so they are restricted to
  // public topics. Accepting a space topic here would not leak anything — the
  // feed filters by scope regardless — but it would let a space topic id sit
  // on a profile, which is not something interests should ever hold.
  const valid = await Topic.find(
    { _id: { $in: ids.map(oid) }, spaceId: publicSpaceId, status: 'published' },
    { _id: 1 },
  ).lean();
  user.interests = valid.map((t) => t._id);
  await user.save();
  return user.interests;
}

/** prd.md F6.8.3 — the public profile. */
export async function getPublicProfile(targetId, viewer) {
  if (!mongoose.isValidObjectId(targetId)) throw new NotFoundError('No such player.');
  const target = await User.findById(oid(targetId));
  if (!target || target.status === 'deleted') throw new NotFoundError('No such player.');

  const isSelf = viewer && String(viewer._id) === String(target._id);
  const areFriends = viewer && !isSelf ? await friendshipBetween(viewer._id, target._id) : null;

  if (!isSelf) {
    if (target.privacy?.profileVisibility === 'private') {
      throw new NotFoundError('That profile is private.', 'PROFILE_PRIVATE');
    }
    if (target.privacy?.profileVisibility === 'friends' && areFriends?.status !== 'accepted') {
      throw new NotFoundError('That profile is visible to friends only.', 'PROFILE_FRIENDS_ONLY');
    }
  }

  const [topTopics, recentMatches, h2h] = await Promise.all([
    Rating.find({ userId: target._id })
      .sort({ rating: -1 })
      .limit(5)
      .populate('topicId', 'name slug coverUrl spaceId')
      .lean(),
    Match.find({ 'players.userId': target._id, status: 'complete' })
      .sort({ completedAt: -1 })
      .limit(5)
      .populate('topicId', 'name')
      .lean(),
    viewer && !isSelf ? headToHead(viewer._id, target._id) : null,
  ]);

  const rankedRating = target.rankedRating ?? RANKED_START;

  return {
    ...target.toPublicProfile(),
    /**
     * leagues-and-progression.md §7 — the league badge and the account level
     * are the headline of a profile now. `overallRating` stays in the payload
     * (from toPublicProfile) until every client has stopped reading it.
     */
    rankedRating,
    league: leagueFor(rankedRating, progression().ladder),
    accountLevel: effectiveAccountLevel(
      target.totalXp,
      target.accountLevelFloor,
      progression().accountCurve,
    ),
    /** The name, not the key: nothing outside this file should have to map it. */
    title: titleNameFor(target.title),
    isSelf,
    friendship: areFriends
      ? { status: areFriends.status, requestedByMe: String(areFriends.requestedBy) === String(viewer._id) }
      : null,
    /** prd.md F6.8.3 — the head-to-head record sits directly under their name. */
    headToHead: h2h,
    streak: target.streak,
    topTopics: topTopics
      .filter((r) => r.topicId)
      .map((r) => ({
        topicId: String(r.topicId._id),
        name: r.topicId.name,
        coverUrl: r.topicId.coverUrl,
        rating: r.rating,
        level: r.level ?? levelForXp(r.xp),
        matchesPlayed: r.matchesPlayed,
      })),
    recentMatches: recentMatches.map((m) => {
      const them = m.players.find((p) => String(p.userId) === String(target._id));
      const other = m.players.find((p) => String(p.userId) !== String(target._id));
      return {
        id: String(m._id),
        topic: m.topicId?.name,
        verdict: m.isDraw ? 'draw' : String(m.winnerId) === String(target._id) ? 'won' : 'lost',
        scores: { them: them?.score ?? 0, other: other?.score ?? 0 },
        playedAt: m.completedAt,
      };
    }),
  };
}

export async function friendshipBetween(a, b) {
  const pair = Friendship.pairOf(a, b);
  return Friendship.findOne({ userA: oid(pair.userA), userB: oid(pair.userB) }).lean();
}

/** prd.md F6.8.2 — find friends by username. */
/**
 * Find a player by name.
 *
 * ── Anywhere in the name, not just the start ─────────────────────────────────
 *
 * This was anchored — `^bella` — which meant a search only ever worked if you
 * already knew how somebody's name BEGAN. "ella" found nothing for Bella,
 * "singh" found nobody called Priya Singh, and since a surname is the half
 * people are most likely to type, the feature read as broken rather than as
 * strict. prd.md F6.2.3 asks for typo tolerance on topic search; a name search
 * that cannot match a surname is a long way short of that.
 *
 * It is a substring match now — the same shape the admin console has always
 * used for the same job — with the results ordered so the anchored matches
 * still come first. That is the part worth keeping from the old behaviour:
 * someone typing "bel" almost certainly means the name starting with it, and a
 * plain substring query would bury Bella under Annabelle.
 *
 * ── Why a regex and not a text index ─────────────────────────────────────────
 *
 * An unanchored regex cannot use the `displayNameLower` index, so this is a
 * collection scan. That is a deliberate trade at this size and a real ceiling:
 * past a few hundred thousand accounts it wants an n-gram or `$text` index.
 * The `limit` caps the documents returned, not the documents examined.
 */
export async function searchUsers(query, viewer, { limit = 20 } = {}) {
  const q = String(query ?? '').trim();
  if (q.length < 2) return [];
  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLowerCase();

  const users = await User.find({
    displayNameLower: { $regex: safe },
    status: 'active',
    _id: { $ne: viewer?._id },
    // prd.md §13 — minors are excluded from discovery entirely.
    isMinor: { $ne: true },
    'privacy.profileVisibility': { $ne: 'private' },
  })
    .limit(Math.min(limit, 30))
    .lean();

  // Starts-with first, then alphabetically, so the ordering is stable rather
  // than whatever order the scan happened to visit them in.
  const ranked = users.sort((a, b) => {
    const aStarts = (a.displayNameLower ?? '').startsWith(safe);
    const bStarts = (b.displayNameLower ?? '').startsWith(safe);
    if (aStarts !== bStarts) return aStarts ? -1 : 1;
    return String(a.displayName ?? '').localeCompare(String(b.displayName ?? ''));
  });

  return ranked.map((u) => ({
    id: String(u._id),
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    city: u.city,
    overallRating: u.overallRating,
  }));
}

/** prd.md F6.1.6 — deletion with a 30-day grace period. */
export async function requestDeletion(user) {
  user.deletionRequestedAt = new Date();
  await user.save();
  return { deletesAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) };
}

export async function cancelDeletion(user) {
  user.deletionRequestedAt = null;
  await user.save();
  return { cancelled: true };
}

/** prd.md §6.10 / §13 — DPDP-compliant data export. */
export async function exportUserData(userId) {
  const [user, ratings, matches] = await Promise.all([
    User.findById(oid(userId)).lean(),
    Rating.find({ userId: oid(userId) }).populate('topicId', 'name').lean(),
    Match.find({ 'players.userId': oid(userId) }).populate('topicId', 'name').limit(1000).lean(),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    profile: {
      displayName: user.displayName,
      phone: user.phone,
      email: user.email,
      city: user.city,
      dateOfBirth: user.dateOfBirth,
      createdAt: user.createdAt,
      totalXp: user.totalXp,
      matchesPlayed: user.matchesPlayed,
      streak: user.streak,
      achievements: user.achievements,
    },
    topicRatings: ratings.map((r) => ({
      topic: r.topicId?.name,
      rating: r.rating,
      level: r.level,
      matchesPlayed: r.matchesPlayed,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
    })),
    matches: matches.map((m) => {
      const me = m.players.find((p) => String(p.userId) === String(userId));
      return {
        topic: m.topicId?.name,
        playedAt: m.completedAt ?? m.createdAt,
        score: me?.score,
        correctAnswers: me?.correctCount,
        result: m.isDraw ? 'draw' : String(m.winnerId) === String(userId) ? 'won' : 'lost',
      };
    }),
  };
}

/** prd.md F6.8.4 — block a user. Blocking also severs any friendship. */
export async function blockUser(user, targetId) {
  if (String(user._id) === String(targetId)) {
    throw new BadRequestError('You cannot block yourself.');
  }
  await User.updateOne({ _id: user._id }, { $addToSet: { blockedUsers: oid(targetId) } });
  const pair = Friendship.pairOf(user._id, targetId);
  await Friendship.updateOne(
    { userA: oid(pair.userA), userB: oid(pair.userB) },
    { $set: { status: 'blocked', respondedAt: new Date() } },
  );
  return { blocked: true };
}

export async function unblockUser(user, targetId) {
  await User.updateOne({ _id: user._id }, { $pull: { blockedUsers: oid(targetId) } });
  return { blocked: false };
}

export async function listBlocked(user) {
  const users = await User.find(
    { _id: { $in: user.blockedUsers ?? [] } },
    { displayName: 1, avatarUrl: 1 },
  ).lean();
  return users.map((u) => ({ id: String(u._id), displayName: u.displayName, avatarUrl: u.avatarUrl }));
}

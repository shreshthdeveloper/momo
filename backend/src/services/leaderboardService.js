import mongoose from 'mongoose';
import { Rating, User, Match, SpaceMember, LeaderboardSnapshot } from '../models/index.js';
import { Friendship } from '../models/social.js';
import { isoWeekKey, monthKey, periodRange } from '../lib/dates.js';
import { leagueFor } from '../shared/league.js';
import { effectiveAccountLevel } from '../shared/mastery.js';
import { progression } from './progressionService.js';
import { RANKED_START } from '../shared/constants.js';
import { BadRequestError } from '../lib/errors.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const PAGE_SIZE = 50;

/**
 * Leaderboards (prd.md §6.6).
 *
 * All-time boards read `ratings` directly — `{ topicId, rating: -1 }` exists
 * precisely for this. Period boards cannot, because rating is a running value
 * with no history, so they rank by points earned inside the window and are
 * served from hourly snapshots (tech.md §10).
 *
 * prd.md F6.6.4 — the viewer's own row is pinned and always visible, even when
 * outside the loaded page. That is computed separately and always returned.
 */

/**
 * Restrict a board to a population. prd.md §5.1 rule 5 — a space topic's
 * leaderboard is never visible outside that space, which is enforced by the
 * caller having passed tenantGuard before reaching here.
 */
async function audienceFilter(scope, viewer, { scopeType, scopeValue }) {
  switch (scopeType) {
    case 'global':
      return {};

    case 'city': {
      const city = scopeValue ?? viewer?.city;
      if (!city) throw new BadRequestError('Set your city to see the city board.', 'NO_CITY');
      const users = await User.find({ city, status: 'active' }, { _id: 1 }).limit(5000).lean();
      return { userId: { $in: users.map((u) => u._id) } };
    }

    case 'country': {
      // One country at launch; the filter exists so the shape does not change
      // when a second is added.
      return {};
    }

    case 'friends': {
      if (!viewer) throw new BadRequestError('Sign in to see the friends board.');
      const ids = await friendIdsOf(viewer._id);
      return { userId: { $in: [...ids, oid(viewer._id)] } };
    }

    case 'space': {
      const members = await SpaceMember.find(
        { spaceId: scope.spaceId, status: 'active' },
        { userId: 1 },
      ).lean();
      return { userId: { $in: members.map((m) => m.userId) } };
    }

    case 'batch': {
      const batchId = scopeValue ?? scope.batchId;
      if (!batchId) throw new BadRequestError('No batch selected.');
      const members = await SpaceMember.find(
        { spaceId: scope.spaceId, batchId: oid(batchId), status: 'active' },
        { userId: 1 },
      ).lean();
      return { userId: { $in: members.map((m) => m.userId) } };
    }

    default:
      return {};
  }
}

export async function friendIdsOf(userId) {
  const rows = await Friendship.find({
    status: 'accepted',
    $or: [{ userA: oid(userId) }, { userB: oid(userId) }],
  }).lean();
  return rows.map((r) => (String(r.userA) === String(userId) ? r.userB : r.userA));
}

/** Ranks are 1-based and tie-broken per F6.6.5. */
const SORT_ALL_TIME = { rating: -1, matchesPlayed: 1, reachedRatingAt: 1 };

export async function getLeaderboard({
  scope,
  viewer,
  topicId = null,
  scopeType = 'global',
  scopeValue = null,
  period = 'all',
  page = 0,
}) {
  const audience = await audienceFilter(scope, viewer, { scopeType, scopeValue });

  if (period !== 'all') {
    return periodLeaderboard({ scope, viewer, topicId, scopeType, scopeValue, period, page, audience });
  }

  /**
   * `ratings` is one document per user PER TOPIC. A topic board can read it
   * directly; the overall board cannot — a straight find() returns each player
   * once for every topic they have touched, which the client then renders as
   * duplicate rows with duplicate keys. Overall boards therefore group by user
   * first and rank on the user's overall rating, which also keeps the number
   * shown here identical to the one on their profile.
   */
  if (!topicId) {
    return overallLeaderboard({ scope, viewer, scopeType, period, page, audience });
  }

  const filter = { ...audience, topicId: oid(topicId), spaceId: scope.spaceId };

  const [rows, total] = await Promise.all([
    Rating.find(filter)
      .sort(SORT_ALL_TIME)
      .skip(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .populate('userId', 'displayName avatarUrl country city status')
      .lean(),
    Rating.countDocuments(filter),
  ]);

  const entries = rows
    .filter((r) => r.userId && r.userId.status !== 'deleted')
    .map((r, i) => ({
      rank: page * PAGE_SIZE + i + 1,
      userId: String(r.userId._id),
      displayName: r.userId.displayName,
      avatarUrl: r.userId.avatarUrl,
      country: r.userId.country,
      city: r.userId.city,
      rating: r.rating,
      matchesPlayed: r.matchesPlayed,
      wins: r.wins,
      level: r.level,
      isViewer: viewer ? String(r.userId._id) === String(viewer._id) : false,
    }));

  const viewerRow = viewer
    ? await pinnedRowFor({ viewer, filter, entries })
    : null;

  return {
    scope: scopeType,
    period,
    topicId: String(topicId),
    page,
    pageSize: PAGE_SIZE,
    total,
    entries,
    viewerRow,
  };
}

/**
 * The overall all-time board: one row per player, ranked by ranked rating.
 *
 * The population is "players with at least one rating in this space" narrowed
 * by the audience filter, and the number shown is `User.rankedRating` — the
 * same value the profile card shows, so the two screens can never disagree.
 *
 * leagues-and-progression.md §7 — this board reads the ranked ladder rather
 * than `overallRating`, which was the mean of a player's five strongest topics
 * and so moved barely at all after a loss. The field is still called `rating`
 * in the response: it is the one number a row carries, and renaming it would
 * break every client for no gain.
 */
async function overallLeaderboard({ scope, viewer, scopeType, period, page, audience }) {
  const match = { ...audience, spaceId: scope.spaceId };

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: '$userId',
        matchesPlayed: { $sum: '$matchesPlayed' },
        wins: { $sum: '$wins' },
        reachedRatingAt: { $min: '$reachedRatingAt' },
      },
    },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    { $match: { 'user.status': { $nin: ['deleted', 'banned'] } } },
    {
      $project: {
        matchesPlayed: 1,
        wins: 1,
        reachedRatingAt: 1,
        /**
         * The account level pairs with the account rating on this board, the
         * way the topic level pairs with the topic rating on a topic board.
         *
         * It used to be `$max` of the player's per-topic levels — their single
         * strongest subject — so a global row read "Level 9" meaning "level 9
         * at Python", next to a rating that meant something else entirely.
         * Carried here as XP and resolved below, because the level curve is
         * shared code and does not belong in an aggregation pipeline.
         */
        totalXp: { $ifNull: ['$user.totalXp', 0] },
        /** Carried for the same reason: a curve edit must not demote a row. */
        accountLevelFloor: { $ifNull: ['$user.accountLevelFloor', 1] },
        // A player whose ranked rating has not been seeded yet reads as a new
        // one rather than sorting to the bottom of the board.
        rating: { $ifNull: ['$user.rankedRating', RANKED_START] },
        displayName: '$user.displayName',
        avatarUrl: '$user.avatarUrl',
        country: '$user.country',
        city: '$user.city',
      },
    },
    // F6.6.5 — ties break by fewer matches, then by who got there first.
    { $sort: { rating: -1, matchesPlayed: 1, reachedRatingAt: 1 } },
  ];

  const [rows, totalRows] = await Promise.all([
    Rating.aggregate([...pipeline, { $skip: page * PAGE_SIZE }, { $limit: PAGE_SIZE }]),
    Rating.aggregate([{ $match: match }, { $group: { _id: '$userId' } }, { $count: 'n' }]),
  ]);

  const entries = rows.map((r, i) => ({
    rank: page * PAGE_SIZE + i + 1,
    userId: String(r._id),
    displayName: r.displayName,
    avatarUrl: r.avatarUrl,
    country: r.country,
    city: r.city,
    rating: r.rating,
    /** §7 — the row shows a league badge, not an unlabelled number. */
    league: leagueFor(r.rating, progression().ladder),
    matchesPlayed: r.matchesPlayed,
    wins: r.wins,
    /** Account level — the global board's level, not a topic's. */
    level: effectiveAccountLevel(r.totalXp, r.accountLevelFloor, progression().accountCurve),
    isViewer: viewer ? String(r._id) === String(viewer._id) : false,
  }));

  let viewerRow = null;
  if (viewer) {
    const mine = entries.find((e) => e.isViewer);
    if (mine) {
      viewerRow = { ...mine, inPage: true };
    } else {
      // Off the page: rank = players ranked above + 1, under the same tie rules.
      const played = await Rating.findOne({ ...match, userId: oid(viewer._id) }).lean();
      if (played) {
        const summary = await Rating.aggregate([
          { $match: { ...match, userId: oid(viewer._id) } },
          {
            $group: {
              _id: '$userId',
              matchesPlayed: { $sum: '$matchesPlayed' },
              wins: { $sum: '$wins' },
              reachedRatingAt: { $min: '$reachedRatingAt' },
            },
          },
        ]);
        const me = summary[0];
        const myRating = viewer.rankedRating ?? RANKED_START;
        const above = await Rating.aggregate([
          { $match: match },
          { $group: { _id: '$userId', matchesPlayed: { $sum: '$matchesPlayed' } } },
          { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
          { $unwind: '$user' },
          // Ranked with the same $ifNull the page uses, so an unseeded rating
          // cannot count as above the viewer on one query and below on the other.
          { $addFields: { ranked: { $ifNull: ['$user.rankedRating', RANKED_START] } } },
          {
            $match: {
              $or: [
                { ranked: { $gt: myRating } },
                { ranked: myRating, matchesPlayed: { $lt: me?.matchesPlayed ?? 0 } },
              ],
            },
          },
          { $count: 'n' },
        ]);
        viewerRow = {
          rank: (above[0]?.n ?? 0) + 1,
          userId: String(viewer._id),
          displayName: viewer.displayName,
          avatarUrl: viewer.avatarUrl,
          country: viewer.country,
          city: viewer.city,
          rating: myRating,
          league: leagueFor(myRating, progression().ladder),
          matchesPlayed: me?.matchesPlayed ?? 0,
          wins: me?.wins ?? 0,
          /** Account level, matching the page rows above. */
          level: effectiveAccountLevel(
            viewer.totalXp ?? 0,
            viewer.accountLevelFloor,
            progression().accountCurve,
          ),
          isViewer: true,
          inPage: false,
        };
      }
    }
  }

  return {
    scope: scopeType,
    period,
    topicId: null,
    page,
    pageSize: PAGE_SIZE,
    total: totalRows[0]?.n ?? 0,
    entries,
    viewerRow,
  };
}

/**
 * prd.md F6.6.4 — the pinned row. Returned even when the viewer is inside the
 * loaded page, with `inPage` set, so the client can decide whether to draw the
 * sticky footer rather than guessing.
 */
async function pinnedRowFor({ viewer, filter, entries }) {
  const mine = await Rating.findOne({ ...filter, userId: oid(viewer._id) }).lean();
  if (!mine) return null;

  const inPage = entries.some((e) => e.userId === String(viewer._id));
  const above = await Rating.countDocuments({
    ...filter,
    $or: [
      { rating: { $gt: mine.rating } },
      { rating: mine.rating, matchesPlayed: { $lt: mine.matchesPlayed } },
      {
        rating: mine.rating,
        matchesPlayed: mine.matchesPlayed,
        reachedRatingAt: { $lt: mine.reachedRatingAt },
      },
    ],
  });

  return {
    rank: above + 1,
    userId: String(viewer._id),
    displayName: viewer.displayName,
    avatarUrl: viewer.avatarUrl,
    country: viewer.country,
    city: viewer.city,
    rating: mine.rating,
    matchesPlayed: mine.matchesPlayed,
    wins: mine.wins,
    level: mine.level,
    isViewer: true,
    inPage,
  };
}

// ── Period boards ──────────────────────────────────────────────────────────

export function bucketFor(period, date = new Date()) {
  return period === 'week' ? isoWeekKey(date) : monthKey(date);
}

export function snapshotKey({ scopeType, scopeValue, topicId, period, bucket, spaceId }) {
  return [
    String(spaceId),
    scopeType,
    scopeValue ?? '-',
    topicId ? String(topicId) : 'overall',
    period,
    bucket,
  ].join(':');
}

async function periodLeaderboard({ scope, viewer, topicId, scopeType, scopeValue, period, page, audience }) {
  const bucket = bucketFor(period);
  const key = snapshotKey({ scopeType, scopeValue, topicId, period, bucket, spaceId: scope.spaceId });

  let snapshot = await LeaderboardSnapshot.findOne({ key }).lean();

  // Cold or stale (over an hour old) — rebuild on demand rather than serve a
  // board that is visibly behind. The hourly job normally gets there first.
  if (!snapshot || Date.now() - new Date(snapshot.generatedAt).getTime() > 60 * 60 * 1000) {
    snapshot = await rebuildPeriodSnapshot({
      scope,
      topicId,
      scopeType,
      scopeValue,
      period,
      bucket,
      audience,
    });
  }

  const entries = (snapshot?.entries ?? []).slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const viewerEntry = viewer
    ? (snapshot?.entries ?? []).find((e) => String(e.userId) === String(viewer._id))
    : null;

  return {
    scope: scopeType,
    period,
    bucket,
    topicId: topicId ? String(topicId) : null,
    page,
    pageSize: PAGE_SIZE,
    total: snapshot?.totalPlayers ?? 0,
    generatedAt: snapshot?.generatedAt,
    entries: entries.map((e) => ({
      ...e,
      userId: String(e.userId),
      isViewer: viewer ? String(e.userId) === String(viewer._id) : false,
    })),
    viewerRow: viewerEntry
      ? {
          ...viewerEntry,
          userId: String(viewerEntry.userId),
          isViewer: true,
          inPage: entries.some((e) => String(e.userId) === String(viewer._id)),
        }
      : null,
  };
}

/**
 * Rank by points earned inside the window. A player who arrived this week and
 * played well outranks a dormant high rating — which is the whole point of a
 * weekly board.
 */
export async function rebuildPeriodSnapshot({
  scope,
  topicId,
  scopeType = 'global',
  scopeValue = null,
  period,
  bucket = null,
  audience = {},
  limit = 500,
  /**
   * The moment the period is measured from. Defaults to now, which is what the
   * hourly job wants; the monthly archive passes a date inside the month that
   * just ended, so the snapshot it writes covers that month rather than the one
   * the clock has already rolled into.
   */
  at = new Date(),
}) {
  const resolvedBucket = bucket ?? bucketFor(period, at);
  const { start, end } = periodRange(period, at);

  const userFilter = audience.userId ? { 'players.userId': audience.userId } : {};

  const rows = await Match.aggregate([
    {
      $match: {
        spaceId: scope.spaceId,
        status: 'complete',
        completedAt: { $gte: start, $lt: end },
        ...(topicId ? { topicId: oid(topicId) } : {}),
        ...userFilter,
      },
    },
    { $unwind: '$players' },
    { $match: { 'players.isGhost': { $ne: true } } },
    ...(audience.userId ? [{ $match: { 'players.userId': audience.userId } }] : []),
    {
      $group: {
        _id: '$players.userId',
        points: { $sum: '$players.score' },
        matchesPlayed: { $sum: 1 },
        wins: {
          $sum: { $cond: [{ $eq: ['$winnerId', '$players.userId'] }, 1, 0] },
        },
      },
    },
    { $sort: { points: -1, matchesPlayed: 1 } },
    { $limit: limit },
  ]);

  const users = await User.find(
    { _id: { $in: rows.map((r) => r._id) } },
    { displayName: 1, avatarUrl: 1, country: 1, city: 1, overallRating: 1, rankedRating: 1 },
  ).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));

  const entries = rows
    .filter((r) => byId.has(String(r._id)))
    .map((r, i) => {
      const u = byId.get(String(r._id));
      return {
        rank: i + 1,
        userId: r._id,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        country: u.country,
        city: u.city,
        points: r.points,
        matchesPlayed: r.matchesPlayed,
        wins: r.wins,
        // A period board RANKS by points earned in the window; the rating is
        // only shown beside the name. It reads the ranked ladder like every
        // other surface (§2), falling back until the migration has run.
        rating: u.rankedRating ?? u.overallRating,
      };
    });

  const key = snapshotKey({
    scopeType,
    scopeValue,
    topicId,
    period,
    bucket: resolvedBucket,
    spaceId: scope.spaceId,
  });

  const doc = {
    key,
    topicId: topicId ? oid(topicId) : null,
    spaceId: scope.spaceId,
    scope: scopeType,
    scopeValue,
    period,
    bucket: resolvedBucket,
    entries,
    totalPlayers: entries.length,
    generatedAt: new Date(),
  };

  await LeaderboardSnapshot.updateOne({ key }, { $set: doc }, { upsert: true });
  return doc;
}

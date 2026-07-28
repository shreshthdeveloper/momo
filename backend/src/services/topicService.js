import mongoose from 'mongoose';
import { Topic, Category, Rating, Match, publicSpaceId } from '../models/index.js';
import { ratingsForTopics } from './ratingService.js';
import { levelForXp } from '../shared/mastery.js';
import { TOPIC_STATUS, MIN_PUBLISHED_QUESTIONS_TO_LIVE, SPACE_ROLE } from '../shared/constants.js';
import { NotFoundError } from '../lib/errors.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Every read in this file is filtered by `scope.spaceId`, which came from
 * tenantGuard and never from the request. prd.md §5.1 rule 5 — a space
 * topic's data is never visible outside that space.
 */

/** Batch-scoped topics are invisible to students in other batches (F8.3.4). */
function batchFilterFor(scope) {
  if (!scope || scope.isPublic) return {};
  if (scope.role !== SPACE_ROLE.STUDENT) return {};
  return scope.batchId
    ? { $or: [{ batchIds: { $size: 0 } }, { batchIds: oid(scope.batchId) }] }
    : { batchIds: { $size: 0 } };
}

/** Only topics that can actually be played appear to players. */
function liveFilter() {
  return {
    status: TOPIC_STATUS.PUBLISHED,
    publishedQuestionCount: { $gte: MIN_PUBLISHED_QUESTIONS_TO_LIVE },
  };
}

/**
 * The tenant filter every topic read starts from. Built from the resolved
 * scope at each call site rather than passed around as an opaque argument —
 * a `spaceId` that arrives as a parameter is a `spaceId` nobody can check by
 * reading the query.
 */
function baseTopicFilter(scope) {
  return { spaceId: scope.spaceId, ...liveFilter(), ...batchFilterFor(scope) };
}

export function shapeTopicCard(topic, ratingRow) {
  return {
    id: String(topic._id),
    name: topic.name,
    slug: topic.slug,
    description: topic.description,
    coverUrl: topic.coverUrl ?? null,
    categoryId: topic.categoryId ? String(topic.categoryId._id ?? topic.categoryId) : null,
    categoryName: topic.categoryId?.name,
    categoryColor: topic.categoryId?.color,
    spaceId: String(topic.spaceId),
    /** design.md §6.4 — the metadata row: active players, mastery, rank. */
    activePlayers: topic.stats?.activePlayers ?? 0,
    matchesPlayed: topic.stats?.matchesPlayed ?? 0,
    viewer: ratingRow
      ? {
          rating: ratingRow.rating,
          level: ratingRow.level ?? levelForXp(ratingRow.xp ?? 0),
          xp: ratingRow.xp ?? 0,
          matchesPlayed: ratingRow.matchesPlayed ?? 0,
        }
      : null,
  };
}

async function decorateWithViewer(topics, userId) {
  if (!userId) return topics.map((t) => shapeTopicCard(t, null));
  const ratings = await ratingsForTopics(userId, topics.map((t) => t._id));
  return topics.map((t) => shapeTopicCard(t, ratings.get(String(t._id))));
}

export async function listTopics(scope, { categoryId, q, limit = 40, skip = 0, viewerId } = {}) {
  const filter = {
    spaceId: scope.spaceId,
    ...liveFilter(),
    ...batchFilterFor(scope),
  };
  if (categoryId && mongoose.isValidObjectId(categoryId)) filter.categoryId = oid(categoryId);

  // prd.md F6.2.3 — typo-tolerant search. A prefix/substring regex handles the
  // common misspelling far better than Mongo's text index does for two-word
  // topic names, and the collection is small enough that it stays fast.
  if (q) {
    const safe = String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: { $regex: safe, $options: 'i' } },
      { description: { $regex: safe, $options: 'i' } },
    ];
  }

  const topics = await Topic.find(filter)
    .sort({ featured: -1, 'stats.matchesPlayed': -1, order: 1, name: 1 })
    .skip(skip)
    .limit(Math.min(limit, 60))
    .populate('categoryId', 'name color slug')
    .lean();

  return decorateWithViewer(topics, viewerId);
}

export async function listCategories(scope) {
  const categories = await Category.find({ spaceId: scope.spaceId, status: 'active' })
    .sort({ order: 1, name: 1 })
    .lean();

  const counts = await Topic.aggregate([
    { $match: { spaceId: scope.spaceId, ...liveFilter() } },
    { $group: { _id: '$categoryId', count: { $sum: 1 } } },
  ]);
  const byCategory = new Map(counts.map((c) => [String(c._id), c.count]));

  return categories.map((c) => ({
    id: String(c._id),
    name: c.name,
    slug: c.slug,
    iconUrl: c.iconUrl,
    color: c.color,
    topicCount: byCategory.get(String(c._id)) ?? 0,
  }));
}

/**
 * prd.md F6.2.1 / design.md §8.2 — the home feed. Four rows, in the order the
 * design specifies: jump back in, for you, trending, friends are playing.
 */
export async function buildHomeFeed(scope, user, { friendIds = [] } = {}) {
  const viewerId = user?._id;
  const base = baseTopicFilter(scope);

  const recentRatings = viewerId
    ? await Rating.find({ userId: oid(viewerId) }).sort({ lastPlayedAt: -1 }).limit(10).lean()
    : [];
  const recentTopicIds = recentRatings.map((r) => r.topicId);

  const [jumpBackIn, forYou, trending, friendTopics] = await Promise.all([
    recentTopicIds.length
      ? Topic.find({ ...base, _id: { $in: recentTopicIds } })
          .populate('categoryId', 'name color slug')
          .lean()
      : [],

    user?.interests?.length
      ? Topic.find({ ...base, _id: { $in: user.interests, $nin: recentTopicIds } })
          .limit(12)
          .populate('categoryId', 'name color slug')
          .lean()
      : [],

    Topic.find({ ...base, _id: { $nin: recentTopicIds } })
      .sort({ featured: -1, 'stats.matchesPlayed': -1 })
      .limit(12)
      .populate('categoryId', 'name color slug')
      .lean(),

    friendIds.length ? topicsFriendsArePlaying(scope, friendIds) : [],
  ]);

  // Preserve recency order — Mongo returns $in unordered.
  const order = new Map(recentTopicIds.map((id, i) => [String(id), i]));
  jumpBackIn.sort((a, b) => (order.get(String(a._id)) ?? 99) - (order.get(String(b._id)) ?? 99));

  const rows = [
    { key: 'jump_back_in', title: 'Jump back in', topics: jumpBackIn.slice(0, 10) },
    { key: 'for_you', title: 'For you', topics: forYou },
    { key: 'trending', title: 'Trending', topics: trending },
    { key: 'friends', title: 'Friends are playing', topics: friendTopics },
  ].filter((row) => row.topics.length);

  const decorated = await Promise.all(
    rows.map(async (row) => ({ ...row, topics: await decorateWithViewer(row.topics, viewerId) })),
  );

  // design.md §8.2 — with no history, one obvious action rather than a grid.
  if (!decorated.length) {
    const starter = await Topic.find(base)
      .sort({ featured: -1, 'stats.matchesPlayed': -1 })
      .limit(1)
      .populate('categoryId', 'name color slug')
      .lean();
    if (starter.length) {
      return {
        rows: [
          { key: 'start_here', title: 'Start here', layout: 'hero', topics: await decorateWithViewer(starter, viewerId) },
        ],
      };
    }
  }

  return { rows: decorated };
}

async function topicsFriendsArePlaying(scope, friendIds) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await Match.aggregate([
    {
      $match: {
        spaceId: scope.spaceId,
        createdAt: { $gte: since },
        'players.userId': { $in: friendIds.map(oid) },
      },
    },
    { $group: { _id: '$topicId', plays: { $sum: 1 } } },
    { $sort: { plays: -1 } },
    { $limit: 10 },
  ]);
  if (!rows.length) return [];
  return Topic.find({ ...baseTopicFilter(scope), _id: { $in: rows.map((r) => r._id) } })
    .populate('categoryId', 'name color slug')
    .lean();
}

/** prd.md §8.3 / design.md §8.3 — the topic screen. */
export async function getTopicDetail(scope, topicId, viewerId) {
  if (!mongoose.isValidObjectId(topicId)) throw new NotFoundError('That topic does not exist.');

  const topic = await Topic.findOne({ _id: oid(topicId), spaceId: scope.spaceId })
    .populate('categoryId', 'name color slug')
    .lean();
  if (!topic) throw new NotFoundError('That topic does not exist.');

  const [viewerRating, rank, recentMatches] = await Promise.all([
    viewerId ? Rating.findOne({ userId: oid(viewerId), topicId: topic._id }).lean() : null,
    viewerId ? rankInTopic(topic._id, viewerId) : null,
    viewerId
      ? Match.find({
          topicId: topic._id,
          'players.userId': oid(viewerId),
          status: { $in: ['complete', 'abandoned'] },
        })
          .sort({ createdAt: -1 })
          .limit(5)
          .lean()
      : [],
  ]);

  return {
    ...shapeTopicCard(topic, viewerRating),
    isLive: topic.publishedQuestionCount >= MIN_PUBLISHED_QUESTIONS_TO_LIVE,
    readiness: {
      published: topic.publishedQuestionCount,
      required: MIN_PUBLISHED_QUESTIONS_TO_LIVE,
    },
    viewerRank: rank,
    recentMatches: recentMatches.map((m) => {
      const me = m.players.find((p) => String(p.userId) === String(viewerId));
      const them = m.players.find((p) => String(p.userId) !== String(viewerId));
      return {
        id: String(m._id),
        verdict: m.isDraw ? 'draw' : String(m.winnerId) === String(viewerId) ? 'won' : 'lost',
        scores: { you: me?.score ?? 0, opponent: them?.score ?? 0 },
        opponent: them ? { displayName: them.displayName, avatarUrl: them.avatarUrl } : null,
        playedAt: m.completedAt ?? m.createdAt,
      };
    }),
  };
}

/** One-based rank by rating within a topic. */
export async function rankInTopic(topicId, userId) {
  const mine = await Rating.findOne({ userId: oid(userId), topicId: oid(topicId) }).lean();
  if (!mine) return null;
  const above = await Rating.countDocuments({
    topicId: oid(topicId),
    $or: [
      { rating: { $gt: mine.rating } },
      // prd.md F6.6.5 — ties break by fewer matches, then by who got there first.
      { rating: mine.rating, matchesPlayed: { $lt: mine.matchesPlayed } },
      {
        rating: mine.rating,
        matchesPlayed: mine.matchesPlayed,
        reachedRatingAt: { $lt: mine.reachedRatingAt },
      },
    ],
  });
  return above + 1;
}

/** prd.md F6.1.4 — interest picker on first run. */
export async function listInterestCandidates(limit = 40) {
  const topics = await Topic.find({ spaceId: publicSpaceId, ...liveFilter() })
    .sort({ featured: -1, 'stats.matchesPlayed': -1 })
    .limit(limit)
    .populate('categoryId', 'name color slug')
    .lean();
  return topics.map((t) => shapeTopicCard(t, null));
}

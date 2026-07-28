import mongoose from 'mongoose';
import {
  Match,
  Question,
  Topic,
  Rating,
  SpaceMember,
  User,
  Space,
  Report,
  Contest,
  Assignment,
} from '../models/index.js';
import {
  QUESTION_STATUS,
  ROUNDS_PER_MATCH,
  CONTEST_STATUS,
  ASSIGNMENT_STATUS,
} from '../shared/constants.js';
import { itemAnalysisFor } from './questionService.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/**
 * Admin dashboard and reports (prd.md §8.1, §8.6).
 *
 * Every aggregation begins with `{ spaceId: scope.spaceId }` — the scope
 * resolved by tenantGuard, never a value from the request. The cross-tenant
 * suite asserts that a Space A admin gets zero rows from every function here
 * when pointed at Space B.
 */

/** prd.md F8.1.1 — the six summary cards. */
export async function spaceSummary(scope) {
  const spaceId = scope.spaceId;

  const [students, activeToday, activeWeek, matchStats, questionCount, pendingApprovals] =
    await Promise.all([
      SpaceMember.countDocuments({ spaceId, status: 'active', role: 'student' }),
      activeStudentCount(spaceId, 1),
      activeStudentCount(spaceId, 7),
      Match.aggregate([
        { $match: { spaceId, status: 'complete', completedAt: { $gte: daysAgo(30) } } },
        {
          $group: {
            _id: null,
            matches: { $sum: 1 },
            correct: { $sum: { $sum: '$players.correctCount' } },
            answered: { $sum: { $multiply: [{ $size: '$rounds' }, { $size: '$players' }] } },
          },
        },
      ]),
      Question.countDocuments({ origin: spaceId, status: QUESTION_STATUS.PUBLISHED }),
      SpaceMember.countDocuments({ spaceId, status: 'pending' }),
    ]);

  const stats = matchStats[0] ?? { matches: 0, correct: 0, answered: 0 };

  return {
    students,
    activeToday,
    activeThisWeek: activeWeek,
    matchesPlayed: stats.matches,
    avgAccuracy: stats.answered ? Number(((stats.correct / stats.answered) * 100).toFixed(1)) : 0,
    questionsInBank: questionCount,
    pendingApprovals,
  };
}

async function activeStudentCount(spaceId, days) {
  const rows = await Match.aggregate([
    { $match: { spaceId, createdAt: { $gte: daysAgo(days) } } },
    { $unwind: '$players' },
    { $match: { 'players.isGhost': { $ne: true } } },
    { $group: { _id: '$players.userId' } },
    { $count: 'n' },
  ]);
  return rows[0]?.n ?? 0;
}

/** prd.md F8.1.2 — engagement over a selectable period. */
export async function engagementSeries(scope, { days = 30 } = {}) {
  const rows = await Match.aggregate([
    { $match: { spaceId: scope.spaceId, createdAt: { $gte: daysAgo(days) } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: '+05:30' } },
        matches: { $sum: 1 },
        players: { $addToSet: '$players.userId' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const byDate = new Map(
    rows.map((r) => [
      r._id,
      { matches: r.matches, players: new Set(r.players.flat().map(String)).size },
    ]),
  );

  // Zero-fill so the chart shows the gaps rather than joining across them.
  const series = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = new Date(Date.now() - i * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
    series.push({ date: key, ...(byDate.get(key) ?? { matches: 0, players: 0 }) });
  }
  return series;
}

/** prd.md F8.1.3 — weakest topics, ranked by lowest average accuracy. */
export async function weakestTopics(scope, { limit = 8 } = {}) {
  const rows = await Match.aggregate([
    { $match: { spaceId: scope.spaceId, status: 'complete', completedAt: { $gte: daysAgo(60) } } },
    { $unwind: '$rounds' },
    { $unwind: '$rounds.answers' },
    { $match: { 'rounds.answers.optionIndex': { $ne: null } } },
    {
      $group: {
        _id: '$topicId',
        answered: { $sum: 1 },
        correct: { $sum: { $cond: ['$rounds.answers.isCorrect', 1, 0] } },
        avgResponseMs: { $avg: '$rounds.answers.elapsedMs' },
      },
    },
    { $match: { answered: { $gte: 20 } } },
    { $addFields: { accuracy: { $divide: ['$correct', '$answered'] } } },
    { $sort: { accuracy: 1 } },
    { $limit: limit },
  ]);

  // tenant-ok: hydrating names for ids produced by the spaceId-scoped
  // aggregation directly above. No new documents can enter through it.
  const topics = await Topic.find({ _id: { $in: rows.map((r) => r._id) } }, { name: 1, coverUrl: 1 }).lean();
  const byId = new Map(topics.map((t) => [String(t._id), t]));

  return rows.map((r) => ({
    topicId: String(r._id),
    name: byId.get(String(r._id))?.name ?? 'Unknown topic',
    accuracy: Number((r.accuracy * 100).toFixed(1)),
    answered: r.answered,
    avgResponseMs: Math.round(r.avgResponseMs ?? 0),
  }));
}

/**
 * prd.md F8.1.4 — most active students, and least active students. The PRD
 * calls the second list "the more actionable" one, so it includes students
 * with zero matches, which a plain aggregation over matches would omit.
 */
export async function studentActivity(scope, { limit = 8, days = 14 } = {}) {
  const members = await SpaceMember.find(
    { spaceId: scope.spaceId, status: 'active', role: 'student' },
    { userId: 1, batchId: 1 },
  ).lean();
  const memberIds = members.map((m) => m.userId);
  if (!memberIds.length) return { mostActive: [], leastActive: [] };

  const counts = await Match.aggregate([
    {
      $match: {
        spaceId: scope.spaceId,
        createdAt: { $gte: daysAgo(days) },
        'players.userId': { $in: memberIds },
      },
    },
    { $unwind: '$players' },
    { $match: { 'players.userId': { $in: memberIds }, 'players.isGhost': { $ne: true } } },
    {
      $group: {
        _id: '$players.userId',
        matches: { $sum: 1 },
        correct: { $sum: '$players.correctCount' },
        lastPlayedAt: { $max: '$createdAt' },
      },
    },
  ]);
  const byUser = new Map(counts.map((c) => [String(c._id), c]));

  const users = await User.find(
    { _id: { $in: memberIds } },
    { displayName: 1, avatarUrl: 1, lastActiveAt: 1 },
  ).lean();

  const rows = users.map((u) => {
    const c = byUser.get(String(u._id));
    return {
      userId: String(u._id),
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      matches: c?.matches ?? 0,
      lastPlayedAt: c?.lastPlayedAt ?? null,
    };
  });

  return {
    mostActive: [...rows].sort((a, b) => b.matches - a.matches).slice(0, limit),
    leastActive: [...rows]
      .sort((a, b) => a.matches - b.matches || (a.lastPlayedAt ?? 0) - (b.lastPlayedAt ?? 0))
      .slice(0, limit),
  };
}

/** prd.md F8.1.5 — recent activity feed. */
export async function recentActivity(scope, { limit = 20 } = {}) {
  const matches = await Match.find(
    { spaceId: scope.spaceId, status: 'complete' },
    { players: 1, topicId: 1, completedAt: 1, winnerId: 1 },
  )
    .sort({ completedAt: -1 })
    .limit(limit)
    .populate('topicId', 'name')
    .lean();

  return matches.map((m) => ({
    type: 'match',
    at: m.completedAt,
    topic: m.topicId?.name,
    players: m.players.map((p) => ({
      displayName: p.displayName,
      score: p.score,
      won: String(p.userId) === String(m.winnerId),
    })),
  }));
}

/** prd.md F8.1.6 — alerts sit above everything when action is pending. */
export async function pendingAlerts(scope) {
  const soon = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const [approvals, reviewQueue, reports, thinTopics, contestsSoon, overdue] = await Promise.all([
    SpaceMember.countDocuments({ spaceId: scope.spaceId, status: 'pending' }),
    Question.countDocuments({ origin: scope.spaceId, status: QUESTION_STATUS.IN_REVIEW }),
    Report.countDocuments({ spaceId: scope.spaceId, status: 'open' }),
    Topic.countDocuments({
      spaceId: scope.spaceId,
      status: 'published',
      publishedQuestionCount: { $lt: 21 },
    }),
    // prd.md F8.1.6 — "contests starting soon" is the third thing the alerts
    // strip is specified to carry.
    Contest.countDocuments({
      spaceId: scope.spaceId,
      status: CONTEST_STATUS.SCHEDULED,
      startsAt: { $gt: new Date(), $lte: soon },
    }),
    Assignment.countDocuments({
      spaceId: scope.spaceId,
      status: ASSIGNMENT_STATUS.ACTIVE,
      dueAt: { $lt: new Date() },
    }),
  ]);

  const alerts = [];
  if (approvals) {
    alerts.push({
      key: 'approvals',
      severity: 'action',
      text: `${approvals} student${approvals === 1 ? '' : 's'} waiting for approval.`,
      href: '/students?status=pending',
    });
  }
  if (reviewQueue) {
    alerts.push({
      key: 'review',
      severity: 'action',
      text: `${reviewQueue} question${reviewQueue === 1 ? '' : 's'} waiting for review.`,
      href: '/questions/review',
    });
  }
  if (reports) {
    alerts.push({
      key: 'reports',
      severity: 'warning',
      text: `${reports} open report${reports === 1 ? '' : 's'}.`,
      href: '/questions?reported=1',
    });
  }
  if (thinTopics) {
    alerts.push({
      key: 'thin_topics',
      severity: 'warning',
      text: `${thinTopics} published topic${thinTopics === 1 ? '' : 's'} below 21 questions and not playable.`,
      href: '/topics?ready=0',
    });
  }
  if (contestsSoon) {
    alerts.push({
      key: 'contests_soon',
      severity: 'action',
      text: `${contestsSoon} contest${contestsSoon === 1 ? '' : 's'} starting within 24 hours.`,
      href: '/contests',
    });
  }
  if (overdue) {
    alerts.push({
      key: 'assignments_overdue',
      severity: 'warning',
      text: `${overdue} assignment${overdue === 1 ? ' is' : 's are'} past the due date.`,
      href: '/assignments',
    });
  }
  return alerts;
}

// ── Reports (prd.md §8.6) ──────────────────────────────────────────────────

export async function topicReport(scope, topicId) {
  const topic = await Topic.findOne({ _id: oid(topicId), spaceId: scope.spaceId }).lean();
  if (!topic) return null;

  const [agg] = await Match.aggregate([
    { $match: { spaceId: scope.spaceId, topicId: oid(topicId), status: 'complete' } },
    { $unwind: '$rounds' },
    { $unwind: '$rounds.answers' },
    {
      $group: {
        _id: null,
        answered: { $sum: { $cond: [{ $ne: ['$rounds.answers.optionIndex', null] }, 1, 0] } },
        correct: { $sum: { $cond: ['$rounds.answers.isCorrect', 1, 0] } },
        avgResponseMs: { $avg: '$rounds.answers.elapsedMs' },
        timeouts: { $sum: { $cond: [{ $eq: ['$rounds.answers.optionIndex', null] }, 1, 0] } },
      },
    },
  ]);

  const byDifficulty = await Question.aggregate([
    { $match: { topicIds: oid(topicId), origin: scope.spaceId, status: QUESTION_STATUS.PUBLISHED } },
    {
      $group: {
        _id: '$difficulty',
        count: { $sum: 1 },
        served: { $sum: '$stats.served' },
        correct: { $sum: '$stats.correctCount' },
      },
    },
  ]);

  const participants = await Rating.countDocuments({ topicId: oid(topicId) });

  return {
    topic: { id: String(topic._id), name: topic.name, coverUrl: topic.coverUrl },
    matchesPlayed: topic.stats?.matchesPlayed ?? 0,
    participants,
    accuracy: agg?.answered ? Number(((agg.correct / agg.answered) * 100).toFixed(1)) : 0,
    avgResponseMs: Math.round(agg?.avgResponseMs ?? 0),
    timeoutRate: agg?.answered
      ? Number(((agg.timeouts / (agg.answered + agg.timeouts)) * 100).toFixed(1))
      : 0,
    /** F8.6.2 — difficulty calibration: does "hard" actually behave hard? */
    difficultyCalibration: byDifficulty.map((d) => ({
      difficulty: d._id,
      questions: d.count,
      served: d.served,
      accuracy: d.served ? Number(((d.correct / (d.served * 2)) * 100).toFixed(1)) : null,
    })),
  };
}

/** prd.md F8.6.3 — the individual performance card, printable. */
export async function studentReport(scope, userId) {
  const membership = await SpaceMember.findOne({
    spaceId: scope.spaceId,
    userId: oid(userId),
  }).lean();
  if (!membership) return null;

  const user = await User.findById(oid(userId), {
    displayName: 1,
    avatarUrl: 1,
    city: 1,
    createdAt: 1,
    streak: 1,
  }).lean();

  const [ratings, matches, byTopic] = await Promise.all([
    Rating.find({ userId: oid(userId), spaceId: scope.spaceId })
      .populate('topicId', 'name')
      .sort({ rating: -1 })
      .lean(),
    Match.countDocuments({ spaceId: scope.spaceId, 'players.userId': oid(userId), status: 'complete' }),
    Match.aggregate([
      { $match: { spaceId: scope.spaceId, 'players.userId': oid(userId), status: 'complete' } },
      { $unwind: '$rounds' },
      { $unwind: '$rounds.answers' },
      { $match: { 'rounds.answers.userId': oid(userId) } },
      {
        $group: {
          _id: '$topicId',
          answered: { $sum: { $cond: [{ $ne: ['$rounds.answers.optionIndex', null] }, 1, 0] } },
          correct: { $sum: { $cond: ['$rounds.answers.isCorrect', 1, 0] } },
          avgResponseMs: { $avg: '$rounds.answers.elapsedMs' },
        },
      },
    ]),
  ]);

  const perf = new Map(byTopic.map((r) => [String(r._id), r]));

  const topics = ratings.map((r) => {
    const p = perf.get(String(r.topicId?._id ?? r.topicId));
    return {
      topicId: String(r.topicId?._id ?? r.topicId),
      name: r.topicId?.name ?? 'Unknown',
      rating: r.rating,
      level: r.level,
      matchesPlayed: r.matchesPlayed,
      wins: r.wins,
      accuracy: p?.answered ? Number(((p.correct / p.answered) * 100).toFixed(1)) : null,
      avgResponseMs: Math.round(p?.avgResponseMs ?? 0),
    };
  });

  const rated = topics.filter((t) => t.accuracy !== null);

  return {
    student: {
      id: String(userId),
      displayName: user?.displayName,
      avatarUrl: user?.avatarUrl,
      city: user?.city,
      joinedAt: membership.joinedAt,
      batchId: membership.batchId ? String(membership.batchId) : null,
      streak: user?.streak,
    },
    matchesPlayed: matches,
    topics,
    /** prd.md F7.6 — weakest topics are what a student report is actually for. */
    weakest: [...rated].sort((a, b) => a.accuracy - b.accuracy).slice(0, 3),
    strongest: [...rated].sort((a, b) => b.accuracy - a.accuracy).slice(0, 3),
    overallAccuracy: rated.length
      ? Number((rated.reduce((s, t) => s + t.accuracy, 0) / rated.length).toFixed(1))
      : null,
  };
}

/**
 * prd.md F7.6 — the student's own view of their performance inside a Space:
 * "accuracy per topic, average response time, weakest topics, improvement over
 * time".
 *
 * Shares its shape with `studentReport` on purpose. The admin and the student
 * looking at the same numbers, and seeing the same numbers, is the whole basis
 * of a conversation about them.
 */
export async function spacePerformanceFor(scope, userId) {
  const report = await studentReport(scope, userId);
  if (!report) return null;

  // "Improvement over time" — weekly accuracy over the last eight weeks. Fewer
  // buckets than the admin chart because a student cares about the trend, not
  // the texture.
  const weekly = await Match.aggregate([
    {
      $match: {
        spaceId: scope.spaceId,
        'players.userId': oid(userId),
        status: 'complete',
        completedAt: { $gte: daysAgo(56) },
      },
    },
    { $unwind: '$rounds' },
    { $unwind: '$rounds.answers' },
    { $match: { 'rounds.answers.userId': oid(userId) } },
    {
      $group: {
        _id: {
          $dateToString: { format: '%G-W%V', date: '$completedAt', timezone: '+05:30' },
        },
        answered: { $sum: { $cond: [{ $ne: ['$rounds.answers.optionIndex', null] }, 1, 0] } },
        correct: { $sum: { $cond: ['$rounds.answers.isCorrect', 1, 0] } },
        avgResponseMs: { $avg: '$rounds.answers.elapsedMs' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const trend = weekly.map((w) => ({
    week: w._id,
    accuracy: w.answered ? Math.round((w.correct / w.answered) * 100) : 0,
    avgResponseMs: Math.round(w.avgResponseMs ?? 0),
    answered: w.answered,
  }));

  const first = trend[0]?.accuracy ?? null;
  const last = trend[trend.length - 1]?.accuracy ?? null;

  return {
    ...report,
    trend,
    /** null rather than 0 when there is not enough history to say anything. */
    improvement: trend.length >= 2 ? last - first : null,
    avgResponseMs: report.topics.length
      ? Math.round(
          report.topics.reduce((s, t) => s + (t.avgResponseMs ?? 0), 0) / report.topics.length,
        )
      : 0,
  };
}

/** prd.md F8.6.4 — item analysis across the full bank. */
export async function itemAnalysisReport(scope, { flaggedOnly = false, limit = 200 } = {}) {
  const rows = await Question.find(
    { origin: scope.spaceId, status: QUESTION_STATUS.PUBLISHED, 'stats.served': { $gte: 10 } },
    { content: 1, defaultLanguage: 1, correctIndex: 1, difficulty: 1, stats: 1, topicIds: 1 },
  )
    .sort({ 'stats.served': -1 })
    .limit(limit)
    .populate('topicIds', 'name')
    .lean();

  const items = rows
    .map((row) => {
      const content = row.content?.[row.defaultLanguage] ?? Object.values(row.content ?? {})[0] ?? {};
      return {
        id: String(row._id),
        text: content.text ?? '',
        difficulty: row.difficulty,
        topics: (row.topicIds ?? []).map((t) => t?.name).filter(Boolean),
        ...itemAnalysisFor(row),
      };
    })
    .filter((item) => !flaggedOnly || item.flag);

  return { total: items.length, items };
}

/** prd.md F8.6.5 — batch vs batch. */
export async function batchComparison(scope, { days = 30 } = {}) {
  const members = await SpaceMember.find(
    { spaceId: scope.spaceId, status: 'active', batchId: { $ne: null } },
    { userId: 1, batchId: 1 },
  ).lean();
  if (!members.length) return [];

  const batchOf = new Map(members.map((m) => [String(m.userId), String(m.batchId)]));

  const rows = await Match.aggregate([
    {
      $match: {
        spaceId: scope.spaceId,
        status: 'complete',
        completedAt: { $gte: daysAgo(days) },
        'players.userId': { $in: members.map((m) => m.userId) },
      },
    },
    { $unwind: '$players' },
    { $match: { 'players.isGhost': { $ne: true } } },
    {
      $group: {
        _id: '$players.userId',
        matches: { $sum: 1 },
        score: { $avg: '$players.score' },
        correct: { $sum: '$players.correctCount' },
      },
    },
  ]);

  const byBatch = new Map();
  for (const row of rows) {
    const batchId = batchOf.get(String(row._id));
    if (!batchId) continue;
    const acc = byBatch.get(batchId) ?? { students: 0, matches: 0, scoreTotal: 0, correct: 0 };
    acc.students += 1;
    acc.matches += row.matches;
    acc.scoreTotal += row.score;
    acc.correct += row.correct;
    byBatch.set(batchId, acc);
  }

  const { Batch } = await import('../models/index.js');
  const batches = await Batch.find({ spaceId: scope.spaceId }).lean();

  return batches.map((b) => {
    const acc = byBatch.get(String(b._id)) ?? { students: 0, matches: 0, scoreTotal: 0, correct: 0 };
    return {
      batchId: String(b._id),
      name: b.name,
      activeStudents: acc.students,
      matches: acc.matches,
      avgScore: acc.students ? Number((acc.scoreTotal / acc.students).toFixed(1)) : 0,
      avgMatchesPerStudent: acc.students ? Number((acc.matches / acc.students).toFixed(1)) : 0,
    };
  });
}

/**
 * prd.md F8.6.5 — period vs period.
 *
 * Compares the last N days against the N days before them, on the four numbers
 * an admin can actually act on. Deliberately not a chart: a chart shows a
 * shape, and this question is "is it better or worse than it was", which is a
 * number and a direction.
 */
export async function periodComparison(scope, { days = 30, topicId } = {}) {
  const now = Date.now();
  const currentFrom = new Date(now - days * 24 * 60 * 60 * 1000);
  const previousFrom = new Date(now - 2 * days * 24 * 60 * 60 * 1000);

  const base = { spaceId: scope.spaceId, status: 'complete' };
  if (topicId && mongoose.isValidObjectId(topicId)) base.topicId = oid(topicId);

  const measure = async (from, to) => {
    const rows = await Match.aggregate([
      { $match: { ...base, completedAt: { $gte: from, $lt: to } } },
      { $unwind: '$players' },
      { $match: { 'players.isGhost': { $ne: true } } },
      {
        $group: {
          _id: null,
          matches: { $sum: 1 },
          players: { $addToSet: '$players.userId' },
          scoreTotal: { $sum: '$players.score' },
          correct: { $sum: '$players.correctCount' },
        },
      },
    ]);
    const row = rows[0];
    if (!row) return { matches: 0, players: 0, avgScore: 0, accuracy: 0 };

    // One "match" row per player after the unwind, and each carries seven
    // rounds, so the answer count is derivable without a second aggregation.
    const answers = row.matches * ROUNDS_PER_MATCH;
    return {
      matches: row.matches,
      players: row.players.length,
      avgScore: row.matches ? Number((row.scoreTotal / row.matches).toFixed(1)) : 0,
      accuracy: answers ? Math.round((row.correct / answers) * 100) : 0,
    };
  };

  const [current, previous] = await Promise.all([
    measure(currentFrom, new Date(now)),
    measure(previousFrom, currentFrom),
  ]);

  const delta = (a, b) => {
    if (!b) return a ? 100 : 0;
    return Number((((a - b) / b) * 100).toFixed(1));
  };

  return {
    days,
    current,
    previous,
    change: {
      matches: delta(current.matches, previous.matches),
      players: delta(current.players, previous.players),
      avgScore: delta(current.avgScore, previous.avgScore),
      accuracy: current.accuracy - previous.accuracy, // already a percentage
    },
    labels: {
      current: `Last ${days} days`,
      previous: `The ${days} days before`,
    },
  };
}

// ── Platform analytics (prd.md F9.4.1) ─────────────────────────────────────

export async function platformAnalytics({ days = 30 } = {}) {
  const [dau, mau, matchesPerDay, fillStats, spaces, users] = await Promise.all([
    activeUserCount(1),
    activeUserCount(30),
    Match.aggregate([
      { $match: { createdAt: { $gte: daysAgo(days) } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: '+05:30' } },
          matches: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'complete'] }, 1, 0] } },
          ghosted: { $sum: { $cond: [{ $anyElementTrue: '$players.isGhost' }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Match.aggregate([
      { $match: { createdAt: { $gte: daysAgo(7) } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'complete'] }, 1, 0] } },
          ghosted: { $sum: { $cond: [{ $anyElementTrue: '$players.isGhost' }, 1, 0] } },
        },
      },
    ]),
    Space.countDocuments({ status: 'active', isPublic: false }),
    User.countDocuments({ status: 'active' }),
  ]);

  const fill = fillStats[0] ?? { total: 0, completed: 0, ghosted: 0 };

  return {
    dau,
    mau,
    dauOverMau: mau ? Number((dau / mau).toFixed(3)) : 0,
    totalUsers: users,
    activeSpaces: spaces,
    /** prd.md G2 — match fill rate target is 99%. */
    matchFillRate: 1,
    matchCompletionRate: fill.total ? Number((fill.completed / fill.total).toFixed(3)) : 0,
    /** prd.md F6.7.7 — sustained above 60% on a topic means no real liquidity. */
    ghostRatio: fill.total ? Number((fill.ghosted / fill.total).toFixed(3)) : 0,
    series: matchesPerDay.map((r) => ({
      date: r._id,
      matches: r.matches,
      completed: r.completed,
      ghostRatio: r.matches ? Number((r.ghosted / r.matches).toFixed(3)) : 0,
    })),
  };
}

async function activeUserCount(days) {
  return User.countDocuments({ lastActiveAt: { $gte: daysAgo(days) }, status: 'active' });
}

/** tech.md §14 — ghost ratio per topic is the liquidity alarm. */
export async function ghostRatioByTopic({ limit = 20, days = 7 } = {}) {
  const rows = await Match.aggregate([
    { $match: { createdAt: { $gte: daysAgo(days) } } },
    {
      $group: {
        _id: '$topicId',
        total: { $sum: 1 },
        ghosted: { $sum: { $cond: [{ $anyElementTrue: '$players.isGhost' }, 1, 0] } },
      },
    },
    { $match: { total: { $gte: 5 } } },
    { $addFields: { ratio: { $divide: ['$ghosted', '$total'] } } },
    { $sort: { ratio: -1 } },
    { $limit: limit },
  ]);

  // tenant-ok: platform-wide liquidity view, superadmin only (F9.4.1).
  // Deliberately spans every space — that is what the metric measures.
  const topics = await Topic.find({ _id: { $in: rows.map((r) => r._id) } }, { name: 1, spaceId: 1 }).lean();
  const byId = new Map(topics.map((t) => [String(t._id), t]));

  return rows.map((r) => ({
    topicId: String(r._id),
    name: byId.get(String(r._id))?.name ?? 'Unknown',
    matches: r.total,
    ghostRatio: Number(r.ratio.toFixed(3)),
    healthy: r.ratio < 0.6,
  }));
}

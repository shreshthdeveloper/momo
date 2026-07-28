import mongoose from 'mongoose';
import {
  Assignment,
  AssignmentProgress,
  SpaceMember,
  Topic,
  Batch,
  User,
  isPublicSpace,
} from '../models/index.js';
import { assertPermission } from './spaceService.js';
import { notify } from './notificationService.js';
import { NotFoundError, BadRequestError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import {
  ASSIGNMENT_REQUIREMENT,
  ASSIGNMENT_STATUS,
  ASSIGNMENT_MAX_MATCHES,
  SPACE_ROLE,
} from '../shared/constants.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Assignments (prd.md F8.5.5, F8.5.6 for admins; F7.4 for students).
 *
 * The design decision that makes these worth having: **an assignment is
 * satisfied by ordinary play.** There is no separate mode to enter and nothing
 * to submit — a student plays the topic and the progress moves. That is why
 * `applyMatchToAssignments` hangs off the match finaliser rather than off a
 * button, and why a student who never opens the assignments tab still finishes
 * their work.
 */

// ── Admin: authoring ───────────────────────────────────────────────────────

function normaliseRequirement(input = {}) {
  const type = Object.values(ASSIGNMENT_REQUIREMENT).includes(input.type)
    ? input.type
    : ASSIGNMENT_REQUIREMENT.MATCHES;

  return {
    type,
    matches: clamp(Number(input.matches) || 3, 1, ASSIGNMENT_MAX_MATCHES),
    minAccuracy: clamp(Number(input.minAccuracy) || 60, 0, 100),
    level: clamp(Number(input.level) || 5, 1, 50),
  };
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export async function createAssignment(scope, user, input) {
  assertPermission(scope, 'manageContests');

  const topic = await Topic.findOne({ _id: oid(input.topicId), spaceId: scope.spaceId }).lean();
  if (!topic) throw new BadRequestError('That topic is not in this space.', 'TOPIC_NOT_IN_SPACE');

  const dueAt = new Date(input.dueAt);
  if (Number.isNaN(dueAt.getTime())) throw new BadRequestError('Give the assignment a due date.');
  if (dueAt.getTime() < Date.now()) {
    throw new BadRequestError('The due date has already passed.');
  }

  const assignment = await Assignment.create({
    spaceId: scope.spaceId,
    topicId: topic._id,
    title: input.title,
    description: input.description,
    requirement: normaliseRequirement(input.requirement),
    dueAt,
    batchIds: (input.batchIds ?? []).map(oid),
    status: ASSIGNMENT_STATUS.ACTIVE,
    createdBy: user._id,
  });

  /**
   * No progress rows are written here. Who an assignment is *for* is derived
   * from live membership every time it is read — see `targetedMembers`. Rows
   * appear when a student first plays.
   *
   * The alternative, seeding a row per student at creation, silently rots: a
   * student who joins tomorrow has no row, one who leaves keeps theirs, and
   * "12 of 30 done" ends up wrong in a way nobody notices until a parent asks.
   */
  const assigned = (await targetedMembers(assignment)).length;
  return shapeAssignment(
    { ...assignment.toObject(), stats: { assigned, completed: 0 } },
    topic,
  );
}

/** Active students this assignment is aimed at, resolved from live membership. */
async function targetedMembers(assignment) {
  const filter = {
    spaceId: assignment.spaceId,
    status: 'active',
    role: SPACE_ROLE.STUDENT,
  };
  if (assignment.batchIds?.length) filter.batchId = { $in: assignment.batchIds };
  return SpaceMember.find(filter, { userId: 1, batchId: 1 }).limit(10_000).lean();
}

export async function updateAssignment(scope, assignmentId, input) {
  assertPermission(scope, 'manageContests');
  const assignment = await Assignment.findOne({
    _id: oid(assignmentId),
    spaceId: scope.spaceId,
  });
  if (!assignment) throw new NotFoundError('No such assignment.');

  if (input.title !== undefined) assignment.title = input.title;
  if (input.description !== undefined) assignment.description = input.description;
  if (input.dueAt) {
    const dueAt = new Date(input.dueAt);
    if (Number.isNaN(dueAt.getTime())) throw new BadRequestError('That is not a valid due date.');
    assignment.dueAt = dueAt;
    // A new deadline deserves a new reminder.
    assignment.dueReminderSentAt = null;
  }
  if (input.requirement) assignment.requirement = normaliseRequirement(input.requirement);
  if (input.status) assignment.status = input.status;

  await assignment.save();

  // The requirement may have moved; re-evaluate everyone against the new one
  // rather than leaving a student "incomplete" against a rule that changed.
  if (input.requirement) await recomputeCompletion(assignment);

  return getAssignment(scope, assignment._id);
}

export async function archiveAssignment(scope, assignmentId) {
  assertPermission(scope, 'manageContests');
  const result = await Assignment.updateOne(
    { _id: oid(assignmentId), spaceId: scope.spaceId },
    { $set: { status: ASSIGNMENT_STATUS.ARCHIVED } },
  );
  if (!result.matchedCount) throw new NotFoundError('No such assignment.');
  return { archived: true };
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function listAssignments(scope, { status = ASSIGNMENT_STATUS.ACTIVE, limit = 50 } = {}) {
  const filter = { spaceId: scope.spaceId };
  if (status !== 'all') filter.status = status;

  const rows = await Assignment.find(filter)
    .sort({ dueAt: 1 })
    .limit(Math.min(limit, 100))
    .populate('topicId', 'name coverUrl')
    .lean();
  if (!rows.length) return { items: [] };

  /**
   * The denominator is counted live rather than read from a stored `assigned`
   * figure. A stored count drifts the moment a student joins, leaves, or moves
   * batch — and "12 of 30 done" being quietly wrong is worse than the extra
   * query, which is two indexed counts for the whole page.
   */
  const counts = await assignedCounts(scope, rows);

  return {
    items: rows.map((a) => {
      const count = counts.get(String(a._id));
      return shapeAssignment({ ...a, stats: count }, a.topicId);
    }),
  };
}

/** assignmentId → { assigned, completed } */
async function assignedCounts(scope, assignments) {
  const [members, completions] = await Promise.all([
    SpaceMember.find(
      { spaceId: scope.spaceId, status: 'active', role: SPACE_ROLE.STUDENT },
      { batchId: 1 },
    ).lean(),
    AssignmentProgress.aggregate([
      {
        $match: {
          assignmentId: { $in: assignments.map((a) => a._id) },
          spaceId: scope.spaceId,
          completedAt: { $ne: null },
        },
      },
      { $group: { _id: '$assignmentId', n: { $sum: 1 } } },
    ]),
  ]);

  const completedBy = new Map(completions.map((c) => [String(c._id), c.n]));

  return new Map(
    assignments.map((a) => {
      const assigned = a.batchIds?.length
        ? members.filter((m) => a.batchIds.some((b) => String(b) === String(m.batchId ?? '')))
            .length
        : members.length;
      return [String(a._id), { assigned, completed: completedBy.get(String(a._id)) ?? 0 }];
    }),
  );
}

export async function getAssignment(scope, assignmentId) {
  const assignment = await Assignment.findOne({ _id: oid(assignmentId), spaceId: scope.spaceId })
    .populate('topicId', 'name coverUrl')
    .lean();
  if (!assignment) throw new NotFoundError('No such assignment.');

  const [members, rows, batches] = await Promise.all([
    targetedMembers(assignment),
    AssignmentProgress.find({ assignmentId: assignment._id, spaceId: scope.spaceId })
      .limit(10_000)
      .lean(),
    assignment.batchIds?.length
      ? Batch.find({ _id: { $in: assignment.batchIds }, spaceId: scope.spaceId }, { name: 1 }).lean()
      : [],
  ]);

  const byUser = new Map(rows.map((r) => [String(r.userId), r]));
  const users = await User.find(
    { _id: { $in: members.map((m) => m.userId) } },
    { displayName: 1, avatarUrl: 1 },
  ).lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  /**
   * Every targeted student appears, including the ones who have done nothing —
   * those are the list an admin actually needs. Not started sorts first, then
   * in progress, then done.
   */
  const students = members
    .map((m) => {
      const user = userById.get(String(m.userId));
      const progress = progressFor(assignment, byUser.get(String(m.userId)));
      return {
        userId: String(m.userId),
        displayName: user?.displayName ?? 'Student',
        avatarUrl: user?.avatarUrl ?? null,
        ...progress,
      };
    })
    .sort((a, b) => {
      if (a.complete !== b.complete) return a.complete ? 1 : -1;
      return a.fraction - b.fraction;
    });

  return {
    ...shapeAssignment(
      {
        ...assignment,
        stats: { assigned: members.length, completed: students.filter((s) => s.complete).length },
      },
      assignment.topicId,
    ),
    batches: batches.map((b) => ({ id: String(b._id), name: b.name })),
    students,
  };
}

/** prd.md F7.4 — requirement, progress, due date, completion state. */
export async function listAssignmentsForStudent(scope, userId, { includeDone = true } = {}) {
  if (isPublicSpace(scope.spaceId)) return [];

  const filter = {
    spaceId: scope.spaceId,
    status: ASSIGNMENT_STATUS.ACTIVE,
  };
  if (scope.role === SPACE_ROLE.STUDENT) {
    filter.$or = [{ batchIds: { $size: 0 } }, { batchIds: scope.batchId ?? null }];
  }

  const assignments = await Assignment.find(filter)
    .sort({ dueAt: 1 })
    .limit(30)
    .populate('topicId', 'name coverUrl')
    .lean();
  if (!assignments.length) return [];

  const progress = await AssignmentProgress.find({
    assignmentId: { $in: assignments.map((a) => a._id) },
    spaceId: scope.spaceId,
    userId: oid(userId),
  }).lean();
  const byAssignment = new Map(progress.map((p) => [String(p.assignmentId), p]));

  return assignments
    .map((a) => ({
      ...shapeAssignment(a, a.topicId),
      you: progressFor(a, byAssignment.get(String(a._id))),
    }))
    .filter((a) => includeDone || !a.you.complete);
}

export function shapeAssignment(assignment, topic) {
  const doc = assignment.toObject?.() ?? assignment;
  const dueAt = new Date(doc.dueAt);
  const msLeft = dueAt.getTime() - Date.now();

  return {
    id: String(doc._id),
    title: doc.title,
    description: doc.description ?? null,
    topic: topic?._id
      ? { id: String(topic._id), name: topic.name, coverUrl: topic.coverUrl ?? null }
      : { id: String(doc.topicId) },
    requirement: doc.requirement,
    requirementText: requirementText(doc.requirement, topic?.name),
    dueAt: doc.dueAt,
    overdue: msLeft < 0,
    dueSoon: msLeft >= 0 && msLeft < 48 * 60 * 60 * 1000,
    batchIds: (doc.batchIds ?? []).map(String),
    status: doc.status,
    /** Only present where the caller counted it; never a stored, drifting value. */
    stats: doc.stats ?? null,
  };
}

/** design.md §10 — plain, second person, states the requirement not the feeling. */
export function requirementText(requirement, topicName) {
  const where = topicName ? ` in ${topicName}` : '';
  if (requirement?.type === ASSIGNMENT_REQUIREMENT.ACCURACY) {
    return `Score ${requirement.minAccuracy}% or better across ${requirement.matches} ${plural(requirement.matches, 'match', 'matches')}${where}.`;
  }
  if (requirement?.type === ASSIGNMENT_REQUIREMENT.MASTERY) {
    return `Reach level ${requirement.level}${where}.`;
  }
  return `Play ${requirement?.matches ?? 1} ${plural(requirement?.matches ?? 1, 'match', 'matches')}${where}.`;
}

const plural = (n, one, many) => (n === 1 ? one : many);

/**
 * One student's state against one assignment. Returns a fraction as well as a
 * boolean so the UI can draw a bar rather than a tick — a student two matches
 * from done should be able to see that.
 */
export function progressFor(assignment, row) {
  const requirement = assignment.requirement ?? {};
  const played = row?.matchesPlayed ?? 0;
  const answered = row?.answeredCount ?? 0;
  const correct = row?.correctCount ?? 0;
  const accuracy = answered ? Math.round((correct / answered) * 100) : 0;
  const level = row?.level ?? 0;

  let current = played;
  let target = requirement.matches ?? 1;
  let label = `${played} of ${target}`;

  if (requirement.type === ASSIGNMENT_REQUIREMENT.ACCURACY) {
    // Two conditions, and the one that is behind is the one worth showing.
    const matchesShort = played < (requirement.matches ?? 1);
    current = matchesShort ? played : accuracy;
    target = matchesShort ? (requirement.matches ?? 1) : (requirement.minAccuracy ?? 60);
    label = matchesShort
      ? `${played} of ${requirement.matches} played`
      : `${accuracy}% of ${requirement.minAccuracy}% needed`;
  } else if (requirement.type === ASSIGNMENT_REQUIREMENT.MASTERY) {
    current = level;
    target = requirement.level ?? 1;
    label = `Level ${level} of ${target}`;
  }

  return {
    matchesPlayed: played,
    accuracy,
    level,
    current,
    target,
    label,
    fraction: target ? Math.min(1, current / target) : 0,
    complete: Boolean(row?.completedAt),
    late: Boolean(row?.late),
    completedAt: row?.completedAt ?? null,
    lastMatchAt: row?.lastMatchAt ?? null,
  };
}

function meetsRequirement(assignment, row) {
  const requirement = assignment.requirement ?? {};
  const played = row?.matchesPlayed ?? 0;
  const answered = row?.answeredCount ?? 0;
  const correct = row?.correctCount ?? 0;

  if (requirement.type === ASSIGNMENT_REQUIREMENT.ACCURACY) {
    if (played < (requirement.matches ?? 1)) return false;
    if (!answered) return false;
    return (correct / answered) * 100 >= (requirement.minAccuracy ?? 0);
  }
  if (requirement.type === ASSIGNMENT_REQUIREMENT.MASTERY) {
    return (row?.level ?? 0) >= (requirement.level ?? 1);
  }
  return played >= (requirement.matches ?? 1);
}

// ── The hook on match completion ───────────────────────────────────────────

/**
 * Advance every assignment this match could have satisfied.
 *
 * Called from `finalizeMatch`, once per human player. Cheap by construction:
 * one indexed lookup on `{spaceId, topicId, status}`, and nothing at all in
 * the Public Arena, where assignments cannot exist.
 */
export async function applyMatchToAssignments({
  spaceId,
  topicId,
  userId,
  correctCount,
  answeredCount,
  level,
  playedAt = new Date(),
}) {
  if (!spaceId || isPublicSpace(spaceId)) return [];

  const assignments = await Assignment.find({
    spaceId: oid(spaceId),
    topicId: oid(topicId),
    status: ASSIGNMENT_STATUS.ACTIVE,
  }).lean();
  if (!assignments.length) return [];

  // A student only counts toward assignments aimed at them. Reading the
  // membership here rather than trusting the match record keeps the batch
  // check on the same footing as every other tenant check.
  const member = await SpaceMember.findOne(
    { spaceId: oid(spaceId), userId: oid(userId), status: 'active' },
    { batchId: 1 },
  ).lean();
  if (!member) return [];

  const targeted = assignments.filter(
    (a) =>
      !a.batchIds?.length ||
      a.batchIds.some((b) => String(b) === String(member.batchId ?? '')),
  );
  if (!targeted.length) return [];

  const completed = [];

  for (const assignment of targeted) {
    const row = await AssignmentProgress.findOneAndUpdate(
      // An upsert takes the equality terms of the filter as the new document's
      // fields, so assignmentId / spaceId / userId are set without a
      // $setOnInsert — which must not be empty, and no longer has anything to say.
      { assignmentId: assignment._id, spaceId: oid(spaceId), userId: oid(userId) },
      {
        $inc: {
          matchesPlayed: 1,
          answeredCount: answeredCount ?? 0,
          correctCount: correctCount ?? 0,
        },
        $max: { level: level ?? 0 },
        $set: { lastMatchAt: playedAt },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    if (row.completedAt || !meetsRequirement(assignment, row)) continue;

    const late = playedAt.getTime() > new Date(assignment.dueAt).getTime();
    await AssignmentProgress.updateOne(
      { _id: row._id, completedAt: null },
      { $set: { completedAt: playedAt, late } },
    );
    completed.push({ id: String(assignment._id), title: assignment.title, late });
  }

  return completed;
}

/** Re-evaluate every student after the requirement itself changed. */
async function recomputeCompletion(assignment) {
  const rows = await AssignmentProgress.find({
    assignmentId: assignment._id,
    spaceId: assignment.spaceId,
  });
  let completed = 0;

  for (const row of rows) {
    const meets = meetsRequirement(assignment, row);
    if (meets && !row.completedAt) {
      row.completedAt = new Date();
      row.late = row.completedAt.getTime() > new Date(assignment.dueAt).getTime();
      await row.save();
    } else if (!meets && row.completedAt) {
      // The bar was raised. Honest is better than generous here: the admin
      // moved the goalposts and the student needs to know they moved.
      row.completedAt = null;
      row.late = false;
      await row.save();
    }
    if (row.completedAt) completed += 1;
  }

  return completed;
}

// ── Reminders (tech.md §10 — daily 09:00 IST) ──────────────────────────────

/** prd.md §6.9 — "Assignment due tomorrow". Sent once per assignment. */
export async function remindDueAssignments(now = new Date()) {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  /**
   * tenant-ok: the reminder job runs across every organization on the same daily
   * tick. It selects only on schedule fields, and every notification it sends
   * is addressed from that assignment's own space and batch targeting.
   */
  const due = await Assignment.find({
    status: ASSIGNMENT_STATUS.ACTIVE,
    dueReminderSentAt: null,
    dueAt: { $gt: now, $lte: tomorrow },
  })
    .populate('topicId', 'name')
    .lean();

  let notified = 0;

  for (const assignment of due) {
    // Derived from live membership minus the students who are already done —
    // rather than from progress rows, which only exist for students who have
    // played. The ones who have not played are exactly who this is for.
    const [members, finished] = await Promise.all([
      targetedMembers(assignment),
      AssignmentProgress.find(
        { assignmentId: assignment._id, spaceId: assignment.spaceId, completedAt: { $ne: null } },
        { userId: 1 },
      ).lean(),
    ]);
    const done = new Set(finished.map((f) => String(f.userId)));
    const outstanding = members.filter((m) => !done.has(String(m.userId)));

    for (const row of outstanding) {
      await notify(row.userId, {
        type: 'assignment_due',
        prefKey: 'assignmentDue',
        title: `${assignment.title} is due tomorrow`,
        body: requirementText(assignment.requirement, assignment.topicId?.name),
        spaceId: assignment.spaceId,
        data: { assignmentId: String(assignment._id) },
      }).catch(() => {});
      notified += 1;
    }

    await Assignment.updateOne(
      { _id: assignment._id },
      { $set: { dueReminderSentAt: now } },
    );
  }

  if (notified) logger.info({ assignments: due.length, notified }, 'assignment reminders sent');
  return { assignments: due.length, notified };
}

/**
 * One student's headline numbers, for the space home and the admin's student
 * page. Counted from the assignments aimed at them, so a student who has not
 * played anything yet still sees "0 of 4 done" rather than "0 of 0".
 */
export async function assignmentSummaryFor(scope, userId) {
  if (isPublicSpace(scope.spaceId)) return { assigned: 0, completed: 0, overdue: 0 };

  const member = await SpaceMember.findOne(
    { spaceId: scope.spaceId, userId: oid(userId), status: 'active' },
    { batchId: 1, role: 1 },
  ).lean();
  if (!member) return { assigned: 0, completed: 0, overdue: 0 };

  const assignments = await Assignment.find({
    spaceId: scope.spaceId,
    status: ASSIGNMENT_STATUS.ACTIVE,
  }).lean();

  const mine = assignments.filter(
    (a) => !a.batchIds?.length || a.batchIds.some((b) => String(b) === String(member.batchId ?? '')),
  );
  if (!mine.length) return { assigned: 0, completed: 0, overdue: 0 };

  const rows = await AssignmentProgress.find({
    assignmentId: { $in: mine.map((a) => a._id) },
    spaceId: scope.spaceId,
    userId: oid(userId),
  }).lean();
  const byAssignment = new Map(rows.map((r) => [String(r.assignmentId), r]));

  let completed = 0;
  let overdue = 0;

  for (const assignment of mine) {
    const row = byAssignment.get(String(assignment._id));
    if (row?.completedAt) completed += 1;
    else if (new Date(assignment.dueAt).getTime() < Date.now()) overdue += 1;
  }

  return { assigned: mine.length, completed, overdue };
}

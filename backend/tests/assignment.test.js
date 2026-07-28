import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startHarness,
  stopHarness,
  resetDb,
  makeUser,
  makeSpace,
  makeTopic,
  addMember,
  connectClient,
  api,
} from './helpers.js';
import { Assignment, AssignmentProgress, Batch, SpaceMember } from '../src/models/index.js';
import {
  applyMatchToAssignments,
  remindDueAssignments,
  requirementText,
  progressFor,
} from '../src/services/assignmentService.js';
import { Notification } from '../src/models/index.js';
import { C2S, S2C } from '../src/shared/protocol.js';
import { SPACE_ROLE } from '../src/shared/constants.js';

/**
 * Assignments (prd.md F8.5.5, F8.5.6, F7.4).
 *
 * The property that matters most: **ordinary play advances an assignment.**
 * A student who never opens the assignments tab still finishes their work, and
 * that is only true if the hook lives on the match finaliser.
 */

let harness;
let admin;
let student;
let other;
let space;
let topic;

const inDays = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

before(async () => {
  harness = await startHarness();
});

after(async () => {
  await stopHarness();
});

beforeEach(async () => {
  await resetDb();
  admin = await makeUser({ displayName: 'Assign Admin' });
  student = await makeUser({ displayName: 'Assign Student' });
  other = await makeUser({ displayName: 'Other Student' });
  space = await makeSpace({ name: 'Assign Institute', owner: admin.user });
  await addMember(space, student.user, SPACE_ROLE.STUDENT);
  await addMember(space, other.user, SPACE_ROLE.STUDENT);
  ({ topic } = await makeTopic({ spaceId: space._id, name: 'Assigned Topic' }));
});

async function makeAssignment(overrides = {}) {
  return Assignment.create({
    spaceId: space._id,
    topicId: topic._id,
    title: 'Practice mechanics',
    requirement: { type: 'matches', matches: 2 },
    dueAt: inDays(3),
    createdBy: admin.user._id,
    ...overrides,
  });
}

/** One completed match, driven through the real socket path. */
async function playOnce(player, { correct = true } = {}) {
  const client = connectClient(player.token, { port: harness.port });
  await client.connected();
  await client.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id), spaceId: String(space._id) });

  const found = await client.wait(S2C.MATCH_FOUND, { timeoutMs: 6000 });
  const matchId = found.payload.matchId;
  const totalRounds = found.payload.totalRounds;

  for (let round = 0; round < totalRounds; round += 1) {
    const frame = await client.wait(S2C.ROUND_START, {
      predicate: (p) => p.roundIndex === round,
      timeoutMs: 6000,
    });
    const right = frame.payload.question.options.findIndex((o) => o.startsWith('Right'));
    const pick = correct ? right : (right + 1) % 4;
    await client.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: round, optionIndex: pick });
  }

  const end = await client.wait(S2C.MATCH_END, { timeoutMs: 10_000 });
  client.close();
  return end.payload;
}

test('assignments', async (t) => {
  await t.test('ordinary play advances an assignment, with no submit step', async () => {
    const assignment = await makeAssignment({ requirement: { type: 'matches', matches: 2 } });

    const first = await playOnce(student);
    assert.deepEqual(first.assignmentsCompleted, [], 'one of two is not done yet');

    let progress = await AssignmentProgress.findOne({
      assignmentId: assignment._id,
      userId: student.user._id,
    }).lean();
    assert.equal(progress.matchesPlayed, 1);
    assert.equal(progress.completedAt, null);

    const second = await playOnce(student);
    assert.equal(second.assignmentsCompleted.length, 1);
    assert.equal(second.assignmentsCompleted[0].title, 'Practice mechanics');

    progress = await AssignmentProgress.findOne({ _id: progress._id }).lean();
    assert.equal(progress.matchesPlayed, 2);
    assert.ok(progress.completedAt);
    assert.equal(progress.late, false);
  });

  await t.test('an accuracy requirement needs both the matches and the accuracy', async () => {
    const assignment = await makeAssignment({
      requirement: { type: 'accuracy', matches: 1, minAccuracy: 90 },
    });

    // Deliberately wrong on every round.
    const end = await playOnce(student, { correct: false });
    assert.deepEqual(end.assignmentsCompleted, [], 'played the match, missed the bar');

    const row = await AssignmentProgress.findOne({
      assignmentId: assignment._id,
      userId: student.user._id,
    }).lean();
    assert.equal(row.matchesPlayed, 1);
    assert.equal(row.completedAt, null);

    const view = progressFor(assignment.toObject(), row);
    assert.equal(view.complete, false);
    assert.match(view.label, /% of 90% needed/);
  });

  await t.test('a late completion is recorded as late, not refused', async () => {
    const assignment = await makeAssignment({
      requirement: { type: 'matches', matches: 1 },
      dueAt: inDays(2),
    });
    // Move the deadline into the past without touching the progress row.
    await Assignment.updateOne({ _id: assignment._id }, { $set: { dueAt: inDays(-1) } });

    await playOnce(student);

    const row = await AssignmentProgress.findOne({
      assignmentId: assignment._id,
      userId: student.user._id,
    }).lean();
    assert.ok(row.completedAt, 'the work still counts');
    assert.equal(row.late, true, 'and the admin can see it came in late');
  });

  await t.test('a batch-scoped assignment only counts for that batch', async () => {
    const batch = await Batch.create({ spaceId: space._id, name: 'Evening' });
    await SpaceMember.updateOne(
      { spaceId: space._id, userId: student.user._id },
      { $set: { batchId: batch._id } },
    );

    const assignment = await makeAssignment({
      batchIds: [batch._id],
      requirement: { type: 'matches', matches: 1 },
    });

    await playOnce(other); // not in the batch
    assert.equal(
      await AssignmentProgress.countDocuments({ assignmentId: assignment._id }),
      0,
      'a student outside the batch generates no progress at all',
    );

    await playOnce(student);
    assert.equal(await AssignmentProgress.countDocuments({ assignmentId: assignment._id }), 1);
  });

  await t.test('the denominator follows live membership', async () => {
    await makeAssignment();

    const request = api(harness.app, admin.token);
    let res = await request.get(`/admin/assignments?spaceId=${space._id}`);
    let { data } = await request.json(res);
    assert.equal(data.items[0].stats.assigned, 2, 'two students in the space');

    // A third joins. The count must move without anything being backfilled.
    const third = await makeUser({ displayName: 'Latecomer' });
    await addMember(space, third.user, SPACE_ROLE.STUDENT);

    res = await request.get(`/admin/assignments?spaceId=${space._id}`);
    ({ data } = await request.json(res));
    assert.equal(data.items[0].stats.assigned, 3);
  });

  await t.test('the admin sees every targeted student, including those who did nothing', async () => {
    const assignment = await makeAssignment();
    await playOnce(student);

    const request = api(harness.app, admin.token);
    const res = await request.get(`/admin/assignments/${assignment._id}?spaceId=${space._id}`);
    const { data } = await request.json(res);

    assert.equal(data.students.length, 2);
    const names = data.students.map((s) => s.displayName);
    assert.ok(names.includes('Other Student'), 'the student who has not started is the point');

    // Not started sorts before in progress.
    assert.equal(data.students[0].matchesPlayed, 0);
  });

  await t.test('raising the bar un-completes a student, honestly', async () => {
    const assignment = await makeAssignment({ requirement: { type: 'matches', matches: 1 } });
    await playOnce(student);

    let row = await AssignmentProgress.findOne({ assignmentId: assignment._id }).lean();
    assert.ok(row.completedAt);

    const request = api(harness.app, admin.token);
    const res = await request.patch(`/admin/assignments/${assignment._id}`, {
      spaceId: String(space._id),
      requirement: { type: 'matches', matches: 4 },
    });
    assert.equal(res.statusCode, 200);

    row = await AssignmentProgress.findOne({ _id: row._id }).lean();
    assert.equal(row.completedAt, null, 'the goalposts moved and the student needs to know');
  });

  await t.test('the due-tomorrow reminder reaches the students who have not finished', async () => {
    const assignment = await makeAssignment({
      requirement: { type: 'matches', matches: 1 },
      dueAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
    });

    // One student finishes; the other does not.
    await playOnce(student);

    const result = await remindDueAssignments();
    assert.equal(result.assignments, 1);
    assert.equal(result.notified, 1, 'only the student with work outstanding');

    const notes = await Notification.find({ type: 'assignment_due' }).lean();
    assert.equal(notes.length, 1);
    assert.equal(String(notes[0].userId), String(other.user._id));
    assert.match(notes[0].title, /due tomorrow/);

    // Sent once, not once per sweep.
    await remindDueAssignments();
    assert.equal(await Notification.countDocuments({ type: 'assignment_due' }), 1);

    assert.ok(await Assignment.findById(assignment._id));
  });

  await t.test('assignments do not exist in the Public Arena', async () => {
    const { publicSpaceId } = await import('../src/models/index.js');
    const applied = await applyMatchToAssignments({
      spaceId: publicSpaceId,
      topicId: topic._id,
      userId: student.user._id,
      correctCount: 7,
      answeredCount: 7,
    });
    assert.deepEqual(applied, []);
  });

  await t.test('the student sees their own progress and the requirement in plain words', async () => {
    await makeAssignment({ requirement: { type: 'matches', matches: 3 } });
    await playOnce(student);

    const request = api(harness.app, student.token);
    const res = await request.get(`/spaces/${space._id}/assignments`);
    const { data } = await request.json(res);

    assert.equal(data.items.length, 1);
    const item = data.items[0];
    assert.equal(item.you.matchesPlayed, 1);
    assert.equal(item.you.label, '1 of 3');
    assert.ok(item.you.fraction > 0 && item.you.fraction < 1);
    assert.match(item.requirementText, /Play 3 matches in Assigned Topic\./);

    assert.deepEqual(data.summary, { assigned: 1, completed: 0, overdue: 0 });
  });

  await t.test('requirement copy stays plain', () => {
    assert.equal(
      requirementText({ type: 'matches', matches: 1 }, 'Optics'),
      'Play 1 match in Optics.',
    );
    assert.equal(
      requirementText({ type: 'accuracy', matches: 4, minAccuracy: 75 }, 'Optics'),
      'Score 75% or better across 4 matches in Optics.',
    );
    assert.equal(requirementText({ type: 'mastery', level: 8 }, 'Optics'), 'Reach level 8 in Optics.');
  });

  await t.test('space home carries assignments, contests and performance', async () => {
    await makeAssignment();
    await playOnce(student);

    const request = api(harness.app, student.token);
    const res = await request.get(`/spaces/${space._id}/home`);
    const { data } = await request.json(res);

    assert.equal(res.statusCode, 200);
    assert.equal(data.assignments.length, 1);
    assert.ok(Array.isArray(data.contests));
    assert.ok(data.performance, 'F7.6 — the student sees their own performance here');
    assert.equal(data.performance.matchesPlayed, 1);
  });
});

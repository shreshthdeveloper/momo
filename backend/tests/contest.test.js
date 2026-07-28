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
  sleep,
} from './helpers.js';
import { Contest, ContestEntry, Replay, Rating, Match } from '../src/models/index.js';
import { runContestLifecycle } from '../src/services/contestService.js';
import { C2S, S2C, ERROR_CODE } from '../src/shared/protocol.js';
import { SPACE_ROLE, CONTEST_STATUS } from '../src/shared/constants.js';

/**
 * Contests (prd.md §8.5, F7.5).
 *
 * The properties worth defending, in the order they would hurt if broken:
 *
 *  1. Every entrant sits the SAME paper. Break this and the standings are a
 *     ranking of who got the easy set.
 *  2. One entry per student.
 *  3. A contest never moves Elo.
 *  4. The contest paper never leaks into ordinary play while the window is open.
 */

let harness;
let admin;
let studentA;
let studentB;
let space;
let topic;

before(async () => {
  harness = await startHarness();
});

after(async () => {
  await stopHarness();
});

beforeEach(async () => {
  await resetDb();
  admin = await makeUser({ displayName: 'Contest Admin' });
  studentA = await makeUser({ displayName: 'Student A' });
  studentB = await makeUser({ displayName: 'Student B' });
  space = await makeSpace({ name: 'Contest Institute', owner: admin.user });
  await addMember(space, studentA.user, SPACE_ROLE.STUDENT);
  await addMember(space, studentB.user, SPACE_ROLE.STUDENT);
  ({ topic } = await makeTopic({ spaceId: space._id, name: 'Contest Topic' }));
});

/** A live contest, open now, with the paper already frozen. */
async function openContest(overrides = {}) {
  const contest = await Contest.create({
    spaceId: space._id,
    name: 'Weekly Test',
    topicIds: [topic._id],
    questionCount: 7,
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 60 * 60_000),
    status: CONTEST_STATUS.SCHEDULED,
    createdBy: admin.user._id,
    ...overrides,
  });
  await runContestLifecycle();
  return Contest.findById(contest._id);
}

/** Play one contest entry to completion and return the match:end payload. */
async function playContest(player, contestId) {
  const client = connectClient(player.token, { port: harness.port });
  await client.connected();

  const ack = await client.emit(C2S.CONTEST_ENTER, { contestId: String(contestId) });
  assert.equal(ack.ok, true, `entry rejected: ${ack.code ?? ''} ${ack.message ?? ''}`);

  await client.wait(S2C.MATCH_FOUND);
  const totalRounds = client.framesOf(S2C.MATCH_FOUND)[0].totalRounds;

  for (let round = 0; round < totalRounds; round += 1) {
    const frame = await client.wait(S2C.ROUND_START, {
      predicate: (p) => p.roundIndex === round,
      timeoutMs: 6000,
    });
    // Option 0 before the shuffle is always the right answer in the fixture,
    // and its shown position is whichever option starts with "Right".
    const correct = frame.payload.question.options.findIndex((o) => o.startsWith('Right'));
    await client.emit(C2S.MATCH_ANSWER, {
      matchId: frame.payload.matchId ?? client.framesOf(S2C.MATCH_FOUND)[0].matchId,
      roundIndex: round,
      optionIndex: correct,
    });
  }

  const end = await client.wait(S2C.MATCH_END, { timeoutMs: 10_000 });
  client.close();
  return { end: end.payload, client };
}

test('contests', async (t) => {
  await t.test('the paper is frozen once and every entrant gets the same one', async () => {
    const contest = await openContest();

    assert.ok(contest.questionsLockedAt, 'the lifecycle should have frozen the paper on open');
    assert.equal(contest.questionIds.length, 7);

    const paper = contest.questionIds.map(String);

    await playContest(studentA, contest._id);
    await playContest(studentB, contest._id);

    const matches = await Match.find({ contestId: contest._id }).lean();
    assert.equal(matches.length, 2);

    for (const match of matches) {
      assert.deepEqual(
        match.questionIds.map(String),
        paper,
        'both entrants must sit the same questions, in the same order',
      );
    }

    // And the frozen set did not move underneath them.
    const after = await Contest.findById(contest._id).lean();
    assert.deepEqual(after.questionIds.map(String), paper);
  });

  await t.test('a student gets exactly one entry', async () => {
    const contest = await openContest();
    await playContest(studentA, contest._id);

    const client = connectClient(studentA.token, { port: harness.port });
    await client.connected();
    const ack = await client.emit(C2S.CONTEST_ENTER, { contestId: String(contest._id) });
    client.close();

    assert.equal(ack.ok, false);
    assert.equal(ack.code, ERROR_CODE.CONTEST_ALREADY_ENTERED);

    const entries = await ContestEntry.countDocuments({ contestId: contest._id, userId: studentA.user._id });
    assert.equal(entries, 1);
  });

  await t.test('a contest never moves Elo, but still grants XP', async () => {
    const contest = await openContest();
    const { end } = await playContest(studentA, contest._id);

    assert.equal(end.ratingDelta, 0, 'a contest must not move the public rating');
    assert.equal(end.ratingBefore, end.ratingAfter);
    assert.ok(end.xpEarned > 0, 'playing is still playing — XP and mastery accrue');

    const rating = await Rating.findOne({ userId: studentA.user._id, topicId: topic._id }).lean();
    assert.equal(rating.rating, 1200, 'the stored rating is untouched');
    assert.ok(rating.xp > 0);
  });

  await t.test('standings rank by score, then by speed', async () => {
    const contest = await openContest();
    await playContest(studentA, contest._id);
    await playContest(studentB, contest._id);

    const request = api(harness.app, admin.token);
    const res = await request.get(`/admin/contests/${contest._id}/standings?spaceId=${space._id}`);
    assert.equal(res.statusCode, 200);
    const { data } = await request.json(res);

    assert.equal(data.rows.length, 2);
    assert.equal(data.rows[0].rank, 1);
    assert.equal(data.rows[1].rank, 2);

    const [first, second] = data.rows;
    assert.ok(
      first.score > second.score ||
        (first.score === second.score && first.totalResponseMs <= second.totalResponseMs),
      'the board must be ordered by score then by total response time',
    );
  });

  await t.test('the contest paper does not leak into ordinary play', async () => {
    const contest = await openContest();
    await playContest(studentA, contest._id);

    // Student A's run is now a replay — but tagged with the contest, so it is
    // only ever served back inside it.
    const replays = await Replay.find({ userId: studentA.user._id }).lean();
    assert.equal(replays.length, 1);
    assert.equal(String(replays[0].contestId), String(contest._id));

    const { findReplay } = await import('../src/game/ghostService.js');

    const casual = await findReplay({
      topicId: topic._id,
      spaceId: space._id,
      rating: 1200,
      excludeUserId: studentB.user._id,
    });
    assert.equal(casual, null, 'a casual ghost search must never return a contest replay');

    const inContest = await findReplay({
      topicId: topic._id,
      spaceId: space._id,
      rating: 1200,
      excludeUserId: studentB.user._id,
      contestId: contest._id,
    });
    assert.ok(inContest, 'inside the contest, that same replay is exactly what should be served');
    assert.equal(String(inContest.userId), String(studentA.user._id));
  });

  await t.test('the second entrant faces the first entrant as a ghost', async () => {
    const contest = await openContest();
    await playContest(studentA, contest._id);
    await playContest(studentB, contest._id);

    const second = await Match.findOne({
      contestId: contest._id,
      'players.userId': studentB.user._id,
    }).lean();

    const ghost = second.players.find((p) => p.isGhost);
    assert.ok(ghost, 'the second entrant should get an opponent');
    assert.equal(
      ghost.displayName,
      'Student A',
      'and it should be the first entrant, replayed — not a synthetic stand-in',
    );
  });

  await t.test('the clock owns the lifecycle', async () => {
    const upcoming = await Contest.create({
      spaceId: space._id,
      name: 'Later',
      topicIds: [topic._id],
      questionCount: 7,
      startsAt: new Date(Date.now() + 60 * 60_000),
      endsAt: new Date(Date.now() + 2 * 60 * 60_000),
      status: CONTEST_STATUS.SCHEDULED,
    });

    await runContestLifecycle();
    assert.equal(
      (await Contest.findById(upcoming._id)).status,
      CONTEST_STATUS.SCHEDULED,
      'a contest before its start time stays scheduled',
    );

    const client = connectClient(studentA.token, { port: harness.port });
    await client.connected();
    const ack = await client.emit(C2S.CONTEST_ENTER, { contestId: String(upcoming._id) });
    client.close();
    assert.equal(ack.code, ERROR_CODE.CONTEST_NOT_OPEN);

    // Move its window into the past and let the clock close it.
    await Contest.updateOne(
      { _id: upcoming._id },
      { $set: { startsAt: new Date(Date.now() - 120_000), endsAt: new Date(Date.now() - 60_000) } },
    );
    await runContestLifecycle();

    const closed = await Contest.findById(upcoming._id);
    assert.equal(closed.status, CONTEST_STATUS.FINISHED);
    assert.ok(closed.finalisedAt, 'a closed contest is finalised, so its ranks stop moving');
  });

  await t.test('final ranks are written once and then stop moving', async () => {
    const contest = await openContest();
    await playContest(studentA, contest._id);

    await Contest.updateOne({ _id: contest._id }, { $set: { endsAt: new Date(Date.now() - 1000) } });
    await runContestLifecycle();

    const entry = await ContestEntry.findOne({ contestId: contest._id, userId: studentA.user._id }).lean();
    assert.equal(entry.finalRank, 1);

    // A second sweep must be a no-op rather than a re-rank.
    await runContestLifecycle();
    const again = await ContestEntry.findOne({ _id: entry._id }).lean();
    assert.equal(again.finalRank, 1);
  });

  await t.test('a batch-scoped contest is invisible to other batches', async () => {
    const { Batch } = await import('../src/models/index.js');
    const batch = await Batch.create({ spaceId: space._id, name: 'Morning' });

    const contest = await openContest({ batchIds: [batch._id] });

    // studentA is in no batch, so this contest is not theirs.
    const client = connectClient(studentA.token, { port: harness.port });
    await client.connected();
    const ack = await client.emit(C2S.CONTEST_ENTER, { contestId: String(contest._id) });
    client.close();
    assert.equal(ack.code, ERROR_CODE.CONTEST_NOT_ELIGIBLE);

    const request = api(harness.app, studentA.token);
    const res = await request.get(`/spaces/${space._id}/contests`);
    const { data } = await request.json(res);
    assert.equal(data.items.length, 0, 'and it does not appear in their list either');
  });

  await t.test('standings can be withheld until the contest closes', async () => {
    const contest = await openContest({ standingsVisibility: 'after' });
    await playContest(studentA, contest._id);

    const request = api(harness.app, studentA.token);
    let res = await request.get(`/spaces/${space._id}/contests/${contest._id}/standings`);
    let { data } = await request.json(res);

    assert.equal(data.hidden, true);
    assert.equal(data.rows.length, 0);
    assert.match(data.reason, /closes/, 'and the copy says when they will appear');

    await Contest.updateOne({ _id: contest._id }, { $set: { endsAt: new Date(Date.now() - 1000) } });
    await runContestLifecycle();

    res = await request.get(`/spaces/${space._id}/contests/${contest._id}/standings`);
    ({ data } = await request.json(res));
    assert.equal(data.hidden, false);
    assert.equal(data.rows.length, 1);
  });

  await t.test('a contest cannot be entered through the ordinary queue', async () => {
    const client = connectClient(studentA.token, { port: harness.port });
    await client.connected();
    const ack = await client.emit(C2S.QUEUE_JOIN, {
      topicId: String(topic._id),
      spaceId: String(space._id),
      mode: 'contest',
    });
    client.close();

    assert.equal(ack.ok, false);
    assert.equal(ack.code, ERROR_CODE.BAD_REQUEST);
  });

  await t.test('the admin can rename a running contest but not repaper it', async () => {
    const contest = await openContest();
    await playContest(studentA, contest._id);

    const request = api(harness.app, admin.token);

    const rename = await request.patch(`/admin/contests/${contest._id}`, {
      spaceId: String(space._id),
      name: 'Weekly Test (renamed)',
    });
    assert.equal(rename.statusCode, 200);

    const repaper = await request.patch(`/admin/contests/${contest._id}`, {
      spaceId: String(space._id),
      questionCount: 21,
    });
    assert.equal(repaper.statusCode, 409);
    const { error } = await request.json(repaper);
    assert.equal(error.code, 'CONTEST_LOCKED');
    assert.match(error.message, /already entered/);
  });

  await t.test('a contest with entrants is cancelled rather than deleted', async () => {
    const contest = await openContest();
    await playContest(studentA, contest._id);

    const request = api(harness.app, admin.token);
    const res = await request.delete(`/admin/contests/${contest._id}?spaceId=${space._id}`);
    const { data } = await request.json(res);

    assert.equal(data.cancelled, true);
    const still = await Contest.findById(contest._id).lean();
    assert.equal(still.status, CONTEST_STATUS.CANCELLED);
    assert.equal(
      await ContestEntry.countDocuments({ contestId: contest._id }),
      1,
      'the entry is somebody\'s record and survives',
    );
  });

  await t.test('a contest that cannot draw a paper is cancelled, not left pending', async () => {
    const { topic: empty } = await makeTopic({
      spaceId: space._id,
      name: 'Thin Topic',
      questionCount: 0,
    });

    const contest = await Contest.create({
      spaceId: space._id,
      name: 'Impossible',
      topicIds: [empty._id],
      questionCount: 7,
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 60 * 60_000),
      status: CONTEST_STATUS.SCHEDULED,
    });

    await runContestLifecycle();
    const after = await Contest.findById(contest._id).lean();
    assert.equal(
      after.status,
      CONTEST_STATUS.CANCELLED,
      'better a visible cancellation than a contest that pretends it will run',
    );
  });

  await t.test('the result carries the placement', async () => {
    const contest = await openContest();
    const { end } = await playContest(studentA, contest._id);

    assert.ok(end.contest, 'a contest entry should say where it placed');
    assert.equal(end.contest.rank, 1);
    assert.equal(end.contest.entrants, 1);
    assert.equal(end.contest.provisional, true, 'the window is still open, so it can still move');
  });

  await sleep(50);
});

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
import { C2S, S2C } from '../src/shared/protocol.js';
import {
  Batch,
  ClassSession,
  Contest,
  Rating,
  Replay,
  Space,
  SpaceMember,
  Tournament,
  User,
} from '../src/models/index.js';
import { evaluateStreaks } from '../src/jobs/index.js';
import { rollDailyChallenges } from '../src/services/contestService.js';
import { classTable } from '../src/services/classTableService.js';
import { seedOrder, startTournament, joinTournament } from '../src/services/tournamentService.js';
import { istDaysBetween, istDayBoundsUtc, istDateKey } from '../src/lib/dates.js';
import {
  MATCH_MODE,
  SPACE_ROLE,
  STREAK_FREEZE_MAX,
  STREAK_FREEZE_PRICE,
} from '../src/shared/constants.js';

/**
 * The six features added on top of the core game.
 *
 * Weighted toward the places where each one could quietly be *wrong* rather than
 * broken: a streak freeze that saves a streak it should not, a bracket that pairs
 * the top two seeds in round one, a class table whose metric rewards the wrong
 * behaviour, a daily challenge generated twice. None of those throw; all of them
 * are visible to a user as unfairness.
 */

let harness;
let admin;
let student;
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
  admin = await makeUser({ displayName: 'Feature Admin' });
  student = await makeUser({ displayName: 'Feature Student' });
  space = await makeSpace({ name: 'Feature Institute', owner: admin.user });
  await addMember(space, student.user, SPACE_ROLE.STUDENT);
  ({ topic } = await makeTopic({ spaceId: space._id, name: 'Feature Topic' }));
});

const dayKey = (offsetDays) =>
  istDateKey(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000));

// ══ #8 Streak freeze ═══════════════════════════════════════════════════════

test('a freeze costs coins, and you may only hold so many', async () => {
  await User.updateOne({ _id: student.user._id }, { $set: { coins: 10_000 } });

  for (let i = 0; i < STREAK_FREEZE_MAX; i += 1) {
    const res = await api(harness.app, student.token).post('/me/streak-freeze', {});
    assert.equal(res.statusCode, 200, `buy ${i + 1} should succeed`);
    assert.equal(res.json().data.freezes, i + 1);
  }

  const over = await api(harness.app, student.token).post('/me/streak-freeze', {});
  assert.equal(over.statusCode, 409, 'the cap is the whole reason a streak still means something');

  const after = await User.findById(student.user._id).lean();
  assert.equal(after.streak.freezes, STREAK_FREEZE_MAX);
  assert.equal(after.coins, 10_000 - STREAK_FREEZE_MAX * STREAK_FREEZE_PRICE);
});

test('a freeze cannot be bought without the coins', async () => {
  await User.updateOne({ _id: student.user._id }, { $set: { coins: 5 } });
  const res = await api(harness.app, student.token).post('/me/streak-freeze', {});
  assert.equal(res.statusCode, 400);

  const after = await User.findById(student.user._id).lean();
  assert.equal(after.streak.freezes ?? 0, 0, 'and nothing is granted on the way out');
  assert.equal(after.coins, 5, 'nor is anything charged');
});

test('one missed day is covered by one freeze, and the streak survives', async () => {
  await User.updateOne(
    { _id: student.user._id },
    { $set: { 'streak.current': 9, 'streak.longest': 9, 'streak.lastPlayedOn': dayKey(-2), 'streak.freezes': 1 } },
  );

  await evaluateStreaks();

  const after = await User.findById(student.user._id).lean();
  assert.equal(after.streak.current, 9, 'the streak is intact');
  assert.equal(after.streak.freezes, 0, 'and the freeze was spent');
  assert.equal(
    after.streak.lastPlayedOn,
    dayKey(-1),
    'spent by moving the last-played day forward, which is what keeps every other rule working',
  );
});

test('a freeze does not increment the streak — it only stops it falling', async () => {
  await User.updateOne(
    { _id: student.user._id },
    { $set: { 'streak.current': 4, 'streak.lastPlayedOn': dayKey(-2), 'streak.freezes': 1 } },
  );
  await evaluateStreaks();
  const after = await User.findById(student.user._id).lean();
  assert.equal(after.streak.current, 4, 'a day you did not play is not a day you played');
});

test('three missed days need three freezes, and one will not do', async () => {
  await User.updateOne(
    { _id: student.user._id },
    { $set: { 'streak.current': 20, 'streak.lastPlayedOn': dayKey(-4), 'streak.freezes': 1 } },
  );

  await evaluateStreaks();

  const after = await User.findById(student.user._id).lean();
  assert.equal(after.streak.current, 0, 'a fortnight off cannot be bought back for 200 coins');
  assert.equal(after.streak.freezes, 1, 'and the freeze is not wasted on a lost cause');
});

test('a streak with no gap spends nothing', async () => {
  await User.updateOne(
    { _id: student.user._id },
    { $set: { 'streak.current': 3, 'streak.lastPlayedOn': dayKey(-1), 'streak.freezes': 2 } },
  );
  await evaluateStreaks();
  const after = await User.findById(student.user._id).lean();
  assert.equal(after.streak.freezes, 2);
  assert.equal(after.streak.current, 3);
});

// ══ #10 Beat your own best run ═════════════════════════════════════════════

/** One complete match, so a replay exists to race against. */
async function playOnce({ mode = MATCH_MODE.QUICK, correct = true } = {}) {
  const client = connectClient(student.token, { port: harness.port });
  await client.connected();
  await client.emit(C2S.QUEUE_JOIN, {
    topicId: String(topic._id),
    spaceId: String(space._id),
    mode,
  });
  const found = await client.wait(S2C.MATCH_FOUND, { timeoutMs: 8000 });

  for (let round = 0; round < found.payload.totalRounds; round += 1) {
    const frame = await client.wait(S2C.ROUND_START, {
      predicate: (p) => p.roundIndex === round,
      timeoutMs: 8000,
    });
    const right = frame.payload.question.options.findIndex((o) => o.startsWith('Right'));
    await client.emit(C2S.MATCH_ANSWER, {
      matchId: found.payload.matchId,
      roundIndex: round,
      optionIndex: correct ? right : (right + 1) % 4,
    });
  }
  const end = await client.wait(S2C.MATCH_END, { timeoutMs: 12_000 });
  client.close();
  return { end: end.payload, found: found.payload };
}

test('a self-race is refused until there is a run to beat', async () => {
  const client = connectClient(student.token, { port: harness.port });
  await client.connected();
  const ack = await client.emit(C2S.QUEUE_JOIN, {
    topicId: String(topic._id),
    spaceId: String(space._id),
    mode: MATCH_MODE.SELF,
  });
  assert.equal(ack.ok, false, 'there is nothing on disk to race');
  client.close();
});

test('a self-race deals the same paper, against your own name', async () => {
  await playOnce();
  const replay = await Replay.findOne({ userId: student.user._id }).lean();
  assert.ok(replay, 'the first match recorded a run');

  const client = connectClient(student.token, { port: harness.port });
  await client.connected();
  await client.emit(C2S.QUEUE_JOIN, {
    topicId: String(topic._id),
    spaceId: String(space._id),
    mode: MATCH_MODE.SELF,
  });

  const found = await client.wait(S2C.MATCH_FOUND, { timeoutMs: 8000 });
  assert.ok(found.payload.opponent, 'a self-race has an opponent, unlike a drill');
  assert.equal(
    found.payload.opponent.displayName,
    'Feature Student',
    'and it is disclosed as you — every reason a ghost is masked is a reason this one is not',
  );

  const first = await client.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === 0 });
  assert.equal(
    String(first.payload.question.id),
    String(replay.questionIds[0]),
    'the original paper, in its original order — a different one makes the script meaningless',
  );
  client.close();
});

test('a self-race pays no coins and no win bonus, and never enters the record', async () => {
  await playOnce();
  const before = await User.findById(student.user._id).lean();
  /**
   * The per-topic row, which is where this leaked.
   *
   * The account record was gated on `unrecorded` from the start; the Rating row
   * asked `verdict !== 'solo'`, and a self-race is not solo — it has two entries
   * and ends in a real `won`. So every race banked a win in this topic's W–L–D
   * and bumped `matchesPlayed`, which is the leaderboard's tiebreak. Re-runnable
   * on demand, against a recording, until you beat it.
   */
  const topicBefore = await Rating.findOne({
    userId: student.user._id,
    topicId: topic._id,
  }).lean();

  const client = connectClient(student.token, { port: harness.port });
  await client.connected();
  await client.emit(C2S.QUEUE_JOIN, {
    topicId: String(topic._id),
    spaceId: String(space._id),
    mode: MATCH_MODE.SELF,
  });
  const found = await client.wait(S2C.MATCH_FOUND, { timeoutMs: 8000 });
  for (let round = 0; round < found.payload.totalRounds; round += 1) {
    const frame = await client.wait(S2C.ROUND_START, {
      predicate: (p) => p.roundIndex === round,
      timeoutMs: 8000,
    });
    const right = frame.payload.question.options.findIndex((o) => o.startsWith('Right'));
    await client.emit(C2S.MATCH_ANSWER, {
      matchId: found.payload.matchId,
      roundIndex: round,
      optionIndex: right,
    });
  }
  const end = await client.wait(S2C.MATCH_END, { timeoutMs: 12_000 });
  client.close();

  assert.equal(end.payload.coinsFromMatch, 0, 'a race you can re-run until you win pays nothing');
  assert.equal(
    end.payload.mode,
    MATCH_MODE.SELF,
    'and it says which mode it was, or the result screen cannot tell a race from a win',
  );

  const after = await User.findById(student.user._id).lean();
  assert.equal(after.matchesPlayed, before.matchesPlayed, 'not a match played');
  assert.equal(after.matchesWon, before.matchesWon, 'and not a win over anybody');

  const topicAfter = await Rating.findOne({
    userId: student.user._id,
    topicId: topic._id,
  }).lean();
  assert.equal(topicAfter.wins, topicBefore.wins, 'no win on the topic record either');
  assert.equal(topicAfter.losses, topicBefore.losses, 'nor a loss');
  assert.equal(topicAfter.draws, topicBefore.draws, 'nor a draw');
  assert.equal(
    topicAfter.matchesPlayed,
    topicBefore.matchesPlayed,
    'and it does not move the leaderboard tiebreak',
  );
  assert.ok(topicAfter.xp > topicBefore.xp, 'the XP is the point, and it still lands');

  const replays = await Replay.find({ userId: student.user._id }).lean();
  assert.equal(
    replays.length,
    1,
    'and it is never harvested — the paper was one this player had already seen',
  );
});

// ══ #9 Daily challenge ═════════════════════════════════════════════════════

test('a daily challenge is generated once per organization per day', async () => {
  await Space.updateOne({ _id: space._id }, { $set: { 'settings.dailyChallenge': true } });

  const first = await rollDailyChallenges();
  assert.equal(first.created, 1);

  // The job runs hourly, restarts at deploy, and may run on two processes.
  const second = await rollDailyChallenges();
  assert.equal(second.created, 0, 'the second run creates nothing');
  assert.equal(second.skipped, 1);

  const dailies = await Contest.find({ spaceId: space._id, kind: 'daily' }).lean();
  assert.equal(dailies.length, 1, 'one paper, whatever happened to the scheduler');
  assert.equal(dailies[0].dailyOn, istDateKey());
});

test('an organization that did not ask for a daily does not get one', async () => {
  const result = await rollDailyChallenges();
  assert.equal(result.created, 0, 'off by default — a daily sends a notification every morning');
  assert.equal(await Contest.countDocuments({ kind: 'daily' }), 0);
});

test("the daily's window is the IST calendar day, not the server's", () => {
  const bounds = istDayBoundsUtc('2026-07-30');
  assert.equal(bounds.start.toISOString(), '2026-07-29T18:30:00.000Z');
  assert.equal(bounds.end.toISOString(), '2026-07-30T18:30:00.000Z');
  assert.equal(bounds.end - bounds.start, 24 * 60 * 60 * 1000);
});

test('day arithmetic survives a month boundary', () => {
  assert.equal(istDaysBetween('2026-07-31', '2026-08-01'), 1);
  assert.equal(istDaysBetween('2026-02-28', '2026-03-01'), 1, '2026 is not a leap year');
  assert.equal(istDaysBetween('2026-08-01', '2026-07-31'), -1);
  assert.equal(istDaysBetween(null, '2026-01-01'), null, 'no history is not zero days');
});

// ══ #6 Class vs class ══════════════════════════════════════════════════════

test('the class table ranks by points per student on roll, not by total', async () => {
  const big = await Batch.create({ spaceId: space._id, name: 'Big class' });
  const small = await Batch.create({ spaceId: space._id, name: 'Small class' });

  // Ten students in the big class, two in the small one.
  const make = async (batch, n, scoreEach) => {
    for (let i = 0; i < n; i += 1) {
      const u = await makeUser({ displayName: `${batch.name} ${i}` });
      await addMember(space, u.user, SPACE_ROLE.STUDENT);
      await SpaceMember.updateOne(
        { spaceId: space._id, userId: u.user._id },
        { $set: { batchId: batch._id } },
      );
      if (scoreEach) {
        const { Match } = await import('../src/models/index.js');
        await Match.create({
          topicId: topic._id,
          spaceId: space._id,
          mode: MATCH_MODE.QUICK,
          status: 'complete',
          completedAt: new Date(),
          players: [{ userId: u.user._id, displayName: u.user.displayName, score: scoreEach }],
          questionIds: [],
          rounds: [],
        });
      }
    }
  };

  // Big class: 10 students scoring 100 each = 1000 total, 100 per student.
  await make(big, 10, 100);
  // Small class: 2 students scoring 300 each = 600 total, 300 per student.
  await make(small, 2, 300);

  const table = await classTable({ spaceId: space._id }, { period: 'week' });
  assert.equal(
    table.rows[0].name,
    'Small class',
    'a class of forty must not beat a class of twelve before anybody plays',
  );
  assert.equal(table.rows[0].perStudent, 300);
  assert.equal(table.rows[1].perStudent, 100);
  assert.equal(table.rows[0].rank, 1);
});

test('a class that plays but does not turn everybody out sees why', async () => {
  const batch = await Batch.create({ spaceId: space._id, name: 'Half in' });
  const { Match } = await import('../src/models/index.js');

  for (let i = 0; i < 4; i += 1) {
    const u = await makeUser({ displayName: `Half ${i}` });
    await addMember(space, u.user, SPACE_ROLE.STUDENT);
    await SpaceMember.updateOne(
      { spaceId: space._id, userId: u.user._id },
      { $set: { batchId: batch._id } },
    );
    // Only the first two play.
    if (i < 2) {
      await Match.create({
        topicId: topic._id,
        spaceId: space._id,
        mode: MATCH_MODE.QUICK,
        status: 'complete',
        completedAt: new Date(),
        players: [{ userId: u.user._id, displayName: u.user.displayName, score: 200 }],
        questionIds: [],
        rounds: [],
      });
    }
  }

  const table = await classTable({ spaceId: space._id }, { period: 'week' });
  const row = table.rows.find((r) => r.name === 'Half in');
  assert.equal(row.students, 4);
  assert.equal(row.played, 2);
  assert.equal(row.participation, 50, '"half of us have not played" is a fixable problem');
  assert.equal(row.perStudent, 100, 'and the metric counts the roll, not the turnout');
});

test('practice and self-races do not move a class table', async () => {
  const batch = await Batch.create({ spaceId: space._id, name: 'Grinders' });
  await SpaceMember.updateOne(
    { spaceId: space._id, userId: student.user._id },
    { $set: { batchId: batch._id } },
  );

  const { Match } = await import('../src/models/index.js');
  for (const mode of [MATCH_MODE.PRACTICE, MATCH_MODE.SELF]) {
    await Match.create({
      topicId: topic._id,
      spaceId: space._id,
      mode,
      status: 'complete',
      completedAt: new Date(),
      players: [{ userId: student.user._id, displayName: 'Feature Student', score: 999 }],
      questionIds: [],
      rounds: [],
    });
  }

  const table = await classTable({ spaceId: space._id }, { period: 'week' });
  const row = table.rows.find((r) => r.name === 'Grinders');
  assert.equal(row.points, 0, 'a table a student can grind alone is not a competition');
});

// ══ #7 Knockout brackets ═══════════════════════════════════════════════════

test('the bracket keeps the top seeds apart until the end', () => {
  assert.deepEqual(seedOrder(2), [1, 2]);
  assert.deepEqual(seedOrder(4), [1, 4, 2, 3], 'pairs 1v4 and 2v3');
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6], 'pairs 1v8, 4v5, 2v7, 3v6');

  /**
   * The tables above are illustration; THIS is the test.
   *
   * There is more than one arrangement that counts as standard seeding, so
   * pinning one literal ordering would fail the day somebody switched to another
   * correct one. What must hold for every size is the property the seeding exists
   * for: better seeds cannot meet early. Checked at each depth — the top two must
   * be in opposite halves, the top four in different quarters, and so on — which
   * is exactly "seed k and seed k+1 cannot meet before the round their ranking
   * says they should".
   */
  for (const size of [2, 4, 8, 16, 32, 64]) {
    const order = seedOrder(size);
    assert.equal(new Set(order).size, size, `size ${size}: every seed appears exactly once`);
    assert.equal(Math.max(...order), size, 'and the seeds are 1..size');

    for (let group = size; group >= 2; group /= 2) {
      // Split the bracket into blocks of `group` slots. The top `size/group`
      // seeds must land one per block, or two of them meet sooner than they
      // should.
      const blocks = new Map();
      order.forEach((seed, slot) => {
        if (seed > size / group) return;
        const block = Math.floor(slot / group);
        blocks.set(block, (blocks.get(block) ?? 0) + 1);
      });
      for (const [block, count] of blocks) {
        assert.equal(
          count,
          1,
          `size ${size}, blocks of ${group}: block ${block} holds ${count} top seeds — two of the best meet early`,
        );
      }
    }
  }
});

test('a bracket shrinks to fit the field, and byes fall to the top seeds', async () => {
  const players = [];
  for (let i = 0; i < 3; i += 1) {
    const u = await makeUser({ displayName: `Seed ${i}` });
    await addMember(space, u.user, SPACE_ROLE.STUDENT);
    players.push(u);
  }

  const tournament = await Tournament.create({
    spaceId: space._id,
    name: 'Three-way',
    topicId: topic._id,
    size: 8,
    status: 'open',
    createdBy: admin.user._id,
  });

  const scope = { spaceId: space._id, role: SPACE_ROLE.ADMIN, permissions: { manageContests: true } };
  for (const p of players) await joinTournament(scope, p.user, tournament._id);

  const started = await startTournament(scope, tournament._id);

  assert.equal(
    started.rounds[0].ties.length,
    2,
    'three entrants run as a four-bracket, not as an eight-bracket of walkovers',
  );
  const byes = started.rounds[0].ties.filter((t) => t.bye);
  assert.equal(byes.length, 1);
  assert.ok(byes[0].winnerId, 'a bye is decided the moment it is drawn');
  assert.equal(started.status, 'running');
});

test('every playable tie gets a private challenge both players can act on', async () => {
  const players = [];
  for (let i = 0; i < 4; i += 1) {
    const u = await makeUser({ displayName: `Player ${i}` });
    await addMember(space, u.user, SPACE_ROLE.STUDENT);
    players.push(u);
  }

  const tournament = await Tournament.create({
    spaceId: space._id,
    name: 'Four-way',
    topicId: topic._id,
    size: 4,
    status: 'open',
    createdBy: admin.user._id,
  });
  const scope = { spaceId: space._id, role: SPACE_ROLE.ADMIN, permissions: { manageContests: true } };
  for (const p of players) await joinTournament(scope, p.user, tournament._id);

  const started = await startTournament(scope, tournament._id);
  assert.equal(started.rounds[0].ties.length, 2);

  const stored = await Tournament.findById(tournament._id).lean();
  const { Challenge } = await import('../src/models/social.js');
  for (const tie of stored.rounds[0].ties) {
    assert.ok(tie.challengeId, 'a tie nobody can start is a bracket that never finishes');
    const challenge = await Challenge.findById(tie.challengeId).lean();
    assert.equal(
      challenge.status,
      'accepted',
      'already accepted — they agreed to play when they entered the tournament',
    );
  }
});

test('a tournament cannot be entered by a class it is not open to', async () => {
  const theirs = await Batch.create({ spaceId: space._id, name: 'Class A' });
  const outsider = await makeUser({ displayName: 'Outsider' });
  await addMember(space, outsider.user, SPACE_ROLE.STUDENT);

  const tournament = await Tournament.create({
    spaceId: space._id,
    name: 'Class A only',
    topicId: topic._id,
    size: 8,
    batchIds: [theirs._id],
    status: 'open',
    createdBy: admin.user._id,
  });

  const scope = { spaceId: space._id, role: SPACE_ROLE.STUDENT, permissions: {} };
  await assert.rejects(
    () => joinTournament(scope, outsider.user, tournament._id),
    /not open to your class/i,
  );
});

// ══ #5 Live class sessions ═════════════════════════════════════════════════

test('hosting opens a lobby with a code, and the paper is frozen up front', async () => {
  const res = await api(harness.app, admin.token).post('/admin/sessions', {
    spaceId: String(space._id),
    topicId: String(topic._id),
    name: 'Period 4',
    questionCount: 5,
  });

  assert.equal(res.statusCode, 200);
  const session = res.json().data;
  assert.equal(session.status, 'lobby');
  assert.match(session.code, /^[A-Z0-9]{6}$/, 'a code you can read from the back of a room');
  assert.equal(
    session.totalRounds,
    5,
    'frozen at creation — "not enough questions" is a sentence to hear at your desk',
  );

  const stored = await ClassSession.findById(session.id).lean();
  assert.equal(stored.questionIds.length, 5);
});

test('a host may only have one session open at a time', async () => {
  const body = { spaceId: String(space._id), topicId: String(topic._id), questionCount: 3 };
  const first = await api(harness.app, admin.token).post('/admin/sessions', body);
  assert.equal(first.statusCode, 200);

  const second = await api(harness.app, admin.token).post('/admin/sessions', body);
  assert.equal(
    second.statusCode,
    409,
    'two codes on two projectors is a class waiting on the wrong one',
  );
});

test('a student joins by code and appears on the roster', async () => {
  const created = await api(harness.app, admin.token).post('/admin/sessions', {
    spaceId: String(space._id),
    topicId: String(topic._id),
    questionCount: 3,
  });
  const { code, id } = created.json().data;

  const client = connectClient(student.token, { port: harness.port });
  await client.connected();
  const ack = await client.emit(C2S.SESSION_JOIN, { code });

  assert.equal(ack.ok, true);
  assert.equal(ack.snapshot.sessionId, id);
  assert.equal(ack.snapshot.status, 'lobby');
  assert.equal(ack.snapshot.roster.length, 1);
  assert.equal(ack.snapshot.roster[0].displayName, 'Feature Student');
  assert.equal(ack.snapshot.question, null, 'nothing is on screen until the host starts');
  client.close();
});

test('a code does not let you into another organization', async () => {
  const created = await api(harness.app, admin.token).post('/admin/sessions', {
    spaceId: String(space._id),
    topicId: String(topic._id),
    questionCount: 3,
  });
  const { code } = created.json().data;

  const stranger = await makeUser({ displayName: 'Stranger' });
  const client = connectClient(stranger.token, { port: harness.port });
  await client.connected();
  const ack = await client.emit(C2S.SESSION_JOIN, { code });

  assert.equal(ack.ok, false, 'six characters is short enough to guess and to pass around');
  client.close();
});

test('only the host can start or advance a session', async () => {
  const created = await api(harness.app, admin.token).post('/admin/sessions', {
    spaceId: String(space._id),
    topicId: String(topic._id),
    questionCount: 3,
  });
  const { code, id } = created.json().data;

  const client = connectClient(student.token, { port: harness.port });
  await client.connected();
  await client.emit(C2S.SESSION_JOIN, { code });

  for (const event of [C2S.SESSION_START, C2S.SESSION_NEXT, C2S.SESSION_END]) {
    const ack = await client.emit(event, { sessionId: id });
    assert.equal(ack.ok, false, `${event} must be host-only`);
  }
  client.close();
});

test('a round resolves on the clock and then waits for the host', async () => {
  const created = await api(harness.app, admin.token).post('/admin/sessions', {
    spaceId: String(space._id),
    topicId: String(topic._id),
    questionCount: 3,
    roundDurationMs: 5000,
  });
  const { code, id } = created.json().data;

  const host = connectClient(admin.token, { port: harness.port });
  await host.connected();
  await host.emit(C2S.SESSION_JOIN, { code });

  const pupil = connectClient(student.token, { port: harness.port });
  await pupil.connected();
  await pupil.emit(C2S.SESSION_JOIN, { code });

  await host.emit(C2S.SESSION_START, { sessionId: id });

  const round = await pupil.wait(S2C.SESSION_ROUND, { timeoutMs: 6000 });
  assert.equal(round.payload.roundIndex, 0);
  assert.equal(round.payload.totalRounds, 3);
  assert.equal(
    round.payload.question.correctIndex,
    undefined,
    'the answer key never leaves the server before the round resolves',
  );

  // Host and pupil are both in the room, so answering completes the round early.
  const right = round.payload.question.options.findIndex((o) => o.startsWith('Right'));
  await pupil.emit(C2S.SESSION_ANSWER, { sessionId: id, roundIndex: 0, optionIndex: right });
  await host.emit(C2S.SESSION_ANSWER, { sessionId: id, roundIndex: 0, optionIndex: right });

  const result = await pupil.wait(S2C.SESSION_ROUND_RESULT, { timeoutMs: 8000 });
  assert.equal(typeof result.payload.correctIndex, 'number', 'now the key is safe to send');
  assert.equal(
    result.payload.awaitingHost,
    true,
    'the moment after the answer is when the teaching happens — a timer must not talk over it',
  );
  assert.ok(result.payload.board.length >= 1);
  assert.ok(Array.isArray(result.payload.distribution));

  host.close();
  pupil.close();
});

test('a session records its board so the teacher can show it afterwards', async () => {
  const created = await api(harness.app, admin.token).post('/admin/sessions', {
    spaceId: String(space._id),
    topicId: String(topic._id),
    questionCount: 3,
    roundDurationMs: 5000,
  });
  const { code, id } = created.json().data;

  const host = connectClient(admin.token, { port: harness.port });
  await host.connected();
  await host.emit(C2S.SESSION_JOIN, { code });
  const pupil = connectClient(student.token, { port: harness.port });
  await pupil.connected();
  await pupil.emit(C2S.SESSION_JOIN, { code });

  await host.emit(C2S.SESSION_START, { sessionId: id });
  const round = await pupil.wait(S2C.SESSION_ROUND, { timeoutMs: 6000 });
  const right = round.payload.question.options.findIndex((o) => o.startsWith('Right'));
  await pupil.emit(C2S.SESSION_ANSWER, { sessionId: id, roundIndex: 0, optionIndex: right });
  await host.emit(C2S.SESSION_ANSWER, { sessionId: id, roundIndex: 0, optionIndex: right });
  await pupil.wait(S2C.SESSION_ROUND_RESULT, { timeoutMs: 8000 });

  await host.emit(C2S.SESSION_END, { sessionId: id });
  await pupil.wait(S2C.SESSION_ENDED, { timeoutMs: 6000 });

  const report = await api(harness.app, admin.token).get(
    `/admin/sessions/${id}?spaceId=${space._id}`,
  );
  assert.equal(report.statusCode, 200);
  const data = report.json().data;
  assert.equal(data.status, 'ended');
  assert.ok(data.board.length >= 1, 'the board survives the lesson');
  assert.ok(
    data.rounds.some((r) => r.answered > 0),
    'and so does the per-question breakdown, which is what changes tomorrow’s lesson',
  );

  host.close();
  pupil.close();
});

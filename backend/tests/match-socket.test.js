import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startHarness,
  stopHarness,
  resetDb,
  makeUser,
  makeTopic,
  connectClient,
  sleep,
  TEST_TIMING,
} from './helpers.js';
import { C2S, S2C, ROUND_START_ALLOWED_KEYS } from '../src/shared/protocol.js';
import { Match, Replay, Rating } from '../src/models/index.js';
import { ROUNDS_PER_MATCH, MAX_MATCH_SCORE, BASE_POINTS } from '../src/shared/constants.js';
import { roundMultiplier } from '../src/shared/scoring.js';

/**
 * tech.md §13: "The socket test that plays a complete match end to end is the
 * single highest-value test in the suite. Write it first."
 *
 * Two real socket clients, a real matchmaker, a real engine, real timers, a
 * real database. Every event, its order, and its payload is asserted.
 */

let harness;

before(async () => {
  harness = await startHarness();
});

after(async () => {
  await stopHarness();
});

beforeEach(async () => {
  await resetDb();
});

test('two clients play a complete 7-round match', async () => {
  const { topic } = await makeTopic({ name: 'Full Match' });
  const alice = await makeUser({ displayName: 'Alice' });
  const bob = await makeUser({ displayName: 'Bob' });

  const a = connectClient(alice.token, { port: harness.port });
  const b = connectClient(bob.token, { port: harness.port });
  await Promise.all([a.connected(), b.connected()]);

  await a.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id) });
  await b.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id) });

  // ── Pairing ──────────────────────────────────────────────────────────────
  const [foundA, foundB] = await Promise.all([a.wait(S2C.MATCH_FOUND), b.wait(S2C.MATCH_FOUND)]);
  assert.equal(foundA.payload.matchId, foundB.payload.matchId, 'both clients are in one match');
  assert.equal(foundA.payload.opponent.displayName, 'Bob');
  assert.equal(foundB.payload.opponent.displayName, 'Alice');
  assert.equal(foundA.payload.totalRounds, ROUNDS_PER_MATCH);

  const matchId = foundA.payload.matchId;

  await Promise.all([a.wait(S2C.MATCH_START), b.wait(S2C.MATCH_START)]);

  // ── Rounds ───────────────────────────────────────────────────────────────
  // Alice answers correctly and fast; Bob answers correctly but slower. Both
  // should score, and Alice should score strictly more on every round.
  for (let round = 0; round < ROUNDS_PER_MATCH; round += 1) {
    const [startA, startB] = await Promise.all([
      a.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === round }),
      b.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === round }),
    ]);

    // tech.md §7.2 — the single most important line in that document.
    assert.equal(
      startA.payload.correctIndex,
      undefined,
      'round:start must never carry the answer key',
    );
    assert.ok(!('correctIndex' in startA.payload.question), 'nor inside the question object');
    for (const key of Object.keys(startA.payload)) {
      assert.ok(ROUND_START_ALLOWED_KEYS.includes(key), `unexpected key on round:start: ${key}`);
    }

    // Both clients see the identical question, in the identical order
    // (prd.md F6.4.5).
    assert.equal(startA.payload.question.id, startB.payload.question.id);
    assert.deepEqual(startA.payload.question.options, startB.payload.question.options);
    assert.equal(startA.payload.question.options.length, 4);

    // The correct option is the one seeded as "Right …", wherever the
    // per-match shuffle put it (tech.md §9.1).
    const correct = startA.payload.question.options.findIndex((o) => o.startsWith('Right'));
    assert.notEqual(correct, -1);

    const ackA = await a.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: round, optionIndex: correct });
    assert.equal(ackA.ok, true);
    assert.ok(ackA.points >= BASE_POINTS, 'a correct answer scores at least the base');

    // prd.md F6.4.9 — Bob learns *that* Alice answered, never what she chose.
    const notified = await b.wait(S2C.ROUND_OPPONENT_ANSWERED, {
      predicate: (p) => p.roundIndex === round,
    });
    assert.equal(notified.payload.optionIndex, undefined);
    assert.equal(notified.payload.isCorrect, undefined);

    await sleep(80); // Bob is slower, so his speed bonus is smaller
    const ackB = await b.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: round, optionIndex: correct });
    assert.equal(ackB.ok, true);
    assert.ok(ackA.points > ackB.points, 'the faster correct answer scores more');

    // ── Resolution ─────────────────────────────────────────────────────────
    const [resA, resB] = await Promise.all([
      a.wait(S2C.ROUND_RESULT, { predicate: (p) => p.roundIndex === round }),
      b.wait(S2C.ROUND_RESULT, { predicate: (p) => p.roundIndex === round }),
    ]);

    // prd.md F6.4.12 — on resolution both see the correct option, their own
    // choice, the opponent's choice, and the points.
    assert.equal(resA.payload.correctIndex, correct);
    assert.equal(resA.payload.you.optionIndex, correct);
    assert.equal(resA.payload.opponent.optionIndex, correct);
    assert.equal(resA.payload.scores.you, resB.payload.scores.opponent, 'perspectives agree');
    assert.equal(resA.payload.scores.opponent, resB.payload.scores.you);
    assert.ok(resA.payload.scores.you > resA.payload.scores.opponent, 'Alice leads');
  }

  // ── End ──────────────────────────────────────────────────────────────────
  const [endA, endB] = await Promise.all([a.wait(S2C.MATCH_END), b.wait(S2C.MATCH_END)]);

  assert.equal(endA.payload.verdict, 'won');
  assert.equal(endB.payload.verdict, 'lost');
  assert.equal(endA.payload.winnerId, alice.id);
  assert.equal(endA.payload.isDraw, false);
  assert.equal(endA.payload.rounds.length, ROUNDS_PER_MATCH);
  // Points dropped against a perfect run, counted per round so the bonus
  // round's doubled ceiling is compared against a doubled ceiling.
  assert.equal(endA.payload.scores.you, MAX_MATCH_SCORE - endA.payload.rounds.reduce(
    (lost, r, i) => lost + (40 * roundMultiplier(i, ROUNDS_PER_MATCH) - r.you.points), 0,
  ));

  // prd.md F6.4.18 — the result screen needs the rating change.
  assert.ok(endA.payload.ratingDelta > 0, 'the winner gains rating');
  assert.ok(endB.payload.ratingDelta < 0, 'the loser loses rating');
  assert.ok(endA.payload.xpEarned > 0);

  // ── Persistence ──────────────────────────────────────────────────────────
  await sleep(150);

  const record = await Match.findById(matchId).lean();
  assert.equal(record.status, 'complete');
  assert.equal(record.rounds.length, ROUNDS_PER_MATCH);
  assert.equal(String(record.winnerId), alice.id);
  assert.equal(record.players.length, 2);
  for (const round of record.rounds) {
    assert.equal(round.answers.length, 2);
    assert.equal(round.optionOrder.length, 4, 'the option permutation is recorded');
  }

  const ratings = await Rating.find({ topicId: topic._id }).lean();
  assert.equal(ratings.length, 2);
  const aliceRating = ratings.find((r) => String(r.userId) === alice.id);
  assert.equal(aliceRating.wins, 1);
  assert.equal(aliceRating.matchesPlayed, 1);
  assert.equal(aliceRating.correctAnswers, ROUNDS_PER_MATCH);

  // prd.md F6.7.1 — a completed match becomes a replay, so it can serve as a
  // ghost for the next player.
  const replays = await Replay.find({ topicId: topic._id }).lean();
  assert.equal(replays.length, 2, 'both players qualified as replays');
  assert.equal(replays[0].answers.length, ROUNDS_PER_MATCH);

  a.close();
  b.close();
});

test('a round the player never answers resolves on the server timer and scores zero', async () => {
  const { topic } = await makeTopic({ name: 'Timeout' });
  const alice = await makeUser();
  const bob = await makeUser();

  const a = connectClient(alice.token, { port: harness.port });
  const b = connectClient(bob.token, { port: harness.port });
  await Promise.all([a.connected(), b.connected()]);

  await a.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id) });
  await b.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id) });
  const found = await a.wait(S2C.MATCH_FOUND);
  const matchId = found.payload.matchId;

  const start = await a.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === 0 });
  const correct = start.payload.question.options.findIndex((o) => o.startsWith('Right'));

  // Only Alice answers. Bob lets the clock run out.
  await a.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: 0, optionIndex: correct });

  const result = await b.wait(S2C.ROUND_RESULT, {
    predicate: (p) => p.roundIndex === 0,
    timeoutMs: TEST_TIMING.roundDurationMs + 2000,
  });

  // prd.md F6.4.11 — a round resolves when both have answered or the timer
  // expires. F6.4.15 — a timeout scores zero, with no negative marking.
  assert.equal(result.payload.you.optionIndex, null);
  assert.equal(result.payload.you.points, 0);
  assert.equal(result.payload.scores.you, 0);
  assert.ok(result.payload.scores.opponent > 0);

  a.close();
  b.close();
});

test('an answer cannot be changed once submitted', async () => {
  const { topic } = await makeTopic();
  const alice = await makeUser();
  const bob = await makeUser();

  const a = connectClient(alice.token, { port: harness.port });
  const b = connectClient(bob.token, { port: harness.port });
  await Promise.all([a.connected(), b.connected()]);

  await a.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id) });
  await b.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id) });
  const found = await a.wait(S2C.MATCH_FOUND);
  const start = await a.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === 0 });

  const first = await a.emit(C2S.MATCH_ANSWER, {
    matchId: found.payload.matchId,
    roundIndex: 0,
    optionIndex: 1,
  });
  assert.equal(first.ok, true);

  // prd.md F6.4.10
  const second = await a.emit(C2S.MATCH_ANSWER, {
    matchId: found.payload.matchId,
    roundIndex: 0,
    optionIndex: 2,
  });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'ALREADY_ANSWERED');

  assert.ok(start.payload.question);
  a.close();
  b.close();
});

test('leaving mid-match forfeits and the opponent wins', async () => {
  const { topic } = await makeTopic();
  const alice = await makeUser();
  const bob = await makeUser();

  const a = connectClient(alice.token, { port: harness.port });
  const b = connectClient(bob.token, { port: harness.port });
  await Promise.all([a.connected(), b.connected()]);

  await a.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id) });
  await b.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id) });
  const found = await a.wait(S2C.MATCH_FOUND);
  await a.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === 0 });

  await a.emit(C2S.MATCH_LEAVE, { matchId: found.payload.matchId });

  const end = await b.wait(S2C.MATCH_END);
  assert.equal(end.payload.winnerId, bob.id);
  assert.equal(end.payload.forfeitedBy, alice.id);

  a.close();
  b.close();
});

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
import { C2S, S2C } from '../src/shared/protocol.js';
import { Match } from '../src/models/index.js';

/**
 * Disconnection and reconnection (tech.md §9.7, §13).
 *
 * "Disconnect at round 3, reconnect within grace, match continues correctly."
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

async function pairUp() {
  const { topic } = await makeTopic();
  const alice = await makeUser({ displayName: 'Alice' });
  const bob = await makeUser({ displayName: 'Bob' });
  const a = connectClient(alice.token, { port: harness.port });
  const b = connectClient(bob.token, { port: harness.port });
  await Promise.all([a.connected(), b.connected()]);
  await a.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id) });
  await b.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id) });
  const found = await a.wait(S2C.MATCH_FOUND);
  return { a, b, alice, bob, topic, matchId: found.payload.matchId };
}

const answerRound = async (client, matchId, round) => {
  const start = await client.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === round });
  const correct = start.payload.question.options.findIndex((o) => o.startsWith('Right'));
  await client.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: round, optionIndex: correct });
  return correct;
};

test('disconnect at round 3, reconnect within grace, and the match continues', async () => {
  const { a, b, alice, matchId } = await pairUp();

  for (let round = 0; round < 3; round += 1) {
    await answerRound(a, matchId, round);
    await answerRound(b, matchId, round);
    await a.wait(S2C.ROUND_RESULT, { predicate: (p) => p.roundIndex === round });
  }

  await a.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === 3 });
  const scoreBefore = a.framesOf(S2C.ROUND_RESULT).at(-1).scores.you;

  // Alice drops.
  a.close();

  const left = await b.wait(S2C.MATCH_OPPONENT_LEFT, { timeoutMs: 2000 });
  assert.equal(left.payload.matchId, matchId);
  assert.equal(left.payload.graceMs, TEST_TIMING.disconnectGraceMs);

  // She comes back well inside the grace window.
  await sleep(TEST_TIMING.disconnectGraceMs / 3);
  const a2 = connectClient(alice.token, { port: harness.port });
  await a2.connected();

  // tech.md §9.7 — restored to the live match at the current round, with
  // remaining time recalculated from startedAt rather than trusted from the
  // client.
  const resumed = await a2.wait(C2S.MATCH_RESUME, { timeoutMs: 3000 });
  assert.equal(resumed.payload.matchId, matchId);
  assert.equal(resumed.payload.scores.you, scoreBefore, 'her score survived');
  assert.equal(resumed.payload.opponent.displayName, 'Bob');
  assert.ok(resumed.payload.roundIndex >= 3);
  if (resumed.payload.remainingMs !== undefined) {
    assert.ok(resumed.payload.remainingMs >= 0);
    assert.ok(resumed.payload.remainingMs <= TEST_TIMING.roundDurationMs);
  }
  // The snapshot must not leak the key either.
  assert.ok(!JSON.stringify(resumed.payload).includes('correctIndex'));

  await b.wait(S2C.MATCH_OPPONENT_REJOINED, { timeoutMs: 2000 });

  // Play the match out from where it stands.
  const end = await Promise.race([
    a2.wait(S2C.MATCH_END, { timeoutMs: 8000 }),
    (async () => {
      for (let round = resumed.payload.roundIndex; round < 7; round += 1) {
        try {
          await answerRound(a2, matchId, round);
          await answerRound(b, matchId, round);
        } catch {
          /* the round may already have resolved on the timer */
        }
      }
      return a2.wait(S2C.MATCH_END, { timeoutMs: 8000 });
    })(),
  ]);

  assert.ok(['won', 'lost', 'draw'].includes(end.payload.verdict));
  assert.equal(end.payload.forfeitedBy, null, 'she did not forfeit');

  await sleep(200);
  const record = await Match.findById(matchId).lean();
  assert.equal(record.status, 'complete');

  a2.close();
  b.close();
});

test('a disconnect beyond the grace window forfeits', async () => {
  const { a, b, alice, bob } = await pairUp();
  await a.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === 0 });

  a.close();

  const end = await b.wait(S2C.MATCH_END, {
    timeoutMs: TEST_TIMING.disconnectGraceMs + 3000,
  });

  // tech.md §9.7 — beyond the grace the match is forfeited and the opponent wins.
  assert.equal(end.payload.winnerId, bob.id);
  assert.equal(end.payload.forfeitedBy, alice.id);
  assert.equal(end.payload.verdict, 'won');

  b.close();
});

test('a second device keeps the player connected — one socket closing is not a forfeit', async () => {
  const { a, b, alice, matchId } = await pairUp();
  await a.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === 0 });
  void matchId;

  // Same account, second socket. Switching networks or opening the app on a
  // tablet must not cost a match.
  const a2 = connectClient(alice.token, { port: harness.port });
  await a2.connected();

  a.close();
  await sleep(TEST_TIMING.disconnectGraceMs + 400);

  // No opponent-left, because a connection remained.
  assert.equal(b.framesOf(S2C.MATCH_OPPONENT_LEFT).length, 0);
  assert.equal(b.framesOf(S2C.MATCH_END).length, 0, 'the match is still running');

  // And the surviving socket still receives rounds.
  const snapshot = await a2.emit(C2S.MATCH_RESUME, {});
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.snapshot?.matchId, matchId);

  a2.close();
  b.close();
});

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
import { C2S, S2C, ROUND_START_ALLOWED_KEYS, QUESTION_PAYLOAD_ALLOWED_KEYS } from '../src/shared/protocol.js';
import { Match, User } from '../src/models/index.js';
import { HUMAN_FLOOR_MS, NETWORK_GRACE_MS } from '../src/shared/constants.js';

/** tech.md §9.6 and §13 — the anti-cheat row of the test matrix. */

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

async function startMatch() {
  const { topic } = await makeTopic();
  const alice = await makeUser();
  const bob = await makeUser();
  const a = connectClient(alice.token, { port: harness.port });
  const b = connectClient(bob.token, { port: harness.port });
  await Promise.all([a.connected(), b.connected()]);
  await a.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id) });
  await b.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id) });
  const found = await a.wait(S2C.MATCH_FOUND);
  return { a, b, alice, bob, topic, matchId: found.payload.matchId };
}

test('correctIndex is absent from every pre-resolution payload', async () => {
  const { a, b, matchId } = await startMatch();

  const start = await a.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === 0 });

  // tech.md §7.2 — "the single most important line in this document".
  const serialised = JSON.stringify(start.payload);
  assert.ok(!serialised.includes('correctIndex'), 'the answer key must not appear anywhere');
  assert.ok(!serialised.includes('optionOrder'), 'nor the permutation that would reveal it');
  assert.ok(!serialised.includes('canonicalCorrectIndex'));
  assert.ok(!serialised.includes('explanation'), 'nor the explanation, which usually names the answer');

  for (const key of Object.keys(start.payload)) {
    assert.ok(ROUND_START_ALLOWED_KEYS.includes(key), `unexpected round:start key: ${key}`);
  }
  for (const key of Object.keys(start.payload.question)) {
    assert.ok(QUESTION_PAYLOAD_ALLOWED_KEYS.includes(key), `unexpected question key: ${key}`);
  }

  // match:found and match:start must not carry it either.
  for (const event of [S2C.MATCH_FOUND, S2C.MATCH_START, S2C.QUEUE_SEARCHING]) {
    for (const payload of a.framesOf(event)) {
      assert.ok(!JSON.stringify(payload).includes('correctIndex'), `${event} leaked the key`);
    }
  }

  // And the opponent-answered ping reveals nothing about the choice.
  const correct = start.payload.question.options.findIndex((o) => o.startsWith('Right'));
  await a.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: 0, optionIndex: correct });
  const ping = await b.wait(S2C.ROUND_OPPONENT_ANSWERED);
  assert.deepEqual(
    Object.keys(ping.payload).sort(),
    ['elapsedMs', 'matchId', 'roundIndex'],
    'the ping carries timing only — prd.md F6.4.9',
  );

  a.close();
  b.close();
});

test('an answer after the timer plus grace is rejected', async () => {
  const { a, b, matchId } = await startMatch();
  await a.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === 0 });

  // Wait past durationMs + NETWORK_GRACE_MS. The round has already resolved on
  // the server clock by then, so the submission is refused outright.
  await sleep(TEST_TIMING.roundDurationMs + NETWORK_GRACE_MS + 120);

  const ack = await a.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: 0, optionIndex: 0 });
  assert.equal(ack.ok, false);
  assert.ok(
    ['TOO_LATE', 'ROUND_MISMATCH'].includes(ack.code),
    `expected a late/mismatch rejection, got ${ack.code}`,
  );

  a.close();
  b.close();
});

test('an answer for a different round index is rejected', async () => {
  const { a, b, matchId } = await startMatch();
  await a.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === 0 });

  const ahead = await a.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: 4, optionIndex: 0 });
  assert.equal(ahead.ok, false);
  assert.equal(ahead.code, 'ROUND_MISMATCH');

  const behind = await a.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: -1, optionIndex: 0 });
  assert.equal(behind.ok, false);

  a.close();
  b.close();
});

test('an out-of-range option index is rejected', async () => {
  const { a, b, matchId } = await startMatch();
  await a.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === 0 });

  for (const optionIndex of [4, -1, 99, null, 'a', 1.5]) {
    const ack = await a.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: 0, optionIndex });
    assert.equal(ack.ok, false, `optionIndex ${optionIndex} must be refused`);
  }

  a.close();
  b.close();
});

test('a sub-300ms answer is flagged but still counts', async () => {
  const { a, b, alice, matchId } = await startMatch();
  const start = await a.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === 0 });
  const correct = start.payload.question.options.findIndex((o) => o.startsWith('Right'));

  // Answering immediately puts us under the human floor.
  const ack = await a.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: 0, optionIndex: correct });

  // tech.md §9.6 — flagged, not rejected. A false positive must never cost
  // someone a match they actually played.
  assert.equal(ack.ok, true);
  assert.ok(ack.points > 0, 'the answer still scores');

  await b.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: 0, optionIndex: correct });
  await a.wait(S2C.ROUND_RESULT, { predicate: (p) => p.roundIndex === 0 });
  await a.emit(C2S.MATCH_LEAVE, { matchId });
  await sleep(250);

  const record = await Match.findById(matchId).lean();
  const answer = record.rounds[0].answers.find((x) => String(x.userId) === alice.id);
  assert.equal(answer.flagged, true, `an answer under ${HUMAN_FLOOR_MS}ms is flagged`);

  // Flags accumulate on the account for the daily moderation sweep.
  const user = await User.findById(alice.id).lean();
  assert.ok(user.cheatFlags >= 1);

  a.close();
  b.close();
});

test('a client cannot answer a match it is not in', async () => {
  const { a, b, matchId } = await startMatch();
  await a.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === 0 });

  const intruder = await makeUser();
  const c = connectClient(intruder.token, { port: harness.port });
  await c.connected();

  const ack = await c.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: 0, optionIndex: 0 });
  assert.equal(ack.ok, false);
  assert.equal(ack.code, 'MATCH_NOT_FOUND');

  a.close();
  b.close();
  c.close();
});

test('the handshake rejects a missing token, a bad token, and an old protocol', async () => {
  const expectRefused = (client) =>
    new Promise((resolve, reject) => {
      client.socket.once('connect_error', (err) => resolve(err));
      client.socket.once('connect', () => reject(new Error('connection should have been refused')));
      setTimeout(() => reject(new Error('timed out')), 4000);
    });

  const noToken = connectClient(undefined, { port: harness.port });
  const err1 = await expectRefused(noToken);
  assert.equal(err1.data?.code, 'UNAUTHENTICATED');
  noToken.close();

  const badToken = connectClient('not.a.jwt', { port: harness.port });
  const err2 = await expectRefused(badToken);
  assert.ok(['UNAUTHENTICATED', 'TOKEN_EXPIRED'].includes(err2.data?.code));
  badToken.close();

  // tech.md §16 — an unsupported protocol gets an explicit upgrade prompt
  // rather than a silent failure.
  const alice = await makeUser();
  const old = connectClient(alice.token, { port: harness.port, protocolVersion: 0 });
  const err3 = await expectRefused(old);
  assert.equal(err3.data?.code, 'PROTOCOL_UNSUPPORTED');
  old.close();
});

test('queue join is rate limited', async () => {
  const { topic } = await makeTopic();
  const alice = await makeUser();
  const a = connectClient(alice.token, { port: harness.port });
  await a.connected();

  // tech.md §9.6 — a rate limit on queue:join is the defence against match
  // farming. Leaving between joins keeps each one a fresh attempt.
  let limited = false;
  for (let i = 0; i < 20; i += 1) {
    const ack = await a.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id) });
    if (ack.code === 'RATE_LIMITED') {
      limited = true;
      break;
    }
    await a.emit(C2S.QUEUE_LEAVE, {});
  }
  assert.ok(limited, 'repeated queue joins are eventually refused');

  a.close();
});

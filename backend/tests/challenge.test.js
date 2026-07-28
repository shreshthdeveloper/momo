import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startHarness,
  stopHarness,
  resetDb,
  makeUser,
  makeTopic,
  connectClient,
  api,
  sleep,
  TEST_TIMING,
} from './helpers.js';
import { C2S, S2C } from '../src/shared/protocol.js';
import { Challenge } from '../src/models/social.js';
import { MATCH_MODE } from '../src/shared/constants.js';

/**
 * Friend challenges, end to end (prd.md §6.3).
 *
 * The REST half of this shipped a long time ago and did nothing: a challenge
 * could be created, listed and accepted, and accepting set a status that no
 * code anywhere read. These cover the part that turns it into a match — a
 * queue only the two of them can key into — and, just as importantly, the ways
 * in cannot be taken by anybody else.
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

/** Two users who have accepted each other, and a topic they can both play. */
async function twoFriends() {
  const { topic } = await makeTopic({ name: 'Duel Topic' });
  const a = await makeUser({ displayName: 'Ayesha' });
  const b = await makeUser({ displayName: 'Bilal' });

  await api(harness.app, a.token).post('/friends/request', { userId: b.id });
  const incoming = await api(harness.app, b.token).get('/friends');
  const request = incoming.json().data.incoming[0];
  await api(harness.app, b.token).post(`/friends/${request.friendshipId}/accept`);

  return { topic, a, b };
}

async function openChallenge({ a, b, topic }) {
  const created = await api(harness.app, a.token).post('/challenges', {
    userId: b.id,
    topicId: String(topic._id),
  });
  assert.equal(created.statusCode, 200, `create failed: ${created.body}`);
  const list = await api(harness.app, b.token).get('/challenges');
  return list.json().data.items[0];
}

test('an accepted challenge pairs exactly those two, with no ghost', async () => {
  const { topic, a, b } = await twoFriends();
  const challenge = await openChallenge({ a, b, topic });

  const accepted = await api(harness.app, b.token).post(`/challenges/${challenge.id}/accept`);
  assert.equal(accepted.statusCode, 200, `accept failed: ${accepted.body}`);

  const ca = connectClient(a.token, { port: harness.port });
  const cb = connectClient(b.token, { port: harness.port });
  await Promise.all([ca.connected(), cb.connected()]);

  await ca.emit(C2S.QUEUE_JOIN, { challengeId: challenge.id });

  // The challenger waits: a challenge refuses ghosts, so nothing arrives until
  // the other side turns up — which is the entire promise being tested.
  await sleep(Math.max(600, (TEST_TIMING.ghostAfterMs ?? 200) * 2));
  assert.equal(
    ca.received.some((f) => f.event === S2C.MATCH_FOUND),
    false,
    'a challenge was filled with a ghost',
  );

  await cb.emit(C2S.QUEUE_JOIN, { challengeId: challenge.id });

  const [foundA, foundB] = await Promise.all([
    ca.wait(S2C.MATCH_FOUND),
    cb.wait(S2C.MATCH_FOUND),
  ]);

  assert.equal(foundA.payload.matchId, foundB.payload.matchId, 'one match, both players');
  assert.equal(foundA.payload.opponent.displayName, 'Bilal');
  assert.equal(foundB.payload.opponent.displayName, 'Ayesha');
  assert.equal(foundA.payload.mode, MATCH_MODE.CHALLENGE, 'a challenge is its own mode');
  assert.equal(String(foundA.payload.topic.id), String(topic._id), 'the topic came from the challenge');

  // Spent on pairing, so it cannot be replayed for a second free match.
  const row = await Challenge.findById(challenge.id).lean();
  assert.equal(row.status, 'complete');
  assert.ok(row.playedAt, 'playedAt was recorded');

  ca.close();
  cb.close();
});

test('a challenge cannot be played before it is accepted', async () => {
  const { topic, a, b } = await twoFriends();
  const challenge = await openChallenge({ a, b, topic });

  const c = connectClient(a.token, { port: harness.port });
  await c.connected();

  const ack = await c.emit(C2S.QUEUE_JOIN, { challengeId: challenge.id });
  assert.equal(ack.ok, false);
  assert.equal(ack.code, 'CHALLENGE_NOT_ACCEPTED');

  c.close();
});

test('a stranger cannot key into somebody else\'s challenge', async () => {
  const { topic, a, b } = await twoFriends();
  const challenge = await openChallenge({ a, b, topic });
  await api(harness.app, b.token).post(`/challenges/${challenge.id}/accept`);

  const intruder = await makeUser({ displayName: 'Nosy' });
  const c = connectClient(intruder.token, { port: harness.port });
  await c.connected();

  const ack = await c.emit(C2S.QUEUE_JOIN, { challengeId: challenge.id });
  assert.equal(ack.ok, false, 'a third party was let into a private queue');

  c.close();
});

test('the challenge mode cannot simply be asked for', async () => {
  const { topic } = await makeTopic({ name: 'Free Lunch' });
  const user = await makeUser({ displayName: 'Chancer' });

  const c = connectClient(user.token, { port: harness.port });
  await c.connected();

  const ack = await c.emit(C2S.QUEUE_JOIN, {
    topicId: String(topic._id),
    mode: MATCH_MODE.CHALLENGE,
  });
  assert.equal(ack.ok, false, 'an unranked mode was handed out on request');

  c.close();
});

test('you can only challenge a friend', async () => {
  const { topic } = await makeTopic({ name: 'Strangers' });
  const a = await makeUser({ displayName: 'Ayesha' });
  const stranger = await makeUser({ displayName: 'Nobody' });

  const res = await api(harness.app, a.token).post('/challenges', {
    userId: stranger.id,
    topicId: String(topic._id),
  });
  assert.equal(res.statusCode, 403);
});

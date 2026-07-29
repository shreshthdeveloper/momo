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
} from './helpers.js';
import { C2S, S2C } from '../src/shared/protocol.js';
import { Notification } from '../src/models/index.js';
import { ROUNDS_PER_MATCH } from '../src/shared/constants.js';

/**
 * What a finished match leaves in the inbox.
 *
 * Achievements and levels used to exist in exactly one place — an animation on
 * the result screen — and then nowhere. Close the app on the level-up and the
 * only remaining trace was a number on the profile. These rows are the history.
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

/** Play one full match with both players answering every question correctly. */
async function playMatch(topic, alice, bob) {
  const a = connectClient(alice.token, { port: harness.port });
  const b = connectClient(bob.token, { port: harness.port });
  await Promise.all([a.connected(), b.connected()]);

  await a.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id) });
  await b.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id) });

  const [foundA] = await Promise.all([a.wait(S2C.MATCH_FOUND), b.wait(S2C.MATCH_FOUND)]);
  const matchId = foundA.payload.matchId;
  await Promise.all([a.wait(S2C.MATCH_START), b.wait(S2C.MATCH_START)]);

  for (let round = 0; round < ROUNDS_PER_MATCH; round += 1) {
    const [startA] = await Promise.all([
      a.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === round }),
      b.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === round }),
    ]);
    const correct = startA.payload.question.options.findIndex((o) => o.startsWith('Right'));

    /**
     * The delay is load-bearing. Scoring is base + speed, so two correct
     * answers submitted in the same handful of milliseconds score the SAME and
     * the match ends a draw — which silently costs `first_win` and turns this
     * into a test of nothing. Bob has to be measurably slower for Alice to win.
     */
    await a.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: round, optionIndex: correct });
    await sleep(80);
    await b.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: round, optionIndex: correct });
    await Promise.all([
      a.wait(S2C.ROUND_RESULT, { predicate: (p) => p.roundIndex === round }),
      b.wait(S2C.ROUND_RESULT, { predicate: (p) => p.roundIndex === round }),
    ]);
  }

  // `finalizeMatch` runs inside the engine's onComplete and resolves before
  // `match:end` goes out, so this is a real barrier rather than a sleep.
  await Promise.all([a.wait(S2C.MATCH_END), b.wait(S2C.MATCH_END)]);
  a.close();
  b.close();
}

test('winning writes achievement rows the player can find afterwards', async () => {
  const { topic } = await makeTopic({ name: 'Inbox Topic' });
  const alice = await makeUser({ displayName: 'Alice' });
  const bob = await makeUser({ displayName: 'Bob' });

  await playMatch(topic, alice, bob);

  const rows = await Notification.find({ userId: alice.id, type: 'achievement' }).lean();
  const keys = rows.map((r) => r.data?.achievement);

  assert.ok(keys.includes('first_win'), `expected first_win, got ${JSON.stringify(keys)}`);
  assert.ok(keys.includes('perfect_match'), 'seven of seven is a perfect match');

  const firstWin = rows.find((r) => r.data?.achievement === 'first_win');
  assert.match(firstWin.title, /First win/);
  assert.ok(firstWin.body, 'the row carries the achievement’s own description');
});

test('progress rows are written but never pushed', async () => {
  const { topic } = await makeTopic({ name: 'Quiet Topic' });
  const alice = await makeUser({ displayName: 'Alice' });
  const bob = await makeUser({ displayName: 'Bob' });

  await playMatch(topic, alice, bob);

  /**
   * The whole point of `push: false`. All of this is on the result screen,
   * animating, at the moment it is written — a banner would be the app
   * interrupting you to report what you are currently watching.
   */
  const rows = await Notification.find({
    userId: alice.id,
    type: { $in: ['achievement', 'level_up'] },
  }).lean();

  assert.ok(rows.length > 0, 'the match should have produced something');
  for (const row of rows) {
    assert.equal(row.pushedAt, null, `${row.type} was pushed and should not have been`);
  }
});

test('the rows come back through the notifications endpoint', async () => {
  const { topic } = await makeTopic({ name: 'Endpoint Topic' });
  const alice = await makeUser({ displayName: 'Alice' });
  const bob = await makeUser({ displayName: 'Bob' });

  await playMatch(topic, alice, bob);

  const res = await api(harness.app, alice.token).get('/me/notifications');
  assert.equal(res.statusCode, 200, res.body);
  const { items, unread } = res.json().data;

  // Unread on arrival, because nothing has opened the list yet — which is what
  // puts the count on the bell.
  assert.ok(items.some((n) => n.type === 'achievement'));
  assert.ok(unread > 0);
  assert.ok(items.every((n) => n.read === false));
});

test('a second match does not re-award what was already earned', async () => {
  const { topic } = await makeTopic({ name: 'Repeat Topic', questionCount: 40 });
  const alice = await makeUser({ displayName: 'Alice' });
  const bob = await makeUser({ displayName: 'Bob' });

  await playMatch(topic, alice, bob);
  const after1 = await Notification.countDocuments({ userId: alice.id, type: 'achievement' });

  await playMatch(topic, alice, bob);
  const after2 = await Notification.countDocuments({ userId: alice.id, type: 'achievement' });

  // `evaluateAchievements` only returns newly-earned keys, so a player who wins
  // twice must not be told about their first win twice. Getting this wrong
  // would fill the inbox a little more with every single match.
  assert.equal(after2, after1, 'the same achievements were announced again');
});

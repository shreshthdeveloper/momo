import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, stopHarness, resetDb, makeUser, makeTopic, api } from './helpers.js';
import { Match, publicSpaceId } from '../src/models/index.js';

/**
 * Friend suggestions — the recent opponents that stand between the Friends tab
 * and a dead end.
 *
 * The first cut of this matched `status: 'completed'` against a schema whose
 * enum is `'complete'`. It threw nothing, logged nothing and returned `[]`,
 * which is indistinguishable from a player who has genuinely never played
 * anybody — the failure mode of every aggregation written from memory. The
 * first test here exists specifically to make that class of mistake loud.
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

/** A finished match between two people, written straight to the collection. */
async function playedTogether(topic, a, b, { at = new Date(), ghost = false } = {}) {
  return Match.create({
    topicId: topic._id,
    spaceId: publicSpaceId,
    status: 'complete',
    createdAt: at,
    completedAt: at,
    players: [
      { userId: a.user._id, displayName: a.user.displayName },
      ghost
        ? { displayName: 'A Ghost', isGhost: true }
        : { userId: b.user._id, displayName: b.user.displayName },
    ],
  });
}

const suggestions = async (who) => (await api(harness.app, who.token).get('/friends/suggestions')).json().data.items;

test('somebody you just played is suggested, and says why', async () => {
  const { topic } = await makeTopic({ name: 'Suggest Topic' });
  const a = await makeUser({ displayName: 'Asha' });
  const b = await makeUser({ displayName: 'Bikram' });
  await playedTogether(topic, a, b);

  const items = await suggestions(a);
  assert.equal(items.length, 1, 'the opponent should be suggested');
  assert.equal(items[0].displayName, 'Bikram');
  // The count is what the row uses to explain itself. A suggestion that cannot
  // say why it is being made is an advertisement.
  assert.equal(items[0].matches, 1);
});

test('the count is the number of matches, not the number of opponents', async () => {
  const { topic } = await makeTopic({ name: 'Repeat Topic' });
  const a = await makeUser({ displayName: 'Asha' });
  const b = await makeUser({ displayName: 'Bikram' });
  await playedTogether(topic, a, b);
  await playedTogether(topic, a, b);
  await playedTogether(topic, a, b);

  const items = await suggestions(a);
  assert.equal(items.length, 1);
  assert.equal(items[0].matches, 3);
});

test('you are never suggested to yourself', async () => {
  const { topic } = await makeTopic({ name: 'Self Topic' });
  const a = await makeUser({ displayName: 'Asha' });
  const b = await makeUser({ displayName: 'Bikram' });
  await playedTogether(topic, a, b);

  const items = await suggestions(a);
  assert.ok(!items.some((i) => i.id === a.id));
});

test('a ghost is never suggested — there is no account to add', async () => {
  const { topic } = await makeTopic({ name: 'Ghost Topic' });
  const a = await makeUser({ displayName: 'Asha' });
  const b = await makeUser({ displayName: 'Unused' });
  await playedTogether(topic, a, b, { ghost: true });

  assert.deepEqual(await suggestions(a), []);
});

test('an existing friend is not offered again', async () => {
  const { topic } = await makeTopic({ name: 'Friend Topic' });
  const a = await makeUser({ displayName: 'Asha' });
  const b = await makeUser({ displayName: 'Bikram' });
  await playedTogether(topic, a, b);

  await api(harness.app, a.token).post('/friends/request', { userId: b.id });
  const request = (await api(harness.app, b.token).get('/friends')).json().data.incoming[0];
  await api(harness.app, b.token).post(`/friends/${request.friendshipId}/accept`);

  assert.deepEqual(await suggestions(a), []);
});

test('a pending request is not offered again either', async () => {
  const { topic } = await makeTopic({ name: 'Pending Topic' });
  const a = await makeUser({ displayName: 'Asha' });
  const b = await makeUser({ displayName: 'Bikram' });
  await playedTogether(topic, a, b);

  await api(harness.app, a.token).post('/friends/request', { userId: b.id });

  // Both directions: the sender should not be asked to send it twice, and the
  // recipient already has the request sitting at the top of the same screen.
  assert.deepEqual(await suggestions(a), []);
  assert.deepEqual(await suggestions(b), []);
});

test('a declined request is not re-offered — that is how a list loses trust', async () => {
  const { topic } = await makeTopic({ name: 'Declined Topic' });
  const a = await makeUser({ displayName: 'Asha' });
  const b = await makeUser({ displayName: 'Bikram' });
  await playedTogether(topic, a, b);

  await api(harness.app, a.token).post('/friends/request', { userId: b.id });
  const request = (await api(harness.app, b.token).get('/friends')).json().data.incoming[0];
  await api(harness.app, b.token).post(`/friends/${request.friendshipId}/decline`);

  assert.deepEqual(await suggestions(a), []);
});

test('somebody who blocked you is not shown to you at all', async () => {
  const { topic } = await makeTopic({ name: 'Block Topic' });
  const a = await makeUser({ displayName: 'Asha' });
  const b = await makeUser({ displayName: 'Bikram' });
  await playedTogether(topic, a, b);

  await api(harness.app, b.token).post(`/me/blocked/${a.id}`);

  // Not "shown then refused" — the same rule `sendFriendRequest` follows.
  assert.deepEqual(await suggestions(a), []);
});

test('opponents older than the lookback window drop off', async () => {
  const { topic } = await makeTopic({ name: 'Stale Topic' });
  const a = await makeUser({ displayName: 'Asha' });
  const old = await makeUser({ displayName: 'Long Ago' });
  const fresh = await makeUser({ displayName: 'Yesterday' });

  const days = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  await playedTogether(topic, a, old, { at: days(200) });
  await playedTogether(topic, a, fresh, { at: days(1) });

  const items = await suggestions(a);
  assert.deepEqual(
    items.map((i) => i.displayName),
    ['Yesterday'],
  );
});

test('the most recent opponent comes first', async () => {
  const { topic } = await makeTopic({ name: 'Order Topic' });
  const a = await makeUser({ displayName: 'Asha' });
  const older = await makeUser({ displayName: 'Older' });
  const newer = await makeUser({ displayName: 'Newer' });

  const days = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  await playedTogether(topic, a, older, { at: days(9) });
  await playedTogether(topic, a, newer, { at: days(2) });

  const items = await suggestions(a);
  assert.deepEqual(
    items.map((i) => i.displayName),
    ['Newer', 'Older'],
  );
});

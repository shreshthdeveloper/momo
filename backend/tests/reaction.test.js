import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, stopHarness, resetDb, makeUser, api } from './helpers.js';
import { Notification } from '../src/models/index.js';
import { User } from '../src/models/index.js';
import { FRIEND_REACTIONS, FRIEND_REACTION_COOLDOWN_MS } from '../src/shared/constants.js';

/**
 * Friend reactions — the fixed-vocabulary stand-in for chat.
 *
 * What is actually being defended here is that there is no path by which one
 * player puts arbitrary text in front of another. Every test below is a way
 * somebody might try: an unlisted key, a stranger, a block, or the same tap
 * sixty times. The feature is only cheap to own for as long as all four hold.
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

async function twoFriends() {
  const a = await makeUser({ displayName: 'Ayesha' });
  const b = await makeUser({ displayName: 'Bilal' });
  await api(harness.app, a.token).post('/friends/request', { userId: b.id });
  const incoming = await api(harness.app, b.token).get('/friends');
  const request = incoming.json().data.incoming[0];
  await api(harness.app, b.token).post(`/friends/${request.friendshipId}/accept`);
  return { a, b };
}

/** Everything the accept itself wrote, so a reaction assertion sees only its own row. */
async function clearInbox(userId) {
  await Notification.deleteMany({ userId });
}

test('a reaction lands in the friend’s notifications, worded from the sender', async () => {
  const { a, b } = await twoFriends();
  await clearInbox(b.id);

  const res = await api(harness.app, a.token).post(`/friends/${b.id}/react`, { key: 'gg' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().data.key, 'gg');

  const rows = await Notification.find({ userId: b.id }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'friend_reaction');
  assert.equal(rows[0].title, 'Ayesha says GG');
  // The client renders the glyph off the key and opens the profile off the id.
  assert.equal(rows[0].data.reaction, 'gg');
  assert.equal(rows[0].data.userId, String(a.id));
  // No `body`: the whole message is the one line, and a second empty line
  // would draw as a blank row under it in the list.
  assert.ok(!rows[0].body);
});

test('every shipped reaction is accepted, and nothing else is', async () => {
  const { a, b } = await twoFriends();

  for (const reaction of FRIEND_REACTIONS) {
    await clearInbox(b.id);
    // The cooldown is per pair and measured against delivered rows, so wiping
    // the inbox between sends is what lets this loop run at all.
    const res = await api(harness.app, a.token).post(`/friends/${b.id}/react`, {
      key: reaction.key,
    });
    assert.equal(res.statusCode, 200, `${reaction.key} rejected: ${res.body}`);
  }

  await clearInbox(b.id);
  for (const bad of ['', 'nope', 'GG', '__proto__', 'you are terrible at this']) {
    const res = await api(harness.app, a.token).post(`/friends/${b.id}/react`, { key: bad });
    assert.equal(res.statusCode, 400, `"${bad}" was accepted`);
  }
  assert.equal(await Notification.countDocuments({ userId: b.id }), 0);
});

test('the same friend cannot be reacted to twice inside the cooldown', async () => {
  const { a, b } = await twoFriends();
  await clearInbox(b.id);

  assert.equal(
    (await api(harness.app, a.token).post(`/friends/${b.id}/react`, { key: 'gg' })).statusCode,
    200,
  );

  const second = await api(harness.app, a.token).post(`/friends/${b.id}/react`, { key: 'fire' });
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error.code, 'REACTION_COOLDOWN');
  assert.equal(await Notification.countDocuments({ userId: b.id }), 1);

  // Ageing the delivered row past the window is the only thing that opens it,
  // which is the property that makes the cooldown un-drift-able.
  //
  // Through the raw collection, not the model: `timestamps: true` marks
  // `createdAt` immutable, so Mongoose strips a `$set` on it and reports a
  // successful write that changed nothing.
  await Notification.collection.updateMany(
    { type: 'friend_reaction' },
    { $set: { createdAt: new Date(Date.now() - FRIEND_REACTION_COOLDOWN_MS - 1000) } },
  );
  const third = await api(harness.app, a.token).post(`/friends/${b.id}/react`, { key: 'fire' });
  assert.equal(third.statusCode, 200, third.body);
});

test('the cooldown is per friend, not per sender', async () => {
  const { a, b } = await twoFriends();
  const c = await makeUser({ displayName: 'Chandni' });
  await api(harness.app, a.token).post('/friends/request', { userId: c.id });
  const incoming = await api(harness.app, c.token).get('/friends');
  await api(harness.app, c.token).post(
    `/friends/${incoming.json().data.incoming[0].friendshipId}/accept`,
  );

  assert.equal(
    (await api(harness.app, a.token).post(`/friends/${b.id}/react`, { key: 'gg' })).statusCode,
    200,
  );
  // Having just reacted to one friend must not mute the other.
  assert.equal(
    (await api(harness.app, a.token).post(`/friends/${c.id}/react`, { key: 'gg' })).statusCode,
    200,
  );
});

test('a stranger cannot react, and neither can a pending request', async () => {
  const a = await makeUser({ displayName: 'Ayesha' });
  const b = await makeUser({ displayName: 'Bilal' });

  const stranger = await api(harness.app, a.token).post(`/friends/${b.id}/react`, { key: 'gg' });
  assert.equal(stranger.statusCode, 403);

  // Asking to be friends is not being friends — the reaction channel opens on
  // accept, or "add friend" becomes a way to message anyone once.
  await api(harness.app, a.token).post('/friends/request', { userId: b.id });
  const pending = await api(harness.app, a.token).post(`/friends/${b.id}/react`, { key: 'gg' });
  assert.equal(pending.statusCode, 403);
  assert.equal(await Notification.countDocuments({ userId: b.id, type: 'friend_reaction' }), 0);
});

test('being blocked closes the channel, and looks exactly like never being friends', async () => {
  const { a, b } = await twoFriends();
  const stranger = await makeUser({ displayName: 'Nobody' });
  await api(harness.app, b.token).post(`/me/blocked/${a.id}`);
  await clearInbox(b.id);

  const blocked = await api(harness.app, a.token).post(`/friends/${b.id}/react`, { key: 'gg' });
  const never = await api(harness.app, a.token).post(`/friends/${stranger.id}/react`, {
    key: 'gg',
  });

  // `blockUser` severs the friendship, so the block never has to be mentioned:
  // the friend check refuses first, and the refusal is the one every non-friend
  // gets. A distinguishable answer would tell the sender they were blocked,
  // which is itself a form of contact.
  assert.equal(blocked.statusCode, 403);
  assert.equal(never.statusCode, 403);
  assert.equal(blocked.json().error.message, never.json().error.message);
  assert.equal(await Notification.countDocuments({ userId: b.id }), 0);
});

test('a block left without its friendship severance is still refused', async () => {
  // Not a state `blockUser` can produce — it is the state a future caller, a
  // partial write or a migration could. The friend check would wave this
  // through on its own, so the block list is re-read at the point of send.
  const { a, b } = await twoFriends();
  await User.updateOne({ _id: b.id }, { $addToSet: { blockedUsers: a.id } });
  await clearInbox(b.id);

  const res = await api(harness.app, a.token).post(`/friends/${b.id}/react`, { key: 'gg' });
  assert.equal(res.statusCode, 404);
  assert.equal(await Notification.countDocuments({ userId: b.id }), 0);
});

test('reacting to yourself is refused', async () => {
  const a = await makeUser({ displayName: 'Ayesha' });
  const res = await api(harness.app, a.token).post(`/friends/${a.id}/react`, { key: 'gg' });
  assert.equal(res.statusCode, 400);
});

test('the reaction is written to the inbox even when the toggle is off', async () => {
  const { a, b } = await twoFriends();
  await User.updateOne({ _id: b.id }, { $set: { 'notificationPrefs.friendReaction': false } });
  await clearInbox(b.id);

  assert.equal(
    (await api(harness.app, a.token).post(`/friends/${b.id}/react`, { key: 'gg' })).statusCode,
    200,
  );

  // prd.md §6.9 — the toggle governs being WOKEN UP, not being told. The row is
  // still there to read on next open; it simply never went to a device.
  const rows = await Notification.find({ userId: b.id }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pushedAt, null);
});

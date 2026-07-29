import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, stopHarness, resetDb, makeUser, api } from './helpers.js';
import { User } from '../src/models/index.js';

/**
 * "Find someone by name" — the only way into the friends graph for anyone who
 * did not just play the person they are looking for.
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

const namesOf = (res) => res.json().data.items.map((u) => u.displayName);

test('a name is found by any part of it, not only its start', async () => {
  const me = await makeUser({ displayName: 'Seeker' });
  await makeUser({ displayName: 'Priya Singh' });
  await makeUser({ displayName: 'Bella' });

  // The surname is the half people are most likely to type, and the anchored
  // query this replaced could never match it.
  assert.deepEqual(namesOf(await api(harness.app, me.token).get('/users/search?q=singh')), [
    'Priya Singh',
  ]);
  assert.deepEqual(namesOf(await api(harness.app, me.token).get('/users/search?q=ella')), ['Bella']);
});

test('search is case-insensitive', async () => {
  const me = await makeUser({ displayName: 'Seeker' });
  await makeUser({ displayName: 'Bella' });

  for (const q of ['bella', 'BELLA', 'BeLLa', 'ELL']) {
    assert.deepEqual(namesOf(await api(harness.app, me.token).get(`/users/search?q=${q}`)), [
      'Bella',
    ]);
  }
});

test('names that start with the query come first', async () => {
  const me = await makeUser({ displayName: 'Seeker' });
  // Deliberately created so that alphabetical order alone would put Annabelle
  // first — only the starts-with rule puts Bella there.
  await makeUser({ displayName: 'Annabelle' });
  await makeUser({ displayName: 'Bella' });
  await makeUser({ displayName: 'Zbella' });

  const names = namesOf(await api(harness.app, me.token).get('/users/search?q=bel'));
  assert.equal(names[0], 'Bella', `expected Bella first, got ${JSON.stringify(names)}`);
  assert.equal(names.length, 3);
});

test('a one-character query returns nothing', async () => {
  const me = await makeUser({ displayName: 'Seeker' });
  await makeUser({ displayName: 'Bella' });

  // Two characters is the floor on both sides — the client waits for it too, so
  // a mismatch here would mean the field looked broken for one keystroke.
  assert.deepEqual(namesOf(await api(harness.app, me.token).get('/users/search?q=b')), []);
  assert.deepEqual(namesOf(await api(harness.app, me.token).get('/users/search?q=be')), ['Bella']);
});

test('you never appear in your own results', async () => {
  const me = await makeUser({ displayName: 'Bella' });
  await makeUser({ displayName: 'Bellamy' });

  assert.deepEqual(namesOf(await api(harness.app, me.token).get('/users/search?q=bell')), [
    'Bellamy',
  ]);
});

test('regex characters in the query are matched literally, not executed', async () => {
  const me = await makeUser({ displayName: 'Seeker' });
  await makeUser({ displayName: 'Bella' });

  // `.*` unescaped would match every account on the platform, which is a
  // directory dump rather than a search.
  assert.deepEqual(namesOf(await api(harness.app, me.token).get('/users/search?q=.*')), []);
  assert.deepEqual(namesOf(await api(harness.app, me.token).get('/users/search?q=%5E%5C%5C')), []);
});

test('minors, private profiles and inactive accounts stay out of discovery', async () => {
  const me = await makeUser({ displayName: 'Seeker' });
  const minor = await makeUser({ displayName: 'Bella Minor' });
  const priv = await makeUser({ displayName: 'Bella Private' });
  const gone = await makeUser({ displayName: 'Bella Gone' });
  await makeUser({ displayName: 'Bella Visible' });

  // prd.md §13 — minors are excluded from discovery entirely.
  await User.updateOne({ _id: minor.id }, { $set: { isMinor: true } });
  await User.updateOne({ _id: priv.id }, { $set: { 'privacy.profileVisibility': 'private' } });
  await User.updateOne({ _id: gone.id }, { $set: { status: 'deleted' } });

  assert.deepEqual(namesOf(await api(harness.app, me.token).get('/users/search?q=bella')), [
    'Bella Visible',
  ]);
});

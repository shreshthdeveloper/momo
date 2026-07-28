import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, stopHarness, resetDb, makeUser, api } from './helpers.js';
import { User, Cosmetic } from '../src/models/index.js';
import { progression } from '../src/services/progressionService.js';
import { DEFAULT_ACCOUNT_CURVE } from '../src/shared/mastery.js';
import { STARTER_AVATARS, STARTER_BANNERS } from '../src/shared/perks.js';
import { ACCOUNT_MAX_LEVEL, MILESTONE_LEVEL_STEP } from '../src/shared/constants.js';

/**
 * Progression as configuration (leagues-and-progression.md §9).
 *
 * Three things are being defended here, and they are the three that would
 * hurt most if they broke:
 *
 *  1. A brand-new player is offered the free set and nothing else, and cannot
 *     equip a locked item by asking the API directly.
 *  2. A curve edit can raise a player's level but can never lower it.
 *  3. Rarity, not the level ladder, is what gates a cosmetic — and a title,
 *     which is the one thing levels still hand over, arrives every fifth one.
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

const superUser = () => makeUser({ role: 'superadmin' });

// ── The catalogue ──────────────────────────────────────────────────────────

test('sign-up offers two avatars and one banner, and nothing else is free', async () => {
  const client = api(harness.app);
  const { data } = await client.json(await client.get('/config/progression'));

  const free = (type) =>
    data.cosmetics
      .filter((c) => c.type === type && c.unlockKind === 'free')
      .map((c) => c.key)
      .sort();

  assert.deepEqual(free('avatar'), [...STARTER_AVATARS].sort());
  assert.deepEqual(free('banner'), [...STARTER_BANNERS].sort());
});

test('rarity is the gate, not the level — an avatar has a price and no level', async () => {
  const client = api(harness.app);
  const { data } = await client.json(await client.get('/config/progression'));

  const pizza = data.cosmetics.find((c) => c.key === 'pizza');
  assert.equal(pizza.rarity, 'common');
  assert.equal(pizza.unlockKind, 'shop');
  assert.equal(pizza.unlockLevel, 0, 'levels no longer gate a wearable');
  assert.ok(pizza.price >= 200 && pizza.price <= 300, 'inside the common band');

  const ninja = data.cosmetics.find((c) => c.key === 'ninja');
  assert.equal(ninja.rarity, 'rare');
  assert.ok(ninja.price >= 1500 && ninja.price <= 2000);

  // The whole proposition of the second chest: gold is not for sale.
  const dragonLord = data.cosmetics.find((c) => c.key === 'dragon-lord');
  assert.equal(dragonLord.rarity, 'legendary');
  assert.equal(dragonLord.unlockKind, 'chest');
  assert.equal(dragonLord.price, null, 'a legendary has no price at all');
});

test('titles are the one thing a level still pays, one every fifth', async () => {
  const client = api(harness.app);
  const { data } = await client.json(await client.get('/config/progression'));

  const levelTitles = data.cosmetics
    .filter((c) => c.type === 'title' && c.unlockKind === 'level')
    .sort((a, b) => a.unlockLevel - b.unlockLevel);

  assert.equal(levelTitles.length, 20, 'twenty titles');
  assert.deepEqual(
    levelTitles.map((t) => t.unlockLevel),
    Array.from({ length: 20 }, (_, i) => (i + 1) * MILESTONE_LEVEL_STEP),
  );
  assert.equal(levelTitles.at(-1).unlockLevel, ACCOUNT_MAX_LEVEL);
  // A tag you receive a hundred times is a receipt, not a title.
  assert.ok(
    levelTitles.every((t) => t.unlockLevel % MILESTONE_LEVEL_STEP === 0),
    'no title sits between milestones',
  );
});

test('a config fetch quoting the current token gets nothing back', async () => {
  const client = api(harness.app);
  const first = await client.json(await client.get('/config/progression'));
  const again = await client.json(
    await client.get(`/config/progression?token=${first.data.token}`),
  );
  assert.equal(again.data.unchanged, true);
  assert.equal(again.data.cosmetics, undefined);
});

test('a token from a previous database is not mistaken for the current one', async () => {
  const client = api(harness.app);
  const { data } = await client.json(await client.get('/config/progression'));

  // A re-seed drops the config document and writes a fresh one back at version
  // 1. A client still holding version 1 from the old database must NOT be told
  // it is up to date — that is how a re-seeded install kept serving a
  // catalogue that no longer existed.
  const stale = `aaaaaaaaaaaaaaaaaaaaaaaa.${data.version}`;
  const answer = await client.json(await client.get(`/config/progression?token=${stale}`));
  assert.notEqual(answer.data.unchanged, true);
  assert.ok(answer.data.cosmetics.length > 0, 'the whole catalogue comes back');
});

test('an unbought avatar is refused however politely the client asks', async () => {
  const { token } = await makeUser();
  const client = api(harness.app, token);

  const free = await client.patch('/me', { avatarUrl: 'mimo:avatar/rose' });
  assert.equal(free.statusCode, 200);

  const locked = await client.patch('/me', { avatarUrl: 'mimo:avatar/ninja' });
  assert.equal(locked.statusCode, 403);
  const body = await client.json(locked);
  assert.equal(body.error.code, 'PERK_LOCKED');
  assert.match(body.error.message, /coins/i, 'the refusal names the price');
});

test('levelling to the moon still does not hand over an avatar', async () => {
  // The old rule was "reach level 22 for the ninja". Nothing about a level
  // buys a wearable any more, and a very high level is the clearest way to
  // say so.
  const { token } = await makeUser({ totalXp: 10_000_000 });
  const client = api(harness.app, token);

  assert.equal((await client.patch('/me', { title: 'immortal' })).statusCode, 200);
  assert.equal((await client.patch('/me', { avatarUrl: 'mimo:avatar/ninja' })).statusCode, 403);
});

test('an uploaded avatar is nobody else’s business', async () => {
  const { token } = await makeUser();
  const client = api(harness.app, token);
  // Not a preset, so no catalogue row gates it.
  const res = await client.patch('/me', { avatarUrl: 'https://cdn.example/mine.png' });
  assert.equal(res.statusCode, 200);
});

// ── Superadmin CRUD ────────────────────────────────────────────────────────

test('a superadmin adds an avatar and it appears in the served catalogue', async () => {
  const { token } = await superUser();
  const client = api(harness.app, token);

  const res = await client.put('/super/progression/cosmetics', {
    type: 'avatar',
    key: 'sphinx',
    name: 'Sphinx',
    unlockKind: 'shop',
    rarity: 'rare',
    price: 1800,
    imageUrl: 'https://cdn.example/sphinx.png',
    order: 99,
  });
  assert.equal(res.statusCode, 200, res.body);

  const config = await api(harness.app).json(await api(harness.app).get('/config/progression'));
  const added = config.data.cosmetics.find((c) => c.key === 'sphinx');
  assert.equal(added.rarity, 'rare');
  assert.equal(added.price, 1800);
  assert.equal(added.imageUrl, 'https://cdn.example/sphinx.png');
});

test('a wearable without a tier is refused — the shop would have nowhere to shelve it', async () => {
  const { token } = await superUser();
  const res = await api(harness.app, token).put('/super/progression/cosmetics', {
    type: 'avatar',
    key: 'nameless',
    name: 'Nameless',
    unlockKind: 'shop',
    price: 400,
  });
  assert.equal(res.statusCode, 400);
  assert.equal((await api(harness.app).json(res)).error.code, 'BAD_RARITY');
});

test('a disabled cosmetic leaves the shelf but not the people wearing it', async () => {
  const { user, token } = await makeUser();
  const player = api(harness.app, token);
  await player.patch('/me', { avatarUrl: 'mimo:avatar/rose' });

  const { token: superToken } = await superUser();
  await api(harness.app, superToken).put('/super/progression/cosmetics', {
    type: 'avatar',
    key: 'rose',
    name: 'Rose',
    unlockKind: 'free',
    rarity: 'common',
    enabled: false,
  });

  const config = await api(harness.app).json(await api(harness.app).get('/config/progression'));
  assert.equal(
    config.data.cosmetics.find((c) => c.key === 'rose'),
    undefined,
    'withdrawn from the shelf',
  );

  const after = await User.findById(user._id).lean();
  assert.equal(after.avatarUrl, 'mimo:avatar/rose', 'still worn');
});

test('a non-superadmin cannot touch the config', async () => {
  const { token } = await makeUser();
  const res = await api(harness.app, token).put('/super/progression/curve', {
    curve: [0, 10, 20],
  });
  assert.equal(res.statusCode, 403);
});

// ── The XP curve ───────────────────────────────────────────────────────────

test('the shipped curve runs to a hundred reachable levels', () => {
  assert.equal(DEFAULT_ACCOUNT_CURVE.length, ACCOUNT_MAX_LEVEL);
  // ~95 XP a ranked win, and level 100 has to be a season's play rather than a
  // decade's — the whole reason the coefficient was rescaled (§4.1).
  const winsToTop = DEFAULT_ACCOUNT_CURVE.at(-1) / 95;
  assert.ok(winsToTop < 2_500, `level 100 costs ${Math.round(winsToTop)} wins`);
});

test('a curve that dips is refused', async () => {
  const { token } = await superUser();
  const res = await api(harness.app, token).put('/super/progression/curve', {
    curve: [0, 300, 250, 900],
  });
  assert.equal(res.statusCode, 400);
  const body = await api(harness.app).json(res);
  assert.equal(body.error.code, 'CURVE_NOT_ASCENDING');
});

test('a curve that does not start at zero is refused', async () => {
  const { token } = await superUser();
  const res = await api(harness.app, token).put('/super/progression/curve', {
    curve: [50, 300, 900],
  });
  assert.equal(res.statusCode, 400);
});

test('a steeper curve never demotes anyone', async () => {
  // 2,100 XP is well up the shipped curve.
  const { user } = await makeUser({ totalXp: 2_100 });
  const viewer = api(harness.app, (await makeUser()).token);
  const held = (await viewer.json(await viewer.get(`/users/${user._id}`))).data.accountLevel;
  assert.ok(held > 1, 'the player had a level worth defending');

  const { token } = await superUser();
  const client = api(harness.app, token);

  // Ten times the cost of everything. Under this curve 2,100 XP is level 1.
  const steep = DEFAULT_ACCOUNT_CURVE.map((xp) => xp * 10);
  const res = await client.put('/super/progression/curve', { curve: steep });
  assert.equal(res.statusCode, 200);
  const { data } = await client.json(res);
  assert.ok(data.floored >= 1, 'the player was pinned before the curve landed');

  const after = await User.findById(user._id).lean();
  assert.equal(after.accountLevelFloor, held, 'stamped with the level they held');
  assert.equal(after.totalXp, 2_100, 'XP itself is untouched');

  const profile = await viewer.json(await viewer.get(`/users/${user._id}`));
  assert.equal(profile.data.accountLevel, held, 'still that level, whatever the new curve says');
});

test('a gentler curve promotes on the spot', async () => {
  const { user, token } = await makeUser({ totalXp: 400 });
  const me = api(harness.app, token);
  const before = (await me.json(await me.get('/me/stats'))).data.accountLevel;

  const { token: superToken } = await superUser();
  const flat = DEFAULT_ACCOUNT_CURVE.map((_, i) => i * 100);
  await api(harness.app, superToken).put('/super/progression/curve', { curve: flat });

  const after = await me.json(await me.get('/me/stats'));
  assert.equal(after.data.accountLevel, 5, '400 XP buys four 100-XP levels');
  assert.ok(after.data.accountLevel >= before);
  assert.equal((await User.findById(user._id).lean()).totalXp, 400);
});

// ── Leagues ────────────────────────────────────────────────────────────────

test('a ladder that leaves ratings homeless is refused', async () => {
  const { token } = await superUser();
  const client = api(harness.app, token);

  const gap = await client.put('/super/progression/leagues', {
    leagues: [
      { key: 'wood', name: 'Wood', floor: 1000 },
      { key: 'iron', name: 'Iron', floor: 1400 },
    ],
  });
  assert.equal(gap.statusCode, 400, 'the bottom league must sit on the rating floor');

  const backwards = await client.put('/super/progression/leagues', {
    leagues: [
      { key: 'wood', name: 'Wood', floor: 800 },
      { key: 'iron', name: 'Iron', floor: 700 },
    ],
  });
  assert.equal(backwards.statusCode, 400);
});

test('renaming the ladder renames every badge that reads from it', async () => {
  const { user, token } = await makeUser({ rankedRating: 1500 });
  const me = api(harness.app, token);
  assert.equal((await me.json(await me.get('/me/stats'))).data.league.name, 'Gold');

  const { token: superToken } = await superUser();
  const res = await api(harness.app, superToken).put('/super/progression/leagues', {
    leagues: [
      { key: 'bronze', name: 'Bronze', floor: 800 },
      { key: 'silver', name: 'Silver', floor: 1225 },
      { key: 'emerald', name: 'Emerald', floor: 1450, color: '#3FD68C' },
      { key: 'diamond', name: 'Diamond', floor: 1675 },
      { key: 'black', name: 'Black', floor: 1900 },
    ],
  });
  assert.equal(res.statusCode, 200);

  const after = await me.json(await me.get('/me/stats'));
  assert.equal(after.data.league.name, 'Emerald');
  assert.equal(after.data.league.color, '#3FD68C');
  assert.equal((await User.findById(user._id).lean()).rankedRating, 1500, 'the rating never moved');
});

// ── Grandfathering ─────────────────────────────────────────────────────────

test('a player already wearing an avatar keeps it when the rules move', async () => {
  // Someone who joined before the shop existed, wearing what their level gave.
  const { user, token } = await makeUser({ avatarUrl: 'mimo:avatar/panda', totalXp: 0 });
  await Cosmetic.deleteMany({});
  const { loadProgression, resetProgressionCache } = await import(
    '../src/services/progressionService.js'
  );
  resetProgressionCache();
  await import('../src/models/index.js').then(({ ProgressionConfig }) =>
    ProgressionConfig.deleteMany({}),
  );
  await loadProgression();

  const after = await User.findById(user._id).lean();
  assert.ok(after.grantedPerks.includes('panda'), 'grandfathered at seed time');

  const res = await api(harness.app, token).patch('/me', { avatarUrl: 'mimo:avatar/panda' });
  assert.equal(res.statusCode, 200, 'still theirs, and it cost them nothing');
});

test('the snapshot survives a restart with the edits in it', async () => {
  const { token } = await superUser();
  await api(harness.app, token).put('/super/progression/divisions', {
    divisions: 2,
    divisionWidth: 100,
  });

  const { loadProgression, resetProgressionCache } = await import(
    '../src/services/progressionService.js'
  );
  resetProgressionCache();
  await loadProgression();

  assert.equal(progression().ladder.divisions, 2);
  assert.equal(progression().ladder.divisionWidth, 100);
});

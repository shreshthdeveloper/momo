import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, stopHarness, resetDb, makeUser, api } from './helpers.js';
import { User, Chest, ChestGrant } from '../src/models/index.js';
import { progression, rewardsForLevels } from '../src/services/progressionService.js';
import {
  awardChests,
  claimChest,
  currentPeriod,
  rollMonthlyChests,
} from '../src/services/chestService.js';
import { runMonthlyCycle, softResetRatings } from '../src/services/seasonService.js';
import { coinsForMatch, coinsForLevels } from '../src/shared/mastery.js';
import { promotionAward } from '../src/shared/league.js';
import {
  CHEST_SLOT_COUNT,
  COIN_AWARD,
  DUPLICATE_PAYOUT,
  MATCH_MODE,
  MONTHLY_CHESTS,
  RANKED_START,
  RARITY,
} from '../src/shared/constants.js';

/**
 * The economy (coins-and-cosmetics.md).
 *
 * Coins are the only thing in the product a player can SPEND, which makes them
 * the only thing that can be lost to a bug. So the tests here are weighted
 * toward the ways money goes wrong rather than the ways it goes right: buying
 * twice, buying what you cannot afford, opening a chest twice, and a monthly
 * reset that runs when it should not.
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

const rich = (coins = 100_000) => makeUser({ coins });

// ── Earning ────────────────────────────────────────────────────────────────

test('a ranked loss still pays', () => {
  // The whole argument for it: a currency that only rewards winning punishes
  // exactly the players who most need a reason to play the next match.
  assert.equal(coinsForMatch({ verdict: 'won', mode: MATCH_MODE.RANKED }), COIN_AWARD.RANKED_WIN);
  assert.equal(coinsForMatch({ verdict: 'draw', mode: MATCH_MODE.RANKED }), COIN_AWARD.RANKED_DRAW);
  assert.equal(coinsForMatch({ verdict: 'lost', mode: MATCH_MODE.RANKED }), COIN_AWARD.RANKED_LOSS);
  assert.ok(coinsForMatch({ verdict: 'lost', mode: MATCH_MODE.RANKED }) > 0);
});

test('the modes with no stakes have no spoils', () => {
  assert.equal(coinsForMatch({ verdict: 'won', mode: MATCH_MODE.QUICK }), COIN_AWARD.QUICK_WIN);
  assert.equal(coinsForMatch({ verdict: 'lost', mode: MATCH_MODE.QUICK }), 0);
  // A challenge is a thing two friends can run all afternoon.
  assert.equal(coinsForMatch({ verdict: 'won', mode: MATCH_MODE.CHALLENGE }), 0);
  assert.equal(coinsForMatch({ verdict: 'won', mode: MATCH_MODE.PRACTICE }), 0);
  assert.equal(coinsForMatch({ verdict: 'won', mode: MATCH_MODE.CONTEST }), 0);
});

test('every fifth level pays double, and every level pays something', () => {
  assert.equal(coinsForLevels(1, 2), COIN_AWARD.LEVEL_UP);
  assert.equal(coinsForLevels(4, 5), COIN_AWARD.LEVEL_UP_MILESTONE);
  // 2,3,4 ordinary and 5 a milestone — a match can cross more than one.
  assert.equal(coinsForLevels(1, 5), COIN_AWARD.LEVEL_UP * 3 + COIN_AWARD.LEVEL_UP_MILESTONE);
});

test('a milestone hands over its title and one common that is not already owned', () => {
  const { catalogue } = progression();
  const reward = rewardsForLevels({ catalogue, before: 4, after: 5, granted: [] });

  assert.deepEqual(
    reward.titles.map((t) => t.key),
    ['rookie'],
    'level 5 is the first title',
  );
  assert.equal(reward.drops.length, 1);
  assert.equal(reward.drops[0].rarity, RARITY.COMMON, 'the drop is always a common');
  assert.equal(reward.coins, COIN_AWARD.LEVEL_UP_MILESTONE);
});

test('four levels in five pay money and nothing else', () => {
  const { catalogue } = progression();
  const reward = rewardsForLevels({ catalogue, before: 5, after: 9, granted: [] });
  assert.deepEqual(reward.titles, []);
  assert.deepEqual(reward.drops, []);
  assert.equal(reward.coins, COIN_AWARD.LEVEL_UP * 4);
});

test('a level-up is never dead, even when every common is already owned', () => {
  const { catalogue } = progression();
  const everyCommon = catalogue
    .filter((c) => c.rarity === RARITY.COMMON && c.type !== 'title')
    .map((c) => c.key);

  const reward = rewardsForLevels({ catalogue, before: 9, after: 10, granted: everyCommon });
  assert.deepEqual(reward.drops, [], 'there was nothing left to give');
  assert.ok(
    reward.coins > COIN_AWARD.LEVEL_UP_MILESTONE,
    'so it paid coins instead of handing over nothing',
  );
});

test('two milestones in one match cannot hand over the same avatar twice', () => {
  const { catalogue } = progression();
  const reward = rewardsForLevels({ catalogue, before: 4, after: 10, granted: [] });
  assert.equal(reward.drops.length, 2);
  assert.notEqual(reward.drops[0].key, reward.drops[1].key);
});

test('climbing pays, and falling costs nothing', () => {
  const { ladder } = progression();
  // Silver starts at 1225 — crossing it is a league, not a division.
  const league = promotionAward(1200, 1240, ladder);
  assert.equal(league.kind, 'league');
  assert.equal(league.coins, COIN_AWARD.LEAGUE_PROMOTION);

  // Divisions are 75 wide inside a league.
  const division = promotionAward(1240, 1320, ladder);
  assert.equal(division.kind, 'division');
  assert.equal(division.coins, COIN_AWARD.DIVISION_PROMOTION);

  assert.equal(promotionAward(1400, 1200, ladder), null, 'a demotion is punishment enough');
  assert.equal(promotionAward(1300, 1310, ladder), null, 'staying put pays nothing');
});

// ── Spending ───────────────────────────────────────────────────────────────

test('buying takes the coins, grants the key and lets it be worn', async () => {
  const { user, token } = await rich(1_000);
  const client = api(harness.app, token);

  const price = progression().catalogue.find((c) => c.key === 'pizza').price;

  const res = await client.post('/me/shop/buy', { type: 'avatar', key: 'pizza' });
  assert.equal(res.statusCode, 200, res.body);
  const { data } = await client.json(res);
  assert.equal(data.spent, price);
  assert.equal(data.coins, 1_000 - price);

  const after = await User.findById(user._id).lean();
  assert.equal(after.coins, 1_000 - price);
  assert.ok(after.grantedPerks.includes('pizza'));

  assert.equal((await client.patch('/me', { avatarUrl: 'mimo:avatar/pizza' })).statusCode, 200);
});

test('you cannot buy what you cannot afford, and nothing is taken trying', async () => {
  const { user, token } = await makeUser({ coins: 10 });
  const client = api(harness.app, token);

  const res = await client.post('/me/shop/buy', { type: 'avatar', key: 'ninja' });
  assert.equal(res.statusCode, 400);
  const body = await client.json(res);
  assert.equal(body.error.code, 'NOT_ENOUGH_COINS');
  assert.match(body.error.message, /10/, 'it says what they actually have');

  const after = await User.findById(user._id).lean();
  assert.equal(after.coins, 10, 'the balance is untouched');
  assert.deepEqual(after.grantedPerks, []);
});

test('buying the same thing twice charges once', async () => {
  const { user, token } = await rich();
  const client = api(harness.app, token);

  assert.equal((await client.post('/me/shop/buy', { type: 'avatar', key: 'ninja' })).statusCode, 200);
  const spent = 100_000 - (await User.findById(user._id).lean()).coins;

  const again = await client.post('/me/shop/buy', { type: 'avatar', key: 'ninja' });
  assert.equal(again.statusCode, 409);
  assert.equal((await client.json(again)).error.code, 'ALREADY_OWNED');

  const after = await User.findById(user._id).lean();
  assert.equal(100_000 - after.coins, spent, 'charged exactly once');
});

test('two taps at the same instant buy one avatar, not two', async () => {
  const { user, token } = await rich(2_000);
  const client = api(harness.app, token);
  const price = progression().catalogue.find((c) => c.key === 'ninja').price;

  const [a, b] = await Promise.all([
    client.post('/me/shop/buy', { type: 'avatar', key: 'ninja' }),
    client.post('/me/shop/buy', { type: 'avatar', key: 'ninja' }),
  ]);

  const codes = [a.statusCode, b.statusCode].sort();
  assert.deepEqual(codes, [200, 409], 'one wins, one is told it is already owned');

  const after = await User.findById(user._id).lean();
  assert.equal(after.coins, 2_000 - price, 'charged once');
  assert.equal(after.grantedPerks.filter((k) => k === 'ninja').length, 1);
});

test('a legendary is listed but never for sale', async () => {
  const { token } = await rich();
  const res = await api(harness.app, token).post('/me/shop/buy', {
    type: 'avatar',
    key: 'dragon-lord',
  });
  assert.equal(res.statusCode, 400);
  const body = await api(harness.app).json(res);
  assert.equal(body.error.code, 'NOT_FOR_SALE');
  assert.match(body.error.message, /chest/i);
});

test('a title cannot be bought — it is earned', async () => {
  const { token } = await rich();
  const res = await api(harness.app, token).post('/me/shop/buy', {
    type: 'title',
    key: 'rookie',
  });
  assert.equal(res.statusCode, 400);
  assert.equal((await api(harness.app).json(res)).error.code, 'NOT_FOR_SALE');
});

// ── Chests ─────────────────────────────────────────────────────────────────

test('a chest is twenty slots, eight of them coins', async () => {
  const chests = progression().chests;
  assert.equal(chests.length, 2);

  for (const spec of MONTHLY_CHESTS) {
    const chest = chests.find((c) => c.key === spec.key);
    assert.equal(chest.rewards.length, CHEST_SLOT_COUNT, `${spec.key} holds twenty`);
    assert.equal(chest.rewards.filter((r) => r.type === 'coins').length, 8);

    for (const [rarity, count] of Object.entries(spec.slots)) {
      assert.equal(
        chest.rewards.filter((r) => r.rarity === rarity).length,
        count,
        `${spec.key} holds ${count} ${rarity}`,
      );
    }
    // A box with two of one thing in it has quietly lost a slot.
    const keys = chest.rewards.filter((r) => r.key).map((r) => r.key);
    assert.equal(new Set(keys).size, keys.length, 'no cosmetic appears twice');
  }
});

test('only the legendary chest holds a legendary, and only it reaches Diamond', () => {
  const [standard, legendary] = MONTHLY_CHESTS;
  assert.equal(standard.slots[RARITY.LEGENDARY], 0);
  assert.equal(legendary.slots[RARITY.LEGENDARY], 2, 'it is the reason this chest exists');
  assert.equal(standard.triggerLeague, 'gold');
  assert.equal(legendary.triggerLeague, 'diamond');
});

test('a chest is won on reaching the league, once per month', async () => {
  const { user } = await makeUser({ rankedRating: 1500 });

  const first = await awardChests({ userId: user._id, rankedRating: 1500 });
  assert.deepEqual(first.map((c) => c.key), ['monthly-chest'], 'Gold, not Diamond');

  const second = await awardChests({ userId: user._id, rankedRating: 1500 });
  assert.deepEqual(second, [], 'winning it twice in one month is not a thing');

  const grants = await ChestGrant.find({ userId: user._id }).lean();
  assert.equal(grants.length, 1);
  assert.equal(grants[0].period, currentPeriod());
  assert.equal(grants[0].claimedAt, null, 'it waits to be opened');
});

test('opening draws exactly one of the twenty', async () => {
  const { user, token } = await makeUser({ rankedRating: 1700 });
  await awardChests({ userId: user._id, rankedRating: 1700 });

  const client = api(harness.app, token);
  const res = await client.post('/me/chests/legendary-chest/claim');
  assert.equal(res.statusCode, 200, res.body);
  const { data } = await client.json(res);

  assert.ok(data.drawn, 'something came out');
  const after = await User.findById(user._id).lean();

  if (data.drawn.type === 'coins') {
    assert.equal(after.coins, data.drawn.amount);
    assert.equal(data.coinsAwarded, data.drawn.amount);
  } else {
    assert.ok(after.grantedPerks.includes(data.drawn.key), 'the one thing drawn is now owned');
    // Exactly one cosmetic, plus the title the top chest carries.
    assert.deepEqual(
      after.grantedPerks.filter((k) => k !== 'trailblazer'),
      [data.drawn.key],
    );
  }
});

test('the top chest carries a title coins can never buy', async () => {
  const { user, token } = await makeUser({ rankedRating: 1700 });
  await awardChests({ userId: user._id, rankedRating: 1700 });
  await api(harness.app, token).post('/me/chests/legendary-chest/claim');

  const after = await User.findById(user._id).lean();
  assert.ok(after.grantedPerks.includes('trailblazer'));
  assert.equal(
    (await api(harness.app, token).patch('/me', { title: 'trailblazer' })).statusCode,
    200,
  );
});

test('a duplicate pays coins rather than nothing', async () => {
  const { user } = await makeUser({ rankedRating: 1500 });
  await awardChests({ userId: user._id, rankedRating: 1500 });

  // Own the entire chest, so the draw cannot help but repeat.
  const chest = await Chest.findOne({ key: 'monthly-chest' }).lean();
  const everything = chest.rewards.filter((r) => r.key).map((r) => r.key);

  const result = await claimChest(user._id, 'monthly-chest', { owned: everything });
  if (result.drawn.type === 'coins') {
    assert.equal(result.coinsAwarded, result.drawn.amount);
  } else {
    assert.equal(result.duplicate, true);
    assert.equal(result.coinsAwarded, DUPLICATE_PAYOUT[result.drawn.rarity]);
  }
  assert.ok(result.coinsAwarded > 0, 'no open is ever dead');
});

test('a chest cannot be opened twice, and the second tap does not re-roll', async () => {
  const { user, token } = await makeUser({ rankedRating: 1500 });
  const client = api(harness.app, token);
  await awardChests({ userId: user._id, rankedRating: 1500 });

  const first = await client.post('/me/chests/monthly-chest/claim');
  assert.equal(first.statusCode, 200);
  const drawn = (await client.json(first)).data.drawn;

  const again = await client.post('/me/chests/monthly-chest/claim');
  assert.equal(again.statusCode, 409);
  assert.equal((await client.json(again)).error.code, 'ALREADY_CLAIMED');

  const grant = await ChestGrant.findOne({ userId: user._id, chestKey: 'monthly-chest' }).lean();
  assert.equal(grant.drawn.key ?? grant.drawn.amount, drawn.key ?? drawn.amount, 'the roll stood');
});

test('a chest nobody earned cannot be claimed', async () => {
  const { token } = await makeUser();
  const res = await api(harness.app, token).post('/me/chests/legendary-chest/claim');
  assert.equal(res.statusCode, 404);
});

test('what a chest is opened for stays owned after the rating falls away', async () => {
  const { user, token } = await makeUser({ rankedRating: 1500 });
  await awardChests({ userId: user._id, rankedRating: 1500 });

  const chest = await Chest.findOne({ key: 'monthly-chest' }).lean();
  // Force the draw onto a cosmetic by leaving the coin slots out of the way.
  const cosmetic = chest.rewards.find((r) => r.type === 'avatar');
  await Chest.updateOne({ key: 'monthly-chest' }, { $set: { rewards: [cosmetic] } });
  await ChestGrant.updateOne({ userId: user._id }, { $set: { rewards: [cosmetic] } });

  const result = await claimChest(user._id, 'monthly-chest', { owned: [] });
  assert.equal(result.drawn.key, cosmetic.key);

  await User.updateOne({ _id: user._id }, { $set: { rankedRating: 810 } });
  const wear = await api(harness.app, token).patch('/me', {
    avatarUrl: `mimo:avatar/${cosmetic.key}`,
  });
  assert.equal(wear.statusCode, 200, 'standing can fall; the gift cannot');
});

test('a chest publishes what is inside it, in full', async () => {
  const client = api(harness.app);
  const { data } = await client.json(await client.get('/config/progression'));
  const chest = data.chests.find((c) => c.key === 'legendary-chest');

  // The composition is the odds, and the odds are the offer.
  assert.equal(chest.slots.length, CHEST_SLOT_COUNT);
  assert.equal(chest.slots.filter((s) => s.rarity === RARITY.LEGENDARY).length, 2);

  // And the contents, because a case you can look into is the whole appeal of
  // a case — the suspense is which one, never what is in there.
  const cosmetics = chest.slots.filter((s) => s.type !== 'coins');
  assert.ok(cosmetics.length > 0);
  assert.ok(
    cosmetics.every((s) => typeof s.key === 'string' && typeof s.name === 'string'),
    'every cosmetic slot names itself, so the shop can draw it',
  );
  assert.ok(
    chest.slots.filter((s) => s.type === 'coins').every((s) => s.amount > 0),
    'and a coin slot says how much',
  );
});

// ── The monthly cycle ──────────────────────────────────────────────────────

test('the soft reset pulls halfway to the start, and never below the floor', async () => {
  const black = await makeUser({ rankedRating: 1900 });
  const middling = await makeUser({ rankedRating: 1600 });
  const struggling = await makeUser({ rankedRating: 1000 });
  const fresh = await makeUser({ rankedRating: RANKED_START });

  await softResetRatings();

  const read = async (u) => (await User.findById(u.user._id).lean()).rankedRating;
  assert.equal(await read(black), 1550);
  assert.equal(await read(middling), 1400);
  assert.equal(await read(struggling), 1100, 'the floor rises too — nobody is pinned down there');
  assert.equal(await read(fresh), RANKED_START, 'someone at the start does not move');
});

test('the turnover re-rolls the chests and clears what was never opened', async () => {
  const { user } = await makeUser({ rankedRating: 1500 });
  await awardChests({ userId: user._id, rankedRating: 1500 });

  // Pretend the grant and the chests belong to a month that has ended.
  await ChestGrant.updateMany({}, { $set: { period: '2000-01' } });
  await Chest.updateMany({}, { $set: { period: '2000-01' } });
  const before = (await Chest.findOne({ key: 'monthly-chest' }).lean()).rewards;

  await runMonthlyCycle({ softReset: false });

  assert.equal(await ChestGrant.countDocuments({ claimedAt: null }), 0, 'last month expired');
  const after = await Chest.findOne({ key: 'monthly-chest' }).lean();
  assert.equal(after.period, currentPeriod());
  assert.notDeepEqual(
    after.rewards.map((r) => r.key),
    before.map((r) => r.key),
    'a fresh pool, not last month’s',
  );
});

test('an opened chest is kept as a record after the month turns', async () => {
  const { user } = await makeUser({ rankedRating: 1500 });
  await awardChests({ userId: user._id, rankedRating: 1500 });
  await claimChest(user._id, 'monthly-chest', { owned: [] });

  await runMonthlyCycle({ softReset: false });

  const kept = await ChestGrant.findOne({ userId: user._id }).lean();
  assert.ok(kept, 'what you opened is still on your record');
  assert.ok(kept.claimedAt);
});

test('re-rolling does not disturb a grant already handed out', async () => {
  const { user } = await makeUser({ rankedRating: 1500 });
  await awardChests({ userId: user._id, rankedRating: 1500 });
  const held = (await ChestGrant.findOne({ userId: user._id }).lean()).rewards.map((r) => r.key);

  await rollMonthlyChests({ period: currentPeriod() });

  const after = (await ChestGrant.findOne({ userId: user._id }).lean()).rewards.map((r) => r.key);
  assert.deepEqual(after, held, 'a snapshot is a snapshot');
});

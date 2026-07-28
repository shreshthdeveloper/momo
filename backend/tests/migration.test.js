import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, stopHarness, resetDb, makeUser } from './helpers.js';
import { User, Cosmetic, Chest, ChestGrant, ProgressionConfig } from '../src/models/index.js';
import { loadProgression, resetProgressionCache } from '../src/services/progressionService.js';
import { ACCOUNT_MAX_LEVEL } from '../src/shared/constants.js';

/**
 * Moving an existing install onto the new model (coins-and-cosmetics.md §7, §8).
 *
 * These are the tests that would have caught the one real bug in this work: the
 * first `$unset` of the guest fields ran, reported success, matched every row
 * and modified none, because mongoose silently strips update paths the schema
 * no longer declares. It looked exactly like a migration that had worked.
 *
 * So the shape of every test here is the same — build a database that looks the
 * way it looked BEFORE, run the boot path, and read the raw documents back.
 * `.lean()` is deliberately avoided in places where a mongoose default would
 * paper over a field that is supposed to be gone.
 */

before(async () => {
  await startHarness();
});
after(async () => {
  await stopHarness();
});
beforeEach(async () => {
  await resetDb();
});

/**
 * Wind the install back to before this release: the migrations un-recorded, the
 * old 50-level curve in force, and the catalogue level-gated the way it was.
 */
async function asOldWorld({ cosmetics = [], chests = [] } = {}) {
  await Cosmetic.deleteMany({});
  await Chest.deleteMany({});
  await Cosmetic.collection.insertMany(cosmetics);
  if (chests.length) await Chest.collection.insertMany(chests);

  await ProgressionConfig.updateOne(
    { singleton: 'progression' },
    {
      $set: {
        migrations: [],
        // The shipped curve as it was: 75 × i × (i + 3), fifty rows.
        accountCurve: Array.from({ length: 50 }, (_, i) => 75 * i * (i + 3)),
      },
    },
  );
  resetProgressionCache();
  return loadProgression();
}

const levelRow = (type, key, name, unlockLevel, order = 0) => ({
  type,
  key,
  name,
  unlockKind: 'level',
  unlockLevel,
  unlockLeague: null,
  imageUrl: null,
  enabled: true,
  order,
});

test('the guest fields come off the documents, not merely out of the schema', async () => {
  const { user } = await makeUser({ displayName: 'Ghost' });
  // Written past the schema, because the schema is exactly what no longer
  // describes them — which is the condition the migration has to survive.
  await User.collection.updateOne(
    { _id: user._id },
    { $set: { isGuest: true, guestMatchesPlayed: 3, role: 'guest' } },
  );

  await asOldWorld({ cosmetics: [levelRow('avatar', 'rose', 'Rose', 0)] });

  const raw = await User.collection.findOne({ _id: user._id });
  assert.equal('isGuest' in raw, false, 'the field is gone from the document');
  assert.equal('guestMatchesPlayed' in raw, false);
  // A guest account has no phone number, so there is no way back into one.
  assert.equal(raw.role, 'player');
  assert.equal(raw.status, 'deleted');
});

test('everything a level used to unlock becomes owned outright', async () => {
  // 4,050 XP is level 7 on the old curve — a player who had climbed to the
  // animals and would otherwise wake up being asked to buy them back.
  const { user } = await makeUser({ totalXp: 4_050 });

  await asOldWorld({
    cosmetics: [
      levelRow('avatar', 'panda', 'Panda', 2, 1),
      levelRow('avatar', 'fox', 'Fox', 3, 2),
      levelRow('avatar', 'penguin', 'Penguin', 7, 3),
      levelRow('avatar', 'ninja', 'Ninja', 22, 4),
      levelRow('banner', 'gold-tri', 'Gold', 8, 5),
    ],
  });

  const after = await User.findById(user._id).lean();
  for (const key of ['panda', 'fox', 'penguin']) {
    assert.ok(after.grantedPerks.includes(key), `${key} was theirs and stayed theirs`);
  }
  assert.equal(after.grantedPerks.includes('ninja'), false, 'level 22 was never reached');
  assert.equal(after.grantedPerks.includes('gold-tri'), false, 'level 8 was never reached');
});

test('the catalogue moves onto rarity and the curve onto a hundred levels', async () => {
  const snapshot = await asOldWorld({
    cosmetics: [levelRow('avatar', 'pizza', 'Pizza', 2, 1), levelRow('avatar', 'ninja', 'Ninja', 22, 2)],
  });

  assert.equal(snapshot.accountCurve.length, ACCOUNT_MAX_LEVEL);

  const pizza = snapshot.catalogue.find((c) => c.key === 'pizza');
  assert.equal(pizza.rarity, 'common');
  assert.equal(pizza.unlockKind, 'shop');
  assert.ok(pizza.price > 0);

  const ninja = snapshot.catalogue.find((c) => c.key === 'ninja');
  assert.equal(ninja.rarity, 'rare');
  assert.equal(ninja.unlockLevel, 0, 'a level no longer gates a wearable');
});

test('a level a player already reached is never taken back by the new curve', async () => {
  // Level 10 on the old curve.
  const { user } = await makeUser({ totalXp: 75 * 9 * 12 });
  await asOldWorld({ cosmetics: [levelRow('avatar', 'rose', 'Rose', 0)] });

  const after = await User.findById(user._id).lean();
  assert.ok(after.accountLevelFloor >= 10, 'stamped before the curve moved');
  assert.equal(after.totalXp, 75 * 9 * 12, 'XP itself is untouched');
});

test('art that no longer ships leaves the shelf without leaving anyone bare', async () => {
  const { user } = await makeUser({ totalXp: 4_050, avatarUrl: 'mimo:avatar/chameleon' });

  const snapshot = await asOldWorld({
    cosmetics: [
      levelRow('avatar', 'pizza', 'Pizza', 2, 1),
      // A key from a build whose PNG is gone. No client can draw it, so a level
      // row pointing at it is a promise nothing can keep.
      levelRow('avatar', 'chameleon', 'Chameleon', 5, 2),
      // An operator's own upload, at the same level. Theirs, and it stays.
      { ...levelRow('avatar', 'sphinx', 'Sphinx', 5, 3), imageUrl: 'https://cdn.example/s.png' },
    ],
  });

  const served = snapshot.catalogue.filter((c) => c.enabled !== false).map((c) => c.key);
  assert.equal(served.includes('chameleon'), false, 'withdrawn from the shelf');
  assert.ok(served.includes('sphinx'), 'an uploaded item is not a leftover');

  // Withdrawn, not confiscated.
  const after = await User.findById(user._id).lean();
  assert.ok(after.grantedPerks.includes('chameleon'), 'still owned by whoever had it');
  const worn = await User.findById(user._id);
  assert.equal(worn.avatarUrl, 'mimo:avatar/chameleon', 'still worn');
});

test('an unopened chest from the old world is settled rather than stranded', async () => {
  const { user } = await makeUser({ rankedRating: 1500 });

  await ChestGrant.collection.insertOne({
    userId: user._id,
    chestKey: 'gold-chest',
    chestName: 'Gold chest',
    rewards: [{ type: 'avatar', key: 'ninja' }],
    triggerLabel: 'Reached Gold',
    unlockedAt: new Date(),
    claimedAt: null,
  });

  await asOldWorld({
    cosmetics: [levelRow('avatar', 'ninja', 'Ninja', 22, 1)],
    chests: [
      {
        key: 'gold-chest',
        name: 'Gold chest',
        triggerKind: 'league',
        triggerLeague: 'gold',
        rewards: [{ type: 'avatar', key: 'ninja' }],
        enabled: true,
        order: 0,
      },
    ],
  });

  // The chest that held it no longer exists and its trigger went with it, so
  // the contents are handed over rather than left in a format nothing reads.
  const after = await User.findById(user._id).lean();
  assert.ok(after.grantedPerks.includes('ninja'), 'nothing is taken back');
  assert.equal(await ChestGrant.countDocuments({ chestKey: 'gold-chest' }), 0);
  assert.equal(await Chest.countDocuments({ key: 'gold-chest' }), 0);
});

test('running the boot path twice changes nothing the second time', async () => {
  const { user } = await makeUser({ totalXp: 4_050 });
  await asOldWorld({ cosmetics: [levelRow('avatar', 'panda', 'Panda', 2, 1)] });

  const first = await User.findById(user._id).lean();
  const config = await ProgressionConfig.findOne({}).lean();

  resetProgressionCache();
  await loadProgression();

  const second = await User.findById(user._id).lean();
  assert.deepEqual(second.grantedPerks, first.grantedPerks, 'no second helping');
  assert.equal(second.accountLevelFloor, first.accountLevelFloor);

  const after = await ProgressionConfig.findOne({}).lean();
  assert.deepEqual(after.migrations, config.migrations, 'nothing re-ran');
});

import mongoose from 'mongoose';
import { Chest, ChestGrant, User } from '../models/index.js';
import { progression, loadProgression } from './progressionService.js';
import { monthKey } from '../lib/dates.js';
import { logger } from '../lib/logger.js';
import { NotFoundError, ConflictError } from '../lib/errors.js';
import { cosmeticsOfRarity, LEGENDARY_CHEST_TITLE } from '../shared/perks.js';
import { leagueFor, leagueRank } from '../shared/league.js';
import {
  CHEST_TRIGGER,
  COSMETIC_TYPE,
  DUPLICATE_PAYOUT,
  MONTHLY_CHESTS,
} from '../shared/constants.js';

/**
 * Chests, monthly (coins-and-cosmetics.md §5).
 *
 * Two of them, rolled fresh from the catalogue on the 1st and earned by
 * standing rather than bought: reach Gold for one, Diamond for the other. That
 * is the loop the soft reset exists to restart — ratings fall halfway back, so
 * both chests are re-earned every month.
 *
 * A chest is TWENTY SLOTS and opening draws exactly one of them, uniformly.
 * The composition *is* the odds; there is deliberately no weighting table
 * beside it, because a second description of the same thing is a second thing
 * to keep in step.
 *
 * No open is ever dead. Eight of the twenty slots are coins, and a cosmetic the
 * player already owns pays out instead of granting nothing. That was the whole
 * worry with a dud-on-duplicate rule: by the third month a player who owned
 * most commons would have opened an empty chest four times in five.
 */

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/** The month a chest belongs to, `YYYY-MM` in IST. */
export const currentPeriod = (date) => monthKey(date);

/**
 * Fisher–Yates over a copy. `Math.random` is fine here and deliberately so:
 * nothing about a cosmetic drop is adversarial, and a CSPRNG would buy
 * unpredictability nobody is trying to defeat.
 */
function shuffled(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const pick = (items) => items[Math.floor(Math.random() * items.length)];

/**
 * Twenty slots for one chest, drawn from the catalogue in force.
 *
 * Cosmetics are sampled WITHOUT replacement inside a tier, so a single chest
 * never holds the same avatar twice — a box with two of one thing in it has
 * quietly lost a slot. Across tiers there is nothing to collide.
 *
 * If a tier is too small to fill its slots (an operator disabled most of it),
 * the chest comes back short rather than padded: a short chest still opens, and
 * inventing filler would misreport the odds the composition is supposed to be.
 */
export function rollChest(spec, catalogue) {
  const slots = [];

  for (const [rarity, count] of Object.entries(spec.slots ?? {})) {
    if (!count) continue;
    const pool = shuffled(
      cosmeticsOfRarity(catalogue, rarity, [COSMETIC_TYPE.AVATAR, COSMETIC_TYPE.BANNER]),
    ).slice(0, count);
    for (const item of pool) {
      slots.push({ type: item.type, key: item.key, name: item.name, rarity, amount: null });
    }
  }

  for (const amount of spec.coins ?? []) {
    slots.push({ type: 'coins', key: null, name: `${amount} coins`, rarity: null, amount });
  }

  // Shuffled so the stored order carries no information. Nothing reads a slot
  // by index, but a chest whose first twelve entries are always the cosmetics
  // is a chest somebody will eventually be tempted to read by index.
  return shuffled(slots);
}

/**
 * Re-roll both chests for a period. Idempotent: rolling the same period twice
 * replaces the contents, which is what a re-run of the monthly job should do.
 */
export async function rollMonthlyChests({ period = currentPeriod() } = {}) {
  const { catalogue } = progression();
  const rolled = [];
  for (const spec of MONTHLY_CHESTS) {
    const rewards = rollChest(spec, catalogue);
    await Chest.updateOne(
      { key: spec.key },
      {
        $set: {
          name: spec.name,
          description: spec.description,
          triggerKind: CHEST_TRIGGER.LEAGUE,
          triggerRating: null,
          triggerLeague: spec.triggerLeague,
          rewards,
          period,
          enabled: true,
          order: spec.order,
        },
      },
      { upsert: true },
    );
    rolled.push({ key: spec.key, slots: rewards.length });
  }
  // The snapshot is what `awardChests` reads, so it has to follow the write —
  // otherwise the first player to finish a match after the 1st is handed a
  // grant carrying last month's contents.
  await loadProgression({ seed: false, migrate: false });
  logger.info({ period, rolled }, 'monthly chests rolled');
  return { period, rolled };
}

/**
 * Make sure the current month's chests exist, without disturbing them if they
 * do.
 *
 * Called at boot as well as by the monthly job, because the job only fires
 * while the process is up: an install that was down over the 1st, or a fresh
 * one, would otherwise serve a chest full of last month's pool — or no chest at
 * all — until the following month came round.
 */
export async function ensureMonthlyChests({ period = currentPeriod() } = {}) {
  const current = await Chest.countDocuments({
    key: { $in: MONTHLY_CHESTS.map((c) => c.key) },
    period,
  });
  if (current === MONTHLY_CHESTS.length) return { period, rolled: [] };
  return rollMonthlyChests({ period });
}

/**
 * Last month's unopened chests go.
 *
 * That is what makes the month a deadline rather than a suggestion. A chest
 * that waited forever would turn the monthly cycle into a slowly growing pile
 * of gifts, and the pile is the opposite of a reason to come back.
 */
export async function clearStaleChestGrants({ period = currentPeriod() } = {}) {
  const result = await ChestGrant.deleteMany({ claimedAt: null, period: { $ne: period } });
  if (result.deletedCount) logger.info({ period, expired: result.deletedCount }, 'chest grants expired');
  return { expired: result.deletedCount };
}

/** Has this player reached what the chest asks for? */
function chestIsOpen(chest, { rating, ladder }) {
  if (chest.enabled === false) return false;
  if (chest.triggerKind === CHEST_TRIGGER.RATING) {
    return Number.isFinite(chest.triggerRating) && rating >= chest.triggerRating;
  }
  const reached = leagueFor(rating, ladder).key;
  return leagueRank(reached, ladder) >= leagueRank(chest.triggerLeague, ladder);
}

/** "Reached Gold" / "Reached 1225" — what the reveal says they did. */
function triggerLabel(chest, ladder) {
  if (chest.triggerKind === CHEST_TRIGGER.RATING) return `Reached ${chest.triggerRating}`;
  const league = ladder.leagues.find((l) => l.key === chest.triggerLeague);
  return `Reached ${league?.name ?? chest.triggerLeague}`;
}

/**
 * Award any chest this rating has earned this month but not yet been given.
 *
 * Written on "has reached", not on "just crossed": a chest whose trigger moved
 * today should still find the players already above it, and a player whose
 * rating fell back below it keeps the one they were given. The unique index on
 * (userId, chestKey, period) is what makes it once and only once per month,
 * even if two matches finish in the same millisecond.
 *
 * @returns {Promise<Array<{key,name,triggerLabel,period}>>} newly awarded
 */
export async function awardChests({ userId, rankedRating, period }) {
  const { chests, ladder } = progression();
  if (!chests.length) return [];

  const earned = chests.filter((c) => chestIsOpen(c, { rating: rankedRating, ladder }));
  if (!earned.length) return [];

  const fresh = [];
  for (const chest of earned) {
    const label = triggerLabel(chest, ladder);
    const forPeriod = period ?? chest.period ?? currentPeriod();
    try {
      const result = await ChestGrant.updateOne(
        { userId: oid(userId), chestKey: chest.key, period: forPeriod },
        {
          $setOnInsert: {
            userId: oid(userId),
            chestKey: chest.key,
            period: forPeriod,
            chestName: chest.name,
            // A snapshot: re-rolling the chest next month must not change what
            // somebody is still holding from this one.
            rewards: chest.rewards,
            triggerLabel: label,
            unlockedAt: new Date(),
            claimedAt: null,
          },
        },
        { upsert: true },
      );
      if (result.upsertedCount) {
        fresh.push({ key: chest.key, name: chest.name, triggerLabel: label, period: forPeriod });
      }
    } catch (err) {
      // A duplicate key here is the race resolving itself correctly: someone
      // else inserted the same grant first, so this player already has it.
      if (err?.code !== 11000) throw err;
    }
  }
  return fresh;
}

/** What a chest is worth to a player, without saying which slot they will get. */
const publicGrant = (r) => ({
  key: r.chestKey,
  name: r.chestName,
  period: r.period ?? '',
  triggerLabel: r.triggerLabel ?? '',
  /**
   * Everything in the box. The player is looking at a case they can spin: the
   * suspense is which slot the draw lands on, not what the slots are.
   */
  slots: (r.rewards ?? []).map((s) => ({
    type: s.type,
    key: s.key,
    name: s.name,
    rarity: s.rarity,
    amount: s.amount,
  })),
  drawn: r.drawn
    ? {
        type: r.drawn.type,
        key: r.drawn.key,
        name: r.drawn.name,
        rarity: r.drawn.rarity,
        amount: r.drawn.amount,
      }
    : null,
  duplicate: Boolean(r.duplicate),
  coinsAwarded: r.coinsAwarded ?? 0,
  unlockedAt: r.unlockedAt,
  claimedAt: r.claimedAt ?? null,
});

/** Everything waiting for this player, newest first. */
export async function chestsFor(userId) {
  const rows = await ChestGrant.find({ userId: oid(userId) }).sort({ unlockedAt: -1 }).limit(24).lean();
  return rows.map(publicGrant);
}

/** How many chests are sitting unopened — the number the profile shows. */
export async function unopenedChestCount(userId) {
  return ChestGrant.countDocuments({ userId: oid(userId), claimedAt: null });
}

/**
 * Open one.
 *
 * Claiming draws a single slot from the twenty and is idempotent by way of the
 * `claimedAt: null` filter: two taps race, one writes, and the loser is told it
 * is already open rather than handed a second draw.
 *
 * The draw happens BEFORE the write, and the result is stored on the grant in
 * the same update that claims it. That ordering is what makes the whole thing
 * safe under a race — the losing tap cannot re-roll, because the roll it would
 * have to overwrite is already committed.
 */
export async function claimChest(userId, chestKey, { owned = [] } = {}) {
  const pending = await ChestGrant.findOne({ userId: oid(userId), chestKey, claimedAt: null })
    .sort({ unlockedAt: -1 })
    .lean();

  if (!pending) {
    const exists = await ChestGrant.exists({ userId: oid(userId), chestKey });
    if (exists) throw new ConflictError('That chest is already open.', 'ALREADY_CLAIMED');
    throw new NotFoundError('You have not earned that chest.', 'NO_CHEST');
  }

  const slots = pending.rewards ?? [];
  if (!slots.length) throw new ConflictError('That chest is empty.', 'EMPTY_CHEST');

  const drawn = pick(slots);
  const isCoins = drawn.type === 'coins';
  const duplicate = !isCoins && owned.includes(drawn.key);
  const coinsAwarded = isCoins
    ? (drawn.amount ?? 0)
    : duplicate
      ? (DUPLICATE_PAYOUT[drawn.rarity] ?? 0)
      : 0;

  const claimed = await ChestGrant.findOneAndUpdate(
    { _id: pending._id, claimedAt: null },
    { $set: { claimedAt: new Date(), drawn, duplicate, coinsAwarded } },
    { new: true },
  ).lean();

  // Lost the race. The winner's draw is the real one, so report that.
  if (!claimed) throw new ConflictError('That chest is already open.', 'ALREADY_CLAIMED');

  const grants = [];
  if (!isCoins && !duplicate) grants.push(drawn.key);
  // The top chest carries one thing coins can never buy and the shop never
  // lists: opening it is the whole of what the title means.
  if (chestKey === MONTHLY_CHESTS[1].key && !owned.includes(LEGENDARY_CHEST_TITLE)) {
    grants.push(LEGENDARY_CHEST_TITLE);
  }

  if (grants.length || coinsAwarded) {
    await User.updateOne(
      { _id: oid(userId) },
      {
        ...(grants.length ? { $addToSet: { grantedPerks: { $each: grants } } } : {}),
        ...(coinsAwarded ? { $inc: { coins: coinsAwarded } } : {}),
      },
    );
  }

  return { ...publicGrant(claimed), granted: grants };
}

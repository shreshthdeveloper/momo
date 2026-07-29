import mongoose from 'mongoose';
import {
  ACCOUNT_MAX_LEVEL,
  CHEST_RECURRENCE,
  CHEST_RECURRENCES,
  CHEST_TRIGGER,
  CHEST_TRIGGERS,
  COINS_MAX,
  COSMETIC_TYPES,
  RARITIES,
  UNLOCK_KIND,
  UNLOCK_KINDS,
} from '../shared/constants.js';

const { Schema } = mongoose;

/**
 * Progression as data (leagues-and-progression.md §9).
 *
 * Everything a superadmin can tune lives here: the cosmetics catalogue, the
 * account XP table, the league floors and the chests. The code that used to
 * hold these numbers keeps them only as the seed for a fresh install and as
 * the fallback a client renders before its first fetch.
 *
 * The rule that makes this safe is one-way: **the server computes, the client
 * displays.** A client never derives a level or a league from a curve it holds
 * locally, because the curve it holds may be a version behind.
 */

// ── Cosmetics ──────────────────────────────────────────────────────────────

/**
 * One wearable thing: an avatar, a banner or a title.
 *
 * `key` is the same string the profile already stores (`mimo:avatar/<key>`),
 * so making these editable introduced no parallel id space — a row here simply
 * describes a key that was already flying around the wire.
 */
const cosmeticSchema = new Schema(
  {
    type: { type: String, enum: COSMETIC_TYPES, required: true },
    key: { type: String, required: true, trim: true, lowercase: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 40 },

    unlockKind: { type: String, enum: UNLOCK_KINDS, default: UNLOCK_KIND.FREE },
    /** Meaningful only when `unlockKind` is 'level'. */
    unlockLevel: { type: Number, default: 0, min: 0, max: ACCOUNT_MAX_LEVEL },
    /** Meaningful only when `unlockKind` is 'league' — a league key. */
    unlockLeague: { type: String, default: null },

    /**
     * The tier (coins-and-cosmetics.md §2). Null for titles, which are earned
     * rather than bought and so sit outside the ladder entirely.
     *
     * This is the field the shop shelves, the chest pools and the duplicate
     * payouts all read. It is stored rather than derived from the price because
     * a legendary has no price at all.
     */
    rarity: { type: String, enum: [...RARITIES, null], default: null },

    /**
     * What it costs in coins, or null when coins cannot buy it. Seeded from the
     * tier's price band and editable afterwards — retuning one item should not
     * mean retuning a band.
     */
    price: { type: Number, default: null, min: 0, max: COINS_MAX },

    /**
     * Where the art lives. `null` means the client resolves the key against
     * the set bundled into the app, which is how the shipped faces stay
     * instant and keep working offline; an uploaded image fills this in and
     * is fetched over the network like any other remote avatar.
     */
    imageUrl: { type: String, default: null, maxlength: 500 },

    /** Off hides it everywhere without deleting what people already wear. */
    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

cosmeticSchema.index({ type: 1, key: 1 }, { unique: true });
cosmeticSchema.index({ type: 1, order: 1 });

export const Cosmetic = mongoose.model('Cosmetic', cosmeticSchema);

// ── The ladders ────────────────────────────────────────────────────────────

const leagueBandSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true, maxlength: 24 },
    name: { type: String, required: true, trim: true, maxlength: 24 },
    /** Lowest ranked rating in the band. The bottom league must sit on the floor. */
    floor: { type: Number, required: true },
    /** design.md §3.3 — the badge tint. */
    color: { type: String, default: null, maxlength: 9 },
  },
  { _id: false },
);

/**
 * The single progression document. One per install, enforced by a unique index
 * on a constant field — a config that can exist twice is a config that will.
 */
const progressionConfigSchema = new Schema(
  {
    singleton: { type: String, default: 'progression', unique: true, immutable: true },

    /**
     * Total XP required to REACH each account level, index 0 being level 1.
     * A table rather than a formula because a superadmin edits rows, not
     * coefficients; it is seeded from the old quadratic so day one is
     * unchanged. Validated ascending on write — a curve that dips would let a
     * player's level fall as they earn XP.
     */
    accountCurve: { type: [Number], default: undefined },

    leagues: { type: [leagueBandSchema], default: undefined },
    divisions: { type: Number, default: undefined, min: 1, max: 5 },
    divisionWidth: { type: Number, default: undefined, min: 1 },

    /**
     * One-shot data migrations already applied, by name.
     *
     * The alternative was a separate migrations collection, which is a second
     * piece of install-scoped state for the sake of a list of strings. This
     * document is already the install's progression record and is already read
     * on every boot, so the names live here — and a migration that has run is
     * recorded in the same write that its effects land in.
     */
    migrations: { type: [String], default: [] },

    /**
     * The last month whose turnover actually ran, as `YYYY-MM`.
     *
     * This used to be inferred from the chests carrying the current period,
     * which quietly broke the whole cycle: boot rolls the month's chests so a
     * fresh install serves a full pool, so ANY restart between the 1st and the
     * hourly job's next tick stamped the period without archiving the
     * leaderboard, soft-resetting ratings or clearing last month's grants —
     * and then the job saw the period already stamped and skipped the month.
     *
     * A record written by the cycle itself, and by nothing else, cannot be
     * forged by a step that only rolls chests.
     */
    lastCycledPeriod: { type: String, default: null, maxlength: 7 },

    /**
     * Bumped on every write. The client sends the version it holds and the
     * server tells it whether to refetch — cheaper than shipping the whole
     * catalogue on every poll.
     */
    version: { type: Number, default: 1 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export const ProgressionConfig = mongoose.model('ProgressionConfig', progressionConfigSchema);

// ── Chests ─────────────────────────────────────────────────────────────────

/**
 * One of the twenty slots in a chest (coins-and-cosmetics.md §5.2).
 *
 * Eight of them are coins and twelve are cosmetics, and **the composition is
 * the odds** — opening draws one slot uniformly. There is deliberately no
 * separate weighting table, because a weighting table is a second description
 * of the same thing and the two drift.
 *
 * `type` needs the long form here: inside a nested object mongoose reads a
 * bare `type` as the field's SchemaType rather than as a field called "type".
 */
const chestSlotSchema = new Schema(
  {
    type: { type: String, enum: [...COSMETIC_TYPES, 'coins'], required: true },
    /** The cosmetic key. Absent on a coin slot. */
    key: { type: String, trim: true, lowercase: true, maxlength: 40, default: null },
    /** The payout on a coin slot: 25, 50 or 100. */
    amount: { type: Number, default: null, min: 0 },
    /** Denormalised so a reveal can colour itself without the catalogue. */
    rarity: { type: String, enum: [...RARITIES, null], default: null },
    name: { type: String, trim: true, maxlength: 40, default: null },
  },
  { _id: false },
);

const chestSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true, maxlength: 40, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    description: { type: String, trim: true, maxlength: 160 },

    triggerKind: { type: String, enum: CHEST_TRIGGERS, default: CHEST_TRIGGER.LEAGUE },
    /** Ranked rating to cross, when the trigger is a rating. */
    triggerRating: { type: Number, default: null },
    /** League key to reach, when the trigger is a league. */
    triggerLeague: { type: String, default: null },

    /**
     * Monthly, or once ever (coins-and-cosmetics.md §5 vs event chests).
     *
     * The default is ONCE because the only chests that should recur are the two
     * built-in ones, which say so explicitly. An operator making a Christmas
     * chest gets a Christmas chest.
     */
    recurrence: {
      type: String,
      enum: CHEST_RECURRENCES,
      default: CHEST_RECURRENCE.ONCE,
    },

    rewards: { type: [chestSlotSchema], default: [] },

    /**
     * The month these contents were rolled for, as `YYYY-MM`.
     *
     * A chest is re-rolled on the 1st (coins-and-cosmetics.md §5), so the same
     * document holds different things in March than it did in February. This is
     * what a grant records so an unopened chest can never be filled with next
     * month's pool.
     */
    period: { type: String, default: null, maxlength: 7 },

    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const Chest = mongoose.model('Chest', chestSchema);

/**
 * One player's claim on one chest, in one month.
 *
 * The row is written the moment the league is reached and marked claimed when
 * they open it, so a chest is won once per month and only once — the unique
 * index is what makes that true even if two matches finish at the same instant.
 *
 * `period` is part of that key, and it is the whole reason the monthly loop
 * works: without it the index said win-once-EVER, which would have let a player
 * open the Gold chest in January and never see one again.
 *
 * `rewards` is a SNAPSHOT. Re-rolling a chest afterwards must not change what
 * somebody is still holding, and deleting one must not orphan an unopened gift.
 */
const chestGrantSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    chestKey: { type: String, required: true },
    /** `YYYY-MM`. Legacy grants written before the monthly cycle carry ''. */
    period: { type: String, required: true, default: '', maxlength: 7 },
    /** Denormalised for the reveal, which must read the same years later. */
    chestName: { type: String, required: true },
    rewards: { type: [chestSlotSchema], default: [] },
    /** "Reached Gold" — what the player did to earn it. */
    triggerLabel: { type: String, maxlength: 80 },

    /**
     * The one slot the open landed on. Written at claim time, kept afterwards
     * so "what did I get?" has an answer a week later.
     */
    drawn: { type: chestSlotSchema, default: null },
    /** True when `drawn` was already owned and paid out in coins instead. */
    duplicate: { type: Boolean, default: false },
    /** Coins the open paid — from a coin slot, or from a duplicate. */
    coinsAwarded: { type: Number, default: 0, min: 0 },

    unlockedAt: { type: Date, default: Date.now },
    claimedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

chestGrantSchema.index({ userId: 1, chestKey: 1, period: 1 }, { unique: true });
chestGrantSchema.index({ userId: 1, claimedAt: 1 });
chestGrantSchema.index({ period: 1, claimedAt: 1 });

export const ChestGrant = mongoose.model('ChestGrant', chestGrantSchema);

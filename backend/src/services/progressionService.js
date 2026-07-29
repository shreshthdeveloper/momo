import mongoose from 'mongoose';
import { Cosmetic, ProgressionConfig, Chest, User } from '../models/index.js';
import {
  setProgressionSnapshot,
  progressionSnapshot,
  clearProgressionSnapshot,
} from '../lib/progressionCache.js';
import {
  DEFAULT_CATALOGUE,
  STARTER_AVATARS,
  STARTER_BANNERS,
  findCosmetic,
  formatCoins,
  isBuyable,
  ownsCosmetic,
  titleForLevel,
} from '../shared/perks.js';
import {
  DEFAULT_ACCOUNT_CURVE,
  accountLevelForXp,
  isMilestoneLevel,
  levelsCrossed,
} from '../shared/mastery.js';

import {
  ACCOUNT_MAX_LEVEL,
  CHEST_RECURRENCE,
  CHEST_RECURRENCES,
  CHEST_TRIGGER,
  COINS_MAX,
  COIN_AWARD,
  COSMETIC_TYPE,
  MONTHLY_CHESTS,
  RARITIES,
  RARITY,
  RARITY_META,
  LEAGUES,
  LEAGUE_METALS,
  LEAGUE_DIVISIONS,
  LEAGUE_DIVISION_WIDTH,
  RANKED_FLOOR,
  UNLOCK_KIND,
} from '../shared/constants.js';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Progression as configuration (leagues-and-progression.md §9).
 *
 * One in-process snapshot, refreshed on every write, read synchronously by
 * everything that needs to know what a level or a league means. The database
 * is the authority and this is its cache; the shipped constants are only the
 * seed and the last-resort fallback.
 *
 * The invariant the whole design rests on: **the server computes, the client
 * displays.** No client is ever asked to apply a curve, because the curve it
 * holds may be a version behind.
 */

/** What a fresh install starts with — exactly today's behaviour, as data. */
function seedConfig() {
  return {
    accountCurve: [...DEFAULT_ACCOUNT_CURVE],
    leagues: LEAGUES.map((l) => ({ key: l.key, name: l.name, floor: l.floor, color: l.color })),
    divisions: LEAGUE_DIVISIONS,
    divisionWidth: LEAGUE_DIVISION_WIDTH,
    /**
     * A fresh install is already on the current model, so every migration is
     * recorded as done rather than run. They exist to move an OLD database
     * forward; run against a new one, `grandfather-level-unlocks` would read an
     * empty user collection and `monthly-chests` would settle nothing.
     */
    migrations: MIGRATIONS.map((m) => m.name),
    version: 1,
  };
}

/**
 * The metal for a rung of the ladder: the bottom is bronze, the top is white,
 * and anything in between is spread across the metals in order.
 */
function metalForRung(index, total) {
  if (total <= 1) return LEAGUE_METALS[0];
  if (index === total - 1) return LEAGUE_METALS[LEAGUE_METALS.length - 1];
  const span = LEAGUE_METALS.length - 1;
  return LEAGUE_METALS[Math.min(span - 1, Math.round((index / (total - 1)) * span))];
}

/** The shape every reader gets, whether or not the database has been read. */
function snapshotFrom(config, catalogue, chests) {
  return {
    version: config?.version ?? 0,
    /**
     * What a client compares against to decide whether it holds the current
     * config. It carries the document's ID as well as the counter, because the
     * counter alone is not unique across databases: a re-seed drops the config
     * and writes a fresh one back at version 1, so a client still holding
     * version 1 from the PREVIOUS database would be told "unchanged" and keep
     * a catalogue that no longer exists. The id is new every time the document
     * is, which is exactly the event the counter cannot see.
     */
    token: config?._id ? `${String(config._id)}.${config.version ?? 0}` : 'default.0',
    accountCurve: config?.accountCurve?.length ? config.accountCurve : [...DEFAULT_ACCOUNT_CURVE],
    ladder: {
      /**
       * A band always leaves here with a colour. An operator who adds a league
       * without picking one gets the metal for that rung — a badge with no
       * colour is not a state worth having, and the client cannot infer one
       * from a key it has never seen.
       */
      leagues: config?.leagues?.length
        ? config.leagues.map((l, i) => ({
            key: l.key,
            name: l.name,
            floor: l.floor,
            color: l.color ?? metalForRung(i, config.leagues.length),
          }))
        : LEAGUES.map((l) => ({ ...l })),
      divisions: config?.divisions ?? LEAGUE_DIVISIONS,
      divisionWidth: config?.divisionWidth ?? LEAGUE_DIVISION_WIDTH,
    },
    catalogue: catalogue ?? DEFAULT_CATALOGUE,
    chests: chests ?? [],
    updatedAt: config?.updatedAt ?? null,
  };
}

/** Everything in force right now. Synchronous — falls back to the seed. */
export function progression() {
  return progressionSnapshot() ?? snapshotFrom(null, DEFAULT_CATALOGUE, []);
}

const rowToCosmetic = (c) => ({
  type: c.type,
  key: c.key,
  name: c.name,
  rarity: c.rarity ?? null,
  price: c.price ?? null,
  unlockKind: c.unlockKind,
  unlockLevel: c.unlockLevel ?? 0,
  unlockLeague: c.unlockLeague ?? null,
  imageUrl: c.imageUrl ?? null,
  enabled: c.enabled !== false,
  order: c.order ?? 0,
});

const rowToChest = (c) => ({
  key: c.key,
  name: c.name,
  description: c.description ?? '',
  triggerKind: c.triggerKind,
  triggerRating: c.triggerRating ?? null,
  triggerLeague: c.triggerLeague ?? null,
  period: c.period ?? null,
  rewards: (c.rewards ?? []).map((r) => ({
    type: r.type,
    key: r.key ?? null,
    name: r.name ?? null,
    rarity: r.rarity ?? null,
    amount: r.amount ?? null,
  })),
  enabled: c.enabled !== false,
  order: c.order ?? 0,
});

/**
 * Read the config into the snapshot, seeding a fresh install on the way.
 *
 * Safe to call concurrently: the seed writes are upserts keyed on values that
 * cannot collide, so two racing boots converge on the same document rather
 * than on two.
 */
export async function loadProgression({ seed = true, migrate = true } = {}) {
  let config = await ProgressionConfig.findOne({ singleton: 'progression' }).lean();

  if (!config && seed) {
    config = await seedProgression();
  } else if (seed) {
    /**
     * An install seeded before this release is carrying the old model, and the
     * migrations are what move it: they are run BEFORE the backfill so the
     * grandfathering step sees the old catalogue rows it has to read ownership
     * out of. Reverse the two and every level-unlocked avatar would be handed
     * back as a thing to buy.
     */
    if (migrate) config = (await runMigrations(config)) ?? config;
    await backfillShippedCosmetics();
  }

  const [cosmetics, chests] = await Promise.all([
    Cosmetic.find({}).sort({ type: 1, order: 1 }).lean(),
    Chest.find({}).sort({ order: 1 }).lean(),
  ]);

  const snapshot = snapshotFrom(
    config,
    cosmetics.length ? cosmetics.map(rowToCosmetic) : DEFAULT_CATALOGUE,
    chests.map(rowToChest),
  );
  setProgressionSnapshot(snapshot);
  return snapshot;
}

/**
 * Art that shipped in a later build.
 *
 * A release adds avatars, and an install seeded before it would never see
 * them — the seed only runs once. Inserts only: a row an operator has already
 * moved, renamed or switched off is theirs, and a deploy must not undo that.
 */
async function backfillShippedCosmetics() {
  const existing = await Cosmetic.find({}, { type: 1, key: 1 }).lean();
  const have = new Set(existing.map((c) => `${c.type}/${c.key}`));
  const missing = DEFAULT_CATALOGUE.filter((c) => !have.has(`${c.type}/${c.key}`));
  if (!missing.length) return 0;

  await Cosmetic.insertMany(
    missing.map((c) => ({ ...c, imageUrl: null, enabled: true })),
    { ordered: false },
  ).catch((err) => logger.warn({ err }, 'cosmetic backfill partially failed'));

  logger.info({ added: missing.map((c) => c.key) }, 'shipped cosmetics backfilled');
  return missing.length;
}

// ── Migrations ─────────────────────────────────────────────────────────────

/**
 * One-shot data moves, applied in order and recorded on the config document.
 *
 * Each one is written to be safe to re-run, but the recorded name is what
 * actually stops it: `grandfather-level-unlocks` reads the catalogue as it
 * stands, and running it after the catalogue has been rewritten would grant
 * nothing. Order matters as much as idempotency here.
 */
const MIGRATIONS = [
  /**
   * The guest fields come off the documents, not merely out of the schema
   * (coins-and-cosmetics.md §8). A dormant field is a question every future
   * reader of `joinQueue` has to answer again.
   *
   * The guest accounts themselves are retired rather than converted: they have
   * no phone number, so there is no way to sign back into one, and leaving them
   * 'active' would leave rows nothing in the product can reach.
   */
  {
    /**
     * Named for the second attempt on purpose.
     *
     * The first one ran, was recorded as done, and changed nothing: mongoose
     * applies STRICT MODE to update paths, so `$unset: { isGuest }` against a
     * schema that no longer declares `isGuest` was silently discarded — the
     * update succeeded, matched every row, and modified none. A migration that
     * removes a field must therefore always opt out of strict, because the
     * field being gone from the schema is the entire premise of running it.
     */
    name: 'purge-guest-fields',
    async run() {
      const retired = await User.updateMany(
        { role: 'guest' },
        { $set: { role: 'player', status: 'deleted', deletedAt: new Date(), deviceId: null } },
        { strict: false },
      );
      const cleared = await User.updateMany(
        { $or: [{ isGuest: { $exists: true } }, { guestMatchesPlayed: { $exists: true } }] },
        { $unset: { isGuest: '', guestMatchesPlayed: '' } },
        { strict: false },
      );
      return { retired: retired.modifiedCount, cleared: cleared.modifiedCount };
    },
  },

  /**
   * Everything a player owned under the LEVEL ladder becomes theirs on paper.
   *
   * This is the migration the whole release rests on. Ownership used to be
   * derived — your level said what you owned — and after the shop it is
   * written down. Without this step, switching the catalogue over would take
   * every avatar a player had climbed to and put a price on it.
   *
   * It reads the catalogue rows and the curve **as they stand right now**, so
   * it must run before the rows are rewritten and before the curve is rescaled.
   */
  {
    name: 'grandfather-level-unlocks',
    async run() {
      const [rows, config] = await Promise.all([
        Cosmetic.find({}).lean(),
        ProgressionConfig.findOne({ singleton: 'progression' }).lean(),
      ]);
      const curve = config?.accountCurve?.length ? config.accountCurve : DEFAULT_ACCOUNT_CURVE;
      const ladder = snapshotFrom(config, [], []).ladder;
      const wearables = rows.filter((c) => c.type !== COSMETIC_TYPE.TITLE);
      if (!wearables.length) return { granted: 0 };

      const cursor = User.find(
        {},
        { totalXp: 1, accountLevelFloor: 1, rankedRating: 1, grantedPerks: 1 },
      )
        .lean()
        .cursor();

      let ops = [];
      let touched = 0;

      for await (const user of cursor) {
        const ctx = {
          level: accountLevelForXp(user.totalXp ?? 0, curve),
          rankedRating: user.rankedRating ?? RANKED_FLOOR,
          granted: user.grantedPerks ?? [],
          ladder,
        };
        ctx.level = Math.max(ctx.level, user.accountLevelFloor ?? 1);

        const owned = wearables
          .filter((c) => ownsCosmetic(c, ctx))
          .map((c) => c.key)
          .filter((k) => !ctx.granted.includes(k));
        if (!owned.length) continue;

        ops.push({
          updateOne: {
            filter: { _id: user._id },
            update: { $addToSet: { grantedPerks: { $each: owned } } },
          },
        });
        touched += 1;
        if (ops.length >= 500) {
          await User.bulkWrite(ops, { ordered: false });
          ops = [];
        }
      }
      if (ops.length) await User.bulkWrite(ops, { ordered: false });
      return { granted: touched };
    },
  },

  /**
   * The catalogue itself moves onto rarity.
   *
   * This one deliberately overwrites rows an operator may have edited, which
   * `backfillShippedCosmetics` would never do — but the shape of a row changed,
   * not its content, and a row left on the old shape would be an avatar with no
   * tier and no price: invisible in the shop and unbuyable anywhere.
   * Uploaded art (`imageUrl`) and the enabled flag are left alone.
   */
  {
    name: 'cosmetics-to-rarity',
    async run() {
      await Cosmetic.bulkWrite(
        DEFAULT_CATALOGUE.map((c) => ({
          updateOne: {
            filter: { type: c.type, key: c.key },
            update: {
              $set: {
                name: c.name,
                rarity: c.rarity,
                price: c.price,
                unlockKind: c.unlockKind,
                unlockLevel: c.unlockLevel,
                unlockLeague: c.unlockLeague,
                order: c.order,
              },
              $setOnInsert: { imageUrl: null, enabled: true },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      return { rows: DEFAULT_CATALOGUE.length };
    },
  },

  /**
   * Art that no longer ships gets withdrawn from the shelf.
   *
   * Releases replace avatars as well as adding them, and `backfillShippedCosmetics`
   * only ever inserts — so an install can accumulate rows whose PNG left the
   * bundle. They are worse than clutter: a level-gated orphan is still a level
   * row, so `nextUnlock` will happily tell a player their next level opens an
   * avatar that no client on earth can draw.
   *
   * The test is deliberately narrow — not in the shipped catalogue AND carrying
   * no uploaded image. A row an operator added themselves has an `imageUrl` and
   * is left alone; that is their item, not a leftover.
   *
   * Disabled, never deleted. Anyone still wearing one keeps wearing it: the key
   * stays in their profile and in `grantedPerks`, and an unknown key resolves
   * as theirs.
   */
  {
    name: 'retire-orphan-cosmetics',
    async run() {
      const shipped = new Set(DEFAULT_CATALOGUE.map((c) => `${c.type}/${c.key}`));
      const rows = await Cosmetic.find(
        { enabled: { $ne: false }, $or: [{ imageUrl: null }, { imageUrl: { $exists: false } }] },
        { type: 1, key: 1 },
      ).lean();
      const orphans = rows.filter((c) => !shipped.has(`${c.type}/${c.key}`));
      if (!orphans.length) return { retired: 0 };

      await Cosmetic.updateMany(
        { _id: { $in: orphans.map((c) => c._id) } },
        { $set: { enabled: false } },
      );
      return { retired: orphans.length, keys: orphans.slice(0, 10).map((c) => c.key) };
    },
  },

  /**
   * The account curve is rescaled to a hundred levels (§4.1).
   *
   * Levels are floored under the outgoing curve first, exactly as a superadmin
   * edit would do it — the new curve is gentler, so nobody needs the floor, but
   * relying on that is relying on arithmetic staying true after somebody
   * retunes a coefficient.
   */
  {
    name: 'rescale-account-curve',
    async run(config) {
      const floored = await applyLevelFloors(
        config?.accountCurve?.length ? config.accountCurve : DEFAULT_ACCOUNT_CURVE,
      );
      return { floored, patch: { accountCurve: [...DEFAULT_ACCOUNT_CURVE] } };
    },
  },

  /**
   * The three once-ever chests are replaced by the two monthly ones.
   *
   * Anything still sitting unopened is GRANTED rather than deleted. The chests
   * that held them no longer exist and their rating triggers went with them, so
   * the choice was between handing the contents over and maintaining a second
   * chest format for ever. It gives; it never takes.
   */
  {
    name: 'monthly-chests',
    async run() {
      const { ChestGrant } = await import('../models/index.js');
      const legacy = await ChestGrant.find({ claimedAt: null }).lean();

      for (const grant of legacy) {
        const keys = (grant.rewards ?? []).map((r) => r.key).filter(Boolean);
        if (keys.length) {
          await User.updateOne(
            { _id: grant.userId },
            { $addToSet: { grantedPerks: { $each: keys } } },
          );
        }
      }
      await ChestGrant.deleteMany({});
      await Chest.deleteMany({ key: { $nin: MONTHLY_CHESTS.map((c) => c.key) } });

      return { settled: legacy.length };
    },
  },
];

/**
 * Run whatever has not run, then hand back the config as it now stands.
 *
 * Migrations are recorded one at a time rather than in a batch at the end: a
 * process killed halfway through a release should not repeat the four that
 * already landed.
 */
export async function runMigrations(existing) {
  let config = existing ?? (await ProgressionConfig.findOne({ singleton: 'progression' }).lean());
  const done = new Set(config?.migrations ?? []);
  const pending = MIGRATIONS.filter((m) => !done.has(m.name));
  if (!pending.length) return config;

  for (const migration of pending) {
    const started = Date.now();
    const result = (await migration.run(config)) ?? {};
    const { patch, ...summary } = result;
    config = await ProgressionConfig.findOneAndUpdate(
      { singleton: 'progression' },
      { $addToSet: { migrations: migration.name }, $inc: { version: 1 }, $set: { ...patch } },
      { new: true, upsert: true },
    ).lean();
    logger.info({ migration: migration.name, ms: Date.now() - started, ...summary }, 'migration applied');
  }
  return config;
}

/** First boot: turn the shipped constants into rows a superadmin can edit. */
async function seedProgression() {
  const seeded = seedConfig();

  await Cosmetic.bulkWrite(
    DEFAULT_CATALOGUE.map((c) => ({
      updateOne: {
        filter: { type: c.type, key: c.key },
        update: { $setOnInsert: { ...c, imageUrl: null, enabled: true } },
        upsert: true,
      },
    })),
    { ordered: false },
  ).catch((err) => logger.warn({ err }, 'cosmetic seed partially failed'));

  const config = await ProgressionConfig.findOneAndUpdate(
    { singleton: 'progression' },
    { $setOnInsert: seeded },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  // The tiers moved underneath people when flowers became the free set, so
  // anything already being worn is written into `grantedPerks` before the new
  // rules can lock it. Nobody loses the face they chose.
  const grandfathered = await grandfatherWornCosmetics();
  logger.info({ grandfathered }, 'progression seeded');

  return config;
}

/**
 * Everything a player is currently wearing becomes theirs permanently.
 *
 * Run once at seed time. It is deliberately blunt — a key that was already
 * free costs one array entry and nothing else, whereas missing one would take
 * an avatar off somebody's profile.
 */
export async function grandfatherWornCosmetics() {
  const cursor = User.find(
    { $or: [{ avatarUrl: /^mimo:avatar\// }, { banner: /^mimo:banner\// }, { title: { $ne: '' } }] },
    { avatarUrl: 1, banner: 1, title: 1, grantedPerks: 1 },
  )
    .lean()
    .cursor();

  let ops = [];
  let touched = 0;

  for await (const user of cursor) {
    const worn = [
      keyFromPreset('avatar', user.avatarUrl),
      keyFromPreset('banner', user.banner),
      user.title || null,
    ].filter(Boolean);
    const missing = worn.filter((k) => !(user.grantedPerks ?? []).includes(k));
    if (!missing.length) continue;

    ops.push({
      updateOne: {
        filter: { _id: user._id },
        update: { $addToSet: { grantedPerks: { $each: missing } } },
      },
    });
    touched += 1;
    if (ops.length >= 500) {
      await User.bulkWrite(ops, { ordered: false });
      ops = [];
    }
  }
  if (ops.length) await User.bulkWrite(ops, { ordered: false });
  return touched;
}

/** `mimo:avatar/panda` → `panda`; anything else (an upload) → null. */
export function keyFromPreset(type, value) {
  const prefix = `mimo:${type}/`;
  const raw = String(value ?? '');
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : null;
}

// ── Writes ─────────────────────────────────────────────────────────────────

/** Bump the version and refresh the snapshot. Every write ends here. */
async function commit(actorId, patch = {}) {
  await ProgressionConfig.updateOne(
    { singleton: 'progression' },
    { $inc: { version: 1 }, $set: { updatedBy: actorId ? oid(actorId) : null, ...patch } },
    { upsert: true },
  );
  return loadProgression({ seed: false });
}

/**
 * The account XP table.
 *
 * Validated ascending and starting at zero, because a curve that dips would
 * let a player's level fall as they earned XP — the one thing the level is
 * promised never to do. Existing players are floored at the level they had
 * under the OLD curve before the new one lands, so an edit can raise somebody
 * but can never visibly demote them.
 */
export async function saveAccountCurve(curve, { actorId } = {}) {
  if (!Array.isArray(curve) || curve.length < 2) {
    throw new BadRequestError('A curve needs at least two levels.', 'BAD_CURVE');
  }
  if (curve.length > ACCOUNT_MAX_LEVEL) {
    throw new BadRequestError(`The ladder stops at level ${ACCOUNT_MAX_LEVEL}.`, 'BAD_CURVE');
  }
  const rows = curve.map((n) => Math.round(Number(n)));
  if (rows.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new BadRequestError('Every row needs a whole number of XP.', 'BAD_CURVE');
  }
  if (rows[0] !== 0) {
    throw new BadRequestError('Level 1 always starts at 0 XP.', 'BAD_CURVE');
  }
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i] <= rows[i - 1]) {
      throw new BadRequestError(
        `Level ${i + 1} must cost more than level ${i}.`,
        'CURVE_NOT_ASCENDING',
      );
    }
  }

  const floored = await applyLevelFloors(progression().accountCurve);
  const snapshot = await commit(actorId, { accountCurve: rows });
  logger.info({ levels: rows.length, floored }, 'account curve saved');
  return { config: snapshot, floored };
}

/**
 * Stamp every player with the level they hold under the CURRENT curve, so the
 * curve about to replace it cannot take one off them.
 */
async function applyLevelFloors(currentCurve) {
  const cursor = User.find({ totalXp: { $gt: 0 } }, { totalXp: 1, accountLevelFloor: 1 })
    .lean()
    .cursor();

  let ops = [];
  let touched = 0;

  for await (const user of cursor) {
    const held = accountLevelForXp(user.totalXp ?? 0, currentCurve);
    if (held <= (user.accountLevelFloor ?? 1)) continue;
    ops.push({
      updateOne: { filter: { _id: user._id }, update: { $set: { accountLevelFloor: held } } },
    });
    touched += 1;
    if (ops.length >= 500) {
      await User.bulkWrite(ops, { ordered: false });
      ops = [];
    }
  }
  if (ops.length) await User.bulkWrite(ops, { ordered: false });
  return touched;
}

/**
 * The league bands.
 *
 * Floors must ascend and the bottom league must sit on the rating floor, or
 * there would be ratings that belong to no league at all — every player has a
 * badge, so every rating needs a band.
 */
export async function saveLeagues(leagues, { actorId } = {}) {
  if (!Array.isArray(leagues) || leagues.length < 2) {
    throw new BadRequestError('A ladder needs at least two leagues.', 'BAD_LADDER');
  }
  const rows = leagues.map((l) => ({
    key: String(l.key ?? '').trim().toLowerCase(),
    name: String(l.name ?? '').trim(),
    floor: Math.round(Number(l.floor)),
    color: l.color ? String(l.color).trim() : null,
  }));
  if (rows.some((l) => !l.key || !l.name)) {
    throw new BadRequestError('Every league needs a key and a name.', 'BAD_LADDER');
  }
  if (new Set(rows.map((l) => l.key)).size !== rows.length) {
    throw new ConflictError('Two leagues share a key.', 'DUPLICATE_LEAGUE');
  }
  if (rows.some((l) => !Number.isFinite(l.floor))) {
    throw new BadRequestError('Every league needs a floor rating.', 'BAD_LADDER');
  }
  if (rows[0].floor !== RANKED_FLOOR) {
    throw new BadRequestError(
      `The bottom league has to start at ${RANKED_FLOOR} — every rating needs a badge.`,
      'BAD_LADDER',
    );
  }
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].floor <= rows[i - 1].floor) {
      throw new BadRequestError(
        `${rows[i].name} must start above ${rows[i - 1].name}.`,
        'LADDER_NOT_ASCENDING',
      );
    }
  }

  /**
   * Nothing may be left pointing at a league that no longer exists.
   *
   * The ladder is replaced wholesale and the chests and cosmetics that gate on
   * a league key were never re-checked, so re-keying `gold` silently stopped
   * the monthly chest ever being awarded again and made every gold-gated
   * cosmetic permanently unownable — no error, nothing on any screen, because
   * `leagueRank` maps an unknown key to +Infinity rather than failing.
   *
   * A key that changed IN PLACE is a rename, which is a thing the console is
   * meant to allow: the band at that rung is still the same band, so anything
   * pointing at the old key is moved to the new one. Only a reference with
   * nowhere to land — a rung that no longer exists at all — is refused.
   */
  const previous = progression().ladder.leagues ?? [];
  const renames = new Map();
  for (let i = 0; i < Math.min(previous.length, rows.length); i += 1) {
    if (previous[i].key !== rows[i].key) renames.set(previous[i].key, rows[i].key);
  }
  const keys = new Set(rows.map((l) => l.key));
  const landing = (key) => (keys.has(key) ? key : renames.get(key));

  const [chests, cosmetics] = await Promise.all([
    Chest.find({ triggerLeague: { $ne: null } }, { key: 1, name: 1, triggerLeague: 1 }).lean(),
    Cosmetic.find({ unlockLeague: { $ne: null } }, { type: 1, key: 1, name: 1, unlockLeague: 1 }).lean(),
  ]);

  const orphanedChest = chests.find((c) => !landing(c.triggerLeague));
  if (orphanedChest) {
    throw new ConflictError(
      `${orphanedChest.name} opens on "${orphanedChest.triggerLeague}", which this ladder no longer has. Point it somewhere else first.`,
      'LEAGUE_IN_USE',
    );
  }

  const orphanedCosmetic = cosmetics.find((c) => !landing(c.unlockLeague));
  if (orphanedCosmetic) {
    throw new ConflictError(
      `${orphanedCosmetic.name} unlocks at "${orphanedCosmetic.unlockLeague}", which this ladder no longer has. Point it somewhere else first.`,
      'LEAGUE_IN_USE',
    );
  }

  // Carry every reference across before the ladder they read is replaced.
  for (const [from, to] of renames) {
    await Promise.all([
      Chest.updateMany({ triggerLeague: from }, { $set: { triggerLeague: to } }),
      Cosmetic.updateMany({ unlockLeague: from }, { $set: { unlockLeague: to } }),
    ]);
  }

  // Existing rows are replaced wholesale: a ladder is one thing, not five.
  return commit(actorId, { leagues: rows });
}

/** Divisions are shared by every league — three of them, 75 points wide. */
export async function saveDivisions({ divisions, divisionWidth }, { actorId } = {}) {
  const count = Math.round(Number(divisions));
  const width = Math.round(Number(divisionWidth));
  if (!Number.isFinite(count) || count < 1 || count > 5) {
    throw new BadRequestError('Between one and five divisions.', 'BAD_DIVISIONS');
  }
  if (!Number.isFinite(width) || width < 10) {
    throw new BadRequestError('A division needs at least ten rating points.', 'BAD_DIVISIONS');
  }
  return commit(actorId, { divisions: count, divisionWidth: width });
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Create or update one cosmetic. `key` and `type` together identify it. */
export async function saveCosmetic(input, { actorId } = {}) {
  const type = String(input.type ?? '').trim();
  const key = String(input.key ?? '').trim().toLowerCase();

  if (!Object.values(COSMETIC_TYPE).includes(type)) {
    throw new BadRequestError('Unknown cosmetic type.', 'BAD_TYPE');
  }
  if (!SLUG.test(key)) {
    throw new BadRequestError('Keys are lowercase letters, numbers and dashes.', 'BAD_KEY');
  }

  const unlockKind = String(input.unlockKind ?? UNLOCK_KIND.FREE);
  if (!Object.values(UNLOCK_KIND).includes(unlockKind)) {
    throw new BadRequestError('Unknown unlock kind.', 'BAD_UNLOCK');
  }

  const patch = {
    type,
    key,
    name: String(input.name ?? '').trim().slice(0, 40) || key,
    unlockKind,
    unlockLevel: 0,
    unlockLeague: null,
    rarity: null,
    price: null,
    enabled: input.enabled !== false,
    order: Number.isFinite(Number(input.order)) ? Math.round(Number(input.order)) : 0,
  };

  /**
   * A wearable needs a tier, because rarity is what the shop shelves it under
   * and what a chest rolls it into. A title does not have one — it is earned,
   * never bought — so asking for one on a title is rejected rather than
   * quietly stored where nothing will read it.
   */
  if (type !== COSMETIC_TYPE.TITLE) {
    const rarity = String(input.rarity ?? '').trim().toLowerCase();
    if (!RARITIES.includes(rarity)) {
      throw new BadRequestError(`Pick a rarity: ${RARITIES.join(', ')}.`, 'BAD_RARITY');
    }
    patch.rarity = rarity;

    if (unlockKind === UNLOCK_KIND.SHOP) {
      const price = Math.round(Number(input.price));
      if (!Number.isFinite(price) || price < 1 || price > COINS_MAX) {
        throw new BadRequestError('A shop item needs a price in coins.', 'BAD_PRICE');
      }
      patch.price = price;
    }
  } else if (input.rarity) {
    throw new BadRequestError('A title has no rarity — it is earned, not bought.', 'BAD_RARITY');
  }

  if (unlockKind === UNLOCK_KIND.LEVEL) {
    const level = Math.round(Number(input.unlockLevel));
    if (!Number.isFinite(level) || level < 1 || level > progression().accountCurve.length) {
      throw new BadRequestError(
        `Pick a level between 1 and ${progression().accountCurve.length}.`,
        'BAD_UNLOCK_LEVEL',
      );
    }
    patch.unlockLevel = level;
  }

  if (unlockKind === UNLOCK_KIND.LEAGUE) {
    const league = String(input.unlockLeague ?? '').trim().toLowerCase();
    if (!progression().ladder.leagues.some((l) => l.key === league)) {
      throw new BadRequestError('That league does not exist.', 'BAD_UNLOCK_LEAGUE');
    }
    patch.unlockLeague = league;
  }

  // Titles are text; only images carry an image.
  if (type !== COSMETIC_TYPE.TITLE && input.imageUrl !== undefined) {
    patch.imageUrl = input.imageUrl ? String(input.imageUrl).slice(0, 500) : null;
  }

  await Cosmetic.updateOne({ type, key }, { $set: patch }, { upsert: true });
  await commit(actorId);
  return progression().catalogue.find((c) => c.type === type && c.key === key) ?? null;
}

/**
 * Remove a cosmetic.
 *
 * Anyone wearing it keeps wearing it — the key stays in their profile and in
 * `grantedPerks`, and an unknown key resolves as free. Deleting is about
 * withdrawing something from the shelf, not about confiscating it.
 */
/**
 * A chest that still advertises this item, if any.
 *
 * The console promises the server "refuses the combinations that would break —
 * a chest promising an avatar that was just deleted"; it was only ever checked
 * at chest-save time, so deleting from the other side left the chest awarding
 * a key that no catalogue row describes: the winner's `grantedPerks` gains
 * something that appears on no shelf and can never be worn.
 */
async function chestAdvertising(type, key) {
  return Chest.findOne(
    { rewards: { $elemMatch: { type, key } } },
    { key: 1, name: 1 },
  ).lean();
}

export async function deleteCosmetic(type, key, { actorId } = {}) {
  const clean = String(key).toLowerCase();
  const promised = await chestAdvertising(type, clean);
  if (promised) {
    throw new ConflictError(
      `${promised.name} still has this in it. Take it out of the chest first.`,
      'COSMETIC_IN_CHEST',
    );
  }
  const result = await Cosmetic.deleteOne({ type, key: clean });
  if (!result.deletedCount) throw new NotFoundError('No such cosmetic.', 'NOT_FOUND');
  await commit(actorId);
  return { deleted: true };
}

/** Create or update a chest. */
export async function saveChest(input, { actorId } = {}) {
  const key = String(input.key ?? '').trim().toLowerCase();
  if (!SLUG.test(key)) {
    throw new BadRequestError('Keys are lowercase letters, numbers and dashes.', 'BAD_KEY');
  }

  const triggerKind = String(input.triggerKind ?? CHEST_TRIGGER.LEAGUE);
  if (!Object.values(CHEST_TRIGGER).includes(triggerKind)) {
    throw new BadRequestError(
      'A chest opens on a rating, on a league, or on an event.',
      'BAD_TRIGGER',
    );
  }

  /**
   * How often it can be won. An event chest — a Christmas or New Year chest —
   * is by definition a one-off, so it may not be monthly; the two built-in
   * chests are the only monthly ones and they set it themselves.
   */
  const recurrence =
    triggerKind === CHEST_TRIGGER.EVENT
      ? CHEST_RECURRENCE.ONCE
      : CHEST_RECURRENCES.includes(input.recurrence)
        ? input.recurrence
        : CHEST_RECURRENCE.ONCE;

  const patch = {
    key,
    name: String(input.name ?? '').trim().slice(0, 40) || key,
    description: String(input.description ?? '').trim().slice(0, 160),
    triggerKind,
    triggerRating: null,
    triggerLeague: null,
    recurrence,
    enabled: input.enabled !== false,
    order: Number.isFinite(Number(input.order)) ? Math.round(Number(input.order)) : 0,
  };

  // An event chest has nothing to reach — being switched on IS the trigger.
  if (triggerKind === CHEST_TRIGGER.EVENT) {
    // Nothing to validate; both trigger fields stay null.
  } else if (triggerKind === CHEST_TRIGGER.RATING) {
    const rating = Math.round(Number(input.triggerRating));
    if (!Number.isFinite(rating) || rating <= RANKED_FLOOR) {
      throw new BadRequestError(
        `A rating chest has to open above ${RANKED_FLOOR} — everyone starts there.`,
        'BAD_TRIGGER_RATING',
      );
    }
    patch.triggerRating = rating;
  } else {
    const league = String(input.triggerLeague ?? '').trim().toLowerCase();
    if (!progression().ladder.leagues.some((l) => l.key === league)) {
      throw new BadRequestError('That league does not exist.', 'BAD_TRIGGER_LEAGUE');
    }
    patch.triggerLeague = league;
  }

  /**
   * The slots. Opening draws one of them, so the list IS the odds — an operator
   * editing a chest by hand is editing the drop table, and the shape of it is
   * checked here rather than discovered at open time.
   */
  const rewards = Array.isArray(input.rewards) ? input.rewards : [];
  if (!rewards.length) {
    throw new BadRequestError('A chest with nothing in it is a disappointment.', 'EMPTY_CHEST');
  }
  patch.rewards = rewards.map((r) => {
    const type = String(r.type ?? '');

    if (type === 'coins') {
      const amount = Math.round(Number(r.amount));
      if (!Number.isFinite(amount) || amount < 1 || amount > COINS_MAX) {
        throw new BadRequestError('A coin slot needs an amount.', 'BAD_REWARD');
      }
      return { type, key: null, amount, rarity: null, name: `${amount} coins` };
    }

    const rewardKey = String(r.key ?? '').trim().toLowerCase();
    if (!Object.values(COSMETIC_TYPE).includes(type)) {
      throw new BadRequestError('Unknown reward type.', 'BAD_REWARD');
    }
    const item = progression().catalogue.find((c) => c.type === type && c.key === rewardKey);
    if (!item) {
      throw new BadRequestError(`No ${type} called "${rewardKey}".`, 'UNKNOWN_REWARD');
    }
    return { type, key: rewardKey, amount: null, rarity: item.rarity ?? null, name: item.name };
  });

  await Chest.updateOne({ key }, { $set: patch }, { upsert: true });
  await commit(actorId);
  return progression().chests.find((c) => c.key === key) ?? null;
}

/**
 * Remove a chest. Grants already handed out survive — they carry their own
 * copy of what was inside, so an unopened gift stays openable.
 */
export async function deleteChest(key, { actorId } = {}) {
  const result = await Chest.deleteOne({ key: String(key).toLowerCase() });
  if (!result.deletedCount) throw new NotFoundError('No such chest.', 'NOT_FOUND');
  await commit(actorId);
  return { deleted: true };
}

// ── What a level pays (coins-and-cosmetics.md §4.2) ────────────────────────

/**
 * A level with no common left to give pays the middle of the tier instead.
 *
 * Derived from the band rather than typed, so retuning what a common costs
 * retunes what an exhausted collection is worth without anyone remembering to.
 */
const COMMON_MIDPOINT = Math.round(
  (RARITY_META[RARITY.COMMON].from + RARITY_META[RARITY.COMMON].to) / 2,
);

/**
 * Everything crossing from level `before` to level `after` hands over.
 *
 * Four levels in five pay coins and nothing else. That is the deliberate shape
 * of it: the milestone has to be worth arriving at, and it cannot be if the
 * four levels before it each handed over a title and a cosmetic too.
 *
 * The drop is one common the player does not already own, and if they own every
 * one it pays coins instead — a level-up is never allowed to be empty.
 *
 * Pure, and takes `granted` rather than reading it, so the caller can fold the
 * result into the single write that also banks the XP.
 */
export function rewardsForLevels({ catalogue, before, after, granted = [] }) {
  const levels = levelsCrossed(before, after);
  if (!levels.length) return { coins: 0, titles: [], drops: [], levels: [] };

  const owned = new Set(granted);
  const pool = (catalogue ?? DEFAULT_CATALOGUE).filter(
    (c) =>
      c.enabled !== false &&
      c.rarity === RARITY.COMMON &&
      c.type !== COSMETIC_TYPE.TITLE &&
      !owned.has(c.key),
  );

  let coins = 0;
  const titles = [];
  const drops = [];

  for (const level of levels) {
    const milestone = isMilestoneLevel(level);
    coins += milestone ? COIN_AWARD.LEVEL_UP_MILESTONE : COIN_AWARD.LEVEL_UP;
    if (!milestone) continue;

    const title = titleForLevel(catalogue, level);
    if (title) titles.push({ type: title.type, key: title.key, name: title.name, level });

    // Drawn from what is left, and removed from the pool, so two milestones in
    // one match cannot hand over the same avatar twice.
    if (pool.length) {
      const [item] = pool.splice(Math.floor(Math.random() * pool.length), 1);
      drops.push({ type: item.type, key: item.key, name: item.name, rarity: item.rarity, level });
    } else {
      coins += COMMON_MIDPOINT;
    }
  }

  return { coins, titles, drops, levels };
}

// ── The shop (coins-and-cosmetics.md §3.2) ─────────────────────────────────

/**
 * Buy one cosmetic.
 *
 * The whole transaction is a single conditional update: deduct the price and
 * add the key, on the condition that the balance still covers it and the key is
 * not already owned. That condition is the concurrency control — two taps that
 * arrive together cannot both succeed, because the second one no longer matches
 * its own filter. There is no lock, no transaction and no ledger to reconcile.
 *
 * Ownership is checked in the same breath for a reason worth stating: a second
 * purchase of something already owned would be a silent charge for nothing.
 */
export async function buyCosmetic(user, { type, key, expectedPrice = null }) {
  const item = findCosmetic(progression().catalogue, type, String(key ?? '').toLowerCase());

  if (!item || item.enabled === false) {
    throw new NotFoundError('The shop does not stock that.', 'NO_SUCH_ITEM');
  }

  /**
   * The price the player was shown has to be the price they pay.
   *
   * Prices are superadmin-editable, and a shelf is fetched once and then sat
   * on — so a retune between the fetch and the tap silently charged whatever
   * the catalogue said now, with no confirmation and nothing on the screen
   * that said otherwise. Sending the displayed price back turns that into an
   * honest "the price changed" rather than a surprise on the balance.
   */
  if (expectedPrice != null && Number(expectedPrice) !== item.price) {
    throw new ConflictError(
      `${item.name} now costs ${formatCoins(item.price)} coins. Have another look before you buy.`,
      'PRICE_CHANGED',
      { price: item.price },
    );
  }
  if (!isBuyable(item)) {
    // Legendaries are listed so a player can see what exists and where it comes
    // from. Being listed is not being for sale.
    throw new BadRequestError(
      item.unlockKind === UNLOCK_KIND.CHEST
        ? `${item.name} only comes from a chest. Coins cannot buy it.`
        : `${item.name} is not something coins buy.`,
      'NOT_FOR_SALE',
    );
  }
  if ((user.grantedPerks ?? []).includes(item.key)) {
    throw new ConflictError('You already own that.', 'ALREADY_OWNED');
  }

  const result = await User.updateOne(
    { _id: user._id, coins: { $gte: item.price }, grantedPerks: { $ne: item.key } },
    { $inc: { coins: -item.price }, $addToSet: { grantedPerks: item.key } },
  );

  if (!result.modifiedCount) {
    // Either the balance moved under it or another tap got there first. Read
    // back to say which — "not enough coins" and "you already own that" are
    // very different sentences to be shown.
    const fresh = await User.findById(user._id, { coins: 1, grantedPerks: 1 }).lean();
    if ((fresh?.grantedPerks ?? []).includes(item.key)) {
      throw new ConflictError('You already own that.', 'ALREADY_OWNED');
    }
    throw new BadRequestError(
      `${item.name} costs ${formatCoins(item.price)} coins. You have ${formatCoins(fresh?.coins ?? 0)}.`,
      'NOT_ENOUGH_COINS',
    );
  }

  const balance = Math.max(0, (user.coins ?? 0) - item.price);
  logger.info({ userId: String(user._id), key: item.key, price: item.price }, 'cosmetic bought');
  return { item, coins: balance, spent: item.price };
}

/** Tests truncate collections between cases; the cache has to follow. */
export function resetProgressionCache() {
  clearProgressionSnapshot();
}

export { STARTER_AVATARS, STARTER_BANNERS };

/**
 * Perks — what a player owns, and how they came to own it.
 *
 * MIRRORED FILE — identical copy at mobile/src/shared/perks.js.
 *
 * The catalogue is DATA (leagues-and-progression.md §9): a superadmin adds
 * avatars, retunes prices and marks things chest-only, and the server serves
 * the result. What lives here is the *shape* of that data — the rules for
 * reading a catalogue row — plus the seed set that ships with the app, so a
 * fresh install has something to populate the database with and a client has
 * something to draw before its first fetch.
 *
 * **Levels no longer buy cosmetics** (coins-and-cosmetics.md §1). A level pays
 * coins and, every fifth one, a title; every avatar and banner is bought with
 * those coins or drawn from a chest. Nothing does two jobs, which is what lets
 * rarity be about the concept — pizza is common, the Dragon Lord is not — and
 * not about where an item happened to sit on an old climb.
 *
 * Ownership is therefore WRITTEN DOWN rather than derived. That is the one real
 * change to the model: a level can be recomputed from XP, but a purchase has to
 * be remembered, so `grantedPerks` went from a migration footnote to the record
 * of what a player owns. It is append-only for the same reason XP never falls —
 * a thing bought must never become un-bought.
 *
 * The `key` of an avatar or banner is the same string the profile already
 * stores (`mimo:avatar/<key>`, `mimo:banner/<key>`), so ownership is a question
 * about a value the player is already wearing — no parallel id space.
 */

import {
  UNLOCK_KIND,
  COSMETIC_TYPE,
  RARITY,
  RARITY_META,
  PRICE_STEPS,
  MILESTONE_LEVEL_STEP,
} from './constants.js';
import { hasReachedLeague } from './league.js';

/**
 * What a new account is given (coins-and-cosmetics.md §6): two avatars and one
 * banner, all common, so the first thing a player does in the shop is buy
 * something rather than discover they already own the shelf.
 *
 * A girl-and-boy starter pair was asked for and is not possible yet — the art
 * is food, flowers, animals and archetypes, with no human faces. This set is
 * data, so it becomes a one-line change the day that art exists.
 */
export const STARTER_AVATARS = ['rose', 'sunflower'];
export const STARTER_BANNERS = ['grape-dots'];

/**
 * The shipped catalogue, tier by tier.
 *
 * Written as tables rather than as two hundred factory calls because the
 * grouping IS the data: an item's rarity is which list it is in, and a row that
 * could disagree with its own heading is a bug waiting to be typed.
 */
const AVATARS = {
  // 50 — common
  common: [
    ['pizza', 'Pizza'], ['burger', 'Burger'], ['sushi', 'Sushi'], ['donut', 'Donut'],
    ['icecream', 'Icecream'], ['coffee', 'Coffee'], ['cupcake', 'Cupcake'],
    ['taco', 'Taco'], ['ramen', 'Ramen'], ['fries', 'Fries'], ['hotdog', 'Hotdog'],
    ['pretzel', 'Pretzel'], ['avocado', 'Avocado'], ['watermelon', 'Watermelon'],
    ['strawberry', 'Strawberry'], ['banana', 'Banana'], ['egg', 'Egg'], ['boba', 'Boba'],
    ['popcorn', 'Popcorn'], ['cherry', 'Cherry'], ['rose', 'Rose'],
    ['sunflower', 'Sunflower'], ['daisy', 'Daisy'], ['tulip', 'Tulip'],
    ['lotus', 'Lotus'], ['blossom', 'Blossom'], ['iris', 'Iris'], ['poppy', 'Poppy'],
    ['orchid', 'Orchid'], ['dahlia', 'Dahlia'], ['peony', 'Peony'],
    ['marigold', 'Marigold'], ['panda', 'Panda'], ['fox', 'Fox'], ['frog', 'Frog'],
    ['owl', 'Owl'], ['cat', 'Cat'], ['penguin', 'Penguin'], ['bear', 'Bear'],
    ['dog', 'Dog'], ['rabbit', 'Rabbit'], ['pig', 'Pig'], ['bee', 'Bee'],
    ['mouse', 'Mouse'], ['hamster', 'Hamster'], ['sheep', 'Sheep'],
    ['hedgehog', 'Hedgehog'], ['turtle', 'Turtle'], ['koala', 'Koala'],
    ['squirrel', 'Squirrel'],
  ],
  // 50 — uncommon
  uncommon: [
    ['jasmine', 'Jasmine'], ['camellia', 'Camellia'], ['zinnia', 'Zinnia'],
    ['aster', 'Aster'], ['violet', 'Violet'], ['freesia', 'Freesia'],
    ['hibiscus', 'Hibiscus'], ['magnolia', 'Magnolia'], ['tiger', 'Tiger'],
    ['lion', 'Lion'], ['wolf', 'Wolf'], ['deer', 'Deer'], ['monkey', 'Monkey'],
    ['whale', 'Whale'], ['shark', 'Shark'], ['octopus', 'Octopus'], ['crab', 'Crab'],
    ['dino', 'Dino'], ['unicorn', 'Unicorn'], ['otter', 'Otter'], ['lynx', 'Lynx'],
    ['badger', 'Badger'], ['raccoon', 'Raccoon'], ['goat', 'Goat'], ['cow', 'Cow'],
    ['horse', 'Horse'], ['zebra', 'Zebra'], ['giraffe', 'Giraffe'],
    ['elephant', 'Elephant'], ['rhino', 'Rhino'], ['hippo', 'Hippo'], ['camel', 'Camel'],
    ['llama', 'Llama'], ['sloth', 'Sloth'], ['chef', 'Chef'], ['doctor', 'Doctor'],
    ['scientist', 'Scientist'], ['detective', 'Detective'], ['boxer', 'Boxer'],
    ['racer', 'Racer'], ['dj', 'DJ'], ['sailor', 'Sailor'], ['pilot', 'Pilot'],
    ['farmer', 'Farmer'], ['firefighter', 'Firefighter'], ['police', 'Police'],
    ['soldier', 'Soldier'], ['nurse', 'Nurse'], ['mechanic', 'Mechanic'],
    ['barista', 'Barista'],
  ],
  // 30 — rare
  rare: [
    ['ninja', 'Ninja'], ['pirate', 'Pirate'], ['samurai', 'Samurai'],
    ['viking', 'Viking'], ['knight', 'Knight'], ['wizard', 'Wizard'], ['monk', 'Monk'],
    ['cowboy', 'Cowboy'], ['astronaut', 'Astronaut'], ['robot', 'Robot'],
    ['cyborg', 'Cyborg'], ['alien', 'Alien'], ['gladiator', 'Gladiator'],
    ['vampire', 'Vampire'], ['mummy', 'Mummy'], ['zombie', 'Zombie'], ['yeti', 'Yeti'],
    ['jester', 'Jester'], ['punk', 'Punk'], ['agent', 'Agent'], ['skull', 'Skull'],
    ['demon', 'Demon'], ['angel', 'Angel'], ['pharaoh', 'Pharaoh'], ['dragon', 'Dragon'],
    ['witch', 'Witch'], ['assassin', 'Assassin'], ['android', 'Android'],
    ['superhero', 'Superhero'], ['villain', 'Villain'],
  ],
  // 20 — legendary
  legendary: [
    ['cyber-oni', 'Cyber Oni'], ['neon-runner', 'Neon Runner'],
    ['sun-deity', 'Sun Deity'], ['moon-deity', 'Moon Deity'],
    ['shadow-blade', 'Shadow Blade'], ['void-stalker', 'Void Stalker'],
    ['dragon-lord', 'Dragon Lord'], ['scale-rider', 'Scale Rider'],
    ['phoenix-guard', 'Phoenix Guard'], ['griffin-ward', 'Griffin Ward'],
    ['emperor', 'Emperor'], ['maharaja', 'Maharaja'], ['brass-captain', 'Brass Captain'],
    ['gear-baron', 'Gear Baron'], ['archmage', 'Archmage'],
    ['rune-weaver', 'Rune Weaver'], ['star-admiral', 'Star Admiral'],
    ['nova-captain', 'Nova Captain'], ['demon-shogun', 'Demon Shogun'],
    ['oni-daimyo', 'Oni Daimyo'],
  ],
};

const BANNERS = {
  // 20 — common
  common: [
    ['amber-confetti', 'Amber Confetti'], ['amber-diamonds', 'Amber Diamonds'],
    ['berry-stripes', 'Berry'], ['cocoa-arcs', 'Cocoa Arcs'],
    ['cocoa-scales', 'Cocoa Scales'], ['coral-chevrons', 'Coral Chevrons'],
    ['coral-peaks', 'Coral Peaks'], ['coral-stripes', 'Coral Stripes'],
    ['forest-rings', 'Forest'], ['gold-tri', 'Gold'], ['grape-dots', 'Grape Dots'],
    ['indigo-dots', 'Indigo Dots'], ['indigo-stripes', 'Indigo Stripes'],
    ['ink-bars', 'Ink Bars'], ['ink-confetti', 'Ink Confetti'],
    ['lagoon-peaks', 'Lagoon Peaks'], ['lagoon-rings', 'Lagoon Rings'],
    ['midnight-peaks', 'Midnight'], ['mint-grid', 'Mint Grid'],
    ['mint-waves', 'Mint Waves'],
  ],
  // 15 — uncommon
  uncommon: [
    ['moss-dots', 'Moss Dots'], ['moss-scales', 'Moss Scales'],
    ['night-dots', 'Night Dots'], ['olive-arcs', 'Olive Arcs'],
    ['olive-bars', 'Olive Bars'], ['pine-stripes', 'Pine Stripes'],
    ['pine-tri', 'Pine Tri'], ['plum-rings', 'Plum Rings'], ['plum-tri', 'Plum Tri'],
    ['rose-rings', 'Rose Rings'], ['rose-tri', 'Rose Tri'], ['rust-grid', 'Rust Grid'],
    ['rust-waves', 'Rust Waves'], ['sand-dots', 'Sand Dots'],
    ['sand-stripes', 'Sand Stripes'],
  ],
  // 8 — rare
  rare: [
    ['sky-diamonds', 'Sky Diamonds'], ['slate-diamonds', 'Slate Diamonds'],
    ['slate-waves', 'Slate Waves'], ['steel-chevrons', 'Steel Chevrons'],
    ['steel-grid', 'Steel Grid'], ['teal-tri', 'Teal'],
    ['wine-chevrons', 'Wine Chevrons'], ['wine-peaks', 'Wine Peaks'],
  ],
  // 7 — legendary
  legendary: [
    ['neon-grid', 'Neon Grid'], ['cosmic-veil', 'Cosmic Veil'],
    ['void-rift', 'Void Rift'], ['dragon-hide', 'Dragon Hide'],
    ['phoenix-fire', 'Phoenix Fire'], ['royal-crest', 'Royal Crest'],
    ['brass-works', 'Brass Works'],
  ],
};

/**
 * Twenty titles, one every fifth level, at 5, 10, 15 … 100.
 *
 * Fourteen of these existed before at levels that did not line up with fives
 * (2, 4, 6, 8, 10, 13, 16, 20, 25 … 50). They keep their order and their names
 * — somebody is wearing them — and simply move onto the new ladder; six more
 * were written to reach twenty.
 */
const TITLES = [
  ['rookie', 'Rookie'], ['regular', 'Regular'], ['quick-draw', 'Quick Draw'],
  ['contender', 'Contender'], ['sharpshooter', 'Sharpshooter'], ['bookworm', 'Bookworm'],
  ['giant-slayer', 'Giant Slayer'], ['veteran', 'Veteran'], ['relentless', 'Relentless'],
  ['scholar', 'Scholar'], ['unshaken', 'Unshaken'], ['prodigy', 'Prodigy'],
  ['legend', 'Legend'], ['grandmaster', 'Grandmaster'], ['titan', 'Titan'],
  ['virtuoso', 'Virtuoso'], ['luminary', 'Luminary'], ['paragon', 'Paragon'],
  ['ascendant', 'Ascendant'], ['immortal', 'Immortal'],
];

// ── Building the catalogue ─────────────────────────────────────────────────

const STARTERS = new Set([
  ...STARTER_AVATARS.map((k) => `${COSMETIC_TYPE.AVATAR}/${k}`),
  ...STARTER_BANNERS.map((k) => `${COSMETIC_TYPE.BANNER}/${k}`),
]);

/**
 * What an item costs, from its tier and its position in it.
 *
 * A tier's items are spread evenly across its price band in `PRICE_STEPS`
 * steps, so every shelf has a cheap end and a dear end rather than fifty
 * identical price tags. It is computed rather than typed per row because a
 * hand-written price is a number somebody has to keep in step with the band it
 * belongs to — and eventually will not.
 *
 * Legendary has no band and returns null: it is chest-only, and a price on it
 * would be an offer the shop cannot honour.
 */
export function priceFor(rarity, indexInTier = 0, tierSize = 1) {
  const band = RARITY_META[rarity];
  if (!band || band.from == null) return null;
  const steps = Math.max(1, PRICE_STEPS - 1);
  const bucket = tierSize <= 1 ? 0 : Math.floor((indexInTier / tierSize) * PRICE_STEPS);
  return Math.round(band.from + Math.min(steps, bucket) * ((band.to - band.from) / steps));
}

/**
 * How a wearable is obtained, from its tier alone.
 *
 * Legendary is never for sale — that is the entire proposition of the second
 * chest — and the starter set is free. Everything else is bought.
 */
function unlockKindFor(type, key, rarity) {
  if (STARTERS.has(`${type}/${key}`)) return UNLOCK_KIND.FREE;
  if (rarity === RARITY.LEGENDARY) return UNLOCK_KIND.CHEST;
  return UNLOCK_KIND.SHOP;
}

function buildCatalogue() {
  const rows = [];
  const push = (row) => rows.push({ ...row, order: rows.length });

  for (const [type, table] of [
    [COSMETIC_TYPE.AVATAR, AVATARS],
    [COSMETIC_TYPE.BANNER, BANNERS],
  ]) {
    for (const rarity of [RARITY.COMMON, RARITY.UNCOMMON, RARITY.RARE, RARITY.LEGENDARY]) {
      const tier = table[rarity];
      tier.forEach(([key, name], i) => {
        const unlockKind = unlockKindFor(type, key, rarity);
        push({
          type,
          key,
          name,
          rarity,
          unlockKind,
          /** Free items still carry their tier price: it is what they are worth, not what they cost. */
          price: priceFor(rarity, i, tier.length),
          unlockLevel: 0,
          unlockLeague: null,
        });
      });
    }
  }

  TITLES.forEach(([key, name], i) => {
    push({
      type: COSMETIC_TYPE.TITLE,
      key,
      name,
      /** A title is earned, never bought, so it sits outside the rarity ladder. */
      rarity: null,
      price: null,
      unlockKind: UNLOCK_KIND.LEVEL,
      unlockLevel: (i + 1) * MILESTONE_LEVEL_STEP,
      unlockLeague: null,
    });
  });

  // The two titles that are not level rewards. Standing earns one; the top
  // chest earns the other, and neither can be reached by playing long enough.
  push({
    type: COSMETIC_TYPE.TITLE,
    key: 'untouchable',
    name: 'Untouchable',
    rarity: null,
    price: null,
    unlockKind: UNLOCK_KIND.LEAGUE,
    unlockLevel: 0,
    unlockLeague: 'black',
  });
  push({
    type: COSMETIC_TYPE.TITLE,
    key: 'trailblazer',
    name: 'Trailblazer',
    rarity: null,
    price: null,
    unlockKind: UNLOCK_KIND.CHEST,
    unlockLevel: 0,
    unlockLeague: null,
  });

  return rows;
}

/** The seed catalogue: 150 avatars, 50 banners, 22 titles. */
export const DEFAULT_CATALOGUE = buildCatalogue();

/** Granted the first time a Legendary Chest is opened. */
export const LEGENDARY_CHEST_TITLE = 'trailblazer';

// ── Reading a row ──────────────────────────────────────────────────────────

/** 1750 → "1,750". Written out rather than left to Intl, which Hermes may lack. */
export function formatCoins(n) {
  return String(Math.max(0, Math.round(n ?? 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The catalogue row for a key, or null when nothing describes it. */
export function findCosmetic(catalogue, type, key) {
  if (!key) return null;
  return (catalogue ?? DEFAULT_CATALOGUE).find((c) => c.type === type && c.key === key) ?? null;
}

/**
 * Does this player own this catalogue row?
 *
 * `granted` is checked first throughout, and after the shop it is checked for
 * almost everything: a bought avatar, a chest drop and a grandfathered unlock
 * are all the same fact — this key is theirs, permanently, whatever the ladder
 * says today. Only titles and the free set are still derived.
 */
export function ownsCosmetic(item, ctx = {}) {
  // Nothing describes it, so nothing gates it — an uploaded image belongs to
  // whoever set it, and enumerating those here is not possible.
  if (!item) return true;

  const { level = 1, rankedRating, granted = [], ladder } = ctx;
  if (granted.includes(item.key)) return true;

  switch (item.unlockKind) {
    case UNLOCK_KIND.FREE:
      return true;
    case UNLOCK_KIND.LEVEL:
      return Math.floor(level ?? 1) >= (item.unlockLevel ?? 0);
    case UNLOCK_KIND.LEAGUE:
      return hasReachedLeague(rankedRating, item.unlockLeague, ladder);
    case UNLOCK_KIND.SHOP:
    case UNLOCK_KIND.CHEST:
      // Buying and opening both write the key into `granted`, checked above.
      return false;
    default:
      return true;
  }
}

/** How a locked row reads on the shelf: "1,750 coins", "Level 20", "From a chest". */
export function unlockRequirement(item) {
  if (!item) return null;
  switch (item.unlockKind) {
    case UNLOCK_KIND.SHOP:
      return item.price != null ? `${formatCoins(item.price)} coins` : 'In the shop';
    case UNLOCK_KIND.LEVEL:
      return `Level ${item.unlockLevel}`;
    case UNLOCK_KIND.LEAGUE:
      return `${String(item.unlockLeague ?? '').replace(/^./, (c) => c.toUpperCase())} league`;
    case UNLOCK_KIND.CHEST:
      return 'From a chest';
    default:
      return null;
  }
}

/** How each kind of perk reads in a sentence: "Reach level 10 to …". */
const WEARING = {
  title: (name) => `wear ${name}`,
  avatar: (name) => `use the ${name} avatar`,
  banner: (name) => `use the ${name} banner`,
};

/** The refusal a locked item deserves — the same sentence on both sides. */
export function lockedMessage(item) {
  const wearing = WEARING[item?.type]?.(item?.name) ?? 'use that';
  switch (item?.unlockKind) {
    case UNLOCK_KIND.SHOP:
      return `Buy it for ${formatCoins(item.price)} coins to ${wearing}.`;
    case UNLOCK_KIND.LEVEL:
      return `Reach level ${item.unlockLevel} to ${wearing}.`;
    case UNLOCK_KIND.LEAGUE:
      return `Reach ${unlockRequirement(item)} to ${wearing}.`;
    case UNLOCK_KIND.CHEST:
      return `Open the chest that holds it to ${wearing}.`;
    default:
      return `You have not unlocked that yet.`;
  }
}

/** Is this something coins can buy right now? */
export function isBuyable(item) {
  return item?.unlockKind === UNLOCK_KIND.SHOP && Number.isFinite(item?.price);
}

/**
 * One type's rows with an `owned` flag and its requirement — the shelf.
 *
 * Catalogue order, not owned-first. The shop groups by rarity, and a grid that
 * reshuffles as things are bought is a grid a player cannot learn the shape of.
 */
export function shelfFor(catalogue, type, ctx = {}) {
  return (catalogue ?? DEFAULT_CATALOGUE)
    .filter((c) => c.type === type && c.enabled !== false)
    .map((c) => ({
      ...c,
      owned: ownsCosmetic(c, ctx),
      requirement: unlockRequirement(c),
    }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Every buyable row of one rarity — the pool a chest rolls from. */
export function cosmeticsOfRarity(catalogue, rarity, types = [COSMETIC_TYPE.AVATAR, COSMETIC_TYPE.BANNER]) {
  return (catalogue ?? DEFAULT_CATALOGUE).filter(
    (c) => c.enabled !== false && c.rarity === rarity && types.includes(c.type),
  );
}

/** Exactly what crossing from account level `before` to `after` hands over. */
export function unlockedBetween(catalogue, before, after) {
  const from = Math.max(1, Math.floor(before ?? 1));
  const to = Math.max(1, Math.floor(after ?? 1));
  if (to <= from) return [];
  return (catalogue ?? DEFAULT_CATALOGUE).filter(
    (c) =>
      c.enabled !== false &&
      c.unlockKind === UNLOCK_KIND.LEVEL &&
      c.unlockLevel > from &&
      c.unlockLevel <= to,
  );
}

/** The next thing to aim at, or null at the end of the road. */
export function nextUnlock(catalogue, level) {
  const l = Math.max(1, Math.floor(level ?? 1));
  return (
    (catalogue ?? DEFAULT_CATALOGUE)
      .filter((c) => c.enabled !== false && c.unlockKind === UNLOCK_KIND.LEVEL && c.unlockLevel > l)
      .sort((a, b) => a.unlockLevel - b.unlockLevel)[0] ?? null
  );
}

/** The title a given milestone level hands over, if any. */
export function titleForLevel(catalogue, level) {
  return (
    (catalogue ?? DEFAULT_CATALOGUE).find(
      (c) =>
        c.type === COSMETIC_TYPE.TITLE &&
        c.unlockKind === UNLOCK_KIND.LEVEL &&
        c.unlockLevel === level,
    ) ?? null
  );
}

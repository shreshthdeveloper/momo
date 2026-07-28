import { RARITY, RARITY_META, RARITIES } from '../shared/constants.js';
import { colors } from '../theme/index.js';

/**
 * Rarity, as the app draws it.
 *
 * The names, the colours and the price bands are SERVED — they come down with
 * the rewards payload so a superadmin can retune a tier without a build — and
 * `RARITY_META` in the shared constants is the fallback for a client that has
 * not been told otherwise. What lives here is only the part a server cannot
 * send: the tints derived from each hue, so a tier looks the same on every
 * surface it appears on.
 *
 * ── Why colour is not enough ─────────────────────────────────────────────────
 *
 * A tier is never signalled by colour alone. Every shelf carries the tier's
 * NAME in its header, every locked tile carries a price, and the ring around a
 * tile thickens as the tier rises. That is not decoration: roughly one man in
 * twelve cannot separate the purple from the grey reliably, and "the purple
 * ones are the good ones" is exactly the kind of rule an interface should never
 * ask someone to see.
 *
 * ── Why legendary is gold ────────────────────────────────────────────────────
 *
 * design.md reserves gold for achievement and nothing else — a league badge, a
 * medal, a streak, never a button. A legendary cannot be bought at any price;
 * it comes out of a chest earned by climbing. It is the only tier that is an
 * achievement, so it is the only tier that gets the gold.
 */

/** A hex colour as `rgba(...)` at the given alpha. */
function tint(hex, alpha) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Everything a tier needs to be drawn: its ink, a fill, an edge, and the ring
 * weight that makes the four legible without their colours.
 */
export function rarityTone(rarity, served) {
  const meta = served?.[rarity] ?? RARITY_META[rarity] ?? null;
  const ink = meta?.color ?? colors.inkMuted;
  return {
    key: rarity ?? null,
    name: meta?.name ?? 'Standard',
    ink,
    soft: tint(ink, 0.13),
    edge: tint(ink, 0.4),
    /** 1 for common through 3 for legendary — weight rises with the tier. */
    ring: RING[rarity] ?? 1,
    from: meta?.from ?? null,
    to: meta?.to ?? null,
  };
}

const RING = {
  [RARITY.COMMON]: 1,
  [RARITY.UNCOMMON]: 1.5,
  [RARITY.RARE]: 2,
  [RARITY.LEGENDARY]: 3,
};

/** The tiers, cheapest first — the order every shelf in the app is built in. */
export const RARITY_ORDER = [...RARITIES];

/** 1750 → "1,750". Hermes may lack Intl, so this is written out. */
export function coins(n) {
  return String(Math.max(0, Math.round(n ?? 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** How a tier's shelf introduces itself: "Rare · 4 of 30". */
export function shelfCaption(owned, total) {
  return `${owned} of ${total}`;
}

export { RARITY };

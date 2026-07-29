/**
 * Profile banners — the patterned card behind a player's identity. Same
 * contract as avatars (lib/avatar.js): the server stores one string,
 * `mimo:banner/<name>`, and the client resolves it to a bundled image. The
 * banner is the other half of a player's look — it paints their half of the
 * versus screen and the head of their profile.
 */
const SCHEME = 'mimo:banner/';

/** Names are the wire format — never reorder, only append. */
export const BANNERS = {
  // ── Common ──
  'amber-confetti': require('../../assets/banners/amber-confetti.png'),
  'amber-diamonds': require('../../assets/banners/amber-diamonds.png'),
  'berry-stripes': require('../../assets/banners/berry-stripes.png'),
  'cocoa-arcs': require('../../assets/banners/cocoa-arcs.png'),
  'cocoa-scales': require('../../assets/banners/cocoa-scales.png'),
  'coral-chevrons': require('../../assets/banners/coral-chevrons.png'),
  'coral-peaks': require('../../assets/banners/coral-peaks.png'),
  'coral-stripes': require('../../assets/banners/coral-stripes.png'),
  'forest-rings': require('../../assets/banners/forest-rings.png'),
  'gold-tri': require('../../assets/banners/gold-tri.png'),
  'grape-dots': require('../../assets/banners/grape-dots.png'),
  'indigo-dots': require('../../assets/banners/indigo-dots.png'),
  'indigo-stripes': require('../../assets/banners/indigo-stripes.png'),
  'ink-bars': require('../../assets/banners/ink-bars.png'),
  'ink-confetti': require('../../assets/banners/ink-confetti.png'),
  'lagoon-peaks': require('../../assets/banners/lagoon-peaks.png'),
  'lagoon-rings': require('../../assets/banners/lagoon-rings.png'),
  'midnight-peaks': require('../../assets/banners/midnight-peaks.png'),
  'mint-grid': require('../../assets/banners/mint-grid.png'),
  'mint-waves': require('../../assets/banners/mint-waves.png'),

  // ── Uncommon ──
  'moss-dots': require('../../assets/banners/moss-dots.png'),
  'moss-scales': require('../../assets/banners/moss-scales.png'),
  'night-dots': require('../../assets/banners/night-dots.png'),
  'olive-arcs': require('../../assets/banners/olive-arcs.png'),
  'olive-bars': require('../../assets/banners/olive-bars.png'),
  'pine-stripes': require('../../assets/banners/pine-stripes.png'),
  'pine-tri': require('../../assets/banners/pine-tri.png'),
  'plum-rings': require('../../assets/banners/plum-rings.png'),
  'plum-tri': require('../../assets/banners/plum-tri.png'),
  'rose-rings': require('../../assets/banners/rose-rings.png'),
  'rose-tri': require('../../assets/banners/rose-tri.png'),
  'rust-grid': require('../../assets/banners/rust-grid.png'),
  'rust-waves': require('../../assets/banners/rust-waves.png'),
  'sand-dots': require('../../assets/banners/sand-dots.png'),
  'sand-stripes': require('../../assets/banners/sand-stripes.png'),

  // ── Rare ──
  'sky-diamonds': require('../../assets/banners/sky-diamonds.png'),
  'slate-diamonds': require('../../assets/banners/slate-diamonds.png'),
  'slate-waves': require('../../assets/banners/slate-waves.png'),
  'steel-chevrons': require('../../assets/banners/steel-chevrons.png'),
  'steel-grid': require('../../assets/banners/steel-grid.png'),
  'teal-tri': require('../../assets/banners/teal-tri.png'),
  'wine-chevrons': require('../../assets/banners/wine-chevrons.png'),
  'wine-peaks': require('../../assets/banners/wine-peaks.png'),

  // ── Legendary ──
  'neon-grid': require('../../assets/banners/neon-grid.png'),
  'cosmic-veil': require('../../assets/banners/cosmic-veil.png'),
  'void-rift': require('../../assets/banners/void-rift.png'),
  'dragon-hide': require('../../assets/banners/dragon-hide.png'),
  'phoenix-fire': require('../../assets/banners/phoenix-fire.png'),
  'royal-crest': require('../../assets/banners/royal-crest.png'),
  'brass-works': require('../../assets/banners/brass-works.png'),
};

export const BANNER_NAMES = Object.keys(BANNERS);

/**
 * Banners added by a superadmin after this build shipped, key → image URL.
 *
 * Avatars have had this since uploads existed; banners never did, so an
 * uploaded banner was dropped from the shop shelf, rendered as an empty token
 * in a chest, and — if a player somehow came to be wearing one — fell through
 * to the name-seeded fallback below, which shows everybody an unrelated
 * pattern and looks for all the world like the banner they chose was ignored.
 */
let remoteBanners = {};

export function setRemoteBanners(map) {
  remoteBanners = map ?? {};
}

/** What to draw for a banner key: a bundled asset, or an uploaded image. */
export function bannerSource(name) {
  if (BANNERS[name]) return BANNERS[name];
  if (remoteBanners[name]) return { uri: remoteBanners[name] };
  return null;
}

export function bannerUri(name) {
  return `${SCHEME}${name}`;
}

export function bannerName(value) {
  if (typeof value !== 'string' || !value.startsWith(SCHEME)) return null;
  const name = value.slice(SCHEME.length);
  return BANNERS[name] || remoteBanners[name] ? name : null;
}

/**
 * The image source for a stored banner value: a bundled preset, an uploaded
 * image's URL, or — for a player who never picked — a stable preset derived
 * from their name, so profiles and versus halves always have a backdrop and
 * it is the same backdrop every time.
 */
export function resolveBanner(value, seedName) {
  const name = bannerName(value);
  if (name) return bannerSource(name);
  if (typeof value === 'string' && /^https?:\/\//.test(value)) return { uri: value };
  const seed = (seedName ?? '').split('').reduce((total, c) => total + c.charCodeAt(0), 0);
  return BANNERS[BANNER_NAMES[seed % BANNER_NAMES.length]];
}

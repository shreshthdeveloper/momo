/**
 * Per-topic mastery, levels 1–50 (prd.md F6.5.2).
 *
 * MIRRORED FILE — identical copy at mobile/src/shared/mastery.js.
 *
 * Mastery is progression, not skill. It is earned from every match regardless
 * of result, which is what makes losing streaks survivable. Rating is the
 * skill signal; these two must never be conflated in the UI.
 */

import {
  MASTERY_MAX_LEVEL,
  XP_PER_MATCH,
  XP_WIN_BONUS,
  XP_DRAW_BONUS,
  XP_PER_CORRECT,
  ACCOUNT_MAX_LEVEL,
  ACCOUNT_XP_COEFFICIENT,
  COIN_AWARD,
  MILESTONE_LEVEL_STEP,
  MATCH_MODE,
} from './constants.js';

/**
 * Total XP required to have reached `level`.
 * Quadratic, so higher levels take progressively longer: level 2 costs 100,
 * level 10 about 2.4k, level 50 about 90k.
 */
export function xpForLevel(level) {
  const l = Math.max(1, Math.min(MASTERY_MAX_LEVEL, Math.floor(level)));
  if (l <= 1) return 0;
  return Math.round(25 * (l - 1) * (l + 2));
}

/** The level a given total XP has earned. */
export function levelForXp(xp) {
  const total = Math.max(0, xp ?? 0);
  let level = 1;
  while (level < MASTERY_MAX_LEVEL && total >= xpForLevel(level + 1)) level += 1;
  return level;
}

/** Progress through the current level, for the mastery bar. */
export function masteryProgress(xp) {
  const level = levelForXp(xp);
  if (level >= MASTERY_MAX_LEVEL) {
    return { level, xpIntoLevel: 0, xpForNextLevel: 0, fraction: 1 };
  }
  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);
  const xpIntoLevel = Math.max(0, (xp ?? 0) - floor);
  const span = ceiling - floor;
  return {
    level,
    xpIntoLevel,
    xpForNextLevel: span,
    fraction: span > 0 ? Math.min(1, xpIntoLevel / span) : 1,
  };
}

/**
 * XP earned from one match. Participation is the bulk of it — showing up
 * matters more than winning.
 * @param {object} input
 * @param {'won'|'lost'|'draw'} input.verdict
 * @param {number} input.correctCount
 */
export function xpForMatch({ verdict, correctCount = 0, mode }) {
  let xp = XP_PER_MATCH + correctCount * XP_PER_CORRECT;
  // Quick play carries no stakes, so it carries no spoils either: the result
  // is its own reward (leagues-and-progression.md §1). Playing still counts —
  // otherwise the mode with no risk also has no point.
  if (mode === MATCH_MODE.QUICK) return xp;
  if (verdict === 'won') xp += XP_WIN_BONUS;
  else if (verdict === 'draw') xp += XP_DRAW_BONUS;
  return xp;
}

// ── The account level (leagues-and-progression.md §4) ──────────────────────

/**
 * The account curve is a TABLE, not a formula (leagues-and-progression.md §9).
 *
 * A superadmin edits rows, so rows are what the system stores. This quadratic
 * is only the seed for a fresh install and the fallback a client uses before
 * it has been told otherwise — entry `i` is the total XP required to reach
 * level `i + 1`, so the first entry is always 0.
 */
export const DEFAULT_ACCOUNT_CURVE = Array.from(
  { length: ACCOUNT_MAX_LEVEL },
  (_, i) => ACCOUNT_XP_COEFFICIENT * i * (i + 3),
);

/** A usable curve, whatever the caller passed. */
function curveOf(curve) {
  return Array.isArray(curve) && curve.length > 1 ? curve : DEFAULT_ACCOUNT_CURVE;
}

/**
 * Total XP required to have reached account `level`.
 *
 * @param {number} level
 * @param {number[]} [curve] the configured table; omit for the default.
 */
export function accountXpForLevel(level, curve) {
  const table = curveOf(curve);
  const l = Math.max(1, Math.min(table.length, Math.floor(level)));
  return table[l - 1] ?? 0;
}

/** The account level a given lifetime XP total has earned. */
export function accountLevelForXp(totalXp, curve) {
  const table = curveOf(curve);
  const total = Math.max(0, totalXp ?? 0);
  let level = 1;
  while (level < table.length && total >= table[level]) level += 1;
  return level;
}

/**
 * Progress through the current account level, for the profile bar.
 *
 * `floorLevel` is the level the player has already been seen at. It matters
 * after a curve edit: without it the headline would read "Level 5" (floored)
 * over a bar filling toward level 2 (the new curve), which is two answers to
 * the same question. Measuring the bar against the level actually displayed
 * keeps them one answer — an empty bar, honestly, because the next level now
 * costs more XP than they have.
 */
export function accountProgress(totalXp, curve, floorLevel) {
  const table = curveOf(curve);
  const level = effectiveAccountLevel(totalXp, floorLevel, table);
  if (level >= table.length) {
    return { level, xpIntoLevel: 0, xpForNextLevel: 0, fraction: 1 };
  }
  const floor = accountXpForLevel(level, table);
  const ceiling = accountXpForLevel(level + 1, table);
  const xpIntoLevel = Math.max(0, (totalXp ?? 0) - floor);
  const span = ceiling - floor;
  return {
    level,
    xpIntoLevel,
    xpForNextLevel: span,
    fraction: span > 0 ? Math.min(1, xpIntoLevel / span) : 1,
  };
}

/**
 * The level a player is actually shown.
 *
 * A curve edit recomputes everyone from stored XP, which can put a player
 * below the level they had already reached. `floor` is stamped on them at edit
 * time precisely so that never shows: XP is the currency perks are bought
 * with, and a currency that can fall would make an unlock revocable.
 */
export function effectiveAccountLevel(totalXp, floor, curve) {
  return Math.max(accountLevelForXp(totalXp, curve), Math.max(1, Math.floor(floor ?? 1)));
}

// ── Coins (coins-and-cosmetics.md §3.1) ────────────────────────────────────

/**
 * What one match pays into the balance.
 *
 * Ranked pays on every result, because a currency that only rewards winning
 * punishes exactly the players who most need a reason to play the next match.
 * Quick play pays on a win alone: it carries no stakes and no XP bonus either,
 * so paying it like the ladder would make the ladder pointless. Challenge,
 * practice and contest pay nothing — they are XP-only modes by design, and a
 * challenge is a thing two friends can run all afternoon.
 */
export function coinsForMatch({ verdict, mode }) {
  if (mode === MATCH_MODE.RANKED) {
    if (verdict === 'won') return COIN_AWARD.RANKED_WIN;
    if (verdict === 'draw') return COIN_AWARD.RANKED_DRAW;
    return COIN_AWARD.RANKED_LOSS;
  }
  if (mode === MATCH_MODE.QUICK) return verdict === 'won' ? COIN_AWARD.QUICK_WIN : 0;
  return 0;
}

/** Is this one of the levels that pays a title? */
export function isMilestoneLevel(level) {
  return Number.isFinite(level) && level > 0 && level % MILESTONE_LEVEL_STEP === 0;
}

/**
 * Every level crossed going from `before` to `after`, in order.
 *
 * Levelling twice in one match is rare but real — a long ranked match after a
 * curve edit can do it — and each level crossed has to pay separately, or the
 * player is quietly short-changed for playing well.
 */
export function levelsCrossed(before, after) {
  const from = Math.max(1, Math.floor(before ?? 1));
  const to = Math.max(1, Math.floor(after ?? 1));
  const levels = [];
  for (let l = from + 1; l <= to; l += 1) levels.push(l);
  return levels;
}

/** What crossing those levels pays: 150 each, 300 on every fifth. */
export function coinsForLevels(before, after) {
  return levelsCrossed(before, after).reduce(
    (sum, level) =>
      sum + (isMilestoneLevel(level) ? COIN_AWARD.LEVEL_UP_MILESTONE : COIN_AWARD.LEVEL_UP),
    0,
  );
}

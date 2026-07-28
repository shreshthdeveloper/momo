/**
 * Leagues — Bronze through Black (leagues-and-progression.md §3).
 *
 * MIRRORED FILE — identical copy at mobile/src/shared/league.js.
 *
 * A league is a *band of the ranked rating*, never a ladder of its own. That is
 * the whole design: there is no league state to store, nothing to drift out of
 * sync with the rating, and promotion and demotion need no rules beyond
 * arithmetic. Divisions are 75 points wide, so an even loss (−16) puts a
 * demotion four to five straight losses away.
 *
 * Divisions count DOWN toward the top: you climb III → II → I, then promote.
 * The top league has no divisions — you are in Black or you are not.
 */

import {
  COIN_AWARD,
  LEAGUES,
  LEAGUE_DIVISIONS,
  LEAGUE_DIVISION_WIDTH,
  RANKED_FLOOR,
} from './constants.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

/**
 * The ladder in force. The league floors are superadmin-editable
 * (leagues-and-progression.md §9), so every function here takes an optional
 * ladder; omitting it gives the shipped one, which is both the seed for a
 * fresh install and a client's fallback before its first config fetch.
 *
 * @typedef {{leagues: Array<{key,name,floor,color?}>, divisions?: number, divisionWidth?: number}} Ladder
 */
function ladderOf(ladder) {
  const leagues = Array.isArray(ladder?.leagues) && ladder.leagues.length ? ladder.leagues : LEAGUES;
  return {
    leagues,
    divisions: Math.max(1, Math.min(ROMAN.length, Math.floor(ladder?.divisions ?? LEAGUE_DIVISIONS))),
    divisionWidth: Math.max(1, Math.floor(ladder?.divisionWidth ?? LEAGUE_DIVISION_WIDTH)),
  };
}

/** The league entry a rating falls in, plus the one above it. */
function bandFor(rating, ladder) {
  const { leagues } = ladderOf(ladder);
  const value = Math.max(RANKED_FLOOR, Math.round(rating ?? 0));
  let index = 0;
  for (let i = leagues.length - 1; i >= 0; i -= 1) {
    if (value >= leagues[i].floor) {
      index = i;
      break;
    }
  }
  return { index, league: leagues[index], next: leagues[index + 1] ?? null, value };
}

/**
 * Everything the UI needs about where a rating stands.
 *
 * @returns {{
 *   key: string, name: string, division: number|null, label: string,
 *   tier: number, floor: number, ceiling: number|null,
 *   pointsInto: number, pointsForNext: number|null, fraction: number,
 *   isTop: boolean
 * }}
 */
export function leagueFor(rating, ladder) {
  const { divisions: LEAGUE_DIVISIONS, divisionWidth: LEAGUE_DIVISION_WIDTH } = ladderOf(ladder);
  const { index, league, next, value } = bandFor(rating, ladder);

  // The top league is open-ended: no division, no progress bar to fill.
  if (!next) {
    return {
      key: league.key,
      name: league.name,
      color: league.color ?? null,
      division: null,
      label: league.name,
      tier: index * LEAGUE_DIVISIONS,
      floor: league.floor,
      ceiling: null,
      pointsInto: value - league.floor,
      pointsForNext: null,
      fraction: 1,
      isTop: true,
    };
  }

  // Divisions are measured from the TOP of the league down, so the widest
  // division is always the bottom one — it absorbs the rating floor.
  const fromTop = next.floor - 1 - value;
  const division = Math.min(LEAGUE_DIVISIONS, Math.floor(fromTop / LEAGUE_DIVISION_WIDTH) + 1);
  const divisionCeiling = next.floor - 1 - (division - 1) * LEAGUE_DIVISION_WIDTH;
  const divisionFloor = division === LEAGUE_DIVISIONS
    ? league.floor
    : divisionCeiling - LEAGUE_DIVISION_WIDTH + 1;

  const span = divisionCeiling - divisionFloor + 1;
  const pointsInto = value - divisionFloor;

  return {
    key: league.key,
    name: league.name,
    color: league.color ?? null,
    division,
    label: `${league.name} ${ROMAN[division - 1]}`,
    // A single ascending number, so two standings can be compared with `<`.
    tier: index * LEAGUE_DIVISIONS + (LEAGUE_DIVISIONS - division),
    floor: divisionFloor,
    ceiling: divisionCeiling,
    pointsInto,
    pointsForNext: divisionCeiling + 1 - value,
    fraction: span > 0 ? Math.min(1, Math.max(0, pointsInto / span)) : 0,
    isTop: false,
  };
}

/**
 * How a rating change moved the player's standing — the match result screen
 * stages a promotion differently from an ordinary win.
 *
 * @returns {'promoted' | 'demoted' | 'none'}
 */
export function leagueMovement(ratingBefore, ratingAfter, ladder) {
  const before = leagueFor(ratingBefore, ladder);
  const after = leagueFor(ratingAfter, ladder);
  if (after.tier > before.tier) return 'promoted';
  if (after.tier < before.tier) return 'demoted';
  return 'none';
}

/** True when the two ratings sit in different leagues (not merely divisions). */
export function changedLeague(ratingBefore, ratingAfter, ladder) {
  return leagueFor(ratingBefore, ladder).key !== leagueFor(ratingAfter, ladder).key;
}

/**
 * How far up the ladder a league key sits — 0 for the bottom one.
 *
 * League-gated things ("reach Gold") are satisfied by anything at or above the
 * named league, so both sides need a comparable number rather than a string.
 * An unknown key is treated as unreachable rather than as the bottom, or a
 * renamed league would silently hand out everything gated behind it.
 */
export function leagueRank(key, ladder) {
  const { leagues } = ladderOf(ladder);
  const index = leagues.findIndex((l) => l.key === key);
  return index < 0 ? Number.POSITIVE_INFINITY : index;
}

/** Has a player at `rating` reached the league `key` demands? */
export function hasReachedLeague(rating, key, ladder) {
  return leagueRank(leagueFor(rating, ladder).key, ladder) >= leagueRank(key, ladder);
}

/**
 * What climbing pays (coins-and-cosmetics.md §3.1).
 *
 * A whole league is worth 500 and a division 150. Demotions pay nothing and
 * cost nothing — the rating fell, which is punishment enough, and a currency
 * that could go backwards would make a purchase revocable.
 *
 * Read off `tier`, which is the single ascending number a standing compares by,
 * so a ladder retuned to two divisions or six leagues keeps working without
 * this function knowing anything about the shape of it.
 *
 * @returns {{kind: 'league'|'division', coins: number, league: object}|null}
 */
export function promotionAward(ratingBefore, ratingAfter, ladder) {
  const before = leagueFor(ratingBefore, ladder);
  const after = leagueFor(ratingAfter, ladder);
  if (after.tier <= before.tier) return null;
  const promoted = leagueRank(after.key, ladder) > leagueRank(before.key, ladder);
  return {
    kind: promoted ? 'league' : 'division',
    coins: promoted ? COIN_AWARD.LEAGUE_PROMOTION : COIN_AWARD.DIVISION_PROMOTION,
    league: after,
  };
}

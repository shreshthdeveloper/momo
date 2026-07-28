import {
  leagueFor as bandFor,
  leagueMovement as movementBetween,
  changedLeague as bandChanged,
} from '../shared/league.js';

/**
 * The league ladder, as configured.
 *
 * League names and floors are superadmin-editable (leagues-and-progression.md
 * §9), so the pure functions in `shared/league.js` take a ladder — and every
 * screen in the app would otherwise have to thread one through. This wrapper
 * holds the served ladder in a module and hands it to them, so a call site
 * reads exactly as it did before and still renames itself when an operator
 * renames Gold.
 *
 * It is a display concern only. Where the server has sent a league object —
 * the match result, the profile, a leaderboard row — that object wins, because
 * it was computed by the authority at the moment the rating moved.
 */

let ladder = null;

export function setActiveLadder(next) {
  ladder = next ?? null;
}

export function activeLadder() {
  return ladder;
}

export function leagueFor(rating) {
  return bandFor(rating, ladder);
}

export function leagueMovement(before, after) {
  return movementBetween(before, after, ladder);
}

export function changedLeague(before, after) {
  return bandChanged(before, after, ladder);
}

/** The league one step up, for "230 to Gold" captions. */
export function nextLeagueLabel(league) {
  if (!league || league.isTop) return 'the top';
  const leagues = ladder?.leagues ?? [];
  const index = leagues.findIndex((l) => l.key === league.key);
  return leagues[index + 1]?.name ?? 'the top';
}

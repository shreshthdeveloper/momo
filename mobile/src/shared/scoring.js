/**
 * Scoring — the one calculation both client and server must agree on.
 *
 * MIRRORED FILE — identical copy at mobile/src/shared/scoring.js.
 * See constants.js for why.
 *
 * prd.md F6.4.14: correct answers earn 20 base points plus up to 20 speed
 * bonus, proportional to time remaining. F6.4.15: wrong or timed out is zero.
 * There is no negative marking.
 */

import { BASE_POINTS, SPEED_MAX } from './constants.js';

/**
 * @param {object} input
 * @param {boolean} input.isCorrect
 * @param {number} input.elapsedMs   time from round start to answer receipt
 * @param {number} input.durationMs  the round's time limit
 * @returns {number} 0, or 20–40
 */
export function scoreAnswer({ isCorrect, elapsedMs, durationMs }) {
  if (!isCorrect) return 0;
  const remaining = Math.max(0, durationMs - elapsedMs);
  return BASE_POINTS + Math.round(SPEED_MAX * (remaining / durationMs));
}

/**
 * Elo-facing outcome for a player, from two final scores.
 * prd.md F6.4.17 — higher total wins, equal totals draw.
 * @returns {1 | 0.5 | 0}
 */
export function outcomeFor(myScore, theirScore) {
  if (myScore > theirScore) return 1;
  if (myScore < theirScore) return 0;
  return 0.5;
}

/**
 * The verdict word shown on the result screen. design.md §10 keeps this
 * plain — "Won", not "Congratulations!".
 * @returns {'won' | 'lost' | 'draw'}
 */
export function verdictFor(myScore, theirScore) {
  if (myScore > theirScore) return 'won';
  if (myScore < theirScore) return 'lost';
  return 'draw';
}

/** Accuracy across resolved rounds, 0–1. Unanswered rounds count as wrong. */
export function accuracyOf(rounds) {
  if (!rounds?.length) return 0;
  const correct = rounds.filter((r) => r.isCorrect).length;
  return correct / rounds.length;
}

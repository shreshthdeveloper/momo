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

import { BASE_POINTS, BONUS_ROUND_MULTIPLIER, MAX_ROUND_SCORE, SPEED_MAX } from './constants.js';

/**
 * @param {object} input
 * @param {boolean} input.isCorrect
 * @param {number} input.elapsedMs   time from round start to answer receipt
 * @param {number} input.durationMs  the round's time limit
 * @param {number} [input.multiplier] 2 on the bonus round — see roundMultiplier
 * @returns {number} 0, or 20–40 (40–80 on the bonus round)
 */
export function scoreAnswer({ isCorrect, elapsedMs, durationMs, multiplier = 1 }) {
  if (!isCorrect) return 0;
  const remaining = Math.max(0, durationMs - elapsedMs);
  return (BASE_POINTS + Math.round(SPEED_MAX * (remaining / durationMs))) * multiplier;
}

/**
 * What the round in hand pays per point — 2 on the last round of the match,
 * 1 everywhere else.
 *
 * The bonus round is the closing round rather than a flagged one, so this needs
 * no per-question state: a match of seven rounds doubles round seven, a contest
 * paper of twelve doubles round twelve, and a short match doubles its own last.
 */
export function roundMultiplier(roundIndex, totalRounds) {
  if (!Number.isInteger(roundIndex) || !Number.isInteger(totalRounds) || totalRounds < 1) return 1;
  return roundIndex === totalRounds - 1 ? BONUS_ROUND_MULTIPLIER : 1;
}

/**
 * The most a match of `totalRounds` rounds can score, bonus round included.
 * The score rails and the contest header both draw against this, and both were
 * previously short by one round's worth once the bonus round paid double.
 */
export function maxScoreForRounds(totalRounds) {
  if (!Number.isInteger(totalRounds) || totalRounds < 1) return 0;
  return MAX_ROUND_SCORE * (totalRounds - 1 + BONUS_ROUND_MULTIPLIER);
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

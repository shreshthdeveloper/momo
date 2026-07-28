/**
 * Per-topic Elo rating (tech.md §9.3).
 *
 * MIRRORED FILE — identical copy at mobile/src/shared/elo.js.
 *
 * Ghost matches update the live player only (prd.md F6.7.6).
 * Practice matches update nothing (prd.md §6.3).
 */

import { ELO_K, ELO_FLOOR, ELO_START, OVERALL_RATING_TOPIC_COUNT } from './constants.js';

/** Probability that `a` beats `b`. */
export function expected(a, b) {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/**
 * @param {number} rating
 * @param {number} opponentRating
 * @param {1 | 0.5 | 0} score
 */
export function nextRating(rating, opponentRating, score) {
  const next = rating + ELO_K * (score - expected(rating, opponentRating));
  return Math.max(ELO_FLOOR, Math.round(next));
}

/** Convenience: the signed change rather than the new value. */
export function ratingDelta(rating, opponentRating, score) {
  return nextRating(rating, opponentRating, score) - rating;
}

/**
 * prd.md F6.5.3 — overall rating is the mean of the player's five strongest
 * topic ratings. Fewer than five rated topics averages what exists; none at
 * all returns the starting rating so a new profile does not read as 0.
 */
export function overallRatingFrom(topicRatings) {
  const values = (topicRatings ?? [])
    .map((r) => (typeof r === 'number' ? r : r.rating))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a)
    .slice(0, OVERALL_RATING_TOPIC_COUNT);

  if (!values.length) return ELO_START;
  return Math.round(values.reduce((sum, n) => sum + n, 0) / values.length);
}

/** The rating bucket used to index replays for ghost matching (tech.md §3.9). */
export function ratingBandOf(rating) {
  return Math.floor(rating / 100);
}

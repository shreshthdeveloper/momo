import { User } from '../models/index.js';
import { istDateKey, istYesterdayKey } from '../lib/dates.js';
import { ROUNDS_PER_MATCH } from '../shared/constants.js';

/**
 * The definitions live in `shared/achievements.js` so a client can draw the
 * ones a player has NOT earned. What stays here is the only thing a client must
 * never hold: the rules that decide when one is awarded.
 */
export { ACHIEVEMENTS, ACHIEVEMENT_BY_KEY, achievementShelf } from '../shared/achievements.js';

/**
 * prd.md F6.5.5 — a streak is consecutive calendar days with at least one
 * match, evaluated in IST. Returns the updated streak without saving.
 */
export function advanceStreak(streak, now = new Date()) {
  const today = istDateKey(now);
  const yesterday = istYesterdayKey(now);
  const current = streak ?? { current: 0, longest: 0, lastPlayedOn: null };

  if (current.lastPlayedOn === today) return { ...current, changed: false };

  const next = current.lastPlayedOn === yesterday ? current.current + 1 : 1;
  return {
    current: next,
    longest: Math.max(current.longest ?? 0, next),
    lastPlayedOn: today,
    changed: true,
  };
}

/**
 * Evaluated once per completed match. Cheap by design — one read of the user
 * document that the caller already needed.
 */
export async function evaluateAchievements({
  user,
  verdict,
  correctCount,
  opponentRating,
  ratingBefore,
  level,
  maxSpeedAnswer,
  /**
   * The streak AFTER this match, from `advanceStreak`. The caller has already
   * computed it; reading `user.streak` here instead meant testing the streak as
   * it was BEFORE the match that extended it, so "play on seven consecutive
   * days" never fired on the seventh day — it waited for the eighth.
   */
  streak,
  /**
   * A drill or a self-race — play rather than a match (`UNRECORDED_MODES`).
   *
   * Either can earn the achievements that are about *answering* — fast hands,
   * topic level, the streak — and none of the ones that are about a match.
   *
   * The line is drawn there because neither has an opponent worth beating and
   * neither has a limit on retries. "Perfect" reads "all seven in one match", and a
   * badge that can be ground out alone, or against a recording of yourself on
   * questions you have already seen, is worth nothing to the player who earned it
   * the hard way. The win-based ones exclude themselves via the verdict; this flag
   * is for the two that count differently.
   */
  unrecorded = false,
}) {
  const already = new Set((user.achievements ?? []).map((a) => a.key));
  const earned = [];
  const award = (key) => {
    if (!already.has(key)) earned.push(key);
  };

  /**
   * A win only counts when it was a win over somebody.
   *
   * A self-race legitimately ends in `'won'` — the result screen says "you beat
   * your best", and it should — so every rule below that reads the verdict has to
   * exclude it explicitly. Without this, "First win" is earned by beating a
   * recording of yourself, which is the first thing a new player would do.
   */
  const beatSomebody = verdict === 'won' && !unrecorded;

  if (beatSomebody && (user.matchesWon ?? 0) === 0) award('first_win');
  if (!unrecorded && correctCount === ROUNDS_PER_MATCH) award('perfect_match');
  if (beatSomebody && opponentRating - ratingBefore >= 200) award('giant_slayer');
  if (level >= 10) award('topic_level_10');
  if ((streak?.current ?? user.streak?.current ?? 0) >= 7) award('streak_7');
  // `+ 1` for the match being finalised — an unrecorded mode is not one, and does
  // not increment `matchesPlayed` either, so it must not be counted here.
  if ((user.matchesPlayed ?? 0) + (unrecorded ? 0 : 1) >= 100) award('centurion');
  if (maxSpeedAnswer) award('fast_hands');

  if (!earned.length) return [];
  await User.updateOne(
    { _id: user._id },
    { $push: { achievements: { $each: earned.map((key) => ({ key, earnedAt: new Date() })) } } },
  );
  return earned;
}

/**
 * Achievements (prd.md F6.5.4).
 *
 * MIRRORED FILE — identical copy at mobile/src/shared/achievements.js.
 *
 * The definitions moved here from the service for one reason: **a screen has to
 * be able to draw the ones you have NOT earned.** Until now the server sent
 * only the keys a player had, so the profile could show three badges and had no
 * way to say there were four more or what they were for. A list of things you
 * have with no list of things you could have is not an achievements screen — it
 * is a shelf, and a player who has earned none sees nothing at all and
 * reasonably concludes the feature does not exist.
 *
 * `how` is written as an instruction rather than a description, because that is
 * the only thing a locked row is for: "Win a match" tells you what to do,
 * "Won your first match" tells you what you did.
 *
 * Order is the order they are shown, and it is roughly the order they are
 * earned — the first one lands in the first session.
 */

export const ACHIEVEMENTS = [
  {
    key: 'first_win',
    title: 'First win',
    detail: 'Won your first match.',
    how: 'Win a match.',
    icon: 'check',
  },
  {
    key: 'fast_hands',
    title: 'Fast hands',
    detail: 'Scored a maximum-speed correct answer.',
    how: 'Answer correctly at full speed — the bar barely moves.',
    icon: 'clock',
  },
  {
    key: 'perfect_match',
    title: 'Perfect',
    detail: 'Answered all seven correctly.',
    how: 'Get all seven questions right in one match.',
    icon: 'target',
  },
  {
    key: 'giant_slayer',
    title: 'Giant slayer',
    detail: 'Beat someone rated 200 above you.',
    how: 'Beat an opponent rated 200 points above you.',
    icon: 'bolt',
  },
  {
    key: 'topic_level_10',
    title: 'Level 10',
    detail: 'Reached mastery level 10 in a topic.',
    how: 'Reach level 10 in any one topic.',
    icon: 'ranks',
  },
  {
    key: 'streak_7',
    title: 'Seven days',
    detail: 'Played seven days in a row.',
    how: 'Play at least one match on seven consecutive days.',
    icon: 'calendar',
  },
  {
    key: 'centurion',
    title: '100 matches',
    detail: 'Played 100 matches.',
    how: 'Play 100 matches.',
    icon: 'sparkle',
  },
];

/** Keyed, for the places that hold a key and want the row. */
export const ACHIEVEMENT_BY_KEY = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.key, a]));

/**
 * The whole list with an `earnedAt` on the ones that have been.
 *
 * Built here rather than on each client so both sides agree on the order and on
 * what counts as unknown: a key the app has never heard of (an achievement
 * added after this build shipped) still comes back, described by its key, so it
 * renders as earned rather than silently vanishing.
 */
export function achievementShelf(earned = []) {
  const when = new Map(earned.map((a) => [a.key, a.earnedAt ?? null]));
  const rows = ACHIEVEMENTS.map((a) => ({
    ...a,
    earned: when.has(a.key),
    earnedAt: when.get(a.key) ?? null,
  }));

  for (const [key, earnedAt] of when) {
    if (!ACHIEVEMENT_BY_KEY[key]) {
      rows.push({ key, title: key, detail: '', how: '', icon: 'sparkle', earned: true, earnedAt });
    }
  }
  return rows;
}

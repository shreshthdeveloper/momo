import { colors } from '../theme/index.js';
import { FRIEND_REACTIONS } from '../shared/constants.js';

/**
 * What a notification LOOKS like and where it GOES.
 *
 * Lifted out of the inbox screen the day a second surface needed it: the live
 * banner has to draw the same glyph and land on the same screen as the row it
 * is announcing, and two copies of a switch statement over a dozen event types
 * is two copies that drift the first time one is extended.
 */

/**
 * Which glyph and which hue.
 *
 * A reaction wears the glyph the sender actually chose, so "Priya says GG"
 * arrives with the medal and "Priya wants a rematch" arrives with the bolt —
 * the same marks that were on the buttons they pressed.
 */
export function faceFor(item) {
  if (item.type === 'friend_reaction') {
    const reaction = FRIEND_REACTIONS.find((r) => r.key === item.data?.reaction);
    return { icon: reaction?.icon ?? 'sparkle', tint: colors.gold };
  }
  return FACES[item.type] ?? { icon: 'bell', tint: colors.accent };
}

const FACES = {
  friend_request: { icon: 'friends', tint: colors.optionA },
  friend_accepted: { icon: 'friends', tint: colors.correct },
  challenge: { icon: 'bolt', tint: colors.accent },
  achievement: { icon: 'medal', tint: colors.gold },
  level_up: { icon: 'sparkle', tint: colors.accent },
  contest_open: { icon: 'trophy', tint: colors.gold },
  contest_starting: { icon: 'trophy', tint: colors.gold },
  contest_result: { icon: 'medal', tint: colors.gold },
  assignment_due: { icon: 'book', tint: colors.optionC },
  chest: { icon: 'gift', tint: colors.gold },
  space_approved: { icon: 'check', tint: colors.correct },
  streak_at_risk: { icon: 'flame', tint: colors.gold },
  announcement: { icon: 'bell', tint: colors.accent },
  friend_reaction: { icon: 'sparkle', tint: colors.gold },
  /**
   * A warning from moderation. It fell through to the generic bell, which is
   * the one row in this list where the icon carrying weight actually matters.
   */
  moderation_warning: { icon: 'alert', tint: colors.wrong },
};

/**
 * Where a row goes, or `null` for the ones that are only ever an announcement.
 *
 * A row that navigates nowhere is rendered un-pressable rather than pressable
 * and inert — a tap that visibly does nothing reads as a broken screen.
 */
export function destinationFor(item) {
  const data = item.data ?? {};
  switch (item.type) {
    case 'friend_request':
    case 'challenge':
      // Both are answered on the Friends tab, not on a profile: that is where
      // Accept, Decline and the countdown live.
      return '/friends';
    case 'friend_accepted':
    case 'friend_reaction':
      return data.userId ? `/user/${data.userId}` : '/friends';
    case 'contest_open':
    case 'contest_starting':
    case 'contest_result':
      return data.contestId ? `/contest/${data.contestId}` : null;
    case 'assignment_due':
      // The stake is named on the assignments screen, not implied by a queue
      // default — see the note there.
      return '/assignments';
    case 'chest':
      return '/shop';
    case 'streak_at_risk':
      return '/play';
    case 'achievement':
      return '/achievements';
    /**
     * Edit profile, because what a level hands over is a title and a cosmetic
     * and that is the screen where they get WORN. There is no level-rewards
     * screen to send this to — levels are celebrated on the result screen and
     * nowhere else — so the useful destination is the one place the unlock
     * becomes something you can act on rather than read about.
     */
    case 'level_up':
      return '/customize';
    default:
      return null;
  }
}


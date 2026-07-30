import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Text, Button, ErrorNotice, Sheet } from './ui.jsx';
import Icon from './Icon.jsx';
import { coins as fmtCoins } from '../lib/rarity.js';
import { streakState } from '../lib/streak.js';
import { STREAK_FREEZE_MAX, STREAK_FREEZE_PRICE } from '../shared/constants.js';
import { colors, fonts, layout, space } from '../theme/index.js';

/**
 * The streak, as a flame in the top bar — and everything behind it.
 *
 * ── Why it is on Home ────────────────────────────────────────────────────────
 *
 * The freeze started life as a full-width card in the Shop, between the chests
 * and the shelves, which every visit to the Shop paid for whether or not the
 * player cared about streaks. Moving it to a mark beside the coins fixed the
 * size and left it in the wrong building: the Shop is where you go once you have
 * decided to buy something, and nothing in the Shop tells you a streak is about
 * to lapse.
 *
 * Home is the first screen of the day and the only one that can still do
 * something about it. So the flame lives here, and it is a streak indicator
 * first and a shop door second — which is also why the sheet leads with the
 * streak and offers the freeze underneath rather than the other way round.
 *
 * ── The states ───────────────────────────────────────────────────────────────
 *
 *   burning    a streak is running and today is banked — gold, and it breathes
 *   at risk    a streak is running and today is NOT — gold, and it flickers
 *   cold       no streak — grey, unlit, and completely still
 *
 * The middle state is the whole reason this is on the top bar. "You have a 12
 * day streak" is a statistic; "you have a 12 day streak and you have not played
 * today" is a reason to open the app, and it is the one thing the old card could
 * never say because the Shop had no idea what day it was.
 *
 * A held freeze shows as a blue pip on the corner, deliberately in the same
 * position and at the same size as the bell's unread badge — the top bar has one
 * idiom for "there is something attached to this control" and this is it. Blue
 * rather than gold because a freeze is insurance, not achievement.
 */

/**
 * What the mark and the sheet are agreed to be looking at.
 *
 * Built from `user.streak` — the raw subdocument `toPrivateProfile()` already
 * sends — rather than from a new endpoint field. Two reasons, and the second is
 * the load-bearing one:
 *
 *   1. Home has TWO feeds. The Arena reads `/home` and an organization reads
 *      `/spaces/:id/home`, so anything added to one is missing from the other,
 *      and a flame that vanishes when you switch worlds is worse than no flame.
 *      `user` is the same object on both.
 *   2. It needs no deploy. This is a top bar control; making it wait on a server
 *      release to draw would be a strange dependency for something that has all
 *      its facts already.
 *
 * "Today" comes from `streakState`, which compares stored IST day keys rather
 * than doing date arithmetic — see the note in lib/streak.js. The price and the
 * ceiling come from `/me/stats` when it is what loaded the streak, and from the
 * mirrored shared constants otherwise; those are parity-tested against the
 * server's own copy, so the two cannot quietly disagree about a price.
 */
function readState(streak) {
  const { current, longest, playedToday, atRisk } = streakState(streak);
  return {
    current,
    longest,
    freezes: streak?.freezes ?? 0,
    max: streak?.freezeMax ?? STREAK_FREEZE_MAX,
    price: streak?.freezePrice ?? STREAK_FREEZE_PRICE,
    banked: playedToday,
    lit: current > 0,
    /** Running, and today has not been played yet. The flicker state. */
    atRisk,
  };
}

export function StreakFlame({ streak, onPress }) {
  const s = readState(streak);
  const flicker = useRef(new Animated.Value(0)).current;

  /**
   * Only the at-risk flame moves.
   *
   * A lit streak that is already banked is good news and good news does not need
   * to wave; a cold flame has nothing to say at all. Reserving the motion for the
   * one state that wants something means a moving flame always means the same
   * thing, which is what makes it worth noticing at the top of a screen a player
   * sees several times a day.
   */
  useEffect(() => {
    if (!s.atRisk) {
      flicker.stopAnimation();
      flicker.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flicker, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(flicker, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [s.atRisk, flicker]);

  if (!streak) return null;

  const label = s.lit
    ? `${s.current} day streak. ${s.banked ? 'Today is banked.' : 'Not played today.'}${
        s.freezes ? ` ${s.freezes} freeze held.` : ''
      } Opens your streak.`
    : 'No streak yet. Opens your streak.';

  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.chip,
        s.lit ? styles.chipLit : styles.chipCold,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Animated.View
        style={
          s.atRisk
            ? { opacity: flicker.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) }
            : null
        }
      >
        <Icon name="flame" size={18} color={s.lit ? colors.gold : colors.inkFaint} />
      </Animated.View>

      {/* The count sits ON the flame, not beside it, so the control is the same
          width at 3 days and at 300 and the top bar never reflows. */}
      {s.current > 0 ? (
        <View style={styles.count}>
          <Text allowFontScaling={false} style={styles.countText}>
            {s.current > 99 ? '99+' : s.current}
          </Text>
        </View>
      ) : null}

      {/* Insurance, in the opposite corner from the count so the two never
          collide on a two-digit streak. */}
      {s.freezes > 0 ? <View style={styles.pip} /> : null}
    </Pressable>
  );
}

/**
 * The streak, in full, and the one thing you can buy for it.
 *
 * ── Order is the argument ────────────────────────────────────────────────────
 *
 * The streak first, then whether today is safe, then the freezes. That is the
 * order a player asks the questions in, and it is the reverse of the card this
 * replaces — which led with a purchase and mentioned the streak in passing, so
 * the only screen that talked about streaks was trying to sell something.
 *
 * ── The freeze explains itself or it is a mystery ────────────────────────────
 *
 * A freeze is invisible when it works: you miss a day, nothing happens, and the
 * number you were afraid of losing is still there in the morning. So this says
 * what it costs, what it saves, and — the part everyone forgets — that it spends
 * ITSELF. A player who buys one and then goes looking for the button to use it
 * has been sold a puzzle.
 *
 * Three purchase states, all said out loud: holding the maximum, affordable, and
 * too expensive. The last is the one worth getting right, because a disabled
 * button with no explanation reads as broken.
 */
export function StreakSheet({ visible, streak, balance = 0, busy, error, onBuy, onClose }) {
  if (!streak) return null;
  const s = readState(streak);
  const full = s.freezes >= s.max;
  const after = balance - s.price;
  const affordable = after >= 0;

  return (
    <Sheet
      visible={visible}
      onClose={busy ? undefined : onClose}
      title={s.lit ? `${s.current}-day streak` : 'No streak yet'}
      accessibilityLabel={s.lit ? `${s.current} day streak` : 'No streak yet'}
    >
      <View style={styles.hero}>
        <View style={[styles.glyph, s.lit ? styles.glyphLit : styles.glyphCold]}>
          <Icon name="flame" size={34} color={s.lit ? colors.gold : colors.inkFaint} />
        </View>

        {/* Today, stated plainly. This is the fact the whole mark exists for. */}
        <View style={[styles.today, s.banked ? styles.todayOn : styles.todayOff]}>
          <Icon
            name={s.banked ? 'check' : 'clock'}
            size={13}
            color={s.banked ? colors.correct : colors.optionC}
          />
          <Text variant="label" color={s.banked ? colors.correct : colors.optionC}>
            {s.banked ? 'Today is banked' : 'Not played today'}
          </Text>
        </View>

        <Text variant="body" color={colors.inkMuted} style={styles.body}>
          {!s.lit
            ? 'Play on any two days in a row and a streak starts. It counts calendar days, so one match at any hour keeps it.'
            : s.banked
              ? `Come back tomorrow and it becomes ${s.current + 1}. One match on the day is all it takes.`
              : 'Play one match today and it carries. Miss the day and it goes back to zero — unless a freeze covers you.'}
        </Text>

        {s.longest > 0 ? (
          <Text variant="meta" color={colors.inkFaint}>
            {s.current >= s.longest && s.lit
              ? 'This is your longest run yet.'
              : `Your longest is ${s.longest} days.`}
          </Text>
        ) : null}
      </View>

      {/* ── The freeze. Below the streak, because it is about the streak. */}
      <View style={styles.freeze}>
        <View style={styles.freezeHead}>
          <Text variant="label">Streak freeze</Text>
          <View style={styles.pips}>
            {Array.from({ length: s.max }).map((_, i) => (
              <View key={i} style={[styles.pipSlot, i < s.freezes && styles.pipSlotOn]}>
                <Icon
                  name="flame"
                  size={12}
                  color={i < s.freezes ? colors.optionA : colors.inkFaint}
                />
              </View>
            ))}
          </View>
        </View>
        <Text variant="meta" color={colors.inkFaint}>
          Miss a day and one is spent for you, automatically. It spends itself — there is nothing
          to remember and nothing to press.
        </Text>
      </View>

      <ErrorNotice error={error} />

      {full ? (
        <Button variant="soft" label="You are holding the maximum" disabled onPress={() => {}} />
      ) : affordable ? (
        <Button
          label={`Buy a freeze · ${fmtCoins(s.price)}`}
          loading={busy}
          onPress={onBuy}
        />
      ) : (
        <>
          <Text variant="meta" color={colors.inkMuted} style={styles.short}>
            {fmtCoins(s.price - balance)} short of a freeze. A ranked match pays 50, and a level
            pays 150.
          </Text>
          <Button label={`Not enough coins · ${fmtCoins(s.price)}`} disabled onPress={() => {}} />
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  /** 40 square, matching the bell it sits beside — one shape for the top bar. */
  chip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLit: { backgroundColor: colors.goldSoft },
  chipCold: { backgroundColor: colors.sunken },
  /** Half off the corner, so it reads as attached to the flame rather than as a
   *  second object beside it — the same trick, and position, as the bell's. */
  count: {
    position: 'absolute',
    top: -2,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold,
    borderWidth: 2,
    borderColor: colors.canvas,
  },
  countText: {
    fontFamily: fonts.display,
    fontSize: 10,
    lineHeight: 13,
    color: colors.night,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  pip: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.optionA,
    borderWidth: 2,
    borderColor: colors.canvas,
  },

  // ── The sheet ────────────────────────────────────────────────────────────
  hero: { alignItems: 'center', gap: space.md, marginBottom: space.lg },
  glyph: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  glyphLit: { backgroundColor: colors.goldSoft, borderColor: 'rgba(245, 182, 46, 0.34)' },
  glyphCold: { backgroundColor: colors.sunken, borderColor: colors.hairline },
  today: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 5,
    borderRadius: layout.radiusPill,
    borderWidth: 1,
  },
  todayOn: { backgroundColor: colors.correctSoft, borderColor: 'rgba(58, 178, 122, 0.34)' },
  todayOff: { backgroundColor: colors.amberSoft, borderColor: 'rgba(242, 160, 61, 0.34)' },
  body: { textAlign: 'center', maxWidth: 320 },

  freeze: {
    gap: space.xs,
    padding: layout.cardPadding,
    marginBottom: space.lg,
    borderRadius: layout.radiusInput,
    backgroundColor: colors.sunken,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  freezeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  /** How many you hold out of how many you can — drawn, not described. */
  pips: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pipSlot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  pipSlotOn: {
    backgroundColor: 'rgba(59, 130, 246, 0.14)',
    borderColor: 'rgba(59, 130, 246, 0.5)',
  },
  short: { textAlign: 'center', marginBottom: space.md },
});

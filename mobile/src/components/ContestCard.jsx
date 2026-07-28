import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui.jsx';
import Icon from './Icon.jsx';
import { colors, elevation, layout, space } from '../theme/index.js';

/**
 * prd.md F7.5 / design.md §8.12 — "upcoming or live contests".
 *
 * A contest is a deadline, so the card leads with the clock and nothing else
 * competes with it. A live contest ticks down in real time; that ticking is the
 * only place on the screen where a number moves, which is exactly why it pulls
 * the eye.
 *
 * A live contest is the one card in the app that inverts — an accent fill, dark
 * text. Everything else in the feed is ink on paper, so the one thing with a
 * deadline on it is impossible to scroll past by accident.
 */
export default function ContestCard({ contest, onPress }) {
  const live = contest.phase === 'open';
  const [remaining, setRemaining] = useState(() =>
    live ? contest.msUntilEnd : contest.msUntilStart,
  );

  useEffect(() => {
    setRemaining(live ? contest.msUntilEnd : contest.msUntilStart);
    if (contest.phase === 'closed' || contest.phase === 'cancelled') return undefined;
    // A minute is plenty: the copy is never finer-grained than a minute, so a
    // faster timer would redraw without ever changing what it says.
    const timer = setInterval(() => setRemaining((ms) => Math.max(0, ms - 60_000)), 60_000);
    return () => clearInterval(timer);
  }, [contest.msUntilEnd, contest.msUntilStart, contest.phase, live]);

  const entered = Boolean(contest.yourEntry);
  const hot = live && !entered;
  const status = statusFor(contest, remaining, entered);

  const fg = hot ? colors.onAccent : colors.ink;
  const dim = hot ? 'rgba(255,255,255,0.76)' : colors.inkMuted;
  const faint = hot ? 'rgba(255,255,255,0.62)' : colors.inkFaint;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        hot ? styles.hot : styles.calm,
        !hot ? elevation.raised : null,
        pressed ? { opacity: 0.9 } : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${contest.name}. ${status.label}. ${contest.questionCount} questions.`}
    >
      {hot ? <View style={styles.hotShape} pointerEvents="none" /> : null}

      <View style={styles.head}>
        <Text variant="label" numberOfLines={1} style={{ flex: 1 }} color={fg}>
          {contest.name}
        </Text>
        <View style={[styles.pill, { backgroundColor: status.pill }]}>
          {status.live ? <View style={styles.liveDot} /> : null}
          <Text variant="tiny" color={status.ink} style={styles.status}>
            {status.label}
          </Text>
        </View>
      </View>

      {contest.description ? (
        <Text variant="meta" color={dim} numberOfLines={2} style={styles.body}>
          {contest.description}
        </Text>
      ) : null}

      <View style={styles.meta}>
        <Icon name="book" size={13} color={faint} />
        <Text variant="meta" color={faint}>
          {contest.questionCount} questions
        </Text>
        <Text variant="meta" color={faint}>
          ·
        </Text>
        <Text variant="meta" color={faint} numberOfLines={1} style={{ flex: 1 }}>
          {contest.topics.map((t) => t.name).join(', ')}
        </Text>
      </View>

      {entered && contest.yourEntry.rank ? (
        <Text variant="meta" color={colors.accent} style={{ marginTop: space.sm }}>
          You finished {ordinal(contest.yourEntry.rank)} · {contest.yourEntry.score} points
        </Text>
      ) : entered ? (
        <Text variant="meta" color={dim} style={{ marginTop: space.sm }}>
          You scored {contest.yourEntry.score}
        </Text>
      ) : null}
    </Pressable>
  );
}

function statusFor(contest, remaining, entered) {
  if (contest.phase === 'cancelled') {
    return { label: 'Cancelled', pill: colors.sunken, ink: colors.inkFaint };
  }
  if (contest.phase === 'closed') {
    return { label: entered ? 'Finished' : 'Closed', pill: colors.sunken, ink: colors.inkMuted };
  }
  if (contest.phase === 'upcoming') {
    return { label: `Opens in ${short(remaining)}`, pill: colors.accentSoft, ink: colors.accent };
  }
  if (entered) {
    return { label: 'Played', pill: colors.correctSoft, ink: colors.correct };
  }
  return { label: `${short(remaining)} left`, pill: 'rgba(255,255,255,0.22)', ink: colors.onAccent, live: true };
}

function short(ms) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hr`;
  return `${Math.round(hours / 24)} days`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

const styles = StyleSheet.create({
  card: {
    borderRadius: layout.radiusCard,
    padding: layout.cardPadding,
    marginBottom: layout.cardGap,
    overflow: 'hidden',
  },
  calm: { backgroundColor: colors.canvas },
  /** The only inverted card in the app, and only while a clock is running. */
  hot: { backgroundColor: colors.accent },
  hotShape: {
    position: 'absolute',
    right: -40,
    top: -50,
    width: 150,
    height: 150,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.09)',
    transform: [{ rotate: '30deg' }],
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: layout.radiusPill,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.onAccent },
  status: { fontVariant: ['tabular-nums'] },
  body: { marginTop: space.xs },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.sm },
});

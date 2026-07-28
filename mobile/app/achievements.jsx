import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/lib/api.js';
import { Text, ErrorNotice, Header, ProgressBar, Skeleton } from '../src/components/ui.jsx';
import Icon from '../src/components/Icon.jsx';
import { ACHIEVEMENTS, achievementShelf } from '../src/shared/achievements.js';
import { colors, fonts, layout, space } from '../src/theme/index.js';

/**
 * Achievements — all of them, earned or not.
 *
 * The old surface was a strip of badges on the profile, shown only when at
 * least one had been earned. Two things were wrong with that, and they are the
 * same thing twice: a player with none saw an empty space where the feature
 * should be, and a player with three had no way to learn there were four more
 * or what any of them was for. A list of what you have with no list of what you
 * could have is a shelf, not an achievements screen.
 *
 * So: every achievement, always, in one column, with the earned ones lit and
 * the rest carrying the instruction that gets them. Nothing is hidden, because
 * a secret achievement is a thing nobody plays toward.
 *
 * ── Why the locked rows are not greyed out ───────────────────────────────────
 *
 * Disabled styling says "you cannot have this". Every one of these is
 * available to everybody at any time — the only thing separating them is
 * whether it has happened yet. So a locked row is drawn at full contrast with
 * an outlined mark instead of a filled one, and the difference between the two
 * states is a tick, a colour and a date, never opacity.
 */
export default function Achievements() {
  const router = useRouter();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setStats(await api.get('/me/stats'));
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * The server sends the whole shelf. The built-in list is the fallback for a
   * client that has not been answered yet, so the screen has its real shape
   * from the first frame rather than growing into it.
   */
  const rows = useMemo(() => {
    const sent = stats?.achievements;
    if (Array.isArray(sent) && sent.length && 'earned' in sent[0]) return sent;
    // An older payload, or none yet: keys only.
    return achievementShelf(Array.isArray(sent) ? sent : []);
  }, [stats]);

  const earned = rows.filter((r) => r.earned).length;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Achievements" onBack={() => router.back()} />

      <ErrorNotice error={error} onRetry={load} />

      {!stats && !error ? (
        <View style={styles.content}>
          <Skeleton height={92} radius={layout.radiusCard} />
          {ACHIEVEMENTS.map((a) => (
            <Skeleton key={a.key} height={74} radius={layout.radiusInput} style={styles.wait} />
          ))}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* The headline is a fraction, because a fraction is the only thing
              that answers both questions at once: how many have I got, and how
              many are there. */}
          <View style={styles.summary}>
            <View style={styles.summaryHead}>
              <Text allowFontScaling={false} style={styles.count}>
                {earned}
              </Text>
              <Text variant="title" color={colors.inkMuted} style={styles.of}>
                / {rows.length}
              </Text>
              <View style={{ flex: 1 }} />
              <Text variant="meta" color={colors.inkFaint}>
                {earned === rows.length
                  ? 'All of them.'
                  : `${rows.length - earned} left to earn`}
              </Text>
            </View>
            <ProgressBar value={earned} max={rows.length || 1} height={8} color={colors.gold} />
          </View>

          {rows.map((row) => (
            <Row key={row.key} row={row} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Row({ row }) {
  const done = row.earned;

  return (
    <View
      style={[styles.row, done && styles.rowDone]}
      accessibilityRole="text"
      accessibilityLabel={
        done ? `${row.title}, earned. ${row.detail}` : `${row.title}, not yet earned. ${row.how}`
      }
    >
      <View style={[styles.mark, done ? styles.markDone : styles.markTodo]}>
        <Icon
          name={row.icon ?? 'sparkle'}
          size={19}
          color={done ? colors.gold : colors.inkFaint}
        />
      </View>

      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="label" color={done ? colors.ink : colors.inkMuted} numberOfLines={1}>
          {row.title}
        </Text>
        {/* Past tense once it is yours, an instruction until then — the same
            fact told the only two ways it is ever useful. */}
        <Text variant="meta" color={colors.inkFaint} numberOfLines={2}>
          {done ? row.detail : row.how}
        </Text>
      </View>

      {done ? (
        <View style={styles.tick}>
          <Icon name="check" size={12} color={colors.canvas} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: layout.gutter, paddingBottom: space.xxxl },
  wait: { marginTop: space.md },

  summary: {
    padding: layout.cardPadding,
    borderRadius: layout.radiusCard,
    backgroundColor: colors.goldSoft,
    borderWidth: 1,
    borderColor: 'rgba(245, 182, 46, 0.30)',
    gap: space.md,
    marginBottom: space.lg,
  },
  summaryHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  count: {
    fontFamily: fonts.display,
    fontSize: 38,
    lineHeight: 42,
    color: colors.gold,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  of: { includeFontPadding: false },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 72,
    padding: space.md,
    marginBottom: space.sm,
    borderRadius: layout.radiusInput,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  /** Earned: a gold rim, the same language a chest and a balance already use. */
  rowDone: { borderColor: 'rgba(245, 182, 46, 0.34)', backgroundColor: colors.goldSoft },

  mark: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markDone: {
    backgroundColor: 'rgba(245, 182, 46, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(245, 182, 46, 0.34)',
  },
  /** Not yet: outlined, never dimmed. Every one of these is still available. */
  markTodo: { backgroundColor: colors.sunken, borderWidth: 1, borderColor: colors.hairline },

  tick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

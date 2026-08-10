import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import { useAdminSpace } from '../../src/lib/admin.js';
import {
  Text,
  Avatar,
  CountRow,
  ErrorNotice,
  Header,
  ProgressBar,
  RankTile,
  SectionHeader,
  useScrollBottom,
} from '../../src/components/ui.jsx';
import { ListSkeleton } from '../../src/components/Skeletons.jsx';
import { colors, consoleLayout, layout, space } from '../../src/theme/console.js';

/**
 * What a class actually got wrong.
 *
 * The board is here because a teacher will look for it, but the per-question
 * breakdown below is the reason this screen exists: "nineteen of thirty missed
 * question four" changes what gets taught tomorrow, and a ranking of students
 * does not. The two are in that order deliberately — the board is what everybody
 * expects, and the breakdown is what is worth having.
 */
const bandOf = (accuracy) =>
  accuracy === null ? colors.inkFaint : accuracy >= 70 ? colors.correct : accuracy >= 40 ? colors.optionC : colors.wrong;

export default function SessionReport() {
  const scrollBottom = useScrollBottom();
  const goBack = useConsoleBack();
  const { id } = useLocalSearchParams();
  const adminSpace = useAdminSpace();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!adminSpace || !id) return;
    try {
      setError(null);
      setData(await api.get(`/admin/sessions/${id}`, { spaceId: adminSpace.id }));
    } catch (err) {
      setError(err);
    }
  }, [adminSpace, id]);

  useEffect(() => {
    load();
  }, [load]);

  const rounds = data?.rounds ?? [];
  const weakest = [...rounds]
    .filter((r) => r.answered > 0 && r.accuracy !== null)
    .sort((a, b) => a.accuracy - b.accuracy)[0];

  return (
    <SafeAreaView style={styles.screen} edges={[]}>
      <Header
        title={data?.name ?? 'Session'}
        subtitle={data?.topic?.name ?? adminSpace?.name}
        onBack={goBack}
      />
      <ErrorNotice error={error} onRetry={load} />

      {!data && !error ? (
        <ListSkeleton rows={8} />
      ) : !data ? null : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: scrollBottom }]} showsVerticalScrollIndicator={false}>
          {/* The single most useful sentence on the screen, said first. */}
          {weakest ? (
            <View style={styles.headline}>
              <Text variant="label" color={colors.wrong}>
                Question {weakest.roundIndex + 1} was the hardest
              </Text>
              <Text variant="meta" color={colors.inkMuted}>
                {weakest.answered - weakest.correct} of {weakest.answered} got it wrong.
              </Text>
            </View>
          ) : null}

          <SectionHeader title="Every question" />
          {rounds.map((round) => (
            <View key={round.roundIndex} style={styles.roundRow}>
              <Text variant="meta" color={colors.inkFaint} style={{ width: 26 }}>
                {round.roundIndex + 1}
              </Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <ProgressBar
                  value={round.correct}
                  max={Math.max(1, round.answered)}
                  height={8}
                  color={bandOf(round.accuracy)}
                />
                <Text variant="meta" color={colors.inkFaint}>
                  {round.correct} of {round.answered} correct
                </Text>
              </View>
              <Text variant="label" color={bandOf(round.accuracy)} style={styles.pct}>
                {round.accuracy === null ? '—' : `${round.accuracy}%`}
              </Text>
            </View>
          ))}

          <View style={{ height: space.lg }} />
          <SectionHeader title="The board" />
          <CountRow
            shown={(data.board ?? []).length}
            total={(data.board ?? []).length}
            noun="student"
            meta={`${data.totalRounds} questions`}
          />

          {(data.board ?? []).map((row) => (
            <View key={row.id} style={styles.boardRow}>
              <RankTile rank={row.rank} />
              <Avatar url={row.avatarUrl} name={row.displayName} size={32} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="label" numberOfLines={1}>
                  {row.displayName}
                </Text>
                <Text variant="meta" color={colors.inkFaint}>
                  {row.correctCount} correct of {row.answered} answered
                </Text>
              </View>
              <Text variant="label">{row.score}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: consoleLayout.gutter },
  headline: {
    gap: space.xs,
    padding: layout.cardPadding,
    marginBottom: space.lg,
    borderRadius: layout.radiusInput,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.wrongSoft,
  },
  roundRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52 },
  pct: { width: 46, textAlign: 'right' },
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 52,
    paddingHorizontal: space.sm,
  },
});

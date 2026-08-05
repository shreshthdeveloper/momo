import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/lib/api.js';
import { useAuth } from '../src/state/auth.jsx';
import {
  Text,
  Header,
  ErrorNotice,
  EmptyState,
  ProgressBar,
  Segmented,
  RankTile,
  useScrollBottom,
} from '../src/components/ui.jsx';
import { ListSkeleton } from '../src/components/Skeletons.jsx';
import { colors, layout, space } from '../src/theme/index.js';

/**
 * Class against class.
 *
 * Batches already scoped contests and leaderboards, and were only ever something
 * done TO a student — a bucket an admin put them in. This is what makes one worth
 * belonging to.
 *
 * ── Why the second number is on every row ────────────────────────────────────
 *
 * The ranking figure is points per student **on roll**, so a class of forty
 * cannot beat a class of twelve by size alone. That is fair and it is not
 * self-evident, so participation sits beside it: a class that is behind can see
 * whether the problem is that they are playing badly or that half of them have
 * not played at all. Those are different problems with different fixes, and one
 * mystery number would hide both.
 */
const PERIODS = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All time' },
];

export default function ClassTable() {
  const scrollBottom = useScrollBottom();
  const router = useRouter();
  const { activeSpaceId } = useAuth();
  const [period, setPeriod] = useState('week');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!activeSpaceId) return;
    try {
      setError(null);
      setData(await api.get('/leaderboards/classes', { spaceId: activeSpaceId, period }));
    } catch (err) {
      setError(err);
    }
  }, [activeSpaceId, period]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const rows = data?.rows ?? [];
  // The table's own top score, so the bars are relative to what is achievable
  // here rather than to an absolute nobody has ever hit.
  const top = rows[0]?.perStudent ?? 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Class table" onBack={() => router.back()} />

      {/* A week resets, which is the point — a table nobody can catch up on is a
          table a class stops looking at by Wednesday. */}
      <Segmented options={PERIODS} value={period} onChange={setPeriod} style={styles.tabs} />

      <ErrorNotice error={error} onRetry={load} />

      {!data && !error ? (
        <ListSkeleton rows={6} avatar={false} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="friends"
          title="No classes yet"
          body="Once your organization sorts students into classes, they compete here — every match any of you plays moves your class up the table."
        />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: scrollBottom }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.accent}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
        >
          <Text variant="meta" color={colors.inkFaint} style={styles.note}>
            Ranked by points per student on the register, so a big class has no
            head start.
          </Text>

          {rows.map((row) => (
            <ClassRow
              key={row.batchId}
              row={row}
              top={top}
              mine={data?.you?.batchId === row.batchId}
            />
          ))}

          {/**
           * The pin.
           *
           * Every other board in the product keeps the viewer's own row visible
           * (F6.6.4) and this is no different — except that here it is drawn only
           * when the class is far enough down to have scrolled away, because a
           * duplicate of the row three lines above it is just confusing.
           */}
          {data?.you && data.you.rank > 5 ? (
            <View style={styles.pinned}>
              <Text variant="meta" color={colors.inkFaint} style={styles.pinnedLabel}>
                Your class
              </Text>
              <ClassRow row={data.you} top={top} mine />
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ClassRow({ row, top, mine }) {
  return (
    <View style={[styles.row, mine && styles.rowMine]}>
      <RankTile rank={row.rank} />

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.titleRow}>
          <Text variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
            {row.name}
          </Text>
          {mine ? (
            <Text variant="tiny" color={colors.accent}>
              YOURS
            </Text>
          ) : null}
        </View>

        <ProgressBar
          value={row.perStudent}
          max={top || 1}
          height={6}
          color={mine ? colors.accent : colors.inkFaint}
        />

        {/* Both levers, in words: how hard the class is playing, and how many of
            them are playing at all. */}
        <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
          {row.played} of {row.students} played · {row.matches}{' '}
          {row.matches === 1 ? 'match' : 'matches'}
        </Text>
      </View>

      <View style={styles.figure}>
        <Text variant="label">{row.perStudent}</Text>
        <Text variant="tiny" color={colors.inkFaint}>
          per student
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  tabs: { marginHorizontal: layout.gutter, marginBottom: space.md },
  list: { paddingHorizontal: layout.gutter },
  note: { paddingBottom: space.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.cardPadding,
    paddingVertical: space.md,
    marginBottom: space.sm,
    borderRadius: layout.radiusInput,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
  },
  rowMine: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
  figure: { alignItems: 'flex-end', minWidth: 62 },
  pinned: { marginTop: space.lg },
  pinnedLabel: { paddingBottom: space.xs },
});

import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import { useAdminSpace } from '../../src/lib/admin.js';
import {
  Text,
  Avatar,
  Badge,
  EmptyState,
  ErrorNotice,
  Header,
  RankTile,
} from '../../src/components/ui.jsx';
import { ListSkeleton } from '../../src/components/Skeletons.jsx';
import { colors, consoleLayout, space } from '../../src/theme/index.js';

/**
 * prd.md F8.5.3 — who is winning, and who turned up.
 *
 * The admin standings endpoint returns every entrant including the ones still
 * in progress (the student-facing one honours the contest's visibility
 * setting; this one does not, because running a contest means seeing it). No
 * screen called it, so an admin could schedule a contest, finalise it, and
 * never once see the result.
 */
export default function ContestStandings() {
  const goBack = useConsoleBack();
  const { id, name } = useLocalSearchParams();
  const adminSpace = useAdminSpace();

  const [board, setBoard] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!adminSpace || !id) return;
    try {
      setError(null);
      setBoard(await api.get(`/admin/contests/${id}/standings`, { spaceId: adminSpace.id }));
    } catch (err) {
      setError(err);
    }
  }, [adminSpace, id]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = board?.rows ?? [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header
        title="Standings"
        subtitle={name ? String(name) : adminSpace?.name}
        onBack={goBack}
      />

      <ErrorNotice error={error} onRetry={load} />

      {!board && !error ? (
        <ListSkeleton rows={8} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="trophy"
          title="Nobody has entered yet"
          body="Entries appear here as students play, and the ranking settles when the contest closes."
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
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
          <Text variant="meta" color={colors.inkFaint} style={styles.count}>
            {board.total ?? rows.length} {(board.total ?? rows.length) === 1 ? 'entrant' : 'entrants'}
            {board.maxScore ? `  ·  out of ${board.maxScore}` : ''}
          </Text>

          {rows.map((row) => (
            <View key={row.userId ?? row.rank} style={styles.row}>
              <RankTile rank={row.rank} />
              <Avatar url={row.avatarUrl} name={row.displayName} size={38} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="label" numberOfLines={1}>
                  {row.displayName}
                </Text>
                <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                  {[
                    row.correctCount != null ? `${row.correctCount} correct` : null,
                    row.totalResponseMs != null
                      ? `${(row.totalResponseMs / 1000).toFixed(1)}s`
                      : null,
                  ]
                    .filter(Boolean)
                    .join('  ·  ')}
                </Text>
              </View>
              {row.status && row.status !== 'complete' ? (
                <Badge label="In progress" tone="soft" />
              ) : (
                <Text variant="label" color={colors.accent}>
                  {row.score}
                </Text>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  list: { paddingHorizontal: consoleLayout.gutter, paddingBottom: space.xxxl },
  count: { paddingVertical: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 62,
    paddingVertical: space.sm,
  },
});

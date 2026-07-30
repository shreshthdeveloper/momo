import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/lib/api.js';
import { useAuth } from '../src/state/auth.jsx';
import { Text, Avatar, Badge, EmptyState, ErrorNotice, Header } from '../src/components/ui.jsx';
import { ListSkeleton } from '../src/components/Skeletons.jsx';
import Icon from '../src/components/Icon.jsx';
import { colors, layout, space } from '../src/theme/index.js';

/**
 * Every bracket in this organization, in the order a student cares about them.
 *
 * Sorted by what is asked of you rather than by date: one you can still enter
 * comes first, then one you are playing in, then the finished ones as a record.
 * A list ordered by creation would bury the entry deadline under three
 * tournaments somebody won last term.
 */
const RANK = { open: 0, running: 1, complete: 2 };

export default function Tournaments() {
  const router = useRouter();
  const { activeSpaceId } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!activeSpaceId) return;
    try {
      setError(null);
      const data = await api.get(`/spaces/${activeSpaceId}/tournaments`);
      setRows(
        [...(data.items ?? [])].sort(
          (a, b) => (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3) || b.createdAt.localeCompare(a.createdAt),
        ),
      );
    } catch (err) {
      setError(err);
    }
  }, [activeSpaceId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Tournaments" onBack={() => router.back()} />
      <ErrorNotice error={error} onRetry={load} />

      {!rows && !error ? (
        <ListSkeleton rows={5} avatar={false} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="ranks"
          title="No tournaments yet"
          body="When your organization runs a knockout, it appears here — enter, get seeded, and play your way to the final."
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
          {rows.map((row) => (
            <Pressable
              key={row.id}
              onPress={() => router.push(`/tournament/${row.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${row.name}, ${row.status}`}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.86 }]}
            >
              <View style={styles.icon}>
                <Icon
                  name={row.status === 'complete' ? 'trophy' : 'ranks'}
                  size={20}
                  color={row.status === 'complete' ? colors.gold : colors.accent}
                />
              </View>

              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.titleRow}>
                  <Text variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {row.name}
                  </Text>
                  {row.status === 'open' ? <Badge tone="amber" label="ENTER" /> : null}
                </View>
                <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                  {row.champion
                    ? `Won by ${row.champion.displayName}`
                    : row.status === 'open'
                      ? `${row.entrants.length} of ${row.size} entered · ${row.topic?.name}`
                      : `${row.rounds.at(-1)?.name ?? 'Under way'} · ${row.topic?.name}`}
                </Text>
              </View>

              {row.champion ? (
                <Avatar url={row.champion.avatarUrl} name={row.champion.displayName} size={30} />
              ) : (
                <Icon name="chevronRight" size={16} color={colors.inkFaint} />
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  list: { paddingHorizontal: layout.gutter, paddingBottom: layout.scrollBottom },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 64,
    paddingHorizontal: layout.cardPadding,
    paddingVertical: space.sm,
    marginBottom: space.sm,
    borderRadius: layout.radiusInput,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sunken,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/lib/api.js';
import { Text, Header, ErrorNotice, EmptyState, useScrollBottom } from '../src/components/ui.jsx';
import { ListSkeleton } from '../src/components/Skeletons.jsx';
import { MatchHistoryRow } from '../src/components/ProfileRows.jsx';
import { colors, layout, space } from '../src/theme/index.js';

const PAGE = 30;

/**
 * Every match, newest first.
 *
 * The profile shows five and links here. Before this screen the ten on the
 * profile were all a player could ever reach — `/matches` has always paged, and
 * nothing in the app asked it for a second page.
 *
 * ── The cursor, and why the ids are deduplicated ─────────────────────────────
 *
 * `/matches?before=` filters on the match's `createdAt`, but the summary the
 * endpoint returns exposes `playedAt`, which is `completedAt ?? createdAt` —
 * and `completedAt` is always the later of the two. Passing the last row's
 * `playedAt` back as the cursor therefore asks for `createdAt < completedAt`,
 * which still matches the row we just showed.
 *
 * Rather than widen the API shape for this one screen, the page is filtered
 * against the ids already held and the list is considered finished when a page
 * adds nothing new. That is correct whichever of the two timestamps the server
 * ends up comparing, and it cannot loop.
 */
export default function History() {
  const scrollBottom = useScrollBottom();
  const router = useRouter();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [done, setDone] = useState(false);
  /** Guards against `onEndReached` firing repeatedly during one fetch. */
  const busy = useRef(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.get('/matches', { limit: PAGE });
      const rows = data.items ?? [];
      setItems(rows);
      setDone(rows.length < PAGE);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (busy.current || done || !items?.length) return;
    busy.current = true;
    setLoadingMore(true);
    try {
      const last = items[items.length - 1];
      const data = await api.get('/matches', { limit: PAGE, before: last.playedAt });
      const seen = new Set(items.map((m) => m.id));
      const fresh = (data.items ?? []).filter((m) => !seen.has(m.id));
      if (!fresh.length) setDone(true);
      else setItems((current) => [...current, ...fresh]);
    } catch {
      // A failed page is not a failed screen — what is already listed stays,
      // and the next scroll to the bottom tries again.
      setDone(true);
    } finally {
      busy.current = false;
      setLoadingMore(false);
    }
  }, [items, done]);

  const openReview = useCallback((matchId) => router.push(`/review/${matchId}`), [router]);
  const renderItem = useCallback(
    ({ item }) => <MatchHistoryRow match={item} onPress={openReview} />,
    [openReview],
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Match history" onBack={() => router.back()} />
      <ErrorNotice error={error} onRetry={load} />

      {/* Three states off one value — see the note in my-topics.jsx. A failed
          request left `items` null and both old guards false, and the list read
          `.length` off it. */}
      {items === null ? (
        error ? null : <ListSkeleton rows={8} avatar={false} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="grid"
          title="No matches yet"
          body="Every match you finish lands here, with the score and what it did to your rating."
          actionLabel="Play one"
          onAction={() => router.replace('/play')}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: scrollBottom }]}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.accent}
              onRefresh={async () => {
                setRefreshing(true);
                setDone(false);
                await load();
                setRefreshing(false);
              }}
            />
          }
          ListHeaderComponent={
            <Text variant="tiny" color={colors.inkFaint} style={styles.legend}>
              Score, and the ranked rating it moved
            </Text>
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footer}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : done && items.length > PAGE ? (
              <Text variant="tiny" color={colors.inkFaint} style={styles.end}>
                That is all of them.
              </Text>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  list: { paddingHorizontal: layout.gutter },
  legend: { textAlign: 'right', paddingBottom: space.sm },
  footer: { paddingVertical: space.lg },
  end: { textAlign: 'center', paddingVertical: space.lg },
});

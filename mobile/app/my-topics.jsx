import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/lib/api.js';
import { Text, Header, ErrorNotice, EmptyState } from '../src/components/ui.jsx';
import { ListSkeleton } from '../src/components/Skeletons.jsx';
import { TopicProgressRow } from '../src/components/ProfileRows.jsx';
import { colors, layout, space } from '../src/theme/index.js';

/**
 * Every topic you have played, strongest first.
 *
 * The profile shows five of these and links here for the rest. It used to show
 * whatever the stats endpoint sent — ten — with no way past that and nothing on
 * screen admitting there was a past-that, so a player with thirty topics simply
 * never saw twenty of them.
 *
 * A `FlatList` rather than a mapped ScrollView: this is the one screen whose
 * length is a function of how much somebody has played, so it is the one that
 * has to survive being long.
 */
export default function MyTopics() {
  const router = useRouter();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.get('/me/topics');
      setItems(data.items ?? []);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openTopic = useCallback((topicId) => router.push(`/topic/${topicId}`), [router]);
  const renderItem = useCallback(
    ({ item }) => <TopicProgressRow topic={item} onPress={openTopic} />,
    [openTopic],
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Your topics" onBack={() => router.back()} />
      <ErrorNotice error={error} onRetry={load} />

      {/**
        * Three states off ONE value, not two guards that can both be false.
        *
        * This read `!items && !error` then `items?.length === 0`, which left a
        * fourth case nobody handled: a failed request, where `items` is still
        * null and `error` is set. Both guards were false, so it fell through to
        * the list and read `.length` off null. The `ErrorNotice` above already
        * carries the message and the retry, so a failure draws nothing here.
        */}
      {items === null ? (
        error ? null : <ListSkeleton rows={7} avatar={false} trailing={false} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="book"
          title="No topics yet"
          body="Play a match and the topic you played it on appears here, with the level you reach on it."
          actionLabel="Find a topic"
          onAction={() => router.replace('/play')}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(t) => t.topicId}
          renderItem={renderItem}
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
          ListHeaderComponent={
            <Text variant="meta" color={colors.inkFaint} style={styles.count}>
              {items.length} {items.length === 1 ? 'topic' : 'topics'} · strongest first
            </Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  list: { paddingHorizontal: layout.gutter, paddingBottom: layout.scrollBottom },
  count: { paddingBottom: space.md },
});

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/lib/api.js';
import { useAuth } from '../src/state/auth.jsx';
import {
  Text,
  ErrorNotice,
  EmptyState,
  Header,
  Avatar,
  SearchField,
  Chip,
} from '../src/components/ui.jsx';
import { ListSkeleton } from '../src/components/Skeletons.jsx';
import TopicMedallion from '../src/components/TopicMedallion.jsx';
import Icon from '../src/components/Icon.jsx';
import { colors, layout, space } from '../src/theme/index.js';
import { CHALLENGE_ACCEPT_WINDOW_LABEL } from '../src/shared/constants.js';

/**
 * prd.md §6.3 — pick the topic to challenge a friend on.
 *
 * A challenge is one decision the challenger makes alone, so it gets one
 * screen: which subject. Everything else about the match is already settled —
 * the opponent came from the row that opened this, the stakes are fixed (a
 * challenge is unranked, XP only), and the topic is what the other person is
 * being asked to agree to.
 *
 * The list is the CATALOGUE, not the home feed.
 *
 * It used to read `/home` and flatten its rows, which sounds equivalent and is
 * not: the feed is a curated handful — trending, your interests, a few rows —
 * so most of the catalogue simply never appeared here, and the topic a player
 * actually wanted to be challenged on usually was not on the screen. `/topics`
 * is the real list, it takes a search string, and it is the same endpoint the
 * browse screen already trusts.
 */
export default function ChallengeTopic() {
  const router = useRouter();
  const { userId, name, avatarUrl } = useLocalSearchParams();
  const { activeSpaceId } = useAuth();

  const [topics, setTopics] = useState(null);
  const [categories, setCategories] = useState([]);
  const [categoryId, setCategoryId] = useState(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(null);

  const load = useCallback(
    async (q, catId) => {
      try {
        setError(null);
        const { items } = await api.get('/topics', {
          spaceId: activeSpaceId,
          // The service caps at 60 and the catalogue is smaller than that, so
          // one request is the whole list — no paging to get wrong.
          limit: '60',
          ...(q ? { q } : {}),
          ...(catId ? { categoryId: catId } : {}),
        });
        setTopics(items ?? []);
      } catch (err) {
        setError(err);
      }
    },
    [activeSpaceId],
  );

  useEffect(() => {
    api
      .get('/categories', { spaceId: activeSpaceId })
      .then((r) => setCategories(r.items ?? []))
      .catch(() => setCategories([]));
  }, [activeSpaceId]);

  // Debounced, because every keystroke is a query. 260ms matches the friend
  // search on the previous screen, so the two feel like one control.
  useEffect(() => {
    const t = setTimeout(() => load(query.trim(), categoryId), query ? 260 : 0);
    return () => clearTimeout(t);
  }, [query, categoryId, load]);

  /**
   * Grouped by category when nothing is filtering the list.
   *
   * A flat run of 36 rows has no landmarks in it. Once a search or a category
   * chip is narrowing things the grouping stops earning its keep — the result
   * set is already the answer — so it collapses to a plain list.
   */
  const grouped = useMemo(() => {
    if (!topics || query.trim() || categoryId) return null;
    const order = [];
    const byCategory = new Map();
    for (const t of topics) {
      const key = t.categoryName ?? 'More';
      if (!byCategory.has(key)) {
        byCategory.set(key, { name: key, color: t.categoryColor ?? colors.accent, items: [] });
        order.push(key);
      }
      byCategory.get(key).items.push(t);
    }
    return order.map((k) => byCategory.get(k));
  }, [topics, query, categoryId]);

  /**
   * Sending is the whole screen, so it takes the whole screen's error surface
   * rather than a toast: the two things that realistically fail — you are not
   * friends any more, and you already have one open with them — are both
   * things the player has to read and act on, not glance at.
   */
  const send = async (topic) => {
    if (sending) return;
    setSending(topic.id);
    try {
      setError(null);
      await api.post('/challenges', { userId: String(userId), topicId: topic.id });
      router.back();
    } catch (err) {
      setError(err);
    } finally {
      setSending(null);
    }
  };

  const row = (topic) => (
    <Pressable
      key={topic.id}
      onPress={() => send(topic)}
      disabled={Boolean(sending)}
      accessibilityRole="button"
      accessibilityLabel={`Challenge ${name ?? 'them'} on ${topic.name}`}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
        sending && sending !== topic.id && { opacity: 0.4 },
      ]}
    >
      <TopicMedallion coverUrl={topic.coverUrl} name={topic.name} size={48} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" numberOfLines={1}>
          {topic.name}
        </Text>
        <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
          {topic.viewer ? `Level ${topic.viewer.level}` : 'Not played yet'}
        </Text>
      </View>
      <View style={styles.go}>
        <Icon name={sending === topic.id ? 'clock' : 'arrowRight'} size={16} color={colors.accent} />
      </View>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Challenge" onBack={() => router.back()} />

      <View style={styles.who}>
        <Avatar url={avatarUrl ? String(avatarUrl) : null} name={String(name ?? '')} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="label" numberOfLines={1}>
            {name ?? 'Your friend'}
          </Text>
          <Text variant="meta" color={colors.inkFaint}>
            {`They have ${CHALLENGE_ACCEPT_WINDOW_LABEL} to accept. Nothing is at stake — XP only.`}
          </Text>
        </View>
      </View>

      <View style={styles.controls}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Search topics"
          onClear={() => setQuery('')}
        />
        {categories.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            <Chip label="All" active={!categoryId} onPress={() => setCategoryId(null)} />
            {categories.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                active={categoryId === c.id}
                onPress={() => setCategoryId(categoryId === c.id ? null : c.id)}
              />
            ))}
          </ScrollView>
        ) : null}
      </View>

      <ErrorNotice error={error} onRetry={() => load(query.trim(), categoryId)} />

      {!topics && !error ? (
        <ListSkeleton rows={6} trailing={false} />
      ) : topics?.length === 0 ? (
        <EmptyState
          title={query.trim() ? 'No topics match that' : 'No topics to play yet'}
          icon="book"
          body={
            query.trim()
              ? 'Try a shorter word, or clear the filter.'
              : 'Once a topic is live you can challenge someone on it.'
          }
        />
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {grouped
            ? grouped.map((section) => (
                <View key={section.name} style={styles.section}>
                  <View style={styles.sectionHead}>
                    <View style={[styles.sectionDot, { backgroundColor: section.color }]} />
                    <Text variant="meta" color={colors.inkFaint} style={styles.sectionName}>
                      {section.name.toUpperCase()}
                    </Text>
                  </View>
                  {section.items.map(row)}
                </View>
              ))
            : topics?.map(row)}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: layout.gutter,
    marginTop: space.sm,
    marginBottom: space.md,
    padding: space.md,
    borderRadius: layout.radiusInput,
    backgroundColor: colors.sunken,
  },
  controls: { paddingHorizontal: layout.gutter, gap: space.sm, paddingBottom: space.sm },
  chips: { gap: space.xs, paddingVertical: 2 },
  list: { paddingHorizontal: layout.gutter, paddingBottom: space.xxl },
  section: { marginBottom: space.md },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingBottom: space.xs,
  },
  sectionDot: { width: 7, height: 7, borderRadius: 4 },
  sectionName: { letterSpacing: 0.8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 72,
    paddingHorizontal: space.sm,
    borderRadius: layout.radiusInput,
  },
  rowPressed: { backgroundColor: colors.sunken },
  go: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

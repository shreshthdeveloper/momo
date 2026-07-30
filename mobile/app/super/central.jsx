import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useIsSuperadmin } from '../../src/lib/admin.js';
import {
  ConsoleFooter,
  Text,
  Badge,
  Button,
  SectionHeader,
  Select,
  EmptyState,
  ErrorNotice,
  Stat,
  Header,
  ListCard,
  ListRow,
} from '../../src/components/ui.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import { PUBLIC_SPACE_ID } from '../../src/shared/constants.js';
import { colors, consoleLayout, consoleType, elevation, layout, space } from '../../src/theme/index.js';

/**
 * The Central bank — the Public Arena's content, seen as inventory. The
 * summary says how much exists; the topic list says what is live and what is
 * featured, because featuring is the one editorial lever the operator holds:
 * featured topics lead the home feed for every player.
 *
 * The Public Arena is a real space (a fixed ObjectId, not a null sentinel),
 * and the backend grants superadmins admin scope on it — so the topic list
 * and the question bank ride the existing /admin surface with that spaceId.
 * The /super routes themselves never carry one.
 */
export default function SuperCentral() {
  const router = useRouter();
  const isSuper = useIsSuperadmin();

  const [summary, setSummary] = useState(null);
  const [topics, setTopics] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [, setBusyId] = useState(null);
  const [category, setCategory] = useState(null);

  useEffect(() => {
    if (!isSuper) router.replace('/');
  }, [isSuper, router]);

  const load = useCallback(async () => {
    if (!isSuper) return;
    try {
      setError(null);
      const [s, t] = await Promise.all([
        api.get('/super/central/summary'),
        api.get('/admin/topics', { spaceId: PUBLIC_SPACE_ID }),
      ]);
      setSummary(s);
      setTopics(t.items ?? []);
    } catch (err) {
      setError(err);
    }
  }, [isSuper]);

  // Reloads on focus: the question bank opens from here, and publishing there
  // changes these counts.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const toggleFeature = async (topic) => {
    const next = !topic.featured;
    setBusyId(topic.id);
    // Optimistic: the row flips now and flips back only if the server refuses.
    setTopics((current) => (current ?? []).map((t) => (t.id === topic.id ? { ...t, featured: next } : t)));
    try {
      setError(null);
      await api.post(`/super/central/topics/${topic.id}/feature`, { featured: next });
    } catch (err) {
      setTopics((current) =>
        (current ?? []).map((t) => (t.id === topic.id ? { ...t, featured: topic.featured } : t)),
      );
      setError(err);
    } finally {
      setBusyId(null);
    }
  };

  if (!isSuper) return null;

  const loaded = Boolean(summary && topics);

  const all = topics ?? [];
  const categoryOptions = [
    { value: null, label: 'Every category', meta: `${all.length} topics` },
    ...[...new Set(all.map((t) => t.categoryName).filter(Boolean))].sort().map((name) => ({
      value: name,
      label: name,
      meta: `${all.filter((t) => t.categoryName === name).length} topics`,
    })),
  ];
  const inCategory = category ? all.filter((t) => t.categoryName === category) : all;
  const featured = inCategory.filter((t) => t.featured);
  const rest = inCategory.filter((t) => !t.featured);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Central bank" subtitle="Public Arena topics and featuring" />

      <ErrorNotice error={error} onRetry={load} />

      {!loaded && !error ? (
        <CardsSkeleton count={3} lines={3} bar={false} />
      ) : !loaded ? null : (
        <ScrollView
          contentContainerStyle={styles.content}
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
          {/* ── How much exists. */}
          <View style={[styles.stats, elevation.raised]}>
            <Stat value={summary.categories ?? 0} label="Categories" />
            <View style={styles.statDivider} />
            <Stat value={summary.topics ?? 0} label="Topics" />
            <View style={styles.statDivider} />
            <Stat value={summary.questions ?? 0} label="Questions" />
            <View style={styles.statDivider} />
            <Stat value={summary.publishedQuestions ?? 0} label="Published" />
          </View>

          {/**
           * Thirty-six topics in one unbroken card was the problem with this
           * screen. Every row carried the same four facts in the same grey at
           * the same size — name, category, "50 / 21", matches — plus a green
           * pill and the word "Feature", so nothing was findable and the one
           * thing an operator comes here to do (see what is featured, change
           * it) was indistinguishable from the thirty-five rows around it.
           *
           * Featured topics come FIRST, under a heading, because they are the
           * editorial decision. Everything else follows, filtered by category,
           * with the numbers in a column instead of buried in a sentence.
           */}
          {topics.length === 0 ? (
            <EmptyState icon="book" title="No topics yet" body="Public Arena topics appear here once created." />
          ) : (
            <>
              <View style={styles.filterRow}>
                <Select
                  value={category}
                  options={categoryOptions}
                  onChange={setCategory}
                  placeholder="Every category"
                />
              </View>

              {featured.length > 0 ? (
                <>
                  <SectionHeader title="Featured" style={styles.sectionHead} />
                  <Text variant="meta" color={colors.inkFaint} style={styles.note}>
                    These lead the home feed for every player.
                  </Text>
                  <ListCard>
                    {featured.map((topic, i) => (
                      <TopicRow
                        key={topic.id}
                        topic={topic}
                        last={i === featured.length - 1}
                        onToggle={toggleFeature}
                      />
                    ))}
                  </ListCard>
                </>
              ) : null}

              <SectionHeader
                title={featured.length > 0 ? 'Everything else' : 'Topics'}
                style={styles.sectionHead}
              />
              {rest.length === 0 ? (
                <Text variant="meta" color={colors.inkFaint} style={styles.note}>
                  No other topics in this category.
                </Text>
              ) : (
                <ListCard>
                  {rest.map((topic, i) => (
                    <TopicRow
                      key={topic.id}
                      topic={topic}
                      last={i === rest.length - 1}
                      onToggle={toggleFeature}
                    />
                  ))}
                </ListCard>
              )}
            </>
          )}
        </ScrollView>
      )}

      {loaded ? (
        <ConsoleFooter>
          <Button
            label="Open question bank"
            onPress={() => router.push({ pathname: '/admin/questions', params: { spaceId: PUBLIC_SPACE_ID } })}
          />
        </ConsoleFooter>
      ) : null}
    </SafeAreaView>
  );
}

/**
 * One topic. Name and status on the first line, the numbers in a column on the
 * second, and the featuring lever as a `⋯` like every other row in the console
 * — not a ghost button whose label is the state it is already in ("Featured"
 * on a featured row read as a badge, not as "press to unfeature").
 */
function TopicRow({ topic, last, onToggle }) {
  const isLive = Boolean(topic.readiness?.isLive);
  const published = topic.readiness?.published ?? 0;
  const matches = topic.stats?.matchesPlayed ?? 0;

  return (
    <ListRow
      last={last}
      title={topic.name}
      actions={[
        {
          key: 'feature',
          label: topic.featured ? 'Stop featuring' : 'Feature on the home feed',
          meta: topic.featured ? 'It leads the feed for every player' : undefined,
          icon: topic.featured ? 'close' : 'sparkle',
          onPress: () => onToggle(topic),
        },
      ]}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={styles.nameRow}>
          <Text variant="label" style={{ flexShrink: 1 }} numberOfLines={1}>
            {topic.name}
          </Text>
          {topic.featured ? <Badge label="Featured" tone="soft" /> : null}
          {!isLive ? <Badge label="Not live" tone="amber" /> : null}
        </View>
        <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
          {topic.categoryName ?? 'No category'}
        </Text>
      </View>

      <View style={styles.figures}>
        <Text style={styles.figure} color={isLive ? colors.inkMuted : colors.optionC}>
          {published}
        </Text>
        <Text variant="tiny" color={colors.inkFaint}>
          {matches} played
        </Text>
      </View>

    </ListRow>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  content: { padding: consoleLayout.gutter, paddingTop: space.sm, paddingBottom: space.lg },
  filterRow: { marginTop: space.lg },
  sectionHead: { marginTop: space.xl, marginBottom: space.xs },
  figures: { alignItems: 'flex-end', minWidth: 62 },
  figure: { ...consoleType.figure },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    paddingVertical: space.lg,
  },
  statDivider: { width: 1, height: 30, backgroundColor: colors.hairline },
  note: { marginBottom: space.sm, paddingHorizontal: space.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});

import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
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
import Icon from '../../src/components/Icon.jsx';
import TopicMedallion from '../../src/components/TopicMedallion.jsx';
import { PUBLIC_SPACE_ID } from '../../src/shared/constants.js';
import { colors, consoleLayout, consoleType, elevation, layout, space } from '../../src/theme/console.js';

/**
 * The Central bank — the Public Arena's content, seen as inventory. The
 * summary says how much exists; the topic list says what is live and what is
 * featured, because featuring is the one editorial lever the operator holds:
 * featured topics lead the home feed for every player.
 *
 * The Public Arena is a real space (a fixed ObjectId, not a null sentinel) and
 * the backend grants superadmins admin scope on it, so the four screens that
 * actually EDIT this bank — topics, questions, the review queue, the CSV
 * import — are the organization console's own screens, mounted at `/super/*`
 * and scoped by `useConsoleSpace`. This page is the inventory above them.
 *
 * The /super routes themselves never carry a spaceId: the path is the scope.
 */
/**
 * The three jobs this page is the front of, as tiles rather than as sidebar
 * rows alone: on a phone the sidebar is a drawer, so a screen that names the
 * work is the only place the work is visible without opening it.
 */
const DOORS = [
  { href: '/super/questions', icon: 'book', title: 'Questions', sub: 'Write, edit, publish' },
  { href: '/super/import', icon: 'download', title: 'Import CSV', sub: 'A spreadsheet at a time' },
  { href: '/super/review', icon: 'check', title: 'Review queue', sub: 'What is waiting' },
];

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
    <SafeAreaView style={styles.screen} edges={[]}>
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
          {/* ── How much exists, and the way into each of it. Categories are
                 made inside the topic form, so that figure leads there too. */}
          <View style={[styles.stats, elevation.raised]}>
            <Stat
              value={summary.categories ?? 0}
              label="Categories"
              onPress={() => router.push('/super/topic-edit')}
            />
            <View style={styles.statDivider} />
            <Stat
              value={summary.topics ?? 0}
              label="Topics"
              onPress={() => router.push('/super/topics')}
            />
            <View style={styles.statDivider} />
            <Stat
              value={summary.questions ?? 0}
              label="Questions"
              onPress={() => router.push('/super/questions')}
            />
            <View style={styles.statDivider} />
            <Stat
              value={summary.publishedQuestions ?? 0}
              label="Published"
              onPress={() =>
                router.push({ pathname: '/super/questions', params: { status: 'published' } })
              }
            />
          </View>

          <View style={styles.grid}>
            {DOORS.map((door) => (
              <Pressable
                key={door.href}
                style={({ pressed }) => [styles.tile, pressed && { backgroundColor: colors.canvas }]}
                onPress={() => router.push(door.href)}
                accessibilityRole="button"
                accessibilityLabel={door.title}
              >
                <View style={styles.tileIcon}>
                  <Icon name={door.icon} size={18} color={colors.accent} />
                </View>
                <Text variant="label" numberOfLines={1}>
                  {door.title}
                </Text>
                <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                  {door.sub}
                </Text>
              </Pressable>
            ))}
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
            <EmptyState
              tone="content"
              icon="book"
              title="No topics yet"
              body="A topic is a question bank every player can reach. Make the first one — the category creator is inside the form."
              actionLabel="New topic"
              onAction={() => router.push('/super/topic-edit')}
            />
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
                        router={router}
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
                      router={router}
                    />
                  ))}
                </ListCard>
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* One primary, and it is the thing this list is short of when it is
          short of anything: another topic. The other three doors are tiles
          above, and every one of them is a sidebar row as well. */}
      {loaded && topics.length > 0 ? (
        <ConsoleFooter>
          <Button label="New topic" onPress={() => router.push('/super/topic-edit')} />
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
function TopicRow({ topic, last, onToggle, router }) {
  const isLive = Boolean(topic.readiness?.isLive);
  const published = topic.readiness?.published ?? 0;
  const matches = topic.stats?.matchesPlayed ?? 0;

  return (
    <ListRow
      last={last}
      title={topic.name}
      /**
       * Same rule as the topic list it mirrors: the row opens what is IN the
       * topic, and the `⋯` holds what you can do to it. The published count in
       * the column at the end is the thing being pressed towards.
       */
      onPress={() => router.push({ pathname: '/super/questions', params: { topicId: topic.id } })}
      actions={[
        {
          key: 'feature',
          label: topic.featured ? 'Stop featuring' : 'Feature on the home feed',
          meta: topic.featured ? 'It leads the feed for every player' : undefined,
          icon: topic.featured ? 'close' : 'sparkle',
          onPress: () => onToggle(topic),
        },
        {
          key: 'import',
          label: 'Import questions here',
          meta: 'From a CSV or a spreadsheet',
          icon: 'download',
          onPress: () => router.push({ pathname: '/super/import', params: { topicId: topic.id } }),
        },
        {
          key: 'edit',
          label: 'Edit the topic',
          meta: 'Name, cover, category, status',
          icon: 'edit',
          onPress: () => router.push({ pathname: '/super/topic-edit', params: { topicId: topic.id } }),
        },
      ]}
    >
      {/* The same face the topic wears in the topic list and on a student's
          home screen. This row named the topic and drew nothing, which made
          the Central bank the one place a topic had no identity at all. */}
      <TopicMedallion coverUrl={topic.coverUrl} name={topic.name} size={36} />

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
    // The hairline its two sibling panels already carry. On the night field a
    // card separated on fill alone; on paper white-on-grey is a 1.15:1 step, so
    // the border is what actually draws the edge.
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingVertical: space.lg,
  },
  statDivider: { width: 1, height: 30, backgroundColor: colors.hairline },
  // The same tile grid the two overview screens use — three consoles that look
  // like one product.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: layout.cardGap, marginTop: space.lg },
  tile: {
    flexGrow: 1,
    flexBasis: 150,
    minWidth: 150,
    gap: 2,
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: layout.cardPadding,
  },
  tileIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
    marginBottom: space.sm,
  },
  note: { marginBottom: space.sm, paddingHorizontal: space.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});

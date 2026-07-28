import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useIsSuperadmin } from '../../src/lib/admin.js';
import {
  Text,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Stat,
} from '../../src/components/ui.jsx';
import ConsoleHeader from '../../src/components/ConsoleHeader.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import { MIN_PUBLISHED_QUESTIONS_TO_LIVE, PUBLIC_SPACE_ID } from '../../src/shared/constants.js';
import { colors, elevation, layout, space } from '../../src/theme/index.js';

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
  const [busyId, setBusyId] = useState(null);

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

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ConsoleHeader title="Central bank" subtitle="Public Arena topics and featuring" />

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

          <Text variant="meta" color={colors.inkFaint} style={styles.note}>
            Featured topics lead the home feed for every player.
          </Text>

          {/* ── The topics, and the one lever. */}
          {topics.length === 0 ? (
            <EmptyState icon="book" title="No topics yet" body="Public Arena topics appear here once created." />
          ) : (
            <Card style={styles.card}>
              {topics.map((topic, i) => {
                const isLive = Boolean(topic.readiness?.isLive);
                const published = topic.readiness?.published ?? 0;
                const required = topic.readiness?.required ?? MIN_PUBLISHED_QUESTIONS_TO_LIVE;
                const matches = topic.stats?.matchesPlayed ?? 0;
                return (
                  <View key={topic.id} style={[styles.topicRow, i === topics.length - 1 && { borderBottomWidth: 0 }]}>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <View style={styles.nameRow}>
                        <Text variant="label" style={{ flexShrink: 1 }} numberOfLines={1}>
                          {topic.name}
                        </Text>
                        <Badge label={isLive ? 'Live' : 'Not live'} tone={isLive ? 'correct' : 'ink'} />
                      </View>
                      <Text variant="meta" color={colors.inkFaint} numberOfLines={1} style={styles.tabular}>
                        {[topic.categoryName, `${published} / ${required}`, `${matches} ${matches === 1 ? 'match' : 'matches'}`]
                          .filter(Boolean)
                          .join('  ·  ')}
                      </Text>
                    </View>
                    <Button
                      size="sm"
                      variant={topic.featured ? 'soft' : 'ghost'}
                      label={topic.featured ? 'Featured' : 'Feature'}
                      fullWidth={false}
                      loading={busyId === topic.id}
                      disabled={busyId != null && busyId !== topic.id}
                      onPress={() => toggleFeature(topic)}
                    />
                  </View>
                );
              })}
            </Card>
          )}
        </ScrollView>
      )}

      {loaded ? (
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <Button
            label="Open question bank"
            onPress={() => router.push({ pathname: '/admin/questions', params: { spaceId: PUBLIC_SPACE_ID } })}
          />
        </SafeAreaView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  content: { padding: layout.gutter, paddingTop: space.sm, paddingBottom: space.lg },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.canvas,
    borderRadius: layout.radiusCard,
    paddingVertical: space.lg,
  },
  statDivider: { width: 1, height: 30, backgroundColor: colors.hairline },
  note: { marginTop: space.md, marginBottom: space.md, paddingHorizontal: space.xs },
  card: { marginTop: space.xs },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tabular: { fontVariant: ['tabular-nums'] },
  footer: {
    paddingHorizontal: layout.gutter,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    backgroundColor: colors.sunken,
  },
});

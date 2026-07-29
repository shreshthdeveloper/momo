import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { api } from '../../src/lib/api.js';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import { useAdminSpace, useAdminPermissions } from '../../src/lib/admin.js';
import {
  Text,
  Badge,
  Button,
  Chip,
  EmptyState,
  ErrorNotice,
  Header,
  ProgressBar,
} from '../../src/components/ui.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import { TopicGlyph } from '../../src/components/Illustration.jsx';
import { MIN_PUBLISHED_QUESTIONS_TO_LIVE, TOPIC_STATUS } from '../../src/shared/constants.js';
import { colors, consoleLayout, elevation, layout, space } from '../../src/theme/index.js';

/**
 * prd.md F8.3 — the topic list, from the phone. Every card answers the one
 * question an admin has about a topic: is it live, and if not, how many
 * questions short is it. The readiness bar is that answer drawn; everything
 * else — sources, matches played — is context in a faint line beneath it.
 *
 * Reloads on focus rather than on mount, because the edit form saves and
 * comes straight back here — the list has to already show what was saved.
 */
export default function AdminTopics() {
  const goBack = useConsoleBack();
  const router = useRouter();
  const adminSpace = useAdminSpace();
  const { canManageTopics, canWrite } = useAdminPermissions(adminSpace);

  const [items, setItems] = useState(null);
  const [categories, setCategories] = useState(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!adminSpace) return;
    try {
      setError(null);
      const [topics, cats] = await Promise.all([
        api.get('/admin/topics', { spaceId: adminSpace.id }),
        api.get('/admin/categories', { spaceId: adminSpace.id }),
      ]);
      setItems(topics.items ?? []);
      setCategories(cats.items ?? []);
    } catch (err) {
      setError(err);
    }
  }, [adminSpace]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const loaded = Boolean(items && categories);
  const categoryById = new Map((categories ?? []).map((c) => [c.id, c]));
  const shown = (items ?? []).filter((t) => filter === 'all' || t.categoryId === filter);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Topics" subtitle={adminSpace?.name} onBack={goBack} />

      <ErrorNotice error={error} onRetry={load} />

      {!loaded && !error ? (
        <CardsSkeleton count={3} />
      ) : !loaded ? null : categories.length === 0 ? (
        <EmptyState
          icon="book"
          title="Start with a category"
          body="Every topic lives in a category. Create the first one and topics follow."
          actionLabel={canManageTopics ? 'Create a category' : undefined}
          onAction={canManageTopics ? () => router.push('/admin/topic-edit') : undefined}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="book"
          title="No topics yet"
          body={`A topic is a question bank students play. It goes live at ${MIN_PUBLISHED_QUESTIONS_TO_LIVE} published questions.`}
          actionLabel={canManageTopics ? 'New topic' : undefined}
          onAction={canManageTopics ? () => router.push('/admin/topic-edit') : undefined}
        />
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterBar}
            contentContainerStyle={styles.filterContent}
          >
            <Chip label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
            {categories.map((cat) => (
              <Chip
                key={cat.id}
                label={cat.name}
                active={filter === cat.id}
                onPress={() => setFilter(cat.id)}
              />
            ))}
          </ScrollView>

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
            {shown.length === 0 ? (
              <EmptyState icon="book" title="Nothing here" body="No topics in this category yet." />
            ) : (
              shown.map((topic) => (
                <TopicRow
                  key={topic.id}
                  topic={topic}
                  category={categoryById.get(topic.categoryId)}
                  canManageTopics={canManageTopics}
                  canWrite={canWrite}
                  router={router}
                />
              ))
            )}
          </ScrollView>
        </>
      )}

      {loaded && categories.length > 0 && canManageTopics ? (
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <Button label="New topic" onPress={() => router.push('/admin/topic-edit')} />
        </SafeAreaView>
      ) : null}
    </SafeAreaView>
  );
}

function TopicRow({ topic, category, canManageTopics, canWrite, router }) {
  const published = topic.readiness?.published ?? topic.publishedQuestionCount ?? 0;
  const required = topic.readiness?.required ?? MIN_PUBLISHED_QUESTIONS_TO_LIVE;
  const remaining = topic.readiness?.remaining ?? Math.max(0, required - published);
  const isLive = Boolean(topic.readiness?.isLive);
  const archived = topic.status === TOPIC_STATUS.ARCHIVED;

  const sources = [
    topic.questionSources?.own ? 'own bank' : null,
    topic.questionSources?.central ? 'central bank' : null,
  ]
    .filter(Boolean)
    .join(' + ');
  const matches = topic.stats?.matchesPlayed ?? 0;
  const sourcesLine = [sources, `${matches} ${matches === 1 ? 'match' : 'matches'} played`]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <View style={[styles.card, elevation.raised]}>
      <View style={styles.cardTop}>
        <View style={styles.thumb}>
          {topic.coverUrl ? (
            <Image
              source={{ uri: topic.coverUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={160}
            />
          ) : (
            <TopicGlyph name={topic.name} size={64} tone={category?.color} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={styles.nameRow}>
            <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
              {topic.name}
            </Text>
            <StatusBadge topic={topic} isLive={isLive} />
          </View>
          {topic.categoryName || category?.name ? (
            <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
              {topic.categoryName ?? category?.name}
            </Text>
          ) : null}
          {topic.description ? (
            <Text variant="meta" color={colors.inkMuted} numberOfLines={1}>
              {topic.description}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.readiness}>
        <ProgressBar
          value={published}
          max={required}
          color={isLive ? colors.correct : colors.optionC}
          height={8}
        />
        <View style={styles.readinessRow}>
          <Text variant="meta" color={colors.inkFaint}>
            {published} of {required} questions
          </Text>
          {!archived && remaining > 0 ? (
            <Text variant="meta" color={colors.optionC}>
              {remaining} more to go live
            </Text>
          ) : null}
        </View>
      </View>

      <Text variant="meta" color={colors.inkFaint} numberOfLines={1} style={styles.sources}>
        {sourcesLine}
      </Text>

      <View style={styles.actions}>
        <Button
          size="sm"
          variant="soft"
          label="Questions"
          fullWidth={false}
          onPress={() => router.push({ pathname: '/admin/questions', params: { topicId: topic.id } })}
        />
        {canWrite ? (
          <Button
            size="sm"
            variant="ghost"
            label="Add"
            fullWidth={false}
            onPress={() =>
              router.push({ pathname: '/admin/question-edit', params: { topicId: topic.id } })
            }
          />
        ) : null}
        {canManageTopics ? (
          <Button
            size="sm"
            variant="ghost"
            label="Edit"
            fullWidth={false}
            onPress={() => router.push({ pathname: '/admin/topic-edit', params: { topicId: topic.id } })}
          />
        ) : null}
      </View>
    </View>
  );
}

/**
 * Live is the state that matters, so it gets the green. A published topic
 * still short of questions is the trap state — published but invisible to
 * students — which is why it is named out loud, in amber, not folded into
 * "Published".
 */
function StatusBadge({ topic, isLive }) {
  if (isLive) return <Badge label="Live" tone="correct" />;
  if (topic.status === TOPIC_STATUS.PUBLISHED) {
    return (
      <View style={styles.amberBadge}>
        <Text variant="tiny" color={colors.optionC}>
          Published, not live
        </Text>
      </View>
    );
  }
  if (topic.status === TOPIC_STATUS.ARCHIVED) return <Badge label="Archived" tone="ink" />;
  return <Badge label="Draft" tone="soft" />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  filterBar: { flexGrow: 0, marginTop: space.xs },
  filterContent: { paddingHorizontal: consoleLayout.gutter, gap: space.sm, paddingBottom: space.sm },
  list: { padding: consoleLayout.gutter, paddingTop: space.sm, paddingBottom: space.lg },
  card: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    padding: layout.cardPadding,
    marginBottom: layout.cardGap,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  cardTop: { flexDirection: 'row', gap: space.md },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: layout.radiusInput,
    overflow: 'hidden',
    backgroundColor: colors.sunken,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  amberBadge: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: colors.amberSoft,
  },
  readiness: { marginTop: space.md },
  readinessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.sm,
  },
  sources: { marginTop: space.sm },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  footer: {
    paddingHorizontal: consoleLayout.gutter,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    backgroundColor: colors.sunken,
  },
});

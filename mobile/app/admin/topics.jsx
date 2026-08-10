import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import { useConsoleSpace } from '../../src/lib/admin.js';
import {
  ConsoleControls,
  ConsoleFooter,
  Text,
  Badge,
  Button,
  RowMenu,
  Select,
  EmptyState,
  ErrorNotice,
  Header,
  ProgressBar,
  Spinner,
  Tabs,
  CountRow,
} from '../../src/components/ui.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import Icon from '../../src/components/Icon.jsx';
import TopicMedallion from '../../src/components/TopicMedallion.jsx';
import { MIN_PUBLISHED_QUESTIONS_TO_LIVE, TOPIC_STATUS } from '../../src/shared/constants.js';
import { colors, consoleLayout, elevation, layout, space } from '../../src/theme/console.js';

/**
 * prd.md F8.3 — the topic list, from the phone. Every card answers the one
 * question an admin has about a topic: is it live, and if not, how many
 * questions short is it. The readiness bar is that answer drawn; everything
 * else — sources, matches played — is context in a faint line beneath it.
 *
 * Reloads on focus rather than on mount, because the edit form saves and
 * comes straight back here — the list has to already show what was saved.
 *
 * Mounted twice: at `/admin/topics` for an organization's own topics, and at
 * `/super/topics` for the Central Bank's. `useConsoleSpace` is what tells the
 * two apart — see the note there.
 */
export default function AdminTopics() {
  const router = useRouter();
  const goBack = useConsoleBack();
  const { spaceId, spaceName, isCentral, inTenant, canManageTopics, canWrite, canManageContests, href } =
    useConsoleSpace();
  /**
   * Assignments belong to an organization, not to the platform: the Public
   * Arena has no roster to set work for, and `assignmentService` returns
   * nothing for it. So this door exists in the organization console only —
   * and not when the platform operator is scoped INTO a tenant either, both
   * because setting a school's homework is not the operator's job and because
   * `/admin/assignment-new` is the one hardcoded route in this file, which
   * from `/super` would jump consoles mid-task.
   */
  const canSetWork = !isCentral && !inTenant && canManageContests;

  const [items, setItems] = useState(null);
  const [categories, setCategories] = useState(null);
  const [filter, setFilter] = useState('all');
  const [statusTab, setStatusTab] = useState('all');
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);
  /** Toasts clear themselves — see the console rule in ConsoleShell. */
  const noticeTimer = useRef(null);
  useEffect(() => {
    if (!notice) return undefined;
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(noticeTimer.current);
  }, [notice]);

  const load = useCallback(async () => {
    if (!spaceId) return;
    try {
      setError(null);
      const [topics, cats] = await Promise.all([
        api.get('/admin/topics', { spaceId }),
        api.get('/admin/categories', { spaceId }),
      ]);
      setItems(topics.items ?? []);
      setCategories(cats.items ?? []);
    } catch (err) {
      setError(err);
    }
  }, [spaceId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  /**
   * Publishing a topic — one tap, from the row.
   *
   * It used to be: open the topic, scroll past name, category, description,
   * both question sources and the cover, find the status chips, pick one, then
   * press Save. Six screens' worth of scrolling and a form submit to change
   * one enum, on the single most routine thing an admin does to a topic.
   *
   * Optimistic, because the answer is almost always yes and a list that waits
   * for the server before moving feels broken on a school Wi-Fi connection.
   * The one refusal that matters — TOPIC_NOT_READY, under 21 published
   * questions — has a real message from the server, so it is shown verbatim
   * and the row snaps back.
   */
  const setStatus = async (topic, status) => {
    const before = topic.status;
    setBusyId(topic.id);
    setError(null);
    setNotice(null);
    setItems((current) => (current ?? []).map((t) => (t.id === topic.id ? { ...t, status } : t)));
    try {
      await api.patch(`/admin/topics/${topic.id}`, { spaceId, status });
      setNotice(
        status === TOPIC_STATUS.PUBLISHED
          ? `${topic.name} is published.`
          : status === TOPIC_STATUS.ARCHIVED
            ? `${topic.name} is archived.`
            : `${topic.name} is back to a draft.`,
      );
      // The readiness figures and the live flag are the server's to compute.
      load();
    } catch (err) {
      setItems((current) =>
        (current ?? []).map((t) => (t.id === topic.id ? { ...t, status: before } : t)),
      );
      setError(err);
    } finally {
      setBusyId(null);
    }
  };

  if (!spaceId) {
    return (
      <SafeAreaView style={styles.screen} edges={[]}>
        <Header title="Topics" />
        <EmptyState
          tone="content"
          icon="alert"
          title="No organization to manage"
          body="This console appears when an organization has made you an admin."
        />
      </SafeAreaView>
    );
  }

  const loaded = Boolean(items && categories);
  const categoryById = new Map((categories ?? []).map((c) => [c.id, c]));
  /**
   * Two filters, and they answer different questions. The tabs are WHERE YOU
   * ARE — what students can play, what cannot go live yet, what is retired —
   * and the select narrows that to one category.
   *
   * "Not live" deliberately covers both a draft and a topic that is published
   * but still short of its 21 questions, because from the outside those are
   * the same fact: nobody can play it. That second state is the trap this
   * console has always named out loud in the badge, and until now there was no
   * way to ask for a list of them.
   */
  const inTab = (t) =>
    statusTab === 'all'
      ? true
      : statusTab === 'archived'
        ? t.status === TOPIC_STATUS.ARCHIVED
        : statusTab === 'live'
          ? Boolean(t.readiness?.isLive)
          : t.status !== TOPIC_STATUS.ARCHIVED && !t.readiness?.isLive;
  const inTabItems = (items ?? []).filter(inTab);
  const shown = inTabItems.filter((t) => filter === 'all' || t.categoryId === filter);

  return (
    <SafeAreaView style={styles.screen} edges={[]}>
      {/* Scoped into a tenant it is a PUSHED screen — the platform operator
          arrived from that organization and has somewhere to go back to. From
          the sidebar it is a sidebar screen and wears the menu. */}
      <Header title="Topics" subtitle={spaceName} onBack={inTenant ? goBack : undefined} />

      <ErrorNotice error={error} onRetry={load} />

      {/* A status change from a row is quiet by design — the row just changes.
          One line says which topic and what happened, then clears itself. */}
      {notice ? (
        <View style={styles.notice} accessibilityLiveRegion="polite">
          <Icon name="check" size={16} color={colors.accent} />
          <Text variant="label" style={{ flex: 1 }}>
            {notice}
          </Text>
        </View>
      ) : null}

      {!loaded && !error ? (
        <CardsSkeleton count={3} />
      ) : !loaded ? null : categories.length === 0 ? (
        <EmptyState
          tone="content"
          icon="book"
          title="Start with a category"
          body="Every topic lives in a category. Create the first one and topics follow."
          actionLabel={canManageTopics ? 'Create a category' : undefined}
          onAction={canManageTopics ? () => router.push(href('topic-edit')) : undefined}
        />
      ) : items.length === 0 ? (
        <EmptyState
          tone="content"
          icon="book"
          title="No topics yet"
          body={`A topic is a question bank students play. It goes live at ${MIN_PUBLISHED_QUESTIONS_TO_LIVE} published questions.`}
          actionLabel={canManageTopics ? 'New topic' : undefined}
          onAction={canManageTopics ? () => router.push(href('topic-edit')) : undefined}
        />
      ) : (
        <>
          <Tabs
            value={statusTab}
            onChange={setStatusTab}
            options={[
              { value: 'all', label: 'All' },
              { value: 'live', label: 'Live' },
              { value: 'draft', label: 'Not live' },
              { value: 'archived', label: 'Archived' },
            ]}
          />

          {/* Categories are as many as the organization makes. A chip row put
              all but the first three off the right edge of the screen. */}
          <ConsoleControls>
            <Select
              value={filter}
              options={[
                { value: 'all', label: 'All categories', meta: `${inTabItems.length} topics` },
                ...categories.map((cat) => ({
                  value: cat.id,
                  label: cat.name,
                  meta: `${inTabItems.filter((t) => t.categoryId === cat.id).length} topics`,
                })),
              ]}
              onChange={setFilter}
              placeholder="All categories"
            />
          </ConsoleControls>

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
            <CountRow total={shown.length} noun="topic" />

            {shown.length === 0 ? (
              <EmptyState
                tone="content"
                icon={statusTab === 'live' ? 'alert' : 'book'}
                title={
                  statusTab === 'live'
                    ? 'Nothing is live'
                    : statusTab === 'draft'
                      ? 'Everything is live'
                      : statusTab === 'archived'
                        ? 'Nothing archived'
                        : 'Nothing here'
                }
                body={
                  statusTab === 'live'
                    ? `No topic here has ${MIN_PUBLISHED_QUESTIONS_TO_LIVE} published questions and a published status, so students have nothing to play.`
                    : statusTab === 'draft'
                      ? 'Every topic in this view is playable.'
                      : statusTab === 'archived'
                        ? 'Archived topics appear here.'
                        : 'No topics in this category yet.'
                }
              />
            ) : (
              shown.map((topic) => (
                <TopicRow
                  key={topic.id}
                  topic={topic}
                  category={categoryById.get(topic.categoryId)}
                  canManageTopics={canManageTopics}
                  canWrite={canWrite}
                  canSetWork={canSetWork && Boolean(topic.readiness?.isLive)}
                  router={router}
                  href={href}
                  onSetStatus={setStatus}
                  busy={busyId === topic.id}
                />
              ))
            )}
          </ScrollView>
        </>
      )}

      {loaded && categories.length > 0 && canManageTopics ? (
        <ConsoleFooter>
          <Button label="New topic" onPress={() => router.push(href('topic-edit'))} />
        </ConsoleFooter>
      ) : null}
    </SafeAreaView>
  );
}

function TopicRow({ topic, category, canManageTopics, canWrite, canSetWork, router, href, onSetStatus, busy }) {
  const published = topic.readiness?.published ?? topic.publishedQuestionCount ?? 0;
  const required = topic.readiness?.required ?? MIN_PUBLISHED_QUESTIONS_TO_LIVE;
  const remaining = topic.readiness?.remaining ?? Math.max(0, required - published);
  const isLive = Boolean(topic.readiness?.isLive);
  const archived = topic.status === TOPIC_STATUS.ARCHIVED;
  const isPublished = topic.status === TOPIC_STATUS.PUBLISHED;
  /**
   * The 21-question gate, said before it is hit rather than after.
   *
   * The server refuses to publish a topic under the line and its message is
   * good, but a menu row that exists in order to fail is still a menu row that
   * fails. Below the line the verb goes, and its place is taken by what would
   * actually help: somewhere to get the questions from.
   */
  const canPublishTopic = published >= required;

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

  /**
   * The card IS the link.
   *
   * It used to be a slab of text with a soft "Questions" pill at the bottom,
   * and the pill was the only thing on it you could press — so a list of topics
   * was a list of things that looked like objects and behaved like posters. The
   * one question a topic card is opened to answer is "what is in it", the
   * answer is the question bank, and the target for it should be the whole
   * 150-point card rather than a 100-point pill in its corner.
   *
   * With the card pressable the pill has nothing left to do, so it goes: one
   * card, one destination, one `⋯` for the verbs, and a chevron that says so.
   */
  const open = () => router.push(href('questions', { topicId: topic.id }));

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${topic.name}, ${published} published questions`}
      accessibilityHint="Opens this topic's questions"
      style={({ pressed }) => [styles.card, elevation.raised, pressed && styles.cardPressed]}
    >
      <View style={styles.cardTop}>
        {/**
         * The topic's real face — the same one its students see.
         *
         * This was an `<Image>` pointed straight at `coverUrl`, and `coverUrl`
         * is not always a URL: the entire seeded catalogue stores
         * `mimo:icon/<subject>`, a wire scheme meaning "draw this from the
         * app's own Views" (see `TopicMedallion`). An image loader cannot fetch
         * that, so it rendered nothing — and because the value is truthy, the
         * fallback below it never ran either. Every seeded topic showed an
         * empty square in the console while looking correct in the player app.
         *
         * `TopicMedallion` is what the player renders, and it already handles
         * all three cases: a drawn subject, a real uploaded cover, and a topic
         * with no cover at all.
         */}
        <TopicMedallion
          coverUrl={topic.coverUrl}
          name={topic.name}
          size={64}
          shape="tile"
          style={styles.thumb}
        />
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
        <Icon name="chevronRight" size={16} color={colors.inkFaint} />
      </View>

      {/**
       * The bar is a countdown to LIVE, so it stops existing once the topic is
       * live. It used to keep running afterwards against the same target, which
       * is how a healthy topic ended up announcing "41 of 21 questions" over a
       * bar that had been full for the last twenty of them — a ratio that reads
       * as a bug even though nothing was wrong.
       *
       * Short of the target it counts up. At the target and beyond, it is a
       * plain count of what the bank holds.
       */}
      {isLive || archived ? (
        <Text variant="meta" color={colors.inkFaint} style={styles.readiness}>
          {published} published {published === 1 ? 'question' : 'questions'}
        </Text>
      ) : (
        <View style={styles.readiness}>
          <ProgressBar value={published} max={required} color={colors.optionC} height={8} />
          <View style={styles.readinessRow}>
            <Text variant="meta" color={colors.inkFaint}>
              {published} of {required} questions
            </Text>
            {remaining > 0 ? (
              <Text variant="meta" color={colors.optionC}>
                {remaining} more to go live
              </Text>
            ) : null}
          </View>
        </View>
      )}

      {/**
       * The last line carries the context and the verbs together, because
       * neither needs a row of its own: where the questions come from and how
       * much it has been played is one faint sentence, and everything you can
       * DO to the topic is behind the one `⋯` every card in both consoles ends
       * with. The card's own press is the destination.
       */}
      <View style={styles.actions}>
        <Text variant="meta" color={colors.inkFaint} numberOfLines={1} style={{ flex: 1 }}>
          {sourcesLine}
        </Text>
        {busy ? <Spinner size={16} /> : null}
        <RowMenu
          title={topic.name}
          label={`Actions for ${topic.name}`}
          actions={[
            /**
             * Filling the topic comes first, because for most of a topic's
             * life that is the job: it is short of questions and the only
             * question worth answering is where the next ones come from. A
             * CSV is how they arrive in bulk, and arriving from HERE means
             * the import already knows the destination.
             */
            canWrite
              ? {
                  key: 'import',
                  label: 'Import questions here',
                  meta: 'From a CSV or a spreadsheet',
                  icon: 'download',
                  onPress: () => router.push(href('import', { topicId: topic.id })),
                }
              : null,
            canWrite
              ? {
                  key: 'add',
                  label: 'Write a question here',
                  icon: 'plus',
                  onPress: () => router.push(href('question-edit', { topicId: topic.id })),
                }
              : null,

            // ── Live or not, from the row. ────────────────────────────────
            canManageTopics && !isPublished && canPublishTopic
              ? {
                  key: 'publish',
                  label: 'Publish it',
                  meta: `${published} published questions — students can play it`,
                  icon: 'check',
                  onPress: () => onSetStatus(topic, TOPIC_STATUS.PUBLISHED),
                }
              : null,
            canManageTopics && !isPublished && !canPublishTopic && !archived
              ? {
                  key: 'cannot-publish',
                  label: `${remaining} more questions to publish`,
                  meta: `A topic goes live at ${required} published questions`,
                  icon: 'alert',
                  onPress: () => router.push(href('questions', { topicId: topic.id })),
                }
              : null,
            canManageTopics && isPublished
              ? {
                  key: 'unpublish',
                  label: 'Take it down',
                  meta: 'Back to a draft. Students lose it; nothing is deleted',
                  icon: 'lock',
                  onPress: () => onSetStatus(topic, TOPIC_STATUS.DRAFT),
                }
              : null,
            canManageTopics && archived
              ? {
                  key: 'restore',
                  label: 'Restore it',
                  meta: 'Back to a draft',
                  icon: 'history',
                  onPress: () => onSetStatus(topic, TOPIC_STATUS.DRAFT),
                }
              : null,

            /**
             * A live topic is something you can set work on, and Assignments
             * is where that happens — a screen an admin had to reach from the
             * sidebar and then re-find this same topic inside. Only when it is
             * live (an assignment cannot point at a topic students cannot
             * play) and only in the organization console: the Public Arena has
             * no assignments, and `assignmentService` returns nothing for it.
             */
            canSetWork
              ? {
                  key: 'assign',
                  label: 'Set an assignment on it',
                  meta: 'Practice for a batch or the whole school',
                  icon: 'calendar',
                  onPress: () =>
                    router.push({ pathname: '/admin/assignment-new', params: { topicId: topic.id } }),
                }
              : null,

            canManageTopics
              ? {
                  key: 'edit',
                  label: 'Edit the topic',
                  meta: 'Name, cover, category, sources',
                  icon: 'edit',
                  onPress: () => router.push(href('topic-edit', { topicId: topic.id })),
                }
              : null,
            canManageTopics && !archived
              ? {
                  key: 'archive',
                  label: 'Archive it',
                  meta: 'Students lose access. Its questions stay in the bank',
                  icon: 'trash',
                  destructive: true,
                  onPress: () => onSetStatus(topic, TOPIC_STATUS.ARCHIVED),
                }
              : null,
          ]}
        />
      </View>
    </Pressable>
  );
}

/**
 * Live is the state that matters, so it gets the green. A published topic
 * still short of questions is the trap state — published but invisible to
 * students — which is why it is named out loud, in amber, not folded into
 * "Published".
 */
function StatusBadge({ topic, isLive }) {
  // Tinted, not solid — a column of fully-lit green pills shouts over the
  // topic names it is meant to annotate. See `Badge`.
  if (isLive) return <Badge label="Live" tone="live" />;
  if (topic.status === TOPIC_STATUS.PUBLISHED) {
    return <Badge label="Published, not live" tone="amber" />;
  }
  if (topic.status === TOPIC_STATUS.ARCHIVED) return <Badge label="Archived" tone="quiet" />;
  return <Badge label="Draft" tone="soft" />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  list: { padding: consoleLayout.gutter, paddingTop: space.md, paddingBottom: space.lg },
  card: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    padding: layout.cardPadding,
    marginBottom: layout.cardGap,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  cardPressed: { backgroundColor: colors.canvas },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // The medallion draws its own disc, rim and radius; this only reserves the
  // space beside the name.
  thumb: { width: 64, height: 64 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  readiness: { marginTop: space.md },
  readinessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.sm,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.accentSoft,
    borderRadius: layout.radiusInput,
    padding: space.md,
    marginHorizontal: consoleLayout.gutter,
    marginBottom: space.md,
  },
});

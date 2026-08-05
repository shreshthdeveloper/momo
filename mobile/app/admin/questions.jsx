import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, request } from '../../src/lib/api.js';
import { useAdminPermissions, useAdminSpace } from '../../src/lib/admin.js';
import {
  Text,
  Badge,
  Button,
  Chip,
  ConfirmSheet,
  EmptyState,
  ErrorNotice,
  Header,
  ConsoleFooter,
  SearchField,
  Select,
  Sheet,
  Tabs,
  CountRow,
  FULL_BLEED_MODAL,
  useBottomInset,
  useScrollBottom,
} from '../../src/components/ui.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import Icon from '../../src/components/Icon.jsx';
import { colors, consoleLayout, elevation, layout, space, type } from '../../src/theme/index.js';

/**
 * prd.md F8.2 — the question bank. Two banks behind one screen: "Our bank" is
 * the organization's own, editable; "Central bank" is the shared public bank,
 * read-only, from which a published question can be forked into one of our
 * live topics as a draft. Long-press (or Select) turns the list into a bulk
 * status tool; delete is per-card and names its consequence — a question that
 * has been served archives, one that never was deletes.
 */
const LETTERS = ['A', 'B', 'C', 'D'];
const PAGE_SIZE = 25;

const ORIGINS = [
  { value: 'own', label: 'Our bank' },
  { value: 'central', label: 'Central bank' },
];
const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'in_review', label: 'In review' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
];
const DIFFICULTY_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];
// Tinted, not solid — a column of fully-lit pills down a list shouts over the
// questions they annotate. See `Badge`.
const STATUS_BADGE = {
  draft: { label: 'Draft', tone: 'quiet' },
  in_review: { label: 'In review', tone: 'soft' },
  published: { label: 'Published', tone: 'live' },
  archived: { label: 'Archived', tone: 'quiet' },
};

function cap(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : '';
}

function ago(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** The footer's third slot: the flag badge carries alarm; this carries facts. */
function analysisMeta(row) {
  const analysis = row.itemAnalysis;
  if (analysis?.flag) return null;
  if (analysis?.percentCorrect != null && (analysis.sampleSize ?? 0) > 0) {
    return `${analysis.percentCorrect}% correct`;
  }
  const served = row.stats?.served ?? 0;
  if (served > 0) return `${served} served`;
  return row.servedEver ? 'Served' : 'Not served';
}

/** One labelled group of chips inside the filter sheet. */
function FilterGroup({ label, options, value, onChange }) {
  return (
    <View style={styles.group}>
      <Text variant="label" color={colors.inkMuted}>
        {label}
      </Text>
      <View style={styles.groupChips}>
        {options.map((option) => (
          <Chip
            key={String(option.value)}
            label={option.label}
            active={option.value === value}
            onPress={() => onChange(option.value)}
          />
        ))}
      </View>
    </View>
  );
}

export default function AdminQuestions() {
  const scrollBottom = useScrollBottom();
  const bottom = useBottomInset();
  const router = useRouter();
  const adminSpace = useAdminSpace();
  const permissions = useAdminPermissions(adminSpace);
  const params = useLocalSearchParams();

  // The superadmin browses another space (the public one) by passing spaceId.
  // The server re-checks the caller on every request, so showing the write
  // affordances here grants nothing.
  const overrideSpaceId =
    typeof params.spaceId === 'string' && params.spaceId.length > 0 ? params.spaceId : null;
  const spaceId = overrideSpaceId ?? adminSpace?.id;
  const canWrite = overrideSpaceId ? true : permissions.canWrite;
  const canPublish = overrideSpaceId ? true : permissions.canPublish;

  const [originChoice, setOriginChoice] = useState('own');
  const origin = overrideSpaceId ? 'own' : originChoice;

  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [difficulty, setDifficulty] = useState('all');
  const [topicFilter, setTopicFilter] = useState(() =>
    typeof params.topicId === 'string' && params.topicId.length > 0 ? params.topicId : null,
  );
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [topics, setTopics] = useState(null);
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [selected, setSelected] = useState(null); // null = browsing, array = selecting

  /**
   * Whether something below the list already stands on the safe area.
   *
   * Three things can hold the bottom of this screen: the primary in a
   * `ConsoleFooter`, the bulk-selection bar while rows are ticked, or — for a
   * sub-admin with no write permission, browsing the central bank — nothing at
   * all. Both bars inset themselves, so only the third case leaves the list
   * owing the navigation bar its height.
   */
  const [bulkBusy, setBulkBusy] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [forkTarget, setForkTarget] = useState(null);
  const [forkTopicId, setForkTopicId] = useState(null);
  const [forking, setForking] = useState(false);
  const [forkError, setForkError] = useState(null);

  const [notice, setNotice] = useState(null);
  const noticeTimer = useRef(null);
  const flash = (message) => {
    clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => setNotice(null), 2600);
  };
  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  // ~400ms of quiet before the search hits the server.
  useEffect(() => {
    const timer = setTimeout(() => setQ(query.trim()), 400);
    return () => clearTimeout(timer);
  }, [query]);

  const loadTopics = useCallback(async () => {
    if (!spaceId) return;
    try {
      const data = await api.get('/admin/topics', { spaceId });
      setTopics((data.items ?? []).filter((t) => t.status !== 'archived'));
    } catch {
      setTopics([]);
    }
  }, [spaceId]);

  useEffect(() => {
    loadTopics();
  }, [loadTopics]);

  const load = useCallback(
    async (pageIndex, { append = false } = {}) => {
      if (!spaceId) return;
      try {
        setError(null);
        if (append) setLoadingMore(true);
        const filters = { spaceId, origin, page: pageIndex, pageSize: PAGE_SIZE };
        if (origin === 'own' && status !== 'all') filters.status = status;
        if (difficulty !== 'all') filters.difficulty = difficulty;
        if (topicFilter) filters.topicId = topicFilter;
        if (q) filters.q = q;
        const data = await api.get('/admin/questions', filters);
        setTotal(data.total ?? 0);
        setPage(data.page ?? pageIndex);
        setItems((current) => (append ? [...(current ?? []), ...(data.items ?? [])] : (data.items ?? [])));
      } catch (err) {
        setError(err);
      } finally {
        setLoadingMore(false);
      }
    },
    [spaceId, origin, status, difficulty, topicFilter, q],
  );

  useEffect(() => {
    setItems(null);
    setSelected(null);
    load(0);
  }, [load]);

  const editParams = (extra) => (overrideSpaceId ? { ...extra, spaceId: overrideSpaceId } : extra);
  const goNew = () =>
    router.push({
      pathname: '/admin/question-edit',
      params: editParams(topicFilter ? { topicId: topicFilter } : {}),
    });
  const goEdit = (row) =>
    router.push({ pathname: '/admin/question-edit', params: editParams({ id: row.id }) });

  const toggle = (id) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  const runBulk = async (action) => {
    setBulkBusy(action);
    try {
      setError(null);
      const result = await api.post('/admin/questions/bulk', { spaceId, ids: selected, action });
      setSelected(null);
      flash(`${result?.updated ?? selected.length} updated.`);
      await load(0);
    } catch (err) {
      setError(err);
    } finally {
      setBulkBusy(null);
    }
  };

  const removeQuestion = async () => {
    const row = confirmDelete;
    if (!row) return;
    setDeleting(true);
    try {
      setError(null);
      // DELETE scopes by query param, so this bypasses api.delete's JSON body.
      const result = await request(`/admin/questions/${row.id}`, {
        method: 'DELETE',
        query: { spaceId },
      });
      setConfirmDelete(null);
      flash(result?.archived ? 'Archived — it stays out of new matches.' : 'Deleted.');
      await load(0);
    } catch (err) {
      setConfirmDelete(null);
      setError(err);
    } finally {
      setDeleting(false);
    }
  };

  const liveTopics = (topics ?? []).filter((t) => t.readiness?.isLive);
  const openFork = (row) => {
    setForkError(null);
    setForkTopicId(liveTopics.length === 1 ? liveTopics[0].id : null);
    setForkTarget(row);
  };
  const closeFork = () => {
    setForkTarget(null);
    setForkError(null);
  };
  const fork = async () => {
    setForking(true);
    try {
      setForkError(null);
      await api.post(`/admin/questions/${forkTarget.id}/fork`, { spaceId, topicIds: [forkTopicId] });
      setForkTarget(null);
      flash('Forked into your bank as a draft.');
    } catch (err) {
      setForkError(err);
    } finally {
      setForking(false);
    }
  };

  if (!spaceId) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header title="Question bank" />
        <EmptyState
          icon="alert"
          title="No organization to manage"
          body="This console appears when an organization has made you an admin."
        />
      </SafeAreaView>
    );
  }

  const shown = items ?? [];
  const filtersActive = Boolean(q || (origin === 'own' && status !== 'all') || difficulty !== 'all' || topicFilter);

  /**
   * What is set, as the chips the header shows and the sheet's count. Built
   * from the same state the request is built from, so the row cannot claim a
   * filter the list is not applying.
   */
  const activeFilters = [];
  if (origin === 'own' && status !== 'all') {
    activeFilters.push({
      key: 'status',
      label: STATUS_FILTERS.find((f) => f.value === status)?.label ?? status,
      clear: () => setStatus('all'),
    });
  }
  if (difficulty !== 'all') {
    activeFilters.push({
      key: 'difficulty',
      label: DIFFICULTY_FILTERS.find((f) => f.value === difficulty)?.label ?? difficulty,
      clear: () => setDifficulty('all'),
    });
  }
  if (topicFilter) {
    activeFilters.push({
      key: 'topic',
      label: topics?.find((t) => t.id === topicFilter)?.name ?? 'Topic',
      clear: () => setTopicFilter(null),
    });
  }
  const clearFilters = () => {
    setStatus('all');
    setDifficulty('all');
    setTopicFilter(null);
  };

  const topicOptions = [
    { value: null, label: 'Every topic' },
    ...(topics ?? []).map((t) => ({
      value: t.id,
      label: t.name,
      meta: t.categoryName ?? undefined,
    })),
  ];

  /**
   * The loaded page, in topic order.
   *
   * A question can belong to more than one topic, so it files under its first
   * — the alternative is showing it once per topic, which makes the counts lie
   * about how big the bank is. Questions with no topic at all collect at the
   * end under a heading that says so, because those are exactly the ones that
   * never reach a player and were previously invisible.
   */
  const groups = (() => {
    if (topicFilter) return [{ id: 'ALL', name: null, rows: shown }];
    const order = [];
    const byId = new Map();
    for (const row of shown) {
      const topic = row.topics?.[0];
      const id = topic?.id ?? 'NONE';
      if (!byId.has(id)) {
        const group = { id, name: topic?.name ?? 'No topic', rows: [] };
        byId.set(id, group);
        order.push(group);
      }
      byId.get(id).rows.push(row);
    }
    // "No topic" last: it is a to-do list, not a topic.
    return order.sort((a, b) => (a.id === 'NONE' ? 1 : b.id === 'NONE' ? -1 : 0));
  })();

  const bottomOwned = Boolean(selected) || (origin === 'own' && canWrite);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* No `+` in the corner. Creating a question is this screen's primary
          action, and a primary action lives in the footer on every other page
          in both consoles — a 20pt glyph in the top right was the odd one out
          and the hardest thing here to find. */}
      <Header
        title="Question bank"
        subtitle={overrideSpaceId ? 'Central bank' : adminSpace?.name}
        onBack={overrideSpaceId ? () => router.back() : undefined}
      />

      {!overrideSpaceId ? (
        <Tabs options={ORIGINS} value={origin} onChange={setOriginChoice} />
      ) : null}

      {/**
       * Search, and one door to everything else.
       *
       * This screen used to stack three horizontal chip scrollers under the
       * search field — status, difficulty, topic — which cost about a third of
       * the screen before the first question appeared, cut the last chip of
       * every row off mid-word with nothing to say it scrolled, and (because a
       * horizontal scroller stretches its children) sliced the pills in half.
       * Three rows of chrome to say "all, all, all", which is what they say
       * almost always.
       *
       * So the filters live in a sheet behind one button that counts how many
       * are set, and what IS set comes back as a row of chips you can take off
       * — the row appears only when there is something in it.
       */}
      <View style={styles.searchRow}>
        <SearchField
          style={{ flex: 1 }}
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          placeholder="Search questions"
          autoCapitalize="none"
        />
        <Pressable
          onPress={() => setFiltersOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={
            activeFilters.length ? `Filters — ${activeFilters.length} set` : 'Filters'
          }
          style={({ pressed }) => [
            styles.filterButton,
            activeFilters.length ? styles.filterButtonOn : null,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Icon
            name="filter"
            size={18}
            color={activeFilters.length ? colors.accent : colors.inkMuted}
          />
          {activeFilters.length ? (
            <Text variant="meta" color={colors.accent}>
              {activeFilters.length}
            </Text>
          ) : null}
        </Pressable>
      </View>

      {/**
       * The topic is the spine of a question bank, so it is a control on the
       * screen rather than something buried in the filter sheet: an admin's
       * question is almost always "what does THIS topic have", and with no
       * topic chosen the list still says which topic each question belongs to,
       * grouped, so the bank never reads as one undifferentiated pile.
       */}
      {topics && topics.length > 0 ? (
        <View style={styles.controls}>
          <Select
            value={topicFilter}
            options={topicOptions}
            onChange={setTopicFilter}
            placeholder="Every topic"
          />
        </View>
      ) : null}

      {activeFilters.length ? (
        <View style={styles.activeBar}>
          {activeFilters.map((filter) => (
            <Pressable
              key={filter.key}
              onPress={filter.clear}
              accessibilityRole="button"
              accessibilityLabel={`Remove the ${filter.label} filter`}
              style={({ pressed }) => [styles.activeChip, pressed && { opacity: 0.7 }]}
            >
              <Text variant="meta" color={colors.accent} numberOfLines={1}>
                {filter.label}
              </Text>
              <Icon name="close" size={13} color={colors.accent} />
            </Pressable>
          ))}
          <Pressable
            onPress={clearFilters}
            hitSlop={8}
            accessibilityRole="button"
            style={({ pressed }) => [styles.clearAll, pressed && { opacity: 0.7 }]}
          >
            <Text variant="meta" color={colors.inkMuted}>
              Clear
            </Text>
          </Pressable>
        </View>
      ) : null}
      <ErrorNotice error={error} onRetry={() => load(0)} />
      {notice ? (
        <View style={styles.notice}>
          <Icon name="check" size={16} color={colors.accent} />
          <Text variant="label" style={{ flex: 1 }}>
            {notice}
          </Text>
        </View>
      ) : null}

      {!items && !error ? (
        <CardsSkeleton count={4} lines={3} bar={false} />
      ) : shown.length === 0 ? (
        filtersActive ? (
          <EmptyState
            icon="search"
            title="No matches"
            body="No questions match these filters. Loosen the search or clear a filter."
          />
        ) : origin === 'central' ? (
          <EmptyState
            icon="book"
            title="Nothing here"
            body="The central bank has no published questions to browse yet."
          />
        ) : (
          <EmptyState
            icon="book"
            title="No questions yet"
            body="The bank is empty. Write the first question and the review flow takes it from there."
            actionLabel={canWrite ? 'Write the first question' : undefined}
            onAction={canWrite ? goNew : undefined}
          />
        )
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: bottomOwned ? space.xl : scrollBottom }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.accent}
              onRefresh={async () => {
                setRefreshing(true);
                await load(0);
                setRefreshing(false);
              }}
            />
          }
        >
          <CountRow
            shown={shown.length}
            total={total}
            noun="question"
            action={origin === 'own' && canWrite && !selected ? 'Select' : undefined}
            onAction={() => setSelected([])}
          />

          {groups.map((group) => (
            <View key={group.id}>
              {/**
               * A bank is organised by topic or it is a pile. With no topic
               * chosen the list still reads topic by topic, with a heading and
               * a count, rather than as one undifferentiated scroll where the
               * only way to tell what a question belongs to was to open it.
               *
               * The heading is skipped when a topic IS chosen — the Select
               * above already says which one, and repeating it every screenful
               * would be noise.
               */}
              {group.id !== 'ALL' ? (
                <View style={styles.groupHead}>
                  <Text variant="label" color={colors.inkMuted} style={{ flex: 1 }} numberOfLines={1}>
                    {group.name}
                  </Text>
                  <Text variant="meta" color={colors.inkFaint}>
                    {group.rows.length}
                  </Text>
                </View>
              ) : null}

              {group.rows.map((row) => {
                const isSelected = Boolean(selected?.includes(row.id));
                const statusBadge = STATUS_BADGE[row.status] ?? { label: cap(row.status), tone: 'quiet' };
                const flagBadge =
                  row.itemAnalysis?.flag === 'suspect_key'
                    ? { label: 'Check key', tone: 'danger' }
                    : row.itemAnalysis?.flag === 'too_easy'
                      ? { label: 'Too easy', tone: 'amber' }
                      : null;
                return (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                accessibilityLabel={row.text}
                style={({ pressed }) => [
                  styles.card,
                  elevation.raised,
                  pressed && { backgroundColor: colors.sunken },
                ]}
                onPress={() => {
                  if (origin === 'central') openFork(row);
                  else if (selected) toggle(row.id);
                  else goEdit(row);
                }}
                onLongPress={
                  origin === 'own' && canWrite && !selected
                    ? () => setSelected([row.id])
                    : undefined
                }
              >
                <View style={styles.cardHead}>
                  {selected ? (
                    <View style={[styles.check, isSelected && styles.checkOn]}>
                      {isSelected ? <Icon name="check" size={14} color={colors.onAccent} /> : null}
                    </View>
                  ) : null}
                  {origin === 'own' ? (
                    <Badge label={statusBadge.label} tone={statusBadge.tone} />
                  ) : (
                    <Badge label={cap(row.difficulty)} tone="soft" />
                  )}
                  {flagBadge ? <Badge label={flagBadge.label} tone={flagBadge.tone} /> : null}
                  <View style={{ flex: 1 }} />
                  <Text variant="tiny" color={colors.inkFaint}>
                    {ago(row.updatedAt)}
                  </Text>
                  {/* A bin, not an ✕. In the corner of a card an ✕ means
                      "dismiss this" everywhere else in software, and this one
                      deletes the question — sitting a thumb's width from the
                      timestamp on every card in a list you scroll fast. */}
                  {origin === 'own' && canWrite && !selected ? (
                    <Pressable
                      onPress={() => setConfirmDelete(row)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel="Delete question"
                     style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}>
                      <Icon name="trash" size={16} color={colors.inkFaint} />
                    </Pressable>
                  ) : null}
                </View>

                <Text style={[type.option, styles.cardText]} numberOfLines={3}>
                  {row.text}
                </Text>

                <View style={styles.answerRow}>
                  <Icon name="check" size={13} color={colors.correct} />
                  <Text
                    variant="meta"
                    color={colors.inkMuted}
                    numberOfLines={1}
                    style={{ flexShrink: 1 }}
                  >
                    {LETTERS[row.correctIndex] ?? ''} · {row.options?.[row.correctIndex] ?? ''}
                  </Text>
                  {row.reportCount > 0 ? (
                    <Text variant="meta" color={colors.wrong}>
                      · {row.reportCount} {row.reportCount === 1 ? 'report' : 'reports'}
                    </Text>
                  ) : null}
                </View>

                <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                  {[
                    origin === 'own' ? cap(row.difficulty) : null,
                    // The topic is the group heading now, unless a question is
                    // in more than one — then the extras are worth naming.
                    (row.topics ?? []).length > 1
                      ? (row.topics ?? []).map((t) => t.name).join(', ')
                      : null,
                    analysisMeta(row),
                    origin === 'central' ? row.createdBy : null,
                  ]
                    .filter(Boolean)
                    .join('  ·  ')}
                </Text>
              </Pressable>
                );
              })}
            </View>
          ))}

          {shown.length < total ? (
            <Button
              variant="soft"
              size="md"
              label="Load more"
              loading={loadingMore}
              style={{ marginTop: space.xs }}
              onPress={() => load(page + 1, { append: true })}
            />
          ) : null}
        </ScrollView>
      )}

      {/* The one primary, in the footer — hidden while selecting, because the
          bulk bar below owns the bottom of the screen then. */}
      {origin === 'own' && canWrite && !selected ? (
        <ConsoleFooter>
          <Button label="Write a question" onPress={goNew} />
        </ConsoleFooter>
      ) : null}

      {selected ? (
        <SafeAreaView edges={['bottom']} style={styles.selectionBar}>
          <View style={styles.selectionHead}>
            <Text variant="label">
              {selected.length} selected
            </Text>
            <Pressable onPress={() => setSelected(null)} hitSlop={8} accessibilityRole="button" style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}>
              <Text variant="label" color={colors.accent}>
                Cancel
              </Text>
            </Pressable>
          </View>
          <View style={styles.selectionActions}>
            {canPublish ? (
              <Button
                size="sm"
                label="Publish"
                style={{ flex: 1 }}
                loading={bulkBusy === 'publish'}
                disabled={selected.length === 0 || Boolean(bulkBusy)}
                onPress={() => runBulk('publish')}
              />
            ) : null}
            <Button
              size="sm"
              variant="soft"
              label="To review"
              style={{ flex: 1 }}
              loading={bulkBusy === 'review'}
              disabled={selected.length === 0 || Boolean(bulkBusy)}
              onPress={() => runBulk('review')}
            />
            <Button
              size="sm"
              variant="danger"
              label="Archive"
              style={{ flex: 1 }}
              loading={bulkBusy === 'archive'}
              disabled={selected.length === 0 || Boolean(bulkBusy)}
              onPress={() => runBulk('archive')}
            />
          </View>
        </SafeAreaView>
      ) : null}

      {/* Everything that narrows the list, in one place, so the list itself
          gets the screen. */}
      <Sheet
        visible={filtersOpen}
        title="Filters"
        onClose={() => setFiltersOpen(false)}
        accessibilityLabel="Filter the question bank"
        scroll
      >
        {/* Two fixed, short sets — so these stay chips. Topic is not one of
            them and lives in its own control on the screen; a wrap of chips
            for a list the data decides the length of is the thing this whole
            pass is removing. */}
        {origin === 'own' ? (
          <FilterGroup label="Status" options={STATUS_FILTERS} value={status} onChange={setStatus} />
        ) : null}
        <FilterGroup
          label="Difficulty"
          options={DIFFICULTY_FILTERS}
          value={difficulty}
          onChange={setDifficulty}
        />
        <Button
          label={`Show ${total} ${total === 1 ? 'question' : 'questions'}`}
          style={{ marginTop: space.xl }}
          onPress={() => setFiltersOpen(false)}
        />
        {activeFilters.length ? (
          <Button
            variant="ghost"
            label="Clear all filters"
            style={{ marginTop: space.sm }}
            onPress={clearFilters}
          />
        ) : null}
      </Sheet>

      <ConfirmSheet
        visible={Boolean(confirmDelete)}
        destructive
        icon="alert"
        title={confirmDelete?.servedEver ? 'Archive this question?' : 'Delete this question?'}
        body={
          confirmDelete?.servedEver
            ? 'It has been served in matches, so it will be archived rather than deleted. It stops appearing in new matches; player history stays.'
            : 'It has never been served in a match, so it will be deleted for good.'
        }
        confirmLabel={confirmDelete?.servedEver ? 'Archive question' : 'Delete question'}
        loading={deleting}
        onConfirm={removeQuestion}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* The central bank is read-only; a tap shows the question and offers the fork. */}
      <Modal
        visible={Boolean(forkTarget)}
        transparent
        animationType="fade"
        {...FULL_BLEED_MODAL}
        onRequestClose={closeFork}
      >
        <Pressable style={({ pressed }) => [styles.sheetScrim, pressed && { opacity: 0.7 }]} onPress={forking ? undefined : closeFork}>
          <Pressable style={[styles.sheet, { paddingBottom: bottom + space.lg }, elevation.sheet]} onPress={() => {}}>
            <View style={styles.sheetGrabber} />
            <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
              <Text style={[type.question, { color: colors.ink, marginBottom: space.md }]}>
                {forkTarget?.text}
              </Text>
              {(forkTarget?.options ?? []).map((option, i) => {
                const correct = i === forkTarget?.correctIndex;
                return (
                  <View key={i} style={styles.sheetOption}>
                    <Text variant="label" color={correct ? colors.correct : colors.inkFaint}>
                      {LETTERS[i]}
                    </Text>
                    <Text style={[type.body, { flex: 1, color: correct ? colors.correct : colors.ink }]}>
                      {option}
                    </Text>
                    {correct ? <Icon name="check" size={15} color={colors.correct} /> : null}
                  </View>
                );
              })}
            </ScrollView>

            {liveTopics.length === 0 ? (
              <>
                <Text variant="label" color={colors.inkMuted} style={styles.sheetLabel}>
                  Fork into a topic
                </Text>
                <Text variant="meta" color={colors.inkFaint} style={{ marginBottom: space.lg }}>
                  No topic is live yet — a topic needs 21 published questions first.
                </Text>
              </>
            ) : (
              <Select
                label="Fork into a topic"
                value={forkTopicId}
                options={liveTopics.map((topic) => ({ value: topic.id, label: topic.name }))}
                onChange={setForkTopicId}
                placeholder="Choose a topic"
                style={styles.sheetLabel}
              />
            )}
            {forkError ? (
              <Text variant="label" color={colors.wrong} style={{ marginBottom: space.md }}>
                {forkError.message}
              </Text>
            ) : null}
            <Button
              label="Fork as a draft"
              loading={forking}
              disabled={!forkTopicId}
              onPress={fork}
            />
            <Button
              variant="soft"
              label="Close"
              disabled={forking}
              style={{ marginTop: space.md }}
              onPress={closeFork}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // `sunken` — the deeper field the card lists use, so the raised cards have
  // something to lift off. It is also the search field's own colour, which is
  // why the field now carries an edge; see `SearchField`.
  screen: { flex: 1, backgroundColor: colors.sunken },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: consoleLayout.gutter,
    marginTop: space.md,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: 48,
    paddingHorizontal: space.md,
    minWidth: 48,
    justifyContent: 'center',
    borderRadius: layout.radiusInput,
    backgroundColor: colors.nightRaised,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  filterButtonOn: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  controls: { paddingHorizontal: consoleLayout.gutter, marginTop: space.sm },
  // Wraps rather than scrolls: there are at most two of these, and a scroller
  // for two chips is a scroller that hides one of them.
  activeBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: consoleLayout.gutter,
    marginTop: space.sm,
  },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: 28,
    paddingHorizontal: space.md,
    borderRadius: layout.radiusPill,
    backgroundColor: colors.accentSoft,
    maxWidth: 200,
  },
  clearAll: { height: 28, justifyContent: 'center', paddingHorizontal: space.xs },
  group: { gap: space.sm, marginTop: space.lg },
  groupChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  /** The topic heading over each run of cards in the bank. */
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  list: { padding: consoleLayout.gutter, paddingTop: 0 },
  card: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    padding: layout.cardPadding,
    marginBottom: layout.cardGap,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  cardText: { color: colors.ink, marginBottom: space.sm },
  answerRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.sm },
  check: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.inkFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
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
  selectionBar: {
    paddingHorizontal: consoleLayout.gutter,
    paddingTop: space.md,
    paddingBottom: space.sm,
    backgroundColor: colors.nightRaised,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    gap: space.md,
  },
  selectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectionActions: { flexDirection: 'row', gap: space.sm },
  sheetScrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.nightRaised,
    borderTopLeftRadius: layout.radiusCard + 8,
    borderTopRightRadius: layout.radiusCard + 8,
    padding: consoleLayout.gutter,
    maxHeight: '88%',
  },
  sheetGrabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.hairline,
    alignSelf: 'center',
    marginBottom: space.lg,
  },
  sheetScroll: { flexGrow: 0, maxHeight: 300 },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 40,
    paddingVertical: space.xs,
  },
  sheetLabel: { marginTop: space.lg, marginBottom: space.sm },
});

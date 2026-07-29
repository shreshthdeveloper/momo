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
  IconButton,
  SearchField,
  Segmented,
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
const STATUS_BADGE = {
  draft: { label: 'Draft', tone: 'soft' },
  in_review: { label: 'In review', tone: 'accent' },
  published: { label: 'Published', tone: 'correct' },
  archived: { label: 'Archived', tone: 'ink' },
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

function FilterRow({ options, value, onChange }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.filterRow}
      contentContainerStyle={styles.filterRowContent}
    >
      {options.map((option) => (
        <Chip
          key={String(option.value)}
          label={option.label}
          active={option.value === value}
          onPress={() => onChange(option.value)}
        />
      ))}
    </ScrollView>
  );
}

export default function AdminQuestions() {
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

  const [topics, setTopics] = useState(null);
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [selected, setSelected] = useState(null); // null = browsing, array = selecting
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

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header
        title="Question bank"
        subtitle={overrideSpaceId ? 'Central bank' : adminSpace?.name}
        onBack={overrideSpaceId ? () => router.back() : undefined}
        right={
          origin === 'own' && canWrite ? (
            <IconButton name="plus" label="New question" onPress={goNew} />
          ) : null
        }
      />

      {!overrideSpaceId ? (
        <Segmented options={ORIGINS} value={origin} onChange={setOriginChoice} style={styles.tabs} />
      ) : null}
      <SearchField
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        onClear={() => setQuery('')}
        placeholder="Search questions"
        autoCapitalize="none"
      />

      {origin === 'own' ? (
        <FilterRow options={STATUS_FILTERS} value={status} onChange={setStatus} />
      ) : null}
      <FilterRow options={DIFFICULTY_FILTERS} value={difficulty} onChange={setDifficulty} />
      {topics && topics.length > 0 ? (
        <FilterRow
          options={[{ value: null, label: 'All topics' }, ...topics.map((t) => ({ value: t.id, label: t.name }))]}
          value={topicFilter}
          onChange={setTopicFilter}
        />
      ) : null}

      <View style={{ height: space.md }} />
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
          contentContainerStyle={styles.list}
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
          <View style={styles.countRow}>
            <Text variant="meta" color={colors.inkFaint} style={{ flex: 1 }}>
              {total} {total === 1 ? 'question' : 'questions'}
            </Text>
            {origin === 'own' && canWrite && !selected ? (
              <Pressable onPress={() => setSelected([])} hitSlop={8} accessibilityRole="button" style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}>
                <Text variant="label" color={colors.accent}>
                  Select
                </Text>
              </Pressable>
            ) : null}
          </View>

          {shown.map((row) => {
            const isSelected = Boolean(selected?.includes(row.id));
            const statusBadge = STATUS_BADGE[row.status] ?? { label: cap(row.status), tone: 'ink' };
            const flagBadge =
              row.itemAnalysis?.flag === 'suspect_key'
                ? { label: 'Check key', tone: 'wrong' }
                : row.itemAnalysis?.flag === 'too_easy'
                  ? { label: 'Too easy', tone: 'soft' }
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
                  {origin === 'own' && canWrite && !selected ? (
                    <Pressable
                      onPress={() => setConfirmDelete(row)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel="Delete question"
                     style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}>
                      <Icon name="close" size={16} color={colors.inkFaint} />
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
                    (row.topics ?? []).map((t) => t.name).join(', '),
                    analysisMeta(row),
                    origin === 'central' ? row.createdBy : null,
                  ]
                    .filter(Boolean)
                    .join('  ·  ')}
                </Text>
              </Pressable>
            );
          })}

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
        onRequestClose={closeFork}
      >
        <Pressable style={({ pressed }) => [styles.sheetScrim, pressed && { opacity: 0.7 }]} onPress={forking ? undefined : closeFork}>
          <Pressable style={[styles.sheet, elevation.sheet]} onPress={() => {}}>
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

            <Text variant="label" color={colors.inkMuted} style={styles.sheetLabel}>
              Fork into a topic
            </Text>
            {liveTopics.length === 0 ? (
              <Text variant="meta" color={colors.inkFaint} style={{ marginBottom: space.lg }}>
                No topic is live yet — a topic needs 21 published questions first.
              </Text>
            ) : (
              <View style={styles.sheetChips}>
                {liveTopics.map((topic) => (
                  <Chip
                    key={topic.id}
                    label={topic.name}
                    active={forkTopicId === topic.id}
                    onPress={() => setForkTopicId(topic.id)}
                  />
                ))}
              </View>
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
  screen: { flex: 1, backgroundColor: colors.sunken },
  tabs: { marginHorizontal: consoleLayout.gutter, marginTop: space.xs },
  search: { marginHorizontal: consoleLayout.gutter, marginTop: space.md, marginBottom: space.xs },
  filterRow: { flexGrow: 0, marginTop: space.sm },
  filterRowContent: { gap: space.sm, paddingHorizontal: consoleLayout.gutter },
  list: { padding: consoleLayout.gutter, paddingTop: 0, paddingBottom: space.xxxl },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
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
    backgroundColor: colors.canvas,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    gap: space.md,
  },
  selectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectionActions: { flexDirection: 'row', gap: space.sm },
  sheetScrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.canvas,
    borderTopLeftRadius: layout.radiusCard + 8,
    borderTopRightRadius: layout.radiusCard + 8,
    padding: consoleLayout.gutter,
    paddingBottom: space.xxxl,
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
  sheetChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg },
});

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useAdminSpace, useAdminPermissions } from '../../src/lib/admin.js';
import { useExport, csvName } from '../../src/lib/download.js';
import {
  Text,
  Avatar,
  Button,
  ConfirmSheet,
  EmptyState,
  ErrorNotice,
  Header,
  ListCard,
  ListRow,
  SearchField,
  Select,
  Sheet,
  Tabs,
  CountRow,
} from '../../src/components/ui.jsx';
import { ListSkeleton } from '../../src/components/Skeletons.jsx';
import Icon from '../../src/components/Icon.jsx';
import { colors, consoleLayout, consoleType, layout, space } from '../../src/theme/index.js';

/**
 * prd.md F8.4 — the roster. Approvals first when there are any, because a
 * pending student is a person standing at the door; everything else is
 * housekeeping. Approve/reject act immediately; suspend and remove go through
 * the app's confirm sheet with the consequence named.
 *
 * The list is PAGED and the search runs on the server. It used to fetch one
 * page of a hundred — the server's own cap — with no way to ask for more, and
 * filter that page in memory: an organization with more than a hundred members
 * per status showed a count of everybody and a list of the first hundred, the
 * rest unreachable by scrolling or by searching, and pending members past the
 * hundredth could never be approved at all.
 */
const TABS = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'suspended', label: 'Suspended' },
];

const PAGE_SIZE = 50;

export default function AdminStudents() {
  const router = useRouter();
  const adminSpace = useAdminSpace();
  const { canManageStudents } = useAdminPermissions(adminSpace);
  const { exporting, error: exportError, run } = useExport();
  const params = useLocalSearchParams();

  const [status, setStatus] = useState(params.status === 'pending' ? 'pending' : 'active');
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState('');
  /** What the server was last asked for, so a stale reply cannot overwrite. */
  const requestRef = useRef(0);
  const [batches, setBatches] = useState([]);
  // Batches links here with one already chosen — "see who is in it".
  const [batchFilter, setBatchFilter] = useState(
    typeof params.batchId === 'string' && params.batchId ? params.batchId : null,
  );
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirm, setConfirm] = useState(null); // { row, decision }
  const [assigning, setAssigning] = useState(null); // the row being filed
  const [busyId, setBusyId] = useState(null);

  const fetchPage = useCallback(
    async (nextPage, { append = false } = {}) => {
      if (!adminSpace) return;
      const ticket = (requestRef.current += 1);
      try {
        setError(null);
        const data = await api.get('/admin/students', {
          spaceId: adminSpace.id,
          status,
          q: query.trim() || undefined,
          batchId: batchFilter ?? undefined,
          page: nextPage,
          pageSize: PAGE_SIZE,
        });
        if (ticket !== requestRef.current) return;
        setTotal(data.total ?? 0);
        setPage(nextPage);
        setRows((prev) => (append ? [...(prev ?? []), ...(data.items ?? [])] : (data.items ?? [])));
      } catch (err) {
        if (ticket === requestRef.current) setError(err);
      }
    },
    [adminSpace, status, query, batchFilter],
  );

  const load = useCallback(() => fetchPage(0), [fetchPage]);

  // The search is debounced so a typed name is one request, not one per letter.
  useEffect(() => {
    setRows(null);
    const timer = setTimeout(load, query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  useEffect(() => {
    if (!adminSpace) return;
    api
      .get('/admin/batches', { spaceId: adminSpace.id })
      .then((data) => setBatches(data.items ?? []))
      .catch(() => setBatches([]));
  }, [adminSpace]);

  const decide = async (row, decision) => {
    setBusyId(row.membershipId);
    try {
      setError(null);
      await api.post('/admin/students/decision', {
        spaceId: adminSpace.id,
        membershipIds: [row.membershipId],
        decision,
      });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  };

  const fileInto = async (row, batchId) => {
    setBusyId(row.membershipId);
    try {
      setError(null);
      await api.post(`/admin/students/${row.membershipId}/batch`, {
        spaceId: adminSpace.id,
        batchId,
      });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
      setAssigning(null);
    }
  };

  const shown = rows ?? [];
  const hasMore = shown.length < total;

  const confirmCopy = {
    suspend: {
      title: `Suspend ${confirm?.row?.displayName}?`,
      body: 'They keep their history but cannot play in this organization until restored.',
      confirmLabel: 'Suspend',
    },
    remove: {
      title: `Remove ${confirm?.row?.displayName}?`,
      body: 'They lose access to this organization’s topics, contests and leaderboards. They can rejoin with a code.',
      confirmLabel: 'Remove member',
    },
  }[confirm?.decision];

  /**
   * What this row can do, by the tab it is in. One list, so the sheet reads
   * the same way for a pending student and a suspended one and the verbs
   * cannot drift apart per branch the way three separate JSX blocks did.
   */
  const actionsFor = (row) => {
    const open = {
      key: 'open',
      label: 'Open profile',
      icon: 'user',
      onPress: () =>
        router.push({
          pathname: '/admin/student-detail',
          params: { membershipId: row.membershipId, userId: row.userId },
        }),
    };
    if (status === 'pending') {
      return [
        open,
        { key: 'approve', label: 'Approve', icon: 'check', onPress: () => decide(row, 'approve') },
        {
          key: 'reject',
          label: 'Reject the request',
          icon: 'close',
          destructive: true,
          onPress: () => decide(row, 'reject'),
        },
      ];
    }
    if (status === 'suspended') {
      return [
        open,
        { key: 'restore', label: 'Restore', icon: 'check', onPress: () => decide(row, 'restore') },
        {
          key: 'remove',
          label: 'Remove from organization',
          icon: 'trash',
          destructive: true,
          onPress: () => setConfirm({ row, decision: 'remove' }),
        },
      ];
    }
    return [
      open,
      batches.length > 0
        ? {
            key: 'batch',
            label: row.batch ? 'Move to another batch' : 'Put in a batch',
            meta: row.batch?.name,
            icon: 'grid',
            onPress: () => setAssigning(row),
          }
        : null,
      row.role === 'student'
        ? {
            key: 'suspend',
            label: 'Suspend',
            icon: 'lock',
            destructive: true,
            onPress: () => setConfirm({ row, decision: 'suspend' }),
          }
        : null,
    ];
  };

  const batchOptions = useMemo(
    () => [
      { value: null, label: 'All batches' },
      ...batches.map((b) => ({
        value: b.id,
        label: b.name,
        meta: `${b.studentCount ?? 0} ${b.studentCount === 1 ? 'student' : 'students'}`,
      })),
    ],
    [batches],
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* No shortcut in the corner. Batches is a row in the sidebar two inches
          away, and a soft pill in the header was the only one of its kind in
          either console — it read as this screen's primary action, which it is
          not. */}
      <Header title="Students" subtitle={adminSpace?.name} />

      <Tabs options={TABS} value={status} onChange={setStatus} />

      <View style={styles.controls}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          placeholder="Find a student"
          autoCapitalize="none"
        />
        {/* An organization can have thirty batches. A chip row would put
            twenty-eight of them off the right edge of the screen. */}
        {batches.length > 0 ? (
          <Select
            value={batchFilter}
            options={batchOptions}
            onChange={setBatchFilter}
            placeholder="All batches"
          />
        ) : null}
      </View>

      {/* Two notices, one slot: a failed load offers a retry, a failed export
          does not — retrying an export is the button that just failed. */}
      <ErrorNotice error={error} onRetry={load} />
      <ErrorNotice error={exportError} />

      {!rows && !error ? (
        <ListSkeleton rows={7} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon="friends"
          title={query ? 'Nobody by that name' : status === 'pending' ? 'Nobody waiting' : 'Nobody here'}
          body={
            query
              ? 'Try a different spelling.'
              : status === 'pending'
                ? 'New join requests appear here for approval.'
                : status === 'suspended'
                  ? 'Suspended students appear here until restored.'
                  : 'Share the invite code to bring students in.'
          }
          actionLabel={status === 'active' && !query ? 'Invite code' : undefined}
          onAction={status === 'active' && !query ? () => router.push('/admin/invite') : undefined}
        />
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
                await load();
                setRefreshing(false);
              }}
            />
          }
        >
          {/* What is on screen, out of what matched — the same component and
              the same wording as every other list in both consoles. Export lives
              in its action slot, which is what that slot is for: it is the one
              screen-level thing an admin wants that is not the primary action.
              The roster route has existed since F8.6.6 with nothing calling it,
              so a teacher's only way to a spreadsheet was to retype it. */}
          <CountRow
            shown={shown.length}
            total={total}
            noun="student"
            action={exporting ? 'Exporting…' : 'Export'}
            onAction={() =>
              run('/admin/reports/students.csv', {
                query: { spaceId: adminSpace?.id },
                filename: csvName(adminSpace?.name, 'students'),
              })
            }
          />

          <ListCard>
          {shown.map((row, i) => (
            /**
             * The row opens what it can do, and the first thing it can do is
             * open the person — a roster where the only verb on a name was
             * "suspend" answered no question an admin actually has. Same shape
             * as every other list in the console: full-width target, chevron,
             * sheet.
             */
            <ListRow
              key={row.membershipId}
              last={i === shown.length - 1}
              title={row.displayName}
              actions={canManageStudents ? actionsFor(row) : undefined}
              onPress={
                canManageStudents
                  ? undefined
                  : () =>
                      router.push({
                        pathname: '/admin/student-detail',
                        params: { membershipId: row.membershipId, userId: row.userId },
                      })
              }
            >
              <Avatar url={row.avatarUrl} name={row.displayName} size={44} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="label" numberOfLines={1}>
                  {row.displayName}
                  {row.role !== 'student' ? '  ·  admin' : ''}
                </Text>
                <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                  {[row.batch?.name, row.phone, row.city].filter(Boolean).join('  ·  ')}
                </Text>
              </View>

              {/**
                * The rating is a COLUMN, not something tacked to the end of the
                * name: it belongs to every member, it is the one number on this
                * screen, and a roster you cannot read straight down is a roster
                * you have to read one row at a time. Tabular figures, a fixed
                * width, and an em dash where there is no rating yet, so the
                * column never collapses and re-flows the row beside it.
                */}
              {status === 'active' ? (
                <Text style={styles.figure} color={colors.inkMuted} numberOfLines={1}>
                  {row.overallRating ?? '—'}
                </Text>
              ) : null}

              {/**
                * Approving somebody waiting at the door keeps a button of its
                * own — it is what this tab exists to do, it is safe, and it is
                * worth one tap rather than two. Everything else, including
                * every irreversible thing, is in the row's own sheet.
                *
                * Hidden without the grant the server enforces, rather than
                * shown and then refused with a 403.
                */}
              {canManageStudents && status === 'pending' ? (
                <Button
                  size="sm"
                  label="Approve"
                  fullWidth={false}
                  loading={busyId === row.membershipId}
                  onPress={() => decide(row, 'approve')}
                />
              ) : null}
            </ListRow>
          ))}
          </ListCard>

          {hasMore ? (
            <Button
              variant="soft"
              label={`Load ${Math.min(PAGE_SIZE, total - shown.length)} more`}
              loading={loadingMore}
              style={{ marginTop: space.lg }}
              onPress={async () => {
                setLoadingMore(true);
                await fetchPage(page + 1, { append: true });
                setLoadingMore(false);
              }}
            />
          ) : null}
        </ScrollView>
      )}

      <ConfirmSheet
        visible={Boolean(confirm)}
        destructive
        icon="friends"
        title={confirmCopy?.title ?? ''}
        body={confirmCopy?.body}
        confirmLabel={confirmCopy?.confirmLabel ?? 'Confirm'}
        loading={Boolean(busyId)}
        onConfirm={() => decide(confirm.row, confirm.decision)}
        onCancel={() => setConfirm(null)}
      />

      {/* Filing one student into a batch. The list of batches is managed on
          its own screen; this is only where somebody is put in one — and it is
          a list, not a wrap of chips, because an organization's batches are as
          many as it has classes. */}
      <Sheet
        visible={Boolean(assigning)}
        title={`Batch for ${assigning?.displayName ?? ''}`}
        onClose={() => setAssigning(null)}
        accessibilityLabel="Choose a batch"
        scroll
      >
        <Text variant="meta" color={colors.inkMuted} style={styles.sheetNote}>
          Batches scope assignments, contests and leaderboards.
        </Text>
        <ScrollView style={styles.batchPicker} showsVerticalScrollIndicator={false}>
          {[...batches, ...(assigning?.batch ? [{ id: null, name: 'No batch' }] : [])].map((b) => (
            <Pressable
              key={b.id ?? 'none'}
              onPress={() => fileInto(assigning, b.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: assigning?.batch?.id === b.id }}
              style={({ pressed }) => [styles.pickerRow, pressed && { opacity: 0.7 }]}
            >
              <Text
                variant="body"
                color={assigning?.batch?.id === b.id ? colors.accent : colors.ink}
                style={{ flex: 1 }}
                numberOfLines={1}
              >
                {b.name}
              </Text>
              {assigning?.batch?.id === b.id ? (
                <Icon name="check" size={18} color={colors.accent} />
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  controls: {
    paddingHorizontal: consoleLayout.gutter,
    paddingTop: space.md,
    paddingBottom: space.sm,
    gap: space.sm,
  },
  list: { paddingHorizontal: consoleLayout.gutter, paddingBottom: space.xxxl },
  /** The rating column. Fixed width and right-aligned, so it reads downward. */
  figure: { ...consoleType.figure, minWidth: 44, textAlign: 'right' },
  rowPressed: { backgroundColor: colors.nightRaised },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.touchMin,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 68,
    paddingVertical: space.sm,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  batchPicker: { maxHeight: 320, flexGrow: 0, marginTop: space.md },
  sheetNote: { textAlign: 'center' },
});

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useAdminSpace, useAdminPermissions } from '../../src/lib/admin.js';
import {
  Text,
  Avatar,
  Button,
  Chip,
  ConfirmSheet,
  EmptyState,
  ErrorNotice,
  Header,
  SearchField,
  Segmented,
  Sheet,
} from '../../src/components/ui.jsx';
import { ListSkeleton } from '../../src/components/Skeletons.jsx';
import { colors, consoleLayout, space, type } from '../../src/theme/index.js';

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
  const [batchFilter, setBatchFilter] = useState(null);
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

  const batchChips = useMemo(
    () => [{ id: null, name: 'All batches' }, ...batches],
    [batches],
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header
        title="Students"
        subtitle={adminSpace?.name}
        right={
          canManageStudents ? (
            <Button
              size="sm"
              variant="soft"
              label="Batches"
              fullWidth={false}
              onPress={() => router.push('/admin/batches')}
            />
          ) : null
        }
      />

      <Segmented options={TABS} value={status} onChange={setStatus} style={styles.tabs} />
      <SearchField
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        onClear={() => setQuery('')}
        placeholder="Find a student"
        autoCapitalize="none"
      />

      {batches.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {batchChips.map((b) => (
            <Chip
              key={b.id ?? 'all'}
              label={b.name}
              active={batchFilter === b.id}
              onPress={() => setBatchFilter(b.id)}
            />
          ))}
        </ScrollView>
      ) : null}

      <ErrorNotice error={error} onRetry={load} />

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
          <Text variant="meta" color={colors.inkFaint} style={styles.count}>
            {/* What is on screen, out of what matched — a bare total beside a
                truncated list is the thing that made this look broken. */}
            {shown.length} of {total} {total === 1 ? 'student' : 'students'}
          </Text>

          {shown.map((row) => (
            <View key={row.membershipId} style={styles.row}>
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

              {/* Every control below is hidden without the grant the server
                  enforces, rather than shown and then refused with a 403. */}
              {!canManageStudents ? null : status === 'pending' ? (
                <View style={styles.actions}>
                  <Button
                    size="sm"
                    label="Approve"
                    fullWidth={false}
                    loading={busyId === row.membershipId}
                    onPress={() => decide(row, 'approve')}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Reject"
                    fullWidth={false}
                    disabled={busyId === row.membershipId}
                    onPress={() => decide(row, 'reject')}
                  />
                </View>
              ) : status === 'suspended' ? (
                <View style={styles.actions}>
                  <Button
                    size="sm"
                    variant="soft"
                    label="Restore"
                    fullWidth={false}
                    loading={busyId === row.membershipId}
                    onPress={() => decide(row, 'restore')}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Remove"
                    fullWidth={false}
                    disabled={busyId === row.membershipId}
                    onPress={() => setConfirm({ row, decision: 'remove' })}
                  />
                </View>
              ) : row.role === 'student' ? (
                <View style={styles.actions}>
                  <Text style={[type.label, { color: colors.inkMuted }]}>{row.overallRating ?? ''}</Text>
                  {batches.length > 0 ? (
                    <Button
                      size="sm"
                      variant="soft"
                      label="Batch"
                      fullWidth={false}
                      disabled={busyId === row.membershipId}
                      onPress={() => setAssigning(row)}
                    />
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Suspend"
                    fullWidth={false}
                    onPress={() => setConfirm({ row, decision: 'suspend' })}
                  />
                </View>
              ) : null}
            </View>
          ))}

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
          its own screen; this is only where somebody is put in one. */}
      <Sheet
        visible={Boolean(assigning)}
        title={`Batch for ${assigning?.displayName ?? ''}`}
        onClose={() => setAssigning(null)}
        accessibilityLabel="Choose a batch"
      >
        <Text variant="meta" color={colors.inkMuted} style={styles.sheetNote}>
          Batches scope assignments, contests and leaderboards.
        </Text>
        <View style={styles.batchPicker}>
          {batches.map((b) => (
            <Chip
              key={b.id}
              label={b.name}
              active={assigning?.batch?.id === b.id}
              onPress={() => fileInto(assigning, b.id)}
            />
          ))}
          {assigning?.batch ? (
            <Chip label="No batch" onPress={() => fileInto(assigning, null)} />
          ) : null}
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  tabs: { marginHorizontal: consoleLayout.gutter, marginTop: space.xs },
  search: { marginHorizontal: consoleLayout.gutter, marginTop: space.md, marginBottom: space.sm },
  filters: { paddingHorizontal: consoleLayout.gutter, gap: space.sm, paddingBottom: space.sm },
  list: { paddingHorizontal: consoleLayout.gutter, paddingBottom: space.xxxl },
  count: { paddingVertical: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 68,
    paddingVertical: space.sm,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  batchPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  sheetNote: { textAlign: 'center' },
});

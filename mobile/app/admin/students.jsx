import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useAdminSpace } from '../../src/lib/admin.js';
import {
  Text,
  Avatar,
  Button,
  ConfirmSheet,
  EmptyState,
  ErrorNotice,
  Header,
  SearchField,
  Segmented,
} from '../../src/components/ui.jsx';
import { ListSkeleton } from '../../src/components/Skeletons.jsx';
import { colors, layout, space, type } from '../../src/theme/index.js';

/**
 * prd.md F8.4 — the roster. Approvals first when there are any, because a
 * pending student is a person standing at the door; everything else is
 * housekeeping. Approve/reject act immediately; suspend and remove go through
 * the app's confirm sheet with the consequence named.
 */
const TABS = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'suspended', label: 'Suspended' },
];

export default function AdminStudents() {
  const router = useRouter();
  const adminSpace = useAdminSpace();
  const params = useLocalSearchParams();

  const [status, setStatus] = useState(params.status === 'pending' ? 'pending' : 'active');
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirm, setConfirm] = useState(null); // { row, decision }
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!adminSpace) return;
    try {
      setError(null);
      const data = await api.get('/admin/students', { spaceId: adminSpace.id, status, pageSize: 100 });
      setRows(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err);
    }
  }, [adminSpace, status]);

  useEffect(() => {
    setRows(null);
    load();
  }, [load]);

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

  const shown = (rows ?? []).filter(
    (r) => !query.trim() || r.displayName?.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const confirmCopy = {
    suspend: {
      title: `Suspend ${confirm?.row?.displayName}?`,
      body: 'They keep their history but cannot play in this organization until restored.',
      confirmLabel: 'Suspend',
    },
    remove: {
      title: `Remove ${confirm?.row?.displayName}?`,
      body: 'They lose access to this organization’s topics, contests and leaderboards. They can rejoin with a code.',
      confirmLabel: 'Remove student',
    },
  }[confirm?.decision];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Students" subtitle={adminSpace?.name} />

      <Segmented options={TABS} value={status} onChange={setStatus} style={styles.tabs} />
      <SearchField
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        onClear={() => setQuery('')}
        placeholder="Find a student"
        autoCapitalize="none"
      />

      <ErrorNotice error={error} onRetry={load} />

      {!rows && !error ? (
        <ListSkeleton rows={7} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon="friends"
          title={status === 'pending' ? 'Nobody waiting' : 'Nobody here'}
          body={
            status === 'pending'
              ? 'New join requests appear here for approval.'
              : status === 'suspended'
                ? 'Suspended students appear here until restored.'
                : 'Share the invite code to bring students in.'
          }
          actionLabel={status === 'active' ? 'Invite code' : undefined}
          onAction={status === 'active' ? () => router.push('/admin/invite') : undefined}
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
            {total} {total === 1 ? 'student' : 'students'}
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

              {status === 'pending' ? (
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
                <Button
                  size="sm"
                  variant="soft"
                  label="Restore"
                  fullWidth={false}
                  loading={busyId === row.membershipId}
                  onPress={() => decide(row, 'restore')}
                />
              ) : row.role === 'student' ? (
                <View style={styles.actions}>
                  <Text style={[type.label, { color: colors.inkMuted }]}>{row.overallRating ?? ''}</Text>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  tabs: { marginHorizontal: layout.gutter, marginTop: space.xs },
  search: { marginHorizontal: layout.gutter, marginTop: space.md, marginBottom: space.sm },
  list: { paddingHorizontal: layout.gutter, paddingBottom: space.xxxl },
  count: { paddingVertical: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 68,
    paddingVertical: space.sm,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import {
  Text,
  Avatar,
  Badge,
  Button,
  Select,
  ConfirmSheet,
  EmptyState,
  ErrorNotice,
  Header,
  SearchField,
  Tabs,
  CountRow,
  ListCard,
  ListRow,
} from '../../src/components/ui.jsx';
import { ListSkeleton } from '../../src/components/Skeletons.jsx';
import { colors, consoleLayout, consoleType, space } from '../../src/theme/index.js';

/**
 * Every account on the platform, and the one lever that matters.
 *
 * The operator's questions are, in order: who is here, who is in THIS
 * organization, and can I stop that one from playing. So the screen is a table
 * — one line per person, the facts that decide anything (organizations,
 * matches, rating, last seen) on the line with them — filtered by status and
 * by organization, and suspending is a row action rather than a screen of its
 * own.
 *
 * A suspended account cannot sign in or play; nothing of theirs is deleted,
 * which is why the confirmation says restore rather than undo.
 */
const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: '', label: 'All' },
];

const PAGE_SIZE = 50;

export default function SuperUsers() {
  const [status, setStatus] = useState('active');
  const [query, setQuery] = useState('');
  const [spaceId, setSpaceId] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirm, setConfirm] = useState(null); // { user, next }
  const [busyId, setBusyId] = useState(null);
  /** Only the newest request may write — a slow page must not overwrite a fast one. */
  const ticket = useRef(0);

  const fetchPage = useCallback(
    async (nextPage, { append = false } = {}) => {
      const mine = (ticket.current += 1);
      try {
        setError(null);
        const data = await api.get('/super/users', {
          q: query.trim() || undefined,
          status: status || undefined,
          spaceId: spaceId ?? undefined,
          page: nextPage,
          pageSize: PAGE_SIZE,
        });
        if (mine !== ticket.current) return;
        setTotal(data.total ?? 0);
        setPage(nextPage);
        setRows((prev) => (append ? [...(prev ?? []), ...(data.items ?? [])] : (data.items ?? [])));
      } catch (err) {
        if (mine === ticket.current) setError(err);
      }
    },
    [query, status, spaceId],
  );

  const load = useCallback(() => fetchPage(0), [fetchPage]);

  useEffect(() => {
    setRows(null);
    const timer = setTimeout(load, query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  useEffect(() => {
    api
      .get('/super/spaces', { status: 'active' })
      .then((data) => setOrgs(data.items ?? []))
      .catch(() => setOrgs([]));
  }, []);

  const setUserStatus = async (user, next) => {
    setBusyId(user.id);
    try {
      setError(null);
      await api.post(`/super/users/${user.id}/status`, { status: next });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  };

  const shown = rows ?? [];
  const hasMore = shown.length < total;
  const orgName = orgs.find((o) => o.id === spaceId)?.name;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header
        title="Users"
        subtitle={orgName ? `${total} in ${orgName}` : `${total} on the platform`}
      />

      {/* Status is where you ARE in this table, so it is tabs at the top — the
          same shape the roster and the question bank wear. */}
      <Tabs options={STATUSES} value={status} onChange={setStatus} />

      <View style={styles.controls}>
        <SearchField
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          placeholder="Name or phone"
          autoCapitalize="none"
        />

        {/**
         * Organization is a filter, not a screen: the same table answers
         * "everyone" and "everyone in Greenfield High". It was a horizontal
         * chip row, which on a platform with more than four tenants meant the
         * one you wanted was almost always off-screen — and a superadmin's
         * whole job is that there are many of them.
         */}
        <Select
          value={spaceId}
          options={[
            { value: null, label: 'All organizations' },
            ...orgs.map((org) => ({ value: org.id, label: org.name })),
          ]}
          onChange={setSpaceId}
          placeholder="All organizations"
        />
      </View>

      <ErrorNotice error={error} onRetry={load} />

      {!rows && !error ? (
        <ListSkeleton rows={9} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon="friends"
          title={query ? 'Nobody by that name' : 'Nobody here'}
          body={
            query
              ? 'Try a different spelling, or search by phone.'
              : spaceId
                ? 'No accounts have joined this organization yet.'
                : 'Accounts appear here as people sign up.'
          }
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
          <CountRow shown={shown.length} total={total} noun="account" />

          <ListCard>
            {shown.map((user, i) => {
              const suspended = user.status === 'suspended';
              return (
                <ListRow
                  key={user.id}
                  last={i === shown.length - 1}
                  title={user.displayName ?? 'This account'}
                  actions={[
                    {
                      key: 'status',
                      label: suspended ? 'Restore the account' : 'Suspend the account',
                      icon: suspended ? 'check' : 'lock',
                      destructive: !suspended,
                      onPress: () => setConfirm({ user, next: suspended ? 'active' : 'suspended' }),
                    },
                  ]}
                >
                <Avatar url={user.avatarUrl} name={user.displayName} size={36} />

                <View style={styles.identity}>
                  <View style={styles.nameRow}>
                    <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {user.displayName ?? 'No name'}
                    </Text>
                    {user.role === 'superadmin' ? <Badge label="Super" tone="soft" /> : null}
                    {suspended ? <Badge label="Suspended" tone="danger" /> : null}
                    {user.cheatFlags > 0 ? (
                      <Badge label={`${user.cheatFlags} flags`} tone="soft" />
                    ) : null}
                  </View>
                  <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                    {[
                      user.phone,
                      user.organizations
                        ? `${user.organizations} org${user.organizations === 1 ? '' : 's'}`
                        : 'No organization',
                      `${user.matchesPlayed ?? 0} matches`,
                      user.lastActiveAt ? `seen ${shortDate(user.lastActiveAt)}` : 'never played',
                    ]
                      .filter(Boolean)
                      .join('  ·  ')}
                  </Text>
                </View>

                <Text style={[consoleType.figure, styles.rating]}>
                  {user.rankedRating ?? user.overallRating ?? '—'}
                </Text>

                </ListRow>
              );
            })}
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
        destructive={confirm?.next === 'suspended'}
        icon={confirm?.next === 'suspended' ? 'shield' : 'check'}
        title={
          confirm?.next === 'suspended'
            ? `Suspend ${confirm?.user?.displayName ?? 'this account'}?`
            : `Restore ${confirm?.user?.displayName ?? 'this account'}?`
        }
        body={
          confirm?.next === 'suspended'
            ? 'They cannot sign in or play until restored. Nothing of theirs is deleted.'
            : 'They can sign in and play again straight away.'
        }
        confirmLabel={confirm?.next === 'suspended' ? 'Suspend' : 'Restore'}
        loading={Boolean(busyId)}
        onConfirm={() => setUserStatus(confirm.user, confirm.next)}
        onCancel={() => setConfirm(null)}
      />
    </SafeAreaView>
  );
}

/** "12 Mar" — enough to judge recency without a column of timestamps. */
function shortDate(at) {
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  controls: { paddingHorizontal: consoleLayout.gutter, paddingTop: space.sm, gap: space.sm },
  list: { paddingHorizontal: consoleLayout.gutter, paddingBottom: space.xxxl },
  identity: { flex: 1, minWidth: 0, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  rating: { color: colors.inkMuted, minWidth: 42, textAlign: 'right' },
});

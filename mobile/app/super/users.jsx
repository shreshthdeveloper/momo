import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
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
  Sheet,
  Stat,
  Tabs,
  ConsoleControls,
  CountRow,
  ListRow,
  useScrollBottom,
} from '../../src/components/ui.jsx';
import { ListSkeleton } from '../../src/components/Skeletons.jsx';
import { colors, consoleLayout, consoleType, layout, space } from '../../src/theme/console.js';

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
  const scrollBottom = useScrollBottom();
  const goBack = useConsoleBack();
  const params = useLocalSearchParams();
  const [status, setStatus] = useState('active');
  const [query, setQuery] = useState('');
  /**
   * `orgId`, not `spaceId`. The platform console's rule is that its routes
   * never carry a spaceId — that param means "act inside this space" to
   * `useConsoleSpace`, and this is a filter on a platform-wide table, not a
   * change of scope. Naming it differently keeps the two from being confused
   * by the next person to read either.
   *
   * Arriving from an organization's row lands here already narrowed to it,
   * which is the whole point of that door.
   */
  const pushedFromOrg = typeof params.orgId === 'string' && params.orgId.length > 0;
  const [spaceId, setSpaceId] = useState(() => (pushedFromOrg ? params.orgId : null));
  const [orgs, setOrgs] = useState([]);
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  /** The account being read. Its own sheet, and the way to the one below. */
  const [detail, setDetail] = useState(null);
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
  /**
   * The name comes with the link when there is one, so the header reads
   * "240 in Prime Academy" from the first frame rather than claiming the whole
   * platform until the organizations list happens to arrive.
   */
  const orgName =
    orgs.find((o) => o.id === spaceId)?.name ??
    (spaceId && typeof params.orgName === 'string' ? params.orgName : null);

  return (
    <SafeAreaView style={styles.screen} edges={[]}>
      <Header
        title="Users"
        subtitle={orgName ? `${total} in ${orgName}` : `${total} on the platform`}
        // Sidebar row when opened from the sidebar, pushed screen when opened
        // from an organization — the corner follows how you arrived.
        onBack={pushedFromOrg ? goBack : undefined}
      />

      {/* Status is where you ARE in this table, so it is tabs at the top — the
          same shape the roster and the question bank wear. */}
      <Tabs options={STATUSES} value={status} onChange={setStatus} />

      <ConsoleControls>
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
      </ConsoleControls>

      <ErrorNotice error={error} onRetry={load} />

      {!rows && !error ? (
        <ListSkeleton rows={9} />
      ) : shown.length === 0 ? (
        <EmptyState
          tone="people"
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
        /**
         * Virtualized, because this table's whole job is that there are a lot
         * of them: 50 arrive per page and "Load more" APPENDS, so a `.map()`
         * inside a `ScrollView` kept every account ever loaded mounted — each
         * one an avatar, three badges and a row of figures. The operator who
         * scrolls furthest is the one the screen punished hardest.
         */
        <FlatList
          data={shown}
          keyExtractor={(user) => user.id}
          renderItem={({ item, index }) => (
            <UserRow
              user={item}
              first={index === 0}
              last={index === shown.length - 1}
              onOpen={setDetail}
            />
          )}
          contentContainerStyle={[styles.list, { paddingBottom: scrollBottom }]}
          showsVerticalScrollIndicator={false}
          initialNumToRender={12}
          windowSize={7}
          removeClippedSubviews
          ListHeaderComponent={<CountRow shown={shown.length} total={total} noun="account" />}
          ListFooterComponent={
            hasMore ? (
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
            ) : null
          }
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
        />
      )}

      <UserSheet
        user={detail}
        onClose={() => setDetail(null)}
        onSetStatus={(next) => {
          const user = detail;
          setDetail(null);
          setConfirm({ user, next });
        }}
      />

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

/**
 * One account. Memoized so that scrolling — and the confirm sheet opening over
 * the top — does not re-render every row that is still mounted.
 */
const UserRow = memo(function UserRow({ user, first, last, onOpen }) {
  const suspended = user.status === 'suspended';
  return (
    <ListRow
      card
      first={first}
      last={last}
      title={user.displayName ?? 'This account'}
      accessibilityLabel={`${user.displayName ?? 'This account'}, ${user.phone ?? 'no phone'}`}
      /**
       * Pressing an account OPENS the account.
       *
       * This row used to hand its press straight to a menu, and the menu held
       * exactly one item: "Suspend the account". So the only thing tapping a
       * person on this table could do was offer to ban them — no way to read
       * the rest of the line that had been truncated, no way to see when they
       * last played or how many organizations they are in, and every tap one
       * slip away from a destructive verb. The facts come first now, and
       * suspension is a button at the bottom of them.
       */
      onPress={() => onOpen(user)}
    >
      <Avatar url={user.avatarUrl} name={user.displayName} size={36} />

      <View style={styles.identity}>
        <View style={styles.nameRow}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {user.displayName ?? 'No name'}
          </Text>
          {user.role === 'superadmin' ? <Badge label="Super" tone="soft" /> : null}
          {suspended ? <Badge label="Suspended" tone="danger" /> : null}
          {user.cheatFlags > 0 ? <Badge label={`${user.cheatFlags} flags`} tone="soft" /> : null}
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
});

/**
 * One account, read rather than acted on.
 *
 * Everything here is already in the table's own payload — the row simply could
 * not show it. A list line is one truncated sentence: "+91… · 1 org · 28
 * matches · seen 4 Aug" is four facts fighting for forty characters, and on a
 * narrow phone the last two never arrive. So the sheet is the same facts given
 * room, in the order the operator asks them: how much have they played, are
 * they in trouble, when did they join, when were they last here.
 *
 * No fetch. There is no `GET /super/users/:id` and this needs none — inventing
 * one to re-serve fields the list already holds would put a spinner in front of
 * a sheet that can open instantly.
 */
function UserSheet({ user, onClose, onSetStatus }) {
  const suspended = user?.status === 'suspended';
  const flags = user?.cheatFlags ?? 0;

  return (
    <Sheet
      visible={Boolean(user)}
      onClose={onClose}
      accessibilityLabel={user?.displayName ?? 'Account'}
      scroll
    >
      {user ? (
        <>
          <View style={styles.sheetHead}>
            <Avatar url={user.avatarUrl} name={user.displayName} size={64} />
            <Text variant="display" style={{ marginTop: space.md }} numberOfLines={2}>
              {user.displayName ?? 'No name'}
            </Text>
            <View style={styles.sheetBadges}>
              <Badge label={suspended ? 'Suspended' : 'Active'} tone={suspended ? 'danger' : 'live'} />
              {user.role === 'superadmin' ? <Badge label="Superadmin" tone="soft" /> : null}
              {flags > 0 ? (
                <Badge label={`${flags} cheat ${flags === 1 ? 'flag' : 'flags'}`} tone="amber" />
              ) : null}
            </View>
          </View>

          {/* The three figures worth comparing between two accounts. */}
          <View style={styles.sheetStats}>
            <Stat value={user.matchesPlayed ?? 0} label="Matches" />
            <Stat value={user.rankedRating ?? user.overallRating ?? '—'} label="Rating" />
            <Stat value={user.organizations ?? 0} label="Organizations" />
          </View>

          <View style={styles.factCard}>
            <Fact label="Phone" value={user.phone ?? 'Not on file'} />
            <Fact label="Joined" value={longDate(user.createdAt)} />
            <Fact label="Last seen" value={user.lastActiveAt ? longDate(user.lastActiveAt) : 'Never played'} />
            <Fact
              label="Account"
              value={user.role === 'superadmin' ? 'Platform superadmin' : 'Player'}
              last
            />
          </View>

          {/**
           * The one lever, at the bottom, named for what it does. A suspended
           * account is restored with the ordinary primary button — that is the
           * safe direction — and suspending wears the danger outline.
           */}
          <Button
            variant={suspended ? 'primary' : 'danger'}
            icon={suspended ? 'check' : 'lock'}
            label={suspended ? 'Restore the account' : 'Suspend the account'}
            style={{ marginTop: space.lg }}
            onPress={() => onSetStatus(suspended ? 'active' : 'suspended')}
          />
          <Text variant="meta" color={colors.inkFaint} style={styles.sheetNote}>
            {suspended
              ? 'They can sign in and play again straight away.'
              : 'They cannot sign in or play until restored. Nothing of theirs is deleted.'}
          </Text>
        </>
      ) : null}
    </Sheet>
  );
}

/** One labelled fact. The sheet's whole body is a stack of these. */
function Fact({ label, value, last = false }) {
  return (
    <View style={[styles.fact, last && { borderBottomWidth: 0 }]}>
      <Text variant="meta" color={colors.inkFaint}>
        {label}
      </Text>
      <Text variant="bodyStrong" numberOfLines={1} style={styles.factValue}>
        {value}
      </Text>
    </View>
  );
}

/** "12 Mar 2026" — a date being read once, not scanned down a column. */
function longDate(at) {
  if (!at) return '—';
  return new Date(at).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "12 Mar" — enough to judge recency without a column of timestamps. */
function shortDate(at) {
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  list: { paddingHorizontal: consoleLayout.gutter, paddingTop: space.md },
  identity: { flex: 1, minWidth: 0, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  rating: { color: colors.inkMuted, minWidth: 42, textAlign: 'right' },

  // ── The account sheet ─────────────────────────────────────────────────────
  sheetHead: { alignItems: 'center', paddingBottom: space.lg },
  sheetBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space.xs,
    marginTop: space.sm,
  },
  sheetStats: {
    flexDirection: 'row',
    backgroundColor: colors.canvas,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingVertical: space.md,
    marginBottom: space.md,
  },
  factCard: {
    backgroundColor: colors.canvas,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: space.lg,
  },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    minHeight: 46,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  factValue: { flexShrink: 1, textAlign: 'right' },
  sheetNote: { marginTop: space.sm, textAlign: 'center' },
});

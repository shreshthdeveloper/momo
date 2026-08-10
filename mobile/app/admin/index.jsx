import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useAdminSpace } from '../../src/lib/admin.js';
import {
  Text,
  ErrorNotice,
  EmptyState,
  Header,
  IconDisc,
  StatPanel,
  useScrollBottom,
} from '../../src/components/ui.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import Icon from '../../src/components/Icon.jsx';
import { colors, consoleLayout, layout, space } from '../../src/theme/console.js';

/**
 * The organization's control room, in the app — the same features the web portal
 * carries (prd.md §8), arranged for a phone: the numbers first, then the
 * things demanding action, then the doors to each job.
 *
 * Every number here comes off /admin/dashboard, the endpoint the web
 * dashboard reads, so the two can never disagree.
 */
/**
 * The four things an admin starts a session by doing.
 *
 * This screen used to be a scrolling list of TEN cards, each with a saturated
 * icon tile in a different hue — a rainbow of chips down a dark screen, one per
 * row, none more important than any other. It was a second copy of the sidebar,
 * drawn larger and in colour, and it pushed the numbers off the top of the
 * screen the moment you looked at it.
 *
 * The sidebar already lists everything, so an overview does not have to. What
 * it should be is: how is the organization doing, what needs a decision, and
 * the shortest path to the handful of things you actually start with. Four
 * tiles in a grid, in one colour, because they are peers.
 */
/**
 * `tone` is the domain each door belongs to, and it is the same hue that row
 * wears in the sidebar. Four tiles, four colours, one each — this is where the
 * screen spends its colour, and everything around it stays paper-quiet.
 */
const QUICK = [
  { href: '/admin/review', icon: 'check', title: 'Review queue', sub: 'Publish or reject', tone: 'content' },
  { href: '/admin/questions', icon: 'book', title: 'Question bank', sub: 'Write and edit', tone: 'content' },
  { href: '/admin/students', icon: 'friends', title: 'Students', sub: 'Roster and approvals', tone: 'people' },
  { href: '/admin/contests', icon: 'trophy', title: 'Contests', sub: 'Schedule and finalise', tone: 'learning' },
];

export default function AdminHome() {
  const scrollBottom = useScrollBottom();
  const router = useRouter();
  const adminSpace = useAdminSpace();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    if (!adminSpace) return;
    try {
      setError(null);
      setData(await api.get('/admin/dashboard', { spaceId: adminSpace.id, days: 30 }));
    } catch (err) {
      setError(err);
    }
  }, [adminSpace]);

  useEffect(() => {
    load();
  }, [load]);

  if (!adminSpace) {
    return (
      <SafeAreaView style={styles.screen} edges={[]}>
        <Header title="Admin" />
        <EmptyState
          icon="alert"
          title="No organization to manage"
          body="This console appears when an organization has made you an admin."
        />
      </SafeAreaView>
    );
  }

  const summary = data?.summary;
  const alerts = data?.alerts ?? [];

  return (
    <SafeAreaView style={styles.screen} edges={[]}>
      {/* The face in the corner carries the account — who is signed in, and
          the one action that belongs to a session rather than a screen. */}
      <Header title={adminSpace.name} subtitle="Admin console" />

      <ErrorNotice error={error} onRetry={load} />

      {!data && !error ? (
        <CardsSkeleton count={3} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: scrollBottom }]}
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
          {/**
           * ── The numbers, in two titled panels ─────────────────────────────
           *
           * They were six figures in one bordered box split by a hairline —
           * legible, and mute. Nothing said which of the six belonged together
           * or what any of them was about, so the first thing on the screen was
           * also the thing that took longest to read.
           *
           * Two panels, named and coloured by domain, in the order the
           * questions come in: is anybody here, and is there anything for them
           * to play. Every figure is still a door to the list behind it.
           */}
          <StatPanel
            label="People"
            icon="friends"
            tone="people"
            stats={[
              {
                value: summary?.students ?? 0,
                label: 'Students',
                onPress: () => router.push('/admin/students'),
              },
              {
                value: summary?.activeThisWeek ?? 0,
                label: 'Active, 7d',
                onPress: () => router.push('/admin/reports'),
              },
              {
                value: summary?.activeToday ?? 0,
                label: 'Active today',
                onPress: () => router.push('/admin/reports'),
              },
            ]}
          />

          <StatPanel
            label="Content and play"
            icon="book"
            tone="content"
            style={{ marginTop: layout.cardGap }}
            stats={[
              {
                value: summary?.questionsInBank ?? 0,
                label: 'Questions live',
                // Straight to the published questions — the figure IS that
                // filter, so an unfiltered bank would make the operator
                // re-derive what they just tapped.
                onPress: () =>
                  router.push({ pathname: '/admin/questions', params: { status: 'published' } }),
              },
              {
                value: summary?.matchesPlayed ?? 0,
                label: 'Matches, 30d',
                onPress: () => router.push('/admin/reports'),
              },
              {
                value: summary?.avgAccuracy != null ? `${summary.avgAccuracy}%` : '—',
                label: 'Avg accuracy',
                onPress: () => router.push('/admin/reports'),
              },
            ]}
          />

          {/* ── What needs a decision, straight off the alerts feed. */}
          {alerts.length > 0 ? (
            <View style={styles.block}>
              <Text variant="label" color={colors.inkMuted} style={styles.blockLabel}>
                Needs you
              </Text>
              <View style={styles.alerts}>
                {alerts.map((alert) => (
                  <Pressable
                    key={alert.key}
                    style={({ pressed }) => [styles.alert, alert.severity === 'action' ? styles.alertAction : styles.alertWarning, pressed && { opacity: 0.7 }]}
                    onPress={() => router.push(hrefFor(alert.key))}
                    accessibilityRole="button"
                  >
                    <Icon
                      name={alert.severity === 'action' ? 'bolt' : 'alert'}
                      size={15}
                      color={alert.severity === 'action' ? colors.accent : colors.wrong}
                    />
                    <Text variant="label" style={{ flex: 1 }} color={colors.ink}>
                      {alert.text}
                    </Text>
                    <Icon name="chevronRight" size={13} color={colors.inkFaint} />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {/* ── The four starting points. Everything else is in the menu. */}
          <View style={styles.block}>
            <Text variant="label" color={colors.inkMuted} style={styles.blockLabel}>
              Jump to
            </Text>
            <View style={styles.grid}>
              {QUICK.map((item) => (
                <Pressable
                  key={item.href}
                  style={({ pressed }) => [styles.tile, pressed && { backgroundColor: colors.canvas }]}
                  onPress={() => router.push(item.href)}
                  accessibilityRole="button"
                  accessibilityLabel={item.title}
                >
                  <IconDisc name={item.icon} tone={item.tone} size={38} style={styles.tileIcon} />
                  <Text variant="label" numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                    {item.sub}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text variant="meta" color={colors.inkFaint} style={styles.menuHint}>
              Everything else — topics, batches, assignments, imports, reports, settings — is in the
              menu.
            </Text>
          </View>
        </ScrollView>
      )}

    </SafeAreaView>
  );
}

/** The alerts feed uses web-portal hrefs; map each key to its app screen. */
function hrefFor(key) {
  switch (key) {
    case 'approvals':
      return { pathname: '/admin/students', params: { status: 'pending' } };
    case 'review':
      return '/admin/review';
    case 'contests_soon':
      return '/admin/contests';
    case 'assignments_overdue':
      return '/admin/assignments';
    case 'thin_topics':
      return '/admin/topics';
    case 'reports':
      // The queue where a report can actually be read and cleared. This used
      // to open the question bank, which shows a count per row and offers no
      // way to see a reason or resolve anything — so the alert could never be
      // cleared from inside the app.
      return '/admin/moderation';
    default:
      return '/admin';
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  content: { padding: consoleLayout.gutter, paddingTop: space.md },
  block: { marginTop: space.xl },
  blockLabel: { marginBottom: space.sm },
  alerts: { gap: space.sm },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: layout.radiusInput,
    padding: space.md,
    minHeight: 48,
  },
  alertAction: { backgroundColor: colors.accentSoft },
  alertWarning: { backgroundColor: colors.wrongSoft },
  /**
   * Two up. A grid says "these are peers, pick one"; the column of full-width
   * cards this replaced said "here is a list, keep scrolling" — which is the
   * sidebar's job, and the sidebar does it better.
   */
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: layout.cardGap },
  tile: {
    // Two per row: grow into the space, but never narrower than 150 — on a
    // wide screen they simply fit more per row.
    flexGrow: 1,
    flexBasis: 150,
    minWidth: 150,
    gap: 2,
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: layout.cardPadding,
  },
  tileIcon: { marginBottom: space.sm },
  menuHint: { marginTop: space.md },
});

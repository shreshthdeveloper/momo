import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useAdminSpace } from '../../src/lib/admin.js';
import { Text, ErrorNotice, EmptyState, Header } from '../../src/components/ui.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import Icon from '../../src/components/Icon.jsx';
import { colors, consoleLayout, elevation, layout, space, type } from '../../src/theme/index.js';

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
const QUICK = [
  { href: '/admin/review', icon: 'check', title: 'Review queue', sub: 'Publish or reject' },
  { href: '/admin/questions', icon: 'book', title: 'Question bank', sub: 'Write and edit' },
  { href: '/admin/students', icon: 'friends', title: 'Students', sub: 'Roster and approvals' },
  { href: '/admin/contests', icon: 'trophy', title: 'Contests', sub: 'Schedule and finalise' },
];

export default function AdminHome() {
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
      <SafeAreaView style={styles.screen} edges={['top']}>
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
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* The face in the corner carries the account — who is signed in, and
          the one action that belongs to a session rather than a screen. */}
      <Header title={adminSpace.name} subtitle="Admin console" />

      <ErrorNotice error={error} onRetry={load} />

      {!data && !error ? (
        <CardsSkeleton count={3} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
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
           * ── The numbers, as one panel.
           *
           * Six of them in two floating bars used to read as two unrelated
           * widgets; they are one answer to one question. People first, then
           * the bank, then how it is going — the order the questions come in.
           */}
          <View style={[styles.stats, elevation.raised]}>
            <View style={styles.statsRow}>
              <Metric value={summary?.students ?? 0} label="Students" />
              <View style={styles.divider} />
              <Metric value={summary?.activeThisWeek ?? 0} label="Active this week" />
              <View style={styles.divider} />
              <Metric value={summary?.activeToday ?? 0} label="Active today" />
            </View>
            <View style={styles.statsSplit} />
            <View style={styles.statsRow}>
              <Metric value={summary?.questionsInBank ?? 0} label="Questions live" />
              <View style={styles.divider} />
              <Metric value={summary?.matchesPlayed ?? 0} label="Matches, 30d" />
              <View style={styles.divider} />
              <Metric
                value={summary?.avgAccuracy != null ? `${summary.avgAccuracy}%` : '—'}
                label="Avg accuracy"
              />
            </View>
          </View>

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
                  <View style={styles.tileIcon}>
                    <Icon name={item.icon} size={18} color={colors.accent} />
                  </View>
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

function Metric({ value, label }) {
  return (
    <View style={styles.metric}>
      <Text style={[type.timer, { color: colors.ink }]} numberOfLines={1}>
        {value}
      </Text>
      <Text variant="tiny" color={colors.inkFaint} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  content: { padding: consoleLayout.gutter, paddingTop: space.md, paddingBottom: space.xxxl },
  stats: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingVertical: space.lg,
  },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statsSplit: {
    height: 1,
    backgroundColor: colors.hairline,
    marginVertical: space.lg,
    marginHorizontal: layout.cardPadding,
  },
  metric: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: 4 },
  divider: { width: 1, height: 30, backgroundColor: colors.hairline },
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
  tileIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
    marginBottom: space.sm,
  },
  menuHint: { marginTop: space.md },
});

import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useAdminSpace } from '../../src/lib/admin.js';
import ConsoleHeader from '../../src/components/ConsoleHeader.jsx';
import { Text, ErrorNotice, EmptyState } from '../../src/components/ui.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import Icon from '../../src/components/Icon.jsx';
import { colors, elevation, layout, space, type } from '../../src/theme/index.js';

/**
 * The organization's control room, in the app — the same features the web portal
 * carries (prd.md §8), arranged for a phone: the numbers first, then the
 * things demanding action, then the doors to each job.
 *
 * Every number here comes off /admin/dashboard, the endpoint the web
 * dashboard reads, so the two can never disagree.
 */
/* Students, the question bank and reports live in the dock; the rest of the
   jobs open from here. */
const SECTIONS = [
  { href: '/admin/review', icon: 'check', tint: colors.optionD, title: 'Review queue', sub: 'Publish or reject waiting questions' },
  { href: '/admin/topics', icon: 'grid', tint: colors.accent, title: 'Topics', sub: 'Categories, covers, what goes live' },
  { href: '/admin/import', icon: 'plus', tint: colors.optionC, title: 'Import questions', sub: 'Bring a CSV bank in' },
  { href: '/admin/contests', icon: 'clock', tint: colors.optionC, title: 'Contests', sub: 'Schedule, monitor, finalise' },
  { href: '/admin/assignments', icon: 'flag', tint: colors.optionB, title: 'Assignments', sub: 'Set work, track completion' },
  { href: '/admin/invite', icon: 'share', tint: colors.accent, title: 'Invite code', sub: 'Bring students in' },
  { href: '/admin/settings', icon: 'gear', tint: colors.optionD, title: 'Organization settings', sub: 'Branding, joining, plan, admin team' },
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
        <ConsoleHeader title="Admin" />
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
      <ConsoleHeader title={adminSpace.name} subtitle="Admin console" />

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
          {/* ── The numbers. */}
          <View style={[styles.stats, elevation.raised]}>
            <Metric value={summary?.students ?? 0} label="Students" />
            <View style={styles.divider} />
            <Metric value={summary?.activeThisWeek ?? 0} label="Active this week" />
            <View style={styles.divider} />
            <Metric value={summary?.matchesPlayed ?? 0} label="Matches, 30d" />
          </View>
          <View style={[styles.stats, styles.statsSecond, elevation.raised]}>
            <Metric value={summary?.questionsInBank ?? 0} label="Questions live" />
            <View style={styles.divider} />
            <Metric
              value={summary?.avgAccuracy != null ? `${summary.avgAccuracy}%` : '—'}
              label="Avg accuracy"
            />
            <View style={styles.divider} />
            <Metric value={summary?.activeToday ?? 0} label="Active today" />
          </View>

          {/* ── What needs a decision, straight off the alerts feed. */}
          {alerts.length > 0 ? (
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
          ) : null}

          {/* ── The jobs. */}
          {SECTIONS.map((section) => (
            <Pressable
              key={section.href}
              style={({ pressed }) => [styles.section, elevation.raised, pressed && { backgroundColor: colors.sunken }]}
              onPress={() => router.push(section.href)}
              accessibilityRole="button"
              accessibilityLabel={section.title}
            >
              <View style={[styles.sectionIcon, { backgroundColor: section.tint }]}>
                <Icon name={section.icon} size={18} color={colors.onColor} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="label">{section.title}</Text>
                <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                  {section.sub}
                </Text>
              </View>
              <Icon name="chevronRight" size={14} color={colors.inkFaint} />
            </Pressable>
          ))}
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
      return '/admin/questions';
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
  content: { padding: layout.gutter, paddingTop: space.sm, paddingBottom: space.xxxl },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.canvas,
    borderRadius: layout.radiusCard,
    paddingVertical: space.lg,
  },
  statsSecond: { marginTop: layout.cardGap },
  metric: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: 4 },
  divider: { width: 1, height: 30, backgroundColor: colors.hairline },
  alerts: { marginTop: space.lg, gap: space.sm },
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
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.canvas,
    borderRadius: layout.radiusCard,
    padding: space.lg,
    marginTop: layout.cardGap,
    minHeight: 72,
  },
  sectionIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

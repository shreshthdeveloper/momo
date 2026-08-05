import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useIsSuperadmin } from '../../src/lib/admin.js';
import { Text, Badge, Card, ErrorNotice, Header, useScrollBottom } from '../../src/components/ui.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import Icon from '../../src/components/Icon.jsx';
import { colors, consoleLayout, consoleType, elevation, layout, space, type } from '../../src/theme/index.js';

/**
 * The platform operator's control room. One person oversees every tenant, so
 * the screen reads top to bottom the way the job does: is the product being
 * used (DAU/MAU), is matchmaking finding real people (ghost ratio and topic
 * liquidity), is the machine upright (system), then the doors to each job.
 *
 * The server 403s non-superadmins on every /super route; the gate here only
 * decides what to render. Nothing on this screen is space-scoped — the
 * platform view deliberately has no spaceId anywhere.
 */
const GHOST_TARGET = 0.6;

/** The four the operator starts with. Everything else is in the sidebar. */
const QUICK = [
  { href: '/super/tenants', icon: 'building', title: 'Organizations', sub: 'Approvals, plans' },
  { href: '/super/moderation', icon: 'shield', title: 'Moderation', sub: 'Reports and flags' },
  { href: '/super/users', icon: 'friends', title: 'Users', sub: 'Every account' },
  { href: '/super/central', icon: 'book', title: 'Central bank', sub: 'Topics and featuring' },
];

export default function SuperHome() {
  const scrollBottom = useScrollBottom();
  const router = useRouter();
  const isSuper = useIsSuperadmin();
  const [analytics, setAnalytics] = useState(null);
  const [liquidity, setLiquidity] = useState(null);
  const [system, setSystem] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!isSuper) router.replace('/');
  }, [isSuper, router]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [a, l, s] = await Promise.all([
        api.get('/super/analytics'),
        api.get('/super/analytics/liquidity'),
        api.get('/super/system'),
      ]);
      setAnalytics(a);
      setLiquidity(l.items ?? []);
      setSystem(s);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    if (isSuper) load();
  }, [isSuper, load]);

  // The system card is a live reading, so it refreshes itself — but only
  // while the operator is actually looking at it. A silent failure keeps the
  // last reading rather than replacing the screen with an error.
  const pollSystem = useCallback(async () => {
    try {
      setSystem(await api.get('/super/system'));
    } catch {
      // Keep the previous reading; the next tick or a manual refresh recovers.
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!isSuper) return undefined;
      const timer = setInterval(pollSystem, 20_000);
      return () => clearInterval(timer);
    }, [isSuper, pollSystem]),
  );

  if (!isSuper) return null;

  const series = analytics?.series ?? [];
  const maxMatches = Math.max(1, ...series.map((d) => d.matches));
  const todayGhost = series.length ? Math.round((series[series.length - 1].ghostRatio ?? 0) * 100) : null;
  const ghostHigh = (analytics?.ghostRatio ?? 0) > GHOST_TARGET;
  const thin = (liquidity ?? []).filter((t) => !t.healthy);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Platform" subtitle="Mimo operations" />

      <ErrorNotice error={error} onRetry={load} />

      {!analytics && !error ? (
        <CardsSkeleton count={4} />
      ) : !analytics ? null : (
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
          {/* ── The numbers, as one panel rather than two floating bars — the
                 same shape the organization console's overview wears. */}
          <View style={[styles.stats, elevation.raised]}>
            <View style={styles.statsRow}>
              <Metric value={analytics.dau ?? 0} label="DAU" />
              <View style={styles.statDivider} />
              <Metric value={analytics.mau ?? 0} label="MAU" />
              <View style={styles.statDivider} />
              <Metric
                value={`${Math.round((analytics.dauOverMau ?? 0) * 100)}%`}
                label="Stickiness"
                sub="DAU over MAU"
              />
            </View>
            <View style={styles.statsSplit} />
            <View style={styles.statsRow}>
              <Metric value={analytics.totalUsers ?? 0} label="Registered" />
              <View style={styles.statDivider} />
              <Metric value={analytics.activeSpaces ?? 0} label="Active orgs" />
              <View style={styles.statDivider} />
              <Metric
                value={`${Math.round((analytics.ghostRatio ?? 0) * 100)}%`}
                label="Ghost ratio"
                sub={ghostHigh ? 'above target' : 'healthy'}
                subColor={ghostHigh ? colors.optionC : colors.inkFaint}
              />
            </View>
          </View>

          {/* ── Where the operator goes next. The sidebar lists everything;
                 these are the four that start a session. */}
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

          {/* ── Matches, day by day. */}
          <Card style={styles.card}>
            <Text variant="label">Matches — last 30 days</Text>
            <View style={styles.bars}>
              {series.map((d) => (
                <View
                  key={d.date}
                  style={[styles.bar, { height: Math.max(3, Math.round((d.matches / maxMatches) * 64)) }]}
                />
              ))}
            </View>
            {todayGhost != null ? (
              <Text variant="meta" color={colors.inkFaint}>
                Ghost share today {todayGhost}%
              </Text>
            ) : null}
          </Card>

          {/* ── Where matchmaking is finding real people, and where it is not. */}
          <Card style={styles.card}>
            <Text variant="label">Topic liquidity</Text>
            {thin.length > 0 ? (
              <View style={styles.thinBanner}>
                <Icon name="alert" size={15} color={colors.optionC} />
                <Text variant="meta" color={colors.ink} style={{ flex: 1 }}>
                  {thin.length} {thin.length === 1 ? 'topic' : 'topics'} above 60% ghost ratio — not
                  enough real players at those hours.
                </Text>
              </View>
            ) : null}
            {(liquidity ?? []).length === 0 ? (
              <Text variant="meta" color={colors.inkFaint} style={{ marginTop: space.sm }}>
                Ranks topics once each has 5 matches in a week.
              </Text>
            ) : (
              /**
               * Thin topics first — they are the only rows that ask anything
               * of the operator. Four columns of identical grey text meant the
               * one unhealthy topic in a list of twenty looked exactly like
               * the nineteen that were fine.
               */
              [...liquidity]
                .sort((a, b) => Number(a.healthy) - Number(b.healthy))
                .map((topic) => (
                  <View key={topic.topicId} style={styles.liquidityRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text variant="label" numberOfLines={1}>
                        {topic.name}
                      </Text>
                      <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                        {topic.matches} {topic.matches === 1 ? 'match' : 'matches'} this week
                      </Text>
                    </View>
                    <Text
                      style={styles.ghostFigure}
                      color={topic.healthy ? colors.inkMuted : colors.optionC}
                    >
                      {Math.round((topic.ghostRatio ?? 0) * 100)}%
                    </Text>
                    {topic.healthy ? null : <Badge label="thin" tone="amber" />}
                  </View>
                ))
            )}
          </Card>

          {/* ── The machine. Refreshes itself every 20s while focused. */}
          <Card style={styles.card}>
            <Text variant="label" style={{ marginBottom: space.sm }}>
              System
            </Text>
            <SysRow label="Live matches" value={system?.game?.liveMatches ?? '—'} />
            <SysRow label="Players in match" value={system?.game?.playersInMatch ?? '—'} />
            <SysRow label="Connected" value={system?.game?.connectedUsers ?? '—'} />
            <SysRow label="Matches today" value={system?.matchesToday ?? '—'} />
            <SysRow
              label="Stale live records"
              value={
                (system?.staleLiveRecords ?? 0) > 0
                  ? `${system.staleLiveRecords} — attention`
                  : '0'
              }
              tone={(system?.staleLiveRecords ?? 0) > 0 ? colors.optionC : colors.ink}
            />
            <SysRow
              label="Completion rate"
              value={`${Math.round((analytics.matchCompletionRate ?? 0) * 100)}%`}
            />
            <SysRow
              label="Memory"
              value={
                system?.memory ? `${system.memory.rssMb} MB rss · ${system.memory.heapUsedMb} MB heap` : '—'
              }
            />
            <SysRow
              label="Uptime"
              value={system?.uptimeSeconds != null ? `${Math.floor(system.uptimeSeconds / 60)} min` : '—'}
            />
            <SysRow label="Node" value={system?.nodeVersion ?? '—'} last />
          </Card>

        </ScrollView>
      )}

    </SafeAreaView>
  );
}

function Metric({ value, label, sub, subColor = colors.inkFaint }) {
  return (
    <View style={styles.metric}>
      <Text style={[type.timer, { color: colors.ink }]} numberOfLines={1}>
        {value}
      </Text>
      <Text variant="tiny" color={colors.inkFaint} numberOfLines={1}>
        {label}
      </Text>
      {sub ? (
        <Text variant="tiny" color={subColor} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

function SysRow({ label, value, tone = colors.ink, last = false }) {
  return (
    <View style={[styles.sysRow, last && { borderBottomWidth: 0 }]}>
      <Text variant="meta" color={colors.inkMuted}>
        {label}
      </Text>
      <Text variant="label" color={tone} style={styles.tabular} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  content: { padding: consoleLayout.gutter, paddingTop: space.sm },
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
  statDivider: { width: 1, height: 30, backgroundColor: colors.hairline },
  // The same tile grid the organization console's overview uses — two consoles
  // that look like one product.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: layout.cardGap, marginTop: space.xl },
  tile: {
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
  ghostFigure: { ...consoleType.figure, minWidth: 44, textAlign: 'right' },
  card: { marginTop: space.xl },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 64,
    marginTop: space.md,
    marginBottom: space.sm,
  },
  bar: { flex: 1, backgroundColor: colors.accent, borderRadius: 2 },
  thinBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.amberSoft,
    borderRadius: layout.radiusInput,
    padding: space.md,
    marginTop: space.sm,
  },
  liquidityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 40,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    paddingVertical: space.xs,
  },
  tabular: { fontVariant: ['tabular-nums'] },
  sysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    minHeight: 34,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
});

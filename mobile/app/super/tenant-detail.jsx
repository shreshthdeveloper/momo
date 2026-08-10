import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { api } from '../../src/lib/api.js';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import {
  Text,
  Avatar,
  Badge,
  ConfirmSheet,
  ErrorNotice,
  Header,
  IconDisc,
  ProgressBar,
  PromptSheet,
  RowMenu,
  StatPanel,
  useScrollBottom,
} from '../../src/components/ui.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import Icon from '../../src/components/Icon.jsx';
import { colors, consoleLayout, elevation, fonts, layout, space } from '../../src/theme/console.js';

/**
 * One organization, in full.
 *
 * ── Why this screen exists ──────────────────────────────────────────────────
 *
 * The organizations list has always been the only view of a tenant, and a list
 * row can hold about six facts. So the operator could read a name, a plan, a
 * seat count and a creation date — and nothing about the thing an organization
 * actually IS: how many students it has, whether they are playing, how many
 * topics and questions it has built, whether anything is waiting for its
 * admins. Every one of those numbers already existed; `/admin/dashboard`
 * computes them for the organization's own console, and `resolveScope` has
 * always given a superadmin full scope on any space. They had simply never been
 * asked for from this side.
 *
 * ── Three panels, three questions ───────────────────────────────────────────
 *
 * People, Content and Play — is anybody here, is there anything to play, and
 * are they playing it. A tenant in trouble fails one of those three and the
 * panel it fails in is the diagnosis: seats filled but nobody active is an
 * onboarding problem; students active but no questions is a content problem.
 *
 * ── And then the doors ──────────────────────────────────────────────────────
 *
 * Reading is half of it. The rows under the panels open the organization's own
 * content INSIDE the platform console — its topics, its bank, its review queue,
 * its log — by handing `spaceId` to the same screens the Central Bank uses. See
 * `useConsoleSpace`, which now takes that param under `/super` as well.
 */
export default function TenantDetail() {
  const router = useRouter();
  const goBack = useConsoleBack();
  const scrollBottom = useScrollBottom();
  const params = useLocalSearchParams();
  const spaceId = typeof params.id === 'string' ? params.id : null;
  /**
   * The name arrives with the link, so the header is right on the first frame
   * rather than saying "Organization" until three requests land.
   */
  const passedName = typeof params.name === 'string' ? params.name : null;

  const [settings, setSettings] = useState(null); // space, plan, admins
  const [dash, setDash] = useState(null); // summary, alerts
  const [topics, setTopics] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [busy, setBusy] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportResult, setSupportResult] = useState(null);
  const [sheetError, setSheetError] = useState(null);

  const load = useCallback(async () => {
    if (!spaceId) return;
    try {
      setError(null);
      /**
       * Three calls, in parallel, and all three are the organization's OWN
       * endpoints scoped by `spaceId` — `resolveScope` has always given a
       * superadmin full scope on any space, so nothing platform-side is needed
       * to read a tenant. There is no `/super/spaces/:id`, and the first draft
       * of this listed all two hundred organizations to pick one row out of
       * them; `/admin/settings` carries the same tenancy facts (status, plan,
       * seats, brand) for one space.
       *
       * `.catch(() => null)` on each: a tenant whose dashboard aggregation
       * fails should still show its plan and its team rather than one error
       * where the whole screen was.
       */
      const [set, dashboard, topicList] = await Promise.all([
        api.get('/admin/settings', { spaceId }).catch(() => null),
        api.get('/admin/dashboard', { spaceId, days: 30 }).catch(() => null),
        api.get('/admin/topics', { spaceId }).catch(() => null),
      ]);
      setSettings(set);
      setDash(dashboard);
      setTopics(topicList?.items ?? null);
    } catch (err) {
      setError(err);
    }
  }, [spaceId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (!spaceId) setError(new Error('No organization was named. Go back and pick one.'));
  }, [spaceId]);

  const decide = async (decision, reason) => {
    setBusy(true);
    try {
      setSheetError(null);
      await api.post(`/super/spaces/${spaceId}/decision`, reason ? { decision, reason } : { decision });
      setSuspendOpen(false);
      await load();
    } catch (err) {
      if (suspendOpen) setSheetError(err);
      else setError(err);
    } finally {
      setBusy(false);
    }
  };

  const logSupportAccess = async (reason) => {
    setBusy(true);
    try {
      setSheetError(null);
      const data = await api.post(`/super/spaces/${spaceId}/impersonate`, { reason });
      setSupportOpen(false);
      setSupportResult(data);
    } catch (err) {
      setSheetError(err);
    } finally {
      setBusy(false);
    }
  };

  const org = settings?.space;
  const name = org?.name ?? passedName ?? 'Organization';
  const status = org?.status;
  const summary = dash?.summary;
  const plan = settings?.plan;
  const seatsUsed = plan?.seatsUsed ?? 0;
  const seatLimit = plan?.seatLimit ?? null;
  const liveTopics = (topics ?? []).filter((t) => t.readiness?.isLive).length;
  const loaded = Boolean(settings || dash || topics);

  /** Whatever this organization's admins are being asked to deal with. */
  const alerts = dash?.alerts ?? [];

  /**
   * Its own content, opened here rather than in the organization's console.
   * `spaceName` rides along so every one of those screens says whose bank it
   * is showing instead of "Platform access".
   */
  const into = (route, extra) => ({
    pathname: `/super/${route}`,
    params: { ...extra, spaceId, spaceName: name },
  });

  return (
    <SafeAreaView style={styles.screen} edges={[]}>
      <Header
        title={name}
        subtitle={org?.slug}
        onBack={goBack}
        right={
          status ? (
            <RowMenu
              tone="onColor"
              title={name}
              label={`Actions for ${name}`}
              actions={[
                status === 'pending'
                  ? { key: 'approve', label: 'Approve', icon: 'check', onPress: () => decide('approve') }
                  : null,
                status === 'suspended'
                  ? {
                      key: 'reactivate',
                      label: 'Reactivate',
                      icon: 'check',
                      onPress: () => decide('reactivate'),
                    }
                  : null,
                status === 'active'
                  ? {
                      key: 'support',
                      label: 'Log support access',
                      meta: "Written to this organization's own audit log",
                      icon: 'shield',
                      onPress: () => {
                        setSheetError(null);
                        setSupportOpen(true);
                      },
                    }
                  : null,
                status === 'active'
                  ? {
                      key: 'suspend',
                      label: 'Suspend the organization',
                      meta: 'Students and admins lose access',
                      icon: 'lock',
                      destructive: true,
                      onPress: () => {
                        setSheetError(null);
                        setSuspendOpen(true);
                      },
                    }
                  : null,
              ]}
            />
          ) : null
        }
      />

      <ErrorNotice error={error} onRetry={load} />

      {!loaded && !error ? (
        <CardsSkeleton count={3} />
      ) : !loaded ? null : (
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
          {/* ── The tenancy itself: who they are and what they are paying for. */}
          <View style={[styles.identity, elevation.raised]}>
            <View style={[styles.logo, { backgroundColor: org?.accentColor ?? colors.accent }]}>
              {org?.logoUrl ? (
                <Image
                  source={{ uri: org.logoUrl }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={160}
                />
              ) : (
                <Text allowFontScaling={false} style={styles.logoInitial}>
                  {name.trim()[0]?.toUpperCase() ?? '?'}
                </Text>
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <View style={styles.nameRow}>
                <Text variant="title" style={{ flexShrink: 1 }} numberOfLines={2}>
                  {name}
                </Text>
                <StatusBadge status={status} />
              </View>
              <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                {[planLabel(plan?.tier), plan?.status, `created ${shortDate(org?.createdAt)}`]
                  .filter(Boolean)
                  .join('  ·  ')}
              </Text>
            </View>
          </View>

          {/**
           * Seats, drawn. A tenancy's one hard limit is the only number here
           * that can be BREACHED, and "240 of 500" is a sentence you have to do
           * arithmetic on; a bar is the same fact at a glance, and it turns
           * amber when the organization is close enough to need a bigger plan.
           */}
          {seatLimit ? (
            <View style={styles.panel}>
              <View style={styles.seatHead}>
                <Text variant="label" color={colors.inkMuted}>
                  Seats
                </Text>
                <Text variant="label" color={seatsUsed / seatLimit >= 0.9 ? colors.optionC : colors.ink}>
                  {seatsUsed} of {seatLimit}
                </Text>
              </View>
              <ProgressBar
                value={seatsUsed}
                max={seatLimit}
                height={8}
                color={seatsUsed / seatLimit >= 0.9 ? colors.optionC : colors.accent}
              />
              {seatsUsed / seatLimit >= 0.9 ? (
                <Text variant="meta" color={colors.optionC} style={{ marginTop: space.sm }}>
                  {seatLimit - seatsUsed === 0
                    ? 'Full. Nobody else can join until the plan grows.'
                    : `${seatLimit - seatsUsed} seats left.`}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* ── What their admins are being asked to deal with. */}
          {alerts.length > 0 ? (
            <View style={styles.block}>
              <Text variant="label" color={colors.inkMuted} style={styles.blockLabel}>
                Waiting on their admins
              </Text>
              <View style={styles.alerts}>
                {alerts.map((alert) => (
                  <View
                    key={alert.key}
                    style={[
                      styles.alert,
                      alert.severity === 'action' ? styles.alertAction : styles.alertWarning,
                    ]}
                  >
                    <Icon
                      name={alert.severity === 'action' ? 'bolt' : 'alert'}
                      size={15}
                      color={alert.severity === 'action' ? colors.accent : colors.wrong}
                    />
                    <Text variant="label" style={{ flex: 1 }}>
                      {alert.text}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* The same three panels the two overview screens are built from —
              one component, so a tenant reads like the platform reads. */}
          <StatPanel
            label="People"
            icon="friends"
            tone="people"
            style={styles.panelGap}
            stats={[
              { value: summary?.students ?? 0, label: 'Students' },
              { value: summary?.activeThisWeek ?? 0, label: 'Active, 7d' },
              { value: summary?.activeToday ?? 0, label: 'Active today' },
            ]}
          />

          <StatPanel
            label="Content"
            icon="book"
            tone="content"
            style={styles.panelGap}
            stats={[
              { value: topics?.length ?? 0, label: 'Topics' },
              { value: liveTopics, label: 'Live' },
              { value: summary?.questionsInBank ?? 0, label: 'Questions' },
            ]}
          />

          <StatPanel
            label="Play"
            icon="play"
            tone="learning"
            style={styles.panelGap}
            stats={[
              { value: summary?.matchesPlayed ?? 0, label: 'Matches, 30d' },
              {
                value: summary?.avgAccuracy != null ? `${summary.avgAccuracy}%` : '—',
                label: 'Avg accuracy',
              },
              { value: summary?.pendingApprovals ?? 0, label: 'Waiting to join' },
            ]}
          />

          {/* ── Its content, opened in THIS console. */}
          <View style={styles.block}>
            <Text variant="label" color={colors.inkMuted} style={styles.blockLabel}>
              Open its
            </Text>
            <View style={styles.doors}>
              <Door
                icon="friends"
                label="People"
                tone="people"
                meta={`${seatsUsed} ${seatsUsed === 1 ? 'account' : 'accounts'}`}
                onPress={() =>
                  router.push({ pathname: '/super/users', params: { orgId: spaceId, orgName: name } })
                }
              />
              <Door
                icon="grid"
                label="Topics"
                tone="content"
                meta={topics ? `${topics.length}, ${liveTopics} live` : undefined}
                onPress={() => router.push(into('topics'))}
              />
              <Door
                icon="book"
                label="Question bank"
                tone="content"
                meta={summary ? `${summary.questionsInBank} published` : undefined}
                onPress={() => router.push(into('questions'))}
              />
              <Door
                icon="check"
                label="Review queue"
                tone="content"
                onPress={() => router.push(into('review'))}
              />
              <Door
                icon="download"
                label="Import questions"
                tone="content"
                onPress={() => router.push(into('import'))}
              />
              <Door
                icon="history"
                label="Activity log"
                tone="oversight"
                meta="Everything its admins have done"
                last
                onPress={() => router.push(into('audit'))}
              />
            </View>
          </View>

          {/* ── Who runs it. The people to contact when something is wrong. */}
          {settings?.admins?.length ? (
            <View style={styles.block}>
              <Text variant="label" color={colors.inkMuted} style={styles.blockLabel}>
                Its team
              </Text>
              <View style={styles.doors}>
                {settings.admins.map((admin, i) => (
                  <View
                    key={admin.membershipId}
                    style={[styles.teamRow, i === settings.admins.length - 1 && styles.rowLast]}
                  >
                    <Avatar url={admin.avatarUrl} name={admin.displayName} size={36} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text variant="label" numberOfLines={1}>
                        {admin.displayName ?? 'No name'}
                      </Text>
                      <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                        {admin.role === 'admin' ? 'Full admin' : 'Sub-admin'}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}

      <ConfirmSheet
        visible={suspendOpen}
        destructive
        icon="alert"
        title={`Suspend ${name}?`}
        body="Their students and admins lose access immediately. Data stays, and the organization can be reactivated later."
        confirmLabel="Suspend organization"
        loading={busy}
        onConfirm={() => decide('suspend')}
        onCancel={() => setSuspendOpen(false)}
      />

      <PromptSheet
        visible={supportOpen}
        title="Log support access"
        body="This is written to the organization's own audit log, where their admins will see it."
        placeholder="Ticket #482 — import failing"
        confirmLabel="Log access"
        minLength={4}
        loading={busy}
        error={sheetError}
        onConfirm={logSupportAccess}
        onCancel={() => setSupportOpen(false)}
      />

      <ConfirmSheet
        visible={Boolean(supportResult)}
        icon="user"
        title="Access logged"
        body={supportResult?.note ?? ''}
        confirmLabel="Done"
        cancelLabel={null}
        onConfirm={() => setSupportResult(null)}
        onCancel={() => setSupportResult(null)}
      />
    </SafeAreaView>
  );
}

/** A way into the organization's own content, from here. */
function Door({ icon, label, meta, tone = 'content', onPress, last = false }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.door,
        last && styles.rowLast,
        pressed && { backgroundColor: colors.canvas },
      ]}
    >
      <IconDisc name={icon} tone={tone} size={34} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="label" numberOfLines={1}>
          {label}
        </Text>
        {meta ? (
          <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      <Icon name="chevronRight" size={16} color={colors.inkFaint} />
    </Pressable>
  );
}

function StatusBadge({ status }) {
  if (status === 'active') return <Badge label="Active" tone="live" />;
  if (status === 'suspended') return <Badge label="Suspended" tone="danger" />;
  if (status === 'rejected') return <Badge label="Rejected" tone="danger" />;
  if (status === 'pending') return <Badge label="Pending" tone="amber" />;
  return null;
}

function planLabel(tier) {
  if (!tier) return null;
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function shortDate(iso) {
  if (!iso) return 'unknown';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  content: { padding: consoleLayout.gutter, paddingTop: space.md },

  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: layout.cardPadding,
  },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoInitial: {
    fontFamily: fonts.semibold,
    fontSize: 20,
    lineHeight: 28,
    includeFontPadding: false,
    textAlignVertical: 'center',
    color: colors.onColor,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },

  panel: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: layout.cardPadding,
    marginTop: layout.cardGap,
  },
  seatHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },

  block: { marginTop: space.xl },
  blockLabel: { marginBottom: space.sm },

  panelGap: { marginTop: layout.cardGap },

  alerts: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: layout.cardPadding,
    minHeight: 48,
  },
  alertAction: { backgroundColor: colors.accentSoft },
  alertWarning: { backgroundColor: colors.wrongSoft },

  doors: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  door: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.cardPadding,
    minHeight: consoleLayout.rowHeight,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.cardPadding,
    minHeight: consoleLayout.rowHeight,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  rowLast: { borderBottomWidth: 0 },
});

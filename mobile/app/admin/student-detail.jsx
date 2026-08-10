import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useAdminSpace, useAdminPermissions } from '../../src/lib/admin.js';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import {
  Text,
  Avatar,
  Badge,
  ConfirmSheet,
  EmptyState,
  ErrorNotice,
  Header,
  ProgressBar,
  RowMenu,
  Select,
  Loading,
  useScrollBottom,
} from '../../src/components/ui.jsx';
import Icon from '../../src/components/Icon.jsx';
import { colors, consoleLayout, consoleType, elevation, layout, space } from '../../src/theme/console.js';

/**
 * One student, in full.
 *
 * The roster could suspend somebody and nothing else. Every question an admin
 * actually has about a name on that list — how are they doing, what are they
 * good at, what are they stuck on, when did they join, which batch are they in
 * — had no screen, even though the server has answered all of it since the
 * analytics service was written: `/admin/students/:userId/report` returns the
 * per-topic table, the accuracy, the streak and the weakest topics, and no
 * client had ever called it.
 *
 * The order is the order the questions come in: who they are, how they are
 * doing overall, what they are weakest at (the reason a teacher opens this),
 * then the full per-topic table.
 */
export default function AdminStudentDetail() {
  const scrollBottom = useScrollBottom();
  const goBack = useConsoleBack();
  const router = useRouter();
  const params = useLocalSearchParams();
  const adminSpace = useAdminSpace();
  const { canManageStudents, canManageContests } = useAdminPermissions(adminSpace);

  const userId = typeof params.userId === 'string' ? params.userId : null;
  const membershipId = typeof params.membershipId === 'string' ? params.membershipId : null;

  const [report, setReport] = useState(null);
  const [batches, setBatches] = useState([]);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!adminSpace || !userId) return;
    try {
      setError(null);
      const [data, batchData] = await Promise.all([
        api.get(`/admin/students/${userId}/report`, { spaceId: adminSpace.id }),
        api.get('/admin/batches', { spaceId: adminSpace.id }).catch(() => null),
      ]);
      setReport(data);
      setBatches(batchData?.items ?? []);
    } catch (err) {
      setError(err);
    }
  }, [adminSpace, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const fileInto = async (batchId) => {
    if (!membershipId) return;
    setBusy(true);
    try {
      setError(null);
      await api.post(`/admin/students/${membershipId}/batch`, {
        spaceId: adminSpace.id,
        batchId,
      });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const suspend = async () => {
    setBusy(true);
    try {
      setError(null);
      await api.post('/admin/students/decision', {
        spaceId: adminSpace.id,
        membershipIds: [membershipId],
        decision: 'suspend',
      });
      goBack();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const student = report?.student;
  const topics = report?.topics ?? [];
  const weakest = report?.weakest ?? [];

  return (
    <SafeAreaView style={styles.screen} edges={[]}>
      <Header
        title={student?.displayName ?? 'Student'}
        subtitle={adminSpace?.name}
        onBack={goBack}
        right={
          canManageStudents && membershipId ? (
            <RowMenu
              tone="onColor"
              title={student?.displayName ?? 'Student'}
              label="Student actions"
              actions={[
                {
                  key: 'suspend',
                  label: 'Suspend',
                  icon: 'lock',
                  destructive: true,
                  onPress: () => setConfirm(true),
                },
              ]}
            />
          ) : null
        }
      />

      <ErrorNotice error={error} onRetry={load} />

      {!report && !error ? (
        <Loading />
      ) : !report ? null : (
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
          {/* ── Who. */}
          <View style={[styles.identity, elevation.raised]}>
            <Avatar url={student?.avatarUrl} name={student?.displayName} size={56} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text variant="title" numberOfLines={1}>
                {student?.displayName}
              </Text>
              <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                {[student?.city, joinedText(student?.joinedAt)].filter(Boolean).join('  ·  ')}
              </Text>
              {student?.streak?.current > 0 ? (
                <View style={styles.streakRow}>
                  <Badge label={`${student.streak.current} day streak`} tone="soft" />
                </View>
              ) : null}
            </View>
          </View>

          {/* ── How they are doing. Three numbers, the same three every time. */}
          <View style={[styles.stats, elevation.raised]}>
            <Metric
              value={report.overallAccuracy != null ? `${report.overallAccuracy}%` : '—'}
              label="Accuracy"
            />
            <View style={styles.statDivider} />
            <Metric value={report.matchesPlayed ?? 0} label="Matches" />
            <View style={styles.statDivider} />
            <Metric value={topics.length} label="Topics played" />
          </View>

          {/* ── The batch, as a control rather than a fact: filing somebody is
                 the thing an admin most often opens a student to do. */}
          {canManageStudents && batches.length > 0 && membershipId ? (
            <View style={styles.block}>
              <Select
                label="Batch"
                value={student?.batchId ?? null}
                options={[
                  { value: null, label: 'No batch' },
                  ...batches.map((b) => ({ value: b.id, label: b.name })),
                ]}
                onChange={fileInto}
                disabled={busy}
                placeholder="No batch"
              />
            </View>
          ) : null}

          {/**
           * ── What they are stuck on. The reason this screen gets opened.
           *
           * And now the reason has somewhere to go. This block diagnosed a
           * problem in red and then stopped: an admin who has just learned
           * that a student is at 41% in Thermodynamics wants to DO something
           * about it, and the thing this console can do about it is set them
           * practice. That was five screens away — Assignments, Set an
           * assignment, find the topic again in a chip row, choose a
           * requirement — and nothing here suggested it existed.
           */}
          {weakest.length > 0 ? (
            <View style={styles.block}>
              <Text variant="label" color={colors.inkMuted} style={styles.blockLabel}>
                Weakest topics
              </Text>
              <View style={[styles.card, elevation.raised]}>
                {weakest.map((topic, i) => {
                  const last = i === weakest.length - 1;
                  const row = (
                    <>
                      <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
                        {topic.name}
                      </Text>
                      <Text style={styles.figure} color={colors.wrong}>
                        {topic.accuracy}%
                      </Text>
                      {canManageContests ? (
                        <Icon name="chevronRight" size={14} color={colors.inkFaint} />
                      ) : null}
                    </>
                  );
                  if (!canManageContests) {
                    return (
                      <View key={topic.topicId} style={[styles.weakRow, last && styles.lastRow]}>
                        {row}
                      </View>
                    );
                  }
                  return (
                    <Pressable
                      key={topic.topicId}
                      accessibilityRole="button"
                      accessibilityLabel={`Set an assignment on ${topic.name}`}
                      onPress={() =>
                        router.push({
                          pathname: '/admin/assignment-new',
                          params: { topicId: topic.topicId },
                        })
                      }
                      style={({ pressed }) => [
                        styles.weakRow,
                        last && styles.lastRow,
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      {row}
                    </Pressable>
                  );
                })}
              </View>
              {canManageContests ? (
                <Text variant="meta" color={colors.inkFaint} style={styles.weakHint}>
                  Tap one to set practice on it.
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* ── Everything, per topic. */}
          <View style={styles.block}>
            <Text variant="label" color={colors.inkMuted} style={styles.blockLabel}>
              Every topic
            </Text>
            {topics.length === 0 ? (
              <EmptyState
                icon="book"
                title="Nothing played yet"
                body="Per-topic accuracy appears here once they have played a match."
              />
            ) : (
              <View style={[styles.card, elevation.raised]}>
                {topics.map((topic, i) => (
                  <View
                    key={topic.topicId}
                    style={[styles.topicRow, i === topics.length - 1 && styles.lastRow]}
                  >
                    <View style={styles.topicHead}>
                      <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
                        {topic.name}
                      </Text>
                      <Text style={styles.figure} color={colors.inkMuted}>
                        {topic.rating}
                      </Text>
                    </View>
                    {topic.accuracy != null ? (
                      <ProgressBar
                        value={topic.accuracy}
                        max={100}
                        height={6}
                        color={accuracyColor(topic.accuracy)}
                      />
                    ) : null}
                    <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                      {[
                        topic.accuracy != null ? `${topic.accuracy}% correct` : 'not enough answers',
                        `${topic.matchesPlayed} ${topic.matchesPlayed === 1 ? 'match' : 'matches'}`,
                        topic.avgResponseMs > 0 ? `${(topic.avgResponseMs / 1000).toFixed(1)}s avg` : null,
                      ]
                        .filter(Boolean)
                        .join('  ·  ')}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}

      <ConfirmSheet
        visible={Boolean(confirm)}
        destructive
        icon="friends"
        title={`Suspend ${student?.displayName ?? 'this student'}?`}
        body="They keep their history but cannot play in this organization until restored."
        confirmLabel="Suspend"
        loading={busy}
        onConfirm={suspend}
        onCancel={() => setConfirm(null)}
      />
    </SafeAreaView>
  );
}

/** Green at 70, amber at 50, red below — the same three bands as Reports. */
function accuracyColor(pct) {
  if (pct >= 70) return colors.correct;
  if (pct >= 50) return colors.optionC;
  return colors.wrong;
}

function joinedText(iso) {
  if (!iso) return null;
  return `joined ${new Date(iso).toLocaleDateString()}`;
}

function Metric({ value, label }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue} numberOfLines={1}>
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
  content: { padding: consoleLayout.gutter },
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
  streakRow: { flexDirection: 'row', marginTop: space.xs },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingVertical: space.lg,
    marginTop: layout.cardGap,
  },
  metric: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: 4 },
  metricValue: { ...consoleType.figure, fontSize: 22, lineHeight: 28, color: colors.ink },
  statDivider: { width: 1, height: 30, backgroundColor: colors.hairline },
  block: { marginTop: space.xl },
  blockLabel: { marginBottom: space.sm },
  card: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: layout.cardPadding,
  },
  weakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: consoleLayout.rowHeight,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  topicRow: {
    gap: space.xs,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  topicHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  lastRow: { borderBottomWidth: 0 },
  weakHint: { marginTop: space.sm },
  figure: { ...consoleType.figure },
});

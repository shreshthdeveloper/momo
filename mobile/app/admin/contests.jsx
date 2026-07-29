import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import { useAdminSpace } from '../../src/lib/admin.js';
import {
  Text,
  Badge,
  Button,
  ConfirmSheet,
  EmptyState,
  ErrorNotice,
  Header,
} from '../../src/components/ui.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import Icon from '../../src/components/Icon.jsx';
import { colors, consoleLayout, elevation, layout, space } from '../../src/theme/index.js';

/**
 * prd.md F8.5 — contests, from the phone: everything scheduled, live or done,
 * with the two decisions an admin actually makes on the move — check the
 * standings, and finalise a contest whose window has closed.
 */
export default function AdminContests() {
  const goBack = useConsoleBack();
  const router = useRouter();
  const adminSpace = useAdminSpace();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!adminSpace) return;
    try {
      setError(null);
      const data = await api.get('/admin/contests', { spaceId: adminSpace.id });
      setItems(data.items ?? []);
    } catch (err) {
      setError(err);
    }
  }, [adminSpace]);

  useEffect(() => {
    load();
  }, [load]);

  const finalise = async (contest) => {
    setBusyId(contest.id);
    try {
      setError(null);
      await api.post(`/admin/contests/${contest.id}/finalise`, { spaceId: adminSpace.id });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (contest) => {
    setBusyId(contest.id);
    try {
      setError(null);
      await api.delete(`/admin/contests/${contest.id}`, { spaceId: adminSpace.id });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
      setConfirmDelete(null);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Contests" subtitle={adminSpace?.name} onBack={goBack} />

      <ErrorNotice error={error} onRetry={load} />

      {!items && !error ? (
        <CardsSkeleton count={3} bar={false} />
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
          {items.length === 0 ? (
            <EmptyState
              icon="clock"
              title="No contests yet"
              body="Schedule one and every student answers the same paper against the clock."
              actionLabel="Schedule a contest"
              onAction={() => router.push('/admin/contest-new')}
            />
          ) : (
            items.map((contest) => {
              const phase = phaseOf(contest);
              return (
                <View key={contest.id} style={[styles.card, elevation.raised]}>
                  <View style={styles.cardHead}>
                    <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
                      {contest.name}
                    </Text>
                    <Badge
                      label={phase.label}
                      tone={phase.tone}
                    />
                  </View>

                  <Text variant="meta" color={colors.inkFaint} style={styles.meta} numberOfLines={1}>
                    {windowText(contest)}
                    {`  ·  ${contest.questionCount} questions`}
                    {contest.topics?.length ? `  ·  ${contest.topics.map((t) => t.name).filter(Boolean).join(', ')}` : ''}
                  </Text>

                  <View style={styles.actions}>
                    <Button
                      size="sm"
                      variant="soft"
                      label="Standings"
                      fullWidth={false}
                      /**
                       * The ADMIN board, which shows every entrant including
                       * those still playing and ignores the contest's
                       * standings-visibility setting. This used to open the
                       * student's contest screen, so an admin running a
                       * hidden-standings contest was shown the same nothing
                       * their students were.
                       */
                      onPress={() =>
                        router.push({
                          pathname: '/admin/contest-standings',
                          params: { id: contest.id, name: contest.name },
                        })
                      }
                    />
                    {phase.key === 'ended' ? (
                      <Button
                        size="sm"
                        label="Finalise"
                        fullWidth={false}
                        loading={busyId === contest.id}
                        onPress={() => finalise(contest)}
                      />
                    ) : null}
                    {phase.key === 'upcoming' ? (
                      <Pressable
                        onPress={() => setConfirmDelete(contest)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Delete contest"
                        style={({ pressed }) => [styles.delete, pressed && { opacity: 0.7 }]}
                      >
                        <Icon name="close" size={15} color={colors.wrong} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* One primary per screen: scheduling is the reason this page exists. */}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Button label="Schedule a contest" onPress={() => router.push('/admin/contest-new')} />
      </SafeAreaView>

      <ConfirmSheet
        visible={Boolean(confirmDelete)}
        destructive
        icon="clock"
        title={`Delete ${confirmDelete?.name}?`}
        body="Students lose sight of it immediately. This cannot be undone."
        confirmLabel="Delete contest"
        loading={Boolean(busyId)}
        onConfirm={() => remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </SafeAreaView>
  );
}

function phaseOf(contest) {
  const now = Date.now();
  if (contest.status === 'cancelled') return { key: 'cancelled', label: 'Cancelled', tone: 'ink' };
  /**
   * `finished` is what the backend calls a contest that is over
   * (CONTEST_STATUS.FINISHED). Testing for 'finalised' — a value nothing ever
   * writes — meant every completed contest fell through to the time check and
   * wore a red "Needs finalising" badge for ever, including the ones the
   * sweeper had already finalised minutes after they closed.
   */
  if (contest.status === 'finished') return { key: 'done', label: 'Finalised', tone: 'soft' };
  if (now < new Date(contest.startsAt).getTime()) return { key: 'upcoming', label: 'Upcoming', tone: 'soft' };
  if (now < new Date(contest.endsAt).getTime()) return { key: 'live', label: 'Live', tone: 'correct' };
  return { key: 'ended', label: 'Needs finalising', tone: 'wrong' };
}

function windowText(contest) {
  const fmt = (d) =>
    new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `${fmt(contest.startsAt)} → ${fmt(contest.endsAt)}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  list: { padding: consoleLayout.gutter, paddingTop: space.sm, paddingBottom: space.lg },
  card: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    padding: layout.cardPadding,
    marginBottom: layout.cardGap,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  meta: { marginTop: space.xs, marginBottom: space.md },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  delete: {
    marginLeft: 'auto',
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.wrongSoft,
  },
  footer: {
    paddingHorizontal: consoleLayout.gutter,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    backgroundColor: colors.sunken,
  },
});

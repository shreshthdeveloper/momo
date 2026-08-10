import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useAdminSpace } from '../../src/lib/admin.js';
import {
  ConsoleFooter,
  Text,
  Badge,
  Button,
  ConfirmSheet,
  EmptyState,
  ErrorNotice,
  Header,
  RowMenu,
  CountRow,
} from '../../src/components/ui.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import Icon from '../../src/components/Icon.jsx';
import { colors, consoleLayout, elevation, layout, space } from '../../src/theme/console.js';

/**
 * prd.md F8.5 — contests, from the phone: everything scheduled, live or done,
 * with the two decisions an admin actually makes on the move — check the
 * standings, and finalise a contest whose window has closed.
 */
export default function AdminContests() {
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
    <SafeAreaView style={styles.screen} edges={[]}>
      <Header title="Contests" subtitle={adminSpace?.name} />

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
          <CountRow total={items.length} noun="contest" />

          {items.length === 0 ? (
            <EmptyState
              tone="learning"
              icon="clock"
              title="No contests yet"
              body="Schedule one and every student answers the same paper against the clock."
              actionLabel="Schedule a contest"
              onAction={() => router.push('/admin/contest-new')}
            />
          ) : (
            items.map((contest) => {
              const phase = phaseOf(contest);
              const openStandings = () =>
                router.push({
                  pathname: '/admin/contest-standings',
                  params: { id: contest.id, name: contest.name },
                });
              return (
                /**
                 * The card IS the link, and it leads to the standings — the
                 * ADMIN board, which shows every entrant including those still
                 * playing and ignores the contest's own standings-visibility
                 * setting, so an admin running a hidden-standings contest is
                 * not shown the same nothing their students are.
                 *
                 * It was a soft pill in the card's corner, which made the other
                 * ninety percent of the card inert. Same fix as the topic card:
                 * the whole thing presses, and `⋯` keeps the verbs.
                 */
                <Pressable
                  key={contest.id}
                  onPress={openStandings}
                  accessibilityRole="button"
                  accessibilityLabel={contest.name}
                  accessibilityHint="Opens the standings"
                  style={({ pressed }) => [
                    styles.card,
                    elevation.raised,
                    pressed && styles.cardPressed,
                  ]}
                >
                  <View style={styles.cardHead}>
                    <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
                      {contest.name}
                    </Text>
                    <Badge
                      label={phase.label}
                      tone={phase.tone}
                    />
                    <Icon name="chevronRight" size={16} color={colors.inkFaint} />
                  </View>

                  <Text variant="meta" color={colors.inkFaint} style={styles.meta} numberOfLines={1}>
                    {windowText(contest)}
                    {`  ·  ${contest.questionCount} questions`}
                    {contest.topics?.length ? `  ·  ${contest.topics.map((t) => t.name).filter(Boolean).join(', ')}` : ''}
                  </Text>

                  {/**
                   * Finalising an ended contest is the one verb that earns a
                   * button of its own — it is time-critical and it is what the
                   * "Ended" badge above is asking for. Everything else goes in
                   * the `⋯` with every other destructive verb in the console.
                   */}
                  <View style={styles.actions}>
                    {phase.key === 'ended' ? (
                      <Button
                        size="sm"
                        label="Finalise"
                        fullWidth={false}
                        loading={busyId === contest.id}
                        onPress={() => finalise(contest)}
                      />
                    ) : null}
                    <View style={{ flex: 1 }} />
                    <RowMenu
                      title={contest.name}
                      label={`Actions for ${contest.name}`}
                      actions={[
                        {
                          key: 'standings',
                          label: 'Standings',
                          icon: 'trophy',
                          onPress: openStandings,
                        },
                        phase.key === 'upcoming'
                          ? {
                              key: 'delete',
                              label: 'Delete the contest',
                              icon: 'trash',
                              destructive: true,
                              onPress: () => setConfirmDelete(contest),
                            }
                          : null,
                      ]}
                    />
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}

      {/* One primary per screen: scheduling is the reason this page exists. */}
      <ConsoleFooter>
        <Button label="Schedule a contest" onPress={() => router.push('/admin/contest-new')} />
      </ConsoleFooter>

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
  if (contest.status === 'cancelled') return { key: 'cancelled', label: 'Cancelled', tone: 'quiet' };
  /**
   * `finished` is what the backend calls a contest that is over
   * (CONTEST_STATUS.FINISHED). Testing for 'finalised' — a value nothing ever
   * writes — meant every completed contest fell through to the time check and
   * wore a red "Needs finalising" badge for ever, including the ones the
   * sweeper had already finalised minutes after they closed.
   */
  if (contest.status === 'finished') return { key: 'done', label: 'Finalised', tone: 'soft' };
  if (now < new Date(contest.startsAt).getTime()) return { key: 'upcoming', label: 'Upcoming', tone: 'soft' };
  if (now < new Date(contest.endsAt).getTime()) return { key: 'live', label: 'Live', tone: 'live' };
  return { key: 'ended', label: 'Needs finalising', tone: 'danger' };
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
  cardPressed: { backgroundColor: colors.canvas },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  meta: { marginTop: space.xs, marginBottom: space.md },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});

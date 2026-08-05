import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/lib/api.js';
import { useAuth } from '../src/state/auth.jsx';
import {
  Text,
  ErrorNotice,
  EmptyState,
  Header,
  ProgressBar,
  SectionHeader,
  useScrollBottom,
} from '../src/components/ui.jsx';
import { CardsSkeleton } from '../src/components/Skeletons.jsx';
import AssignmentCard from '../src/components/AssignmentCard.jsx';
import { colors, elevation, layout, space } from '../src/theme/index.js';
import { MATCH_MODE } from '../src/shared/constants.js';

/**
 * prd.md F7.4 — every assignment, with its requirement, progress, due date and
 * completion state.
 *
 * Outstanding work first and done work last, with the done section collapsed
 * into a count rather than a list. A student opening this screen is asking
 * "what do I still owe", not "what have I already handed in".
 */
export default function Assignments() {
  const scrollBottom = useScrollBottom();
  const router = useRouter();
  const { activeSpaceId, spaces } = useAuth();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const space_ = spaces.find((s) => s.id === activeSpaceId);
  const accent = space_?.accentColor ?? colors.accent;

  const load = useCallback(async () => {
    if (!activeSpaceId) return;
    try {
      setError(null);
      setData(await api.get(`/spaces/${activeSpaceId}/assignments`));
    } catch (err) {
      setError(err);
    }
  }, [activeSpaceId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Homework is a quick match, and it says so.
   *
   * Sending no mode meant the queue fell back to the session default, which is
   * RANKED — so tapping an assignment quietly put a student's rating and
   * league on the line. Nothing on this screen names that stake, and the rule
   * everywhere else in the app is that nothing queues without a press that
   * says what it costs. Assignments are practice; they count toward the
   * requirement either way.
   */
  const play = (topic) =>
    router.push({
      pathname: '/match/searching',
      params: {
        topicId: topic.id,
        spaceId: activeSpaceId,
        mode: MATCH_MODE.QUICK,
        name: topic.name,
        coverUrl: topic.coverUrl ?? '',
      },
    });

  const items = data?.items ?? [];
  const outstanding = items.filter((a) => !a.you?.complete);
  const done = items.filter((a) => a.you?.complete);
  const summary = data?.summary;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Assignments" onBack={() => router.back()} />

      <ErrorNotice error={error} onRetry={load} />

      {!data && !error ? (
        <CardsSkeleton count={4} />
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
          {/* One bar for the whole term. It is the first thing a student wants
              and the only place this screen states it. */}
          {summary?.assigned > 0 ? (
            <View style={[styles.summary, elevation.raised]}>
              <View style={styles.summaryHead}>
                <Text variant="label">
                  {summary.completed} of {summary.assigned} done
                </Text>
                {summary.overdue > 0 ? (
                  <View style={styles.overduePill}>
                    <Text variant="tiny" color={colors.wrong}>
                      {summary.overdue} overdue
                    </Text>
                  </View>
                ) : null}
              </View>
              <ProgressBar
                value={summary.completed}
                max={summary.assigned}
                color={summary.overdue > 0 ? colors.wrong : accent}
                height={10}
              />
            </View>
          ) : null}

          {items.length === 0 ? (
            <EmptyState
              icon="flag"
              title="Nothing set"
              body="When your organization sets work, it appears here with your progress."
              actionLabel="Back to play"
              onAction={() => router.replace('/')}
            />
          ) : null}

          {outstanding.length > 0 ? (
            <SectionHeader title={`${outstanding.length} still open`} />
          ) : null}
          {outstanding.map((assignment) => (
            <AssignmentCard
              key={assignment.id}
              assignment={assignment}
              accent={accent}
              onPress={() => play(assignment.topic)}
            />
          ))}

          {done.length > 0 ? (
            <>
              <SectionHeader title={`${done.length} finished`} style={{ marginTop: space.lg }} />
              {done.map((assignment) => (
                <AssignmentCard
                  key={assignment.id}
                  assignment={assignment}
                  accent={accent}
                  onPress={() => play(assignment.topic)}
                />
              ))}
            </>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  /**
   * `canvas`, like every other player screen. This one and Settings were the
   * two exceptions — `sunken` is the CONSOLE's field, and a player pushed here
   * from Home crossed onto a darker screen for no reason they could name.
   *
   * The card moves with it: it was `canvas` on `sunken`, which is a lift; on
   * `canvas` it would have been the same colour as the screen behind it, so it
   * takes the raised surface the theme keeps for exactly this.
   */
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: layout.gutter, paddingTop: space.sm },
  summary: {
    backgroundColor: colors.nightRaised,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: layout.radiusCard,
    padding: layout.cardPadding,
    marginBottom: space.xl,
    gap: space.md,
  },
  summaryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  overduePill: {
    backgroundColor: colors.wrongSoft,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: layout.radiusPill,
  },
});

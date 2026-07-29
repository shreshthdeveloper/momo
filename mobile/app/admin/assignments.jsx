import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import { useAdminSpace } from '../../src/lib/admin.js';
import {
  Text,
  Button,
  EmptyState,
  ErrorNotice,
  Header,
  ProgressBar,
} from '../../src/components/ui.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import { colors, consoleLayout, elevation, layout, space } from '../../src/theme/index.js';

/**
 * prd.md F8.5.5 — assignments from the admin's side: what was set, when it is
 * due, and the completion bar — which is the number that tells an admin
 * whether to chase the class or leave it alone.
 */
export default function AdminAssignments() {
  const goBack = useConsoleBack();
  const router = useRouter();
  const adminSpace = useAdminSpace();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!adminSpace) return;
    try {
      setError(null);
      const data = await api.get('/admin/assignments', { spaceId: adminSpace.id, status: 'all' });
      setItems(data.items ?? []);
    } catch (err) {
      setError(err);
    }
  }, [adminSpace]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Assignments" subtitle={adminSpace?.name} onBack={goBack} />

      <ErrorNotice error={error} onRetry={load} />

      {!items && !error ? (
        <CardsSkeleton count={3} />
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
              icon="flag"
              title="Nothing set"
              body="Set work with a topic, a requirement and a due date — progress tracks itself."
              actionLabel="Set an assignment"
              onAction={() => router.push('/admin/assignment-new')}
            />
          ) : (
            items.map((assignment) => {
              const done = assignment.stats?.completed ?? 0;
              const total = assignment.stats?.assigned ?? 0;
              const overdue = Boolean(assignment.overdue);
              return (
                /**
                 * The card opens the roster. An assignment whose whole point is
                 * "did they do it?" was previously a card that could not be
                 * tapped — the answer lived behind an endpoint with no screen.
                 */
                <Pressable
                  key={assignment.id}
                  onPress={() =>
                    router.push({
                      pathname: '/admin/assignment-detail',
                      params: { id: assignment.id },
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`${assignment.title}. ${done} of ${total} done.`}
                  style={({ pressed }) => [
                    styles.card,
                    elevation.raised,
                    pressed && { opacity: 0.75 },
                  ]}
                >
                  <View style={styles.cardHead}>
                    <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
                      {assignment.title}
                    </Text>
                    <Text variant="meta" color={overdue ? colors.wrong : colors.inkFaint}>
                      {dueText(assignment.dueAt)}
                    </Text>
                  </View>
                  <Text variant="meta" color={colors.inkFaint} style={styles.meta} numberOfLines={1}>
                    {assignment.requirementText ?? assignment.topic?.name ?? ''}
                  </Text>
                  <ProgressBar
                    value={done}
                    max={total || 1}
                    color={overdue && done < total ? colors.wrong : colors.correct}
                    height={8}
                  />
                  <Text variant="meta" color={colors.inkFaint} style={{ marginTop: space.sm }}>
                    {done} of {total} students done
                  </Text>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Button label="Set an assignment" onPress={() => router.push('/admin/assignment-new')} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

function dueText(dueAt) {
  const ms = new Date(dueAt).getTime() - Date.now();
  if (ms < 0) {
    const days = Math.ceil(-ms / 86_400_000);
    return days <= 1 ? 'Due yesterday' : `${days} days overdue`;
  }
  const hours = ms / 3_600_000;
  if (hours < 24) return `Due in ${Math.max(1, Math.round(hours))} hr`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Due tomorrow' : `Due in ${days} days`;
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
  footer: {
    paddingHorizontal: consoleLayout.gutter,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    backgroundColor: colors.sunken,
  },
});

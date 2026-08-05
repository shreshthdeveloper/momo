import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useAdminSpace, useAdminPermissions } from '../../src/lib/admin.js';
import {
  Text,
  Badge,
  Button,
  ConsoleFooter,
  CountRow,
  EmptyState,
  ErrorNotice,
  Header,
  ListCard,
  ListRow,
  Select,
  Sheet,
} from '../../src/components/ui.jsx';
import { ListSkeleton } from '../../src/components/Skeletons.jsx';
import { colors, consoleLayout, layout, space } from '../../src/theme/index.js';

/**
 * Live class sessions — the console side.
 *
 * A teacher opens one here, gets a code, puts it on the projector, and the class
 * joins on their phones. The list below is the record: every session this
 * organization has run, and what the class got wrong in each.
 *
 * The primary action is deliberately the only thing in the footer. Hosting is the
 * verb this screen exists for; everything else is looking at what already
 * happened.
 */
export default function AdminSessions() {
  const router = useRouter();
  const adminSpace = useAdminSpace();
  const { canManageContests } = useAdminPermissions(adminSpace);

  const [rows, setRows] = useState(null);
  const [topics, setTopics] = useState([]);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ topicId: null, questionCount: 10 });

  const load = useCallback(async () => {
    if (!adminSpace) return;
    try {
      setError(null);
      const [list, topicList] = await Promise.all([
        api.get('/admin/sessions', { spaceId: adminSpace.id }),
        api.get('/admin/topics', { spaceId: adminSpace.id }),
      ]);
      setRows(list.items ?? []);
      setTopics(topicList.items ?? []);
    } catch (err) {
      setError(err);
    }
  }, [adminSpace]);

  useEffect(() => {
    load();
  }, [load]);

  const host = useCallback(async () => {
    if (busy || !form.topicId) return;
    setBusy(true);
    setError(null);
    try {
      const session = await api.post('/admin/sessions', {
        spaceId: adminSpace.id,
        topicId: form.topicId,
        questionCount: Number(form.questionCount) || 10,
      });
      setOpen(false);
      /**
       * Straight into the room, carrying the code.
       *
       * The host joins their own session like everybody else — same screen, same
       * events — so there is no separate "host view" to keep in step with what the
       * class is looking at. What they get extra is the controls.
       */
      router.push({ pathname: '/session', params: { code: session.code } });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [busy, form, adminSpace, router]);

  const live = (rows ?? []).filter((r) => r.status !== 'ended');

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Live sessions" subtitle={adminSpace?.name} />
      <ErrorNotice error={error} onRetry={load} />

      {!rows && !error ? (
        <ListSkeleton rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="friends"
          title="No sessions yet"
          body="Host one and your class joins on their phones with a code. Everyone answers the same question at the same time, and the board goes on the projector."
          actionLabel={canManageContests ? 'Host a session' : undefined}
          onAction={canManageContests ? () => setOpen(true) : undefined}
        />
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
          <CountRow
            shown={rows.length}
            total={rows.length}
            noun="session"
            meta={live.length > 0 ? `${live.length} open` : null}
          />

          <ListCard>
            {rows.map((row, i) => (
              <ListRow
                key={row.id}
                last={i === rows.length - 1}
                title={row.name}
                actions={[
                  row.status !== 'ended' && {
                    key: 'rejoin',
                    label: 'Open the room',
                    icon: 'play',
                    meta: `Code ${row.code}`,
                    onPress: () => router.push({ pathname: '/session', params: { code: row.code } }),
                  },
                  {
                    key: 'report',
                    label: 'See what the class got wrong',
                    icon: 'chart',
                    onPress: () => router.push(`/admin/session-report?id=${row.id}`),
                  },
                ]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.titleRow}>
                    <Text variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {row.name}
                    </Text>
                    {row.status === 'lobby' ? (
                      <Badge tone="amber" label="LOBBY" />
                    ) : row.status === 'live' ? (
                      <Badge tone="live" label="LIVE" />
                    ) : null}
                  </View>
                  <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                    {row.topic?.name} · {row.totalRounds} questions ·{' '}
                    {row.participantCount} {row.participantCount === 1 ? 'student' : 'students'}
                    {row.status !== 'ended' ? ` · code ${row.code}` : ''}
                  </Text>
                </View>
              </ListRow>
            ))}
          </ListCard>
        </ScrollView>
      )}

      {canManageContests ? (
        <ConsoleFooter>
          <Button label="Host a session" onPress={() => setOpen(true)} />
        </ConsoleFooter>
      ) : null}

      <Sheet visible={open} title="Host a session" onClose={() => setOpen(false)} scroll>
        <Text variant="meta" color={colors.inkFaint} style={{ marginBottom: space.md }}>
          The paper is chosen now, so you find out here rather than in front of the
          class if a topic is too thin.
        </Text>

        <Select
          value={form.topicId}
          options={topics.map((t) => ({ value: t.id, label: t.name }))}
          onChange={(topicId) => setForm((f) => ({ ...f, topicId }))}
          placeholder="Which topic"
        />

        <View style={{ height: space.md }} />

        <Select
          value={form.questionCount}
          options={[5, 10, 15, 20].map((n) => ({ value: n, label: `${n} questions` }))}
          onChange={(questionCount) => setForm((f) => ({ ...f, questionCount }))}
          placeholder="How many questions"
        />

        <Button
          label="Open the room"
          loading={busy}
          disabled={!form.topicId}
          onPress={host}
          style={{ marginTop: space.lg }}
        />
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  list: { paddingHorizontal: consoleLayout.gutter, paddingBottom: layout.scrollBottom },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});

import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useAdminSpace, useAdminPermissions } from '../../src/lib/admin.js';
import {
  Text,
  Badge,
  Button,
  ConfirmSheet,
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
import { TOURNAMENT_SIZES } from '../../src/shared/constants.js';
import { colors, consoleLayout, layout, space, type } from '../../src/theme/index.js';

/**
 * Knockout tournaments — the console side.
 *
 * Two verbs, and the second one is irreversible: create it (entries open), then
 * draw the bracket (entries close, seeding is fixed, round one goes out). They
 * are separate because who is in it has to stop changing before anybody can be
 * seeded, and an admin who could redraw a live bracket could rearrange a
 * tournament somebody was losing.
 */
const STATUS_TONE = { open: 'amber', running: 'live', complete: 'quiet' };

export default function AdminTournaments() {
  const router = useRouter();
  const adminSpace = useAdminSpace();
  const { canManageContests } = useAdminPermissions(adminSpace);

  const [rows, setRows] = useState(null);
  const [topics, setTopics] = useState([]);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draw, setDraw] = useState(null);
  const [form, setForm] = useState({ name: '', topicId: null, size: 8 });

  const load = useCallback(async () => {
    if (!adminSpace) return;
    try {
      setError(null);
      const [list, topicList] = await Promise.all([
        api.get('/admin/tournaments', { spaceId: adminSpace.id }),
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

  const create = useCallback(async () => {
    if (busy || !form.name.trim() || !form.topicId) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/tournaments', {
        spaceId: adminSpace.id,
        name: form.name.trim(),
        topicId: form.topicId,
        size: form.size,
      });
      setOpen(false);
      setForm({ name: '', topicId: null, size: 8 });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [busy, form, adminSpace, load]);

  const start = useCallback(async () => {
    if (!draw) return;
    setBusy(true);
    try {
      await api.post(`/admin/tournaments/${draw.id}/start`, { spaceId: adminSpace.id });
      setDraw(null);
      await load();
    } catch (err) {
      setDraw(null);
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [draw, adminSpace, load]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Tournaments" subtitle={adminSpace?.name} />
      <ErrorNotice error={error} onRetry={load} />

      {!rows && !error ? (
        <ListSkeleton rows={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="ranks"
          title="No tournaments yet"
          body="A bracket gives a topic a story — quarter-finals, a semi somebody nearly lost, and a winner. Students enter, and you draw the bracket when everyone is in."
          actionLabel={canManageContests ? 'New tournament' : undefined}
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
          <CountRow shown={rows.length} total={rows.length} noun="tournament" />

          <ListCard>
            {rows.map((row, i) => (
              <ListRow
                key={row.id}
                last={i === rows.length - 1}
                title={row.name}
                actions={[
                  {
                    key: 'view',
                    label: 'See the bracket',
                    icon: 'ranks',
                    onPress: () => router.push(`/tournament/${row.id}`),
                  },
                  row.status === 'open' &&
                    canManageContests && {
                      key: 'start',
                      label: 'Draw the bracket',
                      icon: 'play',
                      meta:
                        row.entrants.length < 2
                          ? 'Needs at least two entrants'
                          : `Seeds ${row.entrants.length} entrants and closes entries`,
                      onPress: () => setDraw(row),
                    },
                  row.status !== 'complete' &&
                    canManageContests && {
                      key: 'cancel',
                      label: 'Cancel',
                      icon: 'close',
                      destructive: true,
                      onPress: async () => {
                        await api
                          .delete(`/admin/tournaments/${row.id}`, { spaceId: adminSpace.id })
                          .catch(setError);
                        await load();
                      },
                    },
                ]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.titleRow}>
                    <Text variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {row.name}
                    </Text>
                    <Badge
                      tone={STATUS_TONE[row.status] ?? 'quiet'}
                      label={row.status === 'open' ? 'ENTRIES OPEN' : row.status.toUpperCase()}
                    />
                  </View>
                  <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                    {row.topic?.name} ·{' '}
                    {row.champion
                      ? `Won by ${row.champion.displayName}`
                      : `${row.entrants.length} of ${row.size} entered`}
                  </Text>
                </View>
              </ListRow>
            ))}
          </ListCard>
        </ScrollView>
      )}

      {canManageContests ? (
        <ConsoleFooter>
          <Button label="New tournament" onPress={() => setOpen(true)} />
        </ConsoleFooter>
      ) : null}

      <Sheet visible={open} title="New tournament" onClose={() => setOpen(false)}>
        <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
          Name
        </Text>
        <TextInput
          style={styles.input}
          value={form.name}
          onChangeText={(name) => setForm((f) => ({ ...f, name }))}
          placeholder="Class 9 Physics Cup"
          placeholderTextColor={colors.inkFaint}
          maxLength={80}
          accessibilityLabel="Tournament name"
        />
        <View style={{ height: space.md }} />
        <Select
          value={form.topicId}
          options={topics.map((t) => ({ value: t.id, label: t.name }))}
          onChange={(topicId) => setForm((f) => ({ ...f, topicId }))}
          placeholder="Which topic"
        />
        <View style={{ height: space.md }} />
        <Select
          value={form.size}
          options={TOURNAMENT_SIZES.map((n) => ({ value: n, label: `Up to ${n} entrants` }))}
          onChange={(size) => setForm((f) => ({ ...f, size }))}
          placeholder="Field size"
        />
        <Text variant="meta" color={colors.inkFaint} style={{ marginTop: space.sm }}>
          Entries open straight away. The bracket shrinks to fit whoever actually
          enters, so a smaller turnout is a smaller bracket rather than a round of
          walkovers.
        </Text>
        <Button
          label="Open entries"
          loading={busy}
          disabled={!form.name.trim() || !form.topicId}
          onPress={create}
          style={{ marginTop: space.lg }}
        />
      </Sheet>

      <ConfirmSheet
        visible={Boolean(draw)}
        title="Draw the bracket?"
        body={`${draw?.entrants?.length ?? 0} entrants will be seeded by their rating on ${
          draw?.topic?.name ?? 'this topic'
        }, and entries will close. This cannot be undone.`}
        confirmLabel="Draw it"
        loading={busy}
        onConfirm={start}
        onCancel={() => setDraw(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  list: { paddingHorizontal: consoleLayout.gutter, paddingBottom: layout.scrollBottom },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  fieldLabel: { marginBottom: space.xs },
  input: {
    ...type.option,
    color: colors.ink,
    backgroundColor: colors.sunken,
    borderRadius: layout.radiusInput,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    paddingHorizontal: space.lg,
    height: 52,
  },
});

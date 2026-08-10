import { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useAdminSpace, useAdminPermissions } from '../../src/lib/admin.js';
import {
  Text,
  Button,
  ConfirmSheet,
  ConsoleFooter,
  CountRow,
  EmptyState,
  ErrorNotice,
  Header,
  ListCard,
  ListRow,
  Sheet,
} from '../../src/components/ui.jsx';
import { ListSkeleton } from '../../src/components/Skeletons.jsx';
import { colors, consoleLayout, consoleType, elevation, layout, space } from '../../src/theme/console.js';

/**
 * prd.md F8.4.5 — batches, which scope assignments, contests and leaderboards.
 *
 * The backend has had the whole of this for a long time — create, rename,
 * delete, assign, and batch-scoping on every learning object — and no screen
 * ever called any of it. The Batches report even told admins to "group students
 * into batches on the Students screen", which had no batch controls at all, so
 * the report was permanently empty and the pointer led nowhere.
 *
 * Deleting a batch never deletes people: the server unassigns them.
 */
export default function AdminBatches() {
  const router = useRouter();
  const adminSpace = useAdminSpace();
  const { canManageStudents } = useAdminPermissions(adminSpace);

  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(null); // { id?, name, description, year }
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!adminSpace) return;
    try {
      setError(null);
      const data = await api.get('/admin/batches', { spaceId: adminSpace.id });
      setRows(data.items ?? []);
    } catch (err) {
      setError(err);
    }
  }, [adminSpace]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    const name = (editing?.name ?? '').trim();
    if (!name) return;
    setBusy(true);
    try {
      setError(null);
      const body = {
        spaceId: adminSpace.id,
        name,
        description: (editing.description ?? '').trim() || undefined,
        year: (editing.year ?? '').trim() || undefined,
      };
      if (editing.id) await api.patch(`/admin/batches/${editing.id}`, body);
      else await api.post('/admin/batches', body);
      setEditing(null);
      await load();
    } catch (err) {
      setEditing(null);
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      setError(null);
      await api.delete(`/admin/batches/${confirm.id}`, { spaceId: adminSpace.id });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={[]}>
      <Header title="Batches" subtitle={adminSpace?.name} />

      <ErrorNotice error={error} onRetry={load} />

      {!rows && !error ? (
        <ListSkeleton rows={5} />
      ) : rows?.length === 0 ? (
        <EmptyState
          tone="people"
          icon="book"
          title="No batches yet"
          body="A batch is a class or a year group. Assignments, contests and leaderboards can be scoped to one."
          actionLabel={canManageStudents ? 'Create a batch' : undefined}
          onAction={
            canManageStudents ? () => setEditing({ name: '', description: '', year: '' }) : undefined
          }
        />
      ) : (
        <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
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
          {/**
           * A card of rows, not four naked lines with a teal pill and the word
           * "Delete" floating beside each. Every batch reads the same: the
           * name, what is in it, and the one `⋯` every row in this console
           * wears. The count is a figure column so the list can be read down.
           */}
          <CountRow total={rows?.length ?? 0} noun="batch" />

          <ListCard style={elevation.raised}>
            {(rows ?? []).map((batch, i) => (
              <ListRow
                key={batch.id}
                last={i === rows.length - 1}
                title={batch.name}
                /**
                 * A batch IS its students — the figure at the end of the row is
                 * counting them — so the row opens the roster filtered to it,
                 * and renaming or deleting stays in the `⋯`.
                 */
                onPress={() =>
                  router.push({ pathname: '/admin/students', params: { batchId: batch.id } })
                }
                actions={
                  canManageStudents
                    ? [
                        {
                          key: 'edit',
                          label: 'Rename or edit',
                          icon: 'edit',
                          onPress: () =>
                            setEditing({
                              id: batch.id,
                              name: batch.name,
                              description: batch.description ?? '',
                              year: batch.year ?? '',
                            }),
                        },
                        {
                          key: 'delete',
                          label: 'Delete the batch',
                          icon: 'trash',
                          destructive: true,
                          onPress: () => setConfirm(batch),
                        },
                      ]
                    : undefined
                }
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="label" numberOfLines={1}>
                    {batch.name}
                  </Text>
                  {batch.year || batch.description ? (
                    <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                      {[batch.year, batch.description].filter(Boolean).join('  ·  ')}
                    </Text>
                  ) : null}
                </View>

                <Text style={styles.figure} color={colors.inkMuted} numberOfLines={1}>
                  {batch.studentCount ?? 0}
                </Text>

              </ListRow>
            ))}
          </ListCard>
        </ScrollView>
      )}

      {/* One primary, in the footer, where every other console list keeps it.
          It used to be a soft pill trailing the last row, so it scrolled out
          of reach the moment there were more batches than a screenful. */}
      {rows?.length > 0 && canManageStudents ? (
        <ConsoleFooter>
          <Button
            label="Create a batch"
            onPress={() => setEditing({ name: '', description: '', year: '' })}
          />
        </ConsoleFooter>
      ) : null}

      <Sheet
        visible={Boolean(editing)}
        title={editing?.id ? 'Rename batch' : 'New batch'}
        onClose={() => setEditing(null)}
        accessibilityLabel="Batch details"
        scroll
      >
        <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
          Name
        </Text>
        <TextInput
          style={styles.input}
          value={editing?.name ?? ''}
          onChangeText={(v) => setEditing((e) => ({ ...e, name: v }))}
          placeholder="Class 9A"
          placeholderTextColor={colors.inkFaint}
          maxLength={60}
          autoFocus
          accessibilityLabel="Batch name"
        />

        <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
          Year
        </Text>
        <TextInput
          style={styles.input}
          value={editing?.year ?? ''}
          onChangeText={(v) => setEditing((e) => ({ ...e, year: v }))}
          placeholder="2026"
          placeholderTextColor={colors.inkFaint}
          maxLength={20}
          accessibilityLabel="Batch year"
        />

        <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
          Description
        </Text>
        <TextInput
          style={styles.input}
          value={editing?.description ?? ''}
          onChangeText={(v) => setEditing((e) => ({ ...e, description: v }))}
          placeholder="Optional"
          placeholderTextColor={colors.inkFaint}
          maxLength={200}
          accessibilityLabel="Batch description"
        />
        <Button
          label={editing?.id ? 'Save' : 'Create batch'}
          loading={busy}
          disabled={!(editing?.name ?? '').trim()}
          style={{ marginTop: space.md }}
          onPress={save}
        />
      </Sheet>

      <ConfirmSheet
        visible={Boolean(confirm)}
        destructive
        icon="alert"
        title={`Delete ${confirm?.name ?? 'this batch'}?`}
        body="The students stay in your organization — they simply stop being in this batch. Anything scoped to it stops being scoped."
        confirmLabel="Delete batch"
        loading={busy}
        onConfirm={remove}
        onCancel={() => setConfirm(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  list: { paddingHorizontal: consoleLayout.gutter, paddingTop: space.md, paddingBottom: space.lg },
  /** The headcount column — right-aligned tabular figures, read straight down. */
  figure: { ...consoleType.figure, minWidth: 32, textAlign: 'right' },
  fieldLabel: { marginTop: space.md, marginBottom: space.xs },
  input: {
    backgroundColor: colors.control,
    borderRadius: layout.radiusInput,
    borderWidth: 1,
    borderColor: colors.hairline,
    color: colors.ink,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 15,
  },
});

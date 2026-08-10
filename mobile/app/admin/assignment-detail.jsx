import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import { useAdminSpace, useAdminPermissions } from '../../src/lib/admin.js';
import {
  Text,
  Avatar,
  Badge,
  Button,
  ConfirmSheet,
  ErrorNotice,
  Header,
  ProgressBar,
  Segmented,
  CountRow,
  useScrollBottom,
} from '../../src/components/ui.jsx';
import { ListSkeleton } from '../../src/components/Skeletons.jsx';
import { useExport, csvName } from '../../src/lib/download.js';
import { colors, consoleLayout, space } from '../../src/theme/console.js';

/**
 * prd.md F8.5.5–6 — who has actually done the homework.
 *
 * `GET /admin/assignments/:id` returns every targeted student including the
 * ones who have done nothing — deliberately, because those are the list an
 * admin needs — and nothing in the app ever called it. Assignments were
 * create-only: an admin could set work and then had no way at all to see
 * whether anybody had done it, which is most of the reason to set it.
 */
const FILTERS = [
  { value: 'all', label: 'Everyone' },
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'done', label: 'Done' },
];

export default function AssignmentDetail() {
  const scrollBottom = useScrollBottom();
  const goBack = useConsoleBack();
  const { id } = useLocalSearchParams();
  const adminSpace = useAdminSpace();
  const { canManageContests } = useAdminPermissions(adminSpace);

  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const { exporting, error: exportError, run } = useExport();

  const load = useCallback(async () => {
    if (!adminSpace || !id) return;
    try {
      setError(null);
      setData(await api.get(`/admin/assignments/${id}`, { spaceId: adminSpace.id }));
    } catch (err) {
      setError(err);
    }
  }, [adminSpace, id]);

  useEffect(() => {
    load();
  }, [load]);

  const archive = async () => {
    setBusy(true);
    try {
      setError(null);
      await api.delete(`/admin/assignments/${id}`, { spaceId: adminSpace.id });
      goBack();
    } catch (err) {
      setError(err);
      setBusy(false);
      setConfirm(false);
    }
  };

  const students = (data?.students ?? []).filter((s) =>
    filter === 'all' ? true : filter === 'done' ? s.complete : !s.complete,
  );
  const done = (data?.students ?? []).filter((s) => s.complete).length;
  const total = data?.students?.length ?? 0;

  return (
    <SafeAreaView style={styles.screen} edges={[]}>
      <Header
        title={data?.title ?? 'Assignment'}
        subtitle={data?.topic?.name ?? adminSpace?.name}
        onBack={goBack}
      />

      <ErrorNotice error={error} onRetry={load} />
      <ErrorNotice error={exportError} />

      {!data && !error ? (
        <ListSkeleton rows={7} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: scrollBottom }]}
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
          <View style={styles.summary}>
            <Text variant="label">
              {done} of {total} finished
            </Text>
            <ProgressBar value={done} max={total || 1} height={8} />
            <Text variant="meta" color={colors.inkMuted}>
              {data?.requirementText ?? ''}
              {data?.dueAt ? `  ·  due ${new Date(data.dueAt).toLocaleDateString()}` : ''}
            </Text>
            {data?.batches?.length ? (
              <Text variant="meta" color={colors.inkFaint}>
                {data.batches.map((b) => b.name).join(', ')}
              </Text>
            ) : null}
          </View>

          <Segmented options={FILTERS} value={filter} onChange={setFilter} style={styles.tabs} />

          {/* The count for the filter in force, plus Export in the slot it
              occupies on every other list. The progress endpoint has been
              exportable since F8.6.6 and nothing called it, so "who has not done
              their homework" could be read on a phone and taken nowhere. */}
          <CountRow
            shown={students.length}
            total={total}
            noun="student"
            meta={`${done} finished`}
            action={exporting ? 'Exporting…' : 'Export'}
            onAction={() =>
              run(`/admin/assignments/${id}/progress.csv`, {
                query: { spaceId: adminSpace?.id },
                filename: csvName(data?.title ?? 'assignment', 'progress'),
              })
            }
          />

          {students.map((student) => (
            <View key={student.userId} style={styles.row}>
              <Avatar url={student.avatarUrl} name={student.displayName} size={40} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="label" numberOfLines={1}>
                  {student.displayName}
                </Text>
                <ProgressBar
                  value={student.fraction ?? 0}
                  max={1}
                  height={5}
                  color={student.complete ? colors.correct : colors.accent}
                />
              </View>
              {student.complete ? (
                <Badge label={student.late ? 'Late' : 'Done'} tone={student.late ? 'soft' : 'correct'} />
              ) : (
                <Text variant="meta" color={colors.inkFaint}>
                  {Math.round((student.fraction ?? 0) * 100)}%
                </Text>
              )}
            </View>
          ))}

          {canManageContests ? (
            <Button
              variant="ghost"
              label="Archive this assignment"
              style={{ marginTop: space.xl }}
              onPress={() => setConfirm(true)}
            />
          ) : null}
        </ScrollView>
      )}

      <ConfirmSheet
        visible={confirm}
        destructive
        icon="alert"
        title="Archive this assignment?"
        body="Students stop seeing it. The progress already recorded is kept."
        confirmLabel="Archive it"
        loading={busy}
        onConfirm={archive}
        onCancel={() => setConfirm(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  list: { paddingHorizontal: consoleLayout.gutter },
  summary: { paddingVertical: space.md, gap: space.xs },
  tabs: { marginBottom: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 62,
    paddingVertical: space.sm,
  },
});

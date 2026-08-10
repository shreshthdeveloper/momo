import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useAdminSpace, useAdminPermissions } from '../../src/lib/admin.js';
import {
  Text,
  Button,
  Card,
  ConfirmSheet,
  EmptyState,
  ErrorNotice,
  Header,
  Tabs,
  useScrollBottom,
} from '../../src/components/ui.jsx';
import { ListSkeleton } from '../../src/components/Skeletons.jsx';
import QuestionArt from '../../src/components/QuestionArt.jsx';
import { colors, consoleLayout, space } from '../../src/theme/console.js';

/**
 * prd.md §8.6 — what players reported, and what to do about it.
 *
 * Players have been able to report a question from the match review since that
 * screen shipped, and the backend has had the whole queue — list, resolve,
 * archive-on-resolve — for just as long. Nothing in the app ever called it:
 * the dashboard's "N open reports" alert opened the question bank, which shows
 * a count per row and no way to read a reason or clear anything. Reports piled
 * up where only the database could see them, and reported questions stayed in
 * rotation.
 */
const TABS = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
];

/** The player's words for why they reported it. */
const REASON = {
  wrong_answer: 'Marked answer looks wrong',
  typo: 'Typo or unclear wording',
  offensive: 'Offensive',
  duplicate: 'Duplicate',
  cheating: 'Cheating',
  harassment: 'Harassment',
  other: 'Something else',
};

export default function AdminModeration() {
  const scrollBottom = useScrollBottom();
  const router = useRouter();
  const adminSpace = useAdminSpace();
  const { canWrite } = useAdminPermissions(adminSpace);

  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirm, setConfirm] = useState(null); // { report, resolution }
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!adminSpace) return;
    try {
      setError(null);
      const data = await api.get('/admin/reports/queue', { spaceId: adminSpace.id, status });
      setRows(data.items ?? []);
    } catch (err) {
      setError(err);
    }
  }, [adminSpace, status]);

  useEffect(() => {
    setRows(null);
  }, [status]);

  /**
   * On FOCUS: a report card opens the question editor, and a card still
   * quoting the text you have just corrected reads as a save that failed.
   */
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const resolve = async (report, resolution) => {
    setBusyId(report.id);
    try {
      setError(null);
      await api.post(`/admin/reports/${report.id}/resolve`, {
        spaceId: adminSpace.id,
        resolution,
      });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  };

  const shown = rows ?? [];

  return (
    <SafeAreaView style={styles.screen} edges={[]}>
      <Header title="Reports" subtitle={adminSpace?.name} />

      <Tabs options={TABS} value={status} onChange={setStatus} />

      <ErrorNotice error={error} onRetry={load} />

      {!rows && !error ? (
        <ListSkeleton rows={4} />
      ) : shown.length === 0 ? (
        <EmptyState
          tone="oversight"
          icon="check"
          title={status === 'open' ? 'Nothing reported' : 'Nothing here'}
          body={
            status === 'open'
              ? 'When a player reports a question during a match review, it lands here.'
              : 'Reports you have already dealt with appear here.'
          }
        />
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
          {shown.map((report) => (
            <Card key={report.id} style={styles.card}>
              <Text variant="label" color={colors.wrong}>
                {REASON[report.reason] ?? report.reason}
              </Text>

              {report.question ? (
                <>
                  {/* The picture IS the question on a picture question, so a
                      reviewer who cannot see it cannot judge the report. */}
                  {report.question.imageUrl ? (
                    <View style={styles.art}>
                      <QuestionArt imageUrl={report.question.imageUrl} size={104} />
                    </View>
                  ) : null}
                  <Text variant="bodyStrong" style={styles.question}>
                    {report.question.text}
                  </Text>
                  {(report.question.options ?? []).map((option, i) => (
                    <Text
                      key={`${report.id}-${i}`}
                      variant="meta"
                      color={i === report.question.correctIndex ? colors.correct : colors.inkMuted}
                      style={styles.option}
                    >
                      {i === report.question.correctIndex ? '✓  ' : '·  '}
                      {option}
                    </Text>
                  ))}
                </>
              ) : (
                <Text variant="meta" color={colors.inkFaint} style={styles.question}>
                  {report.targetType === 'question'
                    ? 'That question is no longer in your bank.'
                    : `Reported ${report.targetType}.`}
                </Text>
              )}

              {report.note ? (
                <Text variant="meta" color={colors.inkMuted} style={styles.note}>
                  “{report.note}”
                </Text>
              ) : null}

              <Text variant="tiny" color={colors.inkFaint} style={styles.by}>
                {[report.reportedBy, new Date(report.at).toLocaleDateString()]
                  .filter(Boolean)
                  .join('  ·  ')}
              </Text>

              {status === 'open' && canWrite ? (
                <View style={styles.actions}>
                  {report.question ? (
                    <Button
                      size="sm"
                      variant="soft"
                      label="Edit question"
                      fullWidth={false}
                      onPress={() =>
                        router.push({
                          pathname: '/admin/question-edit',
                          params: { id: report.targetId },
                        })
                      }
                    />
                  ) : null}
                  <Button
                    size="sm"
                    label="Fixed"
                    fullWidth={false}
                    loading={busyId === report.id}
                    onPress={() => resolve(report, 'fixed')}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Archive it"
                    fullWidth={false}
                    disabled={busyId === report.id}
                    onPress={() => setConfirm({ report, resolution: 'archived' })}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Dismiss"
                    fullWidth={false}
                    disabled={busyId === report.id}
                    onPress={() => resolve(report, 'dismissed')}
                  />
                </View>
              ) : null}
            </Card>
          ))}
        </ScrollView>
      )}

      <ConfirmSheet
        visible={Boolean(confirm)}
        destructive
        icon="alert"
        title="Archive this question?"
        body="It leaves the bank and stops appearing in matches. Your topic's published count drops by one."
        confirmLabel="Archive it"
        loading={Boolean(busyId)}
        onConfirm={() => resolve(confirm.report, confirm.resolution)}
        onCancel={() => setConfirm(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  list: { paddingHorizontal: consoleLayout.gutter, gap: space.md },
  card: { padding: space.lg, gap: space.xs },
  art: { alignItems: 'center', paddingVertical: space.sm },
  question: { marginTop: space.xs },
  option: { marginLeft: space.xs },
  note: { marginTop: space.sm, fontStyle: 'italic' },
  by: { marginTop: space.xs },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
  },
});

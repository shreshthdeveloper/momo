import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useAdminSpace, useAdminPermissions } from '../../src/lib/admin.js';
import {
  Text,
  Button,
  Chip,
  EmptyState,
  ErrorNotice,
  Header,
  Segmented,
  useScrollBottom,
} from '../../src/components/ui.jsx';
import { colors, consoleLayout, layout, space } from '../../src/theme/console.js';

/**
 * prd.md F8.2.6 — ask the machine for questions.
 *
 * The review queue could approve AI drafts and nothing in the app could ASK
 * for any, so half a feature shipped: a reviewer's queue that only ever filled
 * from CSV imports and manual submissions. Drafts land in the review queue
 * rather than in the bank — nothing machine-written reaches a player without
 * somebody having read it.
 */
const COUNTS = [5, 10, 15, 20];
const DIFFICULTIES = [
  { value: 'mixed', label: 'Mixed' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

export default function AdminDrafts() {
  const scrollBottom = useScrollBottom();
  const router = useRouter();
  const adminSpace = useAdminSpace();
  const { canWrite } = useAdminPermissions(adminSpace);

  const [status, setStatus] = useState(null);
  const [topics, setTopics] = useState([]);
  const [topicId, setTopicId] = useState(null);
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState('mixed');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!adminSpace) return;
    try {
      setError(null);
      const [s, t] = await Promise.all([
        api.get('/admin/ai/status', { spaceId: adminSpace.id }),
        api.get('/admin/topics', { spaceId: adminSpace.id }),
      ]);
      setStatus(s);
      setTopics(t.items ?? []);
      setTopicId((prev) => prev ?? (t.items ?? [])[0]?.id ?? null);
    } catch (err) {
      setError(err);
    }
  }, [adminSpace]);

  useEffect(() => {
    load();
  }, [load]);

  const draft = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await api.post('/admin/ai/draft', {
        spaceId: adminSpace.id,
        topicId,
        count,
        difficulty,
        notes: notes.trim() || undefined,
      });
      setResult(data);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  /**
   * The server says whether a provider is configured at all — `available`,
   * with a `reason` when it is not. Read from the endpoint rather than
   * guessed, so an install with no key says so instead of failing on send.
   */
  const available = status ? status.available !== false : true;
  /** The server's own ceiling on one request. */
  const maxPerRequest = status?.maxPerRequest ?? 20;

  return (
    <SafeAreaView style={styles.screen} edges={[]}>
      <Header title="AI drafts" subtitle={adminSpace?.name} />

      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.content, { paddingBottom: scrollBottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ErrorNotice error={error} onRetry={load} />

        {!available ? (
          <EmptyState
            tone="content"
            icon="robot"
            title="Drafting is switched off"
            body={
              status?.reason ??
              'No question provider is configured for this platform, so nothing can be drafted here yet.'
            }
          />
        ) : (
          <>
            {result ? (
              <View style={styles.resultNote}>
                <Text variant="label" color={colors.correct}>
                  {(result.created ?? []).length} drafted
                  {result.rejected?.length ? `  ·  ${result.rejected.length} rejected` : ''}
                </Text>
                <Text variant="meta" color={colors.inkMuted}>
                  {result.message ?? 'They are waiting in the review queue.'}
                </Text>
                <Button
                  size="sm"
                  variant="soft"
                  label="Open the review queue"
                  fullWidth={false}
                  style={{ marginTop: space.sm, alignSelf: 'flex-start' }}
                  onPress={() => router.replace('/admin/review')}
                />
              </View>
            ) : null}

            <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
              Topic
            </Text>
            <View style={styles.chips}>
              {topics.map((topic) => (
                <Chip
                  key={topic.id}
                  label={topic.name}
                  active={topicId === topic.id}
                  onPress={() => setTopicId(topic.id)}
                />
              ))}
            </View>

            <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
              How many
            </Text>
            <View style={styles.chips}>
              {COUNTS.filter((n) => n <= maxPerRequest).map((n) => (
                <Chip key={n} label={String(n)} active={count === n} onPress={() => setCount(n)} />
              ))}
            </View>

            <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
              Difficulty
            </Text>
            <Segmented options={DIFFICULTIES} value={difficulty} onChange={setDifficulty} />

            <Text variant="label" color={colors.inkMuted} style={styles.fieldLabel}>
              Notes for the writer
            </Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional. Syllabus, style, things to avoid."
              placeholderTextColor={colors.inkFaint}
              maxLength={500}
              multiline
              accessibilityLabel="Notes for the drafter"
            />

            <Button
              label={busy ? 'Drafting…' : `Draft ${count} questions`}
              loading={busy}
              disabled={!topicId || !canWrite}
              style={{ marginTop: space.xl }}
              onPress={draft}
            />
            <Text variant="meta" color={colors.inkFaint} style={styles.hint}>
              {canWrite
                ? 'Drafts go to the review queue. Nothing reaches a player unread.'
                : 'Your role does not include creating questions.'}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  content: {
    paddingHorizontal: consoleLayout.gutter,
    // The console header closes with a hairline; content needs air under it.
    paddingTop: space.lg,
  },
  fieldLabel: { marginTop: space.lg, marginBottom: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  hint: { marginTop: space.xs },
  resultNote: {
    backgroundColor: colors.correctSoft,
    borderRadius: layout.radiusCard,
    padding: space.lg,
    marginTop: space.md,
    gap: 2,
  },
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
  multiline: { minHeight: 88, textAlignVertical: 'top' },
});

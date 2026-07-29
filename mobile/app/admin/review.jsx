import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import { useAdminSpace } from '../../src/lib/admin.js';
import {
  Text,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Header,
} from '../../src/components/ui.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import QuestionArt from '../../src/components/QuestionArt.jsx';
import Icon from '../../src/components/Icon.jsx';
import { OPTION_COLORS, colors, consoleLayout, layout, space, type } from '../../src/theme/index.js';

/**
 * prd.md F8.2.8 — the review queue. One card per waiting question with the
 * full text, the four options, the correct one marked, and two decisions:
 * publish or reject. AI drafts are labelled — a reviewer weighs a machine's
 * draft differently from a colleague's, and hiding the source would invite
 * approving without reading.
 */
const LETTERS = ['A', 'B', 'C', 'D'];

export default function AdminReview() {
  const goBack = useConsoleBack();
  const adminSpace = useAdminSpace();
  const [queue, setQueue] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!adminSpace) return;
    try {
      setError(null);
      setQueue(await api.get('/admin/review', { spaceId: adminSpace.id }));
    } catch (err) {
      setError(err);
    }
  }, [adminSpace]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (question, action) => {
    setBusyId(question.id);
    try {
      setError(null);
      await api.post('/admin/review/batch', {
        spaceId: adminSpace.id,
        ids: [question.id],
        action, // 'publish' | 'archive'
      });
      // The card leaves the queue instantly; the next one moves up.
      setQueue((current) => ({
        ...current,
        total: Math.max(0, (current?.total ?? 1) - 1),
        items: (current?.items ?? []).filter((q) => q.id !== question.id),
      }));
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  };

  const items = queue?.items ?? [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header
        title="Review queue"
        subtitle={queue ? `${queue.total} waiting${queue.aiPending ? ` · ${queue.aiPending} from AI` : ''}` : adminSpace?.name}
        onBack={goBack}
      />

      <ErrorNotice error={error} onRetry={load} />

      {!queue && !error ? (
        <CardsSkeleton count={3} lines={4} bar={false} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="check"
          title="Queue clear"
          body="Nothing is waiting for review. Imported and submitted questions land here before they can be played."
        />
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {items.map((question) => (
            <Card key={question.id} style={styles.card}>
              <View style={styles.cardHead}>
                <Badge
                  label={question.source === 'ai' ? 'AI draft' : 'Manual'}
                  tone={question.source === 'ai' ? 'accent' : 'soft'}
                />
                <Text variant="meta" color={colors.inkFaint}>
                  {question.difficulty}
                  {question.topics?.length ? `  ·  ${question.topics.join(', ')}` : ''}
                </Text>
              </View>

              {/* The picture IS the question on a picture question, so a
                  reviewer has to see it before approving anything. */}
              {question.imageUrl ? (
                <View style={styles.art}>
                  <QuestionArt imageUrl={question.imageUrl} size={120} />
                </View>
              ) : null}

              <Text style={[type.question, styles.question]}>{question.text}</Text>

              {question.options.map((option, i) => {
                const correct = i === question.correctIndex;
                return (
                  <View key={i} style={[styles.option, correct && styles.optionCorrect]}>
                    <View
                      style={[
                        styles.letter,
                        { backgroundColor: correct ? colors.correct : OPTION_COLORS[i % 4] },
                      ]}
                    >
                      <Text variant="tiny" color={colors.onColor}>
                        {LETTERS[i]}
                      </Text>
                    </View>
                    <Text
                      style={[type.option, { flex: 1, color: correct ? colors.correct : colors.ink }]}
                    >
                      {option}
                    </Text>
                    {correct ? <Icon name="check" size={15} color={colors.correct} /> : null}
                  </View>
                );
              })}

              {question.explanation ? (
                <View style={styles.explanation}>
                  <Text variant="meta" color={colors.accent} style={{ marginBottom: 2 }}>
                    Why
                  </Text>
                  <Text variant="body" color={colors.inkMuted}>
                    {question.explanation}
                  </Text>
                </View>
              ) : null}

              <View style={styles.decisions}>
                <Button
                  label="Publish"
                  size="md"
                  style={{ flex: 1 }}
                  loading={busyId === question.id}
                  onPress={() => decide(question, 'publish')}
                />
                <Button
                  label="Reject"
                  size="md"
                  variant="danger"
                  style={{ flex: 1 }}
                  disabled={busyId === question.id}
                  onPress={() => decide(question, 'archive')}
                />
              </View>
              {question.createdBy ? (
                <Text variant="tiny" color={colors.inkFaint} style={styles.byline}>
                  Drafted by {question.createdBy}
                </Text>
              ) : null}
            </Card>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  list: { padding: consoleLayout.gutter, paddingTop: space.sm, paddingBottom: space.xxxl, gap: layout.cardGap },
  card: {},
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginBottom: space.sm,
  },
  art: { alignItems: 'center', paddingVertical: space.sm },
  question: { color: colors.ink, marginBottom: space.md },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 44,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: layout.radiusInput,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    marginBottom: space.sm,
  },
  optionCorrect: { borderColor: colors.correct, backgroundColor: colors.correctSoft },
  letter: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  explanation: {
    backgroundColor: colors.sunken,
    borderRadius: layout.radiusInput,
    padding: space.md,
    marginTop: space.xs,
  },
  decisions: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  byline: { textAlign: 'center', marginTop: space.sm },
});

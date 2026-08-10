import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useConsoleBack } from '../../src/lib/consoleBack.js';
import { useConsoleSpace } from '../../src/lib/admin.js';
import {
  Text,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Header,
  useScrollBottom,
} from '../../src/components/ui.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import QuestionArt from '../../src/components/QuestionArt.jsx';
import Icon from '../../src/components/Icon.jsx';
import { OPTION_COLORS, colors, consoleLayout, layout, space, type } from '../../src/theme/console.js';

/**
 * prd.md F8.2.8 — the review queue. One card per waiting question with the
 * full text, the four options, the correct one marked, and the three things a
 * reviewer can conclude: it is right, it is nearly right, it is wrong. AI
 * drafts are labelled — a reviewer weighs a machine's draft differently from a
 * colleague's, and hiding the source would invite approving without reading.
 *
 * Mounted at `/admin/review` and at `/super/review`, because an import into the
 * Central Bank lands in review exactly like an import into an organization's —
 * the queue has to exist in the console that can fill it.
 */
const LETTERS = ['A', 'B', 'C', 'D'];

export default function AdminReview() {
  const scrollBottom = useScrollBottom();
  const router = useRouter();
  const goBack = useConsoleBack();
  const { spaceId, spaceName, inTenant, href } = useConsoleSpace();
  const [queue, setQueue] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!spaceId) return;
    try {
      setError(null);
      setQueue(await api.get('/admin/review', { spaceId }));
    } catch (err) {
      setError(err);
    }
  }, [spaceId]);

  /**
   * Reloads on FOCUS, not on mount — "Fix it" opens the editor and comes
   * straight back here, and a question that was corrected and published from
   * the editor has to have left the queue by the time you land.
   */
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const decide = async (question, action) => {
    setBusyId(question.id);
    try {
      setError(null);
      await api.post('/admin/review/batch', {
        spaceId,
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
    <SafeAreaView style={styles.screen} edges={[]}>
      {/* Scoped into a tenant it is a PUSHED screen — the platform operator
          arrived from that organization and has somewhere to go back to. From
          the sidebar it is a sidebar screen and wears the menu. */}
      <Header
        title="Review queue"
        subtitle={queue ? `${queue.total} waiting${queue.aiPending ? ` · ${queue.aiPending} from AI` : ''}` : spaceName}
        onBack={inTenant ? goBack : undefined}
      />

      <ErrorNotice error={error} onRetry={load} />

      {!queue && !error ? (
        <CardsSkeleton count={3} lines={4} bar={false} />
      ) : items.length === 0 ? (
        <EmptyState
          tone="content"
          icon="check"
          title="Queue clear"
          body="Nothing is waiting for review. Imported and submitted questions land here before they can be played."
        />
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: scrollBottom }]} showsVerticalScrollIndicator={false}>
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

              {/**
               * Three decisions, not two.
               *
               * A reviewer reads a question and finds a typo, a fourth option
               * that gives the answer away, or a missing explanation — and
               * this screen offered Publish or Reject. Neither is the right
               * answer to "it is nearly right": rejecting a colleague's
               * question over a spelling mistake throws away the work, and
               * publishing it ships the mistake. The queue had no way to
               * simply FIX it, so the only route was to reject, go to the
               * bank, find it among the archived, and start again.
               */}
              <View style={styles.decisions}>
                <Button
                  label="Publish"
                  size="md"
                  style={{ flex: 1 }}
                  loading={busyId === question.id}
                  onPress={() => decide(question, 'publish')}
                />
                <Button
                  label="Fix it"
                  size="md"
                  variant="soft"
                  style={{ flex: 1 }}
                  disabled={busyId === question.id}
                  onPress={() => router.push(href('question-edit', { id: question.id }))}
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
  list: { padding: consoleLayout.gutter, paddingTop: space.sm, gap: layout.cardGap },
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
    // An inset INSIDE a card, so it takes `canvas` — the console's inset
    // tone — not the card fill it is sitting on. Filled with `nightRaised`
    // it was the card's own colour and had no edge at all, which paper only
    // makes more obvious: a white box on a white card.
    backgroundColor: colors.canvas,
    borderRadius: layout.radiusInput,
    padding: space.md,
    marginTop: space.xs,
  },
  // Three across, so the gap tightens — at `md` the labels start wrapping on
  // a 375pt screen.
  decisions: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  byline: { textAlign: 'center', marginTop: space.sm },
});

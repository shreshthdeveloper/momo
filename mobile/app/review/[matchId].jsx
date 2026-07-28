import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { Text, ErrorNotice, Card, Divider, Button, Header, Badge } from '../../src/components/ui.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import Icon from '../../src/components/Icon.jsx';
import QuestionArt from '../../src/components/QuestionArt.jsx';
import { colors, layout, space, type, OPTION_COLORS } from '../../src/theme/index.js';

const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * design.md §8.9 — review.
 *
 * "A scrollable list, one card per question: the question, all four options
 * with the correct one marked, both players' choices, and the explanation
 * where the question has one.
 *
 * For institute content this is the screen where learning actually happens,
 * which is why explanations are strongly encouraged in the PRD. Design it for
 * READING, not for skimming — generous line height, full text, no truncation."
 *
 * Which is exactly why the options here are outlined rows on paper rather than
 * the saturated tiles of the match screen. Four solid colours are right when
 * you have ten seconds; they are exhausting when you are reading seven
 * explanations in a row.
 */
export default function Review() {
  const { matchId } = useLocalSearchParams();
  const router = useRouter();
  const [match, setMatch] = useState(null);
  const [error, setError] = useState(null);
  const [reported, setReported] = useState(new Set());

  useEffect(() => {
    api.get(`/matches/${matchId}`).then(setMatch).catch(setError);
  }, [matchId]);

  const report = async (questionId) => {
    try {
      await api.post('/reports', {
        targetType: 'question',
        targetId: questionId,
        reason: 'wrong_answer',
        matchId: String(matchId),
      });
      setReported((s) => new Set([...s, questionId]));
    } catch {
      // A duplicate report is a no-op server-side; nothing useful to say here.
      setReported((s) => new Set([...s, questionId]));
    }
  };

  if (error) {
    return (
      <SafeAreaView style={styles.screen}>
        <ErrorNotice error={error} />
        <Button variant="ghost" label="Back" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }
  if (!match) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header title="Review" onBack={() => router.back()} />
        <CardsSkeleton count={3} lines={3} bar={false} />
      </SafeAreaView>
    );
  }

  const correctCount = match.rounds.filter((r) => r.you.optionIndex === r.correctIndex).length;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header
        title={match.topic?.name}
        subtitle={`${match.scores.you}–${match.scores.opponent} vs ${match.opponent?.displayName ?? 'opponent'}`}
        onBack={() => router.back()}
        right={<Badge label={`${correctCount}/${match.rounds.length}`} tone="soft" />}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {match.rounds.map((round) => (
          <Card key={round.roundIndex} style={styles.card}>
            <View style={styles.cardHead}>
              <Text variant="meta" color={colors.inkFaint}>
                Question {round.roundIndex + 1}
              </Text>
              <Text
                variant="meta"
                color={round.you.optionIndex === round.correctIndex ? colors.correct : colors.wrong}
              >
                {round.you.optionIndex === null
                  ? 'No answer'
                  : round.you.optionIndex === round.correctIndex
                    ? 'Correct'
                    : 'Wrong'}
              </Text>
            </View>

            {/* A picture question is unreviewable without its picture — the
                text alone ("which emblem is this?") names nothing. */}
            {round.imageUrl ? (
              <View style={styles.art}>
                <QuestionArt
                  imageUrl={round.imageUrl}
                  size={120}
                  label={`Picture for: ${round.text}`}
                />
              </View>
            ) : null}

            {/* No truncation, generous line height — this screen is for reading. */}
            <Text style={[type.question, styles.question]}>{round.text}</Text>

            {round.options.map((option, i) => {
              const isCorrect = i === round.correctIndex;
              const youChose = round.you.optionIndex === i;
              const theyChose = round.opponent.optionIndex === i;
              const tone = isCorrect ? colors.correct : youChose ? colors.wrong : colors.hairline;

              return (
                <View
                  key={i}
                  style={[
                    styles.option,
                    { borderColor: tone },
                    isCorrect ? { backgroundColor: colors.correctSoft } : null,
                    youChose && !isCorrect ? { backgroundColor: colors.wrongSoft } : null,
                  ]}
                >
                  <View
                    style={[
                      styles.letter,
                      {
                        backgroundColor: isCorrect
                          ? colors.correct
                          : youChose
                            ? colors.wrong
                            : OPTION_COLORS[i % OPTION_COLORS.length],
                      },
                    ]}
                  >
                    <Text variant="tiny" color={colors.onColor}>
                      {LETTERS[i]}
                    </Text>
                  </View>

                  <Text
                    style={[
                      type.option,
                      {
                        flex: 1,
                        color: isCorrect ? colors.correct : youChose ? colors.wrong : colors.ink,
                      },
                    ]}
                  >
                    {option}
                  </Text>

                  <View style={styles.markers}>
                    {youChose ? (
                      <View style={[styles.tag, { backgroundColor: colors.accentSoft }]}>
                        <Text variant="tiny" color={colors.accent}>
                          You
                        </Text>
                      </View>
                    ) : null}
                    {theyChose ? (
                      <View style={[styles.tag, { backgroundColor: colors.rivalSoft }]}>
                        <Text variant="tiny" color={colors.rival}>
                          Them
                        </Text>
                      </View>
                    ) : null}
                    {isCorrect ? <Icon name="check" size={15} color={colors.correct} /> : null}
                  </View>
                </View>
              );
            })}

            {round.explanation ? (
              <View style={styles.explanationBox}>
                <Text variant="meta" color={colors.accent} style={{ marginBottom: space.xs }}>
                  Why
                </Text>
                <Text variant="body" color={colors.inkMuted} style={styles.explanation}>
                  {round.explanation}
                </Text>
              </View>
            ) : null}

            <Divider style={{ marginVertical: space.md }} />

            <View style={styles.cardFooter}>
              <Text variant="meta" color={colors.inkFaint}>
                {round.you.optionIndex === null
                  ? 'You ran out of time'
                  : `${round.you.points} points  ·  ${(round.you.elapsedMs / 1000).toFixed(1)}s`}
              </Text>

              {/* prd.md F6.4.21 — report a question from the review screen. */}
              <Pressable
                onPress={() => report(round.questionId)}
                hitSlop={8}
                disabled={reported.has(round.questionId)}
               style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}>
                <Text variant="meta" color={colors.inkFaint}>
                  {reported.has(round.questionId) ? "Reported. We'll review it." : 'Report'}
                </Text>
              </Pressable>
            </View>
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.sunken },
  // The container's `gap` is the only spacing. It was also on every card as a
  // `marginBottom`, which added up to a 24px trench between question cards and
  // a stray 12px of dead space below the last one.
  content: { padding: layout.gutter, paddingTop: space.sm, gap: layout.cardGap },
  card: {},
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  art: { alignItems: 'center', marginTop: space.md },
  question: { color: colors.ink, marginTop: space.sm, marginBottom: space.lg },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 52,
    marginBottom: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: layout.radiusInput,
    borderWidth: 1.5,
  },
  letter: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markers: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  tag: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  explanationBox: {
    backgroundColor: colors.sunken,
    borderRadius: layout.radiusInput,
    padding: space.md,
    marginTop: space.sm,
  },
  explanation: { lineHeight: 25 },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});

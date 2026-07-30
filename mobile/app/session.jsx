import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useSession } from '../src/state/session.jsx';
import {
  Text,
  Avatar,
  Badge,
  Button,
  Card,
  ErrorNotice,
  Header,
  ProgressBar,
  SearchField,
} from '../src/components/ui.jsx';
import AnswerRow from '../src/components/AnswerRow.jsx';
import Icon from '../src/components/Icon.jsx';
import { colors, layout, space, type } from '../src/theme/index.js';

/**
 * The live class session, from inside the room.
 *
 * One screen for the student and the host, not two. Everything they see is the
 * same — the question, the clock, the spread of answers, the board — and the only
 * differences are that the host gets the controls and does not get scored. Two
 * screens would have been two copies of a question renderer drifting apart, and
 * the host still needs to see exactly what the class is looking at.
 *
 * ── Four states, in order ────────────────────────────────────────────────────
 *
 *   join     → a code field, before you are in anything
 *   lobby    → the roster filling up, and the host's Start
 *   question → the question and the clock
 *   result   → the answer, what the class chose, the board, and the host's Next
 *
 * The result state is the one that justifies the feature: it is where the teacher
 * asks why nineteen people picked B, and the app's job there is to hold still.
 */
export default function SessionScreen() {
  const router = useRouter();
  const { code: codeParam } = useLocalSearchParams();
  const session = useSession();
  const [code, setCode] = useState(String(codeParam ?? ''));
  const [joining, setJoining] = useState(false);

  /** A code in the route means the host just created it — join straight in. */
  useEffect(() => {
    if (codeParam && session.status === 'idle') {
      setJoining(true);
      session.join(String(codeParam)).finally(() => setJoining(false));
    }
  }, [codeParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = useCallback(async () => {
    if (joining || code.trim().length < 4) return;
    setJoining(true);
    await session.join(code);
    setJoining(false);
  }, [joining, code, session]);

  const quit = useCallback(() => {
    session.leave();
    router.back();
  }, [session, router]);

  if (session.status === 'idle') {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header title="Join a session" onBack={() => router.back()} />
        <ErrorNotice error={session.error} />
        <View style={styles.joinBody}>
          <Icon name="friends" size={40} color={colors.accent} />
          <Text variant="title" style={{ marginTop: space.md }}>
            Enter the code
          </Text>
          <Text variant="body" color={colors.inkMuted} style={styles.joinBlurb}>
            Your teacher has it on the board. Everyone answers the same question at
            the same time.
          </Text>
          <SearchField
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase())}
            placeholder="ABC123"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            style={styles.codeField}
            onClear={() => setCode('')}
          />
          <Button
            label="Join"
            loading={joining}
            disabled={code.trim().length < 4}
            onPress={submit}
            style={{ marginTop: space.md }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StatusBar style="light" />
      <Header
        title={session.name ?? 'Session'}
        subtitle={
          session.status === 'lobby'
            ? `Code ${session.code}`
            : `Question ${session.roundIndex + 1} of ${session.totalRounds}`
        }
        onBack={quit}
        right={session.isHost ? <Badge tone="live" label="HOST" /> : null}
      />
      <ErrorNotice error={session.error} />

      {session.status === 'lobby' ? (
        <Lobby session={session} />
      ) : session.status === 'question' ? (
        <Question session={session} />
      ) : session.status === 'result' ? (
        <Result session={session} />
      ) : (
        <Ended session={session} onDone={quit} />
      )}
    </SafeAreaView>
  );
}

/**
 * The waiting room.
 *
 * The roster is the whole screen because it is the only thing anybody cares about
 * before the start: a teacher watching the count reach thirty is how they know
 * they can begin, and a student seeing their own name is how they know the code
 * worked.
 */
function Lobby({ session }) {
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Card style={styles.codeCard}>
        <Text variant="meta" color={colors.inkFaint}>
          Anyone in your organization can join with
        </Text>
        <Text allowFontScaling={false} style={styles.codeBig}>
          {session.code}
        </Text>
      </Card>

      <Text variant="label" style={styles.rosterHead}>
        {session.roster.length} {session.roster.length === 1 ? 'person' : 'people'} in
      </Text>

      <View style={styles.roster}>
        {session.roster.map((person) => (
          <View key={person.id} style={styles.rosterChip}>
            <Avatar url={person.avatarUrl} name={person.displayName} size={24} />
            <Text variant="meta" numberOfLines={1}>
              {person.displayName}
            </Text>
          </View>
        ))}
      </View>

      {session.isHost ? (
        <Button
          label="Start the session"
          disabled={session.roster.length === 0}
          onPress={session.start}
          style={{ marginTop: space.xl }}
        />
      ) : (
        <Text variant="meta" color={colors.inkFaint} style={styles.waiting}>
          Waiting for your teacher to start.
        </Text>
      )}
    </ScrollView>
  );
}

/**
 * A question, and the clock.
 *
 * The count of who is in is on screen and the *choices* are not — the same rule
 * the 1v1 match follows about the opponent, for the same reason. Thirty people in
 * one room can see each other's screens; publishing what the fast ones picked
 * would make the rest a copying exercise.
 */
function Question({ session }) {
  const [remaining, setRemaining] = useState(session.durationMs ?? 0);
  const fill = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, (session.startedAt ?? 0) + (session.durationMs ?? 0) - Date.now());
      setRemaining(left);
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [session.startedAt, session.durationMs, session.roundIndex]);

  useEffect(() => {
    const left = Math.max(0, (session.startedAt ?? 0) + (session.durationMs ?? 0) - Date.now());
    fill.setValue(left / (session.durationMs || 1));
    Animated.timing(fill, { toValue: 0, duration: left, useNativeDriver: false }).start();
  }, [session.roundIndex, session.startedAt, session.durationMs, fill]);

  const seconds = Math.ceil(remaining / 1000);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.clockRow}>
        <Text allowFontScaling={false} style={[styles.clock, seconds <= 5 && { color: colors.wrong }]}>
          {seconds}
        </Text>
        <View style={{ flex: 1 }}>
          <Animated.View style={styles.clockTrack}>
            <Animated.View
              style={[
                styles.clockFill,
                {
                  backgroundColor: seconds <= 5 ? colors.wrong : colors.accent,
                  width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                },
              ]}
            />
          </Animated.View>
          <Text variant="meta" color={colors.inkFaint} style={{ marginTop: space.xs }}>
            {session.answeredCount} of {session.roster.length} in
          </Text>
        </View>
      </View>

      <Text variant="title" style={styles.questionText}>
        {session.question?.text}
      </Text>

      {(session.question?.options ?? []).map((option, i) => (
        <AnswerRow
          key={i}
          index={i}
          label={option}
          disabled={session.answered}
          selected={false}
          onPress={() => session.answer(i)}
        />
      ))}

      {session.answered ? (
        <Text variant="meta" color={colors.correct} style={styles.locked}>
          Locked in. Waiting for the rest of the class.
        </Text>
      ) : null}
    </ScrollView>
  );
}

/**
 * The answer, and what the class did with it.
 *
 * The distribution bar is the reason this screen waits for the host rather than
 * moving on by itself: "nineteen of you chose B" is a teaching moment, and it
 * needs however long it needs.
 */
function Result({ session }) {
  const result = session.result ?? {};
  const total = Math.max(1, result.answered ?? 1);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text variant="title" style={styles.questionText}>
        {session.question?.text}
      </Text>

      {(session.question?.options ?? []).map((option, i) => {
        const count = result.distribution?.[i] ?? 0;
        const right = i === result.correctIndex;
        return (
          <View key={i} style={[styles.spreadRow, right && styles.spreadRight]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="label" color={right ? colors.correct : colors.inkMuted} numberOfLines={2}>
                {option}
              </Text>
              <ProgressBar
                value={count}
                max={total}
                height={6}
                color={right ? colors.correct : colors.inkFaint}
              />
            </View>
            <Text variant="label" color={right ? colors.correct : colors.inkFaint}>
              {count}
            </Text>
          </View>
        );
      })}

      {result.explanation ? (
        <Text variant="body" color={colors.inkMuted} style={styles.explanation}>
          {result.explanation}
        </Text>
      ) : null}

      <Text variant="label" style={styles.boardHead}>
        Leading
      </Text>
      {(session.board ?? []).slice(0, 5).map((row) => (
        <View key={row.id} style={styles.boardRow}>
          <Text variant="meta" color={colors.inkFaint} style={{ width: 22 }}>
            {row.rank}
          </Text>
          <Avatar url={row.avatarUrl} name={row.displayName} size={26} />
          <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
            {row.displayName}
          </Text>
          <Text variant="label">{row.score}</Text>
        </View>
      ))}

      {session.isHost ? (
        <Button
          label={result.isLast ? 'Finish and show the board' : 'Next question'}
          onPress={result.isLast ? session.end : session.next}
          style={{ marginTop: space.xl }}
        />
      ) : (
        <Text variant="meta" color={colors.inkFaint} style={styles.waiting}>
          Your teacher moves the class on.
        </Text>
      )}
    </ScrollView>
  );
}

/** The final board — the thing that goes on the projector at the end. */
function Ended({ session, onDone }) {
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text variant="title" style={{ marginBottom: space.lg }}>
        Final board
      </Text>

      {(session.board ?? []).map((row) => (
        <View key={row.id} style={[styles.boardRow, row.rank === 1 && styles.boardWinner]}>
          <Text variant="label" color={row.rank === 1 ? colors.gold : colors.inkFaint} style={{ width: 26 }}>
            {row.rank}
          </Text>
          <Avatar url={row.avatarUrl} name={row.displayName} size={30} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="label" numberOfLines={1}>
              {row.displayName}
            </Text>
            <Text variant="meta" color={colors.inkFaint}>
              {row.correctCount} correct
            </Text>
          </View>
          <Text variant="label">{row.score}</Text>
        </View>
      ))}

      <Button label="Done" variant="soft" onPress={onDone} style={{ marginTop: space.xl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: layout.gutter, paddingBottom: layout.scrollBottom },

  joinBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: layout.gutter },
  joinBlurb: { textAlign: 'center', marginTop: space.sm, marginBottom: space.xl, maxWidth: 300 },
  codeField: { width: '100%' },

  codeCard: { alignItems: 'center', marginBottom: space.lg },
  codeBig: { ...type.scoreHero, fontSize: 42, letterSpacing: 8, color: colors.accent, marginTop: space.xs },
  rosterHead: { marginBottom: space.sm },
  roster: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  rosterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    borderRadius: layout.radiusPill,
    backgroundColor: colors.sunken,
    maxWidth: 180,
  },
  waiting: { textAlign: 'center', marginTop: space.xl },

  clockRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.lg },
  clock: { ...type.scoreHero, fontSize: 34, color: colors.ink, minWidth: 46 },
  clockTrack: { height: 8, borderRadius: 4, backgroundColor: colors.sunken, overflow: 'hidden' },
  clockFill: { height: 8, borderRadius: 4 },
  questionText: { marginBottom: space.lg },
  locked: { textAlign: 'center', marginTop: space.md },

  spreadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.cardPadding,
    paddingVertical: space.md,
    marginBottom: space.sm,
    borderRadius: layout.radiusInput,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
  },
  spreadRight: { borderColor: colors.correct, backgroundColor: colors.correctSoft },
  explanation: { marginTop: space.sm, marginBottom: space.lg },
  boardHead: { marginTop: space.lg, marginBottom: space.sm },
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 46,
    paddingHorizontal: space.sm,
    borderRadius: layout.radiusInput,
  },
  boardWinner: { backgroundColor: colors.goldSoft },
});

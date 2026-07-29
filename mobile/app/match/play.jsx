import { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { useGame } from '../../src/state/game.jsx';
import { Text, ConfirmSheet, RollingNumber, Avatar } from '../../src/components/ui.jsx';
import { BrandField } from '../../src/components/Brand.jsx';
import { TopicGlyph } from '../../src/components/Illustration.jsx';
import AnswerRow from '../../src/components/AnswerRow.jsx';
import QuestionArt from '../../src/components/QuestionArt.jsx';
import { useRoundClock, TimeLine, ScoreRail } from '../../src/components/RoundClock.jsx';
import { colors, layout, space, type, motion } from '../../src/theme/index.js';
import { useReducedMotion } from '../../src/lib/motion.js';
import { sfx } from '../../src/lib/sound.js';
import { MAX_ROUND_SCORE, QUESTION_TEXT_SOFT_MAX } from '../../src/shared/constants.js';

/**
 * design.md §8.6 — the match screen, arranged the way QuizUp arranged it,
 * but staged on the night field: the battle happens in the same dark world the
 * versus screen opened, and the paper world only returns when it is over.
 *
 *   ┌────────────────────────────────┐
 *   │ ●You 118   TIME LEFT   142 Rival● │  header: faces, scores, the clock
 *   │ ━━━━━━━━━━━━━━━━━━━━░░░░░░░░░  │  a thin line draining with the round
 *   ║                                ║
 *   ║     Which element has the      │  ← the question, alone, centre stage
 *   ║       atomic number 26?        ║
 *   ║                                ║
 *   ║  ⓐ Iron   ⓑ Copper  …          ║  ← the options arrive on a later beat
 *   └────────────────────────────────┘
 *
 * Every round is three beats, each with its own sound:
 *
 *   1. ROUND 4 stamps in and lifts off        (sfx.round)
 *   2. the question drops in and stands ALONE — a beat to actually read it
 *   3. the four options deal themselves in    (sfx.reveal), and the round is on
 *
 * The read-beat is what makes it a game rather than a form: everyone spends
 * the same second reading, and the scramble starts when the options land.
 */

/** How far along the reveal timeline the question (alone) is fully in. */
const QUESTION_IN = 0.25;
/** The read-beat: the question stands alone for this long. */
const READ_HOLD_MS = 850;

export default function MatchScreen() {
  const game = useGame();
  const router = useRouter();
  const reduced = useReducedMotion();
  const [confirmLeave, setConfirmLeave] = useState(false);

  // ── The round entrance: interstitial → question → read-beat → options.
  const intro = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(0)).current;
  const lastRound = useRef(-1);
  const [interstitial, setInterstitial] = useState(false);
  // Rows are invisible until their beat — they must be untouchable too.
  const [optionsLive, setOptionsLive] = useState(false);

  const isBonus = game.roundIndex === game.totalRounds - 1;

  // No sound on the round interstitial — seven rounds a match, and a cue on
  // every one of them wore thin. The reveal beat carries the round's audio.
  useEffect(() => {
    if (game.roundIndex === lastRound.current || game.roundIndex < 0) return;
    lastRound.current = game.roundIndex;

    if (reduced) {
      intro.setValue(0);
      reveal.setValue(1);
      setInterstitial(false);
      setOptionsLive(true);
      return;
    }

    setInterstitial(true);
    setOptionsLive(false);
    reveal.setValue(0);
    intro.setValue(0);
    Animated.sequence([
      // The claim: ROUND N stamps in…
      Animated.timing(intro, { toValue: 1, duration: 200, easing: Easing.out(Easing.back(1.7)), useNativeDriver: true }),
      Animated.delay(440),
      // …lifts off…
      Animated.timing(intro, { toValue: 0, duration: 150, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      // …the question drops in and stands alone…
      Animated.timing(reveal, { toValue: QUESTION_IN, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      // …the read-beat…
      Animated.delay(READ_HOLD_MS),
    ]).start(({ finished }) => {
      if (!finished) return;
      // …and the options deal in, one after another.
      setInterstitial(false);
      setOptionsLive(true);
      sfx.reveal();
      Animated.timing(reveal, { toValue: 1, duration: 560, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    });
  }, [game.roundIndex, reduced, intro, reveal]);

  // A resolution arriving mid-choreography (a resume, a very fast rival) snaps
  // the stage to its final state — a verdict over invisible options is chaos.
  useEffect(() => {
    if (game.status !== 'resolved') return;
    intro.stopAnimation();
    reveal.stopAnimation();
    intro.setValue(0);
    reveal.setValue(1);
    setInterstitial(false);
    setOptionsLive(true);
  }, [game.status, intro, reveal]);

  // Leaving mid-match forfeits, so the hardware back button must go through
  // the same confirmation as everything else.
  // Once the forfeit is already in flight there is nothing left to confirm, so
  // back is swallowed rather than re-asking a question already answered.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (game.status !== 'leaving') setConfirmLeave(true);
      return true;
    });
    return () => sub.remove();
  }, [game.status]);

  useEffect(() => {
    if (game.status === 'finished') router.replace('/match/result');
    if (game.status === 'idle') router.replace('/');
  }, [game.status, router]);

  const resolved = game.status === 'resolved' && game.roundResult;
  const result = game.roundResult;

  /** §8.7 — resolution state per option, computed once for all four rows. */
  const resolutionFor = (index) => {
    if (!resolved) return null;
    if (index === result.correctIndex) {
      return result.you.optionIndex === index ? 'correct' : 'missed';
    }
    if (result.you.optionIndex === index) return 'wrong';
    return null;
  };

  /**
   * A picture question — "which emblem is this?" — carries its subject in the
   * image rather than in the text, so the picture is the question and the words
   * are the prompt for it.
   *
   * The frame is sized off the SHORT edge of the window and hard-capped: the
   * stage between the header and the four options is the tightest space in the
   * product, and an image that pushed a row under the fold would cost the round
   * rather than illustrate it. Below the cap the question simply has no picture.
   */
  const { height: screenH } = useWindowDimensions();
  const artSize = Math.round(Math.max(0, Math.min(148, screenH * 0.17)));
  const hasArt = Boolean(game.question?.imageUrl) && artSize >= 96;

  /**
   * With a picture above it the text gets less room, so it steps down to the
   * long-question face sooner — the picture is carrying the subject and the
   * words no longer have to shout.
   */
  const textBudget = hasArt ? QUESTION_TEXT_SOFT_MAX * 0.6 : QUESTION_TEXT_SOFT_MAX;
  const questionStyle =
    (game.question?.text?.length ?? 0) > textBudget ? type.questionLong : type.question;

  /**
   * One clock for the line and the readout. `startedAt` is a SERVER timestamp,
   * corrected here for clock offset the same way `answer()` corrects elapsed
   * time — an uncorrected phone clock silently stole seconds from the round.
   */
  const clock = useRoundClock({
    startedAt: game.startedAt ? game.startedAt + game.serverOffsetMs : null,
    durationMs: game.durationMs,
    running: game.status === 'playing',
  });
  const urgent = game.status === 'playing' && clock.secondsLeft <= 3;

  // The last three seconds each land a soft tick — but only while the player
  // still owes an answer. Ticking at someone who has committed is nagging.
  useEffect(() => {
    if (game.status !== 'playing' || game.yourAnswer) return;
    if (clock.secondsLeft <= 3 && clock.secondsLeft > 0) sfx.tick();
  }, [clock.secondsLeft, game.status, game.yourAnswer]);

  const maxScore = (game.totalRounds || 7) * MAX_ROUND_SCORE;

  // The question then each option, cut from the one reveal timeline.
  const slice = (from, to) => ({
    opacity: reveal.interpolate({ inputRange: [from, to], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [
      {
        translateY: reveal.interpolate({
          inputRange: [from, to],
          outputRange: [26, 0],
          extrapolate: 'clamp',
        }),
      },
    ],
  });

  // One line under the header for whatever the moment needs said.
  const statusLine = game.status === 'leaving'
    ? { text: 'leaving the match…', tone: '#FF9B8F' }
    : !game.opponentConnected
    ? { text: 'opponent reconnecting', tone: 'rgba(255,255,255,0.55)' }
    : game.status === 'playing' && game.opponentAnswered && !game.yourAnswer
      ? { text: `${game.opponent?.displayName ?? 'Rival'} has locked in`, tone: '#FFD98A' }
      : {
          text: isBonus ? 'Bonus round — double or nothing on speed' : `Round ${Math.max(1, game.roundIndex + 1)} of ${game.totalRounds}`,
          tone: 'rgba(255,255,255,0.55)',
        };

  const clockTone =
    urgent ? '#FF9B8F' : clock.secondsLeft <= 5 ? '#FFD98A' : colors.onColor;

  return (
    <BrandField tone={colors.night}>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <StatusBar style="light" />

        {/* ── The thin line: the round draining in real time. */}
        <TimeLine progress={clock.progress} urgent={urgent} tone="onColor" />

        <VerdictBanner result={resolved ? result : null} reduced={reduced} />

        {/* ── Header: you left, the clock stated in the middle, them right. */}
        <View style={styles.header}>
          <View style={styles.corner}>
            <Avatar url={game.you?.avatarUrl} name={game.you?.displayName} size={40} ring="you" />
            <View style={styles.cornerText}>
              <Text variant="meta" color="rgba(255,255,255,0.66)" numberOfLines={1} style={styles.cornerName}>
                You
              </Text>
              <RollingNumber value={game.scores.you} color={colors.onColor} style={styles.score} />
            </View>
          </View>

          <View style={styles.clock}>
            <Text variant="tiny" color="rgba(255,255,255,0.5)" style={styles.clockLabel}>
              TIME LEFT
            </Text>
            <Text
              allowFontScaling={false}
              style={[type.timer, styles.clockValue, { color: clockTone }]}
            >
              {clock.secondsLeft}
            </Text>
          </View>

          <View style={[styles.corner, styles.cornerRight]}>
            <View style={[styles.cornerText, styles.cornerTextRight]}>
              <Text variant="meta" color="rgba(255,255,255,0.66)" numberOfLines={1} style={styles.cornerName}>
                {game.opponent?.displayName ?? 'Rival'}
              </Text>
              <RollingNumber value={game.scores.opponent} color={colors.rival} style={styles.score} />
            </View>
            <Avatar
              url={game.opponent?.avatarUrl}
              name={game.opponent?.displayName}
              size={40}
              ring="rival"
            />
          </View>
        </View>

        <Text variant="meta" color={statusLine.tone} style={styles.statusLine} numberOfLines={1}>
          {statusLine.text}
        </Text>

        {/* ── The round itself: question centre stage, options on the floor. */}
        <View style={styles.body}>
          <Animated.View style={[styles.questionStage, slice(0, QUESTION_IN)]}>
            {hasArt ? (
              <QuestionArt
                imageUrl={game.question.imageUrl}
                size={artSize}
                // The picture IS the question here, so it is announced before
                // the words rather than skipped as decoration.
                label={`Picture for: ${game.question?.text ?? 'this question'}`}
              />
            ) : null}
            <Text
              style={[questionStyle, styles.question]}
              accessibilityRole="header"
            >
              {game.question?.text ?? ''}
            </Text>
          </Animated.View>

          <View accessibilityRole="radiogroup" pointerEvents={optionsLive ? 'auto' : 'none'}>
            {game.options.map((option, index) => (
              <Animated.View
                key={`${game.roundIndex}-${index}`}
                style={slice(0.3 + index * 0.14, 0.56 + index * 0.14)}
              >
                <AnswerRow
                  index={index}
                  label={option}
                  selected={game.yourAnswer?.optionIndex === index}
                  disabled={!optionsLive || Boolean(game.yourAnswer) || game.status !== 'playing'}
                  resolution={resolutionFor(index)}
                  // Once anything is settled — your pick, or the round resolving
                  // on the timer with no pick — the rows you did not take recede.
                  anyAnswered={Boolean(game.yourAnswer) || Boolean(resolved)}
                  opponentChose={resolved && result.opponent?.optionIndex === index}
                  onPress={() => game.answer(index)}
                />
              </Animated.View>
            ))}
          </View>

          {/* ── ROUND N — covers the stage only. The header, the clock and the
              score rails stay in view, so the match never feels like it left
              the room; just the question is still being dealt. */}
          {interstitial ? (
            <Animated.View
              style={[
                styles.interstitial,
                {
                  opacity: intro,
                  transform: [{ scale: intro.interpolate({ inputRange: [0, 1], outputRange: [1.12, 1] }) }],
                },
              ]}
              pointerEvents="none"
            >
              <View style={[styles.interstitialFace, isBonus && styles.interstitialFaceBonus]}>
                {game.topic?.coverUrl ? (
                  <Image
                    source={{ uri: game.topic.coverUrl }}
                    style={styles.interstitialImage}
                    contentFit="cover"
                  />
                ) : (
                  <TopicGlyph name={game.topic?.name} size={92} radius={46} />
                )}
              </View>
              <Text variant="label" color="rgba(255,255,255,0.72)" numberOfLines={1}>
                {game.topic?.name ?? ''}
              </Text>
              <Text
                allowFontScaling={false}
                style={[styles.interstitialWord, isBonus && { color: '#FFD34D' }]}
              >
                {isBonus ? 'BONUS ROUND' : `ROUND ${game.roundIndex + 1}`}
              </Text>
              <Text variant="meta" color="rgba(255,255,255,0.55)">
                {game.roundIndex + 1} of {game.totalRounds}
              </Text>
            </Animated.View>
          ) : null}
        </View>

        <View style={styles.footer}>
          {game.yourAnswer && !resolved ? (
            <View style={styles.lockedPill}>
              <Text variant="meta" color={colors.onColor}>
                Locked in — waiting for {game.opponent?.displayName ?? 'your rival'}
              </Text>
            </View>
          ) : null}

          {/* An escape hatch that is not a back button — see design.md §8.6. */}
          <Pressable
            onPress={() => setConfirmLeave(true)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Leave the match"
            style={({ pressed }) => [styles.leave, pressed && { opacity: 0.7 }]}
          >
            <Text variant="meta" color="rgba(255,255,255,0.5)">
              Leave
            </Text>
          </Pressable>
        </View>

        {/* ── The score rails, stuck to the edges: you left, them right. The
            tracks are invisible — only the fills show, growing from the floor,
            so at 0–0 the edges are clean rather than carrying two stray
            hairlines. */}
        <View style={styles.railBand} pointerEvents="none">
          <ScoreRail side="left" score={game.scores.you} max={maxScore} tone={colors.onColor} track="transparent" />
          <ScoreRail side="right" score={game.scores.opponent} max={maxScore} tone={colors.rival} track="transparent" />
        </View>

        {/* design.md §10 — "Leave now and you forfeit." The copy names the
            consequence rather than asking whether the player is sure.

            Confirming does NOT navigate. `forfeit()` moves the match to
            `leaving` and the server's `match:end` moves it to `finished`, which
            the effect above turns into the result screen — the same one the
            opponent sees. Sending the player home from the callback raced that
            reply and won, which is why the one person who had just been told
            their rating would drop was the only one never shown it. */}
        <ConfirmSheet
          visible={confirmLeave}
          icon="flag"
          destructive
          title="Leave now and you forfeit."
          body={`${game.opponent?.displayName ?? 'Your opponent'} wins the match and your rating drops.`}
          confirmLabel="Leave and forfeit"
          cancelLabel="Keep playing"
          onConfirm={() => {
            setConfirmLeave(false);
            game.forfeit();
          }}
          onCancel={() => setConfirmLeave(false)}
        />
      </SafeAreaView>
    </BrandField>
  );
}

/**
 * design.md §8.7 — the verdict banner. It drops from the top edge over 260ms
 * and stays until the next round starts; the eye is already at the top of the
 * screen watching the score, so the verdict arrives where the player is
 * looking.
 */
function VerdictBanner({ result, reduced }) {
  const drop = useRef(new Animated.Value(0)).current;

  // The banner retracts over 260ms, and for those 260ms `result` is already
  // null — so the last verdict is held until the animation has finished.
  const [shown, setShown] = useState(result);
  useEffect(() => {
    if (result) setShown(result);
  }, [result]);

  useEffect(() => {
    Animated.timing(drop, {
      toValue: result ? 1 : 0,
      duration: reduced ? motion.reduced : motion.bannerDrop,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [result, reduced, drop]);

  if (!shown) return null;

  const correct = shown.you.optionIndex === shown.correctIndex;
  const timedOut = shown.you.optionIndex === null || shown.you.optionIndex === undefined;

  const word = timedOut ? 'Out of time' : correct ? 'Correct!' : 'Not this one';
  const tone = timedOut ? colors.inkMuted : correct ? colors.correct : colors.wrong;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.banner,
        {
          backgroundColor: tone,
          opacity: drop,
          transform: [{ translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [-120, 0] }) }],
        },
      ]}
      accessibilityLiveRegion="polite"
    >
      <Text style={[type.title, { color: colors.onColor }]}>{word}</Text>
      {shown.you.points > 0 ? (
        <View style={styles.bannerPoints}>
          <Text variant="label" color={colors.onColor}>
            +{shown.you.points}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    paddingTop: space.xxxl,
    paddingBottom: space.lg,
    borderBottomLeftRadius: layout.radiusCard + 6,
    borderBottomRightRadius: layout.radiusCard + 6,
  },
  bannerPoints: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: space.md,
    paddingVertical: 3,
    borderRadius: layout.radiusPill,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.gutter,
    paddingTop: space.md,
    gap: space.sm,
  },
  corner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1 },
  cornerRight: { justifyContent: 'flex-end' },
  cornerText: { minWidth: 0, flexShrink: 1 },
  cornerTextRight: { alignItems: 'flex-end' },
  cornerName: { maxWidth: 96 },
  score: { fontSize: 24, lineHeight: 28 },
  clock: { alignItems: 'center', minWidth: 76 },
  clockLabel: { letterSpacing: 1.5 },
  clockValue: { fontVariant: ['tabular-nums'] },

  statusLine: { textAlign: 'center', marginTop: space.xs },

  body: {
    flex: 1,
    paddingHorizontal: layout.gutter,
    paddingTop: space.sm,
  },
  /** The question owns the space between the header and the options. */
  questionStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.md,
    gap: space.md,
  },
  question: {
    color: colors.onColor,
    textAlign: 'center',
  },
  footer: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: space.sm,
    paddingHorizontal: layout.gutter,
  },
  lockedPill: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: space.lg,
    paddingVertical: 5,
    borderRadius: layout.radiusPill,
  },
  leave: {
    position: 'absolute',
    right: layout.gutter,
    padding: space.sm,
  },

  /** The rails live in the side gutters, clear of the header and footer. */
  railBand: {
    position: 'absolute',
    left: 5,
    right: 5,
    top: 130,
    bottom: 56,
  },

  interstitial: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    backgroundColor: colors.night,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  interstitialFace: {
    width: 96,
    height: 96,
    borderRadius: 48,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.9)',
    marginBottom: space.sm,
    backgroundColor: colors.nightRaised,
  },
  interstitialFaceBonus: { borderColor: '#FFD34D' },
  interstitialImage: { width: '100%', height: '100%' },
  interstitialWord: {
    ...type.scoreHero,
    fontSize: 34,
    lineHeight: 42,
    color: colors.onColor,
    letterSpacing: 3,
    textAlign: 'center',
  },
});

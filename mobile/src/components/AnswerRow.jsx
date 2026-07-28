import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, Easing } from 'react-native';
import { colors, layout, type, motion, space, OPTION_COLORS } from '../theme/index.js';
import { useReducedMotion } from '../lib/motion.js';
import Icon from './Icon.jsx';

/**
 * design.md §6.1 — the answer row. The most important component in the product.
 *
 * Two ideas, welded together.
 *
 * The **colour** is the quiz-app convention the audience already knows: four
 * options, four fixed colours, A blue through D green. It is positional and
 * carries no verdict — a red option is not a wrong option, it is the second
 * option, every time.
 *
 * The **bubble** is ours. Every competitive exam in India is answered by
 * filling a bubble with a pencil, so this is the most recognisable
 * answer-interaction in the audience's life, and the ink still spreads from the
 * centre over 180ms when you commit. The joke is deliberate: the thing that
 * means anxiety in an exam hall becomes the thing that means speed in a game.
 *
 * States, per §6.1:
 *   resting  — the option's own colour, open white ring
 *   filled   — ink spreads through the bubble, the row gains a white outline,
 *              and every other row drops to 40% so the choice is unmistakable
 *   correct  — the row turns `correct` and a check lands on the right
 *   wrong    — the row turns `wrong` and a cross lands on the right
 *   missed   — the correct-but-unchosen option also turns `correct`. That is
 *              the teaching state, and it is why unchosen rows are dimmed
 *              rather than reddened: only one row here was actually wrong.
 */
const LETTERS = ['A', 'B', 'C', 'D'];

export default function AnswerRow({
  index,
  label,
  selected,
  disabled,
  /** 'correct' | 'wrong' | 'missed' | null — only set at resolution. */
  resolution = null,
  /** True once any answer on this row's round has been locked in. */
  anyAnswered = false,
  /** design.md §6.1 — a thin rival marker on the right edge. */
  opponentChose = false,
  onPress,
}) {
  const reduced = useReducedMotion();
  const fill = useRef(new Animated.Value(selected ? 1 : 0)).current;
  const mark = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;

  // §6.1 — ink spreads from the centre in 180ms with an ease-out curve,
  // deliberately reminiscent of a pencil.
  useEffect(() => {
    Animated.timing(fill, {
      toValue: selected ? 1 : 0,
      duration: reduced ? 0 : motion.bubbleFill,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [selected, reduced, fill]);

  // §6.1 — the verdict mark lands over 200ms once the round resolves.
  useEffect(() => {
    if (resolution === 'correct' || resolution === 'wrong' || resolution === 'missed') {
      Animated.timing(mark, {
        toValue: 1,
        duration: reduced ? 0 : 200,
        easing: Easing.out(Easing.back(2)),
        useNativeDriver: true,
      }).start();
    } else {
      mark.setValue(0);
    }
  }, [resolution, reduced, mark]);

  const base = OPTION_COLORS[index % OPTION_COLORS.length];
  const background =
    resolution === 'correct' || resolution === 'missed'
      ? colors.correct
      : resolution === 'wrong'
        ? colors.wrong
        : base;

  // Unchosen rows recede rather than turning red: exactly one option was wrong,
  // and colouring three of them as failures teaches the wrong lesson.
  const receded = resolution === null && anyAnswered && !selected;

  // design.md §11 — every row announces its letter, its text, and its state.
  const a11yState = resolution
    ? resolution === 'correct'
      ? 'correct answer'
      : resolution === 'wrong'
        ? 'wrong answer'
        : 'this was the correct answer'
    : selected
      ? 'selected'
      : 'not selected';

  return (
    <Animated.View style={{ transform: [{ scale: press }] }}>
      <Pressable
        onPress={disabled ? undefined : onPress}
        onPressIn={() =>
          !disabled &&
          Animated.timing(press, { toValue: 0.96, duration: 70, useNativeDriver: true }).start()
        }
        onPressOut={() =>
          Animated.spring(press, { toValue: 1, friction: 4, tension: 300, useNativeDriver: true }).start()
        }
        disabled={disabled}
        accessibilityRole="radio"
        accessibilityState={{ selected: Boolean(selected), disabled: Boolean(disabled) }}
        accessibilityLabel={`Option ${LETTERS[index]}. ${label}. ${a11yState}.`}
        style={[
          styles.row,
          { backgroundColor: background, opacity: receded ? 0.4 : 1 },
          selected && !resolution ? styles.rowChosen : null,
        ]}
      >
        <View style={styles.bubbleWrap}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              styles.fill,
              {
                // Scaling from the centre is the "ink spread" — and it runs on
                // the native driver, so it cannot be dropped by a busy JS
                // thread during a round.
                transform: [{ scale: fill }],
                opacity: fill,
              },
            ]}
          />
          <Text style={styles.letter}>{LETTERS[index]}</Text>
        </View>

        <Text style={styles.label} numberOfLines={3}>
          {label}
        </Text>

        {/* §6.1 — a thin rival marker when that was the opponent's choice. */}
        {opponentChose ? <View style={styles.rivalMark} accessibilityLabel="Your opponent chose this" /> : null}

        {/* The mark is drawn, not typed. A glyph like ✓ falls back to whatever
            the system has, which on Android is often a differently-weighted
            face — and at 13px inside a 24px tile that reads as a rendering bug
            rather than a verdict. */}
        {resolution ? (
          <Animated.View style={[styles.verdict, { opacity: mark, transform: [{ scale: mark }] }]}>
            <Icon name={resolution === 'wrong' ? 'close' : 'check'} size={14} color={colors.onColor} />
          </Animated.View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    // design.md §5 — bubble and label form a single 60px-tall target spanning
    // the full content width. Under time pressure a player should never miss.
    minHeight: layout.answerRow,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: layout.radiusInput,
    marginBottom: space.md,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  rowChosen: { borderColor: 'rgba(255,255,255,0.85)' },
  bubbleWrap: {
    width: layout.bubbleSize,
    height: layout.bubbleSize,
    borderRadius: layout.bubbleSize / 2,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    marginRight: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fill: {
    borderRadius: layout.bubbleSize / 2,
    backgroundColor: colors.onColor,
  },
  letter: {
    ...type.tiny,
    fontFamily: type.label.fontFamily,
    color: colors.onColor,
    // The letter sits under the fill, so once the bubble is inked it reads as a
    // filled bubble rather than a lettered one — which is the whole reference.
    opacity: 0.9,
  },
  label: {
    ...type.option,
    color: colors.onColor,
    flex: 1,
  },
  rivalMark: {
    width: 4,
    height: 26,
    borderRadius: 2,
    backgroundColor: colors.rival,
    marginLeft: space.sm,
  },
  verdict: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: space.sm,
  },
});

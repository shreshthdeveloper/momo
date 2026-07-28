import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View, Easing, AccessibilityInfo } from 'react-native';
import { colors } from '../theme/index.js';
import { useReducedMotion } from '../lib/motion.js';

/**
 * The round clock and the score rails — the QuizUp arrangement.
 *
 * Time is a THIN LINE across the top of the screen plus a stated number in the
 * header ("TIME LEFT / 7"). The vertical rails hugging the screen edges are
 * NOT time: they are the two players' scores, growing upward from the floor
 * with every round won — you the accent on the left, the rival coral on the right.
 * Halfway through a match a glance at the rails answers "who is ahead and by
 * how much" the way two bars of a chart would, without a single number read.
 */

/** One shared clock per round: the animated fraction and the whole seconds. */
export function useRoundClock({ startedAt, durationMs, running }) {
  const progress = useRef(new Animated.Value(1)).current;
  const [secondsLeft, setSecondsLeft] = useState(() =>
    durationMs ? Math.ceil(durationMs / 1000) : 0,
  );
  const announced = useRef(new Set());

  useEffect(() => {
    if (!running || !startedAt) return undefined;

    announced.current = new Set();
    const fraction = () =>
      Math.max(0, Math.min(1, 1 - (Date.now() - startedAt) / durationMs));

    progress.setValue(fraction());
    const remainingMs = Math.max(0, durationMs - (Date.now() - startedAt));
    const drain = Animated.timing(progress, {
      toValue: 0,
      duration: remainingMs,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    drain.start();

    /**
     * The readout, and — design.md §11 — announcements at 5 and 3 seconds
     * rather than continuously, which would make a screen reader unusable.
     */
    const tick = () => {
      const left = Math.ceil(Math.max(0, durationMs - (Date.now() - startedAt)) / 1000);
      setSecondsLeft((current) => (current === left ? current : left));
      if ((left === 5 || left === 3) && !announced.current.has(left)) {
        announced.current.add(left);
        AccessibilityInfo.announceForAccessibility(`${left} seconds left`);
      }
    };
    tick();
    const ticker = setInterval(tick, 100);

    return () => {
      drain.stop();
      clearInterval(ticker);
    };
  }, [startedAt, durationMs, running, progress]);

  return { progress, secondsLeft };
}

/**
 * The thin line at the very top of the screen, draining left to right.
 * Native-driver scaleX — it cannot stutter no matter what the JS thread is
 * doing mid-round.
 *
 * tone="onColor" restyles it for the night battle field: a translucent track,
 * a white fill, and amber (not red — red dies on the accent) for urgency.
 */
export function TimeLine({ progress, urgent, tone = 'paper' }) {
  const onColor = tone === 'onColor';
  return (
    <View
      style={[styles.lineTrack, onColor && { backgroundColor: 'rgba(255,255,255,0.18)' }]}
      pointerEvents="none"
    >
      <Animated.View
        style={[
          styles.lineFill,
          {
            backgroundColor: urgent
              ? onColor
                ? '#FFD34D'
                : colors.wrong
              : onColor
                ? colors.onColor
                : colors.accent,
            transform: [{ scaleX: progress }],
          },
        ]}
      />
    </View>
  );
}

/**
 * One score rail, stuck to a screen edge. The fill rises from the floor as
 * points land; a spring on each change makes a win visibly SHOVE the bar up.
 */
export function ScoreRail({ score, max, tone, side, track }) {
  const reduced = useReducedMotion();
  const fill = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const fraction = Math.max(0, Math.min(1, max ? score / max : 0));
    if (reduced) {
      fill.setValue(fraction);
      return;
    }
    Animated.spring(fill, {
      toValue: fraction,
      friction: 7,
      tension: 50,
      useNativeDriver: true,
    }).start();
  }, [score, max, fill, reduced]);

  return (
    <View
      style={[
        styles.rail,
        side === 'left' ? styles.railLeft : styles.railRight,
        track ? { backgroundColor: track } : null,
      ]}
      pointerEvents="none"
      accessibilityLabel={`${side === 'left' ? 'Your' : 'Opponent'} score ${score}`}
    >
      <Animated.View
        style={[styles.railFill, { backgroundColor: tone, transform: [{ scaleY: fill }] }]}
      />
    </View>
  );
}

const RAIL_WIDTH = 6;

const styles = StyleSheet.create({
  lineTrack: {
    height: 4,
    backgroundColor: colors.sunken,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  lineFill: {
    ...StyleSheet.absoluteFillObject,
    transformOrigin: 'left',
  },
  rail: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: RAIL_WIDTH,
    borderRadius: RAIL_WIDTH / 2,
    backgroundColor: colors.sunken,
    overflow: 'hidden',
  },
  railLeft: { left: 0 },
  railRight: { right: 0 },
  railFill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RAIL_WIDTH / 2,
    transformOrigin: 'bottom',
  },
});

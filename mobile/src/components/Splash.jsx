import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { BrandField } from './Brand.jsx';
import { colors, layout, space, type } from '../theme/index.js';
import { useReducedMotion } from '../lib/motion.js';

/**
 * The splash screen, in two halves.
 *
 * The native one (expo-splash-screen, configured in app.json) is a static mark
 * on night and covers the milliseconds before React is running at all. This is
 * the second half: the same mark on the same night, so the handoff is
 * invisible, and it stays up through the two things that actually take time —
 * loading five font faces, and confirming the stored session with `/me`.
 *
 * The wait is staged as a tiny piece of theatre in the app's own language:
 * the disc drops in on a spring, the ring closes around it with a snap, a
 * bloom rolls off the impact, and the four quiz colours drift faintly behind
 * everything — the game's cast on stage before the curtain. The countdown bar
 * beneath is the match countdown in miniature (design.md §6.2), the signature
 * element doing a job on the very first screen.
 *
 * It hides on a fade, never a cut, and only after `MINIMUM_MS`. A splash that
 * flashes for 90ms on a warm start is worse than one that never appeared.
 *
 * `MINIMUM_MS` is set from the theatre above rather than picked by feel. The
 * mark takes 620ms to assemble and the bloom rolls off it for another 700, so
 * nothing under 1320ms can show the animation it is playing — at the old 900
 * a warm start cut the bloom off halfway and the tagline had been readable for
 * barely a quarter of a second. 2000 lets the whole sequence land, holds the
 * finished mark and its line for a beat, and still leaves under two and a half
 * seconds to first paint once the fade is counted.
 */
const MINIMUM_MS = 2000;
const FADE_MS = 320;

/** The four quiz colours, drifting behind the mark. Position is % of screen. */
const ORBS = [
  { tone: colors.optionA, size: 14, left: '16%', top: '24%', delay: 0 },
  { tone: colors.optionB, size: 10, left: '78%', top: '20%', delay: 600 },
  { tone: colors.optionC, size: 12, left: '84%', top: '62%', delay: 1100 },
  { tone: colors.optionD, size: 9, left: '12%', top: '68%', delay: 300 },
];

export default function Splash({ ready, onHidden }) {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(true);

  const enter = useRef(new Animated.Value(0)).current;
  const bloom = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const shownAt = useRef(Date.now());

  // The mark assembles once, on mount — and the impact blooms off it.
  useEffect(() => {
    if (reduced) {
      enter.setValue(1);
      return undefined;
    }
    Animated.sequence([
      Animated.timing(enter, {
        toValue: 1,
        duration: 620,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(bloom, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
    return undefined;
  }, [enter, bloom, reduced]);

  // The countdown bar sweeps for as long as the wait lasts.
  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep, reduced]);

  // Leave only once the app is ready AND the splash has been up long enough to
  // have been seen.
  useEffect(() => {
    if (!ready) return undefined;
    const elapsed = Date.now() - shownAt.current;
    const wait = Math.max(0, MINIMUM_MS - elapsed);

    const timer = setTimeout(() => {
      Animated.timing(fade, {
        toValue: 0,
        duration: reduced ? 120 : FADE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        setMounted(false);
        onHidden?.();
      });
    }, wait);

    return () => clearTimeout(timer);
  }, [ready, fade, reduced, onHidden]);

  if (!mounted) return null;

  // The disc lands with a slight overshoot; the ring closes in from outside.
  const discScale = enter.interpolate({ inputRange: [0, 0.55, 0.8, 1], outputRange: [0, 1.14, 0.97, 1] });
  const ringScale = enter.interpolate({ inputRange: [0, 0.35, 0.85, 1], outputRange: [2.1, 1.7, 0.96, 1] });
  const ringOpacity = enter.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.4, 1] });
  const wordOpacity = enter.interpolate({ inputRange: [0, 0.65, 1], outputRange: [0, 0, 1] });
  const wordShift = enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });

  const D = 76;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.root, { opacity: fade }]}
      pointerEvents={ready ? 'none' : 'auto'}
      accessibilityLabel="Mimo is starting"
    >
      <BrandField tone={colors.night}>
        {/* The cast, faintly on stage. */}
        {!reduced
          ? ORBS.map((orb, i) => <Orb key={i} {...orb} />)
          : null}

        <View style={styles.centre}>
          <View style={styles.mark}>
            {/* The bloom that rolls off the assembled mark. */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.bloom,
                {
                  opacity: bloom.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 0.45, 0] }),
                  transform: [{ scale: bloom.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.1] }) }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.disc,
                { width: D, height: D, borderRadius: D / 2, transform: [{ scale: discScale }] },
              ]}
            />
            <Animated.View
              style={[
                styles.ring,
                {
                  width: D,
                  height: D,
                  borderRadius: D / 2,
                  marginLeft: -D * 0.32,
                  opacity: ringOpacity,
                  transform: [{ scale: ringScale }],
                },
              ]}
            />
          </View>

          <Animated.Text
            style={[
              type.display,
              styles.word,
              { opacity: wordOpacity, transform: [{ translateY: wordShift }] },
            ]}
          >
            mimo
          </Animated.Text>

          <Animated.Text style={[type.meta, styles.tag, { opacity: wordOpacity }]}>
            One rival. Seven questions.
          </Animated.Text>
        </View>

        {/* design.md §6.2 in miniature — the dual countdown as the wait itself. */}
        <View style={styles.barWrap}>
          <View style={styles.barTrack}>
            <Animated.View
              style={[
                styles.barFill,
                {
                  transform: [
                    {
                      translateX: sweep.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-90, 90],
                      }),
                    },
                  ],
                },
              ]}
            />
          </View>
        </View>
      </BrandField>
    </Animated.View>
  );
}

/** One quiz-colour dot, breathing slowly in place. Decoration, kept faint. */
function Orb({ tone, size, left, top, delay }) {
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(drift, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [drift, delay]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left,
        top,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tone,
        opacity: drift.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.6] }),
        transform: [{ translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, -14] }) }],
      }}
    />
  );
}

const styles = StyleSheet.create({
  // Above the navigator while it mounts behind.
  root: { zIndex: 100, elevation: 100, backgroundColor: colors.night },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: layout.gutter },
  mark: { flexDirection: 'row', alignItems: 'center' },
  disc: { backgroundColor: colors.onColor },
  ring: { borderWidth: 7, borderColor: colors.onColor },
  bloom: {
    position: 'absolute',
    alignSelf: 'center',
    left: '50%',
    marginLeft: -55,
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 2,
    borderColor: colors.onColor,
  },
  word: {
    color: colors.onColor,
    fontSize: 34,
    lineHeight: 42,
    marginTop: space.xl,
    letterSpacing: 0.5,
  },
  tag: { color: 'rgba(255,255,255,0.72)', marginTop: space.xs },
  barWrap: { alignItems: 'center', paddingBottom: space.huge },
  barTrack: {
    width: 120,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
  },
  barFill: {
    width: 56,
    height: '100%',
    borderRadius: 3,
    backgroundColor: colors.onColor,
  },
});

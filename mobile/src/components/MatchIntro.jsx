import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, Avatar } from './ui.jsx';
import Icon from './Icon.jsx';
import { colors, layout, space, type } from '../theme/index.js';

/**
 * What the searching screen shows when there is nothing to search for.
 *
 * ── The globe was answering a question nobody asked ──────────────────────────
 *
 * `Globe` is a planet being swept for one other person, and it is the right
 * object for exactly one case: the open queue, where somewhere out there really
 * is a stranger and this really is the looking.
 *
 * It was drawn for every case. A practice drill has no opponent. A revision deck
 * has no opponent. Beating your own best run is a race against a recording. And
 * a friend challenge already knows precisely who it is waiting for — the pool it
 * is searching has one person in it, and they are named on the screen. In all
 * four the app was sweeping the Earth for somebody it either did not need or had
 * already found, which reads as the loading screen not knowing what it is doing.
 *
 * The copy underneath had already been fixed — "DEALING YOUR QUESTIONS",
 * "WAITING FOR PRIYA" — so the words and the picture were saying different
 * things. Two answers here, one per case:
 *
 *   `SoloDeck`       your paper, being made up. Nobody else is involved.
 *   `ChallengeWait`  the two of you, and a ring going out to them.
 */

/**
 * A hand of question cards, squaring up.
 *
 * Deliberately not a spinner and not a progress bar. What is actually happening
 * server-side is that a paper is being dealt — seven questions chosen, ordered
 * and frozen — and a stack of cards is the honest picture of that. It is also
 * the same object the match itself is about, so the wait looks like the thing it
 * is waiting for rather than like the app thinking.
 *
 * The motion is the Chest's: a slow rock, two degrees, plus one light passing
 * down the face. Both stop dead on `ready` and the fan squares into a neat pile
 * — the visual full stop that says the paper is made.
 */
export function SoloDeck({ size = 260, ready = false, reduced = false, tone = colors.gold }) {
  const rock = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const land = useRef(new Animated.Value(0)).current;

  const w = Math.round(size * 0.54);
  const h = Math.round(size * 0.7);
  const left = Math.round((size - w) / 2);
  const top = Math.round((size - h) / 2);

  useEffect(() => {
    if (reduced || ready) {
      rock.stopAnimation();
      sweep.stopAnimation();
      rock.setValue(0);
      sweep.setValue(0);
      return undefined;
    }
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(rock, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(rock, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    // The light passes, then waits. A sweep with no gap in it is a shimmer, and
    // a shimmer is what a skeleton does — this is one deliberate pass.
    const pass = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, {
          toValue: 1,
          duration: 1300,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(520),
        Animated.timing(sweep, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    breathe.start();
    pass.start();
    return () => {
      breathe.stop();
      pass.stop();
    };
  }, [rock, sweep, reduced, ready]);

  useEffect(() => {
    Animated.spring(land, {
      toValue: ready ? 1 : 0,
      friction: 6,
      tension: 140,
      useNativeDriver: true,
    }).start();
  }, [ready, land]);

  const wobble = rock.interpolate({ inputRange: [0, 1], outputRange: ['-1.6deg', '1.6deg'] });
  /** The fan closes as the paper is finished — never quite to zero, or it stops
   *  reading as more than one card. */
  const fan = (deg) =>
    land.interpolate({ inputRange: [0, 1], outputRange: [`${deg}deg`, `${deg * 0.3}deg`] });

  const slot = { position: 'absolute', left, top, width: w, height: h };

  return (
    <View
      style={{ width: size, height: size }}
      accessible
      accessibilityLabel={ready ? 'Your questions are ready' : 'Making up your paper'}
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, { transform: reduced ? [] : [{ rotate: wobble }] }]}
      >
        {/* The two underneath. Dimmer and a touch smaller, so the front one is
            unambiguously the front one rather than the middle of three. */}
        <Animated.View
          style={[
            slot,
            styles.card,
            {
              opacity: 0.4,
              transform: [{ translateX: -Math.round(w * 0.17) }, { rotate: fan(-11) }, { scale: 0.93 }],
            },
          ]}
        />
        <Animated.View
          style={[
            slot,
            styles.card,
            {
              opacity: 0.62,
              transform: [{ translateX: Math.round(w * 0.17) }, { rotate: fan(11) }, { scale: 0.93 }],
            },
          ]}
        />

        <View style={[slot, styles.card, styles.front]}>
          <View style={styles.paper}>
            {/* The subject rule, in whatever this drill is about — gold for a
                practice paper, amber for a revision deck. It is the one piece of
                colour on the card, which is what stops three grey rectangles
                reading as a loading placeholder. */}
            <View style={[styles.rule, { backgroundColor: tone }]} />
            <View style={[styles.line, { width: '88%' }]} />
            <View style={[styles.line, { width: '62%' }]} />
            <View style={styles.gap} />
            <View style={styles.option} />
            <View style={styles.option} />
            <View style={styles.option} />
          </View>

          {!reduced && !ready ? (
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                {
                  transform: [
                    { translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [-h, h] }) },
                  ],
                },
              ]}
            >
              <LinearGradient
                colors={['transparent', 'rgba(255,255,255,0.10)', 'transparent']}
                style={{ height: Math.round(h * 0.75) }}
              />
            </Animated.View>
          ) : null}
        </View>
      </Animated.View>

      {/* The full stop. It lands with the "READY" below it, so the two arrive
          together rather than the word explaining a picture that has not moved. */}
      <Animated.View
        style={[
          styles.stamp,
          {
            left: Math.round(size / 2 - 19),
            top: top + h - 19,
            opacity: land,
            transform: [{ scale: land.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
          },
        ]}
      >
        <Icon name="check" size={20} color={colors.onAccent} />
      </Animated.View>
    </View>
  );
}

/**
 * The two of you, while one of you is still opening the app.
 *
 * A challenge lapses in two minutes, so the honest subject of this wait is not
 * "where in the world is somebody" — it is *that one person, right now*. Their
 * face with a ring going out from it says the invitation is out and unanswered
 * in a way no amount of sweeping a planet can.
 *
 * It is also a rehearsal for the versus screen this hands over to: same two
 * faces, same two rings, same sides. The handover is a step forward rather than
 * a scene change.
 */
export function ChallengeWait({ size = 260, me, them, ready = false, reduced = false }) {
  const ping = useRef(new Animated.Value(0)).current;
  const face = Math.round(Math.min(96, size * 0.3));

  useEffect(() => {
    if (reduced || ready) {
      ping.stopAnimation();
      ping.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.timing(ping, {
        toValue: 1,
        duration: 1700,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [ping, reduced, ready]);

  const theirName = String(them?.displayName ?? '').trim().split(/\s+/)[0] || 'Your friend';

  return (
    <View style={[{ width: size, height: size }, styles.stage]}>
      <View style={styles.pair}>
        <Side name="You" person={me} size={face} ring="you" />

        <View style={styles.vs}>
          <Text allowFontScaling={false} style={styles.vsWord}>
            VS
          </Text>
        </View>

        <Side name={theirName} person={them} size={face} ring="rival" waiting={!ready}>
          {!reduced && !ready ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.ping,
                {
                  width: face,
                  height: face,
                  borderRadius: face / 2,
                  opacity: ping.interpolate({
                    inputRange: [0, 0.15, 1],
                    outputRange: [0, 0.5, 0],
                  }),
                  transform: [
                    { scale: ping.interpolate({ inputRange: [0, 1], outputRange: [1, 1.85] }) },
                  ],
                },
              ]}
            />
          ) : null}
        </Side>
      </View>
    </View>
  );
}

/** One player in the pair: the face, whatever is ringing behind it, the name. */
function Side({ name, person, size, ring, waiting, children }) {
  return (
    <View style={styles.side}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        {children}
        <Avatar url={person?.avatarUrl} name={person?.displayName} size={size} ring={ring} />
        {waiting ? (
          <View style={styles.waitDot}>
            <Icon name="clock" size={12} color={colors.night} />
          </View>
        ) : null}
      </View>
      <Text variant="label" color="rgba(255,255,255,0.82)" numberOfLines={1} style={styles.sideName}>
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', justifyContent: 'center' },

  // ── The paper ────────────────────────────────────────────────────────────
  card: {
    borderRadius: layout.radiusCard,
    backgroundColor: colors.nightRaised,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
  },
  /** Only the front one is lit, and only it carries the sweep. */
  front: { backgroundColor: '#2E2840', borderColor: 'rgba(255,255,255,0.2)' },
  paper: { flex: 1, padding: layout.cardPadding, gap: space.sm },
  rule: { height: 5, width: '34%', borderRadius: 3, marginBottom: space.xs },
  line: { height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.24)' },
  gap: { height: space.xs },
  option: {
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  stamp: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.night,
  },

  // ── The pair ─────────────────────────────────────────────────────────────
  pair: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  side: { alignItems: 'center', gap: space.sm },
  sideName: { maxWidth: 104, textAlign: 'center' },
  /** Behind the face, going out. Absolute so it grows from the same centre. */
  ping: { position: 'absolute', borderWidth: 2, borderColor: colors.rival },
  waitDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.goldBright,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.night,
  },
  vs: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  vsWord: {
    ...type.label,
    fontSize: 12,
    letterSpacing: 1,
    color: colors.goldBright,
    includeFontPadding: false,
  },
});

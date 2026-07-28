import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors } from '../theme/index.js';
import { useReducedMotion } from '../lib/motion.js';

/**
 * A treasure chest, drawn from Views.
 *
 * The shop used the `gift` glyph from the icon set, which is a wrapped present
 * — a birthday, not a hoard. A chest that is opened once a month by climbing a
 * league wants to look like the thing it is, and the glyph was also why the
 * seals read as disabled controls rather than as treasure: a 24px monochrome
 * outline has no material.
 *
 * There is no SVG in this project (see the note in welcome.jsx), so it is
 * composed the way `Illustration` and `Brand` are — a handful of Views with
 * radii and borders. That turns out to be right for a second reason: the lid
 * has to be a separate layer in order to LIFT, which a glyph could never do.
 *
 * ── Three states, one object ─────────────────────────────────────────────────
 *
 *   locked    unlit, and still
 *   ready     gold, and it breathes — a slow rock, and a glow that swells
 *   opening   the lid swings back on its hinge and light comes out of the box
 *
 * `ready` moves because it is the one state asking for something, and a static
 * gold box among static gold boxes is not asking. Two degrees at 1.4s is well
 * under the point where idle motion in the corner of a screen becomes something
 * you want to make stop — and it stops dead under `prefers-reduced-motion`.
 *
 * ── Layout is absolute, deliberately ─────────────────────────────────────────
 *
 * Body, mouth and lid are all positioned against the stage rather than stacked.
 * A flowed mouth would push the body down by its own height the moment it was
 * given one, and a lid that rotates has to be free of the flow anyway. Paint
 * order does the rest: body, then the light, then the lid over both.
 */
export default function Chest({ size = 56, state = 'locked', style }) {
  const reduced = useReducedMotion();
  const idle = useRef(new Animated.Value(0)).current;
  const open = useRef(new Animated.Value(0)).current;

  const ready = state === 'ready';
  const opening = state === 'opening';
  const lit = ready || opening;

  /** The breath. Runs only while ready, and never while the lid is moving. */
  useEffect(() => {
    if (!ready || opening || reduced) {
      idle.stopAnimation();
      idle.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(idle, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(idle, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [ready, opening, reduced, idle]);

  /**
   * The open. `back` overshoots the hinge and settles, which is the whole
   * difference between a lid thrown open and a lid rotated open.
   */
  useEffect(() => {
    Animated.timing(open, {
      toValue: opening ? 1 : 0,
      duration: opening ? 520 : 220,
      easing: opening ? Easing.out(Easing.back(1.7)) : Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [opening, open]);

  // Every measurement derives from `size`, so one number scales the drawing.
  const w = size;
  const h = Math.round(size * 0.8);
  const lidH = Math.round(h * 0.44);
  const bodyH = h - lidH;
  const band = Math.max(3, Math.round(size * 0.11));
  const r = Math.max(3, Math.round(size * 0.11));

  const gold = lit ? colors.gold : colors.inkFaint;
  const shell = lit ? '#4B3611' : colors.sunken;
  const edge = lit ? 'rgba(245, 182, 46, 0.55)' : colors.hairline;

  const rock = idle.interpolate({ inputRange: [0, 1], outputRange: ['-2deg', '2deg'] });
  const lift = open.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-54deg'] });

  return (
    <View style={[{ width: w, height: h }, styles.stage, style]}>
      {/* The glow swells with the breath and blows out on the open, so the box
          reads as the source of the light rather than as lit from outside. */}
      {lit ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glow,
            {
              width: w * 1.6,
              height: w * 1.6,
              borderRadius: w * 0.8,
              top: -h * 0.34,
              opacity: reduced
                ? 0.18
                : Animated.add(
                    idle.interpolate({ inputRange: [0, 1], outputRange: [0.14, 0.26] }),
                    open.interpolate({ inputRange: [0, 1], outputRange: [0, 0.3] }),
                  ),
              transform: [
                { scale: open.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] }) },
              ],
            },
          ]}
        />
      ) : null}

      <Animated.View
        style={[StyleSheet.absoluteFill, { transform: reduced ? [] : [{ rotate: rock }] }]}
      >
        {/* ── The box. */}
        <View
          style={[
            styles.body,
            {
              top: lidH,
              height: bodyH,
              borderBottomLeftRadius: r,
              borderBottomRightRadius: r,
              backgroundColor: shell,
              borderColor: edge,
            },
          ]}
        >
          <View style={[styles.band, { width: band, backgroundColor: gold }]} />
        </View>

        {/* ── The light out of the opening. A flat wash rather than drawn
            contents: what is actually inside is the carousel, and a second
            answer to that question here would be a wrong one. */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.mouth,
            {
              top: lidH * 0.72,
              height: lidH * 0.66,
              left: w * 0.12,
              right: w * 0.12,
              borderRadius: r * 0.6,
              opacity: open.interpolate({
                inputRange: [0.25, 1],
                outputRange: [0, 1],
                extrapolate: 'clamp',
              }),
            },
          ]}
        />

        {/* ── The lid. Its pivot has to be the BACK edge, or it turns about its
            own middle and sinks into the box: shift down half its height, turn,
            shift back. */}
        <Animated.View
          style={[
            styles.lidWrap,
            {
              height: lidH,
              transform: [{ translateY: lidH / 2 }, { rotate: lift }, { translateY: -lidH / 2 }],
            },
          ]}
        >
          <View
            style={[
              styles.lid,
              {
                borderTopLeftRadius: r * 1.7,
                borderTopRightRadius: r * 1.7,
                backgroundColor: shell,
                borderColor: edge,
              },
            ]}
          >
            <View style={[styles.band, { width: band, backgroundColor: gold }]} />
          </View>

          {/* The clasp, hanging off the lid's front edge — so it travels with
              the lid and the box reads as actually latched. */}
          <View
            style={[
              styles.clasp,
              {
                width: band * 1.6,
                height: band * 1.3,
                bottom: -band * 0.55,
                borderRadius: 2,
                backgroundColor: gold,
              },
            ]}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', justifyContent: 'flex-start' },
  glow: { position: 'absolute', backgroundColor: colors.gold },
  body: { position: 'absolute', left: 0, right: 0, borderWidth: 1, alignItems: 'center' },
  mouth: { position: 'absolute', backgroundColor: colors.gold },
  lidWrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  lid: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    alignItems: 'center',
    overflow: 'hidden',
  },
  band: { height: '100%' },
  clasp: { position: 'absolute' },
});

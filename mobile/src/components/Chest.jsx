import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/index.js';
import { useReducedMotion } from '../lib/motion.js';

/**
 * A treasure chest, drawn from Views.
 *
 * There is no SVG in this project (see the note in welcome.jsx), so it is
 * composed the way `Illustration` and `Brand` are — a handful of Views with
 * radii and borders. That turns out to be right for a second reason: the lid
 * has to be a separate layer in order to swing, which a glyph could never do.
 *
 * ── This is the Takeover's chest ─────────────────────────────────────────────
 *
 * There were two of them. The Takeover — the full-screen reveal after a match —
 * drew a solid, banded, arched-lid chest with a rim, feet and a lock. The shop
 * drew a different, flatter one: two rounded rectangles, one gold stripe, a lid
 * that rotated about Z like a lever rather than hinging back. Same object, two
 * drawings, and the shop was showing the worse one on the screen where a player
 * decides whether a chest is worth wanting.
 *
 * So the anatomy below is the Takeover's, and the reasoning behind it is the
 * Takeover's too:
 *
 *   **Solid, not tinted.** It used to be built from a 14% tint, which on a near
 *   black field is a faint outline with nothing inside. A tint works for a
 *   large flat shape carrying type and fails completely for a small object that
 *   has to read as having volume. Wood is opaque.
 *
 *   **One light source.** `LID` is lighter than `TRUNK`, a shadow sits under
 *   the rim, and the only thing carrying colour is the metal — bands, rim and
 *   lock. One light, one accent.
 *
 *   **The lid hinges, it does not tilt.** `rotateX` about `center bottom`,
 *   behind a perspective, stopping at 62°. Past 90° the lid crosses edge-on and
 *   comes back showing its own face mirrored, which is where the illusion dies;
 *   even at 80 it is so foreshortened there is nothing left to look at.
 *
 * What stays local to this file is the state machine, which the Takeover has no
 * use for — it only ever plays one scripted open.
 *
 * ── Three states, one object ─────────────────────────────────────────────────
 *
 *   locked    unlit metal, and still
 *   ready     gold, and it breathes — a slow rock, and a glow that swells
 *   opening   the lock lets go, the lid swings back, light comes out of the box
 *
 * `ready` moves because it is the one state asking for something, and a static
 * gold box among static gold boxes is not asking. Two degrees at 1.4s is well
 * under the point where idle motion in the corner of a screen becomes something
 * you want to make stop — and it stops dead under `prefers-reduced-motion`.
 */

/** Solid values, lit from above. Shared with the Takeover by eye, not by import:
 *  that file's chest is welded to its scene timeline and extracting it would
 *  drag the whole reveal in behind it. */
const LID = '#453C5E';
const TRUNK = '#332C48';
const DEEP = '#241F33';
const SHADOW = 'rgba(0,0,0,0.42)';

/**
 * Every measurement is a fraction of the width, taken from the Takeover's
 * 118×100 drawing, so one `size` prop scales the whole object and the two
 * chests stay the same shape at any size.
 */
const RATIO = {
  bodyH: 60 / 118,
  lidH: 40 / 118,
  overlap: 3 / 118,
  rim: 7 / 118,
  mouth: 18 / 118,
  strap: 8 / 118,
  strapInset: 0.19,
  footW: 14 / 118,
  footH: 7 / 118,
  footInset: 8 / 118,
  lockW: 24 / 118,
  lockH: 20 / 118,
  arch: 20 / 118,
  crown: 16 / 118,
  bodyRadius: 8 / 118,
};

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

  /** The open, and the close. Opening overshoots the hinge and settles. */
  useEffect(() => {
    Animated.timing(open, {
      toValue: opening ? 1 : 0,
      duration: opening ? 560 : 220,
      easing: opening ? Easing.out(Easing.cubic) : Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [opening, open]);

  const d = useMemo(() => {
    const px = (r) => Math.max(1, Math.round(size * r));
    const bodyH = px(RATIO.bodyH);
    const lidH = px(RATIO.lidH);
    const overlap = px(RATIO.overlap);
    return {
      w: size,
      bodyH,
      lidH,
      overlap,
      height: bodyH + lidH - overlap,
      rim: px(RATIO.rim),
      mouth: px(RATIO.mouth),
      strap: px(RATIO.strap),
      strapInset: Math.round(size * RATIO.strapInset),
      footW: px(RATIO.footW),
      footH: px(RATIO.footH),
      footInset: px(RATIO.footInset),
      lockW: px(RATIO.lockW),
      lockH: px(RATIO.lockH),
      arch: px(RATIO.arch),
      crown: px(RATIO.crown),
      bodyRadius: px(RATIO.bodyRadius),
    };
  }, [size]);

  const metal = lit ? colors.gold : colors.inkFaint;
  const trunk = lit ? TRUNK : colors.sunken;
  const lidTop = lit ? LID : colors.hairline;

  const rock = idle.interpolate({ inputRange: [0, 1], outputRange: ['-2deg', '2deg'] });

  /**
   * The hinge. `transformOrigin` (RN 0.76+) puts the pivot on the lid's own
   * bottom edge — the hinge line at the back of the rim — and the perspective
   * in front of the rotation is what stops it reading as a rectangle being
   * squashed vertically.
   */
  const lidTransform = [
    { perspective: size * 5.3 },
    {
      rotateX: reduced
        ? opening
          ? '62deg'
          : '0deg'
        : open.interpolate({
            inputRange: [0, 0.55, 0.78, 1],
            outputRange: ['0deg', '70deg', '58deg', '62deg'],
            extrapolate: 'clamp',
          }),
    },
  ];

  return (
    <View style={[{ width: d.w, height: d.height }, styles.stage, style]}>
      {/* The glow swells with the breath and blows out on the open, so the box
          reads as the source of the light rather than as lit from outside. */}
      {lit ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glow,
            {
              width: d.w * 1.6,
              height: d.w * 1.6,
              borderRadius: d.w * 0.8,
              top: -d.height * 0.34,
              opacity: reduced
                ? 0.16
                : Animated.add(
                    idle.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.24] }),
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
        {/* ── The trunk. Solid, banded, and dark inside. */}
        <View
          style={[
            styles.body,
            { height: d.bodyH, borderRadius: d.bodyRadius, backgroundColor: trunk },
          ]}
        >
          {/* The mouth — the inside of the box, revealed as the lid leaves.
              Drawn first so the bands and the rim sit over it. A flat wash
              rather than drawn contents: what is actually inside is the
              carousel below, and a second answer here would be a wrong one. */}
          <Animated.View
            style={[
              styles.mouth,
              {
                top: d.rim,
                height: d.mouth,
                backgroundColor: DEEP,
                borderBottomWidth: Math.max(2, Math.round(d.rim * 0.85)),
                borderBottomColor: SHADOW,
                opacity: open.interpolate({
                  inputRange: [0.1, 0.5],
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          />

          {/* Two bands down the trunk, continuous with the lid's. */}
          <View
            style={[styles.strap, { width: d.strap, left: d.strapInset, backgroundColor: metal }]}
          />
          <View
            style={[styles.strap, { width: d.strap, right: d.strapInset, backgroundColor: metal }]}
          />

          {/* The lip the lid closes onto — the brightest edge on the object,
              because it is the face pointing at the light, and what makes the
              lid look like it came OFF something. */}
          <View style={[styles.rim, { height: d.rim, backgroundColor: metal }]} />

          {/* Feet, so it sits on something rather than floating. */}
          <View
            style={[styles.foot, { width: d.footW, height: d.footH, left: d.footInset }]}
          />
          <View
            style={[styles.foot, { width: d.footW, height: d.footH, right: d.footInset }]}
          />
        </View>

        {/* ── The catch on the front rim, straddling the seam. It lets go
            before anything else moves. */}
        <Animated.View
          style={[
            styles.lock,
            {
              width: d.lockW,
              height: d.lockH,
              bottom: d.bodyH - Math.round(d.lockH * 0.65),
              borderRadius: Math.max(2, Math.round(d.lockW * 0.21)),
              backgroundColor: metal,
              opacity: open.interpolate({
                inputRange: [0.05, 0.3],
                outputRange: [1, 0],
                extrapolate: 'clamp',
              }),
              transform: [
                {
                  scale: open.interpolate({
                    inputRange: [0.05, 0.3],
                    outputRange: [1, 1.6],
                    extrapolate: 'clamp',
                  }),
                },
              ],
            },
          ]}
        >
          <View
            style={[
              styles.keyhole,
              {
                width: Math.max(2, Math.round(d.lockW * 0.21)),
                height: Math.max(3, Math.round(d.lockH * 0.4)),
                backgroundColor: DEEP,
              },
            ]}
          />
        </Animated.View>

        {/* ── The lid: arched, lit from above, banded to meet the trunk. */}
        <Animated.View
          style={[
            styles.lid,
            {
              width: d.w,
              height: d.lidH,
              bottom: d.bodyH - d.overlap,
              transform: lidTransform,
            },
          ]}
        >
          <LinearGradient
            colors={[lidTop, trunk]}
            style={[
              styles.lidFace,
              {
                // Arched: a barrel top, which is what makes it a chest rather
                // than a box.
                borderTopLeftRadius: d.arch,
                borderTopRightRadius: d.arch,
                borderBottomLeftRadius: d.overlap,
                borderBottomRightRadius: d.overlap,
              },
            ]}
          >
            <View
              style={[styles.strap, { width: d.strap, left: d.strapInset, backgroundColor: metal }]}
            />
            <View
              style={[styles.strap, { width: d.strap, right: d.strapInset, backgroundColor: metal }]}
            />
            {/* The one specular line, along the crown. */}
            <View
              style={[
                styles.crown,
                { left: d.crown, right: d.crown, top: Math.max(2, Math.round(d.w * 0.025)) },
              ]}
            />
          </LinearGradient>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', justifyContent: 'flex-end' },
  glow: { position: 'absolute', backgroundColor: colors.gold },
  body: { position: 'absolute', bottom: 0, left: 0, right: 0, overflow: 'hidden' },
  mouth: { position: 'absolute', left: 0, right: 0 },
  strap: { position: 'absolute', top: 0, bottom: 0 },
  rim: { position: 'absolute', top: 0, left: 0, right: 0 },
  foot: { position: 'absolute', bottom: 0, backgroundColor: DEEP },
  lock: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  keyhole: { borderRadius: 2 },
  /** The pivot is the lid's own bottom edge — the hinge at the back of the rim. */
  lid: { position: 'absolute', transformOrigin: 'center bottom' },
  lidFace: { flex: 1, overflow: 'hidden' },
  crown: { position: 'absolute', height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.18)' },
});

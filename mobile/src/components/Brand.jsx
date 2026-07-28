import { StyleSheet, View } from 'react-native';
import { colors, layout, space, type } from '../theme/index.js';
import { Text } from './ui.jsx';

/**
 * design.md §12 — the Mimo mark.
 *
 * Two overlapping circles: the left one filled, the right one an open ring.
 * It is the two `o`s of the name, it is an OMR bubble filled and unfilled, and
 * it is the product — two players, one question, one of them ahead. A mark that
 * has to be explained is a bad mark; this one only has to be seen twice.
 *
 * Like the icon set it is drawn from Views, so the same component is the splash
 * screen, the tab bar centre button and a 16px inline mark.
 */
/**
 * @param tone `accent` on a dark field, `onColor` white on a photo or gradient,
 *   `onAccent` near-black for the mark sitting ON the accent — the tab bar's
 *   centre button and the app tile. White on a cyan this bright is 1.9:1, so
 *   the mark has to invert rather than stay white the way it could on violet.
 */
export function Logo({ size = 56, tone = 'accent' }) {
  const fill =
    tone === 'onColor' ? colors.onColor : tone === 'onAccent' ? colors.onAccent : colors.accent;
  const d = size * 0.62;
  const stroke = Math.max(2, size * 0.09);

  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessibilityLabel="Mimo"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: fill }} />
        <View
          style={{
            width: d,
            height: d,
            borderRadius: d / 2,
            borderWidth: stroke,
            borderColor: fill,
            marginLeft: -d * 0.32,
          }}
        />
      </View>
    </View>
  );
}

/** The mark in a rounded tile — the app icon, the splash, the empty avatar. */
export function LogoTile({ size = 72, radius }) {
  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: radius ?? size * 0.28 },
      ]}
    >
      <Logo size={size * 0.72} tone="onAccent" />
    </View>
  );
}

export function Wordmark({ size = 26, tone = 'accent' }) {
  const fg = tone === 'onColor' ? colors.onColor : colors.ink;
  return (
    <View style={styles.wordmark}>
      <Logo size={size * 1.05} tone={tone === 'onColor' ? 'onColor' : 'accent'} />
      <Text style={[type.display, { fontSize: size, lineHeight: size * 1.2, color: fg }]}>mimo</Text>
    </View>
  );
}

/**
 * The purple field: onboarding, versus, the result and the podium.
 *
 * A flat night field rather than a gradient, with four oversized rotated squares at
 * 6% white behind everything. Stacked-view gradients band visibly across a
 * whole phone screen, and a real gradient would mean a native module for one
 * decorative effect — a texture reads better than either and costs four views.
 */
/**
 * The full-bleed brand field.
 *
 * The default tone is the night — the same field the splash, the welcome and
 * the match already asked for by name. It used to default to the brand colour,
 * which is how the join sheet and the contest header ended up as saturated
 * panels while every other full-bleed screen was dark.
 */
export function BrandField({ children, style, tone = colors.night }) {
  return (
    <View style={[styles.field, { backgroundColor: tone }, style]}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={[styles.shape, { top: -60, left: -70, width: 240, height: 240 }]} />
        <View style={[styles.shape, { top: 140, right: -110, width: 300, height: 300 }]} />
        <View style={[styles.shape, { bottom: -80, left: -50, width: 260, height: 260 }]} />
        <View style={[styles.shape, { bottom: 160, right: -60, width: 180, height: 180 }]} />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  field: { flex: 1, overflow: 'hidden' },
  shape: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: layout.radiusCard * 3,
    transform: [{ rotate: '32deg' }],
  },
});

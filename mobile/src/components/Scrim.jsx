import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * design.md §6.4 — a bottom scrim so a title stays legible over any cover art.
 *
 * A real gradient, not stacked opacity bands: the banded version rendered as
 * visible horizontal steps on device — exactly the artefact a scrim exists to
 * not have. `expo-linear-gradient` ships inside Expo Go, so the module costs
 * nothing at runtime that the bands did not.
 *
 * The ramp is near-black rather than the app's `ink`, because a scrim's job
 * is to remove contrast from a photograph, and a tinted one leaves a colour
 * cast on every cover in the feed.
 */
export function LinearGradientFallback() {
  return (
    <LinearGradient
      colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.02)', 'rgba(0,0,0,0.38)', 'rgba(0,0,0,0.72)']}
      locations={[0, 0.42, 0.74, 1]}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    />
  );
}

/**
 * The searching screen's edge fades — the map dissolving into the quiet field at
 * the top and bottom so the gold type always sits on calm. Same reasoning as
 * above: a real ramp, no steps.
 */
export function EdgeFade({ tone, height, top = false, style }) {
  const clear = `${tone}00`;
  return (
    <LinearGradient
      colors={top ? [tone, clear] : [clear, tone]}
      style={[top ? styles.top : styles.bottom, { height }, style]}
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0 },
});

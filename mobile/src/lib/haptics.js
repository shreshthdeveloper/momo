import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Haptics are part of the feedback loop for a game measured in tenths of a
 * second — a tap that answers a question should be felt before it is seen.
 *
 * Every call is fire-and-forget: a device without a taptic engine must never
 * throw into the answer path.
 */

const KEY = 'mimo.haptics';

let enabled = true;

/**
 * The preference is persisted, not just held in this module.
 *
 * It used to live only here, which meant Settings turned haptics off for the
 * session and silently turned them back on at the next launch — and a player
 * who switched them off because a phone buzzing in a lecture is a problem had
 * to find the toggle again every single day.
 *
 * Reads stay synchronous off this variable: the answer path cannot afford an
 * await, and a first launch simply uses the default until the stored value
 * arrives a moment later.
 */
export function setHapticsEnabled(value) {
  enabled = Boolean(value);
  SecureStore.setItemAsync(KEY, enabled ? '1' : '0').catch(() => {});
}

export function getHapticsEnabled() {
  return enabled;
}

/** Called once at boot. A failure here just leaves the default in place. */
export async function loadHapticsPreference() {
  try {
    const stored = await SecureStore.getItemAsync(KEY);
    if (stored !== null) enabled = stored === '1';
  } catch {
    // Keychain unavailable — the default stands.
  }
  return enabled;
}

const run = (fn) => {
  if (!enabled || Platform.OS === 'web') return;
  fn().catch(() => {});
};

/** Filling a bubble, or the opponent answering. */
export const tap = () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

/** A correct answer at resolution. */
export const success = () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));

/** A wrong answer at resolution. */
export const failure = () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));

/** An opponent found, and the match verdict. */
export const heavy = () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));

export const selection = () => run(() => Haptics.selectionAsync());

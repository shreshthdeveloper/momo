import * as SecureStore from 'expo-secure-store';

/**
 * Which unlocks the player has actually opened.
 *
 * The server knows what a player owns; it does not know what they have *seen*.
 * Those differ for one screen only — the rewards shelf, where an unopened
 * reward should still be waiting for you the next time you come back, because
 * the whole point of a chest is that opening it is the moment.
 *
 * Stored as a single number: the highest account level whose unlocks have been
 * opened. That is enough because unlocks are strictly ordered by level and
 * permanent — knowing the high-water mark tells you everything below it is
 * done. A per-key set would carry the same information and go stale the moment
 * the perk list changes.
 *
 * `expo-secure-store` is the only storage this app has (tech.md §15 keeps
 * tokens out of AsyncStorage, and AsyncStorage is not installed). It is heavier
 * than this value deserves, but one small integer written on a level-up is not
 * a cost worth adding a dependency to avoid.
 */

const KEY = 'mimo.perksSeen';

/**
 * The high-water mark, or `null` when this device has never recorded one.
 *
 * `null` is meaningfully different from 0: a player who installed the app on a
 * second device is already level 20 with twenty unlocks behind them, and
 * greeting them with twenty unopened chests for things they have been wearing
 * for weeks would be nonsense. The caller treats `null` as "start from where
 * they already are".
 */
export async function getSeenLevel() {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw === null) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    // Keychain unavailable — behave as a device that has never seen anything,
    // which the caller resolves to "nothing pending" rather than "everything".
    return null;
  }
}

/** Never moves backwards: a stale write must not resurrect opened rewards. */
export async function setSeenLevel(level) {
  const next = Math.max(0, Math.floor(level ?? 0));
  try {
    const current = await getSeenLevel();
    if (current !== null && current >= next) return current;
    await SecureStore.setItemAsync(KEY, String(next));
    return next;
  } catch {
    return null;
  }
}

/**
 * The live progression snapshot.
 *
 * A module with no imports on purpose. The User model needs the configured
 * account curve to report a level, and the service that loads that curve needs
 * the models — putting the value in a leaf module breaks the cycle instead of
 * relying on ESM hoisting to paper over it.
 *
 * Written once at boot and again after every superadmin write. Readers get a
 * synchronous answer or `null`, and `null` means "use the shipped defaults" —
 * never "wait", because a mongoose document method cannot.
 */

let snapshot = null;

export function setProgressionSnapshot(next) {
  snapshot = next;
}

export function progressionSnapshot() {
  return snapshot;
}

/** The configured account XP table, or null before the first load. */
export function activeAccountCurve() {
  return snapshot?.accountCurve ?? null;
}

/** The configured league ladder, or null before the first load. */
export function activeLadder() {
  return snapshot?.ladder ?? null;
}

/** The configured cosmetics catalogue, or null before the first load. */
export function activeCatalogue() {
  return snapshot?.catalogue ?? null;
}

export function clearProgressionSnapshot() {
  snapshot = null;
}

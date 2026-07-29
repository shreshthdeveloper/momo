/**
 * A one-line bus between the socket and whatever cares.
 *
 * The socket belongs to the game provider — it is opened, authenticated,
 * resumed and torn down there, and that should not change because a second
 * feature wants to hear something on it. But notifications are not game state
 * and do not belong in the match reducer either.
 *
 * So the game provider publishes what arrives and anyone may subscribe. Two
 * providers importing each other to pass one payload is the alternative, and
 * that is a cycle for the sake of a callback.
 */
const listeners = new Map();

/** @returns {Function} unsubscribe */
export function subscribe(event, handler) {
  const set = listeners.get(event) ?? new Set();
  set.add(handler);
  listeners.set(event, set);
  return () => {
    set.delete(handler);
    if (set.size === 0) listeners.delete(event);
  };
}

export function publish(event, payload) {
  for (const handler of listeners.get(event) ?? []) {
    try {
      handler(payload);
    } catch {
      // One bad subscriber must not stop the others from being told.
    }
  }
}

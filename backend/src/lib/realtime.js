import { logger } from './logger.js';

/**
 * A one-way door from the services to whoever is currently connected.
 *
 * The socket gateway owns the namespace and the services own the events worth
 * telling somebody about, and neither should import the other: the gateway
 * already imports half the services, so a service reaching back for the
 * namespace would close the loop. The gateway registers itself here at start-up
 * instead, and a service that has news calls `emitToUser`.
 *
 * Unregistered — a test, a script, a boot that has not reached
 * `createSocketGateway` — is a no-op rather than a throw. Nothing in the
 * product may fail because nobody happened to be listening.
 */
let transport = null;

export function setRealtime(next) {
  transport = next;
}

export function clearRealtime() {
  transport = null;
}

/** Deliver `payload` to every socket this user has open, if any. */
export function emitToUser(userId, event, payload) {
  if (!transport) return false;
  try {
    transport.toUser(String(userId), event, payload);
    return true;
  } catch (err) {
    // A delivery failure is not worth failing the write that caused it: the
    // row is in the inbox either way, which is the part that has to be true.
    logger.warn({ err, event }, 'realtime emit failed');
    return false;
  }
}

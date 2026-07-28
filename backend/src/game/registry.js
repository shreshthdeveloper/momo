/**
 * In-process registry of live matches and connected players (tech.md §12, v1).
 *
 * Deliberately behind a narrow interface. When the game module is extracted in
 * v2 the live-match map stays exactly where it is — a match is a 70-second
 * object and sticky sessions keep both players on the node that owns it, so
 * there is nothing to move. What changes is only the cross-node view: a
 * `matches` row marks the owning node, and a change stream carries events to
 * whichever node holds each socket (tech.md §12). Nothing that calls this
 * file changes.
 */

/** @type {Map<string, import('./matchEngine.js').LiveMatch>} */
const liveMatches = new Map();
/** userId → matchId */
const userToMatch = new Map();
/** userId → Set<socketId> */
const userSockets = new Map();

export const registry = {
  addMatch(match) {
    liveMatches.set(match.id, match);
    for (const p of match.players) {
      if (!p.isGhost) userToMatch.set(String(p.userId), match.id);
    }
  },

  removeMatch(matchId) {
    const match = liveMatches.get(matchId);
    if (!match) return;
    for (const p of match.players) {
      if (userToMatch.get(String(p.userId)) === matchId) userToMatch.delete(String(p.userId));
    }
    liveMatches.delete(matchId);
  },

  getMatch(matchId) {
    return liveMatches.get(matchId);
  },

  matchForUser(userId) {
    const id = userToMatch.get(String(userId));
    return id ? liveMatches.get(id) : undefined;
  },

  bindSocket(userId, socketId) {
    const key = String(userId);
    if (!userSockets.has(key)) userSockets.set(key, new Set());
    userSockets.get(key).add(socketId);
  },

  unbindSocket(userId, socketId) {
    const key = String(userId);
    const set = userSockets.get(key);
    if (!set) return 0;
    set.delete(socketId);
    if (!set.size) userSockets.delete(key);
    return set.size;
  },

  socketCountFor(userId) {
    return userSockets.get(String(userId))?.size ?? 0;
  },

  isOnline(userId) {
    return (userSockets.get(String(userId))?.size ?? 0) > 0;
  },

  stats() {
    return {
      liveMatches: liveMatches.size,
      playersInMatch: userToMatch.size,
      connectedUsers: userSockets.size,
    };
  },

  /** Test and shutdown support. Stops every timer this process owns. */
  clear() {
    for (const match of liveMatches.values()) match.dispose();
    liveMatches.clear();
    userToMatch.clear();
    userSockets.clear();
  },

  allMatches() {
    return [...liveMatches.values()];
  },
};

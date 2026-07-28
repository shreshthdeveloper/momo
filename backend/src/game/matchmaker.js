import {
  LEVEL_BAND_MAX,
  LEVEL_BAND_STEP_MS,
  GHOST_AFTER_MS,
  QUEUE_SWEEP_AFTER_MS,
  HUMAN_ONLY_SWEEP_AFTER_MS,
} from '../shared/constants.js';
import { logger } from '../lib/logger.js';

/**
 * Matchmaking queues (tech.md §8). In-process for v1.
 *
 * One deliberate departure from the pseudocode in tech.md: that sketch gives
 * every waiting player their own `setInterval`, and its own commentary names
 * orphaned timers as the most likely source of a memory leak here. This uses a
 * single shared tick for the whole matchmaker instead — same widening
 * behaviour, same 3-second ghost deadline, but there is exactly one timer in
 * the process regardless of queue depth, so there is nothing to orphan.
 *
 * The interface is what matters for v2: `join` / `leave` / `sweep`. tech.md §12
 * replaces the backing store with a MongoDB `queueEntries` collection indexed
 * on `{ spaceId, topicId, level }` — opponent search becomes a range query and
 * pairing becomes an atomic `findOneAndDelete`, so two nodes can never claim
 * the same waiting player. That change lands in this file and nowhere else.
 *
 * Pairing reads the TOPIC LEVEL, never a rating (constants.js, LEVEL_BAND_MAX).
 * The band opens at 0 — same level only — widens by one level per step, and
 * stops hard at the cap: past it, a ghost is the better match. Because the band
 * starts closed rather than 150 points wide, the first pass is an equality
 * check, and most pairs are struck at the exact same level.
 */

export const poolKey = (spaceId, topicId) => `${spaceId ?? 'public'}:${topicId}`;

/**
 * A player with no rating row on this topic has never played it, which is
 * level 1 — the same place the Rating model starts them.
 */
const levelOf = (entry) => (Number.isFinite(entry?.level) ? entry.level : 1);

/**
 * Whether this entry will accept an invented opponent when the deadline passes.
 *
 * `false` means the ghost deadline does not apply to them at all: they keep
 * waiting, band still widening, until a real person arrives, they cancel, or
 * the sweep gives up. It is the only way a paired match becomes *evidence* that
 * two live players found each other — with ghosts on, an opponent appearing
 * proves nothing, because one always appears (F6.7.5 forbids saying which).
 */
const acceptsGhost = (entry) => entry?.allowGhosts !== false;

/**
 * Two waiting players may pair when the gap fits inside the WIDER of their two
 * bands. Taking the wider one is what stops the longest waiter from being
 * blocked by a newcomer whose band has not opened yet: the person who has been
 * waiting is the one whose patience should buy the looser match.
 */
function inBand(a, b, bBand = b.band ?? 0) {
  const gap = Math.abs(levelOf(a) - levelOf(b));
  return gap <= Math.max(a.band ?? 0, bBand);
}

export class Matchmaker {
  constructor({
    onPair,
    onGhost,
    onExpire,
    bandMax = LEVEL_BAND_MAX,
    bandStepMs = LEVEL_BAND_STEP_MS,
    ghostAfterMs = GHOST_AFTER_MS,
    sweepAfterMs = QUEUE_SWEEP_AFTER_MS,
    humanOnlySweepAfterMs = HUMAN_ONLY_SWEEP_AFTER_MS,
    tickMs = 500,
  } = {}) {
    this.onPair = onPair ?? (() => {});
    this.onGhost = onGhost ?? (() => {});
    /**
     * A waiting player the queue is giving up on. Only ever fires for someone
     * who refused a ghost — everyone else is served one long before the sweep
     * reaches them — and it exists so that player is *told*, rather than left
     * watching a searching screen nothing will ever end.
     */
    this.onExpire = onExpire ?? (() => {});
    this.bandMax = bandMax;
    this.bandStepMs = bandStepMs;
    this.ghostAfterMs = ghostAfterMs;
    this.sweepAfterMs = sweepAfterMs;
    this.humanOnlySweepAfterMs = humanOnlySweepAfterMs;
    this.tickMs = tickMs;

    /** @type {Map<string, Array>} poolKey → waiting entries */
    this.pools = new Map();
    /** @type {Map<string, string>} userId → poolKey */
    this.userPool = new Map();
    this.ticker = null;
    this.metrics = { paired: 0, ghosted: 0, expired: 0, totalWaitMs: 0, joins: 0 };
  }

  start() {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.tick(), this.tickMs);
    this.ticker.unref?.();
  }

  stop() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  /**
   * @param {object} entry { userId, level, rating, topicId, spaceId, displayName, avatarUrl, allowGhosts }
   * @returns {'paired' | 'queued'}
   */
  join(entry) {
    this.start();
    const key = poolKey(entry.spaceId, entry.topicId);

    // Joining a second queue silently abandons the first — otherwise a player
    // who backs out and picks another topic stays discoverable in both.
    this.leave(entry.userId);

    // The arriving player's own band is 0 — they have waited no time at all —
    // so this first look only ever finds someone whose band has already opened
    // far enough to reach them. An exact-level opponent is found immediately.
    const pool = this.pools.get(key) ?? [];
    const opponent = pool.find(
      (w) => String(w.userId) !== String(entry.userId) && inBand(w, entry, 0),
    );

    this.metrics.joins += 1;

    if (opponent) {
      this.removeFrom(key, opponent.userId);
      this.metrics.paired += 1;
      this.metrics.totalWaitMs += Date.now() - opponent.joinedAt;
      Promise.resolve(this.onPair(opponent, entry)).catch((err) =>
        logger.error({ err }, 'onPair failed'),
      );
      return 'paired';
    }

    pool.push({ ...entry, level: levelOf(entry), band: 0, joinedAt: Date.now() });
    this.pools.set(key, pool);
    this.userPool.set(String(entry.userId), key);
    return 'queued';
  }

  leave(userId) {
    const key = this.userPool.get(String(userId));
    if (!key) return false;
    this.removeFrom(key, userId);
    return true;
  }

  removeFrom(key, userId) {
    const pool = this.pools.get(key);
    if (pool) {
      const next = pool.filter((w) => String(w.userId) !== String(userId));
      if (next.length) this.pools.set(key, next);
      else this.pools.delete(key);
    }
    this.userPool.delete(String(userId));
  }

  isQueued(userId) {
    return this.userPool.has(String(userId));
  }

  /**
   * One pass over every pool: widen search bands, pair anyone now in range,
   * and serve a ghost to anyone past the deadline.
   */
  tick() {
    const now = Date.now();

    for (const [key, pool] of [...this.pools.entries()]) {
      // Widen first, so a pair that only just became possible is found in the
      // same pass rather than the next one. The cap is hard: a level 3 against
      // a level 12 is not a contest, so the band stops and the ghost deadline
      // is left to do its job.
      for (const waiting of pool) {
        const elapsed = now - waiting.joinedAt;
        waiting.band = Math.min(this.bandMax, Math.floor(elapsed / this.bandStepMs));
      }

      const paired = new Set();
      for (const waiting of pool) {
        if (paired.has(waiting.userId)) continue;
        const other = pool.find(
          (w) => w !== waiting && !paired.has(w.userId) && inBand(w, waiting),
        );
        if (!other) continue;

        paired.add(waiting.userId);
        paired.add(other.userId);
        this.metrics.paired += 2;
        this.metrics.totalWaitMs += now - waiting.joinedAt + (now - other.joinedAt);
        Promise.resolve(this.onPair(waiting, other)).catch((err) =>
          logger.error({ err }, 'onPair failed'),
        );
      }
      for (const id of paired) this.removeFrom(key, id);

      // prd.md F6.4.3 — nobody waits longer than the ghost deadline. Anyone who
      // has refused ghosts has, by the same token, refused that promise: they
      // stay in the pool with their band still widening, and only the sweep
      // below ever ends their wait.
      const remaining = this.pools.get(key) ?? [];
      for (const waiting of [...remaining]) {
        if (!acceptsGhost(waiting)) continue;
        if (now - waiting.joinedAt < this.ghostAfterMs) continue;
        this.removeFrom(key, waiting.userId);
        this.metrics.ghosted += 1;
        this.metrics.totalWaitMs += now - waiting.joinedAt;
        Promise.resolve(this.onGhost(waiting)).catch((err) =>
          logger.error({ err }, 'onGhost failed'),
        );
      }
    }

    this.sweep(now);
  }

  /**
   * Safety net for entries no longer owned by a live connection.
   *
   * For an ordinary entry this is unreachable — the ghost deadline fires at 8s
   * and the sweep waits 30 — so it only ever catches something already broken.
   * For a player who refused ghosts it is the opposite: nothing else ends their
   * wait, so the window is far longer and being swept is a normal outcome the
   * client has to be told about rather than a corruption to log and forget.
   */
  sweep(now = Date.now()) {
    for (const [key, pool] of [...this.pools.entries()]) {
      for (const waiting of [...pool]) {
        const humanOnly = !acceptsGhost(waiting);
        const limit = humanOnly ? this.humanOnlySweepAfterMs : this.sweepAfterMs;
        if (now - waiting.joinedAt <= limit) continue;

        this.removeFrom(key, waiting.userId);
        if (humanOnly) {
          this.metrics.expired += 1;
          this.metrics.totalWaitMs += now - waiting.joinedAt;
          logger.info({ userId: waiting.userId, key }, 'human-only queue gave up');
          Promise.resolve(this.onExpire(waiting)).catch((err) =>
            logger.error({ err }, 'onExpire failed'),
          );
        } else {
          logger.warn({ userId: waiting.userId, key }, 'sweeping stale queue entry');
        }
      }
    }
  }

  stats() {
    const queued = [...this.pools.values()].reduce((n, p) => n + p.length, 0);
    const matched = this.metrics.paired + this.metrics.ghosted + this.metrics.expired;
    return {
      queued,
      pools: this.pools.size,
      ...this.metrics,
      avgWaitMs: matched ? Math.round(this.metrics.totalWaitMs / matched) : 0,
      ghostRatio: matched ? this.metrics.ghosted / matched : 0,
    };
  }

  clear() {
    this.pools.clear();
    this.userPool.clear();
    this.stop();
  }
}

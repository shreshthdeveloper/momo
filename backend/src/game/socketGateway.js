import { Server } from 'socket.io';
import { GameOrchestrator } from './orchestrator.js';
import { registry } from './registry.js';
import { verifyAccessToken, loadAuthenticatedUser } from '../services/authService.js';
import {
  GAME_NAMESPACE,
  C2S,
  S2C,
  ERROR_CODE,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
} from '../shared/protocol.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { setRealtime } from '../lib/realtime.js';
import { AppError } from '../lib/errors.js';

/**
 * The socket layer (tech.md §7). Its entire job is translation: socket frames
 * in, orchestrator calls out. No game rule lives here.
 *
 * tech.md §6 — live gameplay never touches REST.
 */

/** Per-socket token bucket. tech.md §9.6 lists queue-join spam as a farming vector. */
class RateLimiter {
  constructor(limits) {
    this.limits = limits;
    this.buckets = new Map();
  }

  allow(socketId, event) {
    const limit = this.limits[event];
    if (!limit) return true;
    const key = `${socketId}:${event}`;
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { count: 0, resetAt: now + limit.windowMs };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + limit.windowMs;
    }
    bucket.count += 1;
    this.buckets.set(key, bucket);
    return bucket.count <= limit.max;
  }

  forget(socketId) {
    for (const key of this.buckets.keys()) {
      if (key.startsWith(`${socketId}:`)) this.buckets.delete(key);
    }
  }
}

export function createSocketGateway(httpServer, { timing = {} } = {}) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: env.CORS_ORIGINS, credentials: true },
    pingInterval: 10_000,
    pingTimeout: 8_000,
    maxHttpBufferSize: 1e5,
  });

  const nsp = io.of(GAME_NAMESPACE);

  /**
   * Transport handed to the engine. Emitting by user room rather than by
   * socket id means a player with two devices, or one that reconnected mid
   * round, still receives everything.
   */
  const transport = {
    toPlayer(userId, event, payload) {
      nsp.to(`user:${userId}`).emit(event, payload);
    },
    toMatch(matchId, event, payload) {
      nsp.to(`match:${matchId}`).emit(event, payload);
    },
  };

  const orchestrator = new GameOrchestrator({ transport, timing });

  /**
   * The services' way to reach a connected player.
   *
   * Notifications are written all over the product — friends, challenges,
   * contests, chests — and none of those services should know a socket exists.
   * Registering the namespace once here is what lets `notify()` deliver a row
   * the moment it is written without importing any of this.
   */
  setRealtime({
    toUser: (userId, event, payload) => transport.toPlayer(userId, event, payload),
  });

  const limiter = new RateLimiter({
    [C2S.QUEUE_JOIN]: { max: 12, windowMs: 60_000 },
    [C2S.MATCH_ANSWER]: { max: 60, windowMs: 60_000 },
    [C2S.MATCH_REMATCH]: { max: 10, windowMs: 60_000 },
    // A contest allows one entry, so this is only ever guarding retries after
    // an error. Tight on purpose.
    [C2S.CONTEST_ENTER]: { max: 6, windowMs: 60_000 },
  });

  // ── Handshake ────────────────────────────────────────────────────────────

  nsp.use(async (socket, next) => {
    try {
      const { token, protocolVersion } = socket.handshake.auth ?? {};

      // tech.md §16 — reject an unsupported protocol explicitly, so the client
      // can prompt for an upgrade instead of failing silently.
      const version = Number(protocolVersion ?? 0);
      if (version < MIN_SUPPORTED_PROTOCOL_VERSION) {
        return next(
          Object.assign(new Error('Update the app to keep playing.'), {
            data: { code: ERROR_CODE.PROTOCOL_UNSUPPORTED, required: PROTOCOL_VERSION },
          }),
        );
      }

      if (!token) {
        return next(
          Object.assign(new Error('Sign in to continue.'), {
            data: { code: ERROR_CODE.UNAUTHENTICATED },
          }),
        );
      }

      const claims = verifyAccessToken(token);
      const user = await loadAuthenticatedUser(claims);

      socket.data.user = {
        id: String(user._id),
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        role: user.role,
        locale: user.locale,
      };
      return next();
    } catch (err) {
      // An expired token gets its own code so the client refreshes and
      // reconnects rather than bouncing the user to the sign-in screen.
      const code = err instanceof AppError ? err.code : ERROR_CODE.UNAUTHENTICATED;
      return next(Object.assign(new Error(err.message ?? 'Sign in to continue.'), { data: { code } }));
    }
  });

  // ── Connection ───────────────────────────────────────────────────────────

  nsp.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);
    registry.bindSocket(user.id, socket.id);

    logger.debug({ userId: user.id, socketId: socket.id }, 'socket connected');

    // A player who reconnects inside the grace window resumes the live match
    // at the current round, with remaining time recomputed server-side.
    const resumed = orchestrator.handleReconnect(user.id);
    if (resumed) {
      socket.join(`match:${resumed.matchId}`);
      socket.emit(S2C.MATCH_RESUME, resumed);
    } else {
      /**
       * No live match — but there may be a result they never saw.
       *
       * The disconnect grace forfeits the match after ten seconds, and the
       * `match:end` that ends it is emitted to a room this player is not in,
       * because being absent is the whole reason it fired. Without this they
       * come back to a dead board with the clock at zero and never learn they
       * forfeited, let alone what it cost them.
       */
      const missed = orchestrator.missedResult(user.id);
      if (missed) {
        orchestrator.clearMissedResult(user.id);
        socket.emit(S2C.MATCH_END, missed);
      }
    }

    const fail = (code, message) => socket.emit(S2C.ERROR, { code, message });

    const guard = (event, handler) => async (payload, ack) => {
      try {
        if (!limiter.allow(socket.id, event)) {
          fail(ERROR_CODE.RATE_LIMITED, 'Slow down a moment.');
          return ack?.({ ok: false, code: ERROR_CODE.RATE_LIMITED });
        }
        const result = await handler(payload ?? {});
        return ack?.({ ok: true, ...(result ?? {}) });
      } catch (err) {
        if (err instanceof AppError) {
          fail(err.code, err.message);
          return ack?.({ ok: false, code: err.code, message: err.message });
        }
        logger.error({ err, event, userId: user.id }, 'socket handler failed');
        fail(ERROR_CODE.INTERNAL, 'Something failed on our side. Try again.');
        return ack?.({ ok: false, code: ERROR_CODE.INTERNAL });
      }
    };

    socket.on(
      C2S.QUEUE_JOIN,
      guard(C2S.QUEUE_JOIN, async ({ topicId, spaceId, mode, challengeId }) => {
        const result = await orchestrator.joinQueue({
          user: socket.data.user,
          topicId,
          spaceId,
          mode,
          // A friend challenge (prd.md §6.3). With one, the topic and the mode
          // are read from the challenge and everything else here is ignored.
          challengeId,
        });
        // Join the match room once one exists, so match-wide emits reach here.
        const match = registry.matchForUser(user.id);
        if (match) socket.join(`match:${match.id}`);
        return result;
      }),
    );

    socket.on(
      C2S.QUEUE_LEAVE,
      guard(C2S.QUEUE_LEAVE, async () => ({ left: orchestrator.leaveQueue(user.id) })),
    );

    /** prd.md F7.5 — entering a contest, protocol v2. */
    socket.on(
      C2S.CONTEST_ENTER,
      guard(C2S.CONTEST_ENTER, async ({ contestId }) => {
        const result = await orchestrator.enterContest({ user: socket.data.user, contestId });
        const match = registry.matchForUser(user.id);
        if (match) socket.join(`match:${match.id}`);
        return result;
      }),
    );

    socket.on(
      C2S.MATCH_ANSWER,
      guard(C2S.MATCH_ANSWER, async ({ matchId, roundIndex, optionIndex }) => {
        const result = orchestrator.answer(user.id, { matchId, roundIndex, optionIndex });
        if (!result.ok) {
          fail(result.code, result.message);
          return { ok: false, code: result.code };
        }
        // The ack carries the authoritative points so the client can settle its
        // local prediction without waiting for round:result.
        return { accepted: true, points: result.points };
      }),
    );

    socket.on(
      C2S.MATCH_LEAVE,
      guard(C2S.MATCH_LEAVE, async ({ matchId }) => ({
        left: orchestrator.leaveMatch(user.id, matchId),
      })),
    );

    socket.on(
      C2S.MATCH_REMATCH,
      guard(C2S.MATCH_REMATCH, async ({ matchId }) =>
        orchestrator.requestRematch(socket.data.user, matchId),
      ),
    );

    socket.on(
      C2S.MATCH_RESUME,
      guard(C2S.MATCH_RESUME, async () => {
        const snapshot = orchestrator.snapshotFor(user.id);
        if (snapshot) socket.join(`match:${snapshot.matchId}`);
        return { snapshot };
      }),
    );

    socket.on('disconnect', (reason) => {
      limiter.forget(socket.id);
      const remaining = registry.unbindSocket(user.id, socket.id);
      logger.debug({ userId: user.id, reason, remaining }, 'socket disconnected');

      // Only start the forfeit clock when the player has no connection left —
      // switching networks or backgrounding briefly must not cost a match.
      if (remaining === 0) orchestrator.handleDisconnect(user.id);
    });
  });

  return { io, nsp, orchestrator, transport };
}

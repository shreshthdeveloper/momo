import { Server } from 'socket.io';
import { GameOrchestrator } from './orchestrator.js';
import { registry } from './registry.js';
import { sessions } from './classSession.js';
import { sessionByCode } from '../services/classSessionService.js';
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
    /** The classroom: everybody in one lesson, host included. */
    toRoom(sessionId, event, payload) {
      nsp.to(`session:${sessionId}`).emit(event, payload);
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
    /** The classroom, for sessions created over REST by a host. */
    toRoom: (sessionId, event, payload) => transport.toRoom(sessionId, event, payload),
  });

  const limiter = new RateLimiter({
    [C2S.QUEUE_JOIN]: { max: 12, windowMs: 60_000 },
    [C2S.MATCH_ANSWER]: { max: 60, windowMs: 60_000 },
    [C2S.MATCH_REMATCH]: { max: 10, windowMs: 60_000 },
    // A contest allows one entry, so this is only ever guarding retries after
    // an error. Tight on purpose.
    [C2S.CONTEST_ENTER]: { max: 6, windowMs: 60_000 },
    /**
     * A session answer is one per question per person, so this only ever catches
     * a stuck finger. Generous because thirty phones answering at once is the
     * normal case, not the attack.
     */
    [C2S.SESSION_ANSWER]: { max: 90, windowMs: 60_000 },
    [C2S.SESSION_JOIN]: { max: 20, windowMs: 60_000 },
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
      guard(C2S.QUEUE_JOIN, async ({ topicId, spaceId, mode, challengeId, deck }) => {
        const result = await orchestrator.joinQueue({
          user: socket.data.user,
          topicId,
          spaceId,
          mode,
          // A friend challenge (prd.md §6.3). With one, the topic and the mode
          // are read from the challenge and everything else here is ignored.
          challengeId,
          /**
           * Which paper to deal — `'mistakes'` for the revision drill. Only the
           * name of a deck crosses the wire; which questions are in it is resolved
           * server-side from this player's own history.
           */
          deck,
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

    // ── Live class sessions (protocol v5) ──────────────────────────────────
    //
    // Deliberately not routed through the orchestrator. The orchestrator owns
    // matchmaking and 1v1 matches; a session has neither, and hanging it off the
    // same object would put thirty-player state inside the thing that runs every
    // ranked match. It talks to the session runner directly.

    socket.on(
      C2S.SESSION_JOIN,
      guard(C2S.SESSION_JOIN, async ({ code }) => {
        const stored = await sessionByCode(socket.data.user, code);
        const runner = sessions.get(String(stored._id));
        if (!runner) {
          throw new AppError(409, ERROR_CODE.BAD_REQUEST, 'That session is no longer running.');
        }

        runner.join({
          id: user.id,
          displayName: socket.data.user.displayName,
          avatarUrl: socket.data.user.avatarUrl,
        });
        socket.join(`session:${runner.id}`);

        // The lobby's roster is live, so everybody sees the room filling up —
        // which is the only thing on screen while the class arrives.
        transport.toRoom(runner.id, S2C.SESSION_ROSTER, {
          sessionId: runner.id,
          roster: runner.roster(),
        });
        return { snapshot: runner.snapshot({ forUserId: user.id }) };
      }),
    );

    socket.on(
      C2S.SESSION_ANSWER,
      guard(C2S.SESSION_ANSWER, async ({ sessionId, roundIndex, optionIndex }) => {
        const runner = sessions.get(sessionId);
        if (!runner) throw new AppError(404, ERROR_CODE.MATCH_NOT_FOUND, 'That session has ended.');
        const result = runner.answer(user.id, { roundIndex, optionIndex });
        if (!result.ok) {
          fail(result.code, 'That answer could not be accepted.');
          return { ok: false, code: result.code };
        }
        return { accepted: true };
      }),
    );

    /**
     * Host-only, all three. The check is `runner.hostId`, read from the session
     * the server created — never from anything in the frame — so a student who
     * knows the event name cannot drive somebody else's lesson.
     */
    const asHost = (runner) => {
      if (!runner) throw new AppError(404, ERROR_CODE.MATCH_NOT_FOUND, 'That session has ended.');
      if (String(runner.hostId) !== String(user.id)) {
        throw new AppError(403, ERROR_CODE.BAD_REQUEST, 'Only the host can do that.');
      }
      return runner;
    };

    socket.on(
      C2S.SESSION_START,
      guard(C2S.SESSION_START, async ({ sessionId }) => {
        const runner = asHost(sessions.get(sessionId));
        return { started: runner.start() };
      }),
    );

    socket.on(
      C2S.SESSION_NEXT,
      guard(C2S.SESSION_NEXT, async ({ sessionId }) => {
        const runner = asHost(sessions.get(sessionId));
        return { advanced: runner.nextRound() };
      }),
    );

    socket.on(
      C2S.SESSION_END,
      guard(C2S.SESSION_END, async ({ sessionId }) => {
        const runner = asHost(sessions.get(sessionId));
        await runner.end();
        return { ended: true };
      }),
    );

    socket.on(
      C2S.SESSION_LEAVE,
      guard(C2S.SESSION_LEAVE, async ({ sessionId }) => {
        const runner = sessions.get(sessionId);
        socket.leave(`session:${sessionId}`);
        /**
         * Leaving the room does NOT remove the score. A student who backgrounds
         * the app is still in the lesson and still on the board; erasing their
         * score because their phone locked would be the most visible bug this
         * feature could have — it happens in front of the whole class.
         */
        if (runner) {
          transport.toRoom(runner.id, S2C.SESSION_ROSTER, {
            sessionId: runner.id,
            roster: runner.roster(),
          });
        }
        return { left: true };
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

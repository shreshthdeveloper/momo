import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { AppState } from 'react-native';
import { BASE_URL, getAccessToken, request } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import { C2S, S2C, GAME_NAMESPACE, PROTOCOL_VERSION, ERROR_CODE } from '../shared/protocol.js';
import { scoreAnswer } from '../shared/scoring.js';
import { MATCH_MODE, MATCH_STATE, RATED_MODES } from '../shared/constants.js';
import { tap, success, failure, heavy } from '../lib/haptics.js';
import { music, sfx } from '../lib/sound.js';

/**
 * The game connection and match state.
 *
 * The client runs the SAME scoring code as the server (src/shared, mirrored
 * and parity-tested) so a tap can show its points immediately while the server
 * remains the only authority. When the authoritative value arrives it simply
 * replaces the prediction — and because both sides run identical code, it
 * always agrees.
 *
 * It also holds the one thing chosen BEFORE a match exists: the mode. Quick or
 * ranked is picked on /play, the queue is joined from /match/searching, and
 * this is what carries the answer across those two screens and into
 * `queue:join`.
 *
 * tech.md §7 — live gameplay never touches REST.
 */

const GameContext = createContext(null);

/**
 * leagues-and-progression.md §1 — the player chooses between exactly two
 * things. Practice and contest are modes the server knows about, but they are
 * never a choice made here: practice is a backend-only ghost mode, and a
 * contest is entered by id from the contest screen.
 */
const CHOOSABLE_MODES = [MATCH_MODE.QUICK, MATCH_MODE.RANKED];
const KNOWN_MODES = new Set(Object.values(MATCH_MODE));

/** Anything unrecognised — or missing — is ranked. Ranked is the default. */
function asMode(mode) {
  return KNOWN_MODES.has(mode) ? mode : MATCH_MODE.RANKED;
}

const INITIAL = {
  status: 'idle', // idle | searching | found | countdown | playing | resolved | finished
  matchId: null,
  topic: null,
  opponent: null,
  you: null,
  headToHead: null,
  totalRounds: 7,
  roundIndex: -1,
  question: null,
  options: [],
  durationMs: 10_000,
  startedAt: null,
  serverOffsetMs: 0,
  yourAnswer: null,
  opponentAnswered: false,
  roundResult: null,
  scores: { you: 0, opponent: 0 },
  result: null,
  error: null,
  opponentConnected: true,
  /** Set for the duration of a contest entry (prd.md F7.5). */
  contestId: null,
  /**
   * The mode of the match in hand: what the queue was joined with and, once
   * `match:found` lands, what the server actually gave. The result screen
   * reads it to know whether a rating and a league moved.
   */
  mode: MATCH_MODE.RANKED,
  /** The player's standing choice for the next match — quick or ranked only. */
  preferredMode: MATCH_MODE.RANKED,
};

/** Idle, but still remembering what the player chose to play. */
function idleState(preferredMode) {
  return { ...INITIAL, mode: preferredMode, preferredMode };
}

export function GameProvider({ children }) {
  /** Mounted inside AuthProvider (app/_layout.jsx), so this is always live. */
  const { user } = useAuth();
  const [state, setState] = useState(INITIAL);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  /**
   * Actions read the latest state through this ref rather than closing over
   * it, so they keep a stable identity and do not resubscribe every socket
   * handler on each state change.
   */
  const stateRef = useRef(state);
  /**
   * The chosen mode is held in a ref as well as in state because the queue is
   * joined two screens after it is picked — the picker is on /play, the
   * `queue:join` goes out from /match/searching — and the actions below must
   * read it without taking a new identity on every change.
   */
  const preferredModeRef = useRef(INITIAL.preferredMode);
  const patch = useCallback((next) => setState((s) => ({ ...s, ...next })), []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // ── Connection ───────────────────────────────────────────────────────────

  const connect = useCallback(() => {
    const token = getAccessToken();
    if (!token || socketRef.current?.connected) return socketRef.current;

    socketRef.current?.close();

    const socket = io(`${BASE_URL}${GAME_NAMESPACE}`, {
      /**
       * Read at every handshake, not captured once.
       *
       * The access token lives 15 minutes and the socket outlives it. As a
       * fixed object this sent the token the connection was opened with
       * forever, so a socket that dropped after expiry reconnected with a dead
       * token and retried it until the app was killed. As a callback each
       * attempt — first connect and every reconnect — presents whatever the
       * auth layer holds now.
       */
      auth: (cb) => cb({ token: getAccessToken(), protocolVersion: PROTOCOL_VERSION }),
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      timeout: 8000,
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('connect_error', (err) => {
      setConnected(false);
      const code = err?.data?.code;
      if (code === ERROR_CODE.PROTOCOL_UNSUPPORTED) {
        // tech.md §16 — an explicit upgrade prompt, never a silent failure.
        patch({ error: { code, message: 'Update the app to keep playing.' } });
      } else if (code === ERROR_CODE.TOKEN_EXPIRED || code === ERROR_CODE.UNAUTHENTICATED) {
        // Refreshing then reconnecting is handled by the auth layer; a single
        // ping through the API is enough to trigger it.
        request('/auth/session').catch(() => {});
      }
    });

    // ── Protocol ───────────────────────────────────────────────────────────

    socket.on(S2C.QUEUE_SEARCHING, (payload) =>
      patch({ status: 'searching', topic: { ...payload }, error: null }),
    );

    socket.on(S2C.MATCH_FOUND, (payload) => {
      // A heavy haptic and the bed fading in ARE the announcement — the
      // fanfare stinger on top of both was one voice too many.
      heavy();
      // The battle bed starts the moment a rival exists and runs under the
      // whole match — versus, every round, every verdict banner.
      music.battle();
      patch({
        status: 'found',
        matchId: payload.matchId,
        topic: payload.topic,
        you: payload.you,
        opponent: payload.opponent,
        headToHead: payload.headToHead,
        totalRounds: payload.totalRounds,
        durationMs: payload.roundDurationMs,
        // The server states the mode it actually started, which is the one
        // that will be finalized — a rematch, for one, does not necessarily
        // carry the mode that was queued for.
        mode: asMode(payload.mode),
        contestId: payload.contestId ?? null,
        scores: { you: 0, opponent: 0 },
        roundIndex: -1,
        result: null,
        roundResult: null,
        yourAnswer: null,
        opponentConnected: true,
        error: null,
      });
    });

    socket.on(S2C.MATCH_START, (payload) =>
      patch({
        status: 'countdown',
        countdownMs: payload.countdownMs,
        startsAt: payload.startsAt,
        serverOffsetMs: Date.now() - payload.serverNow,
      }),
    );

    socket.on(S2C.ROUND_START, (payload) => {
      patch({
        status: 'playing',
        roundIndex: payload.roundIndex,
        totalRounds: payload.totalRounds,
        question: payload.question,
        options: payload.question.options,
        durationMs: payload.durationMs,
        startedAt: payload.startedAt,
        // Local clocks drift. Everything the countdown draws is derived from
        // the server's `startedAt` corrected by this offset.
        serverOffsetMs: Date.now() - payload.serverNow,
        yourAnswer: null,
        opponentAnswered: false,
        roundResult: null,
        scores: payload.scores ?? { you: 0, opponent: 0 },
      });
    });

    // prd.md F6.4.9 — you learn *that* they answered, never what they chose.
    socket.on(S2C.ROUND_OPPONENT_ANSWERED, () => {
      tap();
      patch({ opponentAnswered: true });
    });

    socket.on(S2C.ROUND_RESULT, (payload) => {
      const correct = payload.you.optionIndex === payload.correctIndex;
      if (payload.you.optionIndex !== null) {
        (correct ? success : failure)();
        (correct ? sfx.correct : sfx.wrong)();
      }
      patch({
        status: 'resolved',
        roundResult: payload,
        scores: payload.scores,
      });
    });

    socket.on(S2C.MATCH_END, (payload) => {
      // The bed fades first so the verdict stinger lands on near-silence.
      music.stop();
      if (payload.verdict === 'won') sfx.win();
      else if (payload.verdict === 'lost') sfx.lose();
      patch({ status: 'finished', result: payload, scores: payload.scores });
    });

    socket.on(S2C.MATCH_OPPONENT_LEFT, () => patch({ opponentConnected: false }));
    socket.on(S2C.MATCH_OPPONENT_REJOINED, () => patch({ opponentConnected: true }));

    // Reconnected mid-match: the server sends the current round with remaining
    // time recomputed from its own clock (tech.md §9.7). The snapshot carries
    // no mode, so the one already in hand is kept — it was set when the queue
    // was joined and confirmed by `match:found`.
    socket.on(C2S.MATCH_RESUME, (snapshot) => {
      if (!snapshot?.matchId) return;
      music.battle();
      patch({
        status: snapshot.state === MATCH_STATE.ROUND_ACTIVE ? 'playing' : 'found',
        matchId: snapshot.matchId,
        topic: snapshot.topic,
        opponent: snapshot.opponent,
        you: snapshot.you,
        roundIndex: snapshot.roundIndex,
        totalRounds: snapshot.totalRounds,
        question: snapshot.question ?? null,
        options: snapshot.question?.options ?? [],
        durationMs: snapshot.durationMs ?? 10_000,
        startedAt: snapshot.startedAt ?? null,
        serverOffsetMs: Date.now() - snapshot.serverNow,
        scores: snapshot.scores,
        yourAnswer: snapshot.youAnswered ? { pending: true } : null,
        opponentAnswered: Boolean(snapshot.opponentAnswered),
        opponentConnected: snapshot.opponent?.connected !== false,
      });
    });

    socket.on(S2C.ERROR, (payload) => {
      music.stop();
      patch({ error: payload, status: 'idle' });
    });

    socketRef.current = socket;
    return socket;
  }, [patch]);

  const disconnect = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    setConnected(false);
  }, []);

  /**
   * Coming back from the background reconnects immediately rather than waiting
   * for the socket's own backoff — a player who alt-tabbed for four seconds
   * has a ten-second grace window and every one of them counts.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && socketRef.current && !socketRef.current.connected) {
        socketRef.current.connect();
      }
    });
    return () => sub.remove();
  }, []);

  /**
   * The socket belongs to an account, not to the app.
   *
   * Its identity is fixed at the handshake and the server keeps it for the life
   * of the connection, so signing out and in as somebody else has to end the
   * connection — nothing else can change who the server thinks is on the other
   * end. Without this, `connect()` found a live socket and handed it straight
   * back (it only ever checked that one was *connected*, never whose), and the
   * new account played the whole session as the old one: `queue:join`
   * attributed to the previous user, both accounts sharing that user's
   * `user:<id>` room, and therefore the same match and the same opponent
   * delivered to both phones — while `/me` on each showed the right name, which
   * is what makes it look like a display bug rather than an identity one.
   */
  const identity = user?.id ?? null;
  useEffect(() => {
    socketRef.current?.close();
    socketRef.current = null;
    setConnected(false);
    setState(idleState(preferredModeRef.current));
  }, [identity]);

  useEffect(() => () => socketRef.current?.close(), []);

  // ── Actions ──────────────────────────────────────────────────────────────

  /**
   * The player's choice of mode (leagues-and-progression.md §1), kept for the
   * session. Quick and ranked are the only two a player can pick; anything
   * else falls back to ranked, which is the default everywhere.
   */
  const selectMode = useCallback(
    (mode) => {
      const chosen = CHOOSABLE_MODES.includes(mode) ? mode : MATCH_MODE.RANKED;
      preferredModeRef.current = chosen;
      patch({ preferredMode: chosen });
      return chosen;
    },
    [patch],
  );

  const joinQueue = useCallback(
    (topicId, { spaceId, mode, challengeId } = {}) => {
      /**
       * A friend challenge decides its own terms.
       *
       * The server reads the topic and the mode off the challenge row and
       * ignores whatever else is in this frame, so sending a chosen mode with
       * one would only invite the two ends to disagree. It is set locally so
       * the result screen knows immediately that no ladder moved.
       */
      const chosen = challengeId
        ? MATCH_MODE.CHALLENGE
        : mode === undefined
          ? preferredModeRef.current
          : asMode(mode);
      if (CHOOSABLE_MODES.includes(chosen)) preferredModeRef.current = chosen;

      const socket = socketRef.current?.connected ? socketRef.current : connect();
      patch({
        status: 'searching',
        error: null,
        result: null,
        contestId: null,
        mode: chosen,
        preferredMode: preferredModeRef.current,
      });
      socket.emit(
        C2S.QUEUE_JOIN,
        challengeId ? { challengeId } : { topicId, spaceId, mode: chosen },
        (ack) => {
          if (ack && ack.ok === false) {
            patch({ status: 'idle', error: { code: ack.code, message: ack.message } });
          }
        },
      );
    },
    [connect, patch],
  );

  const leaveQueue = useCallback(() => {
    socketRef.current?.emit(C2S.QUEUE_LEAVE, {});
    music.stop();
    setState(idleState(preferredModeRef.current));
  }, []);

  /**
   * prd.md F7.5 — enter a contest.
   *
   * By contest id, never by topic: the paper belongs to the contest, and so
   * does eligibility. The ack carries the reason on failure, and each reason is
   * a different thing the student can do about it — already entered, not open
   * yet, closed, wrong batch.
   */
  const enterContest = useCallback(
    (contestId) =>
      new Promise((resolve) => {
        const socket = socketRef.current?.connected ? socketRef.current : connect();
        if (!socket) {
          resolve({ ok: false, message: 'Lost connection. Reconnecting.' });
          return;
        }
        // A contest is its own mode: XP only, its own standings, and never a
        // move on the ladder (leagues-and-progression.md §6).
        patch({ status: 'searching', error: null, result: null, contestId, mode: MATCH_MODE.CONTEST });
        socket.emit(C2S.CONTEST_ENTER, { contestId }, (ack) => {
          if (ack && ack.ok === false) {
            patch({ status: 'idle', error: { code: ack.code, message: ack.message } });
          }
          resolve(ack ?? { ok: false });
        });
      }),
    [connect, patch],
  );

  /**
   * prd.md §13 — "Answering feels instant." The local prediction is drawn on
   * the same frame as the tap; the server's authoritative points arrive in the
   * ack and replace it. They always agree, because both run src/shared.
   */
  const answer = useCallback(
    (optionIndex) => {
      const s = stateRef.current;
      if (s.status !== 'playing' || s.yourAnswer) return;

      tap();
      sfx.tap();
      const elapsedMs = Math.max(0, Date.now() - s.serverOffsetMs - s.startedAt);
      const predicted = scoreAnswer({ isCorrect: true, elapsedMs, durationMs: s.durationMs });

      patch({ yourAnswer: { optionIndex, elapsedMs, predictedPoints: predicted } });

      socketRef.current?.emit(
        C2S.MATCH_ANSWER,
        { matchId: s.matchId, roundIndex: s.roundIndex, optionIndex },
        (ack) => {
          if (ack?.ok === false) {
            // Rejected — usually the round already resolved on the server clock.
            patch({ yourAnswer: null, error: { code: ack.code, message: ack.message } });
          }
        },
      );
    },
    [patch],
  );

  /** prd.md — "Leave now and you forfeit." The copy says so before this runs. */
  const forfeit = useCallback(() => {
    const s = stateRef.current;
    if (s.matchId) socketRef.current?.emit(C2S.MATCH_LEAVE, { matchId: s.matchId });
    music.stop();
    setState(idleState(preferredModeRef.current));
  }, []);

  /** The mode of a rematch is the server's to decide; `match:found` says so. */
  const rematch = useCallback(() => {
    const s = stateRef.current;
    if (!s.result?.matchId) return;
    patch({ status: 'searching', error: null });
    socketRef.current?.emit(C2S.MATCH_REMATCH, { matchId: s.result.matchId }, (ack) => {
      if (ack?.ok === false) patch({ status: 'idle', error: { code: ack.code, message: ack.message } });
    });
  }, [patch]);

  const reset = useCallback(() => {
    music.stop();
    setState(idleState(preferredModeRef.current));
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      connected,
      /** Whether the match in hand moves the ranked rating and the league. */
      isRanked: RATED_MODES.includes(state.mode),
      connect,
      disconnect,
      selectMode,
      joinQueue,
      leaveQueue,
      enterContest,
      answer,
      forfeit,
      rematch,
      reset,
    }),
    [state, connected, connect, disconnect, selectMode, joinQueue, leaveQueue, enterContest, answer, forfeit, rematch, reset],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used inside GameProvider');
  return ctx;
}

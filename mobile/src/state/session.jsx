import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useGame } from './game.jsx';
import { C2S, S2C } from '../shared/protocol.js';

/**
 * The client half of a live class session.
 *
 * ── Why this rides on the game socket ────────────────────────────────────────
 *
 * A second socket would mean a second handshake, a second auth, a second
 * reconnect policy and two connections open in a classroom on school wifi — for a
 * feature whose whole problem is thirty phones on one access point. The game
 * socket is already open the entire time a player is signed in (see game.jsx), so
 * a session is a set of events on it rather than a connection of its own.
 *
 * ── One state object, replaced wholesale ─────────────────────────────────────
 *
 * Every server frame here is a complete answer — the roster, the question, the
 * results, the board. Merging them into per-field state would let a late frame
 * overwrite half of a newer one, which in a classroom shows up as one phone stuck
 * on question three. So each frame replaces the slice it owns, and the join ack
 * carries a full snapshot that a reconnecting phone can be dropped straight into.
 */

const SessionContext = createContext(null);

const IDLE = {
  status: 'idle',
  sessionId: null,
  code: null,
  name: null,
  isHost: false,
  roster: [],
  board: [],
  roundIndex: -1,
  totalRounds: 0,
  question: null,
  /** Set once this phone has answered the question on screen. */
  answered: false,
  result: null,
  answeredCount: 0,
  error: null,
};

export function SessionProvider({ children }) {
  const game = useGame();
  const [state, setState] = useState(IDLE);
  const patch = useCallback((next) => setState((s) => ({ ...s, ...next })), []);
  const sessionRef = useRef(null);

  useEffect(() => {
    sessionRef.current = state.sessionId;
  }, [state.sessionId]);

  /**
   * Bound once, for the life of the app.
   *
   * `game.socket` is the live socket; the handlers below ignore any frame whose
   * `sessionId` is not the one this phone is in, which is what keeps a stale
   * broadcast from a lesson that has ended out of a lesson that has not.
   */
  useEffect(() => {
    const socket = game.socket;
    if (!socket) return undefined;

    const mine = (payload) =>
      !sessionRef.current || String(payload?.sessionId) === String(sessionRef.current);

    const onRoster = (payload) => {
      if (!mine(payload)) return;
      patch({ roster: payload.roster ?? [] });
    };

    const onRound = (payload) => {
      if (!mine(payload)) return;
      patch({
        status: 'question',
        roundIndex: payload.roundIndex,
        totalRounds: payload.totalRounds,
        question: payload.question,
        // The clock the server started, not one this phone starts on receipt —
        // a phone that got the frame 300ms late must not get 300ms extra.
        durationMs: payload.durationMs,
        startedAt: payload.startedAt,
        answered: false,
        answeredCount: 0,
        result: null,
      });
    };

    const onAnswered = (payload) => {
      if (!mine(payload)) return;
      patch({ answeredCount: payload.answered, rosterSize: payload.total });
    };

    const onResult = (payload) => {
      if (!mine(payload)) return;
      patch({
        status: 'result',
        result: payload,
        board: payload.board ?? [],
      });
    };

    const onEnded = (payload) => {
      if (!mine(payload)) return;
      patch({ status: 'ended', board: payload.board ?? [], question: null, result: null });
    };

    socket.on(S2C.SESSION_ROSTER, onRoster);
    socket.on(S2C.SESSION_ROUND, onRound);
    socket.on(S2C.SESSION_ANSWERED, onAnswered);
    socket.on(S2C.SESSION_ROUND_RESULT, onResult);
    socket.on(S2C.SESSION_ENDED, onEnded);

    return () => {
      socket.off(S2C.SESSION_ROSTER, onRoster);
      socket.off(S2C.SESSION_ROUND, onRound);
      socket.off(S2C.SESSION_ANSWERED, onAnswered);
      socket.off(S2C.SESSION_ROUND_RESULT, onResult);
      socket.off(S2C.SESSION_ENDED, onEnded);
    };
  }, [game.socket, patch]);

  /** Adopt a full snapshot — used by join and by any reconnect. */
  const adopt = useCallback(
    (snapshot) => {
      if (!snapshot) return;
      patch({
        status: snapshot.question ? 'question' : snapshot.status === 'ended' ? 'ended' : 'lobby',
        sessionId: snapshot.sessionId,
        code: snapshot.code,
        name: snapshot.name,
        isHost: snapshot.isHost,
        roster: snapshot.roster ?? [],
        board: snapshot.board ?? [],
        roundIndex: snapshot.roundIndex,
        totalRounds: snapshot.totalRounds,
        question: snapshot.question,
        durationMs: snapshot.question?.durationMs,
        // A phone joining ten seconds into a question gets what is LEFT.
        startedAt: snapshot.question
          ? Date.now() - (snapshot.question.durationMs - snapshot.question.remainingMs)
          : null,
        answered: Boolean(snapshot.question?.youAnswered),
        error: null,
      });
    },
    [patch],
  );

  const join = useCallback(
    (code) =>
      new Promise((resolve) => {
        const socket = game.socket;
        if (!socket) {
          patch({ error: { message: 'Not connected. Try again in a moment.' } });
          return resolve(false);
        }
        socket.emit(C2S.SESSION_JOIN, { code: String(code ?? '').toUpperCase().trim() }, (ack) => {
          if (ack?.ok === false) {
            patch({ error: { code: ack.code, message: ack.message } });
            return resolve(false);
          }
          adopt(ack?.snapshot);
          return resolve(true);
        });
      }),
    [game.socket, patch, adopt],
  );

  const answer = useCallback(
    (optionIndex) => {
      const socket = game.socket;
      if (!socket || !state.sessionId || state.answered) return;
      // Marked answered immediately rather than on the ack: the class is racing a
      // clock, and a button that stays live for another round trip gets pressed
      // twice.
      patch({ answered: true });
      socket.emit(C2S.SESSION_ANSWER, {
        sessionId: state.sessionId,
        roundIndex: state.roundIndex,
        optionIndex,
      });
    },
    [game.socket, state.sessionId, state.roundIndex, state.answered, patch],
  );

  const hostAction = useCallback(
    (event) => {
      const socket = game.socket;
      if (!socket || !state.sessionId) return;
      socket.emit(event, { sessionId: state.sessionId });
    },
    [game.socket, state.sessionId],
  );

  const leave = useCallback(() => {
    game.socket?.emit(C2S.SESSION_LEAVE, { sessionId: state.sessionId });
    setState(IDLE);
  }, [game.socket, state.sessionId]);

  const value = useMemo(
    () => ({
      ...state,
      join,
      adopt,
      answer,
      leave,
      start: () => hostAction(C2S.SESSION_START),
      next: () => hostAction(C2S.SESSION_NEXT),
      end: () => hostAction(C2S.SESSION_END),
      clearError: () => patch({ error: null }),
    }),
    [state, join, adopt, answer, leave, hostAction, patch],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

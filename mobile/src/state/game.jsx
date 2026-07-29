import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { AppState } from 'react-native';
import { BASE_URL, getAccessToken, request } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import {
  C2S,
  S2C,
  GAME_NAMESPACE,
  PROTOCOL_VERSION,
  ERROR_CODE,
  TRANSIENT_ERROR_CODES,
} from '../shared/protocol.js';
import { roundMultiplier, scoreAnswer } from '../shared/scoring.js';
import { MATCH_MODE, MATCH_STATE, RATED_MODES } from '../shared/constants.js';
import { tap, success, failure, heavy } from '../lib/haptics.js';
import { music, sfx } from '../lib/sound.js';
import { publish } from '../lib/liveEvents.js';

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

/**
 * How long to wait for `match:end` after forfeiting before giving up and going
 * home. The server replies in milliseconds; this only catches a socket that
 * died between the emit and the reply.
 */
const LEAVE_RESULT_TIMEOUT_MS = 6_000;

/**
 * Last-resort watchdogs on the search.
 *
 * The server owns the real deadlines — a ghost at 8s and a sweep at 30s
 * (constants.js) — so in a healthy system neither of these ever fires. They
 * exist because when the reply that ends the search goes missing, for any
 * reason at all, the failure mode is the worst one available: a screen that
 * looks busy for ever and reports nothing. A watchdog turns that into an error
 * with a retry, which is recoverable and, unlike an endless spinner, gets
 * reported.
 *
 * The challenge window is far longer on purpose. A challenge refuses ghosts and
 * the server lets it wait five minutes for the other person, so anything
 * shorter here would cut off a wait that is working exactly as designed.
 */
const SEARCH_WATCHDOG_MS = 35_000;
const CHALLENGE_SEARCH_WATCHDOG_MS = 330_000;

/**
 * How long to wait for the other player to take up a rematch.
 *
 * The server drops the request after 30 seconds and says nothing when it does
 * — there is no "they never answered" event to listen for — so without this the
 * searching screen spins for ever on a rematch nobody accepted. Slightly longer
 * than the server's own window, so the server's answer always wins a race with
 * the watchdog.
 */
const REMATCH_WATCHDOG_MS = 34_000;

/**
 * Statuses in which a match is on the board.
 *
 * A rejected action must not tear one of these down — see
 * TRANSIENT_ERROR_CODES. Checked instead of `matchId`, which outlives the match
 * itself: it is still set on the result screen, and a rate limit hit while
 * queueing for the NEXT match has to be surfaced rather than swallowed.
 */
const LIVE_MATCH_STATUSES = ['found', 'countdown', 'playing', 'resolved'];

const INITIAL = {
  // idle | searching | found | countdown | playing | resolved | leaving | finished
  status: 'idle',
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
  /**
   * Set when THIS player quit, from the moment `match:leave` is sent until the
   * result lands. The result screen reads it to say who walked: the server's
   * `forfeitedBy` names the quitter, but a ghost match or a dropped payload can
   * leave it unset, and a player who just pressed "Leave and forfeit" should
   * never be told they simply lost.
   */
  forfeitedByYou: false,
  /** Set for the duration of a contest entry (prd.md F7.5). */
  contestId: null,
  /**
   * An invitation from the other player to go again, or null. The result
   * screen turns it into a prompt; accepting it sends our own `match:rematch`,
   * which is what completes the server's two-sided handshake.
   */
  rematchInvite: null,
  /** True while OUR rematch request is outstanding and unanswered. */
  rematchPending: false,
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
  /** Guards the wait for `match:end` after a forfeit — see `forfeit` below. */
  const leaveTimerRef = useRef(null);
  /**
   * What was last queued for, and whether the connection dropped while it was
   * still outstanding.
   *
   * The server removes a waiting player from the pool the moment their last
   * socket goes (`handleDisconnect` → `matchmaker.leave`), and a live MATCH is
   * restored on reconnect but a queue POSITION is not — nothing re-queues, and
   * nothing tells the app it is no longer waiting for anything. On a mobile
   * network that is a routine event, and its symptom is the searching screen
   * spinning for ever: the band caption widens on a client-side timer, so it
   * goes on looking busy long after the server has forgotten the player.
   *
   * `queueLostRef` is what keeps the repair honest. Re-joining on every
   * `connect` would double-join on the FIRST one, because `joinQueue` emits
   * through a socket that has not finished connecting yet — so the re-join
   * only fires when a disconnect was actually seen while searching.
   */
  const queueRequestRef = useRef(null);
  const queueLostRef = useRef(false);
  /** The search watchdog — see SEARCH_WATCHDOG_MS. */
  const searchTimerRef = useRef(null);
  /** The rematch watchdog — see REMATCH_WATCHDOG_MS. */
  const rematchTimerRef = useRef(null);
  const patch = useCallback((next) => setState((s) => ({ ...s, ...next })), []);

  useEffect(
    () => () => {
      clearTimeout(leaveTimerRef.current);
      clearTimeout(searchTimerRef.current);
      clearTimeout(rematchTimerRef.current);
    },
    [],
  );

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

    socket.on('connect', () => {
      setConnected(true);
      // The queue was dropped server-side while this socket was away. Ask for
      // the place back rather than sitting on a screen that is waiting for an
      // event nobody is going to send.
      if (queueLostRef.current && stateRef.current.status === 'searching') {
        queueLostRef.current = false;
        const again = queueRequestRef.current;
        if (again) {
          socket.emit(C2S.QUEUE_JOIN, again, (ack) => {
            if (ack && ack.ok === false) {
              patch({ status: 'idle', error: { code: ack.code, message: ack.message } });
            }
          });
        }
      }
    });
    socket.on('disconnect', () => {
      setConnected(false);
      if (stateRef.current.status === 'searching') queueLostRef.current = true;
    });

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
      // The search is over, so there is no place left to ask back for and
      // nothing for either watchdog to catch.
      clearTimeout(searchTimerRef.current);
      clearTimeout(rematchTimerRef.current);
      queueRequestRef.current = null;
      queueLostRef.current = false;
      // A heavy haptic and the bed fading in ARE the announcement — the
      // fanfare stinger on top of both was one voice too many.
      heavy();
      // The battle bed starts the moment a rival exists and runs under the
      // whole match — versus, every round, every verdict banner.
      music.battle();
      patch({
        status: 'found',
        matchId: payload.matchId,
        /**
         * Cleared here, not on the way out of the last match. A rematch and a
         * contest entry both `patch` their way into `searching` without going
         * through idle, so a flag set by quitting one match survived into the
         * next — and if the OPPONENT then quit that one, the result screen read
         * the stale flag and told the wrong player they had left. A new match
         * in hand is the one moment every path passes through.
         */
        forfeitedByYou: false,
        rematchInvite: null,
        rematchPending: false,
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
      // The result arrived, so the forfeit escape hatch is no longer needed.
      clearTimeout(leaveTimerRef.current);
      // The bed fades first so the verdict stinger lands on near-silence.
      music.stop();
      if (payload.verdict === 'won') sfx.win();
      else if (payload.verdict === 'lost') sfx.lose();
      patch({ status: 'finished', result: payload, scores: payload.scores });
    });

    socket.on(S2C.MATCH_OPPONENT_LEFT, () => patch({ opponentConnected: false }));
    socket.on(S2C.MATCH_OPPONENT_REJOINED, () => patch({ opponentConnected: true }));

    /**
     * They want to go again. The result screen turns this into a prompt, which
     * is the whole point: the handshake needs both sides to ask, and until this
     * event existed the second side was never told there was anything to
     * answer.
     */
    socket.on(S2C.MATCH_REMATCH_REQUESTED, (payload) => {
      if (!payload?.matchId) return;
      tap();
      patch({ rematchInvite: { matchId: payload.matchId, from: payload.from ?? null } });
    });

    // Declined, or the window closed. Either way there is nothing to wait for.
    socket.on(S2C.MATCH_REMATCH_DECLINED, () => {
      clearTimeout(rematchTimerRef.current);
      patch({
        rematchInvite: null,
        rematchPending: false,
        // Only pull the player out of the wait if that is what they are doing.
        ...(stateRef.current.status === 'searching' && stateRef.current.result
          ? { status: 'finished' }
          : {}),
      });
    });

    // Reconnected mid-match: the server sends the current round with remaining
    // time recomputed from its own clock (tech.md §9.7). The snapshot carries
    // no mode, so the one already in hand is kept — it was set when the queue
    // was joined and confirmed by `match:found`.
    socket.on(S2C.MATCH_RESUME, (snapshot) => {
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

    /**
     * The inbox, live. Republished rather than handled here: a friend request
     * is not match state, and the banner that shows it has nothing to do with
     * this provider beyond sharing the socket it arrives on.
     */
    socket.on(S2C.NOTIFICATION, (payload) => publish(S2C.NOTIFICATION, payload));

    socket.on(S2C.ERROR, (payload) => {
      /**
       * A rejected action is not a dead match. With one on the board these are
       * already settled by the ack for the same action — the round plays on
       * under the server's clock and `round:result` states what it scored.
       */
      if (
        TRANSIENT_ERROR_CODES.includes(payload?.code) &&
        LIVE_MATCH_STATUSES.includes(stateRef.current.status)
      ) {
        return;
      }
      // The server has spoken, so neither the watchdog nor the re-join should
      // fire on top of it.
      clearTimeout(searchTimerRef.current);
      queueRequestRef.current = null;
      queueLostRef.current = false;
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
   * Hold the connection open for as long as somebody is signed in.
   *
   * It used to be opened by `joinQueue` and closed when the match ended, which
   * meant the app's only live channel existed exclusively during a match — so
   * anything the server wanted to say to a player who was simply USING the app
   * (a friend request, a challenge, a contest opening) had nowhere to land. The
   * socket already reconnects with backoff and re-authenticates on every
   * handshake, so keeping it up costs a heartbeat and buys every live feature.
   */
  useEffect(() => {
    if (!user?.id) return;
    connect();
  }, [user?.id, connect]);

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
    // Every other teardown stops the bed; this one used to leave it looping
    // over the sign-in screen until the app was killed.
    music.stop();
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
      // Remembered so a reconnect can ask for the place back — see the refs.
      const request = challengeId ? { challengeId } : { topicId, spaceId, mode: chosen };
      queueRequestRef.current = request;
      queueLostRef.current = false;

      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(
        () => {
          if (stateRef.current.status !== 'searching') return;
          queueRequestRef.current = null;
          socketRef.current?.emit(C2S.QUEUE_LEAVE, {});
          setState({
            ...idleState(preferredModeRef.current),
            error: {
              code: ERROR_CODE.NO_OPPONENT_FOUND,
              message: 'That search stopped responding. Try again.',
            },
          });
        },
        challengeId ? CHALLENGE_SEARCH_WATCHDOG_MS : SEARCH_WATCHDOG_MS,
      );

      socket.emit(C2S.QUEUE_JOIN, request, (ack) => {
        if (ack && ack.ok === false) {
          clearTimeout(searchTimerRef.current);
          queueRequestRef.current = null;
          patch({ status: 'idle', error: { code: ack.code, message: ack.message } });
        }
      });
    },
    [connect, patch],
  );

  const leaveQueue = useCallback(() => {
    socketRef.current?.emit(C2S.QUEUE_LEAVE, {});
    clearTimeout(searchTimerRef.current);
    clearTimeout(rematchTimerRef.current);
    queueRequestRef.current = null;
    queueLostRef.current = false;
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
      const predicted = scoreAnswer({
        isCorrect: true,
        elapsedMs,
        durationMs: s.durationMs,
        multiplier: roundMultiplier(s.roundIndex, s.totalRounds),
      });

      patch({ yourAnswer: { optionIndex, elapsedMs, predictedPoints: predicted } });

      socketRef.current?.emit(
        C2S.MATCH_ANSWER,
        { matchId: s.matchId, roundIndex: s.roundIndex, optionIndex },
        (ack) => {
          if (ack?.ok !== false) return;
          /**
           * Rejected — usually the round already resolved on the server clock.
           * The prediction goes, but the match stays: `round:result` is on its
           * way and states what the round actually scored. Only a rejection
           * that is NOT one of the routine ones is worth showing.
           */
          patch(
            TRANSIENT_ERROR_CODES.includes(ack.code)
              ? { yourAnswer: null }
              : { yourAnswer: null, error: { code: ack.code, message: ack.message } },
          );
        },
      );
    },
    [patch],
  );

  /**
   * prd.md — "Leave now and you forfeit." The copy says so before this runs.
   *
   * The match is NOT torn down here. It used to be: this reset straight to idle
   * and the screen sent the player home, so the one person in the match who had
   * been told their rating would drop was the only one who never saw it happen
   * — the `match:end` the server sends them landed on a state that had already
   * forgotten there was a match. Now the quit is announced and the same result
   * screen the winner gets is shown, with the rating change on it.
   *
   * The timer is the escape hatch. `match:end` normally arrives in well under a
   * second, but a socket that dies between the emit and the reply would
   * otherwise strand the player on a board they can no longer play.
   */
  const forfeit = useCallback(() => {
    const s = stateRef.current;
    if (!s.matchId) {
      setState(idleState(preferredModeRef.current));
      return;
    }
    socketRef.current?.emit(C2S.MATCH_LEAVE, { matchId: s.matchId });
    music.stop();
    patch({ status: 'leaving', forfeitedByYou: true });
    clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = setTimeout(() => {
      if (stateRef.current.status === 'leaving') setState(idleState(preferredModeRef.current));
    }, LEAVE_RESULT_TIMEOUT_MS);
  }, [patch]);

  /**
   * The mode of a rematch is the server's to decide; `match:found` says so.
   *
   * Both sides have to ask. Asking first only sends an invitation, so this
   * arms a watchdog: the server drops the request after REMATCH_WINDOW_MS and
   * says so, but a reply that goes missing would otherwise leave the searching
   * screen spinning for ever with no timeout and no way back but Cancel.
   */
  const rematch = useCallback(() => {
    const s = stateRef.current;
    const matchId = s.rematchInvite?.matchId ?? s.result?.matchId;
    if (!matchId) return;
    patch({ status: 'searching', error: null, rematchInvite: null, rematchPending: true });

    clearTimeout(rematchTimerRef.current);
    rematchTimerRef.current = setTimeout(() => {
      if (!stateRef.current.rematchPending) return;
      socketRef.current?.emit(C2S.QUEUE_LEAVE, {});
      patch({
        rematchPending: false,
        status: stateRef.current.result ? 'finished' : 'idle',
        error: {
          code: ERROR_CODE.NO_OPPONENT_FOUND,
          message: 'They did not take up the rematch.',
        },
      });
    }, REMATCH_WATCHDOG_MS);

    socketRef.current?.emit(C2S.MATCH_REMATCH, { matchId }, (ack) => {
      if (ack?.ok === false) {
        clearTimeout(rematchTimerRef.current);
        patch({
          status: stateRef.current.result ? 'finished' : 'idle',
          rematchPending: false,
          error: { code: ack.code, message: ack.message },
        });
      }
    });
  }, [patch]);

  /**
   * Turn down an invitation, or take back one of our own. Either way the
   * server has to hear it — a request left standing is one the other side can
   * still accept, which drops this player into a match they are not on a
   * screen for.
   */
  const declineRematch = useCallback(() => {
    clearTimeout(rematchTimerRef.current);
    socketRef.current?.emit(C2S.QUEUE_LEAVE, {});
    patch({ rematchInvite: null, rematchPending: false });
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
      declineRematch,
      reset,
    }),
    [state, connected, connect, disconnect, selectMode, joinQueue, leaveQueue, enterContest, answer, forfeit, rematch, declineRematch, reset],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used inside GameProvider');
  return ctx;
}

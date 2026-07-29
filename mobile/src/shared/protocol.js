/**
 * Socket protocol (tech.md §7).
 *
 * MIRRORED FILE — identical copy at mobile/src/shared/protocol.js.
 *
 * tech.md §16: anything touching this file requires a binary release and a
 * version gate. The server rejects protocol versions it no longer supports
 * with an explicit upgrade prompt rather than a silent failure.
 */

/**
 * Bump on any change to an event name or payload shape.
 *
 * **2** — Phase 3. Adds `contest:enter`, and two fields on `match:end`
 * (`contest`, `assignmentsCompleted`). Both are additive: a version-1 client
 * never sends the new event and ignores the new fields, so it keeps playing
 * exactly as before. That is why the minimum stays at 1 rather than moving in
 * step — the gate exists to refuse clients the server can no longer serve, and
 * a version-1 client is still perfectly serveable.
 *
 * **3** — Adds `match:rematch_requested` and `match:rematch_declined`. The
 * invitation used to ride on `match:opponent_rejoined` with a flag, which the
 * client's handler for that event discarded, so nobody was ever asked. Also
 * additive: an older client simply never hears the invitation, which is
 * precisely what it did before.
 *
 * **4** — Adds `notification`. The in-app inbox existed and the only way to
 * learn anything had arrived was to open Home and notice the bell had changed,
 * so a friend request sent while you were on any other screen was invisible
 * until you went looking. Additive again: a client that does not listen simply
 * keeps reading the inbox the old way.
 */
export const PROTOCOL_VERSION = 4;
/** Oldest client the server will still talk to. */
export const MIN_SUPPORTED_PROTOCOL_VERSION = 1;

export const GAME_NAMESPACE = '/game';

/** Client → server. */
export const C2S = {
  QUEUE_JOIN: 'queue:join',
  QUEUE_LEAVE: 'queue:leave',
  MATCH_ANSWER: 'match:answer',
  MATCH_LEAVE: 'match:leave',
  MATCH_REMATCH: 'match:rematch',
  MATCH_RESUME: 'match:resume',
  /** prd.md F7.5 — entered by contest id, never by topic. Protocol v2. */
  CONTEST_ENTER: 'contest:enter',
};

/** Server → client. */
export const S2C = {
  QUEUE_SEARCHING: 'queue:searching',
  MATCH_FOUND: 'match:found',
  MATCH_START: 'match:start',
  ROUND_START: 'round:start',
  ROUND_OPPONENT_ANSWERED: 'round:opponent_answered',
  ROUND_RESULT: 'round:result',
  MATCH_END: 'match:end',
  MATCH_OPPONENT_LEFT: 'match:opponent_left',
  MATCH_OPPONENT_REJOINED: 'match:opponent_rejoined',
  /** The other player wants to go again, and is waiting on an answer. */
  MATCH_REMATCH_REQUESTED: 'match:rematch_requested',
  /** They declined, or the window closed. Either way, stop waiting. */
  MATCH_REMATCH_DECLINED: 'match:rematch_declined',
  /**
   * The mid-match resume snapshot, pushed on reconnect.
   *
   * The same wire string as `C2S.MATCH_RESUME`, deliberately: the client may
   * ASK for a snapshot and the server may PUSH one, and they are the same
   * message in opposite directions. It exists so the push reads as a push —
   * it was previously emitted through the C2S constant, which is a trap for
   * the next person to touch the protocol.
   */
  MATCH_RESUME: 'match:resume',
  /**
   * Something landed in the inbox, right now.
   *
   * The same row `GET /me/notifications` returns, pushed the moment it is
   * written, so the app can surface it wherever the player happens to be
   * standing rather than waiting to be visited.
   */
  NOTIFICATION: 'notification',
  ERROR: 'error',
};

/**
 * Error codes carried on the `error` event. The client keys its recovery off
 * these, never off the message string.
 */
export const ERROR_CODE = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  PROTOCOL_UNSUPPORTED: 'PROTOCOL_UNSUPPORTED',
  NOT_A_MEMBER: 'NOT_A_MEMBER',
  TOPIC_UNAVAILABLE: 'TOPIC_UNAVAILABLE',
  TOPIC_NOT_LIVE: 'TOPIC_NOT_LIVE',
  ALREADY_QUEUED: 'ALREADY_QUEUED',
  ALREADY_IN_MATCH: 'ALREADY_IN_MATCH',
  MATCH_NOT_FOUND: 'MATCH_NOT_FOUND',
  ROUND_MISMATCH: 'ROUND_MISMATCH',
  ALREADY_ANSWERED: 'ALREADY_ANSWERED',
  TOO_LATE: 'TOO_LATE',
  RATE_LIMITED: 'RATE_LIMITED',
  BAD_REQUEST: 'BAD_REQUEST',
  /**
   * The queue gave up without an opponent. Only reachable where ghosts are
   * refused — ordinarily F6.4.3 guarantees one arrives — so the client treats
   * it as an ordinary end of the search, not a failure to recover from.
   */
  NO_OPPONENT_FOUND: 'NO_OPPONENT_FOUND',
  /**
   * The queue found the opponent and building the match then failed.
   *
   * Deliberately NOT `NO_OPPONENT_FOUND`: that one is the queue working
   * correctly and having nobody to give, and the client rightly treats it as
   * an ordinary end of the search. This is a fault, the search was not at
   * fault, and trying again immediately is usually the right move — which is
   * only true of one of the two.
   */
  MATCH_START_FAILED: 'MATCH_START_FAILED',

  // Contests (protocol v2). Each one names a different thing the student can
  // do about it, which is why they are distinct codes and not one CONTEST_ERROR.
  CONTEST_NOT_FOUND: 'CONTEST_NOT_FOUND',
  CONTEST_NOT_OPEN: 'CONTEST_NOT_OPEN',
  CONTEST_CLOSED: 'CONTEST_CLOSED',
  CONTEST_CANCELLED: 'CONTEST_CANCELLED',
  CONTEST_NOT_ELIGIBLE: 'CONTEST_NOT_ELIGIBLE',
  CONTEST_ALREADY_ENTERED: 'CONTEST_ALREADY_ENTERED',
  CONTEST_NOT_ENOUGH_QUESTIONS: 'CONTEST_NOT_ENOUGH_QUESTIONS',

  INTERNAL: 'INTERNAL',
};

/**
 * Codes that reject ONE action without ending the match.
 *
 * `error` carries two very different kinds of bad news: the match cannot go on
 * (the topic vanished, the protocol is too old), and this one tap did not count
 * (it landed after the round closed, or a second time). Treating the second
 * kind as fatal is how a tap on the deadline — a routine race, since the rows
 * stay live until `round:result` lands — tore down a live match, sent the
 * player home, and left the server playing the remaining rounds without them.
 *
 * The client keys off this list: while a match is on the board these are
 * ignored, the ack for the same action having already settled the prediction.
 */
export const TRANSIENT_ERROR_CODES = [
  ERROR_CODE.ROUND_MISMATCH,
  ERROR_CODE.ALREADY_ANSWERED,
  ERROR_CODE.TOO_LATE,
  ERROR_CODE.RATE_LIMITED,
];

/**
 * tech.md §7.2, the single most important line in that document:
 * `round:start` never contains `correctIndex`.
 *
 * This list is asserted against in tests/anti-cheat.test.js. Adding a field
 * here that leaks the key will fail CI.
 */
export const ROUND_START_ALLOWED_KEYS = [
  'roundIndex',
  'totalRounds',
  'question',
  'durationMs',
  'startedAt',
  'serverNow',
  'scores',
];

export const QUESTION_PAYLOAD_ALLOWED_KEYS = ['id', 'text', 'imageUrl', 'options'];

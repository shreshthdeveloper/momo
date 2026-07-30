import {
  ROUNDS_PER_MATCH,
  ROUND_DURATION_MS,
  ROUND_RESULT_MS,
  VERSUS_COUNTDOWN_MS,
  NETWORK_GRACE_MS,
  HUMAN_FLOOR_MS,
  DISCONNECT_GRACE_MS,
  MATCH_STATE,
  MATCH_MODE,
  RANKED_START,
} from '../shared/constants.js';
import { roundMultiplier, scoreAnswer, verdictFor } from '../shared/scoring.js';
import { leagueFor, leagueMovement } from '../shared/league.js';
import { progression } from '../services/progressionService.js';
import { S2C, ERROR_CODE } from '../shared/protocol.js';
import { canonicalToShown } from './questionSelector.js';

/**
 * The match engine (tech.md §9).
 *
 * Deliberately has no HTTP or socket awareness — it talks to an injected
 * `transport`. That is what makes extracting the game module in v2 a
 * deployment change rather than a rewrite, and it is what lets the full-match
 * test run without a network.
 *
 * Two rules hold this together:
 *   1. Every transition is driven by a server timer. A client message can only
 *      record an answer; the server decides whether that resolves the round.
 *   2. `correctIndex` is never sent before resolution. tech.md §7.2 calls this
 *      the most important line in the document, and it is enforced by
 *      construction here — `round:start` is built from an explicit field list.
 */

const noopTransport = {
  toPlayer() {},
  toMatch() {},
};

/**
 * The verdict word for one player (design.md §8.8 — Won, Lost, or Draw).
 *
 * `winnerId` is authoritative because it already accounts for forfeits;
 * scores are only consulted when nobody won and nobody quit.
 *
 * A drill has no opponent, so it has no verdict — `'solo'` is tested before
 * `isVoid` because a drill nobody finished is still a drill, and every reward
 * rule downstream keys off this word. See `complete()` for why that matters.
 */
function verdictOf(summary, userId, me, them) {
  if (!them) return 'solo';
  if (summary.isVoid) return 'void';
  if (summary.winnerId) return summary.winnerId === userId ? 'won' : 'lost';
  if (summary.isDraw) return 'draw';
  return verdictFor(me?.score ?? 0, them?.score ?? 0);
}

export class LiveMatch {
  /**
   * @param {object} config
   * @param {string} config.id                 match id (a real ObjectId string)
   * @param {object} config.topic              { id, name, coverUrl }
   * @param {string} config.spaceId
   * @param {Array}  config.rounds             from buildRound()
   * @param {Array}  config.players            [{ userId, displayName, avatarUrl, rating, isGhost, script }]
   * @param {object} [config.transport]        { toPlayer, toMatch }
   * @param {object} [config.hooks]            { onComplete, onAbandon, onRoundResolved }
   */
  constructor(config) {
    this.id = String(config.id);
    this.topic = config.topic;
    this.spaceId = String(config.spaceId);
    this.mode = config.mode ?? MATCH_MODE.QUICK;
    this.language = config.language ?? 'en';
    /**
     * Set for a contest entry (prd.md §6.3). The engine does nothing with it
     * beyond carrying it into the summary — the finaliser is what turns a
     * completed contest match into a standings row.
     */
    this.contestId = config.contestId ?? null;
    this.challengeId = config.challengeId ?? null;

    this.roundDurationMs = config.roundDurationMs ?? ROUND_DURATION_MS;
    this.roundResultMs = config.roundResultMs ?? ROUND_RESULT_MS;
    this.countdownMs = config.countdownMs ?? VERSUS_COUNTDOWN_MS;
    this.disconnectGraceMs = config.disconnectGraceMs ?? DISCONNECT_GRACE_MS;
    this.totalRounds = config.rounds.length || ROUNDS_PER_MATCH;

    this.definitions = config.rounds;
    /**
     * The identity fields are copied explicitly rather than spread, so a match
     * can never carry something the caller happened to have lying around.
     * Anything the versus screen draws therefore has to be named here: `level`
     * and `rankedRating` are what it shows, and `banner`/`country` are what it
     * is drawn on. Omitting one does not fail loudly — it silently arrives as a
     * default, which is how the banner and the league badge both spent a while
     * rendering as blanks.
     */
    this.players = config.players.map((p) => ({
      userId: String(p.userId),
      displayName: p.displayName,
      avatarUrl: p.avatarUrl ?? null,
      banner: p.banner ?? null,
      country: p.country ?? null,
      city: p.city ?? null,
      rating: p.rating ?? 1200,
      /** The topic level this pair was matched on, and the global standing. */
      level: p.level ?? 1,
      rankedRating: p.rankedRating ?? 1200,
      isGhost: Boolean(p.isGhost),
      script: p.script ?? null,
      sourceMatchId: p.sourceMatchId ?? null,
      score: 0,
      correctCount: 0,
      connected: !p.isGhost,
      forfeited: false,
      flags: 0,
    }));

    this.transport = config.transport ?? noopTransport;
    this.hooks = config.hooks ?? {};

    this.state = MATCH_STATE.MATCHED;
    this.roundIndex = -1;
    this.roundStartedAt = null;
    this.currentAnswers = new Map(); // userId → answer record
    this.history = [];
    this.createdAt = Date.now();
    this.completedAt = null;

    this.timers = { round: null, result: null, countdown: null };
    this.ghostTimers = [];
    this.disconnectTimers = new Map();
    this.disposed = false;
  }

  // ── Lookups ──────────────────────────────────────────────────────────────

  playerOf(userId) {
    return this.players.find((p) => p.userId === String(userId));
  }

  opponentOf(userId) {
    return this.players.find((p) => p.userId !== String(userId));
  }

  get humanPlayers() {
    return this.players.filter((p) => !p.isGhost);
  }

  get currentDefinition() {
    return this.definitions[this.roundIndex];
  }

  get isOver() {
    return this.state === MATCH_STATE.COMPLETE || this.state === MATCH_STATE.ABANDONED;
  }

  scoresFor(userId) {
    const me = this.playerOf(userId);
    const them = this.opponentOf(userId);
    return { you: me?.score ?? 0, opponent: them?.score ?? 0 };
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Emits match:start, runs the versus countdown, then opens round 0. */
  start() {
    if (this.state !== MATCH_STATE.MATCHED) return;
    this.state = MATCH_STATE.COUNTDOWN;

    for (const player of this.humanPlayers) {
      this.transport.toPlayer(player.userId, S2C.MATCH_START, {
        matchId: this.id,
        totalRounds: this.totalRounds,
        roundDurationMs: this.roundDurationMs,
        countdownMs: this.countdownMs,
        startsAt: Date.now() + this.countdownMs,
        serverNow: Date.now(),
      });
    }

    this.timers.countdown = setTimeout(() => {
      this.timers.countdown = null;
      this.nextRound();
    }, this.countdownMs);
  }

  nextRound() {
    if (this.isOver || this.disposed) return;
    const next = this.roundIndex + 1;
    if (next >= this.totalRounds) {
      this.complete();
      return;
    }
    this.openRound(next);
  }

  openRound(index) {
    this.roundIndex = index;
    this.state = MATCH_STATE.ROUND_ACTIVE;
    this.currentAnswers = new Map();

    const def = this.definitions[index];
    const durationMs = def.durationMs ?? this.roundDurationMs;
    this.roundStartedAt = Date.now();

    for (const player of this.humanPlayers) {
      this.transport.toPlayer(player.userId, S2C.ROUND_START, this.roundStartPayload(player.userId));
    }

    // Round closes on the server's clock, plus a small transit allowance.
    this.timers.round = setTimeout(() => {
      this.timers.round = null;
      this.resolveRound();
    }, durationMs + NETWORK_GRACE_MS);

    this.scheduleGhostAnswers(index, durationMs);
  }

  /**
   * Built field by field from an explicit list. There is no spread of the
   * round definition here and there must never be one — that is how the answer
   * key leaks. See protocol.js ROUND_START_ALLOWED_KEYS and
   * tests/anti-cheat.test.js.
   */
  roundStartPayload(userId) {
    const def = this.currentDefinition;
    return {
      roundIndex: this.roundIndex,
      totalRounds: this.totalRounds,
      question: {
        id: String(def.questionId),
        text: def.text,
        imageUrl: def.imageUrl,
        options: [...def.options],
      },
      durationMs: def.durationMs ?? this.roundDurationMs,
      startedAt: this.roundStartedAt,
      serverNow: Date.now(),
      scores: this.scoresFor(userId),
    };
  }

  scheduleGhostAnswers(index, durationMs) {
    for (const ghost of this.players.filter((p) => p.isGhost && p.script)) {
      const scripted = ghost.script[index];
      if (!scripted || scripted.optionIndex === null || scripted.optionIndex === undefined) continue;

      // The replay stores canonical option indices; this match shuffled its
      // options independently, so the ghost's choice has to be remapped or it
      // would answer a different option than the human it came from.
      const shown = canonicalToShown(this.definitions[index], scripted.optionIndex);
      if (shown === null) continue;

      const at = Math.min(scripted.elapsedMs ?? durationMs, durationMs - 1);
      if (at < 0) continue;

      const timer = setTimeout(() => {
        this.recordAnswer(ghost, index, shown, at);
      }, at);
      this.ghostTimers.push(timer);
    }
  }

  // ── Answers ──────────────────────────────────────────────────────────────

  /**
   * @returns {{ ok: true, points: number } | { ok: false, code: string, message: string }}
   */
  submitAnswer(userId, roundIndex, optionIndex) {
    const player = this.playerOf(userId);
    if (!player) {
      return { ok: false, code: ERROR_CODE.MATCH_NOT_FOUND, message: 'You are not in this match.' };
    }
    if (this.state !== MATCH_STATE.ROUND_ACTIVE) {
      return { ok: false, code: ERROR_CODE.ROUND_MISMATCH, message: 'That round is not open.' };
    }
    if (roundIndex !== this.roundIndex) {
      return { ok: false, code: ERROR_CODE.ROUND_MISMATCH, message: 'That round has moved on.' };
    }
    if (this.currentAnswers.has(player.userId)) {
      // prd.md F6.4.10 — an answer cannot be changed once submitted.
      return { ok: false, code: ERROR_CODE.ALREADY_ANSWERED, message: 'You already answered.' };
    }

    const def = this.currentDefinition;
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= def.options.length) {
      return { ok: false, code: ERROR_CODE.ROUND_MISMATCH, message: 'That is not an option.' };
    }

    // All timing is server-side. A client-supplied timestamp is never read.
    const elapsedMs = Date.now() - this.roundStartedAt;
    const durationMs = def.durationMs ?? this.roundDurationMs;
    if (elapsedMs > durationMs + NETWORK_GRACE_MS) {
      return { ok: false, code: ERROR_CODE.TOO_LATE, message: 'Time was up.' };
    }

    const record = this.recordAnswer(player, roundIndex, optionIndex, elapsedMs);
    return { ok: true, points: record.points };
  }

  recordAnswer(player, roundIndex, optionIndex, elapsedMs) {
    if (roundIndex !== this.roundIndex || this.currentAnswers.has(player.userId)) return null;

    const def = this.currentDefinition;
    const durationMs = def.durationMs ?? this.roundDurationMs;
    const isCorrect = optionIndex === def.correctIndex;
    // Grace time is for transit, not for points — clamp before scoring so a
    // slow connection is neither punished nor rewarded.
    const scoringElapsed = Math.min(elapsedMs, durationMs);
    const points = scoreAnswer({
      isCorrect,
      elapsedMs: scoringElapsed,
      durationMs,
      // The closing round is the bonus round the match screen announces.
      multiplier: roundMultiplier(this.roundIndex, this.totalRounds),
    });

    // tech.md §9.6 — below the human floor is flagged, not rejected. A false
    // positive must never cost someone a match they actually played.
    const flagged = !player.isGhost && elapsedMs < HUMAN_FLOOR_MS;
    if (flagged) player.flags += 1;

    const record = {
      userId: player.userId,
      optionIndex,
      canonicalIndex: def.optionOrder[optionIndex] ?? null,
      elapsedMs,
      points,
      isCorrect,
      flagged,
    };

    this.currentAnswers.set(player.userId, record);
    player.score += points;
    if (isCorrect) player.correctCount += 1;

    // prd.md F6.4.9 — the opponent sees *that* you answered, never what you
    // chose or whether you were right.
    const opponent = this.opponentOf(player.userId);
    if (opponent && !opponent.isGhost) {
      this.transport.toPlayer(opponent.userId, S2C.ROUND_OPPONENT_ANSWERED, {
        matchId: this.id,
        roundIndex,
        elapsedMs,
      });
    }

    if (this.currentAnswers.size === this.players.length) {
      this.clearTimer('round');
      this.resolveRound();
    }

    return record;
  }

  // ── Resolution ───────────────────────────────────────────────────────────

  resolveRound() {
    if (this.state !== MATCH_STATE.ROUND_ACTIVE) return;
    this.state = MATCH_STATE.ROUND_RESOLVED;
    this.clearTimer('round');
    this.clearGhostTimers();

    const def = this.currentDefinition;
    const answers = this.players.map(
      (p) =>
        this.currentAnswers.get(p.userId) ?? {
          userId: p.userId,
          optionIndex: null,
          canonicalIndex: null,
          elapsedMs: null,
          points: 0,
          isCorrect: false,
          flagged: false,
        },
    );

    this.history.push({
      questionIndex: this.roundIndex,
      questionId: def.questionId,
      correctIndex: def.correctIndex,
      optionOrder: def.optionOrder,
      durationMs: def.durationMs ?? this.roundDurationMs,
      answers,
    });

    for (const player of this.humanPlayers) {
      const mine = answers.find((a) => a.userId === player.userId);
      const theirs = answers.find((a) => a.userId !== player.userId);
      this.transport.toPlayer(player.userId, S2C.ROUND_RESULT, {
        matchId: this.id,
        roundIndex: this.roundIndex,
        correctIndex: def.correctIndex,
        you: { optionIndex: mine.optionIndex, elapsedMs: mine.elapsedMs, points: mine.points },
        opponent: theirs
          ? { optionIndex: theirs.optionIndex, elapsedMs: theirs.elapsedMs, points: theirs.points }
          : null,
        scores: this.scoresFor(player.userId),
        nextInMs: this.roundResultMs,
      });
    }

    this.hooks.onRoundResolved?.(this, this.history.at(-1));

    // prd.md F6.4.13 — a 2.5 second interval, then the next round.
    this.timers.result = setTimeout(() => {
      this.timers.result = null;
      this.nextRound();
    }, this.roundResultMs);
  }

  complete({ abandonedBy = null } = {}) {
    if (this.isOver) return;
    this.state = abandonedBy ? MATCH_STATE.ABANDONED : MATCH_STATE.COMPLETE;
    this.completedAt = Date.now();
    this.clearAllTimers();

    if (abandonedBy) {
      const quitter = this.playerOf(abandonedBy);
      if (quitter) quitter.forfeited = true;
    }

    /**
     * Anyone else still away when the match ends is gone too.
     *
     * `complete()` runs exactly once — the `isOver` guard above sees to that —
     * and `clearAllTimers()` then kills the OTHER player's grace timer, so only
     * ever one player was marked. When a shared network event took both phones
     * down, whichever timer happened to fire first scored that player as the
     * sole forfeiter and the other as the winner: `bothGone` could never be
     * true, and the void case tech.md §9.7 describes — and the result screen
     * still has copy for — was unreachable.
     *
     * A ghost is never "away": it has no connection to lose.
     */
    for (const p of this.players) {
      if (!p.isGhost && !p.connected) p.forfeited = true;
    }

    const [a, b] = this.players;
    /**
     * A drill has one player, and one player cannot win.
     *
     * Without this branch the score comparison below decided it: with no `b`,
     * `a.score > (b?.score ?? 0)` made the solo player the winner of every
     * practice run they scored a single point in. That verdict then paid the win
     * bonus, incremented the public win count and armed the win achievements —
     * all off a match with nobody on the other side.
     *
     * `isDraw` deliberately stays false. A drill is not a draw either; it has no
     * result of that kind at all, and anything reading `isDraw` as "the scores
     * were level" would be just as wrong as reading a win.
     */
    const isSolo = this.players.length === 1;
    // tech.md §9.7 — if both dropped, nobody's rating moves.
    const bothGone = this.players.every((p) => p.forfeited);
    let winnerId = null;
    let isDraw = false;

    if (isSolo || bothGone) {
      isDraw = false;
    } else if (a.forfeited) {
      winnerId = b.userId;
    } else if (b?.forfeited) {
      winnerId = a.userId;
    } else if (a.score > (b?.score ?? 0)) {
      winnerId = a.userId;
    } else if ((b?.score ?? 0) > a.score) {
      winnerId = b.userId;
    } else {
      isDraw = true;
    }

    const summary = {
      matchId: this.id,
      topicId: this.topic?.id,
      spaceId: this.spaceId,
      mode: this.mode,
      language: this.language,
      contestId: this.contestId,
      challengeId: this.challengeId,
      isVoid: bothGone,
      winnerId,
      isDraw,
      abandonedBy,
      players: this.players.map((p) => ({
        userId: p.userId,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        /**
         * Carried so the replay writer can record it. It reads
         * `player.country`/`player.city` off this summary, and they were never
         * put here — so every replay was stored with a null country and a
         * replayed ghost always wore the SEARCHING player's flag instead of the
         * one the recorded player actually played under.
         */
        country: p.country ?? null,
        city: p.city ?? null,
        isGhost: p.isGhost,
        sourceMatchId: p.sourceMatchId,
        rating: p.rating,
        /**
         * The PRE-match level, which is what the replay written from this
         * summary is stored against — the run being recorded is the one that
         * earned the XP, so pairing a future opponent against the post-match
         * level would place the ghost one step too high.
         */
        level: p.level,
        score: p.score,
        correctCount: p.correctCount,
        forfeited: p.forfeited,
        flags: p.flags,
      })),
      rounds: this.history,
      questionIds: this.definitions.map((d) => d.questionId),
      roundDurationMs: this.roundDurationMs,
      startedAt: this.createdAt,
      completedAt: this.completedAt,
    };

    // Ratings, XP, and the replay are applied by the finalizer, which owns
    // persistence. The engine stays free of database concerns.
    Promise.resolve(this.hooks.onComplete?.(this, summary))
      .then((outcome) => this.emitEnd(summary, outcome ?? {}))
      .catch((err) => {
        this.hooks.onError?.(err, this);
        this.emitEnd(summary, {});
      });
  }

  emitEnd(summary, outcome) {
    /**
     * The ladder in force, read once for the whole payload. League floors are
     * configuration now (leagues-and-progression.md §9), and reading it per
     * player would let a superadmin's save land mid-loop — two players in the
     * same match being told they are in different ladders.
     */
    const ladder = progression().ladder;

    for (const player of this.humanPlayers) {
      const me = summary.players.find((p) => p.userId === player.userId);
      const them = summary.players.find((p) => p.userId !== player.userId);
      const result = outcome.perPlayer?.[player.userId] ?? {};

      /**
       * leagues-and-progression.md §6 — the ladder, and the league it reads
       * from. The league is computed here rather than carried from the
       * finaliser because it is a pure function of the rating: two copies of
       * the same arithmetic can disagree, one copy cannot. The fallback only
       * bites if the finaliser failed outright, in which case nothing moved.
       */
      const rankedBefore = result.rankedBefore ?? RANKED_START;
      const rankedAfter = result.rankedAfter ?? rankedBefore;

      const payload = {
        matchId: this.id,
        /**
         * What was played, so the result screen can say what happened.
         *
         * Without it the screen has exactly one signal — whether an opponent
         * exists — and that signal cannot tell a self-race from a real match. A
         * self-race HAS a second player (your own recorded run), so beating your
         * best was being announced as "YOU WIN! · Well played", which is the app
         * congratulating you on defeating yourself and never once naming the run
         * you actually beat. `matchService` even documents the intended copy —
         * "the result screen says you beat your best" — and the screen had no way
         * to know it should.
         */
        mode: this.mode,
        /**
         * Derived from the outcome, not from the scores. A forfeit is a win
         * for the player who stayed even when both scores are level — deriving
         * the word from scores alone would tell someone who just won by
         * forfeit at 0–0 that they drew.
         */
        verdict: verdictOf(summary, player.userId, me, them),
        scores: { you: me.score, opponent: them?.score ?? 0 },
        winnerId: summary.winnerId,
        isDraw: summary.isDraw,
        isVoid: summary.isVoid,
        forfeitedBy: summary.abandonedBy,
        ratingBefore: result.ratingBefore ?? me.rating,
        ratingAfter: result.ratingAfter ?? me.rating,
        ratingDelta: result.ratingDelta ?? 0,
        xpEarned: result.xpEarned ?? 0,
        level: result.level,
        levelUp: result.levelUp ?? false,

        // ── The ladder (leagues-and-progression.md §2–3) ──────────────────
        /** Whether this match was played for the ladder at all. */
        ranked: this.mode === MATCH_MODE.RANKED && !summary.isVoid,
        rankedBefore,
        rankedAfter,
        rankedDelta: result.rankedDelta ?? 0,
        /**
         * Both bands, so the result screen can stage a promotion instead of
         * quietly swapping one badge for another.
         */
        leagueBefore: leagueFor(rankedBefore, ladder),
        leagueAfter: leagueFor(rankedAfter, ladder),
        leagueMovement: leagueMovement(rankedBefore, rankedAfter, ladder),

        // ── The account level (§4–5) — this never falls, whatever happened ──
        /**
         * Both sides of the level, for the same reason both league bands are
         * sent above: a client cannot stage "11 ➜ 12" from the 12 alone.
         *
         * `matchService` has computed this all along and the REST match
         * summary already carried it — only this socket payload dropped it, so
         * the live path and the fetched-later path disagreed about the same
         * match. Deriving it as `accountLevel - 1` is a guess that happens to
         * be right most of the time and is silently wrong for any match that
         * crosses two levels at once.
         */
        accountLevelBefore: result.accountLevelBefore,
        accountLevel: result.accountLevel,
        accountLevelUp: result.accountLevelUp ?? false,
        /** [{ key, type, name, level }] — the titles and drops a level handed over. */
        unlocked: result.unlocked ?? [],
        /** Chests this result put on the rewards screen, waiting to be opened. */
        chestsWon: result.chestsWon ?? [],
        /** What the next account level opens, for the level-up caption. */
        nextUnlock: result.nextUnlock ?? null,
        totalXp: result.totalXpAfter,

        // ── Coins (coins-and-cosmetics.md §3.1) ───────────────────────────
        /**
         * The total, and then where it came from. Split because the result
         * screen says "+50 for the win" and "+300 for level 20" as two separate
         * lines — one number with three sources behind it is a number a player
         * cannot check against what just happened.
         */
        coinsEarned: result.coinsEarned ?? 0,
        coinsFromMatch: result.coinsFromMatch ?? 0,
        coinsFromLevels: result.coinsFromLevels ?? 0,
        coins: result.coinsAfter,
        /** Set when this match crossed a division or a league line. */
        promotion: result.promotion ?? null,
        /** Present only on a contest entry: where this run placed, and out of how many. */
        contest: result.contest ?? null,
        /** Assignments this match just completed, so the result screen can say so. */
        assignmentsCompleted: result.assignmentsCompleted ?? [],
        opponent: them
          ? { id: them.userId, displayName: them.displayName, avatarUrl: them.avatarUrl }
          : null,
        rounds: this.history.map((r) => {
          const mine = r.answers.find((x) => x.userId === player.userId);
          const theirs = r.answers.find((x) => x.userId !== player.userId);
          return {
            roundIndex: r.questionIndex,
            correctIndex: r.correctIndex,
            you: { optionIndex: mine?.optionIndex ?? null, points: mine?.points ?? 0 },
            opponent: { optionIndex: theirs?.optionIndex ?? null, points: theirs?.points ?? 0 },
          };
        }),
      };

      this.transport.toPlayer(player.userId, S2C.MATCH_END, payload);
      /**
       * Only for a player who was AWAY when this fired.
       *
       * The 10-second grace exists precisely for players who have dropped, so
       * the forfeit that ends their match is emitted into an empty room by
       * definition — they reconnect to a dead board with the clock at zero, no
       * result, and no notice of the loss they just took. Held for them, and
       * for nobody else: caching it for a player who received it perfectly well
       * means the next socket they open replays the last match at them, which
       * is a result screen out of nowhere in the middle of the next game.
       */
      if (!player.connected) this.hooks.onResultForPlayer?.(player.userId, payload);
    }
    this.hooks.onFinished?.(this, summary);
  }

  // ── Connection handling (tech.md §9.7) ───────────────────────────────────

  handleDisconnect(userId) {
    const player = this.playerOf(userId);
    if (!player || this.isOver) return;
    player.connected = false;

    const opponent = this.opponentOf(userId);
    if (opponent && !opponent.isGhost) {
      this.transport.toPlayer(opponent.userId, S2C.MATCH_OPPONENT_LEFT, {
        matchId: this.id,
        graceMs: this.disconnectGraceMs,
      });
    }

    const timer = setTimeout(() => {
      this.disconnectTimers.delete(player.userId);
      if (this.isOver || player.connected) return;
      this.complete({ abandonedBy: player.userId });
    }, this.disconnectGraceMs);

    this.disconnectTimers.set(player.userId, timer);
  }

  handleReconnect(userId) {
    const player = this.playerOf(userId);
    if (!player || this.isOver) return null;
    player.connected = true;

    const timer = this.disconnectTimers.get(player.userId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(player.userId);
    }

    const opponent = this.opponentOf(userId);
    if (opponent && !opponent.isGhost) {
      this.transport.toPlayer(opponent.userId, S2C.MATCH_OPPONENT_REJOINED, { matchId: this.id });
    }

    return this.snapshotFor(userId);
  }

  /**
   * Everything a returning client needs to draw the current screen, with
   * remaining time recalculated from the server's `startedAt` rather than
   * trusting anything the client remembered.
   */
  snapshotFor(userId) {
    const me = this.playerOf(userId);
    const them = this.opponentOf(userId);
    const base = {
      matchId: this.id,
      state: this.state,
      totalRounds: this.totalRounds,
      roundIndex: this.roundIndex,
      scores: this.scoresFor(userId),
      topic: this.topic,
      you: me ? { id: me.userId, displayName: me.displayName, avatarUrl: me.avatarUrl } : null,
      opponent: them
        ? {
            id: them.userId,
            displayName: them.displayName,
            avatarUrl: them.avatarUrl,
            rating: them.rating,
            /**
             * A ghost has no connection to lose. It is built `connected:
             * false`, so a resume against one used to pin the status line to
             * "opponent reconnecting" for the rest of the match — which is
             * both wrong and exactly the ghost tell F6.7.5 forbids.
             */
            connected: them.isGhost ? true : them.connected,
          }
        : null,
      serverNow: Date.now(),
    };

    if (this.state === MATCH_STATE.ROUND_ACTIVE && this.currentDefinition) {
      const def = this.currentDefinition;
      const durationMs = def.durationMs ?? this.roundDurationMs;
      return {
        ...base,
        question: {
          id: String(def.questionId),
          text: def.text,
          imageUrl: def.imageUrl,
          options: [...def.options],
        },
        durationMs,
        startedAt: this.roundStartedAt,
        remainingMs: Math.max(0, this.roundStartedAt + durationMs - Date.now()),
        youAnswered: this.currentAnswers.has(String(userId)),
        opponentAnswered: them ? this.currentAnswers.has(them.userId) : false,
      };
    }
    return base;
  }

  /** prd.md — leaving mid-match forfeits, and the copy says so before it happens. */
  forfeit(userId) {
    if (this.isOver) return;
    this.complete({ abandonedBy: String(userId) });
  }

  // ── Timers ───────────────────────────────────────────────────────────────

  clearTimer(name) {
    if (this.timers[name]) {
      clearTimeout(this.timers[name]);
      this.timers[name] = null;
    }
  }

  clearGhostTimers() {
    for (const t of this.ghostTimers) clearTimeout(t);
    this.ghostTimers = [];
  }

  clearAllTimers() {
    for (const name of Object.keys(this.timers)) this.clearTimer(name);
    this.clearGhostTimers();
    for (const t of this.disconnectTimers.values()) clearTimeout(t);
    this.disconnectTimers.clear();
  }

  dispose() {
    this.disposed = true;
    this.clearAllTimers();
  }
}

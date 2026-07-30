import { scoreAnswer } from '../shared/scoring.js';
import { canonicalToShown, shownToCanonical } from './questionSelector.js';
import { ClassSession } from '../models/index.js';
import { logger } from '../lib/logger.js';

/**
 * The live half of a class session — the thing that is actually running while
 * thirty people look at a projector.
 *
 * ── The one design decision that matters ─────────────────────────────────────
 *
 * **The clock resolves a question; the host advances to the next one.**
 *
 * A 1v1 match auto-advances, because two people racing each other have nothing to
 * say between rounds. A classroom is the opposite: the moment after the answer is
 * revealed is the moment the teaching happens — "why did nineteen of you pick B?"
 * — and a timer that moves on after 2.5 seconds would talk over the only part of
 * the lesson that is not a quiz. So a round ends on its own, and then the session
 * waits. That single difference is most of what makes this a classroom tool rather
 * than a thirty-player game.
 *
 * ── Held in memory, written on every round ───────────────────────────────────
 *
 * The room needs sub-second broadcast, so the live state is a plain object here.
 * Every resolved round is persisted before the results go out, so a crash costs
 * the question on screen and not the lesson — and the board a teacher shows
 * afterwards is read from the database, not from this.
 */

/** Sessions currently running, by id. Mirrors `registry` for matches. */
const live = new Map();

export const sessions = {
  get: (id) => live.get(String(id)),
  add: (session) => live.set(String(session.id), session),
  remove: (id) => live.delete(String(id)),
  /** The session a given player is inside, if any — one at a time. */
  forUser(userId) {
    for (const session of live.values()) {
      if (session.participants.has(String(userId))) return session;
    }
    return undefined;
  },
  /** Test seam: the harness resets between cases. */
  clear() {
    for (const session of live.values()) session.dispose();
    live.clear();
  },
};

export class ClassSessionRunner {
  /**
   * @param {object} config
   * @param {string} config.id            the ClassSession document id
   * @param {Array}  config.rounds        from buildRound(), one per question
   * @param {object} config.transport     { toRoom(sessionId, event, payload) }
   */
  constructor({ id, spaceId, topicId, hostId, code, name, rounds, roundDurationMs, transport }) {
    this.id = String(id);
    this.spaceId = String(spaceId);
    this.topicId = String(topicId);
    this.hostId = String(hostId);
    this.code = code;
    this.name = name;
    this.rounds = rounds;
    this.roundDurationMs = roundDurationMs;
    this.transport = transport;

    this.status = 'lobby';
    this.currentRound = -1;
    this.roundStartedAt = null;
    this.timer = null;
    /** userId → { displayName, avatarUrl, score, correctCount } */
    this.participants = new Map();
    /** userId → { optionIndex, elapsedMs } for the round on screen. */
    this.currentAnswers = new Map();
  }

  // ── Lobby ────────────────────────────────────────────────────────────────

  join(user) {
    const key = String(user.id ?? user._id);
    if (!this.participants.has(key)) {
      this.participants.set(key, {
        userId: key,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl ?? null,
        score: 0,
        correctCount: 0,
      });
    }
    return this.participants.get(key);
  }

  /**
   * Leaving is deliberately not the same as being removed.
   *
   * A student whose phone locks, or who walks out of wifi range for ten seconds,
   * has not left the lesson — and dropping them from the board would erase a
   * score they earned in front of the class. So a disconnect changes nothing
   * here; only the host removing somebody does.
   */
  remove(userId) {
    this.participants.delete(String(userId));
    this.currentAnswers.delete(String(userId));
  }

  roster() {
    return [...this.participants.values()].map((p) => ({
      id: p.userId,
      displayName: p.displayName,
      avatarUrl: p.avatarUrl,
      score: p.score,
      correctCount: p.correctCount,
    }));
  }

  /** The board, best first — what the projector shows. */
  board() {
    return this.roster()
      .sort((a, b) => b.score - a.score || b.correctCount - a.correctCount)
      .map((row, i) => ({ ...row, rank: i + 1 }));
  }

  // ── Running ──────────────────────────────────────────────────────────────

  start() {
    if (this.status !== 'lobby') return false;
    this.status = 'live';
    this.nextRound();
    return true;
  }

  /**
   * Deal the next question, or end the session if that was the last.
   *
   * Guarded on there being no question already open, because this is host-driven
   * and a host who taps Next twice must not skip a question the class is looking
   * at. The guard is here rather than in the gateway so that every caller gets it.
   */
  nextRound() {
    if (this.status !== 'live') return false;
    if (this.timer) return false; // A question is on screen; it has to resolve first.

    const index = this.currentRound + 1;
    if (index >= this.rounds.length) {
      this.end();
      return true;
    }

    this.currentRound = index;
    this.currentAnswers.clear();
    this.roundStartedAt = Date.now();

    const round = this.rounds[index];
    this.transport.toRoom(this.id, 'session:round', {
      sessionId: this.id,
      roundIndex: index,
      totalRounds: this.rounds.length,
      // The answer key never leaves the server before the round resolves — the
      // same rule as tech.md §7.2 for a match, and for the same reason.
      question: {
        id: String(round.questionId),
        text: round.text,
        imageUrl: round.imageUrl ?? null,
        options: round.options,
        difficulty: round.difficulty,
      },
      durationMs: this.roundDurationMs,
      startedAt: this.roundStartedAt,
    });

    this.timer = setTimeout(() => this.resolveRound(), this.roundDurationMs);
    return true;
  }

  answer(userId, { roundIndex, optionIndex }) {
    const key = String(userId);
    if (this.status !== 'live') return { ok: false, code: 'NOT_LIVE' };
    if (roundIndex !== this.currentRound) return { ok: false, code: 'ROUND_MISMATCH' };
    if (!this.participants.has(key)) return { ok: false, code: 'NOT_IN_SESSION' };
    if (this.currentAnswers.has(key)) return { ok: false, code: 'ALREADY_ANSWERED' };
    if (!this.timer) return { ok: false, code: 'TOO_LATE' };

    const elapsedMs = Date.now() - this.roundStartedAt;
    this.currentAnswers.set(key, { optionIndex, elapsedMs });

    /**
     * How many have answered, not who or what — the projector shows "18 of 30 in"
     * and the class can see the number climb. Sending the choice would put the
     * answer key on the room the moment the first person is right.
     */
    this.transport.toRoom(this.id, 'session:answered', {
      sessionId: this.id,
      roundIndex,
      answered: this.currentAnswers.size,
      total: this.participants.size,
    });

    // Everybody is in — no reason to make the room watch a clock run down.
    if (this.currentAnswers.size >= this.participants.size) {
      clearTimeout(this.timer);
      this.timer = null;
      this.resolveRound();
    }

    return { ok: true };
  }

  async resolveRound() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const index = this.currentRound;
    const round = this.rounds[index];
    if (!round) return;

    /** canonical index → how many chose it, for the distribution bar. */
    const distribution = round.options.map(() => 0);

    for (const [userId, answer] of this.currentAnswers) {
      const participant = this.participants.get(userId);
      if (!participant) continue;

      const isCorrect = answer.optionIndex === round.correctIndex;
      const points = isCorrect
        ? scoreAnswer({ isCorrect, elapsedMs: answer.elapsedMs, durationMs: this.roundDurationMs })
        : 0;

      participant.score += points;
      if (isCorrect) participant.correctCount += 1;
      answer.isCorrect = isCorrect;
      answer.points = points;

      if (answer.optionIndex != null && distribution[answer.optionIndex] !== undefined) {
        distribution[answer.optionIndex] += 1;
      }
    }

    await this.persistRound(index).catch((err) =>
      logger.error({ err, sessionId: this.id, round: index }, 'session round persist failed'),
    );

    this.transport.toRoom(this.id, 'session:round_result', {
      sessionId: this.id,
      roundIndex: index,
      correctIndex: round.correctIndex,
      explanation: round.explanation ?? null,
      /** What the class chose, in the order the options were shown. */
      distribution,
      answered: this.currentAnswers.size,
      total: this.participants.size,
      board: this.board().slice(0, 10),
      /** The host decides when to move on — see the note at the top. */
      awaitingHost: index + 1 < this.rounds.length,
      isLast: index + 1 >= this.rounds.length,
    });
  }

  async end() {
    if (this.status === 'ended') return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.status = 'ended';

    await ClassSession.updateOne(
      { _id: this.id },
      { $set: { status: 'ended', endedAt: new Date(), currentRound: this.currentRound } },
    ).catch((err) => logger.error({ err, sessionId: this.id }, 'session end persist failed'));

    this.transport.toRoom(this.id, 'session:ended', {
      sessionId: this.id,
      board: this.board(),
      totalRounds: this.rounds.length,
    });

    sessions.remove(this.id);
  }

  /**
   * Write the round that just resolved.
   *
   * Per round rather than once at the end, because "once at the end" means a
   * process that dies in minute six of a lesson loses all six minutes — in front
   * of a class, with no way to get it back. The write is one document and the
   * room is already looking at a results screen while it happens.
   */
  async persistRound(index) {
    const participants = [...this.participants.values()].map((p) => {
      const answer = this.currentAnswers.get(p.userId);
      return {
        userId: p.userId,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        score: p.score,
        correctCount: p.correctCount,
        answer: answer
          ? {
              roundIndex: index,
              optionIndex: shownToCanonical(this.rounds[index], answer.optionIndex),
              elapsedMs: answer.elapsedMs,
              isCorrect: Boolean(answer.isCorrect),
              points: answer.points ?? 0,
            }
          : null,
      };
    });

    const doc = await ClassSession.findById(this.id);
    if (!doc) return;

    for (const row of participants) {
      let existing = doc.participants.find((p) => String(p.userId) === row.userId);
      if (!existing) {
        doc.participants.push({
          userId: row.userId,
          displayName: row.displayName,
          avatarUrl: row.avatarUrl,
        });
        existing = doc.participants.at(-1);
      }
      existing.score = row.score;
      existing.correctCount = row.correctCount;
      if (row.answer) existing.answers.push(row.answer);
    }
    doc.currentRound = index;
    doc.status = this.status;
    await doc.save();
  }

  /** The snapshot a joiner or a reconnecting phone needs to draw the screen. */
  snapshot({ forUserId = null } = {}) {
    const round = this.rounds[this.currentRound];
    const answered = forUserId ? this.currentAnswers.has(String(forUserId)) : false;
    return {
      sessionId: this.id,
      code: this.code,
      name: this.name,
      status: this.status,
      isHost: forUserId ? String(forUserId) === this.hostId : false,
      roundIndex: this.currentRound,
      totalRounds: this.rounds.length,
      roster: this.roster(),
      board: this.board(),
      /** Only while a question is genuinely open, and never with the key on it. */
      question:
        this.status === 'live' && round && this.timer
          ? {
              id: String(round.questionId),
              text: round.text,
              imageUrl: round.imageUrl ?? null,
              options: round.options,
              difficulty: round.difficulty,
              durationMs: this.roundDurationMs,
              // What is LEFT, not how long it was — a phone that joins ten
              // seconds in must not be given the full clock.
              remainingMs: Math.max(0, this.roundDurationMs - (Date.now() - this.roundStartedAt)),
              youAnswered: answered,
            }
          : null,
    };
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export { canonicalToShown };

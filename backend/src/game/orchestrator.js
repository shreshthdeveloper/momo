import mongoose from 'mongoose';
import { Question, Topic, Space, User, Contest } from '../models/index.js';
import { LiveMatch } from './matchEngine.js';
import { Matchmaker } from './matchmaker.js';
import { registry } from './registry.js';
import { selectQuestions, buildRound, allowedOriginsFor } from './questionSelector.js';
import {
  findReplay,
  bestReplayFor,
  markReplayUsed,
  buildSyntheticOpponent,
  bindSyntheticScript,
  syntheticIdentity,
} from './ghostService.js';
import { createLiveMatchRecord, finalizeMatch, headToHead } from '../services/matchService.js';
import { mistakeQuestionIds } from '../services/mistakeService.js';
import { getRatingValue, getRatingEntry } from '../services/ratingService.js';
import { resolvePlayableTopic, resolveScope } from '../services/spaceService.js';
import { playableChallenge, markChallengePlayed } from '../services/friendService.js';
import {
  assertCanEnter,
  lockContestQuestions,
  openEntry,
} from '../services/contestService.js';
import { S2C, ERROR_CODE } from '../shared/protocol.js';
import {
  ROUNDS_PER_MATCH,
  SOLO_COUNTDOWN_MS,
  ROUND_DURATION_MS,
  MATCH_MODE,
  DECK,
  MIN_PUBLISHED_QUESTIONS_TO_LIVE,
  DEFAULT_LANGUAGE,
  GHOST_AFTER_MS,
  REMATCH_WINDOW_MS,
  LEVEL_BAND_MAX,
  LEVEL_BAND_STEP_MS,
  RANKED_START,
  RANKED_FLOOR,
} from '../shared/constants.js';
import { logger, logMatchSummary } from '../lib/logger.js';
import { AppError } from '../lib/errors.js';
import { env } from '../config/env.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * How long a finished match's result waits for a player who was offline when
 * it landed. Long enough to cover the disconnect grace plus a socket's own
 * reconnect backoff, short enough that it is never a surprise.
 */
const MISSED_RESULT_TTL_MS = 120_000;

/**
 * Gone: the ladder standing of a replayed player.
 *
 * It existed to draw a league badge on the ghost's half of the versus screen,
 * read live from the account whose game was being replayed. That badge was the
 * last piece of a real person's profile still on display once the name and
 * avatar were masked, and a division is nearly as identifying as a name inside
 * a thirty-person organization. Both replay sites now derive a plausible
 * standing near the waiting player's own, which is where live pairing would
 * have put a human anyway.
 */

/**
 * The modes a player may put themselves in a queue for
 * (leagues-and-progression.md §1). A contest is entered by id from the contest
 * screen, and a challenge is created rather than queued for.
 */
const QUEUEABLE_MODES = [
  MATCH_MODE.QUICK,
  MATCH_MODE.RANKED,
  MATCH_MODE.PRACTICE,
  MATCH_MODE.SELF,
];

/**
 * Wires matchmaking, question selection, the engine, the registry and
 * persistence together. The socket gateway does nothing but translate socket
 * frames into calls on this object, which is what keeps the engine testable
 * without a network and extractable without a rewrite (tech.md §1).
 */
export class GameOrchestrator {
  /**
   * @param {object} deps
   * @param {{ toPlayer: Function, toMatch: Function }} deps.transport
   * @param {object} [deps.timing] test-only overrides for round pacing
   */
  constructor({ transport, timing = {} } = {}) {
    this.transport = transport;
    this.timing = timing;
    /** matchId → Set<userId> who asked for a rematch */
    this.rematchRequests = new Map();
    /** Expiry timers for the above, keyed the same way. */
    this.rematchTimers = new Map();
    /**
     * userId → the `match:end` payload they were last sent, and when.
     *
     * Held only long enough to survive a reconnect: the disconnect grace is
     * ten seconds and the socket's own backoff a few more, so anything older
     * than a couple of minutes belongs to a match the player has moved on
     * from and would be a jarring result screen out of nowhere.
     */
    this.recentResults = new Map();

    this.matchmaker = new Matchmaker({
      onPair: (a, b) => this.createLiveMatch(a, b),
      onGhost: (waiting) => this.createGhostMatch(waiting),
      onExpire: (waiting) =>
        this.failPair(
          [waiting],
          ERROR_CODE.NO_OPPONENT_FOUND,
          'Nobody else is playing this topic right now. Try again in a moment.',
        ),
      /**
       * Pairing succeeded and building the match did not. The entries are
       * already out of the pool by the time this runs, so without it the
       * players are told nothing at all and sit on a searching screen that
       * nothing will ever end — the queue's own metrics counted them as
       * paired, which is why this never showed up as a failure anywhere.
       */
      onFailure: (entries) =>
        this.failPair(
          entries,
          ERROR_CODE.MATCH_START_FAILED,
          'That match could not be started. Try again.',
        ),
      ghostAfterMs: timing.ghostAfterMs ?? env.GHOST_AFTER_MS,
      humanOnlySweepAfterMs: timing.humanOnlySweepAfterMs,
      tickMs: timing.matchmakerTickMs,
    });
  }

  // ── Queue ────────────────────────────────────────────────────────────────

  /**
   * prd.md F6.4.1–F6.4.3. Throws an AppError the gateway turns into an
   * `error` frame; the client keys recovery off the code, never the message.
   *
   * Quick play and ranked both queue exactly the same way — a live opponent
   * inside the deadline, a ghost after it (leagues-and-progression.md §1).
   * The only difference is what the finaliser does with the result, which is
   * why the mode has to survive the whole trip: queue → pairing → engine →
   * summary. Nothing here reads it except the pool it queues into.
   *
   * The default is RANKED because that is what an unspecified mode has always
   * meant: before the two modes existed every match moved the rating, so a
   * client that has not been updated keeps the game it had rather than
   * silently losing its ladder. The current client always names its mode.
   */
  async joinQueue({
    user,
    topicId,
    spaceId,
    mode = MATCH_MODE.RANKED,
    challengeId = null,
    /**
     * Which questions to deal, when it is not "whatever comes next".
     *
     * `'mistakes'` is the revision deck: the questions this player got wrong and
     * has not since got right. Practice only — a deck of known-missed questions
     * is a deliberate repeat, and repeats in a mode that moves a rating would be
     * both an advantage and a corruption of what the rating measures.
     */
    deck = null,
  }) {
    if (registry.matchForUser(user.id)) {
      throw new AppError(409, ERROR_CODE.ALREADY_IN_MATCH, 'You are already in a match.');
    }
    // Queueing for the next match settles the last one: whatever they missed,
    // they have plainly moved on from it.
    this.clearMissedResult(user.id);

    // A contest is entered by id, not by topic — the paper is the contest's,
    // not the topic's, and eligibility is a different question. Routing it
    // here by accident would silently produce an unranked ordinary match.
    if (mode === MATCH_MODE.CONTEST) {
      throw new AppError(400, ERROR_CODE.BAD_REQUEST, 'Enter a contest from the contest screen.');
    }

    /**
     * A friend challenge (prd.md §6.3).
     *
     * Everything that defines it is read from the CHALLENGE, never from what
     * the client sent: the topic, the mode, and the fact that only two people
     * on earth may enter this queue. Trusting the client for any of those
     * would let one side play a topic the other never agreed to.
     */
    let challenge = null;
    if (challengeId) {
      challenge = await playableChallenge(user, challengeId);
      topicId = String(challenge.topicId);
      spaceId = undefined;
      mode = MATCH_MODE.CHALLENGE;
    } else if (mode === MATCH_MODE.CHALLENGE) {
      // The mode is not something you can simply ask for — it is what having a
      // real, accepted challenge makes you. Otherwise it is a free unranked
      // match with a friendly name on it.
      throw new AppError(400, ERROR_CODE.BAD_REQUEST, 'A challenge is started from Friends.');
    }

    if (!challenge && !QUEUEABLE_MODES.includes(mode)) {
      throw new AppError(400, ERROR_CODE.BAD_REQUEST, 'That is not a mode you can queue for.');
    }

    if (deck && deck !== DECK.MISTAKES) {
      throw new AppError(400, ERROR_CODE.BAD_REQUEST, 'Unknown deck.');
    }
    if (deck && mode !== MATCH_MODE.PRACTICE) {
      // Stated as its own error rather than quietly ignoring the deck: a client
      // that asked for revision and silently got an ordinary match would look
      // like the deck was empty.
      throw new AppError(
        400,
        ERROR_CODE.BAD_REQUEST,
        'A revision deck can only be played as practice.',
      );
    }

    const { topic, scope } = await resolvePlayableTopic(user, topicId, spaceId);

    if (topic.publishedQuestionCount < MIN_PUBLISHED_QUESTIONS_TO_LIVE) {
      throw new AppError(
        409,
        ERROR_CODE.TOPIC_NOT_LIVE,
        'This topic is not ready to play yet.',
        { published: topic.publishedQuestionCount, required: MIN_PUBLISHED_QUESTIONS_TO_LIVE },
      );
    }

    // Level pairs the match, rating follows it into the record and the ghost
    // picker — one read for both (leagues-and-progression.md §7).
    const { rating, level } = await getRatingEntry(user.id, topic._id);
    /**
     * Read fresh rather than taken from the socket session.
     *
     * The session is a snapshot from connect time and does not carry these at
     * all, which is why the versus screen drew no league badge and no banner.
     * Even if it did, `rankedRating` moves after every ranked match, so a
     * long-lived connection would keep showing the badge the player had when
     * they opened the app.
     */
    const current = await User.findById(oid(user.id), {
      rankedRating: 1,
      banner: 1,
      country: 1,
      city: 1,
    }).lean();
    const space = scope.space ?? (await Space.findById(topic.spaceId).lean());

    const entry = {
      userId: String(user.id),
      displayName: user.displayName,
      avatarUrl: user.avatarUrl ?? null,
      banner: current?.banner ?? null,
      country: current?.country ?? null,
      city: current?.city ?? null,
      rating,
      level,
      /**
       * The global standing, carried into the match so the versus screen can
       * draw a league badge. Read once here and never again: a rating earned
       * mid-queue must not change the badge of a match already being built.
       */
      rankedRating: current?.rankedRating ?? RANKED_START,
      topicId: String(topic._id),
      spaceId: String(topic.spaceId),
      mode,
      language: user.locale && topic.languages?.includes(user.locale)
        ? user.locale
        : (topic.languages?.[0] ?? DEFAULT_LANGUAGE),
      // The space's own setting wins (design.md §11 makes it configurable per
      // Space); `timing` is a test seam so a full match need not take 90s.
      roundDurationMs:
        this.timing.roundDurationMs ?? space?.settings?.roundDurationMs ?? ROUND_DURATION_MS,
      /**
       * Both gates have to be open. The space's own setting is the product
       * one (design.md §11); `GHOSTS_ENABLED` is the install-wide development
       * switch that makes the queue human-only, so that two devices pairing is
       * something you can actually observe rather than assume.
       */
      /**
       * A challenge never takes a ghost. The whole promise is "you and them",
       * so a bot wearing a stranger's name would be a straight lie — the one
       * place in the product where F6.7.5's silence about ghosts would be
       * dishonest rather than tactful. They wait for each other or they don't
       * play.
       */
      allowGhosts: challenge
        ? false
        : env.GHOSTS_ENABLED && space?.settings?.allowGhosts !== false,
      challengeId: challenge ? String(challenge._id) : null,
    };

    /**
     * Practice has NO OPPONENT — and that is the whole point.
     *
     * It used to be ghost-only: skip the queue, hand over an invented opponent
     * immediately. Which made Practice the one place in the product that
     * *proved* ghosts exist. An opponent that arrives in zero seconds, every
     * time, on the one mode that never touches your rating, is not a subtle
     * signal — and a player who works out that practice opponents are invented
     * has no reason left to believe the ones in Quick and Ranked are not.
     * F6.7.5 asks that the player never be able to tell; the surest way to
     * honour that is to never put a ghost anywhere it can be identified.
     *
     * So practice is a solo drill: you, the questions, the clock. Nothing on
     * screen claims an opponent, so nothing invites the question. The match
     * engine already copes — `opponentOf` returns undefined, every payload
     * guards it, and the round advances when `currentAnswers.size` reaches
     * `players.length`, which is one.
     */
    if (mode === MATCH_MODE.PRACTICE) {
      /**
       * The revision deck is resolved here, from the player's own match history,
       * and never accepted from the client. The ids are the questions they got
       * wrong; a client that could name them could name any question in any
       * space, and `selectQuestions` re-filters them for the same reason.
       *
       * An empty deck is an error rather than a silent fallback to a normal
       * drill. "Revise your mistakes" turning into seven questions you have never
       * seen is the kind of quiet substitution that makes a player stop trusting
       * the button.
       */
      let deckIds = null;
      if (deck === DECK.MISTAKES) {
        deckIds = await mistakeQuestionIds(user.id, topic._id, {
          limit: ROUNDS_PER_MATCH,
          origins: allowedOriginsFor(topic),
          language: entry.language,
        });
        if (!deckIds.length) {
          throw new AppError(
            409,
            ERROR_CODE.BAD_REQUEST,
            'Nothing to revise here — you have got all of these right since.',
          );
        }
      }
      await this.createSoloMatch(entry, { deckIds });
      return { status: 'searching', topicId: entry.topicId };
    }

    /**
     * A self-race skips the queue for the same reason practice does: the opponent
     * is already on disk. There is nobody to wait for.
     */
    if (mode === MATCH_MODE.SELF) {
      /**
       * Checked here, not inside `createSelfMatch`, so the refusal rides back on
       * the ack rather than as an error event.
       *
       * They are not the same to a client: an ack failure is answered where the
       * button was pressed, while an error event arrives after the app has already
       * pushed the searching screen — so the player watches a globe spin and then
       * gets bounced. Same rule as the empty revision deck above.
       */
      const best = await bestReplayFor(user.id, topic._id);
      if (!best) {
        throw new AppError(
          409,
          ERROR_CODE.NO_OPPONENT_FOUND,
          'Play this topic once and your best run becomes something to beat.',
        );
      }
      await this.createSelfMatch(entry, { best });
      return { status: 'searching', topicId: entry.topicId };
    }

    /**
     * Ranked and quick play queue separately.
     *
     * The matchmaker keys its pools on `spaceId:topicId` and reads `spaceId`
     * for nothing else — the match takes its space from the topic — so
     * scoping it by mode here partitions the two queues without touching
     * pairing, which widens on the topic level exactly as before.
     * Sharing a pool would hand one of the two players the wrong stakes: the
     * pair takes a single mode, so someone either gets a ladder result they
     * did not ask for or loses the one they did.
     */
    /**
     * A challenge gets a pool of its own, keyed on the challenge id, which is
     * the entire mechanism: two people and nobody else can key into it, so the
     * matchmaker pairs them and could not pair either of them with a stranger
     * if it tried. No new matching code — just a narrower room.
     */
    this.matchmaker.join({
      ...entry,
      spaceId: challenge ? `challenge:${challenge._id}` : `${entry.spaceId}:${mode}`,
    });
    this.transport.toPlayer(user.id, S2C.QUEUE_SEARCHING, {
      topicId: entry.topicId,
      topicName: topic.name,
      coverUrl: topic.coverUrl,
      /** design.md §8.4 — the searching screen is never visible longer than this. */
      maxWaitMs: this.timing.ghostAfterMs ?? GHOST_AFTER_MS,
      /**
       * What the client stages the wait against: pairing starts at this exact
       * level and opens by one every LEVEL_BAND_STEP_MS, so the searching
       * screen can say what it is doing rather than spin for eight seconds.
       */
      level,
      bandStepMs: LEVEL_BAND_STEP_MS,
      bandMax: LEVEL_BAND_MAX,
    });
    return { status: 'searching', topicId: entry.topicId };
  }

  leaveQueue(userId) {
    // Cancel means cancel: a pending rematch is a queue of one and has to go
    // with it, or accepting it later drops this player into a match they are
    // not on a screen for.
    this.withdrawRematch(userId);
    return this.matchmaker.leave(userId);
  }

  // ── Match construction ───────────────────────────────────────────────────

  async createLiveMatch(a, b) {
    const topic = await Topic.findById(oid(a.topicId)).lean();
    if (!topic) return this.failPair([a, b], ERROR_CODE.TOPIC_UNAVAILABLE, 'Topic unavailable.');

    const questions = await selectQuestions(topic, [a, b], {
      count: ROUNDS_PER_MATCH,
      language: a.language,
    });

    if (questions.length < ROUNDS_PER_MATCH) {
      return this.failPair(
        [a, b],
        ERROR_CODE.TOPIC_NOT_LIVE,
        'This topic does not have enough questions yet.',
      );
    }

    const rounds = questions.map((q) =>
      buildRound(q, { language: a.language, durationMs: a.roundDurationMs }),
    );

    /**
     * The challenge is spent the moment these two are actually paired — see
     * `markChallengePlayed` for why it lands here rather than at the end of the
     * match. Fire-and-forget: a challenge row that fails to update must not
     * cost them the match they are both already waiting on.
     */
    if (a.challengeId && a.challengeId === b.challengeId) {
      markChallengePlayed(a.challengeId).catch((err) =>
        logger.error({ err, challengeId: a.challengeId }, 'could not close challenge'),
      );
    }

    const players = [a, b].map((p) => ({
      userId: p.userId,
      displayName: p.displayName,
      avatarUrl: p.avatarUrl,
      banner: p.banner ?? null,
      country: p.country ?? null,
      city: p.city ?? null,
      rating: p.rating,
      /** What the versus screen shows, and what this pair was matched on. */
      level: p.level ?? 1,
      rankedRating: p.rankedRating ?? RANKED_START,
      isGhost: false,
    }));

    return this.startMatch({ topic, players, rounds, mode: a.mode, language: a.language, roundDurationMs: a.roundDurationMs });
  }

  /**
   * prd.md F6.4.3 / §6.7 — a replay of a real past game on this topic at a
   * similar skill, or a synthetic opponent where none exists yet.
   */
  /**
   * A one-player match: practice.
   *
   * Deliberately NOT `createGhostMatch` with the ghost left out. This never
   * looks for a replay and never builds a synthetic opponent, so there is no
   * path by which a practice run can acquire an opponent — including when a
   * future change to the ghost builder forgets that practice exists.
   *
   * `allowGhosts` is not consulted: a space that switched invented opponents off
   * has no objection to a player drilling alone, and refusing them practice
   * because of a setting about opponents would be a strange reading of it.
   */
  async createSoloMatch(waiting, { deckIds = null } = {}) {
    const topic = await Topic.findById(oid(waiting.topicId)).lean();
    if (!topic) return this.failPair([waiting], ERROR_CODE.TOPIC_UNAVAILABLE, 'Topic unavailable.');

    // Same call the ghost path makes: `excludeSeen` defaults on, so a drill
    // prefers questions this player has not met yet. A revision deck is the one
    // case that wants the opposite, and says so with `deckIds`.
    const questions = await selectQuestions(topic, [waiting], {
      count: ROUNDS_PER_MATCH,
      language: waiting.language,
      deckIds,
    });
    if (questions.length < ROUNDS_PER_MATCH) {
      return this.failPair(
        [waiting],
        ERROR_CODE.TOPIC_NOT_LIVE,
        'This topic does not have enough questions yet.',
      );
    }

    const rounds = questions.map((q) =>
      buildRound(q, { language: waiting.language, durationMs: waiting.roundDurationMs }),
    );

    return this.startMatch({
      topic,
      // One entry. Everything downstream reads `players.length`, so the round
      // resolves on this player's answer alone and `opponent` is null in every
      // payload the client receives.
      players: [
        {
          userId: waiting.userId,
          displayName: waiting.displayName,
          avatarUrl: waiting.avatarUrl,
          banner: waiting.banner ?? null,
          country: waiting.country ?? null,
          city: waiting.city ?? null,
          rating: waiting.rating,
          level: waiting.level ?? 1,
          rankedRating: waiting.rankedRating ?? RANKED_START,
          isGhost: false,
        },
      ],
      rounds,
      mode: waiting.mode,
      language: waiting.language,
      roundDurationMs: waiting.roundDurationMs,
    });
  }

  /**
   * You against your own best run on this topic.
   *
   * `Replay` has stored a complete answer script for every decent match since
   * F6.7.1, and until now the only thing that ever read one was the ghost picker —
   * so the richest record a player has of their own play was invisible to them and
   * spent entirely on strangers. This is that data pointed back at its owner.
   *
   * ── Why it is disclosed, when a ghost never is ───────────────────────────────
   *
   * Every argument for hiding a replay's identity is an argument for showing this
   * one. A ghost is masked because it belongs to somebody else and playing them
   * without their knowledge would disclose their result; here the person the run
   * belongs to is the person watching it, so the name, the face and the date are
   * theirs to see. It is also the whole point: "beat your best" means nothing if
   * the app will not say whose best it is.
   *
   * ── Why it cannot be ranked, and pays nothing ────────────────────────────────
   *
   * The paper is the one that run was played on, so the player has seen every
   * question. Re-running it until it wins is a couple of taps. `MATCH_MODE.SELF`
   * is therefore in `UNRECORDED_MODES` — participation XP and mastery stats, no
   * coins, no W/L record, no assignment credit, and never harvested as a replay
   * for anybody else.
   */
  async createSelfMatch(waiting, { best: preloaded = null } = {}) {
    const topic = await Topic.findById(oid(waiting.topicId)).lean();
    if (!topic) return this.failPair([waiting], ERROR_CODE.TOPIC_UNAVAILABLE, 'Topic unavailable.');

    // Normally handed in by `joinQueue`, which has already refused the no-run
    // case on the ack. Re-read only if a caller did not, so this stays correct
    // when called directly.
    const best = preloaded ?? (await bestReplayFor(waiting.userId, topic._id));
    if (!best) {
      return this.failPair(
        [waiting],
        ERROR_CODE.NO_OPPONENT_FOUND,
        'Play this topic once and your best run becomes something to beat.',
      );
    }

    /**
     * The ORIGINAL paper, in its original order. A different set of questions
     * would make the recorded answers meaningless — the script is a list of
     * choices indexed by round, so round 3 has to be the question round 3 was.
     */
    const docs = await Question.find({ _id: { $in: best.questionIds } }).lean();
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    const ordered = best.questionIds.map((id) => byId.get(String(id))).filter(Boolean);

    if (ordered.length !== ROUNDS_PER_MATCH) {
      // A question has been retired since. The run is unrepeatable rather than
      // broken, and saying so beats dealing six rounds against a seven-round score.
      return this.failPair(
        [waiting],
        ERROR_CODE.NO_OPPONENT_FOUND,
        'That run cannot be replayed — some of its questions have changed since.',
      );
    }

    const rounds = ordered.map((q) =>
      buildRound(q, { language: waiting.language, durationMs: waiting.roundDurationMs }),
    );

    return this.startMatch({
      topic,
      players: [
        {
          userId: waiting.userId,
          displayName: waiting.displayName,
          avatarUrl: waiting.avatarUrl,
          banner: waiting.banner ?? null,
          country: waiting.country ?? null,
          city: waiting.city ?? null,
          rating: waiting.rating,
          level: waiting.level ?? 1,
          rankedRating: waiting.rankedRating ?? RANKED_START,
          isGhost: false,
        },
        {
          /**
           * Your own name and face, on purpose — and a fresh id, because the
           * engine keys players by `userId` and two entries sharing one id would
           * make every lookup ambiguous. The client is told which side is the
           * recording by `isSelf` and by the date.
           */
          userId: String(new mongoose.Types.ObjectId()),
          displayName: waiting.displayName,
          avatarUrl: waiting.avatarUrl,
          banner: waiting.banner ?? null,
          country: waiting.country ?? null,
          city: waiting.city ?? null,
          rating: best.playerRating ?? waiting.rating,
          level: best.playerLevel ?? waiting.level ?? 1,
          rankedRating: waiting.rankedRating ?? RANKED_START,
          /**
           * `isGhost` is what makes the engine drive it from the script. It is a
           * statement about how the seat is played, not about who is in it — and
           * `isGhost` also keeps the finaliser from writing a rating for a player
           * who does not exist, which is exactly right here.
           */
          isGhost: true,
          /** Read by the client to label the seat honestly. */
          isSelf: true,
          recordedAt: best.createdAt,
          sourceMatchId: String(best.matchId),
          script: best.answers,
        },
      ],
      rounds,
      mode: waiting.mode,
      language: waiting.language,
      roundDurationMs: waiting.roundDurationMs,
    });
  }

  async createGhostMatch(waiting) {
    /**
     * Refusing ghosts has to mean refusing *both* kinds.
     *
     * This used to skip only the replay lookup and then fall straight through
     * to the synthetic builder below, so `allowGhosts: false` bought a space
     * an invented opponent instead of a replayed one — the opposite of what it
     * says, and undetectable from the app, which F6.7.5 keeps deliberately
     * silent about who it paired you with.
     */
    if (waiting.allowGhosts === false) {
      return this.failPair(
        [waiting],
        ERROR_CODE.NO_OPPONENT_FOUND,
        'Nobody else is playing this topic right now. Try again in a moment.',
      );
    }

    const topic = await Topic.findById(oid(waiting.topicId)).lean();
    if (!topic) return this.failPair([waiting], ERROR_CODE.TOPIC_UNAVAILABLE, 'Topic unavailable.');

    let ghost = null;
    let rounds = null;

    const replay = await findReplay({
      topicId: topic._id,
      spaceId: topic.spaceId,
      rating: waiting.rating,
      level: waiting.level,
      excludeUserId: waiting.userId,
    });

    if (replay) {
      // Replaying the ORIGINAL question set is what makes the ghost's
      // answers meaningful — a different set would make its script noise.
      const docs = await Question.find({ _id: { $in: replay.questionIds } }).lean();
      const byId = new Map(docs.map((d) => [String(d._id), d]));
      const ordered = replay.questionIds.map((id) => byId.get(String(id))).filter(Boolean);

      if (ordered.length === ROUNDS_PER_MATCH) {
        rounds = ordered.map((q) =>
          buildRound(q, { language: waiting.language, durationMs: waiting.roundDurationMs }),
        );
        ghost = {
          /**
           * A synthetic face over a real performance — see `syntheticIdentity`.
           * The replay's own name, avatar, id and city used to go out here, so
           * in an organization of five people you played your classmate at
           * midnight while they were asleep, and their result was disclosed to
           * you. The script below is still theirs; nothing identifying is.
           */
          ...syntheticIdentity({ country: replay.country ?? waiting.country }),
          city: null,
          rating: replay.playerRating,
          /**
           * Replays written before levels were recorded have none. Showing
           * the waiting player's own level is the honest fallback: the
           * replay was picked inside their rating band, so that is the
           * closest true statement available, and a blank level on one side
           * of the versus screen would single the ghost out (F6.7.5).
           */
          level: replay.playerLevel ?? waiting.level ?? 1,
          /**
           * A plausible standing near the player's own, not the replayed
           * account's live ladder.
           *
           * Reading their real `rankedRating` was the last thread back to the
           * person: it is visible as a league badge on the versus screen, so a
           * classmate's exact division was on display beside a name that is now
           * synthetic — and in a small organization a badge is nearly as
           * identifying as the name was. Their ladder was never touched by this
           * match (F6.7.6); it is now not read either.
           */
          rankedRating: Math.max(
            RANKED_FLOOR,
            Math.round((waiting.rankedRating ?? RANKED_START) + (Math.random() * 100 - 50)),
          ),
          isGhost: true,
          sourceMatchId: String(replay.matchId),
          script: replay.answers,
        };
        markReplayUsed(replay._id);
      }
    }

    if (!ghost) {
      const questions = await selectQuestions(topic, [waiting], {
        count: ROUNDS_PER_MATCH,
        language: waiting.language,
      });
      if (questions.length < ROUNDS_PER_MATCH) {
        return this.failPair(
          [waiting],
          ERROR_CODE.TOPIC_NOT_LIVE,
          'This topic does not have enough questions yet.',
        );
      }
      rounds = questions.map((q) =>
        buildRound(q, { language: waiting.language, durationMs: waiting.roundDurationMs }),
      );

      const synthetic = await buildSyntheticOpponent({
        topicId: topic._id,
        rating: waiting.rating,
        level: waiting.level,
        rankedRating: waiting.rankedRating,
        // Borrowed so the invented flag is a plausible neighbour, not a tell.
        country: waiting.country ?? null,
        roundDurationMs: waiting.roundDurationMs,
      });
      ghost = { ...synthetic, script: bindSyntheticScript(synthetic.script, rounds) };
    }

    const players = [
      {
        userId: waiting.userId,
        displayName: waiting.displayName,
        avatarUrl: waiting.avatarUrl,
        // Kept in step with the live path above — a player who drew a ghost
        // must still see their own banner and flag on the versus screen.
        banner: waiting.banner ?? null,
        country: waiting.country ?? null,
        city: waiting.city ?? null,
        rating: waiting.rating,
        level: waiting.level ?? 1,
        rankedRating: waiting.rankedRating ?? RANKED_START,
        isGhost: false,
      },
      ghost,
    ];

    return this.startMatch({
      topic,
      players,
      rounds,
      mode: waiting.mode,
      language: waiting.language,
      roundDurationMs: waiting.roundDurationMs,
    });
  }

  /**
   * prd.md F7.5 — enter a contest.
   *
   * A contest match is an ordinary match with three differences, all of them
   * here rather than in the engine:
   *
   *   - the questions are the contest's **frozen** set, in the contest's order,
   *     so every entrant sits the same paper;
   *   - the opponent is drawn only from other entrants of this contest, or is
   *     synthetic when nobody has played yet — the replay pool is partitioned
   *     so the paper cannot escape to casual play while the contest is open;
   *   - the entry row is claimed *before* the match starts, so a double tap
   *     produces one entry and one clear error, not two runs.
   */
  async enterContest({ user, contestId }) {
    if (registry.matchForUser(user.id)) {
      throw new AppError(409, ERROR_CODE.ALREADY_IN_MATCH, 'You are already in a match.');
    }
    if (!mongoose.isValidObjectId(contestId)) {
      throw new AppError(404, ERROR_CODE.CONTEST_NOT_FOUND, 'No such contest.');
    }

    const contest = await Contest.findById(oid(contestId));
    if (!contest) throw new AppError(404, ERROR_CODE.CONTEST_NOT_FOUND, 'No such contest.');

    // Membership is resolved from the contest's own space, never from anything
    // the client sent — the same rule resolvePlayableTopic follows for topics.
    const scope = await resolveScope(user, contest.spaceId);
    await assertCanEnter(scope, contest, user.id);

    const questionIds = await lockContestQuestions(contest);

    const topic = await Topic.findById(contest.topicIds[0]).lean();
    if (!topic) {
      throw new AppError(409, ERROR_CODE.TOPIC_UNAVAILABLE, 'This contest has no usable topic.');
    }

    // Fixed order. `$in` returns documents in whatever order Mongo likes, so
    // the ids drive the sequence rather than the result set.
    const docs = await Question.find({ _id: { $in: questionIds } }).lean();
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    const ordered = questionIds.map((id) => byId.get(String(id))).filter(Boolean);

    if (ordered.length < questionIds.length) {
      logger.warn(
        { contestId: String(contest._id), want: questionIds.length, got: ordered.length },
        'contest paper has missing questions',
      );
    }
    if (!ordered.length) {
      throw new AppError(
        409,
        ERROR_CODE.CONTEST_NOT_ENOUGH_QUESTIONS,
        'This contest has no playable questions.',
      );
    }

    const space = scope.space ?? (await Space.findById(contest.spaceId).lean());
    const roundDurationMs =
      this.timing.roundDurationMs ??
      contest.roundDurationMs ??
      space?.settings?.roundDurationMs ??
      ROUND_DURATION_MS;

    const language = topic.languages?.[0] ?? DEFAULT_LANGUAGE;
    const rounds = ordered.map((q) => buildRound(q, { language, durationMs: roundDurationMs }));
    const rating = await getRatingValue(user.id, topic._id);

    // Claim the single entry before anything is emitted. If this throws the
    // student simply never sees a match, which is the correct outcome.
    const matchId = new mongoose.Types.ObjectId();
    await openEntry({ contest, scope, user, matchId });

    const ghost = await this.contestOpponent({ contest, rounds, waiting: { rating, roundDurationMs, userId: String(user.id), country: user.country ?? null }, topic });

    const players = [
      {
        userId: String(user.id),
        displayName: user.displayName,
        avatarUrl: user.avatarUrl ?? null,
        rating,
        isGhost: false,
      },
      ghost,
    ];

    await this.startMatch({
      matchId,
      topic: { ...topic, name: contest.name, coverUrl: topic.coverUrl },
      players,
      rounds,
      mode: MATCH_MODE.CONTEST,
      language,
      roundDurationMs,
      contestId: String(contest._id),
    });

    return { status: 'entered', contestId: String(contest._id), matchId: String(matchId) };
  }

  /** Another entrant's run if one exists, otherwise a synthetic pace-setter. */
  async contestOpponent({ contest, rounds, waiting, topic }) {
    const replay = await findReplay({
      topicId: topic._id,
      spaceId: contest.spaceId,
      rating: waiting.rating,
      excludeUserId: waiting.userId,
      contestId: contest._id,
    });

    if (replay && replay.questionIds.length === rounds.length) {
      markReplayUsed(replay._id);
      // Same masking as ordinary play — and it matters more here, because a
      // contest's entrants are by definition all in the same organization.
      return {
        ...syntheticIdentity({ country: replay.country ?? waiting.country }),
        city: null,
        rating: replay.playerRating,
        isGhost: true,
        sourceMatchId: String(replay.matchId),
        script: replay.answers,
      };
    }

    const synthetic = await buildSyntheticOpponent({
      topicId: topic._id,
      rating: waiting.rating,
      country: waiting.country ?? null,
      roundDurationMs: waiting.roundDurationMs,
      rounds: rounds.length,
    });
    return { ...synthetic, script: bindSyntheticScript(synthetic.script, rounds) };
  }

  async startMatch({ topic, players, rounds, mode, language, roundDurationMs, contestId = null, matchId: providedId }) {
    const matchId = providedId ?? new mongoose.Types.ObjectId();

    const match = new LiveMatch({
      id: matchId,
      topic: {
        id: String(topic._id),
        name: topic.name,
        slug: topic.slug,
        coverUrl: topic.coverUrl ?? null,
      },
      spaceId: topic.spaceId,
      mode,
      language,
      contestId,
      rounds,
      players,
      roundDurationMs,
      roundResultMs: this.timing.roundResultMs,
      /**
       * A one-player match does not pay for a ceremony it never sees.
       *
       * The countdown exists to cover the versus screen, and `searching.jsx`
       * routes a match with no opponent straight to the board — so for a drill
       * this was five and a half seconds of an empty question card. See
       * `SOLO_COUNTDOWN_MS`.
       *
       * A self-race is NOT included: it has two players and it does show the
       * versus screen, with your own recorded run on the other side. Keyed on
       * the player count rather than on the mode for exactly that reason — the
       * question is "is there a second face to introduce", and the player count
       * is the only thing that actually answers it.
       *
       * A test-supplied override still wins, because the suites that set it run
       * drills too and expect their own pacing.
       */
      countdownMs:
        this.timing.countdownMs ?? (players.length === 1 ? SOLO_COUNTDOWN_MS : undefined),
      disconnectGraceMs: this.timing.disconnectGraceMs,
      transport: this.transport,
      hooks: {
        onComplete: (_m, summary) => this.onMatchComplete(summary),
        onFinished: (m) => registry.removeMatch(m.id),
        onResultForPlayer: (userId, payload) => this.rememberResult(userId, payload),
        onError: (err) => logger.error({ err }, 'match hook failed'),
      },
    });

    registry.addMatch(match);

    /**
     * Who actually got paired, at info level, at the moment it happens.
     *
     * F6.7.5 forbids the *app* from telling the player whether their opponent
     * was real, which also leaves whoever is testing the app with no way to
     * tell. The server log is the honest place for it: `vs: "human"` on one
     * line is the whole answer to "did those two phones find each other?".
     */
    const ghosts = players.filter((p) => p.isGhost);
    logger.info(
      {
        evt: 'match.start',
        matchId: String(matchId),
        mode,
        topic: topic.name,
        vs: ghosts.length === 0 ? 'human' : ghosts[0].isSynthetic ? 'synthetic' : 'replay',
        players: players.map((p) => `${p.displayName}${p.isGhost ? ' (ghost)' : ''} L${p.level ?? 1}`),
      },
      'match starting',
    );

    try {
      await createLiveMatchRecord({
        matchId,
        topicId: topic._id,
        spaceId: topic.spaceId,
        mode,
        language,
        players,
        questionIds: rounds.map((r) => r.questionId),
        roundDurationMs,
        contestId,
      });
    } catch (err) {
      logger.error({ err }, 'could not write live match record');
    }

    // prd.md F6.4.4 — the versus screen, with both ratings and any head-to-head.
    await Promise.all(
      match.humanPlayers.map(async (player) => {
        const opponent = match.opponentOf(player.userId);
        const h2h = opponent && !opponent.isGhost
          ? await headToHead(player.userId, opponent.userId).catch(() => null)
          : null;

        this.transport.toPlayer(player.userId, S2C.MATCH_FOUND, {
          matchId: match.id,
          topic: match.topic,
          /**
           * Both standings, for both players. `level` is the topic level this
           * pair was matched on and the only level the screen shows;
           * `rankedRating` is the global ladder the league badge reads. The
           * topic `rating` is still sent for the match record and the result
           * screen — the versus screen deliberately does not draw it.
           */
          you: {
            id: player.userId,
            displayName: player.displayName,
            avatarUrl: player.avatarUrl,
            banner: player.banner ?? null,
            country: player.country ?? null,
            city: player.city ?? null,
            rating: player.rating,
            level: player.level ?? 1,
            rankedRating: player.rankedRating ?? RANKED_START,
          },
          // prd.md F6.7.5 — nothing here reveals that the opponent is a ghost.
          opponent: opponent
            ? {
                id: opponent.userId,
                displayName: opponent.displayName,
                avatarUrl: opponent.avatarUrl,
                banner: opponent.banner ?? null,
                country: opponent.country ?? null,
                city: opponent.city ?? null,
                rating: opponent.rating,
                level: opponent.level ?? 1,
                rankedRating: opponent.rankedRating ?? RANKED_START,
              }
            : null,
          headToHead: h2h,
          totalRounds: match.totalRounds,
          roundDurationMs: match.roundDurationMs,
          countdownMs: match.countdownMs,
          mode,
          contestId,
        });
      }),
    );

    match.start();
    return match;
  }

  async onMatchComplete(summary) {
    logMatchSummary(summary);
    try {
      return await finalizeMatch(summary);
    } catch (err) {
      logger.error({ err, matchId: summary.matchId }, 'finalizeMatch failed');
      return { perPlayer: {} };
    }
  }

  failPair(entries, code, message) {
    for (const entry of entries) {
      this.transport.toPlayer(entry.userId, S2C.ERROR, { code, message });
    }
  }

  // ── In-match actions ─────────────────────────────────────────────────────

  answer(userId, { matchId, roundIndex, optionIndex }) {
    const match = registry.getMatch(String(matchId)) ?? registry.matchForUser(userId);
    if (!match) {
      return { ok: false, code: ERROR_CODE.MATCH_NOT_FOUND, message: 'That match has ended.' };
    }
    if (match.id !== String(matchId)) {
      return { ok: false, code: ERROR_CODE.MATCH_NOT_FOUND, message: 'That match has ended.' };
    }
    return match.submitAnswer(userId, roundIndex, optionIndex);
  }

  leaveMatch(userId, matchId) {
    const match = registry.getMatch(String(matchId)) ?? registry.matchForUser(userId);
    if (!match) return false;
    match.forfeit(userId);
    return true;
  }

  handleDisconnect(userId) {
    this.matchmaker.leave(userId);
    const match = registry.matchForUser(userId);
    if (match) match.handleDisconnect(userId);
  }

  handleReconnect(userId) {
    const match = registry.matchForUser(userId);
    if (!match) return null;
    return match.handleReconnect(userId);
  }

  /** Keep a finished match's payload briefly — see `recentResults`. */
  rememberResult(userId, payload) {
    const key = String(userId);
    this.recentResults.set(key, { payload, at: Date.now() });
    const timer = setTimeout(() => this.recentResults.delete(key), MISSED_RESULT_TTL_MS);
    timer.unref?.();
  }

  /**
   * The result of a match that ended while this player was away, if there is
   * one recent enough to still be worth showing.
   */
  missedResult(userId) {
    const entry = this.recentResults.get(String(userId));
    if (!entry) return null;
    if (Date.now() - entry.at > MISSED_RESULT_TTL_MS) {
      this.recentResults.delete(String(userId));
      return null;
    }
    return entry.payload;
  }

  /** Once delivered it must not arrive a second time on the next connect. */
  clearMissedResult(userId) {
    this.recentResults.delete(String(userId));
  }

  snapshotFor(userId) {
    const match = registry.matchForUser(userId);
    return match ? match.snapshotFor(userId) : null;
  }

  /**
   * prd.md §6.3 — rematch the same opponent, if still online. Both sides have
   * to ask; a one-sided request simply expires.
   */
  async requestRematch(user, matchId) {
    const key = String(matchId);
    const requests = this.rematchRequests.get(key) ?? new Set();
    requests.add(String(user.id));
    this.rematchRequests.set(key, requests);
    /**
     * The window closes, and everybody waiting is told that it has.
     *
     * It used to expire in silence, which left the asker on a searching screen
     * with nothing coming: no match, no error, and no client-side watchdog on
     * this path either. Whoever is still listed when the timer fires gets an
     * explicit "not this time" and can go back to the result screen.
     */
    clearTimeout(this.rematchTimers.get(key));
    const expiry = setTimeout(() => {
      const pending = this.rematchRequests.get(key);
      this.rematchRequests.delete(key);
      this.rematchTimers.delete(key);
      for (const waitingId of pending ?? []) {
        this.transport.toPlayer(waitingId, S2C.MATCH_REMATCH_DECLINED, {
          matchId: key,
          reason: 'expired',
        });
      }
    }, REMATCH_WINDOW_MS);
    expiry.unref?.();
    this.rematchTimers.set(key, expiry);

    const { Match } = await import('../models/index.js');
    const record = await Match.findById(oid(matchId)).lean();
    if (!record) {
      throw new AppError(404, ERROR_CODE.MATCH_NOT_FOUND, 'That match has ended.');
    }

    const me = record.players.find((p) => String(p.userId) === String(user.id));
    const them = record.players.find((p) => String(p.userId) !== String(user.id));
    if (!me) throw new AppError(403, ERROR_CODE.MATCH_NOT_FOUND, 'You were not in that match.');

    /**
     * A rematch repeats the match it came from, stakes included — agreeing to
     * go again is not agreeing to play for something else. A contest entry has
     * no rematch to give, so it falls back to an ordinary quick game.
     */
    const mode = QUEUEABLE_MODES.includes(record.mode) ? record.mode : MATCH_MODE.QUICK;

    // A ghost is always available — that is rather the point of it.
    if (them?.isGhost) {
      return this.joinQueue({ user, topicId: record.topicId, spaceId: record.spaceId, mode });
    }

    if (!registry.isOnline(them.userId)) {
      throw new AppError(409, ERROR_CODE.MATCH_NOT_FOUND, 'They have gone offline.');
    }

    if (requests.has(String(them.userId))) {
      this.rematchRequests.delete(key);
      clearTimeout(this.rematchTimers?.get(key));
      this.rematchTimers?.delete(key);
      const [aUser, bUser] = await Promise.all([
        User.findById(oid(user.id)).lean(),
        User.findById(oid(them.userId)).lean(),
      ]);
      const topic = await Topic.findById(oid(record.topicId)).lean();
      const space = await Space.findById(oid(record.spaceId)).lean();
      /**
       * The same identity a fresh queue entry carries.
       *
       * Everything the versus screen draws has to be named here — see the note
       * in matchEngine's player mapping. Building these from `_id`, name and
       * avatar alone is why every rematch opened on two "Level 1" players with
       * fallback banners and no flags, against rivals who had just played a
       * full match at their real standing.
       */
      const entryFor = async (u) => {
        const { rating, level } = await getRatingEntry(u._id, topic._id);
        return {
          userId: String(u._id),
          displayName: u.displayName,
          avatarUrl: u.avatarUrl ?? null,
          banner: u.banner ?? null,
          country: u.country ?? null,
          city: u.city ?? null,
          rating,
          level,
          rankedRating: u.rankedRating ?? RANKED_START,
          topicId: String(topic._id),
          spaceId: String(topic.spaceId),
          mode,
          language: record.language,
          // The space's own setting wins (design.md §11 makes it configurable
          // per Space); `timing` is a test seam so a match need not take 90s.
          roundDurationMs:
            this.timing.roundDurationMs ?? space?.settings?.roundDurationMs ?? ROUND_DURATION_MS,
        };
      };
      await this.createLiveMatch(await entryFor(aUser), await entryFor(bUser));
      return { status: 'rematched' };
    }

    /**
     * Ask the other side, on an event that means only this.
     *
     * It used to go out as `match:opponent_rejoined` with a `rematchRequested`
     * flag on it, and the client's handler for that event does one thing —
     * mark the opponent connected — so the invitation was received and thrown
     * away. Nobody was ever asked anything, and the handshake only completed
     * when both players happened to press Rematch inside the same 30 seconds.
     */
    this.transport.toPlayer(them.userId, S2C.MATCH_REMATCH_REQUESTED, {
      matchId: key,
      expiresInMs: REMATCH_WINDOW_MS,
      from: {
        id: String(user.id),
        displayName: user.displayName,
        avatarUrl: user.avatarUrl ?? null,
      },
    });
    return { status: 'requested' };
  }

  /**
   * Withdraw a pending rematch — the asker changed their mind.
   *
   * Cancelling only left the matchmaker pool, so the request stayed live and
   * the opponent accepting it seconds later started a real ranked match for
   * somebody who had already walked away: battle music on the home screen,
   * seven rounds timed out, rating lost, no match screen ever mounted.
   */
  withdrawRematch(userId) {
    const me = String(userId);
    let withdrawn = 0;
    for (const [key, requests] of this.rematchRequests) {
      if (!requests.delete(me)) continue;
      withdrawn += 1;
      if (requests.size === 0) {
        this.rematchRequests.delete(key);
        clearTimeout(this.rematchTimers?.get(key));
        this.rematchTimers?.delete(key);
      }
    }
    return withdrawn;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  stats() {
    return { ...registry.stats(), queue: this.matchmaker.stats() };
  }

  /** tech.md §16 — drain before cycling the process: no new matches, finish live ones. */
  async drain({ timeoutMs = 60_000 } = {}) {
    this.matchmaker.clear();
    const deadline = Date.now() + timeoutMs;
    while (registry.stats().liveMatches > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }
    registry.clear();
  }

  dispose() {
    this.matchmaker.clear();
    registry.clear();
    this.rematchRequests.clear();
    for (const timer of this.rematchTimers.values()) clearTimeout(timer);
    this.rematchTimers.clear();
    this.recentResults.clear();
  }
}

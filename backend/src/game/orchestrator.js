import mongoose from 'mongoose';
import { Question, Topic, Space, User, Contest } from '../models/index.js';
import { LiveMatch } from './matchEngine.js';
import { Matchmaker } from './matchmaker.js';
import { registry } from './registry.js';
import { selectQuestions, buildRound } from './questionSelector.js';
import { findReplay, markReplayUsed, buildSyntheticOpponent, bindSyntheticScript } from './ghostService.js';
import { createLiveMatchRecord, finalizeMatch, headToHead } from '../services/matchService.js';
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
  ROUND_DURATION_MS,
  MATCH_MODE,
  MIN_PUBLISHED_QUESTIONS_TO_LIVE,
  DEFAULT_LANGUAGE,
  GHOST_AFTER_MS,
  LEVEL_BAND_MAX,
  LEVEL_BAND_STEP_MS,
  RANKED_START,
} from '../shared/constants.js';
import { logger, logMatchSummary } from '../lib/logger.js';
import { AppError } from '../lib/errors.js';
import { env } from '../config/env.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * The ladder standing of a replayed player, for the versus badge only.
 *
 * Falls back to the waiting player's own standing rather than to a constant: if
 * the account has since been deleted, a badge matching the live player is far
 * less conspicuous than a Bronze I badge on an opponent who plays like a
 * veteran (F6.7.5).
 */
async function rankedRatingOf(userId, fallback) {
  const row = await User.findById(oid(userId), { rankedRating: 1 })
    .lean()
    .catch(() => null);
  return row?.rankedRating ?? fallback ?? RANKED_START;
}

/**
 * The modes a player may put themselves in a queue for
 * (leagues-and-progression.md §1). A contest is entered by id from the contest
 * screen, and a challenge is created rather than queued for.
 */
const QUEUEABLE_MODES = [MATCH_MODE.QUICK, MATCH_MODE.RANKED, MATCH_MODE.PRACTICE];

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

    this.matchmaker = new Matchmaker({
      onPair: (a, b) => this.createLiveMatch(a, b),
      onGhost: (waiting) => this.createGhostMatch(waiting),
      onExpire: (waiting) =>
        this.failPair(
          [waiting],
          ERROR_CODE.NO_OPPONENT_FOUND,
          'Nobody else is playing this topic right now. Try again in a moment.',
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
  async joinQueue({ user, topicId, spaceId, mode = MATCH_MODE.RANKED, challengeId = null }) {
    if (registry.matchForUser(user.id)) {
      throw new AppError(409, ERROR_CODE.ALREADY_IN_MATCH, 'You are already in a match.');
    }

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

    // Practice is ghost-only by definition — skip the queue entirely. With no
    // ghost to give it there is no practice match to build, and saying so is
    // better than queueing them for a live opponent they did not ask for.
    if (mode === MATCH_MODE.PRACTICE) {
      if (!entry.allowGhosts) {
        throw new AppError(
          409,
          ERROR_CODE.NO_OPPONENT_FOUND,
          'Practice needs a practice opponent, and they are switched off here.',
        );
      }
      await this.createGhostMatch(entry);
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
          userId: String(replay.userId),
          displayName: replay.displayName,
          avatarUrl: replay.avatarUrl,
          /**
           * Where that run was actually played from. Replays written before
           * this was recorded have none, and a blank place on one half of
           * the versus screen is precisely the tell F6.7.5 forbids — so the
           * fallback is the waiting player's own country, which is where a
           * live opponent most often is anyway.
           */
          country: replay.country ?? waiting.country ?? null,
          city: replay.city ?? null,
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
           * The replayed player's real standing today. Their ladder is not
           * touched by this match (F6.7.6) — it is read only so the versus
           * screen can draw a badge on both sides, since a missing one would
           * mark the ghost out (F6.7.5).
           */
          rankedRating: await rankedRatingOf(replay.userId, waiting.rankedRating),
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
      return {
        userId: String(replay.userId),
        displayName: replay.displayName,
        avatarUrl: replay.avatarUrl,
        country: replay.country ?? waiting.country ?? null,
        city: replay.city ?? null,
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
      countdownMs: this.timing.countdownMs,
      disconnectGraceMs: this.timing.disconnectGraceMs,
      transport: this.transport,
      hooks: {
        onComplete: (_m, summary) => this.onMatchComplete(summary),
        onFinished: (m) => registry.removeMatch(m.id),
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
    setTimeout(() => this.rematchRequests.delete(key), 30_000).unref?.();

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
      const [aUser, bUser] = await Promise.all([
        User.findById(oid(user.id)).lean(),
        User.findById(oid(them.userId)).lean(),
      ]);
      const topic = await Topic.findById(oid(record.topicId)).lean();
      const space = await Space.findById(oid(record.spaceId)).lean();
      const entryFor = async (u) => ({
        userId: String(u._id),
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        rating: await getRatingValue(u._id, topic._id),
        topicId: String(topic._id),
        spaceId: String(topic.spaceId),
        mode,
        language: record.language,
        // The space's own setting wins (design.md §11 makes it configurable per
      // Space); `timing` is a test seam so a full match need not take 90s.
      roundDurationMs:
        this.timing.roundDurationMs ?? space?.settings?.roundDurationMs ?? ROUND_DURATION_MS,
      });
      await this.createLiveMatch(await entryFor(aUser), await entryFor(bUser));
      return { status: 'rematched' };
    }

    // Ask the other side. If they never answer, the request simply expires.
    this.transport.toPlayer(them.userId, S2C.MATCH_OPPONENT_REJOINED, {
      matchId: key,
      rematchRequested: true,
      from: { id: String(user.id), displayName: user.displayName },
    });
    return { status: 'requested' };
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
  }
}

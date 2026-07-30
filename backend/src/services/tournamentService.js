import mongoose from 'mongoose';
import { Tournament, Topic, SpaceMember, Rating } from '../models/index.js';
import { Challenge } from '../models/social.js';
import { notify } from './notificationService.js';
import { assertPermission } from './spaceService.js';
import { NotFoundError, BadRequestError, ConflictError } from '../lib/errors.js';
import { TOURNAMENT_SIZES, TOURNAMENT_TIE_WINDOW_MS } from '../shared/constants.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Knockout tournaments — a bracket between classmates.
 *
 * A contest measures a cohort; a bracket produces a story. Both are worth having
 * and they are not substitutes: a contest has one moment and a table, a bracket
 * has quarter-finals, a semi somebody nearly lost, and a name at the end.
 *
 * Every tie is played as a `Challenge` — the existing private two-person queue.
 * Nothing here touches the engine, the matchmaker or the match record; the whole
 * feature is seeding, bookkeeping and advancement.
 */

// ── Seeding ────────────────────────────────────────────────────────────────

/**
 * The standard bracket order for a field of `n`, as seed numbers.
 *
 * `seedOrder(8)` is `[1,8,5,4,3,6,7,2]`, which pairs 1v8, 5v4, 3v6, 7v2. The
 * property that makes it the standard — and the reason this is a recursion rather
 * than a hand-written table — is that the two top seeds can only meet in the
 * final, the top four only in the semis, and so on down. Pairing 1v2, 3v4 instead
 * would knock the two best players out in round one half the time, which is
 * exactly the tournament nobody wants to be in.
 *
 * Each round doubles the field by reflecting it: a slot holding seed `s` in a
 * bracket of `n` becomes `s` and `2n+1-s` in a bracket of `2n`.
 */
export function seedOrder(n) {
  let order = [1];
  while (order.length < n) {
    const size = order.length * 2;
    const next = [];
    for (const seed of order) {
      next.push(seed, size + 1 - seed);
    }
    order = next;
  }
  return order;
}

/** "Final", "Semi-final", … counting backwards from the last round. */
function roundName(roundIndex, totalRounds) {
  const fromEnd = totalRounds - roundIndex;
  if (fromEnd === 1) return 'Final';
  if (fromEnd === 2) return 'Semi-final';
  if (fromEnd === 3) return 'Quarter-final';
  return `Round of ${2 ** fromEnd}`;
}

// ── Admin: authoring ───────────────────────────────────────────────────────

async function findInScope(scope, tournamentId) {
  if (!mongoose.isValidObjectId(tournamentId)) throw new NotFoundError('No such tournament.');
  const row = await Tournament.findOne({ _id: oid(tournamentId), spaceId: scope.spaceId });
  if (!row) throw new NotFoundError('No such tournament.');
  return row;
}

export async function createTournament(scope, user, input) {
  assertPermission(scope, 'manageContests');

  const topic = await Topic.findOne({
    _id: oid(input.topicId),
    spaceId: scope.spaceId,
  }).lean();
  if (!topic) throw new BadRequestError('That topic is not in this organization.', 'TOPIC_NOT_IN_SPACE');

  const size = TOURNAMENT_SIZES.includes(Number(input.size)) ? Number(input.size) : 8;

  const tournament = await Tournament.create({
    spaceId: scope.spaceId,
    name: input.name,
    topicId: topic._id,
    size,
    batchIds: (input.batchIds ?? []).map(oid),
    status: 'open',
    createdBy: user._id,
  });

  return shapeTournament(tournament, { viewerId: user._id });
}

export async function cancelTournament(scope, tournamentId) {
  assertPermission(scope, 'manageContests');
  const tournament = await findInScope(scope, tournamentId);
  if (tournament.status === 'complete') {
    throw new ConflictError('That tournament has already finished.', 'ALREADY_COMPLETE');
  }

  tournament.status = 'cancelled';
  await tournament.save();

  /**
   * Every unplayed tie is withdrawn with it. Without this a student keeps a live
   * "play your quarter-final" invitation for a bracket that no longer exists, and
   * playing it would advance nobody.
   */
  const open = tournament.rounds
    .flatMap((round) => round.ties)
    .map((tie) => tie.challengeId)
    .filter(Boolean);
  if (open.length) {
    await Challenge.updateMany(
      { _id: { $in: open }, status: { $in: ['pending', 'accepted'] } },
      { $set: { status: 'cancelled' } },
    );
  }

  return shapeTournament(tournament);
}

// ── Sign-up ────────────────────────────────────────────────────────────────

export async function joinTournament(scope, user, tournamentId) {
  const tournament = await findInScope(scope, tournamentId);
  if (tournament.status !== 'open') {
    throw new ConflictError('Entries for that tournament have closed.', 'ENTRIES_CLOSED');
  }
  if (tournament.entrants.length >= tournament.size) {
    throw new ConflictError('That tournament is full.', 'TOURNAMENT_FULL');
  }
  if (tournament.entrants.some((e) => String(e.userId) === String(user._id))) {
    throw new ConflictError('You are already in it.', 'ALREADY_ENTERED');
  }

  const member = await SpaceMember.findOne(
    { spaceId: scope.spaceId, userId: user._id, status: 'active' },
    { batchId: 1 },
  ).lean();
  if (!member) throw new BadRequestError('You are not a member of this organization.');

  // Batch eligibility, read from live membership rather than from anything the
  // client sent — the same rule assignments follow.
  if (
    tournament.batchIds?.length &&
    !tournament.batchIds.some((b) => String(b) === String(member.batchId ?? ''))
  ) {
    throw new BadRequestError('That tournament is not open to your class.', 'NOT_ELIGIBLE');
  }

  tournament.entrants.push({
    userId: user._id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? null,
  });
  await tournament.save();

  return shapeTournament(tournament, { viewerId: user._id });
}

export async function leaveTournament(scope, user, tournamentId) {
  const tournament = await findInScope(scope, tournamentId);
  if (tournament.status !== 'open') {
    throw new ConflictError('The bracket is already drawn.', 'ENTRIES_CLOSED');
  }
  tournament.entrants = tournament.entrants.filter(
    (e) => String(e.userId) !== String(user._id),
  );
  await tournament.save();
  return shapeTournament(tournament, { viewerId: user._id });
}

// ── Drawing the bracket ────────────────────────────────────────────────────

/**
 * Seed the field and open round one.
 *
 * Seeded by topic rating, strongest first, because the alternative — a random
 * draw — produces a bracket where the two best players meet in round one often
 * enough that students notice and conclude the draw is rigged against them. A
 * rating-seeded bracket is the same arrangement every sport uses, and it is
 * explainable: you are seeded where your rating puts you.
 *
 * A field that is not a power of two is padded with byes, and the byes fall to the
 * top seeds — which is what seeding is FOR. `seedOrder` pairs seed 1 with the
 * highest number in the bracket, so if that number exceeds the field, seed 1 gets
 * the walkover.
 */
export async function startTournament(scope, tournamentId) {
  assertPermission(scope, 'manageContests');
  const tournament = await findInScope(scope, tournamentId);

  if (tournament.status !== 'open') {
    throw new ConflictError('That bracket has already been drawn.', 'ALREADY_STARTED');
  }
  if (tournament.entrants.length < 2) {
    throw new BadRequestError('A bracket needs at least two entrants.', 'TOO_FEW_ENTRANTS');
  }

  /**
   * The bracket is the smallest power of two that holds the field, NOT the size
   * the admin chose. An 8-slot tournament with three entrants should run as a
   * four-bracket with one bye, not as an eight-bracket where half of round one is
   * a walkover and the semi-finals are the first real games.
   */
  let bracket = 2;
  while (bracket < tournament.entrants.length) bracket *= 2;

  const ratings = await Rating.find(
    {
      userId: { $in: tournament.entrants.map((e) => e.userId) },
      topicId: tournament.topicId,
    },
    { userId: 1, rating: 1 },
  ).lean();
  const ratingOf = new Map(ratings.map((r) => [String(r.userId), r.rating]));

  const ranked = [...tournament.entrants].sort(
    (a, b) => (ratingOf.get(String(b.userId)) ?? 0) - (ratingOf.get(String(a.userId)) ?? 0),
  );
  ranked.forEach((entrant, i) => {
    entrant.seed = i + 1;
    entrant.rating = ratingOf.get(String(entrant.userId)) ?? null;
  });
  tournament.entrants = ranked;

  /** seed number → entrant, with seeds past the field left undefined (byes). */
  const bySeed = new Map(ranked.map((e) => [e.seed, e]));
  const order = seedOrder(bracket);
  const totalRounds = Math.log2(bracket);

  const ties = [];
  for (let i = 0; i < order.length; i += 2) {
    const a = bySeed.get(order[i]) ?? null;
    const b = bySeed.get(order[i + 1]) ?? null;
    ties.push({
      position: i / 2,
      aUserId: a?.userId ?? null,
      bUserId: b?.userId ?? null,
      // Exactly one side present is a walkover; neither present cannot happen in
      // round one, because the field is at least half the bracket by construction.
      bye: Boolean(a) !== Boolean(b),
      winnerId: a && b ? null : (a?.userId ?? b?.userId ?? null),
      decidedAt: a && b ? null : new Date(),
    });
  }

  tournament.rounds = [{ index: 0, name: roundName(0, totalRounds), ties }];
  tournament.status = 'running';
  tournament.startedAt = new Date();
  await tournament.save();

  await openRound(tournament, 0);
  /**
   * A round that is all byes is already over. Rare, but reachable with two
   * entrants in a four-bracket, and without this the bracket would sit at
   * "running" with nothing for anybody to play.
   */
  await advanceIfRoundComplete(tournament);

  return shapeTournament(tournament);
}

/**
 * Create the private challenge for every playable tie in a round, and tell both
 * players it is their turn.
 *
 * The challenge is created already `accepted`. An ordinary friend challenge starts
 * `pending` because the recipient has to agree to play — here they agreed when they
 * entered the tournament, and asking twice would strand a bracket on somebody who
 * did not open a notification.
 */
async function openRound(tournament, roundIndex) {
  const round = tournament.rounds[roundIndex];
  if (!round) return;

  const topic = await Topic.findById(tournament.topicId, { name: 1 }).lean();

  for (const tie of round.ties) {
    if (tie.winnerId || tie.challengeId || !tie.aUserId || !tie.bUserId) continue;

    const challenge = await Challenge.create({
      fromUserId: tie.aUserId,
      toUserId: tie.bUserId,
      topicId: tournament.topicId,
      spaceId: tournament.spaceId,
      status: 'accepted',
      respondedAt: new Date(),
      expiresAt: new Date(Date.now() + TOURNAMENT_TIE_WINDOW_MS),
    });
    tie.challengeId = challenge._id;

    for (const [userId, opponentId] of [
      [tie.aUserId, tie.bUserId],
      [tie.bUserId, tie.aUserId],
    ]) {
      const opponent = tournament.entrants.find((e) => String(e.userId) === String(opponentId));
      await notify(userId, {
        type: 'challenge',
        prefKey: 'friendChallenge',
        title: `${round.name} — ${tournament.name}`,
        body: `You play ${opponent?.displayName ?? 'your opponent'} on ${topic?.name ?? 'this topic'}.`,
        data: {
          challengeId: String(challenge._id),
          tournamentId: String(tournament._id),
          topicId: String(tournament.topicId),
        },
      }).catch(() => {});
    }
  }

  await tournament.save();
}

// ── Advancement ────────────────────────────────────────────────────────────

/**
 * Record the result of a tie, called from the match finaliser.
 *
 * Keyed on the challenge rather than on the match, because the challenge is the
 * thing the bracket created and therefore the only id it can be sure belongs to
 * it. A match played on a challenge that is not part of any bracket returns
 * immediately — which is every ordinary friend challenge, so this has to be
 * cheap: it is one indexed lookup.
 *
 * A draw is decided on the tiebreak the whole product already uses for equal
 * scores: whoever answered faster. A bracket cannot carry a draw forward, and
 * replaying it would need a second scheduling flow for a case that resolves
 * itself with a number both players already saw.
 */
export async function recordTieResult({ challengeId, matchId, players, winnerId }) {
  if (!challengeId) return null;

  const tournament = await Tournament.findOne({
    'rounds.ties.challengeId': oid(challengeId),
    status: 'running',
  });
  if (!tournament) return null;

  let target = null;
  for (const round of tournament.rounds) {
    for (const tie of round.ties) {
      if (String(tie.challengeId) === String(challengeId)) target = tie;
    }
  }
  if (!target || target.winnerId) return null;

  let decided = winnerId ? String(winnerId) : null;
  if (!decided) {
    // Level scores. The faster of the two goes through — the same rule contest
    // standings use, and one both players can check against their own screen.
    const [a, b] = players ?? [];
    if (a && b) {
      decided =
        (a.totalResponseMs ?? Infinity) <= (b.totalResponseMs ?? Infinity)
          ? String(a.userId)
          : String(b.userId);
    } else {
      decided = String(target.aUserId);
    }
  }

  target.winnerId = oid(decided);
  target.matchId = matchId ? oid(matchId) : null;
  target.decidedAt = new Date();
  await tournament.save();

  await advanceIfRoundComplete(tournament);
  return shapeTournament(tournament);
}

/**
 * When every tie in the live round has a winner, build the next one — or crown
 * the champion.
 *
 * Ties `2k` and `2k+1` feed tie `k`, which is what makes the bracket a bracket:
 * the pairing for round two is not a fresh draw, it is determined by where people
 * started. That is the property that lets a student look at the board on day one
 * and see who they would meet in the final.
 */
async function advanceIfRoundComplete(tournament) {
  const round = tournament.rounds.at(-1);
  if (!round || round.completedAt) return;
  if (round.ties.some((tie) => !tie.winnerId)) return;

  round.completedAt = new Date();

  if (round.ties.length === 1) {
    tournament.championId = round.ties[0].winnerId;
    tournament.status = 'complete';
    tournament.completedAt = new Date();
    await tournament.save();

    const champion = tournament.entrants.find(
      (e) => String(e.userId) === String(tournament.championId),
    );
    for (const entrant of tournament.entrants) {
      await notify(entrant.userId, {
        type: 'contest_open',
        prefKey: 'contestNew',
        title: `${tournament.name} — ${champion?.displayName ?? 'a winner'} wins`,
        body:
          String(entrant.userId) === String(tournament.championId)
            ? 'You won the whole thing.'
            : 'See the final bracket.',
        data: { tournamentId: String(tournament._id) },
      }).catch(() => {});
    }
    return;
  }

  const totalRounds = Math.log2(
    // The first round's tie count is half the bracket, so the bracket is twice it.
    tournament.rounds[0].ties.length * 2,
  );
  const nextIndex = tournament.rounds.length;
  const ties = [];
  for (let i = 0; i < round.ties.length; i += 2) {
    ties.push({
      position: i / 2,
      aUserId: round.ties[i].winnerId,
      bUserId: round.ties[i + 1]?.winnerId ?? null,
      bye: !round.ties[i + 1],
      winnerId: round.ties[i + 1] ? null : round.ties[i].winnerId,
      decidedAt: round.ties[i + 1] ? null : new Date(),
    });
  }

  tournament.rounds.push({ index: nextIndex, name: roundName(nextIndex, totalRounds), ties });
  await tournament.save();

  await openRound(tournament, nextIndex);
  // A round of byes resolves immediately; recursing settles it rather than
  // leaving the bracket parked on a round nobody can play.
  await advanceIfRoundComplete(tournament);
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function listTournaments(scope, { limit = 20 } = {}) {
  const rows = await Tournament.find({ spaceId: scope.spaceId, status: { $ne: 'cancelled' } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('topicId', 'name coverUrl')
    .lean();
  return rows.map((row) => shapeTournament(row));
}

export async function getTournament(scope, tournamentId, viewerId = null) {
  if (!mongoose.isValidObjectId(tournamentId)) throw new NotFoundError('No such tournament.');
  const row = await Tournament.findOne({ _id: oid(tournamentId), spaceId: scope.spaceId })
    .populate('topicId', 'name coverUrl')
    .lean();
  if (!row) throw new NotFoundError('No such tournament.');
  return shapeTournament(row, { viewerId });
}

export function shapeTournament(tournament, { viewerId = null } = {}) {
  const doc = tournament.toObject?.() ?? tournament;
  const byId = new Map(
    (doc.entrants ?? []).map((e) => [
      String(e.userId),
      { id: String(e.userId), displayName: e.displayName, avatarUrl: e.avatarUrl ?? null, seed: e.seed },
    ]),
  );
  const person = (id) => (id ? (byId.get(String(id)) ?? { id: String(id) }) : null);

  /**
   * The viewer's own next tie, resolved server-side.
   *
   * The bracket screen's primary button is "play your quarter-final", and working
   * out which of fifteen ties is yours — and whether it is still open — is a
   * search the client should not be doing. It is also the only part of this
   * payload that differs per viewer, which is why everything else is shared.
   */
  let yourTie = null;
  if (viewerId) {
    for (const round of doc.rounds ?? []) {
      for (const tie of round.ties ?? []) {
        const mine =
          String(tie.aUserId ?? '') === String(viewerId) ||
          String(tie.bUserId ?? '') === String(viewerId);
        if (mine && !tie.winnerId && tie.challengeId) {
          yourTie = {
            round: round.name,
            challengeId: String(tie.challengeId),
            opponent: person(
              String(tie.aUserId) === String(viewerId) ? tie.bUserId : tie.aUserId,
            ),
          };
        }
      }
    }
  }

  return {
    id: String(doc._id),
    name: doc.name,
    topic: doc.topicId?._id
      ? { id: String(doc.topicId._id), name: doc.topicId.name, coverUrl: doc.topicId.coverUrl ?? null }
      : { id: String(doc.topicId) },
    size: doc.size,
    status: doc.status,
    batchIds: (doc.batchIds ?? []).map(String),
    entrants: (doc.entrants ?? []).map((e) => ({
      id: String(e.userId),
      displayName: e.displayName,
      avatarUrl: e.avatarUrl ?? null,
      seed: e.seed ?? null,
      rating: e.rating ?? null,
    })),
    rounds: (doc.rounds ?? []).map((round) => ({
      index: round.index,
      name: round.name,
      completed: Boolean(round.completedAt),
      ties: (round.ties ?? []).map((tie) => ({
        position: tie.position,
        a: person(tie.aUserId),
        b: person(tie.bUserId),
        winnerId: tie.winnerId ? String(tie.winnerId) : null,
        matchId: tie.matchId ? String(tie.matchId) : null,
        bye: Boolean(tie.bye),
      })),
    })),
    champion: person(doc.championId),
    entered: viewerId
      ? (doc.entrants ?? []).some((e) => String(e.userId) === String(viewerId))
      : false,
    yourTie,
    startedAt: doc.startedAt ?? null,
    completedAt: doc.completedAt ?? null,
    createdAt: doc.createdAt,
  };
}

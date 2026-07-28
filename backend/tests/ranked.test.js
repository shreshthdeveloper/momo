import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startHarness,
  stopHarness,
  resetDb,
  makeUser,
  makeTopic,
  connectClient,
  api,
} from './helpers.js';
import { C2S, S2C } from '../src/shared/protocol.js';
import { User, Rating } from '../src/models/index.js';
import { ROUNDS_PER_MATCH, MATCH_MODE, RANKED_START } from '../src/shared/constants.js';
import { leagueFor } from '../src/shared/league.js';
import { accountLevelForXp } from '../src/shared/mastery.js';

/**
 * The ranked ladder, end to end (leagues-and-progression.md).
 *
 * Two real clients play a real match through the real engine, and the ranked
 * rating, the league band and the XP award are asserted from the socket
 * payload and from the database afterwards. The two modes are the point of
 * this file: ranked moves a rating, quick play never does — and both must
 * still pay XP, because that is what the perks hang off.
 */

let harness;

before(async () => {
  harness = await startHarness();
});

after(async () => {
  await stopHarness();
});

beforeEach(async () => {
  await resetDb();
});

/** Plays a full match to completion and returns both players' match:end. */
async function playMatch({ topic, a, b, mode }) {
  await a.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id), mode });
  await b.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id), mode });

  const [foundA] = await Promise.all([a.wait(S2C.MATCH_FOUND), b.wait(S2C.MATCH_FOUND)]);
  const matchId = foundA.payload.matchId;
  await Promise.all([a.wait(S2C.MATCH_START), b.wait(S2C.MATCH_START)]);

  for (let round = 0; round < ROUNDS_PER_MATCH; round += 1) {
    const [startA] = await Promise.all([
      a.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === round }),
      b.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === round }),
    ]);
    const correct = startA.payload.question.options.findIndex((o) => o.startsWith('Right'));
    const wrong = correct === 0 ? 1 : 0;

    // A wins every round; B is wrong every round. The verdict is not in doubt.
    await a.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: round, optionIndex: correct });
    await b.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: round, optionIndex: wrong });

    await Promise.all([
      a.wait(S2C.ROUND_RESULT, { predicate: (p) => p.roundIndex === round }),
      b.wait(S2C.ROUND_RESULT, { predicate: (p) => p.roundIndex === round }),
    ]);
  }

  const [endA, endB] = await Promise.all([a.wait(S2C.MATCH_END), b.wait(S2C.MATCH_END)]);
  return { winner: endA.payload, loser: endB.payload };
}

test('a ranked match moves the global ranked rating in opposite directions', async () => {
  const { topic } = await makeTopic({ name: 'Ranked Topic' });
  const alice = await makeUser({ displayName: 'Alice' });
  const bob = await makeUser({ displayName: 'Bob' });

  const a = connectClient(alice.token, { port: harness.port });
  const b = connectClient(bob.token, { port: harness.port });
  await Promise.all([a.connected(), b.connected()]);

  const { winner, loser } = await playMatch({ topic, a, b, mode: MATCH_MODE.RANKED });

  assert.equal(winner.ranked, true, 'the payload declares the match ranked');
  assert.equal(winner.rankedBefore, RANKED_START, 'both start at the ladder floor value');

  // Equal ratings, K=32: the winner takes exactly what the loser gives up.
  assert.equal(winner.rankedDelta, 16, 'winner gains 16 from an even match');
  assert.equal(loser.rankedDelta, -16, 'loser drops 16');
  assert.equal(
    winner.rankedDelta + loser.rankedDelta,
    0,
    'the ladder is zero-sum: both were scored against PRE-match ratings',
  );
  assert.equal(winner.rankedAfter, winner.rankedBefore + winner.rankedDelta);

  // The league travels with the rating and needs no state of its own.
  assert.equal(winner.leagueAfter.label, leagueFor(winner.rankedAfter).label);
  assert.equal(loser.leagueAfter.label, leagueFor(loser.rankedAfter).label);

  const [aDb, bDb] = await Promise.all([
    User.findById(alice.user._id).lean(),
    User.findById(bob.user._id).lean(),
  ]);
  assert.equal(aDb.rankedRating, winner.rankedAfter, 'the winner is persisted');
  assert.equal(bDb.rankedRating, loser.rankedAfter, 'the loser is persisted');
  assert.ok(aDb.totalXp > 0 && bDb.totalXp > 0, 'both players earn XP');
  assert.ok(aDb.totalXp > bDb.totalXp, 'winning a ranked match pays the win bonus');

  a.close();
  b.close();
});

test('quick play moves no rating at all, but still pays XP', async () => {
  const { topic } = await makeTopic({ name: 'Casual Topic' });
  const alice = await makeUser({ displayName: 'Alice' });
  const bob = await makeUser({ displayName: 'Bob' });

  const a = connectClient(alice.token, { port: harness.port });
  const b = connectClient(bob.token, { port: harness.port });
  await Promise.all([a.connected(), b.connected()]);

  const { winner, loser } = await playMatch({ topic, a, b, mode: MATCH_MODE.QUICK });

  assert.equal(winner.ranked, false, 'quick play is not ranked');
  assert.ok(!winner.rankedDelta, 'no ranked movement for the winner');
  assert.ok(!loser.rankedDelta, 'none for the loser either');
  assert.equal(winner.ratingDelta, 0, 'the per-topic rating does not move in quick play');

  const [aDb, bDb] = await Promise.all([
    User.findById(alice.user._id).lean(),
    User.findById(bob.user._id).lean(),
  ]);
  assert.equal(aDb.rankedRating, RANKED_START, 'the ladder is untouched');
  assert.equal(bDb.rankedRating, RANKED_START);
  assert.ok(aDb.totalXp > 0, 'quick play still counts toward the account level');

  // §1 — quick play carries no win bonus, so both sides are paid the same for
  // the same number of correct answers. Alice answered everything, Bob nothing.
  assert.ok(aDb.totalXp > bDb.totalXp, 'correct answers still pay');

  a.close();
  b.close();
});

test('the account level and its unlocks follow lifetime XP', async () => {
  const { topic } = await makeTopic({ name: 'Grind Topic' });
  const alice = await makeUser({ displayName: 'Alice' });
  const bob = await makeUser({ displayName: 'Bob' });

  const a = connectClient(alice.token, { port: harness.port });
  const b = connectClient(bob.token, { port: harness.port });
  await Promise.all([a.connected(), b.connected()]);

  const { winner } = await playMatch({ topic, a, b, mode: MATCH_MODE.RANKED });

  assert.equal(
    winner.accountLevel,
    accountLevelForXp(winner.totalXp),
    'the reported account level is the one its XP total earns',
  );
  assert.ok(Array.isArray(winner.unlocked), 'unlocks are always an array');

  /**
   * Both sides of the level, not just the new one.
   *
   * The socket payload used to send `accountLevel` alone while the REST match
   * summary sent both, so a client staging "11 ➜ 12" had to guess the 11 by
   * subtracting one — right most of the time and silently wrong for any match
   * that crosses two levels. Asserting the type is what catches the field
   * going missing again; `undefined > n` is false, so a relationship check on
   * its own would pass against the bug.
   */
  assert.equal(
    typeof winner.accountLevelBefore,
    'number',
    'the level the player came from is on the wire, not inferred by the client',
  );
  assert.equal(
    winner.accountLevelUp,
    winner.accountLevel > winner.accountLevelBefore,
    'the level-up flag agrees with the two levels it is derived from',
  );
  if (winner.accountLevelUp) {
    assert.ok(winner.accountLevel > 1, 'a level-up means the level actually rose');
  }

  a.close();
  b.close();
});

test('the profile reports the ladder, the level and what is next', async () => {
  const alice = await makeUser({ displayName: 'Alice' });
  const call = api(harness.app, alice.token);

  const stats = await call.get('/api/v1/me/stats');
  assert.equal(stats.statusCode, 200);
  const body = stats.json().data;

  assert.equal(body.rankedRating, RANKED_START);
  assert.equal(body.league.label, leagueFor(RANKED_START).label, 'a new player opens in Bronze I');
  assert.equal(body.accountLevel, 1);
  assert.ok(body.accountProgress, 'the XP bar has something to draw');
  assert.ok(body.nextPerk, 'and something to aim at');

  const rewards = await call.get('/api/v1/me/rewards');
  assert.equal(rewards.statusCode, 200);
  const shelves = rewards.json().data.shelves;
  assert.ok(shelves.titles.length > 0 && shelves.avatars.length > 0 && shelves.banners.length > 0);
  assert.ok(
    shelves.titles.every((t) => typeof t.owned === 'boolean'),
    'every shelf item says whether it is owned',
  );
  assert.ok(
    shelves.avatars.some((x) => x.owned),
    'the starter avatars are owned from the first match',
  );
});

test('the versus payload carries both standings for both players', async () => {
  const { topic } = await makeTopic({ name: 'Versus Topic' });
  /**
   * Every value here is deliberately NOT a default.
   *
   * The versus screen draws a league badge from `rankedRating` and prints the
   * topic level beside it, and both were once dropped on the way through the
   * match engine — which whitelists player fields, so anything unnamed arrives
   * as `1200`/level 1 rather than failing. Asserting the defaults would pass
   * against exactly that bug, so the fixtures are off-default on purpose and
   * the banner is checked too: it was silently blank for the same reason.
   */
  const alice = await makeUser({
    displayName: 'Alice', rankedRating: 1620, banner: 'coral-stripes', country: 'BR', city: 'Recife',
  });
  const bob = await makeUser({
    displayName: 'Bob', rankedRating: 1055, banner: 'night-dots', country: 'JP', city: 'Osaka',
  });
  /**
   * The SAME topic level, so the two pair on arrival.
   *
   * The harness shortens the ghost deadline to keep the suite fast, and the
   * band opens one level per step — so anything other than an exact match here
   * would ghost before widening and quietly test the ghost path instead. Their
   * ranked ratings are far apart on purpose: pairing must ignore them.
   */
  await Rating.create([
    { userId: alice.user._id, topicId: topic._id, spaceId: topic.spaceId, rating: 1310, xp: 900, level: 7 },
    { userId: bob.user._id, topicId: topic._id, spaceId: topic.spaceId, rating: 1180, xp: 700, level: 7 },
  ]);

  const a = connectClient(alice.token, { port: harness.port });
  const b = connectClient(bob.token, { port: harness.port });
  await Promise.all([a.connected(), b.connected()]);

  await a.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id), mode: MATCH_MODE.RANKED });
  await b.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id), mode: MATCH_MODE.RANKED });
  const [found] = await Promise.all([a.wait(S2C.MATCH_FOUND), b.wait(S2C.MATCH_FOUND)]);

  const expected = {
    Alice: { rankedRating: 1620, level: 7, banner: 'coral-stripes', country: 'BR', city: 'Recife' },
    Bob: { rankedRating: 1055, level: 7, banner: 'night-dots', country: 'JP', city: 'Osaka' },
  };
  // If this pair had ghosted, the opponent would be a synthetic with a random
  // name — and the assertions below would be testing the wrong code path.
  assert.ok(
    expected[found.payload.opponent?.displayName],
    'the two paired with each other, not with ghosts',
  );
  for (const side of ['you', 'opponent']) {
    const p = found.payload[side];
    assert.ok(p, `${side} is present`);
    const want = expected[p.displayName];
    assert.ok(want, `${side} is one of the two players`);
    assert.equal(p.rankedRating, want.rankedRating, `${p.displayName} carries their real ladder standing`);
    assert.equal(p.level, want.level, `${p.displayName} carries their real topic level`);
    assert.equal(p.banner, want.banner, `${p.displayName} carries their banner`);
    /**
     * The versus screen prints a flag and a place under every name, and both
     * of these travelled the same whitelist that had already eaten the banner
     * and the level. `city` in particular was read off the account at queue
     * time and then dropped one layer later, so it was never once on the wire.
     */
    assert.equal(p.country, want.country, `${p.displayName} carries their country`);
    assert.equal(p.city, want.city, `${p.displayName} carries their city`);
  }

  // Level 7 on both sides, not the level-1 default — so the payload is
  // carrying a real level rather than falling back.
  assert.equal(found.payload.you.level, 7);
  assert.equal(found.payload.opponent.level, 7);

  a.close();
  b.close();
});

test('a title cannot be worn before it is earned', async () => {
  const alice = await makeUser({ displayName: 'Alice' });
  const call = api(harness.app, alice.token);

  const denied = await call.patch('/api/v1/me', { title: 'grandmaster' });
  assert.equal(denied.statusCode, 403, 'level 50 is not available on day one');
  assert.match(denied.json().error.message, /level/i, 'and the refusal says why');

  const cleared = await call.patch('/api/v1/me', { title: null });
  assert.equal(cleared.statusCode, 200, 'clearing a title is always allowed');
});

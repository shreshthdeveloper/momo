import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startHarness,
  stopHarness,
  resetDb,
  makeUser,
  makeTopic,
  connectClient,
  sleep,
  TEST_TIMING,
} from './helpers.js';
import { C2S, S2C } from '../src/shared/protocol.js';
import { Replay, Rating, Match, Question, publicSpaceId } from '../src/models/index.js';
import { ROUNDS_PER_MATCH, ELO_START } from '../src/shared/constants.js';
import { ratingBandOf } from '../src/shared/elo.js';
import { bindSyntheticScript, buildSyntheticOpponent } from '../src/game/ghostService.js';
import { buildRound } from '../src/game/questionSelector.js';

/**
 * Ghost matches (prd.md §6.7, tech.md §9.5, §13).
 *
 * "A launch requirement, not an optimisation." The player must never see an
 * empty lobby, and must never be told which kind of opponent they received.
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

test('a lone player is served a synthetic opponent within the ghost deadline', async () => {
  const { topic } = await makeTopic();
  const alice = await makeUser({ displayName: 'Alice' });

  const a = connectClient(alice.token, { port: harness.port });
  await a.connected();

  const joinedAt = Date.now();
  await a.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id) });

  const searching = await a.wait(S2C.QUEUE_SEARCHING);
  assert.equal(searching.payload.topicId, String(topic._id));

  // prd.md F6.4.3 / design.md §8.4 — no long-wait state, ever.
  const found = await a.wait(S2C.MATCH_FOUND, { timeoutMs: 4000 });
  const waited = Date.now() - joinedAt;
  assert.ok(
    waited < TEST_TIMING.ghostAfterMs + 800,
    `waited ${waited}ms, expected under the ghost deadline`,
  );

  // prd.md F6.7.5 — nothing in the payload says "ghost".
  const serialised = JSON.stringify(found.payload);
  assert.ok(!serialised.includes('ghost'), 'the opponent is never labelled');
  assert.ok(!serialised.includes('synthetic'));
  assert.ok(found.payload.opponent.displayName, 'the opponent has a real-looking name');
  assert.ok(Number.isFinite(found.payload.opponent.rating));

  a.close();
});

test('a ghost answers on a human-like schedule and can be beaten', async () => {
  const { topic } = await makeTopic();
  const alice = await makeUser();

  const a = connectClient(alice.token, { port: harness.port });
  await a.connected();
  await a.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id) });
  const found = await a.wait(S2C.MATCH_FOUND, { timeoutMs: 4000 });
  const matchId = found.payload.matchId;

  let sawOpponentAnswer = false;
  for (let round = 0; round < ROUNDS_PER_MATCH; round += 1) {
    const start = await a.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === round });
    const correct = start.payload.question.options.findIndex((o) => o.startsWith('Right'));
    await a.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: round, optionIndex: correct });
    const result = await a.wait(S2C.ROUND_RESULT, { predicate: (p) => p.roundIndex === round });
    if (result.payload.opponent?.optionIndex !== null) sawOpponentAnswer = true;
  }

  assert.ok(sawOpponentAnswer, 'the ghost actually answered at least once');

  const end = await a.wait(S2C.MATCH_END);
  // A player answering all seven correctly and instantly should win.
  assert.equal(end.payload.verdict, 'won');

  // prd.md F6.7.6 — a ghost match affects the live player's rating.
  assert.ok(end.payload.ratingDelta > 0);

  await sleep(200);
  const ratings = await Rating.find({ topicId: topic._id }).lean();
  assert.equal(ratings.length, 1, 'only the live player has a rating row');
  assert.equal(String(ratings[0].userId), alice.id);

  a.close();
});

test('a stored replay is preferred over a synthetic opponent, and its usage is spread', async () => {
  const { topic } = await makeTopic();
  const ghostUser = await makeUser({ displayName: 'PastPlayer' });

  const questions = await Question.find({ topicIds: topic._id }).limit(ROUNDS_PER_MATCH).lean();
  const rating = ELO_START;

  await Replay.create({
    matchId: (await Match.create({ topicId: topic._id, spaceId: publicSpaceId, status: 'complete' }))._id,
    userId: ghostUser.user._id,
    topicId: topic._id,
    spaceId: publicSpaceId,
    playerRating: rating,
    ratingBand: ratingBandOf(rating),
    displayName: 'PastPlayer',
    questionIds: questions.map((q) => q._id),
    // Canonical indices — the replay predates whatever shuffle the next match uses.
    answers: questions.map((_, i) => ({
      optionIndex: i % 2 === 0 ? 0 : 1,
      elapsedMs: 120 + i * 10,
      isCorrect: i % 2 === 0,
    })),
    finalScore: 140,
    usedCount: 0,
  });

  const alice = await makeUser();
  const a = connectClient(alice.token, { port: harness.port });
  await a.connected();
  await a.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id) });

  const found = await a.wait(S2C.MATCH_FOUND, { timeoutMs: 4000 });

  /**
   * The replay was used — proven by the question set below, not by the name.
   *
   * This used to assert the opponent WAS called `PastPlayer`, which is the thing
   * that turned out to be the bug: in an organization of a few people, replaying
   * a classmate's game under their own name reads as the app inventing a match
   * they never played, and it discloses their result. So the assertion is
   * inverted — the identity must NOT be theirs.
   */
  assert.notEqual(
    found.payload.opponent.displayName,
    'PastPlayer',
    'a replayed opponent must not wear the original player’s name',
  );
  assert.notEqual(
    String(found.payload.opponent.id),
    String(ghostUser.user._id),
    'a replayed opponent must not carry the original player’s account id',
  );
  assert.ok(found.payload.opponent.displayName, 'it still has a name to show');

  // The replay's question set is reused, so its answers stay meaningful.
  const start = await a.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === 0 });
  assert.ok(
    questions.some((q) => String(q._id) === start.payload.question.id),
    'the match uses the replayed question set',
  );

  await sleep(300);
  const replay = await Replay.findOne({ userId: ghostUser.user._id }).lean();
  // tech.md §9.5 — sorting by usedCount spreads replay usage rather than
  // serving the same opponent repeatedly.
  assert.equal(replay.usedCount, 1);

  a.close();
});

test('a replay ghost answers the same option even when the new match shuffles differently', async () => {
  // The replay stores canonical indices; the match shuffles independently.
  // If the remap were wrong the ghost would answer a different option than the
  // human it came from, and every ghost match would be subtly nonsense.
  const { topic } = await makeTopic();
  const questionDoc = await Question.findOne({ topicIds: topic._id }).lean();

  let sawShuffle = false;
  for (let attempt = 0; attempt < 30 && !sawShuffle; attempt += 1) {
    const round = buildRound(questionDoc, { language: 'en', durationMs: 10_000 });
    if (round.correctIndex !== questionDoc.correctIndex) sawShuffle = true;

    // canonicalToShown must map the stored answer back to the right position.
    const shownForCanonicalCorrect = round.optionOrder.indexOf(questionDoc.correctIndex);
    assert.equal(
      shownForCanonicalCorrect,
      round.correctIndex,
      'the remapped correct option matches the round definition',
    );
    assert.equal(
      round.options[round.correctIndex],
      questionDoc.content.en.options[questionDoc.correctIndex],
      'the option text at the correct position is the genuinely correct one',
    );
  }
  assert.ok(sawShuffle, 'options really are shuffled per match (tech.md §9.1)');
});

test('a synthetic script binds intent to real option indices', async () => {
  const { topic } = await makeTopic();
  const questions = await Question.find({ topicIds: topic._id }).limit(ROUNDS_PER_MATCH).lean();
  const rounds = questions.map((q) => buildRound(q, { language: 'en', durationMs: 10_000 }));

  const synthetic = await buildSyntheticOpponent({
    topicId: topic._id,
    rating: 1200,
    roundDurationMs: 10_000,
  });
  assert.equal(synthetic.script.length, ROUNDS_PER_MATCH);
  assert.equal(synthetic.isGhost, true);

  const bound = bindSyntheticScript(synthetic.script, rounds);
  bound.forEach((entry, i) => {
    if (entry.optionIndex === null) return;
    assert.ok(entry.optionIndex >= 0 && entry.optionIndex < 4);
    // The declared intent and the chosen option must agree.
    assert.equal(
      entry.optionIndex === rounds[i].canonicalCorrectIndex,
      entry.isCorrect,
      `round ${i}: a "correct" intent must pick the correct canonical option`,
    );
    assert.ok(entry.elapsedMs > 0 && entry.elapsedMs < 10_000);
  });
});

test('practice mode is ghost-only and changes no rating', async () => {
  const { topic } = await makeTopic();
  const alice = await makeUser();

  const a = connectClient(alice.token, { port: harness.port });
  await a.connected();
  await a.emit(C2S.QUEUE_JOIN, { topicId: String(topic._id), mode: 'practice' });

  // No queue wait at all — practice skips matchmaking entirely.
  const found = await a.wait(S2C.MATCH_FOUND, { timeoutMs: 3000 });
  const matchId = found.payload.matchId;

  for (let round = 0; round < ROUNDS_PER_MATCH; round += 1) {
    const start = await a.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === round });
    const correct = start.payload.question.options.findIndex((o) => o.startsWith('Right'));
    await a.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: round, optionIndex: correct });
    await a.wait(S2C.ROUND_RESULT, { predicate: (p) => p.roundIndex === round });
  }

  const end = await a.wait(S2C.MATCH_END);
  // prd.md §6.3 — practice is unrated.
  assert.equal(end.payload.ratingDelta, 0);

  await sleep(250);
  const rating = await Rating.findOne({ userId: alice.user._id, topicId: topic._id }).lean();
  assert.equal(rating.rating, ELO_START, 'the rating did not move');
  assert.ok(rating.xp > 0, 'but mastery XP is still earned — F6.5.2');

  // prd.md §6.7 — practice matches do not become replays.
  assert.equal(await Replay.countDocuments({ topicId: topic._id }), 0);

  a.close();
});

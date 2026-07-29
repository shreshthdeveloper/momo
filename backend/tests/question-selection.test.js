import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { startHarness, stopHarness, resetDb, makeUser, makeTopic } from './helpers.js';
import { Match, Question } from '../src/models/index.js';
import { selectQuestions, recentlySeenAt } from '../src/game/questionSelector.js';
import { ROUNDS_PER_MATCH } from '../src/shared/constants.js';

/**
 * Which questions a match gets, and — the part that actually shows up as
 * "these keep repeating" — which ones it gets once the topic has none left.
 *
 * A topic holds tens of questions and a match spends seven, so the exhausted
 * case is not an edge case. It is where a returning player lives.
 */

// No `harness` binding: these call the selector directly rather than through
// the API, so all the harness is needed for is the database connection.
before(async () => {
  await startHarness();
});
after(async () => {
  await stopHarness();
});
beforeEach(async () => {
  await resetDb();
});

/** Record a match the way the engine does, so the seen-set can find it. */
async function recordMatch(user, topic, questionIds, when) {
  const match = await Match.create({
    spaceId: topic.spaceId,
    topicId: topic._id,
    mode: 'quick',
    status: 'complete',
    players: [{ userId: user.id, score: 0 }],
    questionIds,
    roundCount: questionIds.length,
  });
  // `createdAt` is immutable under `timestamps: true` — the raw collection is
  // the only way to age a row.
  if (when) {
    await Match.collection.updateOne(
      { _id: match._id },
      { $set: { createdAt: when, updatedAt: when } },
    );
  }
  return match;
}

const idsOf = (docs) => docs.map((d) => String(d._id));

test('a match is seven questions and never repeats one inside itself', async () => {
  const { topic } = await makeTopic({ questionCount: 40 });
  const user = await makeUser();

  const picked = await selectQuestions(topic, [{ userId: user.id, rating: 1200 }]);
  assert.equal(picked.length, ROUNDS_PER_MATCH);
  assert.equal(new Set(idsOf(picked)).size, ROUNDS_PER_MATCH);
});

test('questions seen recently are skipped while the pool can afford it', async () => {
  const { topic } = await makeTopic({ questionCount: 40 });
  const user = await makeUser();

  const first = await selectQuestions(topic, [{ userId: user.id, rating: 1200 }]);
  await recordMatch(user, topic, idsOf(first));

  const second = await selectQuestions(topic, [{ userId: user.id, rating: 1200 }]);
  const overlap = idsOf(second).filter((id) => idsOf(first).includes(id));
  assert.deepEqual(overlap, [], 'a 40-question topic has no excuse to repeat on match two');
});

test('the seen window is the most recent matches, not the first ones found', async () => {
  const { topic } = await makeTopic({ questionCount: 40 });
  const user = await makeUser();
  const all = await Question.find({ topicIds: topic._id }, { _id: 1 }).lean();
  const ids = all.map((q) => q._id);

  const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
  await recordMatch(user, topic, ids.slice(0, 5), old);
  await recordMatch(user, topic, ids.slice(5, 10));

  const seen = await recentlySeenAt([user.id]);
  assert.equal(seen.size, 10, 'both matches are inside the 30-day window');

  // The values are what the exhausted-pool fallback ranks on, so they have to
  // be the real timings rather than "recently, roughly".
  const oldest = Math.min(...ids.slice(0, 5).map((id) => seen.get(String(id))));
  const newest = Math.min(...ids.slice(5, 10).map((id) => seen.get(String(id))));
  assert.ok(oldest < newest, 'the twenty-day-old match must rank as older');
});

test('once the pool is exhausted it serves what has gone longest unseen', async () => {
  // Fourteen questions, two matches' worth: everything is "seen" by the third
  // match, which is the state a returning player is permanently in.
  const { topic } = await makeTopic({ questionCount: 14 });
  const user = await makeUser();
  const all = await Question.find({ topicIds: topic._id }, { _id: 1 }).lean();
  const ids = all.map((q) => q._id);

  const stale = ids.slice(0, 7);
  const fresh = ids.slice(7, 14);
  await recordMatch(user, topic, stale, new Date(Date.now() - 21 * 24 * 60 * 60 * 1000));
  await recordMatch(user, topic, fresh, new Date(Date.now() - 60 * 60 * 1000));

  const picked = idsOf(await selectQuestions(topic, [{ userId: user.id, rating: 1200 }]));
  const fromStale = picked.filter((id) => stale.map(String).includes(id)).length;

  /**
   * The current code returns all seven from the stale half, deterministically.
   * The bar is six rather than seven so that tuning the "stale half" fraction
   * does not break a test about behaviour — and six is still a real guard: the
   * uniform draw this replaced would clear it 50 times in 3432, or 1.5% of
   * runs, so a regression fails this essentially every time.
   */
  assert.equal(picked.length, ROUNDS_PER_MATCH);
  assert.ok(
    fromStale >= 6,
    `expected three-week-old questions, got ${fromStale} of ${ROUNDS_PER_MATCH}`,
  );
});

test('an exhausted pool still varies between matches', async () => {
  const { topic } = await makeTopic({ questionCount: 14 });
  const user = await makeUser();
  const all = await Question.find({ topicIds: topic._id }, { _id: 1 }).lean();
  await recordMatch(user, topic, all.map((q) => q._id));

  // Strict oldest-first would hand back the identical seven every time, which
  // trades one kind of repetition for a worse one.
  const runs = [];
  for (let i = 0; i < 6; i += 1) {
    runs.push(idsOf(await selectQuestions(topic, [{ userId: user.id, rating: 1200 }])).join(','));
  }
  assert.ok(new Set(runs).size > 1, 'every exhausted match returned the same seven questions');
});

test('a ghost opponent does not drag its own history into the pool', async () => {
  const { topic } = await makeTopic({ questionCount: 40 });
  const user = await makeUser();
  const ghostId = new mongoose.Types.ObjectId();

  const seen = await recentlySeenAt([user.id]);
  assert.equal(seen.size, 0);

  // A ghost has no account, so nothing it "saw" may narrow a real player's
  // pool. `selectQuestions` filters on `isGhost` before it ever gets here.
  const picked = await selectQuestions(topic, [
    { userId: user.id, rating: 1200 },
    { userId: ghostId, rating: 1200, isGhost: true },
  ]);
  assert.equal(picked.length, ROUNDS_PER_MATCH);
});

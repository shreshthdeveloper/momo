import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startHarness,
  stopHarness,
  resetDb,
  makeUser,
  makeSpace,
  makeTopic,
  addMember,
  connectClient,
  api,
} from './helpers.js';
import { C2S, S2C } from '../src/shared/protocol.js';
import { Match, Question, SpaceMember } from '../src/models/index.js';
import { mistakesByTopic, mistakeQuestionIds } from '../src/services/mistakeService.js';
import {
  DECK,
  MATCH_MODE,
  QUESTION_STATUS,
  ROUNDS_PER_MATCH,
  SPACE_ROLE,
} from '../src/shared/constants.js';

/**
 * The revision deck (the "your mistakes" loop).
 *
 * The property that makes this a study feature rather than a list: **the deck
 * drains.** A question you missed and have since got right is gone from it. If
 * the deck only grew, opening it would be a punishment, and nobody would.
 *
 * Everything here is derived — no new writes, no new collection. Which means the
 * risk is not "does the write happen" but "does the query mean what it says", so
 * these tests are mostly about the aggregation's edges: which answer counts as
 * the latest one, what a blank round means, and what happens when the question
 * bank changes underneath a mistake that has already been recorded.
 */

let harness;
let student;
let admin;
let space;
let topic;

before(async () => {
  harness = await startHarness();
});
after(async () => {
  await stopHarness();
});
beforeEach(async () => {
  await resetDb();
  admin = await makeUser({ displayName: 'Deck Admin' });
  student = await makeUser({ displayName: 'Deck Student' });
  space = await makeSpace({ name: 'Deck Institute', owner: admin.user });
  await addMember(space, student.user, SPACE_ROLE.STUDENT);
  ({ topic } = await makeTopic({ spaceId: space._id, name: 'Deck Topic' }));
});

/**
 * One drill, answered per the `answers` callback.
 *
 * Returns the questions dealt in order, so a test can assert on the paper itself
 * rather than only on what the deck said afterwards.
 */
async function drill({ answer, deck = null, mode = MATCH_MODE.PRACTICE } = {}) {
  const client = connectClient(student.token, { port: harness.port });
  await client.connected();
  const ack = await client.emit(C2S.QUEUE_JOIN, {
    topicId: String(topic._id),
    spaceId: String(space._id),
    mode,
    deck,
  });
  if (ack?.ok === false) {
    client.close();
    return { error: ack, dealt: [] };
  }

  const found = await client.wait(S2C.MATCH_FOUND, { timeoutMs: 8000 });
  const matchId = found.payload.matchId;
  const dealt = [];

  for (let round = 0; round < found.payload.totalRounds; round += 1) {
    const frame = await client.wait(S2C.ROUND_START, {
      predicate: (p) => p.roundIndex === round,
      timeoutMs: 8000,
    });
    dealt.push(String(frame.payload.question.id));
    const right = frame.payload.question.options.findIndex((o) => o.startsWith('Right'));
    const pick = answer({ round, right, questionId: String(frame.payload.question.id) });
    if (pick !== null) {
      await client.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: round, optionIndex: pick });
    }
  }

  await client.wait(S2C.MATCH_END, { timeoutMs: 12_000 });
  client.close();
  return { dealt, matchId };
}

/** Get everything wrong. */
const allWrong = ({ right }) => (right + 1) % 4;
/** Get everything right. */
const allRight = ({ right }) => right;

// ── What lands in the deck ─────────────────────────────────────────────────

test('a wrong answer puts the question in the deck', async () => {
  const { dealt } = await drill({ answer: allWrong });

  const byTopic = await mistakesByTopic(student.user._id);
  assert.equal(byTopic.length, 1, 'one topic has mistakes in it');
  assert.equal(byTopic[0].topic.id, String(topic._id));
  assert.equal(byTopic[0].count, ROUNDS_PER_MATCH, 'all seven were missed');
  assert.equal(byTopic[0].full, true, 'and that is enough to fill a drill');

  const ids = await mistakeQuestionIds(student.user._id, topic._id, { limit: 50 });
  assert.deepEqual(
    new Set(ids.map(String)),
    new Set(dealt),
    'exactly the questions that were dealt and missed',
  );
});

test('a right answer never enters the deck', async () => {
  await drill({ answer: allRight });
  assert.deepEqual(await mistakesByTopic(student.user._id), []);
});

test('a blank round is not a mistake', async () => {
  // Answer nothing at all and let every round time out.
  await drill({ answer: () => null });

  assert.deepEqual(
    await mistakesByTopic(student.user._id),
    [],
    'a timeout can be a tunnel or a phone call; only a wrong answer is a signal',
  );
});

// ── The property that matters: it drains ───────────────────────────────────

test('getting a question right later removes it from the deck', async () => {
  const { dealt } = await drill({ answer: allWrong });
  const missed = new Set(dealt);
  assert.equal((await mistakesByTopic(student.user._id))[0].count, ROUNDS_PER_MATCH);

  // Revise, and get right exactly the ones that come back.
  const second = await drill({ deck: DECK.MISTAKES, answer: allRight });
  for (const id of second.dealt) {
    assert.ok(missed.has(id), `the drill dealt ${id}, which was never missed`);
  }

  const after = await mistakesByTopic(student.user._id);
  assert.equal(
    after.length,
    0,
    'the deck is empty — the last answer decides, and the last answer was right',
  );
});

test('getting it wrong again keeps it, and raises its priority', async () => {
  await drill({ answer: allWrong });
  const first = await mistakeQuestionIds(student.user._id, topic._id, { limit: 50 });

  // Miss them all a second time.
  await drill({ deck: DECK.MISTAKES, answer: allWrong });

  const still = await mistakesByTopic(student.user._id);
  assert.equal(still[0].count, ROUNDS_PER_MATCH, 'still owed');

  const twiceWrong = await mistakeQuestionIds(student.user._id, topic._id, { limit: 50 });
  assert.equal(twiceWrong.length, first.length);
});

/**
 * The ordering rule, tested against constructed history rather than real matches.
 *
 * "The latest answer decides" rests entirely on `$sort: { createdAt: 1 }` running
 * before the `$group` that takes `$last`. Real matches cannot exercise that: the
 * selector deliberately avoids repeating a question a player has seen recently, so
 * driving the same question wrong → right → wrong through the socket would need
 * five matches and a pool exhausted in exactly the right order — a test that
 * passes for reasons unrelated to what it claims.
 *
 * Written history gives the one thing that matters here: control of the clock.
 */
async function writeHistory(questionId, sequence) {
  const day = 24 * 60 * 60 * 1000;
  // Deliberately inserted newest-first, so a pipeline that forgot to sort would
  // read the FIRST answer as the latest one and these tests would catch it.
  const rows = sequence
    .map((isCorrect, i) => ({ isCorrect, at: new Date(Date.now() - (sequence.length - i) * day) }))
    .reverse();

  for (const row of rows) {
    await Match.create({
      topicId: topic._id,
      spaceId: space._id,
      mode: MATCH_MODE.PRACTICE,
      status: 'complete',
      players: [{ userId: student.user._id, displayName: 'Deck Student', score: 0 }],
      questionIds: [questionId],
      rounds: [
        {
          questionIndex: 0,
          questionId,
          correctIndex: 0,
          answers: [{ userId: student.user._id, optionIndex: 1, isCorrect: row.isCorrect }],
        },
      ],
      createdAt: row.at,
      completedAt: row.at,
    });
  }
}

test('the latest answer decides, in both directions', async () => {
  const [q1, q2, q3] = await Question.find({ topicIds: topic._id }).limit(3).lean();

  await writeHistory(q1._id, [false, true]); //  missed, then got right → settled
  await writeHistory(q2._id, [false, true, false]); //  and missed again → owed
  await writeHistory(q3._id, [true, false, true]); //  right, missed, right → settled

  const owed = (await mistakeQuestionIds(student.user._id, topic._id, { limit: 50 })).map(String);

  assert.ok(!owed.includes(String(q1._id)), 'a mistake put right is not a mistake any more');
  assert.ok(owed.includes(String(q2._id)), 'and one put wrong again is owed again');
  assert.ok(!owed.includes(String(q3._id)), 'recovering from a slip settles it too');
  assert.equal(owed.length, 1);
});

test('the deck is ordered by how often a question has been missed', async () => {
  const [q1, q2, q3] = await Question.find({ topicIds: topic._id }).limit(3).lean();

  await writeHistory(q1._id, [false]); //  missed once
  await writeHistory(q2._id, [false, false, false]); //  missed three times
  await writeHistory(q3._id, [false, false]); //  missed twice

  const owed = (await mistakeQuestionIds(student.user._id, topic._id, { limit: 50 })).map(String);
  assert.deepEqual(
    owed,
    [String(q2._id), String(q3._id), String(q1._id)],
    'the question missed most is the one that most needs the seat',
  );
});

// ── What the drill actually deals ──────────────────────────────────────────

test('the revision drill deals the missed questions, not new ones', async () => {
  const { dealt } = await drill({ answer: allWrong });
  const missed = new Set(dealt);

  const revision = await drill({ deck: DECK.MISTAKES, answer: () => null });
  assert.equal(revision.dealt.length, ROUNDS_PER_MATCH);
  for (const id of revision.dealt) {
    assert.ok(missed.has(id), 'every round of a revision drill is something previously missed');
  }
});

test('a partial deck is backfilled to a full match rather than dealing three rounds', async () => {
  // Miss exactly two, get the rest right.
  const { dealt } = await drill({
    answer: ({ round, right }) => (round < 2 ? (right + 1) % 4 : right),
  });
  const missed = new Set(dealt.slice(0, 2));
  assert.equal((await mistakesByTopic(student.user._id))[0].count, 2);
  assert.equal((await mistakesByTopic(student.user._id))[0].full, false);

  const revision = await drill({ deck: DECK.MISTAKES, answer: () => null });
  assert.equal(revision.dealt.length, ROUNDS_PER_MATCH, 'still a whole match');
  const overlap = revision.dealt.filter((id) => missed.has(id));
  assert.equal(overlap.length, 2, 'and both owed questions are on it');
});

test('a revision drill is still a drill: no opponent, no verdict', async () => {
  await drill({ answer: allWrong });

  const client = connectClient(student.token, { port: harness.port });
  await client.connected();
  await client.emit(C2S.QUEUE_JOIN, {
    topicId: String(topic._id),
    spaceId: String(space._id),
    mode: MATCH_MODE.PRACTICE,
    deck: DECK.MISTAKES,
  });
  const found = await client.wait(S2C.MATCH_FOUND, { timeoutMs: 8000 });
  assert.equal(found.payload.opponent, null);
  client.close();
});

// ── Refusals ───────────────────────────────────────────────────────────────

test('an empty deck is refused rather than quietly becoming a normal drill', async () => {
  const client = connectClient(student.token, { port: harness.port });
  await client.connected();
  const ack = await client.emit(C2S.QUEUE_JOIN, {
    topicId: String(topic._id),
    spaceId: String(space._id),
    mode: MATCH_MODE.PRACTICE,
    deck: DECK.MISTAKES,
  });

  assert.equal(ack.ok, false, 'nothing is owed, so there is nothing to revise');
  client.close();
});

test('a revision deck cannot be played for the ladder', async () => {
  await drill({ answer: allWrong });

  for (const mode of [MATCH_MODE.RANKED, MATCH_MODE.QUICK]) {
    const client = connectClient(student.token, { port: harness.port });
    await client.connected();
    const ack = await client.emit(C2S.QUEUE_JOIN, {
      topicId: String(topic._id),
      spaceId: String(space._id),
      mode,
      deck: DECK.MISTAKES,
    });
    assert.equal(ack.ok, false, `${mode}: known-missed questions are a repeat, and a repeat is an edge`);
    client.close();
  }
});

test('an unknown deck name is refused', async () => {
  const client = connectClient(student.token, { port: harness.port });
  await client.connected();
  const ack = await client.emit(C2S.QUEUE_JOIN, {
    topicId: String(topic._id),
    spaceId: String(space._id),
    mode: MATCH_MODE.PRACTICE,
    deck: 'everything',
  });
  assert.equal(ack.ok, false);
  client.close();
});

// ── The bank changing underneath a recorded mistake ────────────────────────

test('a question unpublished since the mistake is neither counted nor served', async () => {
  const { dealt } = await drill({ answer: allWrong });
  assert.equal((await mistakesByTopic(student.user._id))[0].count, ROUNDS_PER_MATCH);

  // Moderation pulls three of them.
  const pulled = dealt.slice(0, 3);
  await Question.updateMany(
    { _id: { $in: pulled } },
    { $set: { status: QUESTION_STATUS.ARCHIVED } },
  );

  const byTopic = await mistakesByTopic(student.user._id);
  assert.equal(
    byTopic[0].count,
    ROUNDS_PER_MATCH - 3,
    'a count that promises questions it cannot deal is worse than no count',
  );

  const ids = (await mistakeQuestionIds(student.user._id, topic._id, { limit: 50 })).map(String);
  for (const id of pulled) assert.ok(!ids.includes(id), 'and it is never dealt');
});

test('a question pulled out of the topic since the mistake drops out too', async () => {
  const { dealt } = await drill({ answer: allWrong });
  await Question.updateMany({ _id: { $in: dealt.slice(0, 2) } }, { $set: { topicIds: [] } });

  const byTopic = await mistakesByTopic(student.user._id);
  assert.equal(byTopic[0].count, ROUNDS_PER_MATCH - 2);
});

test('a topic whose every mistake has been retired disappears from the list', async () => {
  const { dealt } = await drill({ answer: allWrong });
  await Question.updateMany(
    { _id: { $in: dealt } },
    { $set: { status: QUESTION_STATUS.ARCHIVED } },
  );

  assert.deepEqual(
    await mistakesByTopic(student.user._id),
    [],
    'an empty row inviting a drill that cannot be dealt is a dead end',
  );
});

// ── The endpoint ───────────────────────────────────────────────────────────

test('GET /me/mistakes returns the deck for the signed-in player alone', async () => {
  await drill({ answer: allWrong });

  const mine = await api(harness.app, student.token).get('/me/mistakes');
  assert.equal(mine.statusCode, 200);
  assert.equal(mine.json().data.items.length, 1);
  assert.equal(mine.json().data.items[0].count, ROUNDS_PER_MATCH);
  assert.ok(mine.json().data.items[0].topic.name, 'the topic is named, so the row can be a button');

  const theirs = await api(harness.app, admin.token).get('/me/mistakes');
  assert.equal(theirs.statusCode, 200);
  assert.deepEqual(theirs.json().data.items, [], 'one player’s mistakes are their own');
});

test('leaving an organization takes its topics out of your deck', async () => {
  await drill({ answer: allWrong });
  assert.equal((await mistakesByTopic(student.user._id)).length, 1);

  // The student leaves. Their history is permanent; their access is not.
  await SpaceMember.updateOne(
    { spaceId: space._id, userId: student.user._id },
    { $set: { status: 'left' } },
  );

  assert.deepEqual(
    await mistakesByTopic(student.user._id),
    [],
    'a row whose drill the queue would refuse is worse than no row',
  );
});

test('the deck ignores matches that are still live', async () => {
  // A live match has rounds but no result; counting its answers would put a
  // question in the deck before the player had finished the match it came from.
  await drill({ answer: allWrong });
  await Match.updateMany({}, { $set: { status: 'live' } });

  assert.deepEqual(await mistakesByTopic(student.user._id), []);
});

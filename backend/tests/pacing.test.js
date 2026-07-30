import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEST_TIMING,
  startHarness,
  stopHarness,
  resetDb,
  makeUser,
  makeSpace,
  makeTopic,
  addMember,
  connectClient,
} from './helpers.js';
import { C2S, S2C } from '../src/shared/protocol.js';
import {
  DECK,
  MATCH_MODE,
  SPACE_ROLE,
  SOLO_COUNTDOWN_MS,
  VERSUS_COUNTDOWN_MS,
} from '../src/shared/constants.js';

/**
 * How long a match makes you wait before its first question.
 *
 * ── Why this has a file of its own ───────────────────────────────────────────
 *
 * Every other suite runs on `TEST_TIMING`, which pins `countdownMs` to 100 so a
 * seven-round match takes three seconds instead of ninety. That override is
 * exactly what has to be *absent* here: the thing under test is the number the
 * server picks when nobody has told it one, and a suite that overrides it can
 * only ever assert its own override back.
 *
 * ── What was wrong ───────────────────────────────────────────────────────────
 *
 * `VERSUS_COUNTDOWN_MS` is 5,500ms and it is not a loading delay — it is the
 * versus ceremony: two faces, two flags, two league badges and a coin. It was
 * applied to every match, including the two that never see that screen. A
 * practice drill and a revision drill are one-player matches, and the client
 * sends those straight to the board, so those five and a half seconds were spent
 * on an empty question card with nothing happening.
 *
 * That is the whole of "practice and revise are slow to load". The questions
 * were dealt before the player let go of the button; the app then sat still.
 */

let harness;
let admin;
let student;
let space;
let topic;

before(async () => {
  // The one suite that runs with the production countdown, because it is the
  // production countdown it is about.
  harness = await startHarness({ ...TEST_TIMING, countdownMs: undefined });
});
after(async () => {
  await stopHarness();
});
beforeEach(async () => {
  await resetDb();
  admin = await makeUser({ displayName: 'Pacing Admin' });
  student = await makeUser({ displayName: 'Pacing Student' });
  space = await makeSpace({ name: 'Pacing Institute', owner: admin.user });
  await addMember(space, student.user, SPACE_ROLE.STUDENT);
  ({ topic } = await makeTopic({ spaceId: space._id, name: 'Pacing Topic' }));
});

/**
 * Queue, and read `match:start` without playing the match out.
 *
 * `elapsedMs` is measured from the join going out to the start frame coming
 * back, so it covers everything the server does to make a paper: resolving the
 * topic, building the deck when there is one, selecting the questions, shuffling
 * every option set and registering the match.
 */
async function startFrameFor(mode, deck = null) {
  const client = connectClient(student.token, { port: harness.port });
  await client.connected();
  const began = Date.now();
  await client.emit(C2S.QUEUE_JOIN, {
    topicId: String(topic._id),
    spaceId: String(space._id),
    mode,
    deck,
  });
  const start = await client.wait(S2C.MATCH_START, { timeoutMs: 10_000 });
  const elapsedMs = Date.now() - began;
  client.close();
  return { ...start.payload, elapsedMs };
}

/**
 * Play one drill start to finish, getting every answer wrong.
 *
 * Played OUT rather than abandoned, and that is not tidiness. A match left in the
 * registry is resumed the next time that player connects — `match:resume` instead
 * of `match:found` — so a test that measures a start frame and walks away poisons
 * whatever it does next. It also seeds the deck: seven wrong answers is seven
 * questions owed.
 */
async function missEverything() {
  const client = connectClient(student.token, { port: harness.port });
  await client.connected();
  const began = Date.now();
  await client.emit(C2S.QUEUE_JOIN, {
    topicId: String(topic._id),
    spaceId: String(space._id),
    mode: MATCH_MODE.PRACTICE,
  });
  const found = await client.wait(S2C.MATCH_FOUND, { timeoutMs: 10_000 });
  const elapsedMs = Date.now() - began;
  for (let round = 0; round < found.payload.totalRounds; round += 1) {
    const frame = await client.wait(S2C.ROUND_START, {
      predicate: (p) => p.roundIndex === round,
      timeoutMs: 10_000,
    });
    const right = frame.payload.question.options.findIndex((o) => o.startsWith('Right'));
    await client.emit(C2S.MATCH_ANSWER, {
      matchId: found.payload.matchId,
      roundIndex: round,
      optionIndex: (right + 1) % 4,
    });
  }
  await client.wait(S2C.MATCH_END, { timeoutMs: 15_000 });
  client.close();
  return { elapsedMs };
}

test('a drill opens almost immediately — there is no ceremony to cover', async () => {
  const payload = await startFrameFor(MATCH_MODE.PRACTICE);

  assert.equal(
    payload.countdownMs,
    SOLO_COUNTDOWN_MS,
    'a one-player match must not pay for the versus screen it never sees',
  );
  assert.ok(
    payload.countdownMs < VERSUS_COUNTDOWN_MS,
    'and it must be shorter than the ceremony, or the fix did nothing',
  );
  assert.ok(
    payload.startsAt - payload.serverNow <= SOLO_COUNTDOWN_MS + 50,
    'the deadline the client draws has to agree with the countdown it was sent',
  );
});

test('a real match keeps the full versus beat', async () => {
  // No second player is queued, so this pairs with a ghost after `ghostAfterMs`
  // — two players either way, which is what the countdown is keyed on.
  const payload = await startFrameFor(MATCH_MODE.QUICK);

  assert.equal(
    payload.countdownMs,
    VERSUS_COUNTDOWN_MS,
    'two faces, two flags and a coin still need their five and a half seconds',
  );
});

/**
 * The other half of "practice and revise are slow", measured rather than assumed.
 *
 * The suspicion worth ruling out is that a drill's questions are genuinely slow
 * to come — a revision deck runs an aggregation over every match this player has
 * ever finished, unwinding seven rounds and their answers, before a single
 * question is chosen. If that were the cost, no amount of shortening a countdown
 * would help.
 *
 * It is not. Both papers are built in well under a second end to end, over a real
 * socket, which is what makes the countdown the entire story. The budget is
 * deliberately loose — this is a regression guard against something becoming
 * seconds-slow, not a benchmark, and a tight bound on a shared CI box is a test
 * that fails for reasons that have nothing to do with the code.
 */
test('the questions themselves are not the slow part', async () => {
  // Timed and played out in one pass, which also seeds the deck the second half
  // of this test needs.
  const practice = await missEverything();
  assert.ok(
    practice.elapsedMs < 1500,
    `a practice paper took ${practice.elapsedMs}ms to deal`,
  );

  const revision = await startFrameFor(MATCH_MODE.PRACTICE, DECK.MISTAKES);
  assert.equal(revision.countdownMs, SOLO_COUNTDOWN_MS, 'a revision drill is a drill');
  assert.ok(
    revision.elapsedMs < 1500,
    `a revision paper took ${revision.elapsedMs}ms to deal`,
  );

  console.log(
    `      practice ${practice.elapsedMs}ms · revision ${revision.elapsedMs}ms ` +
      `· countdown was ${VERSUS_COUNTDOWN_MS}ms, now ${SOLO_COUNTDOWN_MS}ms`,
  );
});

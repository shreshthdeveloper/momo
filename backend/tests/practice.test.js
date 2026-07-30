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
} from './helpers.js';
import { C2S, S2C } from '../src/shared/protocol.js';
import {
  Assignment,
  AssignmentProgress,
  Match,
  Rating,
  User,
} from '../src/models/index.js';
import { xpForMatch, coinsForMatch } from '../src/shared/mastery.js';
import {
  MATCH_MODE,
  ROUNDS_PER_MATCH,
  SPACE_ROLE,
  XP_PER_CORRECT,
  XP_PER_MATCH,
  XP_WIN_BONUS,
} from '../src/shared/constants.js';

/**
 * What a drill is worth (leagues-and-progression.md §1, §6).
 *
 * Practice is the one mode with no opponent, no rating and no limit on retries,
 * which makes it the one mode where every reward has to be argued for rather
 * than inherited. The rule these tests pin down is:
 *
 *   **a drill is play, not a match.**
 *
 * Play, so it pays participation XP, extends the streak and moves the mastery
 * stats — those measure showing up, and practice is showing up. Not a match, so
 * it has no verdict, pays no coins, touches no win/loss record, wins none of the
 * achievements that are about matches, and does no homework.
 *
 * Every one of those was broken at once, and by a single line: with no second
 * player to compare against, `a.score > (b?.score ?? 0)` made the solo player
 * the winner of every drill they scored a point in. One wrong verdict then paid
 * a win bonus, incremented a public win count, armed the win achievements and
 * ticked off an assignment. So the tests are written against the *consequences*
 * rather than against the comparison — a future refactor can move where the
 * verdict is decided, and these still hold it to the same bargain.
 */

let harness;
let admin;
let student;
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
  admin = await makeUser({ displayName: 'Drill Admin' });
  student = await makeUser({ displayName: 'Drill Student' });
  space = await makeSpace({ name: 'Drill Institute', owner: admin.user });
  await addMember(space, student.user, SPACE_ROLE.STUDENT);
  ({ topic } = await makeTopic({ spaceId: space._id, name: 'Drill Topic' }));
});

/**
 * One complete run through the real socket path, answering every round.
 *
 * `mode` is the whole point of the helper: the same seven questions, answered
 * the same way, differing only in what the player queued for — so any difference
 * in the reward is attributable to the mode and nothing else.
 */
async function playThrough({ mode, correct = true } = {}) {
  const client = connectClient(student.token, { port: harness.port });
  await client.connected();
  await client.emit(C2S.QUEUE_JOIN, {
    topicId: String(topic._id),
    spaceId: String(space._id),
    mode,
  });

  const found = await client.wait(S2C.MATCH_FOUND, { timeoutMs: 8000 });
  const matchId = found.payload.matchId;

  for (let round = 0; round < found.payload.totalRounds; round += 1) {
    const frame = await client.wait(S2C.ROUND_START, {
      predicate: (p) => p.roundIndex === round,
      timeoutMs: 8000,
    });
    // The seeded correct option is the one written as "Right …", wherever this
    // match's shuffle put it.
    const right = frame.payload.question.options.findIndex((o) => o.startsWith('Right'));
    await client.emit(C2S.MATCH_ANSWER, {
      matchId,
      roundIndex: round,
      optionIndex: correct ? right : (right + 1) % 4,
    });
  }

  const end = await client.wait(S2C.MATCH_END, { timeoutMs: 12_000 });
  client.close();
  return { end: end.payload, found: found.payload };
}

const freshUser = () => User.findById(student.user._id).lean();
const topicRow = () =>
  Rating.findOne({ userId: student.user._id, topicId: topic._id }).lean();

// ── The verdict ────────────────────────────────────────────────────────────

test('a drill reports no verdict, not a win', async () => {
  const { end } = await playThrough({ mode: MATCH_MODE.PRACTICE });

  assert.equal(
    end.verdict,
    'solo',
    'a one-player match has no verdict; "won" is the bug this file exists for',
  );
  assert.equal(end.opponent, null, 'and nobody to have beaten');
  assert.equal(end.winnerId, null, 'so no winner is recorded either');
  assert.equal(end.isDraw, false, 'a drill is not a draw — that would claim level scores');
});

test('the stored match agrees with the live payload about having no verdict', async () => {
  await playThrough({ mode: MATCH_MODE.PRACTICE });

  const stored = await Match.findOne({ 'players.userId': student.user._id }).lean();
  assert.equal(stored.players.length, 1);
  assert.equal(stored.winnerId ?? null, null);
  assert.equal(stored.isDraw, false);
});

// ── XP: paid, but not the bonus ────────────────────────────────────────────

test('a perfect drill pays participation XP and no win bonus', async () => {
  const before = await freshUser();
  const { end } = await playThrough({ mode: MATCH_MODE.PRACTICE });

  const expected = XP_PER_MATCH + ROUNDS_PER_MATCH * XP_PER_CORRECT;
  assert.equal(end.xpEarned, expected, 'participation and the correct answers, nothing more');

  const after = await freshUser();
  assert.equal(
    (after.totalXp ?? 0) - (before.totalXp ?? 0),
    expected,
    'and the account is credited exactly that',
  );

  // The specific regression: the win bonus is 30, so a drill that collected one
  // came out 30 ahead of an honest drill and ahead of quick play too.
  assert.ok(end.xpEarned < expected + XP_WIN_BONUS);
});

test('the XP table refuses the bonus for a solo verdict directly', () => {
  const base = XP_PER_MATCH + ROUNDS_PER_MATCH * XP_PER_CORRECT;
  assert.equal(
    xpForMatch({ verdict: 'solo', correctCount: ROUNDS_PER_MATCH, mode: MATCH_MODE.PRACTICE }),
    base,
  );
  // Stated at the unit level as well as through the socket, because the rule has
  // to survive a mode that is solo without being practice.
  assert.equal(
    xpForMatch({ verdict: 'solo', correctCount: ROUNDS_PER_MATCH, mode: MATCH_MODE.RANKED }),
    base,
  );
  assert.equal(
    xpForMatch({ verdict: 'won', correctCount: ROUNDS_PER_MATCH, mode: MATCH_MODE.RANKED }),
    base + XP_WIN_BONUS,
    'a real win still gets it, or the test proves nothing',
  );
});

// ── Coins: none, directly or through a level ───────────────────────────────

test('a drill pays no coins for the drill itself', async () => {
  const before = await freshUser();
  const { end } = await playThrough({ mode: MATCH_MODE.PRACTICE });

  assert.equal(end.coinsFromMatch, 0, 'the run itself is worth nothing');
  assert.equal(
    end.coinsEarned,
    end.coinsFromLevels,
    'so every coin banked came from a level, and none from the result',
  );

  const after = await freshUser();
  assert.equal(
    (after.coins ?? 0) - (before.coins ?? 0),
    end.coinsEarned ?? 0,
    'whatever was reported is what was banked',
  );
});

/**
 * The deliberate exception, written down so it is not read as the leak's twin.
 *
 * A drill pays XP. XP crosses account levels. Levels pay coins. So coins do
 * reach a practising player — indirectly, and that is correct: the alternative is
 * that crossing level 5 pays or does not pay depending on which match happened to
 * be the one that crossed it, which is arbitrary and quietly swallows something
 * the player earned.
 *
 * It is not a farm, and the test below is what makes that true rather than
 * hopeful: level rewards are one-time per level, and a drill's XP is capped at
 * what quick play pays for the same answers. Practice is the least profitable
 * mode in the game, which is exactly where a mode with no stakes belongs.
 */
test('a level crossed during a drill still pays, and a drill never out-earns quick play', async () => {
  const perfect = { correctCount: ROUNDS_PER_MATCH };
  const drill = xpForMatch({ ...perfect, verdict: 'solo', mode: MATCH_MODE.PRACTICE });
  const quickWin = xpForMatch({ ...perfect, verdict: 'won', mode: MATCH_MODE.QUICK });
  const quickLoss = xpForMatch({ ...perfect, verdict: 'lost', mode: MATCH_MODE.QUICK });

  assert.equal(drill, quickWin, 'the same answers are worth the same in both');
  assert.equal(drill, quickLoss, 'quick play has no bonus either');
  assert.equal(
    coinsForMatch({ verdict: 'solo', mode: MATCH_MODE.PRACTICE }),
    0,
    'and quick play additionally pays a win, so practice earns strictly least',
  );

  // The level reward itself still lands — via XP, from a drill.
  const { end } = await playThrough({ mode: MATCH_MODE.PRACTICE });
  assert.ok(end.xpEarned > 0, 'the XP that crosses a level is real XP');
  assert.equal(end.coinsFromMatch, 0, 'even when the level pays out');
});

test('the coin table refuses a solo verdict in every mode', () => {
  for (const mode of Object.values(MATCH_MODE)) {
    assert.equal(
      coinsForMatch({ verdict: 'solo', mode }),
      0,
      `${mode}: an opponent-less run has nothing to be paid for`,
    );
  }
});

// ── The public record ──────────────────────────────────────────────────────

test('a drill stays out of the win/loss record', async () => {
  const before = await freshUser();
  await playThrough({ mode: MATCH_MODE.PRACTICE });
  const after = await freshUser();

  assert.equal(after.matchesWon, before.matchesWon ?? 0, 'nothing was won');
  assert.equal(
    after.matchesPlayed,
    before.matchesPlayed ?? 0,
    'and counting only the denominator would make practising visibly damage the win rate',
  );
});

test('a drill stays out of the topic win/loss record too', async () => {
  await playThrough({ mode: MATCH_MODE.PRACTICE });
  const row = await topicRow();

  assert.equal(row.wins, 0);
  assert.equal(row.losses, 0);
  assert.equal(row.draws, 0, 'falling through to draws would claim a level score with nobody');
  assert.equal(
    row.matchesPlayed,
    0,
    'the leaderboard breaks ties on fewer matches, so drills must not count',
  );
});

test('but the mastery stats a drill exists to move do move', async () => {
  await playThrough({ mode: MATCH_MODE.PRACTICE });
  const row = await topicRow();

  assert.ok(row.xp > 0, 'XP is the reward practice does get');
  assert.equal(row.correctAnswers, ROUNDS_PER_MATCH);
  assert.equal(row.totalAnswers, ROUNDS_PER_MATCH);
  assert.ok(row.lastPlayedAt, 'and it counts as having played the topic');
});

test('a drill still extends the streak, because that measures showing up', async () => {
  await playThrough({ mode: MATCH_MODE.PRACTICE });
  const after = await freshUser();
  assert.equal(after.streak.current, 1);
  assert.ok(after.streak.lastPlayedOn, 'and today is recorded');
});

// ── Achievements ───────────────────────────────────────────────────────────

test('a perfect drill does not win "Perfect", which says match', async () => {
  const { end } = await playThrough({ mode: MATCH_MODE.PRACTICE });
  assert.equal(end.verdict, 'solo');

  const after = await freshUser();
  const keys = (after.achievements ?? []).map((a) => a.key);
  assert.ok(
    !keys.includes('perfect_match'),
    'seven from seven against nobody, with unlimited retries, is not the badge',
  );
  assert.ok(!keys.includes('first_win'), 'and nothing was won');
  assert.ok(!keys.includes('giant_slayer'));
});

test('the same seven answers in a real match do win it', async () => {
  // The control. Without this the test above passes just as well if achievements
  // are broken outright.
  const { end } = await playThrough({ mode: MATCH_MODE.QUICK });
  assert.notEqual(end.verdict, 'solo', 'quick play pairs with a ghost, so there is an opponent');

  const after = await freshUser();
  const keys = (after.achievements ?? []).map((a) => a.key);
  assert.ok(keys.includes('perfect_match'), 'seven from seven in a match is the badge');
});

// ── Homework ───────────────────────────────────────────────────────────────

test('a drill does not advance an assignment', async () => {
  const assignment = await Assignment.create({
    spaceId: space._id,
    topicId: topic._id,
    title: 'Drill homework',
    requirement: { type: 'matches', matches: 1 },
    dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    createdBy: admin.user._id,
  });

  const { end } = await playThrough({ mode: MATCH_MODE.PRACTICE });
  assert.deepEqual(end.assignmentsCompleted ?? [], []);

  const progress = await AssignmentProgress.findOne({
    assignmentId: assignment._id,
    userId: student.user._id,
  }).lean();
  assert.equal(
    progress,
    null,
    'not even a progress row: a requirement with unlimited retries and no opponent is not a bar',
  );
});

test('ordinary play in the same topic still does', async () => {
  // The control again — the assignment hook itself has to still work, or the
  // test above is passing for the wrong reason.
  const assignment = await Assignment.create({
    spaceId: space._id,
    topicId: topic._id,
    title: 'Real homework',
    requirement: { type: 'matches', matches: 1 },
    dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    createdBy: admin.user._id,
  });

  const { end } = await playThrough({ mode: MATCH_MODE.QUICK });
  assert.equal(end.assignmentsCompleted.length, 1);
  assert.equal(end.assignmentsCompleted[0].title, 'Real homework');

  const progress = await AssignmentProgress.findOne({
    assignmentId: assignment._id,
    userId: student.user._id,
  }).lean();
  assert.equal(progress.matchesPlayed, 1);
});

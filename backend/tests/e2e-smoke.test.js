import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, stopHarness, resetDb, makeTopic, connectClient, api, sleep } from './helpers.js';
import { C2S, S2C } from '../src/shared/protocol.js';
import { ROUNDS_PER_MATCH } from '../src/shared/constants.js';

/**
 * The whole product in one test: sign up, pick a topic, play a full match
 * against a ghost, and read the review afterwards.
 *
 * prd.md G1 — "a stranger installs the app and completes an enjoyable match in
 * under 90 seconds, with no empty lobby, ever." This is that path, minus the
 * install.
 */

let harness;
before(async () => { harness = await startHarness(); });
after(async () => { await stopHarness(); });

test('a new player signs up, plays a full match, and reads the review', async () => {
  await resetDb();
  const { topic } = await makeTopic({ name: 'Smoke Test Topic' });

  const anon = api(harness.app);

  // 1. Sign up with phone + OTP
  const send = await anon.post('/auth/otp/send', { phone: '9812345678' });
  const { devCode, phone } = JSON.parse(send.body).data;
  const verify = await anon.post('/auth/otp/verify', { phone, code: devCode });
  const { user, tokens, needsProfile } = JSON.parse(verify.body).data;
  assert.equal(needsProfile, true);

  const me = api(harness.app, tokens.accessToken);

  // 2. Set a display name
  const named = await me.patch('/me', { displayName: 'Newcomer', city: 'Pune' });
  assert.equal(named.statusCode, 200);

  // 3. The home feed offers something to play
  const home = await me.get('/home');
  assert.equal(home.statusCode, 200);
  const feed = JSON.parse(home.body).data;
  assert.ok(feed.rows.length > 0, 'a brand new account is never shown an empty home');
  const card = feed.rows[0].topics[0];
  assert.equal(card.id, String(topic._id));

  // 4. Queue up — no live opponent exists, so a ghost must be served
  const client = connectClient(tokens.accessToken, { port: harness.port });
  await client.connected();
  await client.emit(C2S.QUEUE_JOIN, { topicId: card.id });

  const found = await client.wait(S2C.MATCH_FOUND, { timeoutMs: 5000 });
  assert.ok(found.payload.opponent, 'never an empty lobby — prd.md G2');
  const matchId = found.payload.matchId;

  // 5. Play all seven rounds
  for (let round = 0; round < ROUNDS_PER_MATCH; round += 1) {
    const start = await client.wait(S2C.ROUND_START, { predicate: (p) => p.roundIndex === round });
    const correct = start.payload.question.options.findIndex((o) => o.startsWith('Right'));
    await client.emit(C2S.MATCH_ANSWER, { matchId, roundIndex: round, optionIndex: correct });
    await client.wait(S2C.ROUND_RESULT, { predicate: (p) => p.roundIndex === round });
  }

  const end = await client.wait(S2C.MATCH_END);
  assert.equal(end.payload.verdict, 'won');
  assert.ok(end.payload.xpEarned > 0);
  await sleep(250);

  // 6. Read the review — the only place the answer key is returned
  const review = await me.get(`/matches/${matchId}`);
  assert.equal(review.statusCode, 200);
  const detail = JSON.parse(review.body).data;
  assert.equal(detail.rounds.length, ROUNDS_PER_MATCH);
  assert.ok(detail.rounds[0].explanation, 'explanations reach the review screen');
  assert.equal(detail.rounds[0].you.isCorrect, true);
  assert.equal(typeof detail.rounds[0].correctIndex, 'number');

  // 7. The match shows up in history, and the topic rating moved
  const history = await me.get('/matches');
  assert.equal(JSON.parse(history.body).data.items.length, 1);

  const stats = await me.get('/me/stats');
  const statsBody = JSON.parse(stats.body).data;
  assert.equal(statsBody.matchesPlayed, 1);
  assert.equal(statsBody.matchesWon, 1);
  assert.ok(statsBody.topTopics[0].rating > 1200, 'winning raised the topic rating');

  // 8. And the player now appears on the topic leaderboard
  const board = await me.get(`/leaderboards/topic/${card.id}`);
  const boardBody = JSON.parse(board.body).data;
  assert.equal(boardBody.entries[0].displayName, 'Newcomer');
  assert.equal(boardBody.viewerRow.rank, 1);

  assert.ok(user.id);
  client.close();
});

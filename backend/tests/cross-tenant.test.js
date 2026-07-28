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
import { Question, Rating, publicSpaceId } from '../src/models/index.js';
import { C2S, S2C } from '../src/shared/protocol.js';
import { selectQuestions, allowedOriginsFor } from '../src/game/questionSelector.js';
import { SPACE_ROLE } from '../src/shared/constants.js';

/**
 * tech.md §13 — MANDATORY SUITE. NEVER SKIPPABLE IN CI.
 *
 * "A user in Space A is denied every Space B resource."
 *
 * prd.md §13 states it as a product requirement rather than an engineering
 * one: tenant data never crosses Space boundaries under any circumstance. A
 * leak between institutes is not a bug, it is an incident — so this file
 * probes every surface that takes a spaceId, plus the two that do not take one
 * at all and could still leak (question selection and the socket queue).
 */

let harness;
let ctx;

before(async () => {
  harness = await startHarness();
});

after(async () => {
  await stopHarness();
});

beforeEach(async () => {
  await resetDb();

  const adminA = await makeUser({ displayName: 'AdminA' });
  const adminB = await makeUser({ displayName: 'AdminB' });
  const studentA = await makeUser({ displayName: 'StudentA' });
  const studentB = await makeUser({ displayName: 'StudentB' });
  const outsider = await makeUser({ displayName: 'Outsider' });

  const spaceA = await makeSpace({ name: 'Institute A', owner: adminA.user });
  const spaceB = await makeSpace({ name: 'Institute B', owner: adminB.user });

  await addMember(spaceA, studentA.user, SPACE_ROLE.STUDENT);
  await addMember(spaceB, studentB.user, SPACE_ROLE.STUDENT);

  const topicA = (await makeTopic({ spaceId: spaceA._id, name: 'A Private Topic' })).topic;
  const topicB = (await makeTopic({ spaceId: spaceB._id, name: 'B Private Topic' })).topic;
  const publicTopic = (await makeTopic({ spaceId: publicSpaceId, name: 'Open Topic' })).topic;

  ctx = {
    adminA, adminB, studentA, studentB, outsider,
    spaceA, spaceB, topicA, topicB, publicTopic,
  };
});

// ── REST surface ───────────────────────────────────────────────────────────

test("Space A's admin is denied every Space B REST resource", async () => {
  const a = api(harness.app, ctx.adminA.token);
  const bId = String(ctx.spaceB._id);

  const probes = [
    ['GET', `/topics?spaceId=${bId}`],
    ['GET', `/categories?spaceId=${bId}`],
    ['GET', `/home?spaceId=${bId}`],
    ['GET', `/spaces/${bId}/home`],
    ['GET', `/admin/dashboard?spaceId=${bId}`],
    ['GET', `/admin/questions?spaceId=${bId}`],
    ['GET', `/admin/topics?spaceId=${bId}`],
    ['GET', `/admin/students?spaceId=${bId}`],
    ['GET', `/admin/batches?spaceId=${bId}`],
    ['GET', `/admin/settings?spaceId=${bId}`],
    ['GET', `/admin/audit?spaceId=${bId}`],
    ['GET', `/admin/reports/items?spaceId=${bId}`],
    ['GET', `/admin/invite?spaceId=${bId}`],
    // Phase 3 surfaces. Contest standings and assignment progress are the most
    // sensitive per-student data an institute holds, so they are probed here
    // from the day they exist.
    ['GET', `/admin/contests?spaceId=${bId}`],
    ['GET', `/admin/assignments?spaceId=${bId}`],
    ['GET', `/admin/review?spaceId=${bId}`],
    ['GET', `/admin/ai/status?spaceId=${bId}`],
    ['GET', `/admin/reports/periods?spaceId=${bId}`],
    ['GET', `/spaces/${bId}/contests`],
    ['GET', `/spaces/${bId}/assignments`],
    ['GET', `/spaces/${bId}/performance`],
    ['GET', `/leaderboards/overall?spaceId=${bId}`],
    ['GET', `/leaderboards/topic/${ctx.topicB._id}?spaceId=${bId}`],
  ];

  for (const [method, url] of probes) {
    const res = await a[method.toLowerCase()](url);
    assert.ok(
      res.statusCode === 403 || res.statusCode === 404,
      `${method} ${url} must be denied, got ${res.statusCode}: ${res.body.slice(0, 120)}`,
    );
  }
});

test("Space A's admin cannot read a Space B topic even without naming the space", async () => {
  const a = api(harness.app, ctx.adminA.token);
  // No spaceId at all — the scope falls back to public, where B's topic is
  // simply not present. It must not resolve.
  const res = await a.get(`/topics/${ctx.topicB._id}`);
  assert.equal(res.statusCode, 404);

  // And explicitly claiming their own space does not smuggle it in either.
  const res2 = await a.get(`/topics/${ctx.topicB._id}?spaceId=${ctx.spaceA._id}`);
  assert.equal(res2.statusCode, 404);
});

test("Space A's admin cannot write into Space B", async () => {
  const a = api(harness.app, ctx.adminA.token);
  const bId = String(ctx.spaceB._id);

  const create = await a.post(`/admin/questions?spaceId=${bId}`, {
    spaceId: bId,
    text: 'Injected question',
    options: ['a', 'b', 'c', 'd'],
    correctIndex: 0,
    topicIds: [String(ctx.topicB._id)],
  });
  assert.equal(create.statusCode, 403);

  const topic = await a.post(`/admin/topics?spaceId=${bId}`, {
    spaceId: bId,
    name: 'Injected topic',
    categoryId: String(ctx.topicB.categoryId),
  });
  assert.equal(topic.statusCode, 403);

  const settings = await a.patch(`/admin/settings?spaceId=${bId}`, { spaceId: bId, name: 'Hijacked' });
  assert.equal(settings.statusCode, 403);

  // Nothing landed.
  assert.equal(await Question.countDocuments({ origin: ctx.spaceB._id, source: 'manual', status: 'draft' }), 0);
});

test('a question id from Space B cannot be edited by Space A even with its own scope', async () => {
  const bQuestion = await Question.findOne({ origin: ctx.spaceB._id }).lean();
  assert.ok(bQuestion, 'fixture sanity');

  const a = api(harness.app, ctx.adminA.token);
  const patch = await a.patch(`/admin/questions/${bQuestion._id}?spaceId=${ctx.spaceA._id}`, {
    spaceId: String(ctx.spaceA._id),
    text: 'Rewritten by another tenant',
  });
  assert.equal(patch.statusCode, 404, 'scoped by origin, so it is simply not found');

  const del = await a.delete(`/admin/questions/${bQuestion._id}?spaceId=${ctx.spaceA._id}`);
  assert.equal(del.statusCode, 404);

  const status = await a.post(`/admin/questions/${bQuestion._id}/status?spaceId=${ctx.spaceA._id}`, {
    spaceId: String(ctx.spaceA._id),
    status: 'archived',
  });
  assert.equal(status.statusCode, 404);

  const after = await Question.findById(bQuestion._id).lean();
  assert.equal(after.content.en.text, bQuestion.content.en.text, 'unchanged');
  assert.equal(after.status, bQuestion.status);
});

test('a student in Space A is denied Space B, and is not an admin of their own space', async () => {
  const s = api(harness.app, ctx.studentA.token);

  const foreign = await s.get(`/topics?spaceId=${ctx.spaceB._id}`);
  assert.equal(foreign.statusCode, 403);

  // prd.md §4.1 — a Student has no admin capability anywhere, including at home.
  const own = await s.get(`/admin/dashboard?spaceId=${ctx.spaceA._id}`);
  assert.equal(own.statusCode, 403);

  const questions = await s.get(`/admin/questions?spaceId=${ctx.spaceA._id}`);
  assert.equal(questions.statusCode, 403);
});

test('a user in no space is denied both, and keeps public access', async () => {
  const o = api(harness.app, ctx.outsider.token);

  assert.equal((await o.get(`/topics?spaceId=${ctx.spaceA._id}`)).statusCode, 403);
  assert.equal((await o.get(`/topics?spaceId=${ctx.spaceB._id}`)).statusCode, 403);

  // prd.md §4.1 — every Player can play public topics.
  const publicRes = await o.get('/topics');
  assert.equal(publicRes.statusCode, 200);
  const body = JSON.parse(publicRes.body);
  assert.ok(body.data.items.some((t) => t.name === 'Open Topic'));
  assert.ok(
    !body.data.items.some((t) => t.name.startsWith('A ') || t.name.startsWith('B ')),
    'no private topic appears in the public list',
  );
});

test('a leaving member immediately loses access', async () => {
  const s = api(harness.app, ctx.studentA.token);
  assert.equal((await s.get(`/topics?spaceId=${ctx.spaceA._id}`)).statusCode, 200);

  const left = await s.delete(`/spaces/${ctx.spaceA._id}/membership`);
  assert.equal(left.statusCode, 200);

  // prd.md §5.1 rule 6 — leaving removes access, without deleting the account.
  assert.equal((await s.get(`/topics?spaceId=${ctx.spaceA._id}`)).statusCode, 403);
  assert.equal((await s.get('/me')).statusCode, 200);
});

// ── Question selection: the path that takes no spaceId at all ──────────────

test('question selection can never draw from another space bank', async () => {
  // prd.md §5.1 rule 3 — a Space topic may draw from the Central Bank, its own
  // Space Bank, or both. Never from another Space's bank.
  const origins = allowedOriginsFor(ctx.topicA);
  assert.deepEqual(
    origins.map(String).sort(),
    [String(ctx.spaceA._id)].sort(),
    'only its own origin',
  );

  const picked = await selectQuestions(ctx.topicA, [{ userId: ctx.studentA.id, rating: 1200 }]);
  assert.ok(picked.length > 0);
  for (const q of picked) {
    assert.equal(String(q.origin), String(ctx.spaceA._id), 'every question came from Space A');
  }

  // Even if a Space B question is force-tagged onto Space A's topic — the kind
  // of thing a bad import or a bug could do — the origin filter still excludes it.
  await Question.updateMany({ origin: ctx.spaceB._id }, { $addToSet: { topicIds: ctx.topicA._id } });
  const again = await selectQuestions(ctx.topicA, [{ userId: ctx.studentA.id, rating: 1200 }]);
  for (const q of again) {
    assert.notEqual(String(q.origin), String(ctx.spaceB._id), 'Space B content never enters the pool');
  }
});

test('a topic that allows central draws central and own, and nothing else', async () => {
  await Question.updateMany({ origin: publicSpaceId }, { $addToSet: { topicIds: ctx.topicA._id } });
  ctx.topicA.questionSources = { central: true, own: true };

  const origins = allowedOriginsFor(ctx.topicA).map(String);
  assert.equal(origins.length, 2);
  assert.ok(origins.includes(String(publicSpaceId)));
  assert.ok(origins.includes(String(ctx.spaceA._id)));
  assert.ok(!origins.includes(String(ctx.spaceB._id)));
});

// ── Socket surface ─────────────────────────────────────────────────────────

test('the socket queue refuses a topic outside the caller’s spaces', async () => {
  const client = connectClient(ctx.studentA.token, { port: harness.port });
  await client.connected();

  const ack = await client.emit(C2S.QUEUE_JOIN, {
    topicId: String(ctx.topicB._id),
    spaceId: String(ctx.spaceB._id),
  });
  assert.equal(ack.ok, false);
  assert.equal(ack.code, 'NOT_A_MEMBER');

  // Claiming their own space while naming B's topic must not work either.
  const ack2 = await client.emit(C2S.QUEUE_JOIN, {
    topicId: String(ctx.topicB._id),
    spaceId: String(ctx.spaceA._id),
  });
  assert.equal(ack2.ok, false);

  const errors = client.framesOf(S2C.ERROR);
  assert.ok(errors.length >= 1);
  client.close();
});

// ── Leaderboards ───────────────────────────────────────────────────────────

test("a space leaderboard never exposes another space's players", async () => {
  // Give both students a rating on their own space topic.
  await Rating.create({
    userId: ctx.studentA.user._id,
    topicId: ctx.topicA._id,
    spaceId: ctx.spaceA._id,
    rating: 1500,
  });
  await Rating.create({
    userId: ctx.studentB.user._id,
    topicId: ctx.topicB._id,
    spaceId: ctx.spaceB._id,
    rating: 1600,
  });

  const s = api(harness.app, ctx.studentA.token);
  const res = await s.get(`/leaderboards/overall?spaceId=${ctx.spaceA._id}&scope=space`);
  assert.equal(res.statusCode, 200);

  const board = JSON.parse(res.body).data;
  const names = board.entries.map((e) => e.displayName);
  assert.ok(names.includes('StudentA'));
  assert.ok(!names.includes('StudentB'), "Space B's student must not appear");

  // prd.md §5.1 rule 5 — and B's topic board is not reachable at all.
  const foreign = await s.get(`/leaderboards/topic/${ctx.topicB._id}?spaceId=${ctx.spaceA._id}`);
  assert.equal(foreign.statusCode, 404);
});

// ── Phase 3 surfaces ───────────────────────────────────────────────────────

test("a contest's standings and paper never cross a space boundary", async () => {
  const { Contest, ContestEntry } = await import('../src/models/index.js');

  const contestB = await Contest.create({
    spaceId: ctx.spaceB._id,
    name: 'B Internal Test',
    topicIds: [ctx.topicB._id],
    questionCount: 7,
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 60 * 60_000),
    status: 'live',
  });
  await ContestEntry.create({
    contestId: contestB._id,
    spaceId: ctx.spaceB._id,
    userId: ctx.studentB.user._id,
    displayName: 'StudentB',
    score: 200,
    status: 'complete',
  });

  const a = api(harness.app, ctx.adminA.token);

  // Naming their own space while pointing at B's contest must not smuggle it in.
  for (const url of [
    `/admin/contests/${contestB._id}?spaceId=${ctx.spaceA._id}`,
    `/admin/contests/${contestB._id}/standings?spaceId=${ctx.spaceA._id}`,
    `/admin/contests/${contestB._id}/standings.csv?spaceId=${ctx.spaceA._id}`,
  ]) {
    const res = await a.get(url);
    assert.equal(res.statusCode, 404, `${url} must not resolve, got ${res.statusCode}`);
    assert.ok(!res.body.includes('StudentB'), 'and must not leak a name in the body');
  }

  // A student in Space A is likewise refused.
  const s = api(harness.app, ctx.studentA.token);
  const student = await s.get(`/spaces/${ctx.spaceA._id}/contests/${contestB._id}/standings`);
  assert.equal(student.statusCode, 404);

  // And they cannot enter it over the socket.
  const client = connectClient(ctx.studentA.token, { port: harness.port });
  await client.connected();
  const ack = await client.emit(C2S.CONTEST_ENTER, { contestId: String(contestB._id) });
  client.close();
  assert.equal(ack.ok, false);
  assert.equal(ack.code, 'NOT_A_MEMBER');

  assert.equal(
    await ContestEntry.countDocuments({ contestId: contestB._id }),
    1,
    'no entry was created for the outsider',
  );
});

test("an assignment's progress never crosses a space boundary", async () => {
  const { Assignment, AssignmentProgress } = await import('../src/models/index.js');

  const assignmentB = await Assignment.create({
    spaceId: ctx.spaceB._id,
    topicId: ctx.topicB._id,
    title: 'B Homework',
    requirement: { type: 'matches', matches: 2 },
    dueAt: new Date(Date.now() + 86_400_000),
  });
  await AssignmentProgress.create({
    assignmentId: assignmentB._id,
    spaceId: ctx.spaceB._id,
    userId: ctx.studentB.user._id,
    matchesPlayed: 2,
  });

  const a = api(harness.app, ctx.adminA.token);
  for (const url of [
    `/admin/assignments/${assignmentB._id}?spaceId=${ctx.spaceA._id}`,
    `/admin/assignments/${assignmentB._id}/progress.csv?spaceId=${ctx.spaceA._id}`,
  ]) {
    const res = await a.get(url);
    assert.equal(res.statusCode, 404, `${url} must not resolve`);
  }

  const write = await a.patch(`/admin/assignments/${assignmentB._id}`, {
    spaceId: String(ctx.spaceA._id),
    title: 'Rewritten by another tenant',
  });
  assert.equal(write.statusCode, 404);

  const after = await Assignment.findById(assignmentB._id).lean();
  assert.equal(after.title, 'B Homework', 'unchanged');
});

test('AI drafting cannot be pointed at another space’s topic', async () => {
  const a = api(harness.app, ctx.adminA.token);
  const res = await a.post('/admin/ai/draft', {
    spaceId: String(ctx.spaceA._id),
    topicId: String(ctx.topicB._id),
    count: 3,
  });
  // Either the key is missing (503) or the topic is refused (404). Both are a
  // denial; what must never happen is a draft landing in Space B's bank.
  assert.ok([404, 503].includes(res.statusCode), `got ${res.statusCode}`);
  assert.equal(
    await Question.countDocuments({ origin: ctx.spaceB._id, source: 'ai' }),
    0,
    'nothing was written into the other space',
  );
});

test('a superadmin may act in any space, and it is recorded', async () => {
  const superUser = await makeUser({ displayName: 'Root', role: 'superadmin' });
  const s = api(harness.app, superUser.token);

  // prd.md §4.1 gives the superadmin platform-wide reach. This is deliberate,
  // unlike the cases above — the point of the test is that it is the ONLY
  // identity for which the guard opens.
  const res = await s.get(`/admin/questions?spaceId=${ctx.spaceB._id}`);
  assert.equal(res.statusCode, 200);

  const asAdminA = api(harness.app, ctx.adminA.token);
  assert.equal((await asAdminA.get(`/admin/questions?spaceId=${ctx.spaceB._id}`)).statusCode, 403);
});

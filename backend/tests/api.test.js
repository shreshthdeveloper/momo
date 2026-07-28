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
  api,
} from './helpers.js';
import { User, Question, Topic, SpaceMember, Report, Space } from '../src/models/index.js';
import { OtpRequest, RefreshToken } from '../src/models/ops.js';
import { SPACE_ROLE, MIN_PUBLISHED_QUESTIONS_TO_LIVE } from '../src/shared/constants.js';

/** tech.md §13 — the integration row: auth flows, admin CRUD, CSV validation. */

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

const json = (res) => JSON.parse(res.body);

// ── Auth (tech.md §5) ──────────────────────────────────────────────────────

test('the OTP flow issues tokens and creates an account', async () => {
  const a = api(harness.app);

  const send = await a.post('/auth/otp/send', { phone: '9876500001' });
  assert.equal(send.statusCode, 200);
  const { devCode, phone } = json(send).data;
  assert.equal(phone, '+919876500001');
  assert.match(devCode, /^\d{6}$/);

  // The code is stored hashed, never in plaintext.
  const stored = await OtpRequest.findOne({ phone }).lean();
  assert.ok(stored.codeHash.startsWith('scrypt$'));
  assert.ok(!stored.codeHash.includes(devCode));

  const verify = await a.post('/auth/otp/verify', { phone: '9876500001', code: devCode });
  assert.equal(verify.statusCode, 200);
  const body = json(verify).data;
  assert.equal(body.isNew, true);
  assert.equal(body.needsProfile, true, 'a new account has no display name yet');
  assert.ok(body.tokens.accessToken);
  assert.ok(body.tokens.refreshToken);

  // Single use.
  const replay = await a.post('/auth/otp/verify', { phone: '9876500001', code: devCode });
  assert.equal(replay.statusCode, 400);
});

test('a wrong OTP is rejected and locks out after five attempts', async () => {
  const a = api(harness.app);
  await a.post('/auth/otp/send', { phone: '9876500002' });

  for (let i = 0; i < 5; i += 1) {
    const res = await a.post('/auth/otp/verify', { phone: '9876500002', code: '111111' });
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).error.code, 'OTP_INVALID');
  }

  const locked = await a.post('/auth/otp/verify', { phone: '9876500002', code: '111111' });
  assert.equal(locked.statusCode, 429);
  assert.equal(json(locked).error.code, 'OTP_LOCKED');
});

test('OTP sends are throttled per number', async () => {
  const a = api(harness.app);
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await a.post('/auth/otp/send', { phone: '9876500003' })).statusCode, 200);
  }
  const fourth = await a.post('/auth/otp/send', { phone: '9876500003' });
  assert.equal(fourth.statusCode, 429);
  assert.equal(json(fourth).error.code, 'OTP_THROTTLED');
});

test('refresh rotates, and reusing a rotated token revokes the whole family', async () => {
  const a = api(harness.app);
  const send = await a.post('/auth/otp/send', { phone: '9876500004' });
  const verify = await a.post('/auth/otp/verify', {
    phone: '9876500004',
    code: json(send).data.devCode,
  });
  const first = json(verify).data.tokens.refreshToken;

  const rotated = await a.post('/auth/refresh', { refreshToken: first });
  assert.equal(rotated.statusCode, 200);
  const second = json(rotated).data.tokens.refreshToken;
  assert.notEqual(second, first);

  // tech.md §5 — presenting an already-rotated token means replay or theft.
  const reuse = await a.post('/auth/refresh', { refreshToken: first });
  assert.equal(reuse.statusCode, 401);
  assert.equal(json(reuse).error.code, 'REFRESH_REUSED');

  // …and the whole family goes, including the token that was legitimately issued.
  const afterRevocation = await a.post('/auth/refresh', { refreshToken: second });
  assert.equal(afterRevocation.statusCode, 401);

  const live = await RefreshToken.countDocuments({ revokedAt: null });
  assert.equal(live, 0, 'no token in the family survives');
});

test('the guest door is gone, not merely hidden', async () => {
  // coins-and-cosmetics.md §8 — the entry point went first and the machinery
  // followed. A route that still answered would be a way to create an account
  // type nothing else in the system understands any more.
  const res = await api(harness.app).post('/auth/guest', { deviceId: 'device-abcdef123456' });
  assert.equal(res.statusCode, 404);
});

test('the achievements screen is told about the ones you have not earned', async () => {
  // The old payload sent earned keys only, so a screen could list what you had
  // and had no way to say there were more or what they were for.
  const { token } = await makeUser();
  const client = api(harness.app, token);
  const { data } = await client.json(await client.get('/me/stats'));

  assert.ok(data.achievements.length >= 7, 'the whole catalogue, not the earned slice');
  assert.ok(
    data.achievements.every((a) => a.earned === false),
    'a fresh account has earned none of them',
  );
  const first = data.achievements[0];
  assert.ok(first.title && first.how, 'each one says what it is and how to get it');
});

test('a suspended account cannot sign in', async () => {
  const { user } = await makeUser({ displayName: 'Banned' });
  await User.updateOne({ _id: user._id }, { $set: { status: 'suspended' } });

  const a = api(harness.app);
  const send = await a.post('/auth/otp/send', { phone: user.phone });
  assert.equal(send.statusCode, 403);
  assert.equal(json(send).error.code, 'ACCOUNT_SUSPENDED');
});

// ── Profile ────────────────────────────────────────────────────────────────

test('display names are unique, validated, and reserved words are refused', async () => {
  const first = await makeUser({ displayName: 'Taken' });
  const second = await makeUser({ displayName: 'Other' });
  const a = api(harness.app, second.token);

  assert.equal((await a.patch('/me', { displayName: 'Taken' })).statusCode, 409);
  assert.equal((await a.patch('/me', { displayName: 'admin' })).statusCode, 409);
  assert.equal((await a.patch('/me', { displayName: 'a' })).statusCode, 400);
  assert.equal((await a.patch('/me', { displayName: 'no<script>' })).statusCode, 400);

  const good = await a.patch('/me', { displayName: 'Perfectly Fine' });
  assert.equal(good.statusCode, 200);
  assert.equal(json(good).data.displayName, 'Perfectly Fine');
  assert.ok(first.id);
});

test('a minor is excluded from contact discovery whatever the client asks for', async () => {
  const { token, user } = await makeUser({ displayName: 'Young' });
  const a = api(harness.app, token);

  const dob = new Date();
  dob.setFullYear(dob.getFullYear() - 14);
  await a.patch('/me', { dateOfBirth: dob.toISOString() });

  // prd.md §13 — a minor account cannot re-enable discovery.
  const res = await a.patch('/me', { privacy: { contactDiscovery: true } });
  assert.equal(res.statusCode, 200);
  assert.equal(json(res).data.privacy.contactDiscovery, false);

  const stored = await User.findById(user._id).lean();
  assert.equal(stored.isMinor, true);

  // And they do not appear in search.
  const other = await makeUser({ displayName: 'Searcher' });
  const search = await api(harness.app, other.token).get('/users/search?q=Young');
  assert.equal(json(search).data.items.length, 0);
});

test('deletion is a 30-day grace period, and signing in cancels it', async () => {
  const { token, user } = await makeUser();
  const a = api(harness.app, token);

  const res = await a.delete('/me');
  assert.equal(res.statusCode, 200);
  assert.ok(json(res).data.deletesAt);

  const marked = await User.findById(user._id).lean();
  assert.ok(marked.deletionRequestedAt);
  assert.equal(marked.status, 'active', 'the account still works during the grace period');

  const anon = api(harness.app);
  const send = await anon.post('/auth/otp/send', { phone: user.phone });
  await anon.post('/auth/otp/verify', { phone: user.phone, code: json(send).data.devCode });

  const restored = await User.findById(user._id).lean();
  assert.equal(restored.deletionRequestedAt, null, 'a returning user did not mean it');
});

test('data export returns the account holder’s own data', async () => {
  const { token } = await makeUser({ displayName: 'Exporter', city: 'Pune' });
  const res = await api(harness.app, token).get('/me/export');
  assert.equal(res.statusCode, 200);
  const data = json(res).data;
  assert.equal(data.profile.displayName, 'Exporter');
  assert.equal(data.profile.city, 'Pune');
  assert.ok(Array.isArray(data.matches));
  assert.ok(Array.isArray(data.topicRatings));
});

// ── Admin CRUD ─────────────────────────────────────────────────────────────

test('the 21-question gate blocks publishing a thin topic', async () => {
  const admin = await makeUser({ displayName: 'Admin' });
  const space = await makeSpace({ owner: admin.user });
  const { topic } = await makeTopic({ spaceId: space._id, questionCount: 5 });
  await Topic.updateOne({ _id: topic._id }, { $set: { status: 'draft' } });

  const a = api(harness.app, admin.token);
  const spaceId = String(space._id);

  const tooThin = await a.patch(`/admin/topics/${topic._id}?spaceId=${spaceId}`, {
    spaceId,
    status: 'published',
  });
  assert.equal(tooThin.statusCode, 400);
  const err = json(tooThin).error;
  assert.equal(err.code, 'TOPIC_NOT_READY');
  // design.md §10 — the error says what happened and what to do.
  assert.ok(err.message.includes('21'));
  assert.equal(err.details.required, MIN_PUBLISHED_QUESTIONS_TO_LIVE);

  await Topic.updateOne({ _id: topic._id }, { $set: { publishedQuestionCount: 21 } });
  const ok = await a.patch(`/admin/topics/${topic._id}?spaceId=${spaceId}`, {
    spaceId,
    status: 'published',
  });
  assert.equal(ok.statusCode, 200);
});

test('publishedQuestionCount is maintained as questions change status', async () => {
  const admin = await makeUser();
  const space = await makeSpace({ owner: admin.user });
  const { topic } = await makeTopic({ spaceId: space._id, questionCount: 22 });
  const a = api(harness.app, admin.token);
  const spaceId = String(space._id);

  const before = await Topic.findById(topic._id).lean();
  assert.equal(before.publishedQuestionCount, 22);

  const question = await Question.findOne({ origin: space._id }).lean();
  const archived = await a.post(`/admin/questions/${question._id}/status?spaceId=${spaceId}`, {
    spaceId,
    status: 'archived',
  });
  assert.equal(archived.statusCode, 200);

  const after = await Topic.findById(topic._id).lean();
  assert.equal(after.publishedQuestionCount, 21, 'the count followed the archive');
});

test('a served question archives instead of hard deleting', async () => {
  const admin = await makeUser();
  const space = await makeSpace({ owner: admin.user });
  const { topic } = await makeTopic({ spaceId: space._id, questionCount: 22 });
  const a = api(harness.app, admin.token);
  const spaceId = String(space._id);

  const fresh = await Question.findOne({ origin: space._id }).lean();
  const gone = await a.delete(`/admin/questions/${fresh._id}?spaceId=${spaceId}`);
  assert.equal(json(gone).data.deleted, true, 'never served, so it really deletes');
  assert.equal(await Question.countDocuments({ _id: fresh._id }), 0);

  // prd.md F8.2.4 — once served, it can only be archived, because match
  // records reference it.
  const served = await Question.findOne({ origin: space._id, _id: { $ne: fresh._id } });
  await Question.updateOne({ _id: served._id }, { $set: { servedEver: true, 'stats.served': 12 } });

  const archived = await a.delete(`/admin/questions/${served._id}?spaceId=${spaceId}`);
  assert.equal(json(archived).data.archived, true);
  assert.equal(json(archived).data.deleted, false);
  assert.equal((await Question.findById(served._id).lean()).status, 'archived');
  assert.ok(topic._id);
});

test('duplicate detection blocks a near-identical question, and can be overridden', async () => {
  const admin = await makeUser();
  const space = await makeSpace({ owner: admin.user });
  const { topic } = await makeTopic({ spaceId: space._id, questionCount: 21 });
  const a = api(harness.app, admin.token);
  const spaceId = String(space._id);

  const payload = {
    spaceId,
    text: 'Which planet is closest to the sun?',
    options: ['Mercury', 'Venus', 'Earth', 'Mars'],
    correctIndex: 0,
    topicIds: [String(topic._id)],
  };

  assert.equal((await a.post(`/admin/questions?spaceId=${spaceId}`, payload)).statusCode, 201);

  // prd.md F8.2.7 — case and punctuation differences still collide.
  const dupe = await a.post(`/admin/questions?spaceId=${spaceId}`, {
    ...payload,
    text: '  which planet is CLOSEST to the sun  ',
  });
  assert.equal(dupe.statusCode, 409);
  assert.equal(json(dupe).error.code, 'DUPLICATE_QUESTION');
  assert.ok(json(dupe).error.details.duplicates.length >= 1);

  const forced = await a.post(`/admin/questions?spaceId=${spaceId}`, {
    ...payload,
    text: '  which planet is CLOSEST to the sun  ',
    allowDuplicate: true,
  });
  assert.equal(forced.statusCode, 201);
});

test('a sub-admin without publish permission can draft but not publish', async () => {
  const admin = await makeUser({ displayName: 'Owner' });
  const sub = await makeUser({ displayName: 'Sub' });
  const space = await makeSpace({ owner: admin.user });
  const { topic } = await makeTopic({ spaceId: space._id, questionCount: 21 });

  await addMember(space, sub.user, SPACE_ROLE.SUB_ADMIN);
  await SpaceMember.updateOne(
    { spaceId: space._id, userId: sub.user._id },
    { $set: { 'permissions.createQuestions': true, 'permissions.publishQuestions': false } },
  );

  const s = api(harness.app, sub.token);
  const spaceId = String(space._id);
  const payload = {
    spaceId,
    text: 'A question a sub-admin wrote?',
    options: ['a', 'b', 'c', 'd'],
    correctIndex: 0,
    topicIds: [String(topic._id)],
  };

  const draft = await s.post(`/admin/questions?spaceId=${spaceId}`, payload);
  assert.equal(draft.statusCode, 201);
  assert.equal(json(draft).data.status, 'draft');

  // prd.md F8.2.8 — publishing may be restricted to the Admin.
  const publish = await s.post(`/admin/questions?spaceId=${spaceId}`, {
    ...payload,
    text: 'Another one?',
    status: 'published',
  });
  assert.equal(publish.statusCode, 403);
  assert.equal(json(publish).error.code, 'CANNOT_PUBLISH');

  // The admin can.
  const byAdmin = await api(harness.app, admin.token).post(`/admin/questions?spaceId=${spaceId}`, {
    ...payload,
    text: 'Another one?',
    status: 'published',
  });
  assert.equal(byAdmin.statusCode, 201);
});

test('CSV import validates every row before anything is written', async () => {
  const admin = await makeUser();
  const space = await makeSpace({ owner: admin.user });
  const { topic } = await makeTopic({ spaceId: space._id, questionCount: 21 });

  const { validateImport, commitImport } = await import('../src/services/csvService.js');
  const scope = { spaceId: space._id, isPublic: false, role: SPACE_ROLE.ADMIN };

  const csv = [
    'question,option_a,option_b,option_c,option_d,correct,difficulty,topic,tags,explanation',
    `What is 2 + 2?,4,3,5,6,A,easy,${topic.name},maths,Because it is.`,
    `Which is a prime?,7,8,9,10,a,medium,${topic.name},,`,
    `Missing options?,only-one,,,,A,easy,${topic.name},,`,
    `Bad topic?,a,b,c,d,A,easy,No Such Topic,,`,
    `What is 2 + 2?,4,3,5,6,A,easy,${topic.name},,`,
  ].join('\n');

  const result = await validateImport(scope, csv);
  assert.equal(result.totalRows, 5);
  assert.equal(result.validRows, 2);
  assert.equal(result.invalidRows, 3);

  // Each failure names the row and the reason (design.md §9.4).
  const missingOptions = result.rows.find((r) => r.row === 4);
  assert.equal(missingOptions.valid, false);
  assert.ok(missingOptions.errors.some((e) => e.field.startsWith('options')));

  const badTopic = result.rows.find((r) => r.row === 5);
  assert.ok(badTopic.errors.some((e) => e.field === 'topic' && e.problem.includes('No Such Topic')));

  const inFileDupe = result.rows.find((r) => r.row === 6);
  assert.ok(inFileDupe.errors.some((e) => e.problem.includes('Duplicate of row 2')));

  // Nothing is written by validation.
  assert.equal(await Question.countDocuments({ origin: space._id, source: 'import' }), 0);

  const committed = await commitImport(scope, admin.user, result.rows.filter((r) => r.valid));
  assert.equal(committed.imported, 2);
  assert.equal(await Question.countDocuments({ origin: space._id, source: 'import' }), 2);
});

test('a bad CSV header is refused with the missing columns named', async () => {
  const admin = await makeUser();
  const space = await makeSpace({ owner: admin.user });
  const { validateImport } = await import('../src/services/csvService.js');

  await assert.rejects(
    () => validateImport({ spaceId: space._id }, 'q,a,b\n1,2,3\n'),
    (err) => {
      assert.equal(err.code, 'BAD_CSV_HEADER');
      assert.ok(err.message.includes('option_a'));
      assert.ok(err.details.missing.includes('correct'));
      return true;
    },
  );
});

// ── Reports ────────────────────────────────────────────────────────────────

test('a question report is recorded once per reporter', async () => {
  const { topic } = await makeTopic();
  const reporter = await makeUser();
  const question = await Question.findOne({ topicIds: topic._id }).lean();
  const a = api(harness.app, reporter.token);

  const first = await a.post('/reports', {
    targetType: 'question',
    targetId: String(question._id),
    reason: 'wrong_answer',
    note: 'The key looks wrong.',
  });
  assert.equal(first.statusCode, 200);
  // design.md §10 — "Reported. We'll review it." Nothing more.
  assert.equal(json(first).data.message, "Reported. We'll review it.");

  const second = await a.post('/reports', {
    targetType: 'question',
    targetId: String(question._id),
    reason: 'typo',
  });
  assert.equal(second.statusCode, 200, 'a repeat is a no-op, not an error');

  assert.equal(await Report.countDocuments({ targetId: question._id }), 1);
  assert.equal((await Question.findById(question._id).lean()).reportCount, 1);
});

// ── Spaces ─────────────────────────────────────────────────────────────────

test('joining by code respects the space join mode', async () => {
  const admin = await makeUser();
  const openSpace = await makeSpace({ owner: admin.user, joinMode: 'open' });
  const approvalSpace = await makeSpace({ owner: admin.user, joinMode: 'approval' });

  const student = await makeUser({ displayName: 'Joiner' });
  const a = api(harness.app, student.token);

  const open = await a.post('/spaces/join', { code: openSpace.joinCode });
  assert.equal(open.statusCode, 200);
  assert.equal(json(open).data.status, 'active');

  const pending = await a.post('/spaces/join', { code: approvalSpace.joinCode });
  assert.equal(pending.statusCode, 200);
  assert.equal(json(pending).data.status, 'pending');
  assert.ok(json(pending).data.message.includes('approve'));

  // A pending member has no access yet.
  const topics = await a.get(`/topics?spaceId=${approvalSpace._id}`);
  assert.equal(topics.statusCode, 403);

  const bad = await a.post('/spaces/join', { code: 'ZZZZZZ' });
  assert.equal(bad.statusCode, 404);
  assert.equal(json(bad).error.code, 'BAD_JOIN_CODE');
});

test('the seat limit is enforced', async () => {
  const admin = await makeUser();
  const space = await makeSpace({ owner: admin.user, joinMode: 'open' });
  // The owner already occupies one seat.
  await Space.updateOne({ _id: space._id }, { $set: { 'plan.seatLimit': 2 } });

  const first = await makeUser();
  const second = await makeUser();

  const okRes = await api(harness.app, first.token).post('/spaces/join', { code: space.joinCode });
  assert.equal(okRes.statusCode, 200);

  const full = await api(harness.app, second.token).post('/spaces/join', { code: space.joinCode });
  assert.equal(full.statusCode, 403);
  assert.ok(full.body.includes('seats'));
});

test('the last admin cannot leave a space', async () => {
  const admin = await makeUser();
  const space = await makeSpace({ owner: admin.user });
  const a = api(harness.app, admin.token);

  const res = await a.delete(`/spaces/${space._id}/membership`);
  assert.equal(res.statusCode, 400);
  assert.equal(json(res).error.code, 'LAST_ADMIN');
});

test('health reports the protocol version the client must match', async () => {
  // Health sits at the root, outside the /api/v1 prefix, so load balancers and
  // uptime checks do not have to know the API version.
  const res = await harness.app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  const body = json(res);
  assert.equal(body.status, 'ok');
  assert.ok(body.protocol.current >= 1);
  assert.ok(body.protocol.minSupported <= body.protocol.current);
});

test('an unauthenticated request to a protected route is refused', async () => {
  const a = api(harness.app);
  for (const url of ['/me', '/home', '/topics', '/matches', '/admin/dashboard', '/super/spaces']) {
    const res = await a.get(url);
    assert.equal(res.statusCode, 401, `${url} must require auth`);
  }
});

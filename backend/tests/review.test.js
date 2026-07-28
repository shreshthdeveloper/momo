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
import { Question, Topic, SpaceMember } from '../src/models/index.js';
import { aiDraftingStatus } from '../src/services/aiDraftService.js';
import { contentHashOf } from '../src/lib/crypto.js';
import { SPACE_ROLE, QUESTION_STATUS } from '../src/shared/constants.js';

/**
 * The review workflow (prd.md F8.2.8) and AI-assisted drafting (F8.2.6).
 *
 * The requirement with a hard edge is F8.2.6's last sentence: "Nothing goes
 * live without explicit human approval." So the tests that matter here are
 * about what CANNOT happen — an AI draft reaching `published` on its own, and a
 * sub-admin who may draft being able to publish.
 */

let harness;
let admin;
let subAdmin;
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
  admin = await makeUser({ displayName: 'Review Admin' });
  subAdmin = await makeUser({ displayName: 'Sub Admin' });
  space = await makeSpace({ name: 'Review Institute', owner: admin.user });
  await addMember(space, subAdmin.user, SPACE_ROLE.SUB_ADMIN);
  await SpaceMember.updateOne(
    { spaceId: space._id, userId: subAdmin.user._id },
    { $set: { permissions: { createQuestions: true, publishQuestions: false } } },
  );
  ({ topic } = await makeTopic({ spaceId: space._id, name: 'Review Topic', questionCount: 0 }));
});

async function makeDrafts(count, source = 'ai') {
  const docs = [];
  for (let i = 0; i < count; i += 1) {
    const text = `Draft ${source} ${i}: which option is correct?`;
    const options = [`Right ${i}`, `Wrong A ${i}`, `Wrong B ${i}`, `Wrong C ${i}`];
    docs.push({
      origin: space._id,
      topicIds: [topic._id],
      content: { en: { text, options, explanation: 'Because.' } },
      defaultLanguage: 'en',
      correctIndex: 0,
      difficulty: 'medium',
      status: QUESTION_STATUS.IN_REVIEW,
      source,
      contentHash: contentHashOf(text, options),
      searchText: [text, ...options].join(' • '),
      createdAt: new Date(Date.now() - (count - i) * 60_000),
    });
  }
  return Question.insertMany(docs);
}

test('review workflow and AI drafting', async (t) => {
  await t.test('drafting is refused with an actionable message when no key is set', async () => {
    const status = aiDraftingStatus();
    if (status.available) {
      // A machine with a real key configured: the refusal path cannot be
      // exercised, and saying so is better than a silently skipped assertion.
      assert.match(status.model, /claude/);
      return;
    }

    assert.equal(status.available, false);
    assert.match(status.reason, /ANTHROPIC_API_KEY/);

    const request = api(harness.app, admin.token);
    const res = await request.post('/admin/ai/draft', {
      spaceId: String(space._id),
      topicId: String(topic._id),
      count: 5,
    });

    assert.equal(res.statusCode, 503);
    const { error } = await request.json(res);
    assert.equal(error.code, 'AI_NOT_CONFIGURED');
    // design.md §10 — say what happened and what to do about it.
    assert.match(error.message, /ANTHROPIC_API_KEY/);
    assert.equal(
      await Question.countDocuments({ origin: space._id }),
      0,
      'and nothing invented in the meantime',
    );
  });

  await t.test('the queue is oldest first, so its bottom gets read', async () => {
    await makeDrafts(4);

    const request = api(harness.app, admin.token);
    const res = await request.get(`/admin/review?spaceId=${space._id}`);
    const { data } = await request.json(res);

    assert.equal(data.total, 4);
    assert.equal(data.aiPending, 4);
    assert.equal(data.items.length, 4);
    assert.match(data.items[0].text, /Draft ai 0/, 'the oldest draft is first');
    assert.match(data.items[3].text, /Draft ai 3/);
    // The reviewer needs the answer key to review — this is an admin surface.
    assert.equal(data.items[0].correctIndex, 0);
    assert.equal(data.items[0].options.length, 4);
  });

  await t.test('a sub-admin who may draft may not publish', async () => {
    const drafts = await makeDrafts(2);
    const ids = drafts.map((d) => String(d._id));

    const asSub = api(harness.app, subAdmin.token);
    const denied = await asSub.post('/admin/review/batch', {
      spaceId: String(space._id),
      ids,
      action: 'publish',
    });
    assert.equal(denied.statusCode, 403);
    const { error } = await asSub.json(denied);
    assert.equal(error.code, 'MISSING_PERMISSION');

    // Everything is still in review — nothing went live.
    assert.equal(
      await Question.countDocuments({ origin: space._id, status: QUESTION_STATUS.PUBLISHED }),
      0,
    );

    // But they may send one back to draft, which is within createQuestions.
    const allowed = await asSub.post('/admin/review/batch', {
      spaceId: String(space._id),
      ids: [ids[0]],
      action: 'draft',
    });
    assert.equal(allowed.statusCode, 200);
  });

  await t.test('approving a batch publishes it and moves the topic toward live', async () => {
    const drafts = await makeDrafts(3);

    const before = await Topic.findById(topic._id).lean();
    assert.equal(before.publishedQuestionCount, 0);

    const request = api(harness.app, admin.token);
    const res = await request.post('/admin/review/batch', {
      spaceId: String(space._id),
      ids: drafts.map((d) => String(d._id)),
      action: 'publish',
      note: 'Checked the answer keys.',
    });

    assert.equal(res.statusCode, 200);
    const { data } = await request.json(res);
    assert.equal(data.updated, 3);
    assert.equal(data.status, QUESTION_STATUS.PUBLISHED);

    const after = await Topic.findById(topic._id).lean();
    assert.equal(after.publishedQuestionCount, 3, 'the readiness gate counter follows');

    const one = await Question.findById(drafts[0]._id).lean();
    assert.equal(String(one.reviewedBy), String(admin.user._id));
    assert.ok(one.reviewedAt);
    assert.equal(one.reviewNote, 'Checked the answer keys.');
  });

  await t.test('archiving a batch takes it out of play without deleting it', async () => {
    const drafts = await makeDrafts(2);

    const request = api(harness.app, admin.token);
    await request.post('/admin/review/batch', {
      spaceId: String(space._id),
      ids: drafts.map((d) => String(d._id)),
      action: 'archive',
    });

    assert.equal(await Question.countDocuments({ origin: space._id }), 2, 'still there');
    assert.equal(
      await Question.countDocuments({ origin: space._id, status: QUESTION_STATUS.ARCHIVED }),
      2,
    );
  });

  await t.test('period comparison reports a direction, not just a number', async () => {
    const request = api(harness.app, admin.token);
    const res = await request.get(`/admin/reports/periods?spaceId=${space._id}&days=30`);
    assert.equal(res.statusCode, 200);

    const { data } = await request.json(res);
    assert.equal(data.days, 30);
    assert.deepEqual(Object.keys(data.current).sort(), [
      'accuracy',
      'avgScore',
      'matches',
      'players',
    ]);
    assert.ok(data.change);
    assert.equal(data.labels.current, 'Last 30 days');
    assert.equal(data.labels.previous, 'The 30 days before');
  });
});

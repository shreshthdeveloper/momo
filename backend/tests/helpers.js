// MUST be first — see the comment in setup-env.js. ESM evaluates imports in
// order, so this is the only way to set NODE_ENV before src/config/env.js
// captures it.
import './setup-env.js';

import mongoose from 'mongoose';
import { io as ioClient } from 'socket.io-client';
import { connectDb, disconnectDb, ensureIndexes } from '../src/config/db.js';
import { buildApp } from '../src/app.js';
import { createSocketGateway } from '../src/game/socketGateway.js';
import { registry } from '../src/game/registry.js';
import {
  User,
  Space,
  SpaceMember,
  Category,
  Topic,
  Question,
  ensurePublicSpace,
  publicSpaceId,
} from '../src/models/index.js';
import { signAccessToken } from '../src/services/authService.js';
import { loadProgression, resetProgressionCache } from '../src/services/progressionService.js';
import { ensureMonthlyChests } from '../src/services/chestService.js';
import { sessions } from '../src/game/classSession.js';
import { contentHashOf, randomJoinCode } from '../src/lib/crypto.js';
import { PROTOCOL_VERSION, GAME_NAMESPACE } from '../src/shared/protocol.js';
import { QUESTION_STATUS, TOPIC_STATUS, SPACE_ROLE } from '../src/shared/constants.js';

/**
 * Test harness.
 *
 * Rounds run at 400ms rather than 10s so a full seven-round match takes about
 * three seconds instead of ninety. Everything else — the timers, the state
 * machine, the network — is real. tech.md §13 calls the end-to-end socket
 * match the highest-value test in the suite; it is only worth having if it
 * exercises the actual engine.
 */
export const TEST_TIMING = {
  roundDurationMs: 400,
  roundResultMs: 120,
  countdownMs: 100,
  ghostAfterMs: 600,
  matchmakerTickMs: 100,
  disconnectGraceMs: 700,
};

let harness = null;

export async function startHarness(timing = TEST_TIMING) {
  if (harness) return harness;

  await connectDb();
  // Reconcile indexes before anything runs — a test database carrying an
  // index from an older schema produces failures that look like logic bugs.
  await ensureIndexes();
  await ensurePublicSpace();
  await loadProgression();
  await ensureMonthlyChests();

  const app = await buildApp();
  await app.ready();
  const { orchestrator, io } = createSocketGateway(app.server, { timing });
  app.orchestrator = orchestrator;

  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address();

  harness = {
    app,
    io,
    orchestrator,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    timing,
  };
  return harness;
}

export async function stopHarness() {
  if (!harness) return;
  harness.orchestrator.dispose();
  registry.clear();
  await new Promise((resolve) => harness.io.close(resolve));
  await harness.app.close();
  await disconnectDb();
  harness = null;
}

/** Wipes every collection between suites so ordering never matters. */
export async function resetDb() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
  await ensurePublicSpace();
  /**
   * The progression config is a cached singleton, and truncating the database
   * just deleted the document behind it. Dropping the cache and reseeding puts
   * every test back on the shipped ladder rather than on whatever the previous
   * test's superadmin edits left in memory.
   */
  resetProgressionCache();
  await loadProgression();
  // Chests live in the database too, so truncating took them with the config.
  // Every test that touches a chest expects this month's pair to exist.
  await ensureMonthlyChests();
  /**
   * Live class sessions are held in memory, so truncating the database left
   * runners pointing at documents that no longer exist — each with a round timer
   * still ticking into the next test. `clear()` disposes them.
   */
  sessions.clear();
}

// ── Fixtures ───────────────────────────────────────────────────────────────

let counter = 0;
const uniq = () => {
  counter += 1;
  return counter;
};

export async function makeUser(overrides = {}) {
  const n = uniq();
  const user = await User.create({
    phone: `+9198765${String(40000 + n).slice(-5)}`,
    displayName: overrides.displayName ?? `Tester${n}`,
    displayNameLower: (overrides.displayName ?? `Tester${n}`).toLowerCase(),
    role: 'player',
    status: 'active',
    ...overrides,
  });
  return { user, token: signAccessToken(user), id: String(user._id) };
}

export async function makeSpace({ name, owner, joinMode = 'open' } = {}) {
  const n = uniq();
  const space = await Space.create({
    name: name ?? `Institute ${n}`,
    slug: `institute-${n}`,
    ownerId: owner?._id,
    joinCode: randomJoinCode(6),
    joinMode,
    status: 'active',
    plan: { tier: 'growth', seatLimit: 100, status: 'active' },
  });
  if (owner) {
    await SpaceMember.create({
      spaceId: space._id,
      userId: owner._id,
      role: SPACE_ROLE.ADMIN,
      status: 'active',
    });
    await User.updateOne({ _id: owner._id }, { $addToSet: { spaceMemberships: space._id } });
  }
  return space;
}

export async function addMember(space, user, role = SPACE_ROLE.STUDENT) {
  const member = await SpaceMember.create({
    spaceId: space._id,
    userId: user._id,
    role,
    status: 'active',
  });
  await User.updateOne({ _id: user._id }, { $addToSet: { spaceMemberships: space._id } });
  return member;
}

/**
 * A playable topic with enough published questions to clear the 21-question
 * gate. Answers are deterministic — option 0 is always correct before the
 * per-match shuffle — so a test can drive a known score.
 */
export async function makeTopic({ spaceId = publicSpaceId, name, questionCount = 25 } = {}) {
  const n = uniq();
  const category = await Category.create({
    spaceId,
    name: `Category ${n}`,
    slug: `category-${n}`,
    color: '#4FA8E8',
  });

  const topic = await Topic.create({
    spaceId,
    categoryId: category._id,
    name: name ?? `Topic ${n}`,
    slug: `topic-${n}`,
    questionSources: { central: String(spaceId) === String(publicSpaceId), own: true },
    status: TOPIC_STATUS.PUBLISHED,
  });

  const difficulties = ['easy', 'easy', 'medium', 'medium', 'hard'];
  const docs = [];
  for (let i = 0; i < questionCount; i += 1) {
    const text = `Q${n}-${i}: which option is correct?`;
    const options = [`Right ${n}-${i}`, `Wrong A ${i}`, `Wrong B ${i}`, `Wrong C ${i}`];
    docs.push({
      origin: spaceId,
      topicIds: [topic._id],
      content: { en: { text, options, explanation: `Because option one is the right one.` } },
      defaultLanguage: 'en',
      correctIndex: 0,
      difficulty: difficulties[i % difficulties.length],
      status: QUESTION_STATUS.PUBLISHED,
      contentHash: contentHashOf(text, options),
      searchText: [text, ...options].join(' • '),
    });
  }
  await Question.insertMany(docs);

  topic.publishedQuestionCount = questionCount;
  await topic.save();

  return { topic, category };
}

// ── Socket client ──────────────────────────────────────────────────────────

/**
 * A socket client that records every frame it receives, so a test can assert
 * on order and payload after the fact rather than racing handlers.
 */
export function connectClient(token, { port, protocolVersion = PROTOCOL_VERSION } = {}) {
  const socket = ioClient(`http://127.0.0.1:${port}${GAME_NAMESPACE}`, {
    auth: { token, protocolVersion },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });

  const received = [];
  const waiters = [];

  socket.onAny((event, payload) => {
    const frame = { event, payload, at: Date.now() };
    received.push(frame);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].match(frame)) {
        waiters[i].resolve(frame);
        waiters.splice(i, 1);
      }
    }
  });

  const client = {
    socket,
    received,

    /** Resolves on the next matching frame, or one already received. */
    wait(event, { predicate, timeoutMs = 5000, fromIndex = 0 } = {}) {
      const already = received
        .slice(fromIndex)
        .find((f) => f.event === event && (!predicate || predicate(f.payload)));
      if (already) return Promise.resolve(already);

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const seen = received.map((f) => f.event).join(', ');
          reject(new Error(`timed out waiting for "${event}". Received: [${seen}]`));
        }, timeoutMs);
        waiters.push({
          match: (f) => f.event === event && (!predicate || predicate(f.payload)),
          resolve: (f) => {
            clearTimeout(timer);
            resolve(f);
          },
        });
      });
    },

    framesOf(event) {
      return received.filter((f) => f.event === event).map((f) => f.payload);
    },

    emit(event, payload) {
      return new Promise((resolve) => socket.emit(event, payload, resolve));
    },

    connected() {
      return new Promise((resolve, reject) => {
        if (socket.connected) return resolve();
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
    },

    close() {
      socket.close();
    },
  };

  return client;
}

/** Fastify's inject, with the auth header attached. */
export function api(app, token) {
  const call = (method) => (url, body) =>
    app.inject({
      method,
      url: url.startsWith('/api') ? url : `/api/v1${url}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(body ? { payload: body } : {}),
    });
  return {
    get: call('GET'),
    post: call('POST'),
    patch: call('PATCH'),
    put: call('PUT'),
    delete: call('DELETE'),
    json: async (res) => JSON.parse(res.body),
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

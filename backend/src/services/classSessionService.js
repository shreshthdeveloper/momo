import mongoose from 'mongoose';
import { ClassSession, Topic, SpaceMember, Space } from '../models/index.js';
import { selectQuestions, buildRound } from '../game/questionSelector.js';
import { ClassSessionRunner, sessions } from '../game/classSession.js';
import { assertPermission } from './spaceService.js';
import { randomJoinCode } from '../lib/crypto.js';
import { NotFoundError, BadRequestError, ConflictError } from '../lib/errors.js';
import {
  SESSION_MAX_QUESTIONS,
  SESSION_MIN_QUESTIONS,
  SESSION_ROUND_DURATION_MS,
} from '../shared/constants.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Hosting a live class session (the Kahoot-shaped half of the product).
 *
 * The database half. `game/classSession.js` runs the lesson; this creates it,
 * finds it by code, and hands the runner what it needs.
 */

/**
 * A code nobody else is currently using.
 *
 * Retried rather than assumed unique, and the uniqueness is enforced by a partial
 * index on the collection as well — a code collision would put a student in
 * somebody else's lesson, which is the worst outcome this feature has.
 */
async function freeCode(attempts = 8) {
  for (let i = 0; i < attempts; i += 1) {
    const code = randomJoinCode(6);
    const taken = await ClassSession.exists({ code, status: { $in: ['lobby', 'live'] } });
    if (!taken) return code;
  }
  throw new ConflictError('Could not allocate a session code. Try again.', 'NO_CODE');
}

export async function createSession(scope, user, input) {
  assertPermission(scope, 'manageContests');

  const topic = await Topic.findOne({ _id: oid(input.topicId), spaceId: scope.spaceId }).lean();
  if (!topic) {
    throw new BadRequestError('That topic is not in this organization.', 'TOPIC_NOT_IN_SPACE');
  }

  /**
   * One live session per host.
   *
   * A teacher with two lessons open has two codes on two projectors and no way to
   * tell which board is which — and the class that joined the abandoned one waits
   * for a question that never comes.
   */
  const running = await ClassSession.findOne({
    hostId: user._id,
    status: { $in: ['lobby', 'live'] },
  }).lean();
  if (running) {
    throw new ConflictError(
      'You already have a session open. End it before starting another.',
      'SESSION_OPEN',
      { sessionId: String(running._id), code: running.code },
    );
  }

  const count = Math.min(
    SESSION_MAX_QUESTIONS,
    Math.max(SESSION_MIN_QUESTIONS, Number(input.questionCount) || 10),
  );

  const space = await Space.findById(scope.spaceId, { settings: 1 }).lean();

  const session = await ClassSession.create({
    spaceId: scope.spaceId,
    topicId: topic._id,
    hostId: user._id,
    name: input.name || topic.name,
    code: await freeCode(),
    status: 'lobby',
    questionIds: [],
    roundDurationMs:
      Number(input.roundDurationMs) ||
      space?.settings?.roundDurationMs ||
      SESSION_ROUND_DURATION_MS,
    currentRound: -1,
  });

  return { session: shapeSession(session), questionCount: count, topic };
}

/**
 * Freeze the paper and hand back playable rounds.
 *
 * Frozen at start rather than at creation, so a teacher who sets up a lesson in
 * the morning and runs it in the afternoon gets questions chosen then — and, more
 * importantly, so the lobby does not hold an answer key for a session that may
 * never run.
 */
export async function lockSessionQuestions(session, { count = 10 } = {}) {
  const topic = await Topic.findById(session.topicId).lean();
  if (!topic) throw new NotFoundError('That topic no longer exists.');

  const questions = await selectQuestions(topic, [], {
    count,
    language: topic.languages?.[0] ?? 'en',
    // A class session is a shared paper, not a personal one: there is no single
    // player whose history could define "recently seen".
    excludeSeen: false,
  });
  if (questions.length < SESSION_MIN_QUESTIONS) {
    throw new BadRequestError(
      'This topic does not have enough published questions for a session.',
      'TOPIC_NOT_LIVE',
    );
  }

  await ClassSession.updateOne(
    { _id: session._id ?? session.id },
    { $set: { questionIds: questions.map((q) => q._id), startedAt: new Date(), status: 'live' } },
  );

  return questions.map((q) =>
    buildRound(q, {
      language: topic.languages?.[0] ?? 'en',
      durationMs: session.roundDurationMs,
    }),
  );
}

/** The session a code opens — refused unless it is genuinely joinable. */
export async function sessionByCode(user, code) {
  const session = await ClassSession.findOne({
    code: String(code ?? '').toUpperCase().trim(),
    status: { $in: ['lobby', 'live'] },
  }).lean();
  if (!session) throw new NotFoundError('No session with that code is running.', 'NO_SESSION');

  /**
   * Membership is checked here, not trusted from the code.
   *
   * A six-character code is short enough to guess and short enough to pass round a
   * school. It gets you into a lesson in YOUR organization; it is not a way into
   * somebody else's.
   */
  /**
   * `user` arrives from two places with two shapes: a REST handler passes the
   * Mongoose document (`_id`), and the socket gateway passes its own trimmed
   * session object (`id`). Reading only one of them silently made every socket
   * join look like a non-member — which failed as "that session belongs to
   * another organization", the most misleading message available.
   */
  const member = await SpaceMember.findOne({
    spaceId: session.spaceId,
    userId: oid(user._id ?? user.id),
    status: 'active',
  }).lean();
  if (!member) {
    throw new BadRequestError('That session belongs to another organization.', 'NOT_A_MEMBER');
  }

  return session;
}

export async function listSessions(scope, { limit = 20 } = {}) {
  const rows = await ClassSession.find({ spaceId: scope.spaceId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('topicId', 'name coverUrl')
    .lean();
  return rows.map((row) => shapeSession(row));
}

export async function getSessionReport(scope, sessionId) {
  if (!mongoose.isValidObjectId(sessionId)) throw new NotFoundError('No such session.');
  const row = await ClassSession.findOne({ _id: oid(sessionId), spaceId: scope.spaceId })
    .populate('topicId', 'name coverUrl')
    .lean();
  if (!row) throw new NotFoundError('No such session.');

  const board = [...(row.participants ?? [])]
    .sort((a, b) => b.score - a.score || b.correctCount - a.correctCount)
    .map((p, i) => ({
      rank: i + 1,
      id: String(p.userId),
      displayName: p.displayName,
      avatarUrl: p.avatarUrl ?? null,
      score: p.score,
      correctCount: p.correctCount,
      answered: (p.answers ?? []).length,
    }));

  /**
   * Per question, how the class did — the report a teacher actually opens this
   * for. "Nineteen of thirty missed question four" is the thing that changes what
   * gets taught tomorrow, and it is invisible in a ranked board.
   */
  const rounds = (row.questionIds ?? []).map((questionId, index) => {
    const answers = (row.participants ?? [])
      .flatMap((p) => p.answers ?? [])
      .filter((a) => a.roundIndex === index);
    const correct = answers.filter((a) => a.isCorrect).length;
    return {
      roundIndex: index,
      questionId: String(questionId),
      answered: answers.length,
      correct,
      accuracy: answers.length ? Math.round((correct / answers.length) * 100) : null,
    };
  });

  return { ...shapeSession(row), board, rounds };
}

export function shapeSession(session) {
  const doc = session.toObject?.() ?? session;
  return {
    id: String(doc._id),
    name: doc.name,
    code: doc.code,
    status: doc.status,
    topic: doc.topicId?._id
      ? { id: String(doc.topicId._id), name: doc.topicId.name, coverUrl: doc.topicId.coverUrl ?? null }
      : { id: String(doc.topicId) },
    hostId: String(doc.hostId),
    roundDurationMs: doc.roundDurationMs,
    totalRounds: (doc.questionIds ?? []).length,
    participantCount: (doc.participants ?? []).length,
    startedAt: doc.startedAt ?? null,
    endedAt: doc.endedAt ?? null,
    createdAt: doc.createdAt,
  };
}

export { sessions, ClassSessionRunner };

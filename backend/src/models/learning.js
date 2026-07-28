import mongoose from 'mongoose';
import {
  CONTEST_STATUS,
  STANDINGS_VISIBILITY,
  ASSIGNMENT_REQUIREMENT,
  ASSIGNMENT_STATUS,
  CONTEST_MIN_QUESTIONS,
  CONTEST_MAX_QUESTIONS,
  ASSIGNMENT_MAX_MATCHES,
} from '../shared/constants.js';

const { Schema } = mongoose;

// ── Contests (prd.md §8.5, F7.5) ───────────────────────────────────────────

/**
 * A scheduled, time-boxed event inside a Space with a **fixed question set**
 * and its own standings.
 *
 * The fixed set is the whole point: the standings only mean anything if every
 * entrant answered the same questions. The set is frozen onto the document
 * when the contest opens, never resampled per entry — otherwise two students
 * on the same leaderboard would have sat different papers.
 *
 * Rating (Elo) is deliberately untouched by a contest. prd.md §6.3 lists the
 * contest match's rating column as "separate standings", and mixing the two
 * would mean a student's public ranking moved because their institute
 * scheduled a hard test.
 */
const contestSchema = new Schema(
  {
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 400 },

    /** prd.md F8.5.1 — a contest may span several topics. */
    topicIds: [{ type: Schema.Types.ObjectId, ref: 'Topic', required: true }],

    questionCount: {
      type: Number,
      default: CONTEST_MIN_QUESTIONS,
      min: CONTEST_MIN_QUESTIONS,
      max: CONTEST_MAX_QUESTIONS,
    },
    /**
     * prd.md F8.5.2 — selected automatically from the topics, or curated by
     * hand. `auto` still freezes the chosen ids at open; the mode only decides
     * who chose them.
     */
    selectionMode: { type: String, enum: ['auto', 'manual'], default: 'auto' },
    questionIds: [{ type: Schema.Types.ObjectId, ref: 'Question' }],
    /** Set the moment the question set is frozen. */
    questionsLockedAt: { type: Date, default: null },

    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    /** Seconds per question, defaulting to the space's own setting. */
    roundDurationMs: { type: Number, default: null },

    /** prd.md F8.5.1 — eligible batches. Empty means the whole space. */
    batchIds: [{ type: Schema.Types.ObjectId, ref: 'Batch' }],

    standingsVisibility: {
      type: String,
      enum: Object.values(STANDINGS_VISIBILITY),
      default: STANDINGS_VISIBILITY.LIVE,
    },

    status: {
      type: String,
      enum: Object.values(CONTEST_STATUS),
      default: CONTEST_STATUS.DRAFT,
    },

    stats: {
      entrants: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      avgScore: { type: Number, default: 0 },
      topScore: { type: Number, default: 0 },
    },

    /** Set when final ranks were written, so finalisation is idempotent. */
    finalisedAt: { type: Date, default: null },
    /** Set once "starting in 15 minutes" went out, so it goes out once. */
    startingSoonNotifiedAt: { type: Date, default: null },
    openedNotifiedAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

contestSchema.index({ spaceId: 1, status: 1, startsAt: -1 });
contestSchema.index({ spaceId: 1, endsAt: -1 });
/** The lifecycle job's working set — every contest whose clock may have moved. */
contestSchema.index({ status: 1, startsAt: 1 });

contestSchema.virtual('isOpen').get(function isOpen() {
  const now = Date.now();
  return (
    this.status === CONTEST_STATUS.LIVE &&
    now >= this.startsAt.getTime() &&
    now < this.endsAt.getTime()
  );
});

contestSchema.set('toJSON', { virtuals: true });
contestSchema.set('toObject', { virtuals: true });

export const Contest = mongoose.model('Contest', contestSchema);

/**
 * One entry per (contest, student). A student gets one attempt — a contest
 * with retries is a practice set, and its standings would rank persistence
 * rather than knowledge.
 */
const contestEntrySchema = new Schema(
  {
    contestId: { type: Schema.Types.ObjectId, ref: 'Contest', required: true },
    /** Denormalised so every standings read is a single-collection query. */
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    batchId: { type: Schema.Types.ObjectId, ref: 'Batch', default: null },

    displayName: { type: String },
    avatarUrl: { type: String },

    matchId: { type: Schema.Types.ObjectId, ref: 'Match', default: null },

    score: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    answeredCount: { type: Number, default: 0 },
    /**
     * Total response time across answered rounds. This is the tiebreak, and it
     * is why it is stored rather than derived — the standings query must not
     * have to open the match documents.
     */
    totalResponseMs: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ['in_progress', 'complete', 'abandoned'],
      default: 'in_progress',
    },
    /** Written once at finalisation, so a student's certificate never moves. */
    finalRank: { type: Number, default: null },

    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

contestEntrySchema.index({ contestId: 1, userId: 1 }, { unique: true });
/**
 * The standings index. prd.md F6.6.5 breaks ties by fewer matches then by who
 * got there first; inside a contest everyone has played exactly one match, so
 * the tiebreak that means something is total response time — the faster of two
 * equal scores wins, which is also how the round scoring already thinks.
 */
contestEntrySchema.index({ contestId: 1, score: -1, totalResponseMs: 1 });
contestEntrySchema.index({ spaceId: 1, userId: 1 });

export const ContestEntry = mongoose.model('ContestEntry', contestEntrySchema);

// ── Assignments (prd.md F8.5.5, F8.5.6, F7.4) ──────────────────────────────

/**
 * An admin-set requirement for students — "play 5 matches in Mechanics before
 * Friday".
 *
 * Deliberately not a contest with a longer window. An assignment is satisfied
 * by ordinary play, so a student never has to remember to enter anything; they
 * just play the topic and the progress moves.
 */
const assignmentSchema = new Schema(
  {
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true },
    topicId: { type: Schema.Types.ObjectId, ref: 'Topic', required: true },

    title: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 400 },

    requirement: {
      type: {
        type: String,
        enum: Object.values(ASSIGNMENT_REQUIREMENT),
        default: ASSIGNMENT_REQUIREMENT.MATCHES,
      },
      /** matches: how many to play. */
      matches: { type: Number, default: 3, min: 1, max: ASSIGNMENT_MAX_MATCHES },
      /** accuracy: percent correct across those matches, 0–100. */
      minAccuracy: { type: Number, default: 60, min: 0, max: 100 },
      /** mastery: the topic level to reach. */
      level: { type: Number, default: 5, min: 1, max: 50 },
    },

    dueAt: { type: Date, required: true },
    /** prd.md F8.5.5 — target batches. Empty means every student. */
    batchIds: [{ type: Schema.Types.ObjectId, ref: 'Batch' }],

    status: {
      type: String,
      enum: Object.values(ASSIGNMENT_STATUS),
      default: ASSIGNMENT_STATUS.ACTIVE,
    },

    /**
     * There is deliberately no stored `assigned` / `completed` counter here.
     * Who an assignment is for is a function of live membership — a student
     * joins, leaves, or changes batch, and any stored denominator is instantly
     * wrong in a way nobody notices until someone asks why the numbers do not
     * add up. Both figures are counted at read time; see
     * `assignmentService.assignedCounts`.
     */

    /** Set once the "due tomorrow" reminder went out. */
    dueReminderSentAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

assignmentSchema.index({ spaceId: 1, status: 1, dueAt: 1 });
/**
 * The hot one: every completed match asks "is there an active assignment on
 * this topic in this space?". Without this index that question would be a
 * collection scan on the match-completion path.
 */
assignmentSchema.index({ spaceId: 1, topicId: 1, status: 1 });

export const Assignment = mongoose.model('Assignment', assignmentSchema);

/** Per-student completion tracking (prd.md F8.5.6). */
const assignmentProgressSchema = new Schema(
  {
    assignmentId: { type: Schema.Types.ObjectId, ref: 'Assignment', required: true },
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    matchesPlayed: { type: Number, default: 0 },
    answeredCount: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    /** Best mastery level reached on the topic while the assignment was open. */
    level: { type: Number, default: 0 },

    completedAt: { type: Date, default: null },
    /** True when it was completed after `dueAt` — visible to the admin, not punitive. */
    late: { type: Boolean, default: false },
    lastMatchAt: { type: Date, default: null },
  },
  { timestamps: true },
);

assignmentProgressSchema.index({ assignmentId: 1, userId: 1 }, { unique: true });
assignmentProgressSchema.index({ userId: 1, spaceId: 1 });
assignmentProgressSchema.index({ assignmentId: 1, completedAt: 1 });

export const AssignmentProgress = mongoose.model('AssignmentProgress', assignmentProgressSchema);

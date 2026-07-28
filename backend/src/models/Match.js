import mongoose from 'mongoose';
import { MATCH_MODE } from '../shared/constants.js';

const { Schema } = mongoose;

const answerSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    /** null means the round timed out without an answer. */
    optionIndex: { type: Number, default: null },
    elapsedMs: { type: Number, default: null },
    points: { type: Number, default: 0 },
    isCorrect: { type: Boolean, default: false },
    /** tech.md §9.6 — set when the response is below the human floor. */
    flagged: { type: Boolean, default: false },
  },
  { _id: false },
);

const roundSchema = new Schema(
  {
    questionIndex: { type: Number, required: true },
    questionId: { type: Schema.Types.ObjectId, ref: 'Question' },
    /** Index into the *shuffled* option order this match used. */
    correctIndex: { type: Number, required: true },
    /**
     * The per-match option permutation. `optionOrder[i]` is the canonical
     * index of the option shown in position i, so item analysis can be
     * attributed to the right option even though position was randomised.
     */
    optionOrder: { type: [Number], default: undefined },
    durationMs: { type: Number },
    answers: { type: [answerSchema], default: [] },
  },
  { _id: false },
);

/** A perk exactly as shared/perks.js describes it, frozen at unlock time. */
const unlockedPerkSchema = new Schema(
  {
    key: { type: String },
    type: { type: String },
    name: { type: String },
    level: { type: Number },
  },
  { _id: false },
);

const matchPlayerSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    displayName: { type: String },
    avatarUrl: { type: String },
    /** prd.md F6.7.5 — ghosts are never labelled as such to the player. */
    isGhost: { type: Boolean, default: false },
    sourceMatchId: { type: Schema.Types.ObjectId, ref: 'Match', default: null },

    score: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    ratingBefore: { type: Number },
    ratingAfter: { type: Number },
    xpEarned: { type: Number, default: 0 },
    /** Coins this match paid — match result, levels crossed and any promotion. */
    coinsEarned: { type: Number, default: 0 },

    /**
     * leagues-and-progression.md §6 — what this match did to the global
     * ladder and to the account level.
     *
     * Written for every mode; only a ranked match makes `rankedBefore` and
     * `rankedAfter` differ. A ghost has no account, so none of this is set
     * for it. The match record is the permanent account of one moment, which
     * is why the deltas are stored rather than recomputed from a rating that
     * has since moved on.
     */
    rankedBefore: { type: Number },
    rankedAfter: { type: Number },
    rankedDelta: { type: Number },
    accountLevelBefore: { type: Number },
    accountLevel: { type: Number },
    accountLevelUp: { type: Boolean, default: false },
    /** Perks this match handed over. Absent, not empty, when it handed over none. */
    unlocked: { type: [unlockedPerkSchema], default: undefined },
    totalXpAfter: { type: Number },

    /** Set when this player forfeited or dropped past the grace window. */
    forfeited: { type: Boolean, default: false },
  },
  { _id: false },
);

const matchSchema = new Schema(
  {
    topicId: { type: Schema.Types.ObjectId, ref: 'Topic', required: true },
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true },
    mode: { type: String, enum: Object.values(MATCH_MODE), default: MATCH_MODE.QUICK },
    language: { type: String, default: 'en' },

    players: { type: [matchPlayerSchema], default: [] },
    questionIds: [{ type: Schema.Types.ObjectId, ref: 'Question' }],
    rounds: { type: [roundSchema], default: [] },

    winnerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isDraw: { type: Boolean, default: false },
    /** Both players dropped — nobody's rating moves. tech.md §9.7. */
    isVoid: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ['live', 'complete', 'abandoned', 'void'],
      default: 'live',
    },
    roundDurationMs: { type: Number },
    contestId: { type: Schema.Types.ObjectId, ref: 'Contest', default: null },
    challengeId: { type: Schema.Types.ObjectId, ref: 'Challenge', default: null },

    completedAt: { type: Date },
  },
  { timestamps: true },
);

matchSchema.index({ 'players.userId': 1, createdAt: -1 });
matchSchema.index({ topicId: 1, createdAt: -1 });
matchSchema.index({ spaceId: 1, createdAt: -1 });
matchSchema.index({ status: 1, createdAt: -1 });
matchSchema.index({ contestId: 1, createdAt: -1 }, { sparse: true });

export const Match = mongoose.model('Match', matchSchema);

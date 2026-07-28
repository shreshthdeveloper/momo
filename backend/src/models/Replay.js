import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * A stored game, replayed as a ghost opponent (prd.md §6.7, tech.md §3.9).
 *
 * This is a launch requirement, not an optimisation. With a small user base a
 * live opponent for a specific topic at a specific skill at a specific hour
 * frequently will not exist, and an empty lobby loses the player for good.
 */
const replaySchema = new Schema(
  {
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    topicId: { type: Schema.Types.ObjectId, ref: 'Topic', required: true },
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true },

    playerRating: { type: Number, required: true },
    /** floor(rating / 100) — the bucket ghost matchmaking searched before levels. */
    ratingBand: { type: Number, required: true },
    /**
     * The player's topic level when they recorded this run, and the field ghost
     * selection matches on now — live pairing runs on the level, so a ghost
     * must too or the versus screen contradicts itself.
     *
     * Deliberately optional: replays predating this field keep working and are
     * selected by `ratingBand` instead.
     */
    playerLevel: { type: Number, default: null },

    /** prd.md F6.7.5 — snapshot, so a later rename does not rewrite history. */
    displayName: { type: String },
    avatarUrl: { type: String },
    /**
     * Where this run was played from.
     *
     * Stored because the versus screen draws a flag and a place under every
     * name, and without it a replayed opponent had a blank there while a live
     * one did not — which is exactly the tell F6.7.5 exists to prevent. It is
     * the same country and city the player's own profile already shows.
     */
    country: { type: String },
    city: { type: String },

    questionIds: [{ type: Schema.Types.ObjectId, ref: 'Question' }],
    /**
     * Positionally parallel to questionIds. `optionIndex` is the CANONICAL
     * option index, not the shuffled one, so the replay stays correct when the
     * new match shuffles options differently.
     */
    answers: [
      {
        _id: false,
        optionIndex: { type: Number, default: null },
        elapsedMs: { type: Number, default: null },
        isCorrect: { type: Boolean, default: false },
      },
    ],

    finalScore: { type: Number, default: 0 },
    /** Sorted ascending when picking, so replay usage spreads. */
    usedCount: { type: Number, default: 0 },

    /**
     * Set when this run was a contest entry, and it partitions the replay pool
     * in both directions.
     *
     * A contest replay carries the contest's frozen question set, so serving it
     * to someone playing that topic casually would hand them the paper while
     * the contest was still open. Equally, a contest entrant must face the
     * contest's questions, which only a replay from that contest has. So ghost
     * selection always filters on this field — `null` for ordinary play, the
     * contest id inside a contest.
     */
    contestId: { type: Schema.Types.ObjectId, ref: 'Contest', default: null },
  },
  { timestamps: true },
);

replaySchema.index({ topicId: 1, ratingBand: 1, usedCount: 1 });
/** The level-first selection path — see `findReplay`. */
replaySchema.index({ topicId: 1, playerLevel: 1, usedCount: 1 });
replaySchema.index({ contestId: 1, usedCount: 1 }, { sparse: true });
replaySchema.index({ spaceId: 1, topicId: 1 });
/**
 * Unique per (match, player), not per match. A live 1v1 yields TWO replays —
 * each player's run is an independent ghost, and halving the replay pool would
 * directly worsen the ghost ratio the PRD tracks as a health metric (F6.7.7).
 */
replaySchema.index({ matchId: 1, userId: 1 }, { unique: true });
replaySchema.index({ createdAt: 1 });

export const Replay = mongoose.model('Replay', replaySchema);

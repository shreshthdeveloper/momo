import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * tech.md §3.10 — one document per pair with `userA < userB` lexicographically,
 * so a friendship can never be duplicated by two simultaneous requests.
 */
const friendshipSchema = new Schema(
  {
    userA: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userB: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** Who sent the request — needed to know whose turn it is to accept. */
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'blocked'],
      default: 'pending',
    },
    respondedAt: { type: Date },
  },
  { timestamps: true },
);

friendshipSchema.index({ userA: 1, userB: 1 }, { unique: true });
friendshipSchema.index({ userB: 1, status: 1 });
friendshipSchema.index({ userA: 1, status: 1 });

/** Order a pair canonically. Every write must go through this. */
friendshipSchema.statics.pairOf = function pairOf(id1, id2) {
  const [a, b] = [String(id1), String(id2)].sort();
  return { userA: a, userB: b };
};

export const Friendship = mongoose.model('Friendship', friendshipSchema);

/** prd.md §6.3 — friend challenge, async, 24h to respond. */
const challengeSchema = new Schema(
  {
    fromUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    toUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    topicId: { type: Schema.Types.ObjectId, ref: 'Topic', required: true },
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true },

    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'expired', 'complete'],
      default: 'pending',
    },
    /**
     * The ASYNC shape, still unbuilt: the challenger plays first against a
     * ghost of nobody, their run is recorded, and the opponent then answers the
     * same questions. That is what would make a challenge fair without both
     * people being awake at once, and it is why these three fields exist.
     *
     * What ships instead is a live challenge: accepting opens a private queue
     * that only these two can pair in (game/matchmaker.js), so they play each
     * other properly, in real time, with no ghost involved. It reuses the whole
     * engine and costs nothing new. The trade is that both have to be online,
     * which the 24-hour window exists to make likely rather than certain — and
     * these fields are left in place because the async variant is still the
     * better answer, not because it was forgotten.
     */
    questionIds: [{ type: Schema.Types.ObjectId, ref: 'Question' }],
    fromMatchId: { type: Schema.Types.ObjectId, ref: 'Match' },
    toMatchId: { type: Schema.Types.ObjectId, ref: 'Match' },

    expiresAt: { type: Date, required: true },
    respondedAt: { type: Date },
    /** When the two of them were actually paired. Set once, on start. */
    playedAt: { type: Date },
  },
  { timestamps: true },
);

challengeSchema.index({ toUserId: 1, status: 1, expiresAt: 1 });
challengeSchema.index({ fromUserId: 1, status: 1 });
challengeSchema.index({ expiresAt: 1 });

export const Challenge = mongoose.model('Challenge', challengeSchema);

import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Materialised weekly and monthly boards (tech.md §10).
 *
 * All-time boards read `ratings` directly — that collection is already indexed
 * for it. Period boards cannot, because rating is a running value with no
 * history, so periods rank by points earned inside the window and are
 * rebuilt hourly by a job rather than aggregated on every request.
 */
const leaderboardSnapshotSchema = new Schema(
  {
    /** `${scope}:${scopeValue}:${topicId ?? 'overall'}:${period}:${bucket}` */
    key: { type: String, required: true },

    topicId: { type: Schema.Types.ObjectId, ref: 'Topic', default: null },
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true },
    scope: { type: String, enum: ['global', 'country', 'city', 'space', 'batch'], required: true },
    scopeValue: { type: String, default: null },
    period: { type: String, enum: ['week', 'month'], required: true },
    /** ISO week `2026-W30` or month `2026-07`. */
    bucket: { type: String, required: true },

    entries: [
      {
        _id: false,
        rank: Number,
        userId: { type: Schema.Types.ObjectId, ref: 'User' },
        displayName: String,
        avatarUrl: String,
        city: String,
        points: Number,
        matchesPlayed: Number,
        wins: Number,
        rating: Number,
      },
    ],

    totalPlayers: { type: Number, default: 0 },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

leaderboardSnapshotSchema.index({ key: 1 }, { unique: true });
leaderboardSnapshotSchema.index({ spaceId: 1, period: 1, bucket: 1 });
leaderboardSnapshotSchema.index({ generatedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 120 });

export const LeaderboardSnapshot = mongoose.model(
  'LeaderboardSnapshot',
  leaderboardSnapshotSchema,
);

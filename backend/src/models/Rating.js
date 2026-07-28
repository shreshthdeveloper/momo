import mongoose from 'mongoose';
import { ELO_START } from '../shared/constants.js';

const { Schema } = mongoose;

/**
 * One document per user per topic — the single most-read collection
 * (tech.md §3.7). Every leaderboard query lands here, which is why the
 * compound indexes below are not optional.
 */
const ratingSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    topicId: { type: Schema.Types.ObjectId, ref: 'Topic', required: true },
    /** Denormalised from the topic so leaderboards never need a join. */
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true },

    rating: { type: Number, default: ELO_START },
    peakRating: { type: Number, default: ELO_START },

    matchesPlayed: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },

    /** Mastery — progression, distinct from rating. prd.md F6.5.2. */
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },

    correctAnswers: { type: Number, default: 0 },
    totalAnswers: { type: Number, default: 0 },
    totalResponseMs: { type: Number, default: 0 },

    /** prd.md F6.6.5 — ties break by fewer matches, then by who got there first. */
    reachedRatingAt: { type: Date, default: Date.now },
    lastPlayedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

ratingSchema.index({ userId: 1, topicId: 1 }, { unique: true });
// Serves every topic leaderboard. Without it, leaderboards collection-scan.
ratingSchema.index({ topicId: 1, rating: -1, matchesPlayed: 1, reachedRatingAt: 1 });
ratingSchema.index({ spaceId: 1, rating: -1 });
ratingSchema.index({ userId: 1, rating: -1 });
ratingSchema.index({ userId: 1, lastPlayedAt: -1 });

ratingSchema.virtual('accuracy').get(function accuracy() {
  return this.totalAnswers ? this.correctAnswers / this.totalAnswers : 0;
});

ratingSchema.virtual('avgResponseMs').get(function avgResponseMs() {
  return this.totalAnswers ? Math.round(this.totalResponseMs / this.totalAnswers) : 0;
});

ratingSchema.set('toJSON', { virtuals: true });
ratingSchema.set('toObject', { virtuals: true });

export const Rating = mongoose.model('Rating', ratingSchema);

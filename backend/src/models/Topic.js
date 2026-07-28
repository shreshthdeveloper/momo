import mongoose from 'mongoose';
import {
  TOPIC_STATUS,
  MIN_PUBLISHED_QUESTIONS_TO_LIVE,
  DEFAULT_LANGUAGE,
} from '../shared/constants.js';

const { Schema } = mongoose;

const topicSchema = new Schema(
  {
    /** prd.md §5.1 rule 1 — every topic belongs to exactly one Space. */
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },

    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, required: true, lowercase: true, trim: true },
    description: { type: String, trim: true, maxlength: 280 },
    coverUrl: { type: String },

    /**
     * prd.md §5.1 rule 3 — a Space topic may draw from the Central Bank, its
     * own Space Bank, or both. Never from another Space's bank; the resolver
     * in game/questionSelector.js is the only place that reads this.
     */
    questionSources: {
      central: { type: Boolean, default: false },
      own: { type: Boolean, default: true },
    },

    /** prd.md Q3 — additive. Adding Hindi means pushing 'hi' here. */
    languages: { type: [String], default: [DEFAULT_LANGUAGE] },

    status: { type: String, enum: Object.values(TOPIC_STATUS), default: TOPIC_STATUS.DRAFT },
    /** Maintained on question publish/archive — never computed at read time. */
    publishedQuestionCount: { type: Number, default: 0 },

    /** prd.md F8.3.4 — empty means the whole Space. */
    batchIds: [{ type: Schema.Types.ObjectId, ref: 'Batch' }],
    order: { type: Number, default: 0 },
    featured: { type: Boolean, default: false },

    stats: {
      matchesPlayed: { type: Number, default: 0 },
      uniquePlayers: { type: Number, default: 0 },
      avgAccuracy: { type: Number, default: 0 },
      avgResponseMs: { type: Number, default: 0 },
      /** prd.md F6.7.7 — sustained above 60% means this topic lacks liquidity. */
      ghostRatio: { type: Number, default: 0 },
      activePlayers: { type: Number, default: 0 },
    },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

topicSchema.index({ spaceId: 1, status: 1 });
topicSchema.index({ spaceId: 1, categoryId: 1 });
topicSchema.index({ spaceId: 1, slug: 1 }, { unique: true });
topicSchema.index({ spaceId: 1, featured: -1, 'stats.matchesPlayed': -1 });
topicSchema.index({ name: 'text', description: 'text' });

/** prd.md F8.3.3 — 21 published questions, three matches' worth. */
topicSchema.virtual('isLive').get(function isLive() {
  return (
    this.status === TOPIC_STATUS.PUBLISHED &&
    this.publishedQuestionCount >= MIN_PUBLISHED_QUESTIONS_TO_LIVE
  );
});

topicSchema.virtual('readiness').get(function readiness() {
  return {
    published: this.publishedQuestionCount,
    required: MIN_PUBLISHED_QUESTIONS_TO_LIVE,
    remaining: Math.max(0, MIN_PUBLISHED_QUESTIONS_TO_LIVE - this.publishedQuestionCount),
    fraction: Math.min(1, this.publishedQuestionCount / MIN_PUBLISHED_QUESTIONS_TO_LIVE),
  };
});

topicSchema.set('toJSON', { virtuals: true });
topicSchema.set('toObject', { virtuals: true });

export const Topic = mongoose.model('Topic', topicSchema);

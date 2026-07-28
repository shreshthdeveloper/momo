import mongoose from 'mongoose';
import {
  QUESTION_STATUS,
  DIFFICULTY,
  OPTIONS_PER_QUESTION,
  QUESTION_TEXT_HARD_MAX,
  OPTION_TEXT_MAX,
  DEFAULT_LANGUAGE,
} from '../shared/constants.js';

const { Schema } = mongoose;

/**
 * One language's rendering of a question.
 *
 * prd.md Q3 resolved: English at launch, but the text lives under a language
 * key rather than at the top level. Adding Hindi is then an additive write —
 * `content.hi = {...}` — instead of a migration across the match engine, the
 * admin portal, and every existing document.
 *
 * `options` are positionally parallel across languages, so `correctIndex`
 * lives once on the parent and stays valid in every language.
 */
const questionContentSchema = new Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: QUESTION_TEXT_HARD_MAX },
    options: {
      type: [{ type: String, trim: true, maxlength: OPTION_TEXT_MAX }],
      validate: {
        validator: (v) => Array.isArray(v) && v.length === OPTIONS_PER_QUESTION,
        message: `A question needs exactly ${OPTIONS_PER_QUESTION} options.`,
      },
      required: true,
    },
    explanation: { type: String, trim: true, maxlength: 600 },
  },
  { _id: false },
);

const questionSchema = new Schema(
  {
    /**
     * prd.md §5.1 rule 2 — a question originates from the Central Bank or from
     * exactly one Space Bank. Central is PUBLIC_SPACE_ID.
     */
    origin: { type: Schema.Types.ObjectId, ref: 'Space', required: true },
    topicIds: [{ type: Schema.Types.ObjectId, ref: 'Topic', required: true }],

    content: {
      type: Map,
      of: questionContentSchema,
      required: true,
    },
    defaultLanguage: { type: String, default: DEFAULT_LANGUAGE },

    correctIndex: { type: Number, required: true, min: 0, max: OPTIONS_PER_QUESTION - 1 },
    difficulty: {
      type: String,
      enum: Object.values(DIFFICULTY),
      default: DIFFICULTY.MEDIUM,
    },
    tags: [{ type: String, trim: true, lowercase: true, maxlength: 30 }],

    imageUrl: { type: String },
    /** prd.md F8.2.3 — per-question override of the round timer. */
    timeLimitOverrideMs: { type: Number, min: 5000, max: 60000, default: null },

    status: {
      type: String,
      enum: Object.values(QUESTION_STATUS),
      default: QUESTION_STATUS.DRAFT,
    },

    /** prd.md F8.2.7 — normalised hash, drives duplicate detection. */
    contentHash: { type: String, index: true },
    /** prd.md F8.2.9 — set when forked out of the central bank. */
    forkedFrom: { type: Schema.Types.ObjectId, ref: 'Question', default: null },

    /** prd.md F8.2.6 — AI drafts land in review, never live. */
    source: { type: String, enum: ['manual', 'import', 'ai'], default: 'manual' },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewNote: { type: String },

    /** prd.md F8.2.10 — item analysis. Rolled up by a job, not on the hot path. */
    stats: {
      served: { type: Number, default: 0 },
      correctCount: { type: Number, default: 0 },
      avgResponseMs: { type: Number, default: 0 },
      optionCounts: { type: [Number], default: () => [0, 0, 0, 0] },
      timeoutCount: { type: Number, default: 0 },
    },

    /** prd.md F8.2.4 — hard delete only for questions never served. */
    servedEver: { type: Boolean, default: false },

    reportCount: { type: Number, default: 0 },

    /** Denormalised haystack for F8.2.2 full-text search across all languages. */
    searchText: { type: String },
  },
  { timestamps: true },
);

questionSchema.index({ topicIds: 1, status: 1, difficulty: 1 });
questionSchema.index({ origin: 1, status: 1 });
questionSchema.index({ origin: 1, updatedAt: -1 });
questionSchema.index({ searchText: 'text' });
questionSchema.index({ origin: 1, contentHash: 1 });

questionSchema.pre('save', function buildSearchText(next) {
  if (this.isModified('content')) {
    const parts = [];
    for (const [, value] of this.content ?? new Map()) {
      parts.push(value.text, ...(value.options ?? []));
    }
    this.searchText = parts.filter(Boolean).join(' • ');
  }
  next();
});

/**
 * Resolve a question into one language. Falls back to the question's own
 * default rather than throwing, so a partially translated bank still plays.
 */
questionSchema.methods.localised = function localised(language = DEFAULT_LANGUAGE) {
  const map = this.content;
  const get = (k) => (map instanceof Map ? map.get(k) : map?.[k]);
  const chosen = get(language) ?? get(this.defaultLanguage) ?? get(DEFAULT_LANGUAGE);
  if (!chosen) return null;
  return {
    language: get(language) ? language : (this.defaultLanguage ?? DEFAULT_LANGUAGE),
    text: chosen.text,
    options: [...chosen.options],
    explanation: chosen.explanation,
  };
};

/** Shape sent to the admin portal — includes the answer key. Never to a player. */
questionSchema.methods.toAdminJson = function toAdminJson() {
  const content = {};
  const map = this.content;
  if (map instanceof Map) for (const [k, v] of map) content[k] = v.toObject?.() ?? v;
  else Object.assign(content, map);

  return {
    id: String(this._id),
    origin: String(this.origin),
    topicIds: this.topicIds.map(String),
    content,
    defaultLanguage: this.defaultLanguage,
    correctIndex: this.correctIndex,
    difficulty: this.difficulty,
    tags: this.tags,
    imageUrl: this.imageUrl,
    timeLimitOverrideMs: this.timeLimitOverrideMs,
    status: this.status,
    forkedFrom: this.forkedFrom ? String(this.forkedFrom) : null,
    source: this.source,
    createdBy: this.createdBy ? String(this.createdBy) : null,
    reviewedBy: this.reviewedBy ? String(this.reviewedBy) : null,
    stats: this.stats,
    servedEver: this.servedEver,
    reportCount: this.reportCount,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const Question = mongoose.model('Question', questionSchema);

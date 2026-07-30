import mongoose from 'mongoose';
import { JOIN_MODE, ROUND_DURATION_MS, SPACE_ACCENTS } from '../shared/constants.js';

const { Schema } = mongoose;

const spaceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, lowercase: true, trim: true },
    /** True for the single reserved Public Arena tenant. */
    isPublic: { type: Boolean, default: false },

    logoUrl: { type: String },
    /** design.md §3.3 — curated set only, never free colour entry. */
    accentColor: { type: String, enum: SPACE_ACCENTS, default: SPACE_ACCENTS[0] },

    ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
    contactEmail: { type: String, lowercase: true, trim: true },
    contactPhone: { type: String, trim: true },

    joinMode: { type: String, enum: Object.values(JOIN_MODE), default: JOIN_MODE.APPROVAL },
    joinCode: { type: String, uppercase: true },

    plan: {
      tier: { type: String, enum: ['trial', 'starter', 'growth', 'institution'], default: 'trial' },
      seatLimit: { type: Number, default: 50 },
      status: {
        type: String,
        enum: ['trialing', 'active', 'past_due', 'cancelled'],
        default: 'trialing',
      },
      currentPeriodEnd: { type: Date },
    },

    settings: {
      /**
       * design.md §11 — configurable per Space, so an institute supporting
       * students who need longer can raise it without leaving the product.
       */
      roundDurationMs: { type: Number, default: ROUND_DURATION_MS, min: 5000, max: 60000 },
      allowPublicProfiles: { type: Boolean, default: false },
      /** prd.md F6.7 — an institute may prefer real opponents only. */
      allowGhosts: { type: Boolean, default: true },
      /**
       * One paper a day for the whole organization, generated automatically.
       *
       * Off by default, and deliberately: a daily challenge sends a notification
       * every morning, and an organization that did not ask for that should not
       * discover it happening. Turning it on is a decision an admin makes once.
       */
      dailyChallenge: { type: Boolean, default: false },
    },

    status: {
      type: String,
      enum: ['pending', 'active', 'suspended', 'rejected'],
      default: 'pending',
      index: true,
    },
    rejectionReason: { type: String },
    approvedAt: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    stats: {
      studentCount: { type: Number, default: 0 },
      questionCount: { type: Number, default: 0 },
      matchesPlayed: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

spaceSchema.index({ slug: 1 }, { unique: true });
spaceSchema.index({ joinCode: 1 }, { unique: true, sparse: true });
spaceSchema.index({ ownerId: 1 });

spaceSchema.methods.toBrand = function toBrand() {
  return {
    id: String(this._id),
    name: this.name,
    slug: this.slug,
    logoUrl: this.logoUrl,
    accentColor: this.accentColor,
    isPublic: this.isPublic,
    roundDurationMs: this.settings?.roundDurationMs,
  };
};

export const Space = mongoose.model('Space', spaceSchema);

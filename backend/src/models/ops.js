import mongoose from 'mongoose';

const { Schema } = mongoose;

// ── Auth support ───────────────────────────────────────────────────────────

/** tech.md §5 — hashed, single-use, rate limited, 5-minute life. */
const otpRequestSchema = new Schema(
  {
    phone: { type: String, required: true, index: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    consumedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
    ip: { type: String },
  },
  { timestamps: true },
);

otpRequestSchema.index({ phone: 1, createdAt: -1 });
// Mongo prunes spent OTPs automatically an hour after expiry.
otpRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

export const OtpRequest = mongoose.model('OtpRequest', otpRequestSchema);

/**
 * Refresh tokens, rotated on every use. tech.md §5: presenting an already
 * rotated token revokes the whole family — that is how a stolen token is
 * detected rather than merely tolerated.
 */
const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    /** Shared by every token descended from one login. */
    familyId: { type: String, required: true },
    replacedBy: { type: String, default: null },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String },
    userAgent: { type: String },
    ip: { type: String },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ userId: 1, familyId: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);

// ── Space structure ────────────────────────────────────────────────────────

/** prd.md F8.4.5 — batches scope assignments, contests, and leaderboards. */
const batchSchema = new Schema(
  {
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, maxlength: 200 },
    year: { type: String, trim: true },
    studentCount: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

batchSchema.index({ spaceId: 1, name: 1 }, { unique: true });

export const Batch = mongoose.model('Batch', batchSchema);

// ── Moderation and audit ───────────────────────────────────────────────────

const reportSchema = new Schema(
  {
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    targetType: { type: String, enum: ['question', 'user', 'displayName'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space' },
    matchId: { type: Schema.Types.ObjectId, ref: 'Match' },

    reason: {
      type: String,
      enum: ['wrong_answer', 'typo', 'offensive', 'duplicate', 'cheating', 'harassment', 'other'],
      required: true,
    },
    note: { type: String, maxlength: 500 },

    status: {
      type: String,
      enum: ['open', 'reviewing', 'resolved', 'dismissed'],
      default: 'open',
    },
    resolution: { type: String },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
  },
  { timestamps: true },
);

reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ targetType: 1, targetId: 1 });
reportSchema.index({ spaceId: 1, status: 1 });
// One report per user per target — mass-reporting is a moderation signal,
// not a way to bury a question.
reportSchema.index({ reporterId: 1, targetType: 1, targetId: 1 }, { unique: true });

export const Report = mongoose.model('Report', reportSchema);

/** prd.md F8.7.5 / F9.1.4 — every admin action and impersonation session. */
const auditLogSchema = new Schema(
  {
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', index: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** Set when a superadmin is acting as someone else. Visible to the space. */
    impersonatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true },
    targetType: { type: String },
    targetId: { type: Schema.Types.ObjectId },
    summary: { type: String },
    meta: { type: Schema.Types.Mixed },
    ip: { type: String },
  },
  { timestamps: true },
);

auditLogSchema.index({ spaceId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);

// ── Notifications ──────────────────────────────────────────────────────────

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String },
    data: { type: Schema.Types.Mixed },
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space' },
    readAt: { type: Date, default: null },
    /** Set once handed to FCM, so a retry cannot double-send. */
    pushedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 60 });

export const Notification = mongoose.model('Notification', notificationSchema);

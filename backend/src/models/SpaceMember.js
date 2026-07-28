import mongoose from 'mongoose';
import { SPACE_ROLE } from '../shared/constants.js';

const { Schema } = mongoose;

/**
 * prd.md F8.7.3 — sub-admin permissions are granular and configurable.
 * Admins hold all of these implicitly; the flags only ever narrow a sub-admin.
 */
const permissionsSchema = new Schema(
  {
    createQuestions: { type: Boolean, default: true },
    publishQuestions: { type: Boolean, default: false },
    manageStudents: { type: Boolean, default: false },
    manageTopics: { type: Boolean, default: false },
    manageContests: { type: Boolean, default: false },
    viewAnalytics: { type: Boolean, default: true },
    manageSettings: { type: Boolean, default: false },
  },
  { _id: false },
);

const spaceMemberSchema = new Schema(
  {
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: Object.values(SPACE_ROLE), default: SPACE_ROLE.STUDENT },
    permissions: { type: permissionsSchema, default: () => ({}) },
    batchId: { type: Schema.Types.ObjectId, ref: 'Batch', default: null },

    status: {
      type: String,
      enum: ['pending', 'active', 'suspended', 'left'],
      default: 'pending',
    },

    /** Institute-side identity — roll number, section. Never shown publicly. */
    externalId: { type: String, trim: true },

    invitedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    joinedAt: { type: Date, default: Date.now },
    approvedAt: { type: Date },
    leftAt: { type: Date },
  },
  { timestamps: true },
);

spaceMemberSchema.index({ spaceId: 1, userId: 1 }, { unique: true });
spaceMemberSchema.index({ userId: 1 });
spaceMemberSchema.index({ spaceId: 1, status: 1 });
spaceMemberSchema.index({ spaceId: 1, batchId: 1, status: 1 });

export const SpaceMember = mongoose.model('SpaceMember', spaceMemberSchema);

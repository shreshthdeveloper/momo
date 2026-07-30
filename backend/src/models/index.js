import mongoose from 'mongoose';
import { PUBLIC_SPACE_ID } from '../shared/constants.js';

export { User } from './User.js';
export { Space } from './Space.js';
export { SpaceMember } from './SpaceMember.js';
export { Category } from './Category.js';
export { Topic } from './Topic.js';
export { Question } from './Question.js';
export { Rating } from './Rating.js';
export { Match } from './Match.js';
export { Replay } from './Replay.js';
export { Friendship, Challenge } from './social.js';
export {
  Contest,
  ContestEntry,
  Assignment,
  AssignmentProgress,
  Tournament,
  ClassSession,
} from './learning.js';
export { OtpRequest, RefreshToken, Batch, Report, AuditLog, Notification } from './ops.js';
export { LeaderboardSnapshot } from './LeaderboardSnapshot.js';
export { Cosmetic, ProgressionConfig, Chest, ChestGrant } from './progression.js';

import { Space } from './Space.js';

export const publicSpaceId = new mongoose.Types.ObjectId(PUBLIC_SPACE_ID);

export const isPublicSpace = (id) => String(id) === PUBLIC_SPACE_ID;

/**
 * The Public Arena is a real Space document with a fixed id, not a null
 * sentinel. Idempotent — safe to call on every boot.
 */
export async function ensurePublicSpace() {
  const existing = await Space.findById(publicSpaceId);
  if (existing) return existing;
  return Space.create({
    _id: publicSpaceId,
    name: 'Public Arena',
    slug: 'public',
    isPublic: true,
    joinMode: 'open',
    status: 'active',
    plan: { tier: 'institution', seatLimit: Number.MAX_SAFE_INTEGER, status: 'active' },
    settings: { allowPublicProfiles: true, allowGhosts: true },
  });
}

import mongoose from 'mongoose';
import { Notification, User } from '../models/index.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { istClockTime, isWithinQuietHours } from '../lib/dates.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Notifications (prd.md §6.9).
 *
 * Two gates before anything is pushed: the user's per-category toggle
 * (F6.9.1) and their quiet hours (F6.9.2, default 22:00–08:00 IST). A blocked
 * notification is still written to the in-app list — the user can read it when
 * they open the app, they simply are not woken up for it.
 */

export async function notify(userId, { type, prefKey, title, body, data, spaceId, force = false }) {
  const user = await User.findById(oid(userId), {
    notificationPrefs: 1,
    pushTokens: 1,
    status: 1,
  }).lean();
  if (!user || user.status !== 'active') return null;

  const record = await Notification.create({
    userId: oid(userId),
    type,
    title,
    body,
    data,
    spaceId: spaceId ? oid(spaceId) : undefined,
  });

  const allowed = force || shouldPush(user, prefKey);
  if (!allowed) return record;

  const sent = await sendPush(user, { title, body, data: { ...data, type } });
  if (sent) await Notification.updateOne({ _id: record._id }, { $set: { pushedAt: new Date() } });
  return record;
}

export function shouldPush(user, prefKey) {
  const prefs = user.notificationPrefs ?? {};
  if (prefKey && prefs[prefKey] === false) return false;

  const quiet = prefs.quietHours;
  if (quiet?.enabled && isWithinQuietHours(istClockTime(), quiet.start, quiet.end)) return false;

  return Boolean(user.pushTokens?.length);
}

/**
 * FCM handles both platforms (tech.md §1). Without a server key configured the
 * call is logged and skipped rather than throwing — a missing push credential
 * must never break the action that triggered the notification.
 */
async function sendPush(user, payload) {
  if (!env.FCM_SERVER_KEY) {
    logger.debug({ userId: String(user._id), payload }, 'push skipped (no FCM key)');
    return false;
  }
  const tokens = (user.pushTokens ?? []).map((t) => t.token).filter(Boolean);
  if (!tokens.length) return false;

  try {
    const res = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        authorization: `key=${env.FCM_SERVER_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        registration_ids: tokens,
        notification: { title: payload.title, body: payload.body },
        data: payload.data,
        android: { priority: 'high' },
      }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'FCM rejected the push');
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err }, 'push send failed');
    return false;
  }
}

export async function listNotifications(userId, { limit = 30, unreadOnly = false } = {}) {
  const filter = { userId: oid(userId) };
  if (unreadOnly) filter.readAt = null;
  const rows = await Notification.find(filter).sort({ createdAt: -1 }).limit(Math.min(limit, 50)).lean();
  return rows.map((n) => ({
    id: String(n._id),
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data,
    read: Boolean(n.readAt),
    at: n.createdAt,
  }));
}

export async function markRead(userId, ids) {
  const filter = { userId: oid(userId), readAt: null };
  if (ids?.length) filter._id = { $in: ids.map(oid) };
  const result = await Notification.updateMany(filter, { $set: { readAt: new Date() } });
  return { marked: result.modifiedCount };
}

export async function unreadCount(userId) {
  return Notification.countDocuments({ userId: oid(userId), readAt: null });
}

export async function registerPushToken(user, { token, platform }) {
  if (!token) return;
  // Same device re-registering must update, not accumulate — stale tokens are
  // the usual reason push delivery quietly degrades.
  await User.updateOne({ _id: user._id }, { $pull: { pushTokens: { token } } });
  await User.updateOne(
    { _id: user._id },
    { $push: { pushTokens: { token, platform, updatedAt: new Date() } } },
  );
}

export async function removePushToken(user, token) {
  await User.updateOne({ _id: user._id }, { $pull: { pushTokens: { token } } });
}

import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { User, RefreshToken, OtpRequest } from '../models/index.js';
import { env } from '../config/env.js';
import {
  hashSecret,
  verifySecret,
  hashToken,
  randomToken,
  randomOtp,
} from '../lib/crypto.js';
import {
  BadRequestError,
  UnauthorizedError,
  TooManyRequestsError,
  ForbiddenError,
} from '../lib/errors.js';
import { sendSms, otpMessage } from './smsProvider.js';
import { logger } from '../lib/logger.js';
import { syncMembershipDenormalisation } from './spaceService.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_SENDS_PER_HOUR = 3;

/**
 * Normalise an Indian mobile number to E.164.
 * Accepts `9876543210`, `09876543210`, `+91 98765 43210`, `919876543210`.
 */
export function normalisePhone(input) {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (!digits) throw new BadRequestError('Enter your mobile number.', 'BAD_PHONE');

  let local = digits;
  if (local.startsWith('91') && local.length === 12) local = local.slice(2);
  else if (local.startsWith('0') && local.length === 11) local = local.slice(1);

  if (!/^[6-9]\d{9}$/.test(local)) {
    throw new BadRequestError('That does not look like an Indian mobile number.', 'BAD_PHONE');
  }
  return `+91${local}`;
}

// ── OTP ────────────────────────────────────────────────────────────────────

/** tech.md §5 — 6 digits, 5 minutes, single use, 3 sends per number per hour. */
export async function sendOtp(rawPhone, { ip } = {}) {
  const phone = normalisePhone(rawPhone);

  const recentSends = await OtpRequest.countDocuments({
    phone,
    createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) },
  });
  if (recentSends >= OTP_MAX_SENDS_PER_HOUR) {
    throw new TooManyRequestsError('Too many codes requested. Try again in an hour.', 'OTP_THROTTLED');
  }

  const user = await User.findOne({ phone }, { status: 1 }).lean();
  if (user?.status === 'suspended') {
    throw new ForbiddenError('This account is suspended. Contact support.', 'ACCOUNT_SUSPENDED');
  }

  const code = randomOtp();
  await OtpRequest.create({
    phone,
    codeHash: hashSecret(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
    ip,
  });

  await sendSms({ to: phone, message: otpMessage(code) });

  return {
    phone,
    expiresInMs: OTP_TTL_MS,
    // Never returned outside development — this exists so the app can be run
    // end to end locally without an SMS account.
    devCode: env.isDev || env.isTest ? code : undefined,
  };
}

export async function verifyOtp(rawPhone, code, context = {}) {
  const phone = normalisePhone(rawPhone);
  const submitted = String(code ?? '').trim();

  // Development-only master code. Ignored entirely outside development, so a
  // production build cannot be talked into accepting it.
  const masterAccepted =
    (env.isDev || env.isTest) && submitted && submitted === env.DEV_MASTER_OTP;

  if (!masterAccepted) {
    const request = await OtpRequest.findOne({
      phone,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!request) {
      throw new BadRequestError('That code has expired. Request a new one.', 'OTP_EXPIRED');
    }
    if (request.attempts >= OTP_MAX_ATTEMPTS) {
      throw new TooManyRequestsError('Too many wrong attempts. Request a new code.', 'OTP_LOCKED');
    }

    if (!verifySecret(submitted, request.codeHash)) {
      request.attempts += 1;
      await request.save();
      throw new BadRequestError('That code is not right.', 'OTP_INVALID', {
        attemptsLeft: Math.max(0, OTP_MAX_ATTEMPTS - request.attempts),
      });
    }

    request.consumedAt = new Date();
    await request.save();
  }

  const { user, isNew } = await findOrCreateByPhone(phone);
  const tokens = await issueTokens(user, context);
  return { user, tokens, isNew, needsProfile: !user.displayName };
}

async function findOrCreateByPhone(phone) {
  const existing = await User.findOne({ phone });
  if (existing) {
    if (existing.status === 'suspended') {
      throw new ForbiddenError('This account is suspended. Contact support.', 'ACCOUNT_SUSPENDED');
    }
    // Signing in cancels a pending deletion — a returning user did not mean it.
    if (existing.deletionRequestedAt) {
      existing.deletionRequestedAt = null;
      existing.status = 'active';
    }
    existing.lastActiveAt = new Date();
    await existing.save();
    return { user: existing, isNew: false };
  }

  const user = await User.create({
    phone,
    role: env.SUPERADMIN_PHONES.includes(phone) ? 'superadmin' : 'player',
    lastActiveAt: new Date(),
  });
  return { user, isNew: true };
}

// ── Tokens ─────────────────────────────────────────────────────────────────

/**
 * tech.md §5 — access token claims deliberately exclude space memberships.
 * They change, and a stale claim is a tenant leak waiting to happen, so they
 * are checked live on every request instead.
 */
export function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role },
    env.JWT_SECRET,
    { expiresIn: env.ACCESS_TOKEN_TTL, issuer: 'mimo' },
  );
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET, { issuer: 'mimo' });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new UnauthorizedError('Your session expired.', 'TOKEN_EXPIRED');
    }
    throw new UnauthorizedError('Sign in to continue.', 'UNAUTHENTICATED');
  }
}

export async function issueTokens(user, context = {}, familyId = null) {
  const accessToken = signAccessToken(user);
  const refreshToken = randomToken(32);
  const family = familyId ?? randomToken(16);

  await RefreshToken.create({
    userId: user._id,
    tokenHash: hashToken(refreshToken),
    familyId: family,
    userAgent: context.userAgent,
    ip: context.ip,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: env.ACCESS_TOKEN_TTL,
    tokenType: 'Bearer',
  };
}

/**
 * Rotation with reuse detection (tech.md §5).
 *
 * Presenting a token that has already been rotated means either a replay or a
 * stolen token — either way the whole family is revoked and the user
 * re-authenticates. Tolerating it would make theft undetectable.
 */
export async function refreshTokens(presented, context = {}) {
  if (!presented) throw new UnauthorizedError('Sign in to continue.');

  const record = await RefreshToken.findOne({ tokenHash: hashToken(presented) });
  if (!record) throw new UnauthorizedError('Sign in again.', 'REFRESH_INVALID');

  if (record.revokedAt || record.replacedBy) {
    await RefreshToken.updateMany(
      { familyId: record.familyId, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'reuse_detected' } },
    );
    logger.warn({ userId: String(record.userId), familyId: record.familyId }, 'refresh token reuse detected');
    throw new UnauthorizedError('Sign in again.', 'REFRESH_REUSED');
  }

  if (record.expiresAt < new Date()) {
    throw new UnauthorizedError('Sign in again.', 'REFRESH_EXPIRED');
  }

  const user = await User.findById(record.userId);
  if (!user || user.status !== 'active') {
    throw new UnauthorizedError('Sign in again.', 'ACCOUNT_UNAVAILABLE');
  }

  const tokens = await issueTokens(user, context, record.familyId);
  record.replacedBy = hashToken(tokens.refreshToken);
  record.revokedAt = new Date();
  record.revokedReason = 'rotated';
  await record.save();

  return { user, tokens };
}

export async function revokeRefreshFamily(presented) {
  if (!presented) return;
  const record = await RefreshToken.findOne({ tokenHash: hashToken(presented) });
  if (!record) return;
  await RefreshToken.updateMany(
    { familyId: record.familyId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'logout' } },
  );
}

export async function revokeAllSessions(userId) {
  await RefreshToken.updateMany(
    { userId: oid(userId), revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'all_sessions_revoked' } },
  );
}

/** Loads the user behind a verified token, refusing suspended accounts. */
export async function loadAuthenticatedUser(claims) {
  const user = await User.findById(oid(claims.sub));
  if (!user) throw new UnauthorizedError('Sign in to continue.');
  if (user.status === 'suspended') {
    throw new ForbiddenError('This account is suspended. Contact support.', 'ACCOUNT_SUSPENDED');
  }
  if (user.status === 'deleted') throw new UnauthorizedError('This account no longer exists.');
  return user;
}

/** Refreshes the denormalised membership array after any membership change. */
export const refreshMemberships = syncMembershipDenormalisation;

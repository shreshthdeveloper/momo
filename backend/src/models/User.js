import mongoose from 'mongoose';
import { ELO_START, RANKED_START } from '../shared/constants.js';
import { accountProgress, effectiveAccountLevel } from '../shared/mastery.js';
import { leagueFor } from '../shared/league.js';
import { activeAccountCurve, activeLadder } from '../lib/progressionCache.js';

/**
 * The level this account is shown at, under the curve currently in force.
 *
 * Derived rather than stored — XP is the only number that has to be right —
 * but read through the configured table rather than the shipped one, and
 * floored so a curve edit can never take a level away.
 */
function levelOf(user) {
  return effectiveAccountLevel(user.totalXp, user.accountLevelFloor, activeAccountCurve());
}

const { Schema } = mongoose;

/** prd.md §6.9 — every category individually toggleable. */
const notificationPrefsSchema = new Schema(
  {
    friendChallenge: { type: Boolean, default: true },
    friendAccepted: { type: Boolean, default: true },
    /**
     * Its own toggle rather than sharing `friendChallenge`. A challenge is an
     * invitation with a two-minute clock on it — missing one costs something —
     * and a reaction is somebody saying "GG". Anybody who wants the first and
     * not the second needs a switch that separates them, and lumping the
     * chattier of the two under the more urgent one is how people end up
     * silencing both.
     */
    friendReaction: { type: Boolean, default: true },
    rankPassed: { type: Boolean, default: true },
    streakAtRisk: { type: Boolean, default: true },
    contestNew: { type: Boolean, default: true },
    contestStarting: { type: Boolean, default: true },
    assignmentDue: { type: Boolean, default: true },
    weeklySummary: { type: Boolean, default: false },
    reengagement: { type: Boolean, default: true },
    quietHours: {
      enabled: { type: Boolean, default: true },
      start: { type: String, default: '22:00' },
      end: { type: String, default: '08:00' },
    },
  },
  { _id: false },
);

const privacyPrefsSchema = new Schema(
  {
    profileVisibility: { type: String, enum: ['public', 'friends', 'private'], default: 'public' },
    contactDiscovery: { type: Boolean, default: true },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    passwordHash: { type: String, select: false },
    googleId: { type: String },
    appleId: { type: String },

    displayName: { type: String, trim: true, minlength: 2, maxlength: 24 },
    displayNameLower: { type: String },
    avatarUrl: { type: String },
    /** The profile banner — a preset name carried as `mimo:banner/<name>`. */
    banner: { type: String, maxlength: 500 },
    /** ISO-3166 alpha-2, uppercased. Drives the flag shown beside the name. */
    country: { type: String, uppercase: true, trim: true, minlength: 2, maxlength: 2 },
    city: { type: String, trim: true, maxlength: 60 },
    dateOfBirth: { type: Date },
    /** Derived from dateOfBirth on save. Drives privacy defaults, not features. */
    isMinor: { type: Boolean, default: false },

    role: { type: String, enum: ['player', 'superadmin'], default: 'player', index: true },
    status: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active' },
    suspendedReason: { type: String },

    deviceId: { type: String },

    overallRating: { type: Number, default: ELO_START },
    totalXp: { type: Number, default: 0 },
    matchesPlayed: { type: Number, default: 0 },
    matchesWon: { type: Number, default: 0 },

    /**
     * The global ladder (leagues-and-progression.md §2). One Elo per player
     * rather than per topic, so a ranked loss always costs something — the
     * per-topic figure cannot do that job, being the mean of the five best.
     *
     * The league is NOT stored: it is a band of this number (shared/league.js),
     * so there is no second piece of state to drift out of sync with it.
     */
    rankedRating: { type: Number, default: RANKED_START },
    rankedMatches: { type: Number, default: 0 },

    /** The equipped title's perk key, e.g. `quick-draw`. Empty until earned. */
    title: { type: String, maxlength: 40 },

    /**
     * The coin balance (coins-and-cosmetics.md §3).
     *
     * One number, written only by the server, with **no ledger behind it** — no
     * transaction history, no refunds, no "where did it go" screen. That was a
     * deliberate call: a history is a second source of truth that has to agree
     * with the balance forever, and nothing in the product needs one.
     *
     * Earned only. There is no real-money purchase and no hook for one.
     */
    coins: { type: Number, default: 0, min: 0 },

    /**
     * Perk keys this account owns.
     *
     * This used to be a migration footnote — ownership was derived from the
     * account level and nothing was written down. The shop changed that: a
     * purchase and a chest drop cannot be recomputed from XP, so this became
     * the record of what a player owns (coins-and-cosmetics.md §2).
     *
     * Append-only, for the same reason XP never falls: a thing bought must
     * never become un-bought. It still carries the grandfathered keys of people
     * who were wearing something before the rules moved underneath them.
     */
    grantedPerks: { type: [String], default: [] },

    /**
     * The account level this player has already been seen at.
     *
     * The XP curve is superadmin-editable, and a steeper curve would otherwise
     * recompute somebody down a level for doing nothing wrong. Stamped with
     * the level they held under the outgoing curve whenever the table is
     * saved, so the displayed level can rise on an edit but never fall.
     */
    accountLevelFloor: { type: Number, default: 1 },

    streak: {
      current: { type: Number, default: 0 },
      longest: { type: Number, default: 0 },
      /** Stored as YYYY-MM-DD in IST so a streak means a calendar day, not 24h. */
      lastPlayedOn: { type: String, default: null },
    },

    interests: [{ type: Schema.Types.ObjectId, ref: 'Topic' }],
    /** Denormalised from spaceMembers for fast auth checks. Never trusted alone. */
    spaceMemberships: [{ type: Schema.Types.ObjectId, ref: 'Space' }],

    achievements: [
      {
        _id: false,
        key: String,
        earnedAt: { type: Date, default: Date.now },
      },
    ],

    pushTokens: [
      {
        _id: false,
        token: String,
        platform: { type: String, enum: ['ios', 'android', 'web'] },
        updatedAt: { type: Date, default: Date.now },
      },
    ],

    notificationPrefs: { type: notificationPrefsSchema, default: () => ({}) },
    privacy: { type: privacyPrefsSchema, default: () => ({}) },
    locale: { type: String, default: 'en' },

    blockedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],

    /** Anti-cheat accumulator (tech.md §9.6). Swept daily into moderation. */
    cheatFlags: { type: Number, default: 0 },

    lastActiveAt: { type: Date, default: Date.now },
    /** prd.md F6.1.6 — 30-day grace before the purge job runs. */
    deletionRequestedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.index({ phone: 1 }, { unique: true, sparse: true });
userSchema.index({ email: 1 }, { unique: true, sparse: true });
userSchema.index({ displayNameLower: 1 }, { unique: true, sparse: true });
userSchema.index({ lastActiveAt: -1 });
userSchema.index({ deletionRequestedAt: 1 }, { sparse: true });
userSchema.index({ googleId: 1 }, { unique: true, sparse: true });
userSchema.index({ appleId: 1 }, { unique: true, sparse: true });

userSchema.pre('save', function normaliseDerived(next) {
  if (this.isModified('displayName') && this.displayName) {
    this.displayNameLower = this.displayName.toLowerCase();
  }
  if (this.isModified('dateOfBirth') && this.dateOfBirth) {
    const ageMs = Date.now() - this.dateOfBirth.getTime();
    this.isMinor = ageMs < 18 * 365.25 * 24 * 60 * 60 * 1000;
    // prd.md §13 — minors are excluded from contact discovery by default.
    if (this.isMinor) this.privacy.contactDiscovery = false;
  }
  next();
});

/** What another player is allowed to see. Never send the raw document. */
userSchema.methods.toPublicProfile = function toPublicProfile() {
  return {
    id: String(this._id),
    displayName: this.displayName,
    avatarUrl: this.avatarUrl,
    banner: this.banner,
    country: this.country,
    city: this.privacy?.profileVisibility === 'public' ? this.city : undefined,
    overallRating: this.overallRating,
    /** The ladder and the level are public — they are what a versus screen shows. */
    rankedRating: this.rankedRating,
    title: this.title,
    accountLevel: levelOf(this),
    matchesPlayed: this.matchesPlayed,
    achievements: this.achievements?.map((a) => a.key) ?? [],
    isMinor: this.isMinor,
  };
};

/** What the account owner sees about themselves. */
userSchema.methods.toPrivateProfile = function toPrivateProfile() {
  return {
    id: String(this._id),
    phone: this.phone,
    email: this.email,
    displayName: this.displayName,
    avatarUrl: this.avatarUrl,
    banner: this.banner,
    country: this.country,
    city: this.city,
    dateOfBirth: this.dateOfBirth,
    isMinor: this.isMinor,
    role: this.role,
    status: this.status,
    overallRating: this.overallRating,
    rankedRating: this.rankedRating,
    title: this.title,
    /** Derived, never stored — XP is the only thing that has to be right. */
    accountLevel: levelOf(this),
    /**
     * The bar under the level, computed HERE.
     *
     * The rule is one-way — the server computes, the client displays — and
     * Home was breaking it: it derived the same bar from `totalXp` against
     * whatever curve its cache happened to hold, so a client a version behind
     * showed a different "X XP to level N" on Home than the profile showed on
     * the next tab, off the same account.
     */
    accountProgress: accountProgress(this.totalXp, activeAccountCurve(), this.accountLevelFloor),
    /** Likewise the badge: the ladder is editable, so its name is not derivable. */
    league: leagueFor(this.rankedRating ?? RANKED_START, activeLadder()),
    coins: this.coins ?? 0,
    grantedPerks: this.grantedPerks ?? [],
    totalXp: this.totalXp,
    matchesPlayed: this.matchesPlayed,
    matchesWon: this.matchesWon,
    streak: this.streak,
    interests: this.interests?.map(String) ?? [],
    spaceMemberships: this.spaceMemberships?.map(String) ?? [],
    achievements: this.achievements ?? [],
    notificationPrefs: this.notificationPrefs,
    privacy: this.privacy,
    locale: this.locale,
    deletionRequestedAt: this.deletionRequestedAt,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model('User', userSchema);

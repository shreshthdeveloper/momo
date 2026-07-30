import mongoose from 'mongoose';
import { Batch, Match, SpaceMember } from '../models/index.js';
import { periodRange } from '../lib/dates.js';
import { isUnrecordedMode } from '../shared/constants.js';

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Class against class (prd.md F8.6.4 gave admins the report; this is the game).
 *
 * Batches already scope contests and leaderboards, but they were only ever
 * something done TO a student — a bucket an admin put them in. This is the thing
 * that makes a batch worth belonging to: your class has a standing, and every
 * match you play moves it.
 *
 * ── The metric, which is the entire design ──────────────────────────────────
 *
 * The obvious ranking is total points, and it is wrong: a class of forty beats a
 * class of twelve before anybody plays, so eleven of the twelve stop caring on day
 * one. The next idea is average per student who played, which is worse in a subtler
 * way — a class where three keen students play and thirty-seven do not would top
 * the table, so the metric would actively reward a small clique and punish a class
 * that got everybody involved.
 *
 * So it is **points per student on roll**: the class's total, divided by its active
 * membership whether they played or not. Size-neutral, and it gives a class two
 * honest ways to climb — play more, or play better — which are the two things a
 * teacher would want to be able to say out loud.
 *
 * `participation` is reported beside it rather than folded in, because a class that
 * is behind deserves to see WHY. "We are third because half of us have not played"
 * is a fixable problem; a single mystery number is not.
 *
 * ── Weekly ───────────────────────────────────────────────────────────────────
 *
 * The default window is the week. A table that never resets is one a class can fall
 * permanently behind on, and the whole value of this is that everybody starts
 * Monday level.
 */

/**
 * Modes that count toward a class's standing.
 *
 * Practice and self-races are excluded by `UNRECORDED_MODES` for the same reason
 * they are excluded from the personal record: both can be run repeatedly against
 * nobody, and a class table is exactly the kind of thing a competitive student
 * would grind. Contests are excluded separately — they have their own standings,
 * and a class that happened to be assigned an easy paper should not climb for it.
 */
const COUNTED = (mode) => !isUnrecordedMode(mode) && mode !== 'contest';

export async function classTable(scope, { period = 'week', viewerId = null } = {}) {
  const { start, end } = periodRange(period);

  const [batches, members] = await Promise.all([
    Batch.find({ spaceId: scope.spaceId }, { name: 1 }).lean(),
    SpaceMember.find(
      { spaceId: scope.spaceId, status: 'active', batchId: { $ne: null } },
      { userId: 1, batchId: 1 },
    ).lean(),
  ]);

  if (!batches.length) return { period, rows: [], you: null };

  /** userId → batchId, so one pass over the matches can attribute every score. */
  const batchOf = new Map(members.map((m) => [String(m.userId), String(m.batchId)]));
  const roll = new Map();
  for (const m of members) {
    const key = String(m.batchId);
    roll.set(key, (roll.get(key) ?? 0) + 1);
  }

  const rows = await Match.aggregate([
    {
      $match: {
        spaceId: oid(scope.spaceId),
        status: { $in: ['complete', 'abandoned'] },
        isVoid: { $ne: true },
        completedAt: { $gte: start, $lt: end },
      },
    },
    { $unwind: '$players' },
    // A ghost has no account and belongs to no class.
    { $match: { 'players.isGhost': { $ne: true } } },
    {
      $group: {
        _id: { user: '$players.userId', mode: '$mode' },
        points: { $sum: '$players.score' },
        matches: { $sum: 1 },
      },
    },
  ]);

  const tally = new Map();
  const played = new Map();
  for (const row of rows) {
    if (!COUNTED(row._id.mode)) continue;
    const userKey = String(row._id.user);
    const batchId = batchOf.get(userKey);
    if (!batchId) continue; // Not in a class, so not in the table.

    const acc = tally.get(batchId) ?? { points: 0, matches: 0 };
    acc.points += row.points ?? 0;
    acc.matches += row.matches ?? 0;
    tally.set(batchId, acc);

    // A Set per batch, because "how many students played" must count people, not
    // rows — one student with nine matches is one participant.
    if (!played.has(batchId)) played.set(batchId, new Set());
    played.get(batchId).add(userKey);
  }

  const table = batches
    .map((batch) => {
      const key = String(batch._id);
      const acc = tally.get(key) ?? { points: 0, matches: 0 };
      const students = roll.get(key) ?? 0;
      const active = played.get(key)?.size ?? 0;
      return {
        batchId: key,
        name: batch.name,
        students,
        played: active,
        matches: acc.matches,
        points: acc.points,
        /** The ranking figure — see the note at the top of this file. */
        perStudent: students ? Number((acc.points / students).toFixed(1)) : 0,
        participation: students ? Math.round((active / students) * 100) : 0,
      };
    })
    /**
     * A class with nobody on the roll is a batch an admin created and never
     * filled. Ranking it last with a zero would put empty rows between real
     * classes; it simply is not in the competition yet.
     */
    .filter((row) => row.students > 0)
    .sort((a, b) => b.perStudent - a.perStudent || b.points - a.points || a.name.localeCompare(b.name));

  table.forEach((row, i) => {
    row.rank = i + 1;
  });

  /**
   * The viewer's own class, pinned — the same rule as every other board in the
   * product (F6.6.4). Without it a student in the sixth of eight classes has to
   * hunt for the only row they care about.
   */
  const myBatchId = viewerId ? batchOf.get(String(viewerId)) : null;
  const you = myBatchId ? (table.find((row) => row.batchId === myBatchId) ?? null) : null;

  return { period, rows: table, you };
}

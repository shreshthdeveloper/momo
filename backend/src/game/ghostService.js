import mongoose from 'mongoose';
import { Replay, Topic } from '../models/index.js';
import { ratingBandOf } from '../shared/elo.js';
import {
  ROUNDS_PER_MATCH,
  LEVEL_BAND_MAX,
  RANKED_START,
  RANKED_FLOOR,
} from '../shared/constants.js';
import { pickRandom } from '../lib/crypto.js';

/**
 * Ghost opponents (prd.md §6.7, tech.md §9.5).
 *
 * This is a launch requirement, not an optimisation. At low concurrency a live
 * opponent for a given topic, at a given skill, at a given hour frequently
 * does not exist — and prd.md is explicit that the player must never see an
 * empty lobby. So after 3 seconds we serve a replay of a real past game, and
 * where no replay exists yet, a synthetic opponent drawn from the topic's own
 * statistics.
 *
 * The player is never told which they received (F6.7.5).
 */

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Find a stored game from a player at a similar level on this topic.
 *
 * Level first, for the same reason live pairing uses it: the versus screen
 * shows the opponent's topic level whether they are live or replayed, so a
 * ghost chosen on rating could contradict the even-match promise in the one
 * place the player can see it. Replays written before `playerLevel` existed
 * have none, and those fall back to the rating band they were stored with.
 *
 * Sorted by `usedCount` ascending so replay usage spreads rather than serving
 * the same opponent over and over.
 */
export async function findReplay({
  topicId,
  spaceId,
  rating,
  level,
  excludeUserId,
  bandWidth = 1,
  contestId = null,
}) {
  const band = ratingBandOf(rating);
  const lvl = Number.isFinite(level) ? level : null;

  const search = async (width) =>
    Replay.findOne({
      topicId: oid(topicId),
      spaceId: oid(spaceId),
      ...(lvl === null
        ? { ratingBand: { $gte: band - width, $lte: band + width } }
        : {
            $or: [
              { playerLevel: { $gte: lvl - width, $lte: lvl + width } },
              // Pre-level replays are still perfectly good opponents; they are
              // simply matched the old way rather than excluded forever.
              {
                playerLevel: { $in: [null, undefined] },
                ratingBand: { $gte: band - width, $lte: band + width },
              },
            ],
          }),
      /**
       * Always filtered, both ways. Ordinary play must not draw a contest
       * replay — that would deal out the contest's frozen paper to someone who
       * never entered — and a contest entrant must draw only from its own
       * entrants, because only they answered these questions.
       */
      contestId: contestId ? oid(contestId) : null,
      ...(excludeUserId ? { userId: { $ne: oid(excludeUserId) } } : {}),
    })
      .sort({ usedCount: 1, createdAt: -1 })
      .lean();

  /**
   * Widen twice before giving up — a mismatched ghost is still a far better
   * experience than no opponent. On the level path the last step stops at
   * LEVEL_BAND_MAX, the same cap live pairing refuses to cross: a ghost is
   * allowed to be the easier match to find, not a wider one than a human.
   */
  const last = lvl === null ? 6 : LEVEL_BAND_MAX;
  return (await search(bandWidth)) ?? (await search(bandWidth + 2)) ?? (await search(last));
}

export async function markReplayUsed(replayId) {
  await Replay.updateOne({ _id: oid(replayId) }, { $inc: { usedCount: 1 } }).catch(() => {});
}

/**
 * prd.md F6.7.4 — where no replay exists, generate an opponent from the
 * topic's aggregate accuracy and response-time distribution. Noticeably better
 * than a fixed bot, and it seeds real replays within a day of a topic going
 * live, after which this path stops being used.
 */
const SYNTHETIC_NAMES = [
  'Aarav', 'Diya', 'Vihaan', 'Ananya', 'Arjun', 'Ishita', 'Kabir', 'Meera',
  'Rohan', 'Saanvi', 'Aditya', 'Nisha', 'Karan', 'Tara', 'Devansh', 'Riya',
  'Yash', 'Zoya', 'Nikhil', 'Aisha', 'Manav', 'Kavya', 'Rehan', 'Sneha',
];

/**
 * Where a synthetic opponent is from.
 *
 * There is no real person here, so this is invented exactly as the name, the
 * avatar, the level and the rating already are. It still has to be invented
 * carefully: the versus screen prints a flag and a place under both names, and
 * a blank one on the opponent's half is a reliable way to spot a ghost, which
 * F6.7.5 forbids.
 *
 * Mostly the player's own country, because that is where a live opponent
 * usually is, with a real spread behind it so it never becomes a tell of its
 * own. A ghost with no country to borrow falls back to the list.
 */
const SYNTHETIC_COUNTRIES = ['IN', 'US', 'GB', 'BR', 'ID', 'NG', 'PH', 'DE', 'MX', 'ZA'];

function syntheticCountry(playerCountry) {
  if (playerCountry && Math.random() < 0.55) return playerCountry;
  return pickRandom(SYNTHETIC_COUNTRIES);
}

export async function buildSyntheticOpponent({
  topicId,
  rating,
  level = 1,
  rankedRating = RANKED_START,
  country = null,
  roundDurationMs,
  rounds = ROUNDS_PER_MATCH,
}) {
  const topic = await Topic.findById(oid(topicId), { stats: 1, name: 1 }).lean();

  // Fall back to plausible mid-table numbers for a topic with no history yet.
  const baseAccuracy = clamp(topic?.stats?.avgAccuracy || 0.55, 0.25, 0.9);
  const baseResponseMs = clamp(
    topic?.stats?.avgResponseMs || roundDurationMs * 0.45,
    900,
    roundDurationMs - 500,
  );

  // Nudge toward the player's own band so the match feels contested rather
  // than trivially won or hopeless.
  const skillNudge = clamp((rating - 1200) / 4000, -0.12, 0.12);
  const accuracy = clamp(baseAccuracy + skillNudge, 0.2, 0.92);

  const script = [];
  for (let i = 0; i < rounds; i += 1) {
    const willAnswer = Math.random() < 0.94; // occasionally a human runs out of time
    if (!willAnswer) {
      script.push({ optionIndex: null, elapsedMs: null, isCorrect: false });
      continue;
    }
    const jitter = 0.55 + Math.random() * 0.9;
    const elapsedMs = Math.round(clamp(baseResponseMs * jitter, 800, roundDurationMs - 250));
    script.push({
      optionIndex: null, // resolved per-round against the real answer key
      elapsedMs,
      isCorrect: Math.random() < accuracy,
      synthetic: true,
    });
  }

  const suffix = 10 + Math.floor(Math.random() * 89);
  return {
    userId: new mongoose.Types.ObjectId(), // not a real account; never persisted as one
    displayName: `${pickRandom(SYNTHETIC_NAMES)}${suffix}`,
    avatarUrl: null,
    country: syntheticCountry(country),
    rating: Math.round(rating + (Math.random() * 120 - 60)),
    /**
     * F6.7.5 — the player is never told which opponent they got, and the
     * versus screen now prints a topic level for both sides. A blank or
     * distant level would give this away, so it sits within one level of the
     * player's, which is where live pairing would have put a human anyway.
     */
    level: Math.max(1, Math.round(level) + (Math.random() < 0.5 ? 0 : 1) - (Math.random() < 0.3 ? 1 : 0)),
    /**
     * Within a division of the player's own standing, so the versus badge is
     * a plausible neighbour rather than a tell. Never persisted — this account
     * does not exist and has no ladder of its own.
     */
    rankedRating: Math.max(
      RANKED_FLOOR,
      Math.round(rankedRating + (Math.random() * 100 - 50)),
    ),
    isGhost: true,
    isSynthetic: true,
    script,
  };
}

/**
 * A synthetic script says "answer correctly at 4.2s", not "pick option 2" —
 * because it has no memory of a real question. This resolves each entry
 * against the round definitions the match actually drew, turning intent into a
 * concrete canonical option index.
 */
export function bindSyntheticScript(script, rounds) {
  return script.map((entry, i) => {
    const round = rounds[i];
    if (!round || entry.elapsedMs === null) {
      return { optionIndex: null, elapsedMs: null, isCorrect: false };
    }
    const canonicalCorrect = round.canonicalCorrectIndex;
    if (entry.isCorrect) {
      return { optionIndex: canonicalCorrect, elapsedMs: entry.elapsedMs, isCorrect: true };
    }
    const wrong = round.optionOrder.filter((c) => c !== canonicalCorrect);
    return {
      optionIndex: pickRandom(wrong) ?? canonicalCorrect,
      elapsedMs: entry.elapsedMs,
      isCorrect: false,
    };
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

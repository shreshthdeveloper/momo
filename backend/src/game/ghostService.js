import mongoose from 'mongoose';
import { Replay, Topic } from '../models/index.js';
import { ratingBandOf } from '../shared/elo.js';
import {
  ROUNDS_PER_MATCH,
  LEVEL_BAND_MAX,
  RANKED_START,
  RANKED_FLOOR,
  AVATAR_TINT_COUNT,
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
/**
 * A player's own best recorded run on a topic — the target for a self-race.
 *
 * "Best" is the highest `finalScore`, which is the number the result screen showed
 * them and therefore the only one they would recognise as the thing to beat. Ties
 * break on the older run, so a personal best keeps its date rather than quietly
 * migrating to the most recent equal attempt.
 *
 * Contest replays are excluded. A contest paper is frozen and its questions are
 * not the topic's ordinary pool — re-dealing one outside the contest would hand
 * out a paper that may still be live for somebody else.
 */
export async function bestReplayFor(userId, topicId) {
  return Replay.findOne({
    userId: oid(userId),
    topicId: oid(topicId),
    contestId: null,
  })
    .sort({ finalScore: -1, createdAt: 1 })
    .lean();
}

/**
 * The best run on every topic a player has one for — the index the play screen
 * reads to know which topics can offer a race at all.
 *
 * One query with an in-memory group rather than a `$group` aggregation, because
 * the answer is per topic and a player has tens of replays, not thousands. Sorted
 * so the first sighting of a topic is its best.
 */
export async function bestReplaysFor(userId, { limit = 400 } = {}) {
  const rows = await Replay.find(
    { userId: oid(userId), contestId: null },
    { topicId: 1, finalScore: 1, createdAt: 1, matchId: 1 },
  )
    .sort({ finalScore: -1, createdAt: 1 })
    .limit(limit)
    .lean();

  const best = new Map();
  for (const row of rows) {
    const key = String(row.topicId);
    if (!best.has(key)) best.set(key, row);
  }
  return best;
}

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
/**
 * Names, BY COUNTRY — because the two are shown together.
 *
 * The versus screen prints a flag and a place under the opponent's name, and
 * the two used to be drawn from unrelated lists: twenty-four Indian first names
 * against ten countries, picked independently. So a player was regularly shown
 * "Saanvi41 · Nigeria" or "Devansh23 · Germany". A name that contradicts its own
 * flag is a far louder tell than the blank field this was built to avoid — a
 * blank reads as missing data, a mismatch reads as invented data.
 *
 * Keyed by country so the pair is always coherent. Every list is first names
 * only: a display name in this app is whatever the person typed, and most people
 * type one word.
 */
export const NAMES_BY_COUNTRY = {
  IN: ['Aarav', 'Diya', 'Vihaan', 'Ananya', 'Arjun', 'Ishita', 'Kabir', 'Meera',
       'Rohan', 'Saanvi', 'Aditya', 'Nisha', 'Karan', 'Tara', 'Devansh', 'Riya'],
  US: ['Ava', 'Liam', 'Mia', 'Noah', 'Zoe', 'Ethan', 'Chloe', 'Mason',
       'Layla', 'Caleb', 'Riley', 'Owen', 'Nora', 'Jaden', 'Skyler', 'Brooke'],
  GB: ['Olivia', 'Harry', 'Amelia', 'Oscar', 'Poppy', 'Alfie', 'Freya', 'Archie',
       'Ruby', 'Finlay', 'Esme', 'Reuben', 'Maisie', 'Callum', 'Elsie', 'Rory'],
  BR: ['Lucas', 'Julia', 'Gabriel', 'Beatriz', 'Matheus', 'Larissa', 'Rafael',
       'Camila', 'Thiago', 'Isabela', 'Bruno', 'Manuela', 'Felipe', 'Yasmin'],
  ID: ['Dwi', 'Putri', 'Agus', 'Siti', 'Bayu', 'Ayu', 'Rizki', 'Indah',
       'Fajar', 'Dewi', 'Yoga', 'Ratna', 'Eka', 'Wulan'],
  NG: ['Chidi', 'Amaka', 'Emeka', 'Ngozi', 'Tunde', 'Folake', 'Obinna',
       'Chioma', 'Segun', 'Adaeze', 'Kelechi', 'Yemi', 'Ifeanyi', 'Zainab'],
  PH: ['Jomar', 'Angel', 'Mark', 'Nicole', 'Paolo', 'Jasmine', 'Kian',
       'Althea', 'Rico', 'Mariel', 'Dexter', 'Shaira', 'Joshua', 'Kimberly'],
  DE: ['Lukas', 'Emma', 'Jonas', 'Mia', 'Felix', 'Hanna', 'Elias', 'Lina',
       'Paul', 'Marie', 'Niklas', 'Lea', 'Tim', 'Clara'],
  MX: ['Santiago', 'Valentina', 'Diego', 'Ximena', 'Mateo', 'Regina', 'Emiliano',
       'Renata', 'Leonardo', 'Fernanda', 'Sebastian', 'Daniela', 'Andres', 'Paola'],
  ZA: ['Thabo', 'Lerato', 'Sipho', 'Naledi', 'Bongani', 'Zanele', 'Themba',
       'Palesa', 'Kagiso', 'Nomsa', 'Tebogo', 'Refilwe', 'Andile', 'Ayanda'],
  CN: ['Wei', 'Xin', 'Hao', 'Yan', 'Jun', 'Ling', 'Feng', 'Mei',
       'Chen', 'Ying', 'Bo', 'Qing', 'Lei', 'Fang'],
  JP: ['Haruto', 'Sakura', 'Yuto', 'Hina', 'Sota', 'Yui', 'Riku', 'Aoi',
       'Kaito', 'Mio', 'Ren', 'Akari', 'Daiki', 'Rin'],
  KR: ['Minjun', 'Seoyeon', 'Jihoon', 'Hayoon', 'Doyoon', 'Jiwoo', 'Sungmin',
       'Yuna', 'Hyunwoo', 'Chaewon', 'Junseo', 'Eunseo'],
  VN: ['Minh', 'Linh', 'Tuan', 'Trang', 'Duc', 'Thao', 'Nam', 'Mai',
       'Hieu', 'Ngoc', 'Quan', 'Huong', 'Long', 'Yen'],
  EG: ['Omar', 'Nour', 'Youssef', 'Salma', 'Ahmed', 'Habiba', 'Mostafa',
       'Farida', 'Karim', 'Malak', 'Hassan', 'Jana'],
  TR: ['Yusuf', 'Zeynep', 'Mehmet', 'Elif', 'Emir', 'Defne', 'Mustafa',
       'Azra', 'Ali', 'Ecrin', 'Berat', 'Nisa'],
  FR: ['Louis', 'Jade', 'Gabriel', 'Louise', 'Raphael', 'Alice', 'Arthur',
       'Chloe', 'Hugo', 'Lina', 'Jules', 'Rose'],
  ES: ['Hugo', 'Lucia', 'Martin', 'Sofia', 'Pablo', 'Martina', 'Alvaro',
       'Maria', 'Adrian', 'Julia', 'Marco', 'Vega'],
  IT: ['Leonardo', 'Sofia', 'Francesco', 'Giulia', 'Alessandro', 'Aurora',
       'Lorenzo', 'Ginevra', 'Matteo', 'Beatrice', 'Tommaso', 'Emma'],
  RU: ['Artem', 'Sofia', 'Ivan', 'Anna', 'Dmitri', 'Maria', 'Nikita',
       'Alina', 'Egor', 'Polina', 'Roman', 'Vera'],
};

const SYNTHETIC_COUNTRIES = Object.keys(NAMES_BY_COUNTRY);

/**
 * Where a synthetic opponent is from.
 *
 * Mostly the player's own country, because that is where a live opponent
 * usually is, with a real spread behind it so it never becomes a tell of its
 * own. A ghost with no country to borrow falls back to the list.
 *
 * A country we have no names for is not usable: it would put us back to a name
 * that contradicts its flag. So the player's own country is only borrowed when
 * we can name somebody from it.
 */
function syntheticCountry(playerCountry) {
  const own = String(playerCountry ?? '').toUpperCase();
  if (NAMES_BY_COUNTRY[own] && Math.random() < 0.55) return own;
  return pickRandom(SYNTHETIC_COUNTRIES);
}

/**
 * A display name that does not announce itself as generated.
 *
 * Every synthetic opponent used to be `Name` + exactly two digits — Aarav23,
 * Meera41, Kabir77. One of those is fine. Three in a row is a pattern, and a
 * pattern is the tell: real display names in this app are whatever the person
 * typed at sign-up, and people do not all type a capitalised first name followed
 * by two digits.
 *
 * So the SHAPE varies as much as the name does. The weights lean toward the
 * plain and near-plain forms, which is what most real rosters look like, with
 * enough handles and separators mixed in that no single form dominates.
 */
const HANDLE_WORDS = [
  'shadow', 'pixel', 'turbo', 'nova', 'echo', 'frost', 'blaze', 'lunar',
  'cyber', 'storm', 'ghost', 'rapid', 'neon', 'iron', 'swift', 'zero',
];
const HANDLE_TAILS = [
  'fox', 'wolf', 'hawk', 'ninja', 'byte', 'racer', 'king', 'star',
  'bolt', 'ace', 'kid', 'boss', 'gamer', 'pro', 'x', 'hunter',
];

function displayNameFor(country) {
  const first = pickRandom(NAMES_BY_COUNTRY[country] ?? NAMES_BY_COUNTRY.IN);
  const roll = Math.random();

  // Bare first name — the commonest thing a real person types.
  if (roll < 0.34) return first;
  // A name with a couple of digits, the old shape, now only one form among six.
  if (roll < 0.52) return `${first}${10 + Math.floor(Math.random() * 89)}`;
  // A year, which is how a great many real handles end.
  if (roll < 0.64) return `${first}${2000 + Math.floor(Math.random() * 16)}`;
  // Lowercased with a separator.
  if (roll < 0.74) {
    const sep = Math.random() < 0.5 ? '_' : '.';
    return `${first.toLowerCase()}${sep}${pickRandom(HANDLE_TAILS)}`;
  }
  // A pure handle, no given name in it at all.
  if (roll < 0.9) {
    const handle = `${pickRandom(HANDLE_WORDS)}${pickRandom(HANDLE_TAILS)}`;
    return Math.random() < 0.4 ? `${handle}${Math.floor(Math.random() * 100)}` : handle;
  }
  // Name plus an initial, the way a class distinguishes two Emmas.
  const initial = String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return `${first} ${initial}.`;
}

/**
 * The face a ghost wears — and the reason a REPLAY needs one too.
 *
 * A replay is a real past game, and it used to be served under the real
 * player's name, avatar, id and city. F6.7.5 says the player must not be able
 * to tell a ghost from a live opponent, and snapshotting the identity looked
 * like the way to honour that: a replayed opponent had a name and a face
 * exactly as a live one does.
 *
 * It does the opposite in the place this product actually runs. A school has
 * five, ten, thirty members and they know each other. Playing "Garv" at
 * midnight when Garv is plainly not online does not read as a live opponent —
 * it reads as the app lying, and it also quietly discloses that Garv played
 * this topic and how well he did. The real account id was going out on the
 * wire with it.
 *
 * So a replay keeps its BEHAVIOUR — the timings and the answers of a real human
 * at this level, which is the entire reason replays beat synthetic scripts — and
 * borrows a synthetic identity for the presentation. Nothing that leaves the
 * server points at the person who played it; `Replay.userId` stays server-side
 * for `excludeUserId` and bookkeeping.
 */
export function syntheticIdentity({ country } = {}) {
  const where = syntheticCountry(country);
  return {
    // Not a real account, and deliberately not the replay's. The client is sent
    // this as the opponent id, so it has to resolve to nobody.
    userId: new mongoose.Types.ObjectId(),
    displayName: displayNameFor(where),
    /**
     * Sometimes a chosen tint, sometimes nothing.
     *
     * `null` is not a tell on its own — the client derives a tint from the name
     * for anybody without an avatar, and a brand-new real account has none
     * either. But a ghost that NEVER has one becomes a soft signal once players
     * start equipping cosmetics, so a share of them carry a preset. The tints
     * are the free set every account already owns, so this claims nothing the
     * account would have had to buy.
     */
    avatarUrl:
      Math.random() < 0.45 ? `mimo:tint/${Math.floor(Math.random() * AVATAR_TINT_COUNT)}` : null,
    country: where,
  };
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

  return {
    /**
     * The same identity helper the replay path uses, rather than a second
     * name-builder living here.
     *
     * There were two before, and only one of them was updated when the pools
     * became country-keyed — which is how this function ended up referring to a
     * constant that no longer existed. One source for "what a ghost looks like"
     * means the coherence rules apply to both kinds of ghost or neither.
     */
    ...syntheticIdentity({ country }),
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

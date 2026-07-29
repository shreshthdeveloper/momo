/**
 * Canonical game constants.
 *
 * MIRRORED FILE — an identical copy lives at mobile/src/shared/constants.js.
 * The client predicts scores locally for instant feedback; the server remains
 * the only authority. `tests/shared-parity.test.js` fails the build if the two
 * copies diverge. Edit both, or edit neither.
 */

// ── Match shape ────────────────────────────────────────────────────────────
export const ROUNDS_PER_MATCH = 7;
export const OPTIONS_PER_QUESTION = 4;
export const ROUND_DURATION_MS = 10_000;
export const ROUND_RESULT_MS = 2_500;
export const VERSUS_COUNTDOWN_MS = 5_500;

// ── Scoring (prd.md F6.4.14–F6.4.16) ───────────────────────────────────────
export const BASE_POINTS = 20;
export const SPEED_MAX = 20;
export const MAX_ROUND_SCORE = BASE_POINTS + SPEED_MAX; // 40
/**
 * The last round of every match is the bonus round, and it pays double.
 *
 * The match screen has announced this since the night restaging ("BONUS ROUND —
 * double or nothing on speed") while every round in fact scored the same, so
 * the closing round of a match the player was told to push on was worth exactly
 * what the opener was. The multiplier is applied in `scoreAnswer`, which both
 * ends run, so the prediction under a tap and the server's authoritative points
 * cannot disagree about it.
 */
export const BONUS_ROUND_MULTIPLIER = 2;
export const MAX_MATCH_SCORE =
  MAX_ROUND_SCORE * (ROUNDS_PER_MATCH - 1 + BONUS_ROUND_MULTIPLIER); // 320

// ── Timing tolerances (tech.md §9.4) ───────────────────────────────────────
/** Transit allowance so a slow connection is not punished for latency. */
export const NETWORK_GRACE_MS = 250;
/** Below this, a human did not read the question. Flagged, not rejected. */
export const HUMAN_FLOOR_MS = 300;
/** Reconnect window before a live match is forfeited. */
export const DISCONNECT_GRACE_MS = 10_000;
/**
 * How long a rematch invitation stands before it lapses.
 *
 * Both sides have to ask, so this is how long the first asker waits. The
 * client's own watchdog is set slightly longer than this, so the server's
 * answer always arrives first and the timeout is only ever a backstop.
 */
export const REMATCH_WINDOW_MS = 30_000;

// ── Matchmaking (tech.md §8) ───────────────────────────────────────────────
/**
 * Live pairing matches on the TOPIC LEVEL, not on any rating.
 *
 * A level is earned by playing, so two players at the same topic level have put
 * roughly the same time into the subject — which is the comparison a player can
 * actually read on the versus screen. Ratings are the wrong input twice over:
 * the topic rating is deliberately invisible outside the leaderboards, and the
 * ranked rating is global, so it says nothing about this topic.
 *
 * The band opens at 0 — the same level only — and widens by one level per step
 * up to LEVEL_BAND_MAX. It is a hard cap: past ±5 a ghost is the fairer match,
 * because a level 3 against a level 12 is not a contest.
 */
export const LEVEL_BAND_MAX = 5;
export const LEVEL_BAND_STEP_MS = 1_200;
/**
 * prd.md F6.4.3 — the player is never made to wait longer than this.
 *
 * Level bands are narrower than the rating bands they replaced, so the deadline
 * buys the narrower pool time to produce a live opponent: the band reaches its
 * ±5 cap at 6s and holds there for the last 2s before the ghost takes over.
 */
export const GHOST_AFTER_MS = 8_000;
export const QUEUE_SWEEP_AFTER_MS = 30_000;
/**
 * The sweep window for a player who has refused ghosts — either because their
 * space set `allowGhosts: false`, or because the install is running human-only
 * to prove two real devices can pair.
 *
 * Such a player has no ghost deadline to end their wait, so the sweep is the
 * only thing that ends it, which makes 30s far too eager: two people picking
 * the same topic on two phones routinely take longer than that. Five minutes
 * is long enough to be a real wait and short enough that a queue entry whose
 * socket died without a disconnect event cannot linger.
 */
export const HUMAN_ONLY_SWEEP_AFTER_MS = 300_000;

/**
 * Ghost selection matches on the level too, and for the same reason: the versus
 * screen shows the opponent's topic level whether or not they are live, so a
 * ghost picked on rating would visibly break the even-match promise that level
 * pairing exists to make. Replays written before levels were recorded fall back
 * to these rating bands.
 */
export const BAND_INITIAL = 150;
export const BAND_STEP = 100;

// ── Rating (tech.md §9.3) ──────────────────────────────────────────────────
export const ELO_K = 32;
export const ELO_FLOOR = 800;
export const ELO_START = 1200;
/** prd.md F6.5.3 — overall rating derives from this many strongest topics. */
export const OVERALL_RATING_TOPIC_COUNT = 5;

/**
 * The global ranked ladder (leagues-and-progression.md §2).
 *
 * A second Elo, held once per player rather than per topic, so that a ranked
 * loss always costs something. The per-topic rating cannot do this job: the
 * profile figure derived from it is the mean of the five strongest topics, so
 * a loss in a weak topic moves it by nothing at all.
 */
export const RANKED_START = ELO_START;
export const RANKED_FLOOR = ELO_FLOOR;

/**
 * Leagues (leagues-and-progression.md §3) — bands of the ranked rating, not a
 * ladder of their own. Divisions are 75 points wide because an even loss is
 * −16, which puts a demotion 4–5 straight losses away.
 */
export const LEAGUE_DIVISION_WIDTH = 75;
export const LEAGUE_DIVISIONS = 3;
/**
 * `color` is the metal the badge is struck in. It travels with the band rather
 * than being looked up by key on the client, because the keys are editable:
 * a ladder renamed to Emerald has to arrive with a colour, not fall back to
 * bronze because nothing recognised the name.
 */
export const LEAGUES = [
  { key: 'bronze', name: 'Bronze', floor: RANKED_FLOOR, color: '#E0A46A' },
  { key: 'silver', name: 'Silver', floor: 1225, color: '#C8CFDE' },
  { key: 'gold', name: 'Gold', floor: 1450, color: '#F5B62E' },
  { key: 'diamond', name: 'Diamond', floor: 1675, color: '#7FE0E4' },
  /** The top league has no divisions — you are there or you are not. */
  { key: 'black', name: 'Black', floor: 1900, color: '#F2F1F8' },
];

/**
 * The metal a band with no colour of its own is struck in, by position rather
 * than by name — the fifth league is the top one whatever it is called.
 */
export const LEAGUE_METALS = ['#E0A46A', '#C8CFDE', '#F5B62E', '#7FE0E4', '#F2F1F8'];

/**
 * Progression config (leagues-and-progression.md §9).
 *
 * The cosmetics catalogue, the account XP table and the league floors are
 * superadmin-editable DB records served by `GET /config/progression`. The
 * values below are the *seed* for that config and the fallback a client uses
 * before it has fetched one — never a second source of truth once the server
 * has spoken.
 *
 * These enums stay in code because they are the SHAPE of the data rather than
 * its values: both sides must agree what an unlock kind is even though only
 * the server decides which items use which.
 */
export const COSMETIC_TYPE = { AVATAR: 'avatar', BANNER: 'banner', TITLE: 'title' };
export const COSMETIC_TYPES = Object.values(COSMETIC_TYPE);

export const UNLOCK_KIND = {
  /** Free from registration. The only kind the sign-up picker offers. */
  FREE: 'free',
  /** Reached an account level. Titles, and after the shop shipped, only titles. */
  LEVEL: 'level',
  /** Reached a league — standing rather than time served. */
  LEAGUE: 'league',
  /** Never unlocked by climbing; a chest is the only way in. */
  CHEST: 'chest',
  /** Bought with coins (coins-and-cosmetics.md §3.2). */
  SHOP: 'shop',
};
export const UNLOCK_KINDS = Object.values(UNLOCK_KIND);

/** A chest opens on a ranked rating threshold or on entering a league. */
export const CHEST_TRIGGER = {
  RATING: 'rating',
  LEAGUE: 'league',
  /**
   * Everyone, the moment it is switched on — a Christmas or New Year chest.
   * There is nothing to reach: the event IS the qualification.
   */
  EVENT: 'event',
};
export const CHEST_TRIGGERS = Object.values(CHEST_TRIGGER);

/**
 * How often a chest can be won.
 *
 * The two built-in chests are MONTHLY: re-rolled on the 1st, re-earned against
 * the fresh ratings, and cleared if left unopened — that loop is the reason to
 * come back. Anything an operator creates is ONCE by default, because an event
 * chest is an event: a Christmas chest that quietly re-awarded itself every
 * month afterwards, and deleted itself from the shelf of anyone who had not
 * opened it by the 1st, is neither of the things its name promises.
 */
export const CHEST_RECURRENCE = { MONTHLY: 'monthly', ONCE: 'once' };
export const CHEST_RECURRENCES = Object.values(CHEST_RECURRENCE);

/**
 * The period stamped on a grant from a one-time chest.
 *
 * Grants are unique on (userId, chestKey, period), so a constant here is what
 * makes a one-time chest once-ever rather than once-a-month — and the monthly
 * sweep skips this value, which is what makes it kept-for-ever rather than
 * cleared on the 1st.
 */
export const CHEST_PERIOD_ONCE = 'once';

// ── Rarity (coins-and-cosmetics.md §2) ─────────────────────────────────────

/**
 * Rarity is a property of the CONCEPT, not of where an item used to sit on a
 * level ladder. A slice of pizza is common because it is a slice of pizza; the
 * Dragon Lord is legendary because of what it is, not because it was drawn
 * late. That is what makes the shelves legible at a glance.
 */
export const RARITY = {
  COMMON: 'common',
  UNCOMMON: 'uncommon',
  RARE: 'rare',
  LEGENDARY: 'legendary',
};
export const RARITIES = Object.values(RARITY);

/**
 * The colour is doing most of the work — a player reads rarity before they read
 * a name or a price — so legendary takes GOLD rather than the purple the rare
 * tier already owns. Two tiers sharing a colour defeats colour-coding them.
 *
 * `from`/`to` are the price band. A tier's items are spread evenly across it by
 * their position in the tier, so the shop has a range inside every shelf rather
 * than fifty identical price tags. Legendary has no band: it is chest-only.
 */
export const RARITY_META = {
  [RARITY.COMMON]: { name: 'Common', color: '#9C99B4', from: 200, to: 300 },
  [RARITY.UNCOMMON]: { name: 'Uncommon', color: '#5FBBE0', from: 500, to: 800 },
  [RARITY.RARE]: { name: 'Rare', color: '#A98BF0', from: 1500, to: 2000 },
  [RARITY.LEGENDARY]: { name: 'Legendary', color: '#F5B62E', from: null, to: null },
};

/** How many price steps a tier's band is divided into. */
export const PRICE_STEPS = 5;

// ── Coins (coins-and-cosmetics.md §3) ──────────────────────────────────────

/**
 * One number on the account, earned only, with no ledger behind it.
 *
 * A loss still pays. A currency that only rewards winning punishes exactly the
 * players who most need a reason to play the next match — the same argument
 * leagues-and-progression.md §1 makes for XP.
 */
export const COIN_AWARD = {
  RANKED_WIN: 50,
  RANKED_DRAW: 25,
  RANKED_LOSS: 10,
  QUICK_WIN: 20,
  /** Four levels in five pay money and nothing else. */
  LEVEL_UP: 150,
  /** The fifth pays more, and brings a title and a common with it. */
  LEVEL_UP_MILESTONE: 300,
  DIVISION_PROMOTION: 150,
  LEAGUE_PROMOTION: 500,
};

/**
 * A title every fifth level, twenty in all.
 *
 * One per level was the first plan and it made the tag worthless: a thing you
 * receive a hundred times is a receipt, not a title.
 */
export const MILESTONE_LEVEL_STEP = 5;

/** A balance is a number, not a bank; this is only a sanity ceiling. */
export const COINS_MAX = 9_999_999;

// ── Chests (coins-and-cosmetics.md §5.2) ───────────────────────────────────

/** Twenty slots, of which eight are coins. Opening draws exactly one. */
export const CHEST_SLOT_COUNT = 20;

/** A coin slot is worth one of these. Modest by design — see §5.2. */
export const CHEST_COIN_VALUES = [25, 50, 100];

/**
 * A cosmetic the player already owns pays out instead of granting nothing —
 * roughly a quarter of that rarity's shop price. Without this, a player who
 * owned most commons would open a dead chest four times in five by month three.
 */
export const DUPLICATE_PAYOUT = {
  [RARITY.COMMON]: 50,
  [RARITY.UNCOMMON]: 150,
  [RARITY.RARE]: 400,
  [RARITY.LEGENDARY]: 800,
};

/**
 * The two monthly chests, rolled fresh from the catalogue on the 1st.
 *
 * The trigger is a LEAGUE rather than a fixed rating. Against a monthly soft
 * reset the original 1600/2000 were far harder than they looked — at K=32 and a
 * 65% win rate a player nets about +5 a match, putting chest 2 at 90–160
 * matches in a single month. Gold and Diamond land the same intent at reachable
 * numbers, and retuning a league floor later moves the chest with it instead of
 * leaving an orphan constant behind.
 */
export const MONTHLY_CHESTS = [
  {
    key: 'monthly-chest',
    name: 'Chest',
    description: 'Rolled fresh every month. Reach Gold to open it.',
    triggerLeague: 'gold',
    /** 12 cosmetic slots. Common is the minority: a chest has to beat a day of coins. */
    slots: { [RARITY.COMMON]: 6, [RARITY.UNCOMMON]: 4, [RARITY.RARE]: 2, [RARITY.LEGENDARY]: 0 },
    /** 8 coin slots, ~44 on average. */
    coins: [25, 25, 25, 25, 50, 50, 50, 100],
    order: 0,
  },
  {
    key: 'legendary-chest',
    name: 'Legendary Chest',
    description: 'The only way to a legendary. Reach Diamond to open it.',
    triggerLeague: 'diamond',
    /** Legendary keeps 2 slots rather than being scaled down — it is why this chest exists. */
    slots: { [RARITY.COMMON]: 3, [RARITY.UNCOMMON]: 3, [RARITY.RARE]: 4, [RARITY.LEGENDARY]: 2 },
    /** 8 coin slots, ~63 on average. */
    coins: [25, 25, 50, 50, 50, 100, 100, 100],
    order: 1,
  },
];

/**
 * The monthly soft reset (coins-and-cosmetics.md §5.1) — halfway to the start
 * rating, not all the way back to it.
 *
 * `next = START + (current − START) × PULL`. A Black player made to grind up
 * from 1200 every month simply stops; no reset at all kills the loop the chests
 * hang off. Halfway lets strong players re-reach chest 1 in a few wins and
 * chest 2 in a real month's climb, and lifts weak players off the floor.
 */
export const RANKED_SOFT_RESET_PULL = 0.5;

// ── Mastery (prd.md F6.5.2) ────────────────────────────────────────────────
export const MASTERY_MAX_LEVEL = 50;
export const XP_PER_MATCH = 40;
export const XP_WIN_BONUS = 30;
export const XP_DRAW_BONUS = 15;
export const XP_PER_CORRECT = 5;

/**
 * The account level (leagues-and-progression.md §4) — one global level over
 * XP earned everywhere. Deliberately slower than a topic level: that measures
 * one subject, this measures time in the app.
 *
 * A hundred levels, and the curve was RESCALED rather than extended to reach
 * them (coins-and-cosmetics.md §4.1). On the old coefficient of 75, level 100
 * would have cost about 7,700 ranked wins — over two years — which would have
 * put every title above level 50 out of reach of all but a fraction of a
 * percent. At 18, level 100 costs what level 50 used to: ~1,900 wins, about six
 * months. Every existing player's level roughly doubles, which is safe by
 * construction because `accountLevelFloor` guarantees a level can never fall.
 */
export const ACCOUNT_MAX_LEVEL = 100;
export const ACCOUNT_XP_COEFFICIENT = 18;

// ── Content rules ──────────────────────────────────────────────────────────
/** design.md §4.2 — past this the question drops a type size. */
export const QUESTION_TEXT_SOFT_MAX = 140;
/** Rejected at authoring time beyond this. */
export const QUESTION_TEXT_HARD_MAX = 200;
export const OPTION_TEXT_MAX = 80;
/** prd.md F8.3.3 — three matches' worth before a topic may go live. */
export const MIN_PUBLISHED_QUESTIONS_TO_LIVE = 21;

// ── Contests (prd.md §8.5, F7.5) ───────────────────────────────────────────
/**
 * A contest is a fixed question set, so every entrant faces the same questions
 * in the same order — that is the whole basis on which the standings are
 * comparable. Option ORDER is still shuffled per entry, which costs nothing
 * and stops "the answer is the third one" spreading through a classroom.
 */
export const CONTEST_MIN_QUESTIONS = 7;
export const CONTEST_MAX_QUESTIONS = 21;
/** How long before a contest opens that entrants are told about it. */
export const CONTEST_STARTING_SOON_MS = 15 * 60 * 1000;

// ── Assignments (prd.md F8.5.5, F7.4) ──────────────────────────────────────
export const ASSIGNMENT_MAX_MATCHES = 50;

// ── Friend challenges (prd.md §6.3) ────────────────────────────────────────
/**
 * A challenge is a live invitation, not a letter.
 *
 * It used to sit unanswered for 24 hours, which read as generous and was
 * actually the opposite: pairing puts the two of them in a private pool that
 * refuses ghosts, so a challenge only ever becomes a match if BOTH are in the
 * app at the same moment. A 24-hour window cannot deliver that — it just meant
 * the Friends screen filled with invitations that had no chance of resolving,
 * and every one of them had to be scrolled past.
 *
 * Two minutes says what the feature actually is: I am here now, are you? An
 * invitation that lapses is a far smaller cost than a list of dead ones, and
 * re-sending is one tap.
 */
export const CHALLENGE_ACCEPT_WINDOW_MS = 2 * 60 * 1000;
/**
 * And once accepted, the same again to actually get into the match — the
 * accepting player still has to reach the queue, and the challenger still has
 * to be there when they do.
 */
export const CHALLENGE_PLAY_WINDOW_MS = 2 * 60 * 1000;
/** One place for the wording, so the copy cannot drift from the number. */
export const CHALLENGE_ACCEPT_WINDOW_LABEL = '2 minutes';

// ── Access ─────────────────────────────────────────────────────────────────
export const INTERESTS_MIN = 3;
export const INTERESTS_MAX = 8;

// ── Language (prd.md Q3 — English at launch, schema stays additive) ────────
export const DEFAULT_LANGUAGE = 'en';
export const SUPPORTED_LANGUAGES = ['en'];

// ── Enums ──────────────────────────────────────────────────────────────────
export const MATCH_MODE = {
  /** Unranked: XP only, no win bonus, no rating of any kind. */
  QUICK: 'quick',
  /** The ladder: ranked rating, topic rating and the full XP award. */
  RANKED: 'ranked',
  CHALLENGE: 'challenge',
  PRACTICE: 'practice',
  CONTEST: 'contest',
};

/** The only mode that moves a rating. Everything else is XP alone. */
export const RATED_MODES = [MATCH_MODE.RANKED];

export const MATCH_STATE = {
  QUEUED: 'QUEUED',
  MATCHED: 'MATCHED',
  COUNTDOWN: 'COUNTDOWN',
  ROUND_ACTIVE: 'ROUND_ACTIVE',
  ROUND_RESOLVED: 'ROUND_RESOLVED',
  COMPLETE: 'COMPLETE',
  ABANDONED: 'ABANDONED',
};

export const SPACE_ROLE = {
  STUDENT: 'student',
  SUB_ADMIN: 'sub_admin',
  ADMIN: 'admin',
};

export const PLATFORM_ROLE = {
  PLAYER: 'player',
  SUPERADMIN: 'superadmin',
};

export const QUESTION_STATUS = {
  DRAFT: 'draft',
  IN_REVIEW: 'in_review',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
};

export const TOPIC_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
};

export const DIFFICULTY = {
  EASY: 'easy',
  MEDIUM: 'medium',
  HARD: 'hard',
};

export const JOIN_MODE = {
  OPEN: 'open',
  APPROVAL: 'approval',
  INVITE: 'invite',
};

/**
 * A contest's lifecycle is driven by the clock, never by a button. `scheduled`
 * becomes `live` at `startsAt` and `finished` at `endsAt`, so an admin who
 * forgets to press anything still runs a correct contest.
 */
export const CONTEST_STATUS = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  LIVE: 'live',
  FINISHED: 'finished',
  CANCELLED: 'cancelled',
};

/** prd.md F8.5.1 — standings visibility is the admin's call, per contest. */
export const STANDINGS_VISIBILITY = {
  LIVE: 'live',
  AFTER: 'after',
  ADMIN_ONLY: 'admin_only',
};

/** prd.md F8.5.5 — "N matches, or a minimum accuracy". */
export const ASSIGNMENT_REQUIREMENT = {
  MATCHES: 'matches',
  ACCURACY: 'accuracy',
  MASTERY: 'mastery',
};

export const ASSIGNMENT_STATUS = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
};

/**
 * The reserved tenant id for everything in the Public Arena, and the `origin`
 * of every Central Bank question.
 *
 * It is a real, fixed ObjectId with a real Space document behind it rather
 * than a `null` sentinel. That keeps `spaceId` one type everywhere, so the
 * tenant guard has a single code path and every index behaves the same — the
 * public scope is not a special case waiting to be forgotten.
 */
export const PUBLIC_SPACE_ID = '000000000000000000000001';

/**
 * design.md §3.3 — admins pick from a curated set that holds contrast
 * against --ink. Free colour entry is deliberately not offered.
 */
export const SPACE_ACCENTS = [
  '#FFB020', // floodlight
  '#4FA8E8', // signal blue
  '#8B7BE8', // violet
  '#3FD68C', // verified green
  '#FF7A5C', // ember
  '#E85C9A', // magenta
  '#5CD1D6', // teal
  '#C9A227', // brass
];

/**
 * ── Reactions, which is as close to chat as this app gets ──────────────────
 *
 * prd.md §2, §6.8 and §14 all exclude in-app chat from v1, and the reasoning in
 * §6.8 is the part worth keeping: a message thread built at low user counts is
 * a visibly empty room, and an empty room makes a product feel abandoned rather
 * than new. Free text between students inside an organization also means owning
 * a moderation queue, a block list that actually works, and a report path for
 * every message — three features, none of which is the game.
 *
 * A fixed set of sends gets most of what people actually want out of chat here
 * (acknowledge the match, ask for another) and none of the cost. There is no
 * keyboard, so there is nothing to moderate; the payload is a KEY, and the
 * words are written here rather than by the sender.
 *
 * The `message` completes a sentence beginning with the sender's display name —
 * "Priya wants a rematch" — so the notification reads as one line rather than a
 * name stapled to a quote.
 *
 * `icon` names a glyph in the app's own icon set, deliberately NOT an emoji.
 * Emoji render differently on every Android OEM and several of the obvious
 * choices here are skin-toned or gendered by default; a drawn glyph is the same
 * mark for everybody and is already the rest of the app's language.
 */
export const FRIEND_REACTIONS = [
  { key: 'gg', label: 'GG', icon: 'medal', message: 'says GG' },
  { key: 'nice', label: 'Nice one', icon: 'sparkle', message: 'says nice one' },
  { key: 'fire', label: 'On fire', icon: 'flame', message: 'says you are on fire' },
  { key: 'rematch', label: 'Rematch?', icon: 'bolt', message: 'wants a rematch' },
  { key: 'next_time', label: 'Next time', icon: 'target', message: 'will get you next time' },
  { key: 'come_play', label: 'Come play', icon: 'play', message: 'wants to play a round' },
];

export const FRIEND_REACTION_KEYS = FRIEND_REACTIONS.map((r) => r.key);

/**
 * One reaction per friend per minute.
 *
 * The whole feature is a tap, which is exactly what makes it spammable: without
 * a floor, "send" held down is a notification firehose aimed at one person.
 * A minute is long enough that nobody can be buried and short enough that the
 * back-and-forth people actually want still works.
 */
export const FRIEND_REACTION_COOLDOWN_MS = 60 * 1000;

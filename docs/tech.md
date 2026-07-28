# Technical Design — Real-Time Trivia Platform

**Product:** Mimo
**Version:** 1.0
**Date:** 25 July 2026
**Owner:** Engineering
**Companion documents:** `prd.md` (what and why), `design.md` (experience and visual system)

---

## 1. Stack

| Layer | Choice | Rationale |
|---|---|---|
| Mobile client | React Native via Expo, development build | Existing team skill. Development build (not Expo Go) allows any native module while keeping EAS Build, config plugins, and OTA updates. |
| Realtime transport | Socket.IO | Mature Node integration, automatic reconnection, and room semantics. Cross-node fan-out, when it is needed, rides a MongoDB change stream rather than a second broker — see §12. |
| API | Node.js + Fastify | Faster than Express with first-class JSON schema validation, which matters on hot paths. |
| Database | MongoDB + Mongoose | Existing team skill. Document shape fits questions, profiles, and match records well. |
| Cache / ephemeral | In-process maps, backed by MongoDB collections when the service splits | **No Redis.** See §12 for what replaces it and when that trade stops being the right one. |
| Admin portal | Expo Router screens inside the mobile app (`app/admin`, `app/super`) | One client, not two. Admin work is role-gated routing over the same API and auth the player app already uses, so there is no second build, no second session layer, and no second deploy. |
| Object storage | S3-compatible with CDN | Topic covers, avatars, question images. |
| Push | Firebase Cloud Messaging, plus APNs via FCM | One integration for both platforms. |
| Auth | Self-issued JWT, phone OTP via an SMS provider | Avoids a third-party identity dependency and keeps user records in one database. |

**v1 runs as a single Node process.** Game logic lives in an isolated module with no HTTP coupling, so extracting it later is a deployment change and not a rewrite. See §12 for the split path.

---

## 2. Repository structure

**Two standalone projects**, each with its own `package.json` and its own
`node_modules`. Not a workspace.

```
mimo/
├── run.sh                   one command for both (see §16)
├── docs/                    prd, design, tech, and the progression specs
├── backend/                 Node + Fastify + Socket.IO + MongoDB
│   ├── src/
│   │   ├── shared/          constants, scoring, Elo, mastery, socket protocol
│   │   ├── config/          env, db connection
│   │   ├── models/          mongoose schemas
│   │   ├── routes/          REST handlers
│   │   ├── services/        business logic, no HTTP or socket awareness
│   │   ├── game/            matchmaker, match engine, ghost service, socket gateway
│   │   ├── middleware/      auth, tenant guard
│   │   ├── jobs/            scheduled work
│   │   ├── scripts/         seed and the match-history simulator
│   │   └── server.js
│   └── tests/
└── mobile/                  React Native (Expo SDK 54) — player app + admin shells
    ├── app/admin/           institute admin screens
    ├── app/super/           superadmin screens
    └── src/shared/          ← byte-identical copy of backend/src/shared
```

### 2.1 Keeping the shared code identical

The original plan put scoring and Elo in a `packages/shared` workspace so the
client could predict a score locally for instant feedback while the server
stayed the only authority, and the two could never drift.

Two standalone folders remove that mechanism, so the guarantee is kept a
different way: `src/shared` is **mirrored**, and `tests/shared-parity.test.js`
fails the build if the copies differ by a byte. The rule is stated at the top of
every mirrored file — *edit both, or edit neither* — and `./run.sh test` checks
it alongside the suite.

Five files are mirrored: `constants.js`, `scoring.js`, `elo.js`, `mastery.js`,
`protocol.js`. Nothing else is shared, and nothing in them imports outward.

---

## 3. Data model

MongoDB. Every schema below lists its indexes — these are not optional, they are the difference between a working leaderboard and a timeout.

### 3.1 users

```js
{
  _id, phone, email, googleId, appleId,
  displayName, displayNameLower, avatarUrl, city, dateOfBirth,
  isMinor,                          // derived, drives privacy defaults
  status,                           // active | suspended | deleted
  overallRating,                    // derived from top 5 topic ratings
  totalXp, matchesPlayed,
  streak: { current, longest, lastPlayedOn },
  interests: [topicId],
  spaceMemberships: [spaceId],      // denormalised for fast auth checks
  pushTokens: [{ token, platform, updatedAt }],
  notificationPrefs: { ... },
  createdAt, lastActiveAt, deletedAt
}
```

Indexes: `phone` unique sparse · `email` unique sparse · `displayNameLower` unique · `lastActiveAt`

### 3.2 spaces

```js
{
  _id, name, slug, logoUrl, accentColor,
  ownerId, joinMode,                // open | approval | invite
  joinCode,
  plan: { tier, seatLimit, status, currentPeriodEnd },
  settings: { roundDurationMs, allowPublicProfiles },
  status, createdAt
}
```

Indexes: `slug` unique · `joinCode` unique · `ownerId`

### 3.3 spaceMembers

```js
{ _id, spaceId, userId, role, batchId, status, joinedAt }
```

Indexes: `{ spaceId, userId }` unique · `{ userId }` · `{ spaceId, status }`

Roles: `student` · `sub_admin` · `admin`. Status: `pending` · `active` · `suspended`.

### 3.4 categories

```js
{ _id, spaceId, name, order, iconUrl, createdAt }
```

`spaceId` is the reserved public ID for global categories. Index: `{ spaceId, order }`

### 3.5 topics

```js
{
  _id, spaceId, categoryId, name, slug, description, coverUrl,
  questionSources: { central: Boolean, own: Boolean },
  status,                           // draft | published | archived
  publishedQuestionCount,           // maintained on question publish/archive
  batchIds: [batchId],              // empty = whole space
  stats: { matchesPlayed, uniquePlayers, avgAccuracy },
  createdAt
}
```

Indexes: `{ spaceId, status }` · `{ spaceId, categoryId }` · `{ slug, spaceId }` unique

### 3.6 questions

```js
{
  _id,
  origin,                           // 'central' | spaceId
  topicIds: [topicId],
  questionText, options: [String],  // exactly 4
  correctIndex,                     // 0-3
  difficulty,                       // easy | medium | hard
  tags: [String],
  explanation, imageUrl, timeLimitOverrideMs,
  status,                           // draft | in_review | published | archived
  contentHash,                      // normalised text hash, duplicate detection
  forkedFrom,                       // questionId, when copied from central
  createdBy, reviewedBy,
  stats: {
    served, correctCount, avgResponseMs,
    optionCounts: [0,0,0,0]
  },
  createdAt, updatedAt
}
```

Indexes: `{ topicIds, status, difficulty }` · `{ origin, status }` · `{ contentHash }` · text index on `questionText`

### 3.7 ratings

One document per user per topic. The single most-read collection.

```js
{
  _id, userId, topicId, spaceId,
  rating, matchesPlayed, wins, losses, draws,
  xp, level, updatedAt
}
```

Indexes: `{ userId, topicId }` unique · `{ topicId, rating: -1 }` · `{ spaceId, rating: -1 }`

The second index serves every topic leaderboard. Without it, leaderboards collection-scan.

### 3.8 matches

```js
{
  _id, topicId, spaceId, mode,      // quick | challenge | practice | contest
  players: [{
    userId, isGhost, sourceMatchId,
    score, ratingBefore, ratingAfter, xpEarned
  }],
  questionIds: [questionId],
  rounds: [{
    questionIndex, correctIndex,
    answers: [{ userId, optionIndex, elapsedMs, points, flagged }]
  }],
  winnerId, isDraw,
  createdAt, completedAt
}
```

Indexes: `{ 'players.userId', createdAt: -1 }` · `{ topicId, createdAt: -1 }` · `{ spaceId, createdAt: -1 }`

### 3.9 replays

Derived from completed matches. Powers ghost matchmaking.

```js
{
  _id, matchId, topicId, spaceId,
  playerRating, ratingBand,         // floor(rating / 100)
  displayName, avatarUrl,           // snapshot at time of play
  questionIds: [questionId],
  answers: [{ optionIndex, elapsedMs }],
  usedCount, createdAt
}
```

Indexes: `{ topicId, ratingBand, usedCount }` · `{ createdAt }` for TTL pruning

Only matches where the player answered at least 5 of 7 rounds become replays. A replay of someone who quit makes a terrible opponent.

### 3.10 contests and contestEntries

```js
// contests
{
  _id, spaceId, name, description,
  topicIds: [topicId],
  questionCount, selectionMode,     // auto | manual
  questionIds: [questionId],        // FROZEN — see below
  questionsLockedAt,
  startsAt, endsAt, roundDurationMs,
  batchIds: [batchId],              // empty = whole space
  standingsVisibility,              // live | after | admin_only
  status,                           // draft | scheduled | live | finished | cancelled
  stats: { entrants, completed, avgScore, topScore },
  finalisedAt, createdBy
}

// contestEntries — one per (contest, student). One attempt.
{
  _id, contestId, spaceId, userId, batchId,
  displayName, avatarUrl, matchId,
  score, correctCount, answeredCount, totalResponseMs,
  status, finalRank, startedAt, completedAt
}
```

Indexes: contests `{ spaceId, status, startsAt: -1 }` · `{ status, startsAt }` for the
lifecycle job. Entries `{ contestId, userId }` unique · `{ contestId, score: -1,
totalResponseMs: 1 }` for standings.

**`questionIds` is frozen once, at open.** Every entrant sits the same paper in
the same order, because a standings table over different papers ranks luck. The
freeze is a conditional update guarded on `questionsLockedAt: null`, so the
lifecycle job and a very early entrant racing each other still produce one paper.

Option order is still shuffled per entry. It costs nothing and stops "the answer
is the third one" spreading through a classroom.

### 3.11 assignments and assignmentProgress

```js
// assignments
{
  _id, spaceId, topicId, title, description,
  requirement: {
    type,                           // matches | accuracy | mastery
    matches, minAccuracy, level
  },
  dueAt, batchIds: [batchId], status,
  dueReminderSentAt, createdBy
}

// assignmentProgress — created when a student first plays, not up front
{
  _id, assignmentId, spaceId, userId,
  matchesPlayed, answeredCount, correctCount, level,
  completedAt, late, lastMatchAt
}
```

Indexes: assignments `{ spaceId, topicId, status }` — the hot one, hit once per
completed match — plus `{ spaceId, status, dueAt }`. Progress
`{ assignmentId, userId }` unique · `{ userId, spaceId }`.

An assignment carries **no stored `assigned` / `completed` counter.** Who an
assignment is for is a function of live membership, and any stored denominator
is wrong the moment a student joins, leaves, or changes batch. Both figures are
counted at read time.

### 3.12 replays, revisited for contests

`replays` gains `contestId`, and ghost selection **always** filters on it —
`null` for ordinary play, the contest id inside a contest. It partitions the
pool in both directions: a contest replay carries the frozen paper, so serving
it to casual play would deal the questions to someone who never entered; and a
contest entrant must face the contest's questions, which only a replay from that
contest has.

### 3.13 Remaining collections

`batches` · `friendships` · `challenges` · `reports` · `auditLogs` · `notifications` · `leaderboardSnapshots`

`friendships` stores one document per pair with `userA < userB` lexicographically, so a friendship is never duplicated. Index `{ userA, userB }` unique plus `{ userB, status }`.

---

## 4. Multi-tenancy enforcement

**This is the single highest-risk area in the system.** A leak between institutes is not a bug, it is an incident.

**Rule: the client never supplies a `spaceId` that is trusted.**

Every authenticated request resolves the user's space memberships server-side from the token and the `spaceMembers` collection. A requested `spaceId` is validated against that set before any query runs.

```js
// middleware/tenantGuard.js
async function tenantGuard(req) {
  const requested = req.params.spaceId ?? req.body.spaceId;
  if (!requested) return;                      // public scope
  const member = await SpaceMember.findOne({
    spaceId: requested,
    userId: req.user.id,
    status: 'active'
  }).lean();
  if (!member) throw new ForbiddenError('NOT_A_MEMBER');
  req.space = { id: requested, role: member.role, batchId: member.batchId };
}
```

Additional layers:

1. **Service functions take a resolved scope object, never a raw ID from the request.**
2. **Every space-scoped Mongoose query includes `spaceId`.** A lint rule flags queries on space-scoped models without it.
3. **Automated cross-tenant denial tests** run in CI: a fixture user in Space A attempts to read Space B's topics, questions, students, leaderboards, and reports. All must return 403 or empty. This suite must never be skipped.
4. **Question source resolution** is server-side only. When building a match, eligible questions are `origin: 'central'` where the topic allows central, plus `origin: topic.spaceId` where it allows own. No other origin can enter the pool.

---

## 5. Authentication

**Flow.** Phone → OTP → tokens.

- OTP is 6 digits, valid 5 minutes, single-use, max 5 attempts, rate-limited to 3 sends per number per hour.
- OTPs are stored hashed, never in plaintext.
- On success: an **access token** (JWT, 15 minutes) and a **refresh token** (opaque, 60 days, stored hashed and rotated on every use).
- Refresh token reuse detection: presenting an already-rotated token revokes the entire family and forces re-authentication.

**Access token claims:** `sub` (userId), `role`, `iat`, `exp`. Space memberships are deliberately excluded — they change and must be checked live.

**Client storage:** `expo-secure-store` on both platforms. Never AsyncStorage.

**Socket auth:** the access token is passed in the connection handshake and verified before any event is accepted. Sockets carrying an expired token are disconnected with a code the client uses to trigger refresh and reconnect.

---

## 6. REST API

Base `/api/v1`. All responses `{ data }` or `{ error: { code, message, details } }`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/otp/send` | Request an OTP |
| POST | `/auth/otp/verify` | Verify and issue tokens |
| POST | `/auth/refresh` | Rotate tokens |
| POST | `/auth/logout` | Revoke refresh family |
| GET | `/me` | Current profile |
| PATCH | `/me` | Update profile |
| DELETE | `/me` | Begin deletion, 30-day grace |
| GET | `/categories?spaceId=` | Categories in scope |
| GET | `/topics?spaceId=&categoryId=&q=` | Topics, searchable |
| GET | `/topics/:id` | Topic detail with viewer's rating |
| GET | `/leaderboards/:topicId?scope=&period=` | Leaderboard page plus pinned viewer row |
| GET | `/matches?userId=` | Match history |
| GET | `/matches/:id` | Full match with questions, for review |
| POST | `/spaces/join` | Join by code |
| GET | `/spaces/mine` | Joined spaces |
| DELETE | `/spaces/:id/membership` | Leave a space |
| GET | `/friends` · POST `/friends/request` · POST `/friends/:id/accept` | Social |
| POST | `/reports` | Report a question or user |
| GET | `/spaces/:id/home` | Space home — assignments, contests, topics, progress |
| GET | `/spaces/:id/contests` | Contests visible to this student |
| GET | `/spaces/:id/contests/:cid/standings` | Standings, on the contest's own visibility terms |
| GET | `/spaces/:id/assignments` | Assignments with the viewer's progress |
| GET | `/spaces/:id/performance` | The student's own performance in this space (F7.6) |

Admin routes sit under `/api/v1/admin` and superadmin under `/api/v1/super`, each behind its own role guard. The Phase 3 admin surface lives in its own file at the same prefix:

| Method | Path | Purpose |
|---|---|---|
| GET/POST/PATCH/DELETE | `/admin/contests[/:id]` | Contest CRUD |
| PUT | `/admin/contests/:id/questions` | Curate the paper by hand (F8.5.2) |
| GET | `/admin/contests/:id/standings[.csv]` | Live standings, exportable |
| POST | `/admin/contests/:id/finalise` | Close early |
| GET/POST/PATCH/DELETE | `/admin/assignments[/:id]` | Assignment CRUD |
| GET | `/admin/assignments/:id/progress.csv` | Per-student completion |
| GET | `/admin/ai/status` · POST `/admin/ai/draft` | AI-assisted drafting (F8.2.6) |
| GET | `/admin/review` · POST `/admin/review/batch` | The review queue (F8.2.8) |
| GET | `/admin/reports/periods` | Period vs period (F8.6.5) |

**Live gameplay never touches REST.** It is entirely over sockets.

---

## 7. Socket protocol

Namespace `/game`. Authenticated at handshake.

### 7.1 Client → server

| Event | Payload | Notes |
|---|---|---|
| `queue:join` | `{ topicId, spaceId? }` | Enter matchmaking |
| `queue:leave` | `{}` | Cancel search |
| `match:answer` | `{ matchId, roundIndex, optionIndex }` | Submit an answer |
| `match:leave` | `{ matchId }` | Forfeit |
| `match:rematch` | `{ matchId }` | Request a rematch |
| `contest:enter` | `{ contestId }` | Enter a contest (protocol v2) |

### 7.2 Server → client

| Event | Payload |
|---|---|
| `queue:searching` | `{ topicId }` |
| `match:found` | `{ matchId, topic, opponent: { id, displayName, avatarUrl, rating }, headToHead }` |
| `match:start` | `{ matchId, totalRounds, roundDurationMs }` |
| `round:start` | `{ roundIndex, question: { id, text, imageUrl, options[4] }, durationMs, startedAt }` |
| `round:opponent_answered` | `{ roundIndex }` |
| `round:result` | `{ roundIndex, correctIndex, you: { optionIndex, elapsedMs, points }, opponent: { optionIndex, elapsedMs, points }, scores: { you, opponent } }` |
| `match:end` | `{ scores, winnerId, isDraw, ratingDelta, xpEarned, rounds[], contest?, assignmentsCompleted[] }` |
| `match:opponent_left` | `{ matchId }` |
| `error` | `{ code, message }` |

**`round:start` never contains `correctIndex`.** This is the single most important line in this document. Sending the answer key with the question means anyone with a proxy tool wins every match, and it is the most common way trivia games are broken.

### 7.2.1 Protocol versioning

`PROTOCOL_VERSION` is **2**. Version 2 added `contest:enter` and two fields on
`match:end`; both are additive, so `MIN_SUPPORTED_PROTOCOL_VERSION` stays at 1
and a version-1 client keeps playing exactly as before. The gate exists to
refuse clients the server can no longer serve — not to force an upgrade for its
own sake.

**A contest is entered by id, never by topic.** Routing it through `queue:join`
would silently produce an ordinary unranked match against the wrong questions,
so `queue:join` refuses `mode: 'contest'` outright.

### 7.3 Match state machine

```
QUEUED → MATCHED → COUNTDOWN → ROUND_ACTIVE ⇄ ROUND_RESOLVED → COMPLETE
                                     ↑______________|
                                    (7 rounds, then COMPLETE)

any state → ABANDONED  (disconnect beyond grace, or forfeit)
```

Transitions are driven by server timers only. No client message can advance a state — a client message can only record an answer, and the server decides whether that resolves the round.

---

## 8. Matchmaking

In-process for v1, behind an interface narrow enough that a MongoDB-backed queue collection can replace it without the caller noticing (§12).

```js
// pool key scopes the queue to a topic within a space
const poolKey = (spaceId, topicId) => `${spaceId ?? 'public'}:${topicId}`;

const BAND_INITIAL = 150;
const BAND_STEP    = 100;
const GHOST_AFTER  = 3000;

async function joinQueue(player, topicId, spaceId) {
  const key  = poolKey(spaceId, topicId);
  const pool = queues.get(key) ?? [];

  const opponent = pool.find(w =>
    Math.abs(w.rating - player.rating) <= BAND_INITIAL &&
    w.userId !== player.userId
  );

  if (opponent) {
    remove(pool, opponent);
    clearTimeout(opponent.timer);
    return createLiveMatch(player, opponent, topicId, spaceId);
  }

  const waiting = { ...player, band: BAND_INITIAL, joinedAt: Date.now() };
  pool.push(waiting);
  queues.set(key, pool);

  waiting.timer = setInterval(() => {
    waiting.band += BAND_STEP;
    const late = pool.find(w =>
      w !== waiting && Math.abs(w.rating - waiting.rating) <= waiting.band
    );
    if (late) { /* pair and clear */ }
    else if (Date.now() - waiting.joinedAt >= GHOST_AFTER) {
      clearInterval(waiting.timer);
      remove(pool, waiting);
      createGhostMatch(waiting, topicId, spaceId);
    }
  }, 1000);
}
```

A player leaving the queue, disconnecting, or joining another queue clears their entry and timer. Orphaned timers are the most likely source of a memory leak here — a periodic sweep removes queue entries older than 30 seconds.

---

## 9. Match engine

### 9.1 Question selection

```js
async function selectQuestions(topic, players) {
  const origins = [];
  if (topic.questionSources.central) origins.push('central');
  if (topic.questionSources.own)     origins.push(topic.spaceId);

  const seen = await recentlySeenQuestionIds(players, 30);   // days
  const avgRating = mean(players.map(p => p.rating));
  const mix = difficultyMixFor(avgRating);   // e.g. { easy: 2, medium: 3, hard: 2 }

  const picked = [];
  for (const [difficulty, count] of Object.entries(mix)) {
    picked.push(...await Question.aggregate([
      { $match: {
          topicIds: topic._id,
          origin: { $in: origins },
          status: 'published',
          _id: { $nin: seen }
      }},
      { $match: { difficulty } },
      { $sample: { size: count } }
    ]));
  }
  return shuffle(picked);
}
```

If exclusion of seen questions leaves too few, the constraint is relaxed before the match is failed. A repeated question is far better than no match.

Option order is shuffled per match, and `correctIndex` remapped accordingly, so option position is never a tell across repeated plays.

### 9.2 Scoring

```js
// packages/shared/scoring.js
export const BASE_POINTS = 20;
export const SPEED_MAX   = 20;

export function scoreAnswer({ isCorrect, elapsedMs, durationMs }) {
  if (!isCorrect) return 0;
  const remaining = Math.max(0, durationMs - elapsedMs);
  return BASE_POINTS + Math.round(SPEED_MAX * (remaining / durationMs));
}
```

Maximum 40 per round, 280 per match.

### 9.3 Elo

```js
// packages/shared/elo.js
const K = 32, FLOOR = 800, START = 1200;

export function expected(a, b) {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

export function nextRating(rating, opponentRating, score) {  // score: 1 | 0.5 | 0
  const next = rating + K * (score - expected(rating, opponentRating));
  return Math.max(FLOOR, Math.round(next));
}
```

Ghost matches update the live player only. Practice matches update nothing.

### 9.4 Round lifecycle

```
1. Server emits round:start, records startedAt = Date.now()
2. Server sets a timer for durationMs + NETWORK_GRACE (250ms)
3. On match:answer:
     - reject if roundIndex mismatched or already answered
     - elapsed = Date.now() - startedAt
     - reject if elapsed > durationMs + NETWORK_GRACE
     - flag if elapsed < 300 (below human floor)
     - points = scoreAnswer(...)
     - emit round:opponent_answered to the other player
     - if both answered, clear the timer and resolve
4. On resolve: emit round:result to each player with their own perspective
5. Wait 2500ms, then round:start for the next index, or match:end
```

`NETWORK_GRACE` exists so a player on a slow connection who genuinely answered in time is not penalised for transit. It is deliberately small.

### 9.5 Ghost replay

```js
async function createGhostMatch(player, topicId, spaceId) {
  const band = Math.floor(player.rating / 100);
  const replay = await Replay.findOne({
    topicId,
    ratingBand: { $gte: band - 1, $lte: band + 1 }
  }).sort({ usedCount: 1 }).lean();

  if (!replay) return createSyntheticMatch(player, topicId, spaceId);

  return startMatch({
    questionIds: replay.questionIds,
    players: [
      { userId: player.userId, isGhost: false },
      { userId: replay.userId, isGhost: true,
        script: replay.answers, sourceMatchId: replay.matchId }
    ]
  });
}
```

Inside the engine, a ghost player's answer is scheduled with `setTimeout(elapsedMs)` at round start, so pacing matches the original human. Sorting by `usedCount` ascending spreads replay usage rather than serving the same opponent repeatedly.

When no replay exists, the synthetic opponent draws a target accuracy from the topic's aggregate correct rate and response times from its observed distribution — noticeably better than a fixed bot, and it seeds real replays within a day of a topic going live.

### 9.5.1 The contest match

A contest entry is an ordinary match with three differences, all of them in the
orchestrator rather than in the engine:

1. The questions are the contest's **frozen** set, in the contest's order.
2. The opponent is drawn only from other entrants of this contest — a ghost of
   an earlier run, or a synthetic pace-setter when nobody has played yet. The
   replay pool is partitioned by `contestId` (§3.12) so the paper cannot escape.
3. The entry row is claimed **before** the match starts, via a unique index on
   `{ contestId, userId }`. Two taps a millisecond apart produce one entry and
   one clear error, not two runs.

**A contest never moves Elo.** prd.md §6.3 gives the contest match its own
standings, and a student's public rating must not move because their institute
set a hard paper. XP and mastery still accrue: they measure play, not skill.

### 9.6 Anti-cheat summary

| Vector | Defence |
|---|---|
| Reading the answer from the payload | `correctIndex` never sent before resolution |
| Forged client timestamps | All timing server-side; client timestamps ignored entirely |
| Answering after the timer | Rejected beyond `durationMs + NETWORK_GRACE` |
| Automated answering | Sub-300ms responses flagged; sustained flags escalate to moderation |
| Match farming | Rate limit on `queue:join`, and no rating gain from repeatedly beating the same opponent within a window |
| Rage-quitting a loss | Disconnect beyond grace forfeits; repeated late-match disconnects while losing are flagged |

### 9.7 Disconnection

- Grace period of **10 seconds**. Reconnecting within it restores the player to the live match at the current round, with remaining time recalculated from `startedAt`.
- Beyond 10 seconds the match is forfeited and the opponent wins.
- If both disconnect, the match is voided and neither rating changes.

---

## 10. Background jobs

| Job | Schedule | Work |
|---|---|---|
| Replay generation | On match completion | Create a replay from qualifying matches |
| Question stats rollup | **Inline on completion**, reconciled every 6 h | Seven upserts once per match. Item analysis is then correct the moment a match ends, and no watermark is needed to track what was already counted. |
| Topic stats rollup | Hourly | matchesPlayed, uniquePlayers, avgAccuracy |
| Leaderboard snapshot | Hourly | Materialise weekly and monthly boards |
| Streak evaluation | Daily 00:05 IST | Break streaks with no match yesterday |
| Streak reminder push | Daily 20:00 IST | Notify players at risk |
| Assignment reminders | Daily 09:00 IST | Notify students with work due tomorrow, derived from live membership minus those already done — the students who have not played are exactly who this is for. |
| Contest lifecycle | Every minute, and at start-up | Notify 15 minutes out, freeze the paper and open, close and write final ranks. Idempotent: every transition is guarded by the status it moves out of, every notification by the timestamp set when it is sent. |
| Replay pruning | Weekly | Remove replays older than 90 days where newer ones exist |
| Account deletion | Daily | Purge accounts past the 30-day grace period |
| Cheat review sweep | Daily | Escalate accumulated flags to moderation |

---

## 11. Performance targets

| Operation | p95 |
|---|---|
| `match:answer` round trip | under 200ms |
| Match start after pairing | under 500ms |
| Home feed | under 1s on 4G |
| Leaderboard page | under 300ms |
| Admin question list, 10k questions | under 800ms |

**Match memory footprint.** A live match holds roughly 4KB: seven questions, two player records, round state. 1,000 concurrent matches is about 4MB — memory is not the constraint. Socket count and event throughput are.

---

## 12. Scaling path

### v1 — single process, launch through roughly 2,000 concurrent

One Node process serving REST and sockets, one MongoDB. Matchmaking queues and live matches in process memory.

**Accepted limitation:** a deploy kills matches in flight. At launch volumes this is acceptable; deploy during low-traffic hours.

### v2 — split services, from roughly 2,000 concurrent

Extract the game module into its own process. **No Redis.** MongoDB is already
in the stack, already operated, and already the thing that would have to be
consistent with Redis anyway — a second datastore here buys throughput the
product does not yet need in exchange for a second failure mode, a second
backup story, and a class of bug where the two disagree.

1. **Matchmaking queues become a `queueEntries` collection** — `{ spaceId, topicId, userId, rating, band, joinedAt }`, with a compound index on `{ spaceId, topicId, rating }`. Opponent search is a range query on that index and pairing is a single `findOneAndDelete`, which is atomic, so two nodes cannot claim the same waiting player. A TTL index on `joinedAt` sweeps orphans without a cron.
2. **Cross-node events ride a MongoDB change stream.** Each game node opens a change stream on a capped `gameEvents` collection and forwards what it sees to its own sockets. This is what the Socket.IO Redis adapter does, with the broker already in the stack. Latency is a few milliseconds at these volumes, which is inside the 200ms budget in §11 with room to spare.
3. **Live match state stays in the process that owns the match**, with a `matches` row marking the owner. A match is a 70-second object; migrating it between nodes solves a problem that does not exist, and sticky sessions mean the players stay on the node anyway.
4. Configure **sticky sessions** at the load balancer for the socket path. WebSocket connections pin to a node and do not load-balance like HTTP — this must be in place before adding a second game node, not after. This is the item to get right; everything above is easier because of it.
5. **Leaderboards stay in MongoDB**, materialised hourly into `leaderboardSnapshots` with a stored `rank`. The pinned-row requirement (F6.6.4) is then a single indexed read of the viewer's own snapshot row rather than a rank computed at request time — the same constant-time answer a sorted set would give, from a table that already exists.

The API and game processes scale independently on different signals — API on request rate, game on concurrent sockets, which peaks sharply in the evening.

**When Redis would actually earn its place:** sustained above roughly 20,000
concurrent, where change-stream fan-out starts to cost more than a dedicated
pub/sub, or when matchmaking write contention shows up in MongoDB operation
time. Both are measurable. Adding it before either appears is buying
infrastructure against a forecast.

### v3 — beyond 20,000 concurrent

Shard game nodes by topic hash so a topic's queue lives on one node. Read replicas for MongoDB. Consider a separate analytics store rather than aggregating on the primary. This is also the point at which the Redis question above is worth re-asking with real numbers behind it.

---

## 13. Testing

| Layer | Coverage |
|---|---|
| Unit | Scoring, Elo, difficulty mix, question selection, streak logic |
| Integration | Auth flows, tenant guard, admin CRUD, CSV import validation |
| **Cross-tenant** | **Mandatory suite: a user in Space A is denied every Space B resource. Never skippable in CI.** |
| Socket | Two clients play a full 7-round match; assert every event, order, and payload |
| Ghost | A ghost match completes with correct timing and updates only the live player's rating |
| Anti-cheat | Late answers rejected, sub-300ms flagged, `correctIndex` absent from `round:start` |
| Reconnection | Disconnect at round 3, reconnect within grace, match continues correctly |
| Contest | The paper is frozen and identical for every entrant · one entry per student · Elo untouched but XP granted · the paper never leaks into ordinary play · the clock owns the lifecycle |
| Assignment | Ordinary play advances it with no submit step · accuracy needs both conditions · late is recorded, not refused · the denominator follows live membership |
| Review | An AI draft cannot reach `published` on its own · a sub-admin who may draft may not publish |
| Load | 1,000 concurrent matches sustained, latency measured |

The socket test that plays a complete match end to end is the single highest-value test in the suite. Write it first.

---

## 14. Observability

**Metrics:** active sockets, live matches, matches started and completed per minute, average queue time, **ghost ratio per topic**, answer round-trip latency, error rate by code, MongoDB operation time.

**Alerts:** ghost ratio above 80% on a topic with real traffic (liquidity failure) · match completion rate below 90% (engine bug) · answer latency p95 above 500ms · any cross-tenant denial test failing in CI · socket count within 20% of the process limit.

**Logging:** structured JSON. Every match logs one summary record on completion. Every admin action and every impersonation session writes to `auditLogs`.

---

## 15. Security checklist

- [ ] TLS everywhere on the API
- [ ] Tokens in `expo-secure-store`, never AsyncStorage
- [ ] Refresh rotation with reuse detection
- [ ] OTPs hashed, rate-limited, single-use
- [ ] Every space-scoped query filtered server-side by `spaceId`
- [ ] Cross-tenant denial suite green
- [ ] `correctIndex` absent from every pre-resolution payload
- [ ] Rate limits on OTP, queue join, report, and all admin write endpoints
- [ ] Uploads validated by content type and size; images re-encoded to strip metadata
- [ ] Fastify schema validation on every route
- [ ] Mongoose strict mode; no raw user objects passed to queries
- [ ] Admin actions and impersonation fully audit-logged
- [ ] Minor accounts excluded from contact discovery and public profile listing
- [ ] DPDP compliance: consent capture, data export, deletion with grace period
- [ ] Secrets in a manager, never in the repository
- [ ] Dependency scanning in CI

---

## 16. Environments and deployment

| Environment | Purpose |
|---|---|
| Local | `./run.sh setup` then `./run.sh dev` — both servers in one terminal, OTPs printed to the log. MongoDB on 27017, by brew service or `docker run -d -p 27017:27017 mongo:7`. |
| Staging | Production mirror, seeded data, TestFlight and internal Android track |
| Production | Blue-green for the API. Game process drained gracefully: stop accepting new matches, wait for live matches to finish, then cycle. |

**CI:** lint → unit → integration → **cross-tenant suite** → shared-code parity → build. No deploy proceeds on a red cross-tenant suite. `./run.sh check` runs the same sequence locally.

**Optional configuration.** Three settings are optional, and each degrades to a
stated behaviour rather than a crash: `FCM_SERVER_KEY` (without it a
notification is written to the in-app list and the push is skipped),
`ANTHROPIC_API_KEY` (without it AI drafting refuses with a message naming the
missing setting, rather than inventing questions), and `S3_*` (without it
uploads are stored on local disk). `config/env.js` refuses to start a
**production** process with a development JWT secret or `SMS_PROVIDER=console`.

**Mobile releases:** EAS Build for binaries, EAS Update for JavaScript-only changes. Anything touching the socket protocol requires a binary release and a version gate — the server must reject protocol versions it no longer supports with a clear upgrade prompt rather than a silent failure.

---

## 17. Build order

Do not build this in the order the PRD lists features. Build it in the order that de-risks it.

1. **Two clients play a complete 7-round match over sockets.** No auth, no database, hardcoded questions. This proves the hardest part first.
2. Persistence — models, real questions, match records.
3. Auth, profiles, topics, categories.
4. Matchmaking with live pairing.
5. Ghost matches. *The app is now genuinely usable.*
6. Ratings, XP, leaderboards.
7. Friends, challenges, notifications.
8. Superadmin portal and central question bank.
9. Spaces, tenant guard, cross-tenant test suite.
10. Admin portal.
11. Contests, assignments, item analysis.
12. Billing.

Step 1 is a weekend. If it does not feel good with two phones on a desk, nothing later fixes that — and it is far cheaper to learn it in week one than in month four.

**Built:** steps 1–11. Step 12 (billing) is the one gap — the plan and seat data
model exists and the seat limit is enforced on join, but no payment provider is
wired up, pending prd.md Q1.

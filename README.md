# Mimo

A real-time head-to-head trivia platform. Two players answer the same seven
questions on a chosen topic, simultaneously, scored on both correctness and
speed.

Built to [docs/prd.md](docs/prd.md) (what and why), [docs/design.md](docs/design.md)
(experience and visual system), and [docs/tech.md](docs/tech.md) (architecture).
Section references throughout this file — `tech.md §7.2`, `prd.md F6.4.14` — point
into those documents. Scope delivered: **Phase 1 (Public Arena),
Phase 2 (Institute Spaces) and Phase 3 (Depth)**.

```
backend/    Node + Fastify + Socket.IO + MongoDB — API and realtime game server
mobile/     Expo SDK 54 — the player app, and the role-gated admin shells
```

---

## Running it

You need **Node 20+** and **MongoDB on 27017**.

```bash
brew services start mongodb-community@7.0     # or:
docker run -d -p 27017:27017 --name mimo-mongo mongo:7
```

Then, from the repository root:

```bash
./run.sh setup     # install both, write backend/.env, seed the database
./run.sh dev       # start both, prefixed output, Ctrl-C stops everything
```

| Command | What it does |
|---|---|
| `./run.sh setup` | Install everything and seed. Run once. |
| `./run.sh dev` | API + Expo, in one terminal |
| `./run.sh backend` | Just the API and game server — http://localhost:4000 |
| `./run.sh mobile` | Just Expo — press `i` for iOS, `a` for Android |
| `./run.sh seed` | Re-seed, keeping the database |
| `./run.sh reseed` | Drop the database and seed from scratch |
| `./run.sh test` | Backend suite, the tenant lint rule, shared-code parity |
| `./run.sh check` | All of `test`, plus the mobile lint and expo-doctor |
| `./run.sh stop` | Free ports 4000 and 8081 |

Use separate terminals — `./run.sh backend`, `./run.sh mobile` — if you want
Expo's interactive keys.

Or run each folder directly: `cd backend && npm install && npm run dev`.

### Signing in

The seed prints these. **Any number, with OTP `000000`:**

| Number | Who | What they show you |
|---|---|---|
| `9000000001` | Superadmin | Institutes, Central bank, Moderation, Platform |
| `9000000005` | Institute admin | The full portal for Nalanda Coaching Centre |
| `9000000004` | Sub-admin | Meera — may draft questions, may **not** publish |
| `9000000002` | Student | Ananya — morning batch, 6-day streak, top of the contest |
| `9000000003` | Student | Rohan — evening batch |
| `9000000013` | Pending student | Riya — sitting in the approval queue |

In development the OTP is printed to the server log and returned in the API
response, so nothing needs an SMS account. Both are refused outside development
— `config/env.js` will not start a production process with `SMS_PROVIDER=console`
or a default `JWT_SECRET`.

### What the seed builds

`./run.sh reseed` writes a database you can actually explore, not a set of empty
states:

- **15 players** across five behavioural archetypes, **150 simulated matches**
  over the last 30 days, and **~300 replays** in the ghost pool — so the first
  match you play is against a real recorded human, which is the mechanic the
  whole product rests on.
- **7 topics**, 189 questions, all past the 21-question gate.
- An institute with **2 batches**, 7 students, 2 pending approvals, a sub-admin
  with narrowed permissions, and a second institute awaiting superadmin approval.
- **3 contests** — one finished with real standings, one open right now, one
  scheduled and batch-scoped.
- **3 assignments** — one satisfied, one in progress, one overdue.
- **6 AI-sourced drafts** waiting in the review queue.

The history is the point. Without it the dashboard has no chart, every
leaderboard is blank, item analysis has nothing to analyse, and the ghost pool
is empty. `--quick` skips it.

---

## What is where

### backend

```
src/
├── shared/       scoring, Elo, mastery, socket protocol   ← mirrored into mobile
├── game/         matchmaker, match engine, ghosts, socket gateway
├── models/       every collection in tech.md §3
├── services/     business logic — no HTTP or socket awareness
├── routes/       REST, plus /admin and /super behind role guards
├── middleware/   auth, tenant guard
├── jobs/         the scheduled work in tech.md §10
└── scripts/      seed, and the match-history simulator
```

The game module has no HTTP coupling (tech.md §1), so extracting it in v2 is a
deployment change rather than a rewrite. `GameOrchestrator` talks to an injected
transport; the socket gateway only translates frames.

### mobile

```
app/            expo-router screens — the player app
app/admin/      the institute admin shell
app/super/      the superadmin shell
src/shared/     ← byte-identical to backend/src/shared
src/theme/      design.md §3–5 as tokens
src/state/      auth and the game socket connection
src/components/ AnswerRow, DualCountdown, Icon, Brand, SpaceHome, and the rest
```

`app/match/play.jsx` is the product: scores, question, the dual countdown, four
answer rows. Nothing else.

One app, role-gated. An institute admin sees Dashboard / Questions / Review /
Topics / Students / Contests / Assignments / Reports / Settings; a superadmin
additionally sees Institutes / Central bank / Moderation / Platform / Progression;
a sub-admin sees only what their granular permissions allow. Hiding a route is a
convenience — the server enforces the role on every request regardless.

The screen that matters is `app/admin/question-edit.jsx`: the same OMR bubble
students see, and a live preview rendering the question in the game's dark theme
at real size, because admins write better questions when they can see the
ten-second reality of them (design.md §9.3).

The whole app is drawn from React Native views. There is no icon font, no SVG
runtime, no illustration bundle, and no gradient library — the icon set, the
brand mark, the three onboarding scenes and the indigo field are all
rectangles and circles. `src/components/Icon.jsx` is the constraint written
down: if a glyph cannot be made from four rectangles, it probably should not
be in a quiz app.

---

## The five things worth knowing

**1. The client and server run the same scoring code.**

tech.md §2 puts scoring and Elo in a shared package so a tap can show its points
immediately while the server stays the only authority. This repository is two
standalone folders rather than a workspace, so the guarantee is kept by
mirroring `src/shared` and failing the build if the copies diverge:

```bash
./run.sh test    # includes tests/shared-parity.test.js
```

Change one, change both.

**2. The tenant boundary is enforced in one place, and tested everywhere.**

`services/spaceService.resolveScope` is the only thing that turns a requested
`spaceId` into a usable one, and it validates against live memberships. Handlers
read `request.scope.spaceId`, never `request.params.spaceId`.

Two guards sit on top:

```bash
cd backend
npm run lint          # flags a space-scoped query with no spaceId filter
npm run test:tenant   # a Space A user is denied every Space B resource
```

The lint rule covers `Contest`, `ContestEntry`, `Assignment` and
`AssignmentProgress` as well as the Phase 2 models — contest standings and
assignment progress are the most sensitive per-student data an institute holds.
It accepts a `// tenant-ok: <reason>` comment for queries that are genuinely
cross-space. Writing the reason down is the point.

**3. `round:start` never contains `correctIndex`.**

tech.md §7.2 calls this the most important line in that document. The payload is
built from an explicit field list in `matchEngine.roundStartPayload`, and
`tests/anti-cheat.test.js` asserts the answer key, the option permutation, and
the explanation are all absent from every pre-resolution frame.

**4. A contest's paper is frozen, and it cannot leak.**

Every entrant sits the same questions in the same order — a standings table over
different papers ranks luck. The freeze is a conditional update, so the
lifecycle job and a very early entrant racing each other still produce one paper.

The replay pool is partitioned by `contestId` in **both** directions: a contest
run is never served to casual play, which would deal out the paper to someone
who never entered; and a contest entrant only ever faces other entrants, because
only they answered these questions. `tests/contest.test.js` asserts both.

**5. Nothing AI-drafted can reach a player without a human pressing publish.**

`aiDraftService` can only produce `in_review`, and has no path to `published`.
Publishing stays behind the `publishQuestions` permission, exactly as it is for
a question an admin typed by hand — so a sub-admin who may draft may not publish.

Without `ANTHROPIC_API_KEY` the endpoint refuses and names the missing setting.
It does **not** fall back to a local generator: filling an institute's review
queue with confident nonsense, for a reviewer skimming forty drafts, is worse
than no feature.

---

## Tests

```bash
./run.sh test         # the suite, the lint rule, and shared-code parity
cd backend
npm test              # 160 tests
npm run test:match    # the full-match socket test on its own
npm run test:tenant   # the cross-tenant suite on its own
npm run test:learning # contests, assignments and the review workflow
```

| Suite | Covers |
|---|---|
| `match-socket` | Two real clients play a complete 7-round match. tech.md §13 calls this the highest-value test in the suite. |
| `cross-tenant` | **Mandatory.** Every Space B surface denied to a Space A user, including contest standings, assignment progress, AI drafting, question selection and the socket queue. |
| `contest` | The paper is frozen and identical for every entrant · one entry per student · Elo untouched but XP granted · the paper never leaks · the clock owns the lifecycle · final ranks stop moving |
| `assignment` | Ordinary play advances it with no submit step · accuracy needs both conditions · late is recorded not refused · the denominator follows live membership |
| `review` | An AI draft cannot reach published on its own · a sub-admin who may draft may not publish · the queue is oldest-first |
| `anti-cheat` | Answer key absent, late answers rejected, sub-300ms flagged, handshake and protocol gate |
| `ghost` | Ghost served inside the deadline, replay preferred over synthetic, option remapping under a fresh shuffle |
| `reconnect` | Disconnect at round 3, reconnect within grace, match continues; beyond grace forfeits |
| `api` | OTP flow, refresh rotation with reuse detection, guest migration, admin CRUD, CSV import |
| `units` | Scoring, Elo, mastery, difficulty mix, streaks, validation, item analysis, CSV parsing |
| `shared-parity` | backend and mobile `src/shared` are byte-identical |
| `e2e-smoke` | Sign up → play a full match → read the review → appear on the leaderboard |

Rounds run at 400ms in tests rather than 10s, so a seven-round match takes about
three seconds. Everything else — the timers, the state machine, the network, the
database — is real.

---

## Decisions taken, and why

Three were settled before building; the rest were judgement calls where the
documents left room.

| Decision | Choice |
|---|---|
| Scope | Phase 1 + 2 + 3. Spaces is where the tenancy risk lives, so the cross-tenant suite exists from the start rather than being retrofitted. |
| **prd.md Q3** — language at launch | **English, i18n-ready schema.** Question text lives under a language key (`content.en`) rather than at the top level, so adding Hindi is an additive write instead of a migration across the match engine, the admin portal and every document. |
| Portals | One role-gated client. Originally a separate React SPA; now `app/admin` and `app/super` inside the Expo app, so there is one build, one session layer and one deploy, and superadmin impersonation stays trivial. |
| Public Arena identity | A real Space document with a fixed ObjectId, not a `null` sentinel. `spaceId` is then one type everywhere, so the tenant guard has one code path and the public scope is not a special case waiting to be forgotten. |
| Matchmaker timers | One shared tick rather than tech.md §8's per-player `setInterval`. Same widening behaviour and the same 3-second ghost deadline, but one timer in the process regardless of queue depth — tech.md's own commentary names orphaned timers as the likely leak here. |
| Question stats | Rolled up inline on match completion rather than on the 15-minute schedule of tech.md §10. Seven upserts once per match, item analysis is correct the moment a match ends, and no watermark is needed. A scheduled job reconciles drift. |
| **Scaling without Redis** | tech.md §12 originally reached for Redis at the service split. It now reaches for MongoDB: a `queueEntries` collection with an atomic `findOneAndDelete` for pairing, a change stream for cross-node fan-out, and leaderboard snapshots with a stored rank for the pinned row. One datastore, already operated, and no class of bug where the two disagree. §12 names the volume at which that trade stops being right. |
| Contest rating | A contest never moves Elo. prd.md §6.3 gives the contest match its own standings, and a student's public rating must not move because their institute set a hard paper. XP and mastery still accrue — they measure play, not skill. |
| Assignment counters | No stored `assigned` / `completed` figure. Who an assignment is for is a function of live membership, and a stored denominator is wrong the moment a student joins, leaves or changes batch. Both are counted at read time. |
| Protocol version | Bumped to **2** for `contest:enter`; minimum stays at **1**. Both changes are additive, so a version-1 client keeps playing. The gate refuses clients the server cannot serve, not clients that are merely old. |
| **The v2 visual system** | Light and indigo, replacing v1's dark petrol and amber. design.md §2.4 argues it: the old direction had to be explained before a player's first match, and it fought the half of the product that is coursework — assignments, contests, and a review screen meant to be read at length. What survived is what was load-bearing: the OMR bubble, the dual countdown, colour discipline, one primary button per screen. |
| Four option colours | Adopted the quiz-app convention — A blue through D green — because the audience already reads it fluently. They are **positional, never a verdict**: a red option is the second option, not a wrong one. `--correct` and `--wrong` are separate values so an option that happens to be green never reads as pre-marked. |
| Unchosen rows recede | At resolution the rows the player did not take drop to 40% rather than turning red. Exactly one option was wrong; colouring three of them as failures teaches the wrong lesson and buries the answer they are meant to take away. |
| The tab bar's centre button | Play is a raised button, not a fifth tab, because everything else in the app is somewhere you can *be* and Play is something you *do*. It opens a sheet rather than a tab, so it has no selected state to get wrong — and it rises into a transparent band belonging to the bar, since on Android a view drawn outside its parent renders but never receives a touch. |

---

## Deferred, and what it would take

**Billing.** prd.md §11 is firm that institute billing must be live in Phase 2.
The plan and seat data model is here and the seat limit is enforced on join, but
no payment provider is wired up — that needs a commercial decision on Q1
(per-seat, flat tier, or hybrid) first. This is the one gap in the delivered
scope.

**Native push.** `expo-notifications` is installed and the server writes every
notification to the in-app list, honouring per-category toggles and quiet hours.
Delivery needs an FCM server key; without one the send is logged and skipped
rather than throwing.

**PDF export.** prd.md F8.6.6 asks for CSV *and* PDF. Every report exports CSV
today, and the portal is print-styled (`@media print` in `styles.css`) so a
browser print-to-PDF is correct — but there is no server-side PDF renderer.

**The service split.** `game/registry.js` and `game/matchmaker.js` are behind
narrow interfaces for exactly this, and tech.md §12 now describes the path
without a second datastore. Sticky sessions are the part to get right before
adding a second game node, not after.

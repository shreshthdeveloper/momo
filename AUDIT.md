# Momo — End-to-End Code Audit

**Scope:** `backend/` (Fastify + Socket.IO + MongoDB) and `mobile/` (Expo / React Native).
**Goal:** logical bugs, gaps, dead code, and backend↔mobile contract mismatches.

## Summary

The codebase is unusually high quality: the `backend/src/shared/` and `mobile/src/shared/`
trees are byte-identical (enforced by [backend/tests/shared-parity.test.js](backend/tests/shared-parity.test.js)),
the socket protocol is versioned, and most historical bugs are already documented as fixed in
inline comments. A full sweep for `TODO`/`FIXME`/`HACK`/`placeholder` came back empty.

That said, the audit found real feature-level defects, backend↔mobile contract divergences,
effectively-dead server code, and a set of lower-severity logic bugs. None are exploitable
security holes; the "High/Medium" items are places where a whole feature silently does nothing —
or does the wrong thing — in production.

A second, deeper file-by-file pass (every route, service, job, model, middleware and mobile
screen read individually) added findings **B3–B8** and **D2** — see **[Part 3](#part-3--additional-verified-defects-deep-file-by-file-pass)**. The route-by-route
functionality-gap analysis is in **[Part 2](#part-2--backend--mobile-functionality-gaps-route-by-route)**.

| # | Severity | Category | Finding |
|---|----------|----------|---------|
| B1 | Medium | Logical bug | Replay `country`/`city` are always `null` (engine summary drops the fields) |
| B2 | High | Gap (backend↔mobile) | Push notifications are dead end-to-end — the app never registers a device token |
| B2a | Medium | Bug / tech-debt | Backend push uses Google's decommissioned **legacy** FCM HTTP API |
| B3 | Medium | Data-corruption risk | Monthly soft-reset can **halve every rating twice** if the process dies mid-cycle |
| B4 | Low–Med | Logical bug | The `streak_7` achievement is awarded one match **late** (reads the pre-match streak) |
| B5 | Low | Logical bug | The daily streak-break job wrongly zeroes streaks of players active in the 00:00–00:05 IST window |
| B6 | Low | Logical bug | Overall leaderboard `total` (and off-page rank) count deleted/banned users the rows exclude |
| B7 | Low | Logical bug | Contest `stats.entrants` is never incremented (`$inc: 0`) — list views read `0` mid-contest |
| B8 | Low–Med | Config bug | Per-account rate limiting is silently disabled — the limiter is effectively IP-only |
| C1 | Medium | Contract divergence | "Opponent wants a rematch" is emitted by the server but ignored by the app |
| C2 | Low | Smell | Resume snapshot is pushed on a **client→server** event constant |
| D1 | Low | Dead code | Server `match:resume` request handler is never invoked by the client |
| D2 | Low | Dead code | Space-home brand spread `...space.toBrand?.()` runs on a `.lean()` doc → no-op |
| O1 | Low | Observation | Void (double-disconnect) ranked matches still pay draw coins |
| O2 | Low | Observation | Daily job scheduler can skip/duplicate a run under timer drift |

---

## B1 — Replay `country` / `city` are always `null` (Medium, logical bug)

**Where**
- [backend/src/game/matchEngine.js](backend/src/game/matchEngine.js#L446-L463) — `complete()` builds `summary.players`
- [backend/src/services/matchService.js](backend/src/services/matchService.js#L619-L620) — `maybeCreateReplays()` reads those fields

**What**
The live-match player objects are constructed *with* `country` and `city`
([matchEngine.js](backend/src/game/matchEngine.js#L99-L100)):

```js
country: p.country ?? null,
city: p.city ?? null,
```

But when the match ends, the `summary.players` mapping in `complete()` copies only
`userId, displayName, avatarUrl, isGhost, sourceMatchId, rating, level, score, correctCount,
forfeited, flags` — it **omits `country` and `city`**.

`maybeCreateReplays()` then stores the replay geo from that summary object:

```js
/** So a future opponent gets the same flag a live one would have. */
country: player.country ?? null,   // player here is a summary.players element → undefined
city: player.city ?? null,          // → undefined → null
```

Because `player` is a `summary.players` element (which never carried the fields), both fall
back to `null` on **every** replay that is ever written.

**Impact**
Ghost opponents are hydrated from these replays. The comment's stated intent — *"So a future
opponent gets the same flag a live one would have"* — is defeated: a ghost never has a stored
country, so it inherits the waiting player's own country downstream. That is both a data-quality
loss and a subtle "ghost tell" (a ghost's flag will systematically match the local player rather
than the original recorded player).

**Fix**
Add the two fields to the `summary.players` map in `complete()`:

```js
players: this.players.map((p) => ({
  userId: p.userId,
  displayName: p.displayName,
  avatarUrl: p.avatarUrl,
  country: p.country ?? null,   // add
  city: p.city ?? null,         // add
  isGhost: p.isGhost,
  // …unchanged…
})),
```

---

## B2 — Push notifications are dead end-to-end (High, gap)

**Where**
- Backend (fully implemented): [backend/src/services/notificationService.js](backend/src/services/notificationService.js#L54-L97), token endpoints in [backend/src/routes/me.js](backend/src/routes/me.js)
- Mobile (missing): no source under `mobile/app/**` or `mobile/src/**` registers a token

**What**
The backend has a complete push pipeline: `notify()` → `sendPush()`, quiet-hours gating,
per-type preference gates, and `POST`/`DELETE /me/push-token` to store device tokens on
`user.pushTokens`. `sendPush()` early-returns when the user has no tokens
([notificationService.js](backend/src/services/notificationService.js#L66)).

On the mobile side, `expo-notifications` appears **only** in config
([mobile/app.json](mobile/app.json#L56), [mobile/package.json](mobile/package.json#L31)) and
build artifacts. A full search for `getExpoPushToken` / `getDevicePushToken` /
`setNotificationHandler` / `registerForPush` / `push-token` across `mobile/app` and `mobile/src`
returns **zero** matches. The app never requests notification permission, never obtains a device
token, and never calls `POST /me/push-token`.

**Impact**
No device token ever reaches the backend, so `user.pushTokens` is always empty and `sendPush()`
always no-ops. Every push path (rematch/reaction, contest, assignment, streak-at-risk,
achievement, level-up, etc.) is silently non-functional. The in-app notification **inbox** still
works — only OS push is dead — which makes the gap easy to miss.

**Fix**
Add a registration step on the mobile side (typically after login / on the notifications-settings
screen): request permission via `expo-notifications`, obtain the device push token, and `POST` it
to `/me/push-token`; `DELETE` it on logout.

---

## B2a — Backend push uses the decommissioned legacy FCM HTTP API (Medium)

**Where**
[backend/src/services/notificationService.js](backend/src/services/notificationService.js#L83-L86)

**What**
```js
const res = await fetch('https://fcm.googleapis.com/fcm/send', {
  headers: {
    authorization: `key=${env.FCM_SERVER_KEY}`,
```

This is the **legacy FCM HTTP API** with a static server key. Google shut this API down in
June 2024. Even once B2 is fixed (a token is registered), delivery would fail against this
endpoint.

**Fix**
Move to FCM HTTP v1 (`https://fcm.googleapis.com/v1/projects/<id>/messages:send`) with an OAuth2
service-account bearer token — or, since the app is Expo, use the Expo Push API
(`https://exp.host/--/api/v2/push/send`) with Expo push tokens, which pairs naturally with the
missing mobile registration in B2.

---

## C1 — "Opponent wants a rematch" is emitted but never surfaced (Medium, contract divergence)

**Where**
- Backend: [backend/src/game/orchestrator.js](backend/src/game/orchestrator.js#L859-L861) (`requestRematch`)
- Mobile: [mobile/src/state/game.jsx](mobile/src/state/game.jsx#L344)

**What**
When one player presses **Rematch** and the other has not yet, the server notifies the other side
by re-using the `MATCH_OPPONENT_REJOINED` event with a rematch payload:

```js
this.transport.toPlayer(them.userId, S2C.MATCH_OPPONENT_REJOINED, {
  matchId,
  rematchRequested: true,
  from,
});
```

The mobile handler for that same event only tracks reconnection and **discards** the payload:

```js
socket.on(S2C.MATCH_OPPONENT_REJOINED, () => patch({ opponentConnected: true }));
```

`rematchRequested` and `from` are never read anywhere in the app.

**Impact**
The event is overloaded to mean two different things ("opponent reconnected" vs. "opponent wants a
rematch"), and the app only implements the first meaning. The "ask the other side" half of the
rematch protocol is silent: player B is never prompted. A human-vs-human rematch only happens if
**both** players independently press Rematch (each press is recorded server-side and the pairing
fires on the second). The intended one-tap "your opponent wants a rematch" prompt never appears.

**Fix**
Either give rematch requests their own S2C event, or have the mobile handler branch on the
payload: when `rematchRequested` is truthy, raise the rematch prompt / takeover instead of just
setting `opponentConnected`.

---

## C2 — Resume snapshot is pushed on a client→server event constant (Low, smell)

**Where**
- [backend/src/game/socketGateway.js](backend/src/game/socketGateway.js#L147)
- [backend/src/shared/protocol.js](backend/src/shared/protocol.js#L34)

**What**
On reconnect the server pushes the resume snapshot using a **C2S** (client→server) constant:

```js
socket.emit(C2S.MATCH_RESUME, resumed);
```

`MATCH_RESUME` is defined only in the `C2S` map (`'match:resume'`); there is no `S2C.MATCH_RESUME`.
It works purely because the mobile listener subscribes to the same string literal.

**Impact**
No runtime bug — just a semantic inconsistency. Every other server push uses an `S2C.*` constant;
this one borrows a client→server name, which is a trap for the next person touching the protocol.

**Fix**
Add an `S2C.MATCH_RESUME` (same `'match:resume'` string) and emit that, so directionality of the
constant matches its use.

---

## D1 — Server `match:resume` request handler is never invoked by the client (Low, dead code)

**Where**
[backend/src/game/socketGateway.js](backend/src/game/socketGateway.js#L235-L237)

**What**
The gateway registers an inbound handler that answers a `match:resume` **request** with a snapshot
via ack:

```js
socket.on(
  C2S.MATCH_RESUME,
  guard(C2S.MATCH_RESUME, async () => {
    const snapshot = orchestrator.snapshotFor(user.id);
    // …returns { snapshot } via ack
```

The mobile client never **emits** `MATCH_RESUME` — it only listens for the server-pushed snapshot
(see C2). The server already pushes the snapshot automatically on reconnect, so the request path is
only ever exercised by tests.

**Impact**
Dead in production. Harmless, but it's the other half of the C2 confusion (one event name used for
both a server push and an unused client request).

**Fix**
Either remove the handler, or keep it intentionally and document it as a client-initiated
re-sync fallback (and actually call it from the app).

---

## O1 — Void ranked matches still pay draw coins (Low, observation)

**Where**
- [backend/src/shared/mastery.js](backend/src/shared/mastery.js) (`coinsForMatch`)
- [backend/src/services/matchService.js](backend/src/services/matchService.js) (`finalizeMatch`)

**What**
When both players disconnect, the match is voided: `isVoid = true`, ratings don't move, and
`match:end` reports `ranked: false`. But finalization still computes coins from
`coinsForMatch({ verdict: 'draw', mode: RANKED })`, which returns the ranked-draw amount (25). So a
match that "didn't count" still credits both accounts.

**Impact**
Minor economic inconsistency: two players who both rage-quit/drop each still earn draw coins for a
match that produced no rating change and is flagged unranked. Low value, but easy to exploit for
slow coin farming and inconsistent with the "unranked" flag on the same result.

**Fix**
Short-circuit coins to `0` (or a fixed participation floor) when `summary.isVoid` is true.

---

## O2 — Daily job scheduler can skip or duplicate a run under drift (Low, observation)

**Where**
[backend/src/jobs/index.js](backend/src/jobs/index.js#L42-L55)

**What**
`dailyAt()` runs a `setInterval(MINUTE)` tick and fires the job only when the current IST
hour+minute equal the target:

```js
const now = new Date(Date.now() + 330 * MINUTE);
if (now.getUTCHours() !== istHour || now.getUTCMinutes() !== istMinute) return;
```

The interval isn't aligned to wall-clock minute boundaries, so accumulated timer drift can land the
tick just before and just after the target minute (running twice) or straddle it (running zero
times). The jobs are idempotent, so a double run is safe; a **skipped** run is the real risk.

**Impact**
Occasional missed daily job on a long-lived process. Low severity given idempotency and that this
is an explicitly "minimal" scheduler, but worth hardening if the daily jobs become important.

**Fix**
Track the last-fired IST day-key and fire when `hour >= target && dayKey !== lastFired`, rather than
requiring an exact minute match.

---

## Areas checked and found clean

- **Shared code parity** — `backend/src/shared` vs `mobile/src/shared` are byte-identical and
  parity-tested.
- **Socket contract** — every `S2C.*` the backend emits is handled by the app, and every `C2S.*`
  the app emits is handled by the backend (the only anomalies are C1/C2/D1 above).
- **Notification type map** — almost every notification `type` the backend emits
  (`friend_request`, `friend_accepted`, `friend_reaction`, `challenge`, `chest`, `achievement`,
  `level_up`, `contest_open`, `contest_starting`, `contest_result`, `assignment_due`,
  `space_approved`, `streak_at_risk`, `announcement`) has a matching glyph in the mobile
  `FACES`/`faceFor` map. The one exception is `moderation_warning` (see G-Minor below), which
  falls back to the generic bell icon.
- **Match finalization** — `updatePlayerProfile` merges into the same `outcome` object referenced
  by `perPlayer`, so `accountLevelBefore`/coins/unlock fields reach `match:end` correctly.
- **Server & jobs wiring** — `createSocketGateway` is attached to the shared HTTP server, jobs are
  gated behind `env.ENABLE_JOBS`, and shutdown drains matches before closing.
- **Config drift endpoint** — `GET /config/progression?token=` returns `{ unchanged: true }` and
  the mobile `progression` screen handles that path.

---

# Part 2 — Backend ↔ Mobile Functionality Gaps (route-by-route)

This part is a complete cross-reference of **every** backend REST endpoint against **every**
mobile API call, screen by screen.

### Why "no mobile caller" means "unreachable feature" here

The architecture docs are explicit that there is **only one client**:

- [docs/tech.md](docs/tech.md#L20) — *"Admin portal | Expo Router screens inside the mobile app
  (`app/admin`, `app/super`) | One client, not two."*
- [README.md](README.md#L256) — *"One role-gated client. Originally a separate React SPA; now
  `app/admin` and `app/super` inside the Expo app…"*

There is no `web/` app in the repository. So when a backend endpoint has **no** caller anywhere in
`mobile/`, the capability is genuinely unreachable — it is not "served to the web portal instead."
That is what makes the admin/superadmin gaps below real product gaps rather than harmless
dead code.

The mobile calls were taken from `mobile/src/lib/api.js` (`get/post/patch/delete` + the
`uploadImage` raw-fetch helper) and every screen under `mobile/app/**`. The backend surface was
taken from all 13 route files under `backend/src/routes/`.

## G1 — Superadmin: backend features with no `app/super` screen

| Endpoint | Feature (PRD) | Mobile status | Severity |
|----------|---------------|---------------|----------|
| `POST /super/announce` | Broadcast an announcement to all users / a segment (F9.4.5) | No compose screen anywhere in `app/super` | **High** |
| `GET /super/audit` | Platform-wide audit log | No screen (admin audit *is* shown, super audit is not) | Medium |
| `PATCH /super/spaces/:id/plan` | Change a tenant's tier / seat limit after creation (F9.1) | [tenants.jsx](mobile/app/super/tenants.jsx) shows `plan.tier` read-only; no edit | Medium |
| `PUT /super/progression/divisions` | Tune division count & width | [progression.jsx](mobile/app/super/progression.jsx) edits curve/leagues/cosmetics/chests but never divisions | Low–Med |

- Backend: [backend/src/routes/super.js](backend/src/routes/super.js#L537) (`/announce`),
  [super.js](backend/src/routes/super.js#L795) (`/audit`),
  [super.js](backend/src/routes/super.js#L221) (`/plan`),
  [super.js](backend/src/routes/super.js#L672) (`/divisions`).
- The superadmin can create tenants, approve/reject/impersonate, moderate, tune cosmetics and
  leagues, and read analytics — but **cannot** send the platform announcement the backend fully
  implements (segment filter, rate-limit, per-user `notify`), cannot re-plan a tenant once it
  exists, and cannot read the platform audit trail.

## G2 — Admin: backend features with no `app/admin` screen

| Endpoint(s) | Feature (PRD) | Mobile status | Severity |
|-------------|---------------|---------------|----------|
| `POST /admin/ai/draft`, `GET /admin/ai/status` | AI question drafting (F8.2.6) | [review.jsx](mobile/app/admin/review.jsx) *reviews* AI drafts, but nothing on mobile can **generate** them | **High** |
| `PATCH /admin/contests/:id`, `PUT /admin/contests/:id/questions`, `GET /admin/contests/:id/standings` | Edit a contest, hand-curate its paper (F8.5.2), view admin standings (F8.5.3) | [contests.jsx](mobile/app/admin/contests.jsx) only lists / finalises / deletes; [contest-new.jsx](mobile/app/admin/contest-new.jsx) only creates | **High** |
| `GET /admin/assignments/:id`, `PATCH /admin/assignments/:id`, `DELETE /admin/assignments/:id` | Per-student assignment progress, edit, archive (F8.5.5–6) | [assignments.jsx](mobile/app/admin/assignments.jsx) only lists; [assignment-new.jsx](mobile/app/admin/assignment-new.jsx) only creates | **High** |
| `GET/POST/DELETE /admin/batches` | Batch (class/section) management (F8.4.5) | No batch screen at all — yet topics, contests and assignments all reference `batchIds`, so batch-scoping can be *stored* but never *managed* from the client | Med–High |
| `POST /admin/students/:membershipId/batch`, `GET /admin/students/:userId/report` | Reassign a student's batch; per-student report (F8.4) | [students.jsx](mobile/app/admin/students.jsx) approves/rejects only; no student detail, no standalone batch move | Medium |
| `GET /admin/reports/queue`, `POST /admin/reports/:id/resolve` | The space's own reported-question moderation queue (§8.6) | [reports.jsx](mobile/app/admin/reports.jsx) shows analytics tabs (items/topics/batches/trends) only — no report inbox | Medium |
| `GET /admin/reports/students.csv`, `GET /admin/contests/:id/standings.csv`, `GET /admin/assignments/:id/progress.csv`, `GET /admin/questions/import/template`, `POST /admin/questions/import/errors.csv` | CSV exports / template (F8.6.6) | No download path on mobile — and there is no other client | Low |

- Backend refs: [adminLearning.js](backend/src/routes/adminLearning.js#L339) (`/ai/draft`),
  [adminLearning.js](backend/src/routes/adminLearning.js#L141) (`/contests/:id/questions`),
  [adminLearning.js](backend/src/routes/adminLearning.js#L225) (`/assignments/:id`),
  [admin.js](backend/src/routes/admin.js#L721) (`/batches`),
  [admin.js](backend/src/routes/admin.js#L823) (`/reports/queue`),
  [admin.js](backend/src/routes/admin.js#L855) (`/reports/:id/resolve`).
- The two biggest holes: **(a)** the AI-drafting loop is only half-wired — a reviewer can approve
  machine drafts but no one can ask the machine for any; **(b)** contests and assignments are
  create-only on mobile — once made, they cannot be edited, their papers cannot be hand-curated,
  and an admin cannot see who has actually completed an assignment.

## G3 — Player: backend features with no mobile UI

| Endpoint(s) | Feature (PRD) | Mobile status | Severity |
|-------------|---------------|---------------|----------|
| `GET /me/blocked`, `POST /me/blocked/:userId`, `DELETE /me/blocked/:userId` | Block / unblock a user (F6.8.4) | No block action — [user/[id].jsx](mobile/app/user/[id].jsx) offers Add friend / Say something / Challenge only. (`constants.js` even advertises *"a block list that actually works"*.) | Medium |
| `DELETE /friends/:userId` | Remove a friend | [friends.jsx](mobile/app/(tabs)/friends.jsx) has accept/decline/challenge but no unfriend | Medium |
| `POST /me/restore` | Cancel a pending account deletion | [settings.jsx](mobile/app/settings.jsx) calls `DELETE /me` but offers no undo path | Medium |
| `POST /me/logout-all` | Sign out of every device / revoke sessions | No control in settings | Low–Med |
| `POST /spaces/:spaceId/join` | Join via invite-link / QR that resolves to a space id (F6.1.5) | Mobile joins by 6-char code only (`POST /spaces/join`); the id-based path is unused | Low |

- Backend refs: [me.js](backend/src/routes/me.js#L388) (blocking),
  [social.js](backend/src/routes/social.js#L72) (unfriend),
  [me.js](backend/src/routes/me.js#L84) (`/me/restore`),
  [me.js](backend/src/routes/me.js#L93) (`/me/logout-all`),
  [spaces.js](backend/src/routes/spaces.js#L76) (id-based join).
- `POST /me/push-token` / `DELETE /me/push-token` are also uncalled, but that is already covered as
  **B2** in Part 1 (push notifications dead end-to-end).

## G4 — Dead / redundant backend endpoints (no client at all)

Because the mobile app is the only client, these are effectively dead — a second endpoint that does
what the mobile already does a different way:

| Endpoint | Why it's unused | What mobile does instead |
|----------|-----------------|--------------------------|
| `POST /admin/questions/validate` | Live editor validation | Mobile reads the `warnings` array already returned by `POST`/`PATCH /admin/questions` |
| `POST /admin/questions/:id/status` | Single-question status change | Mobile uses `PATCH /admin/questions/:id` (with `status`) and `POST /admin/questions/bulk` |
| `POST /admin/questions/:id/duplicate` | Duplicate a question | Mobile only ever calls `POST /admin/questions/:id/fork` |

- Refs: [admin.js](backend/src/routes/admin.js#L142) (`/validate`),
  [admin.js](backend/src/routes/admin.js#L165) (`/:id/status`),
  [admin.js](backend/src/routes/admin.js#L209) (`/:id/duplicate`).
- These are safe to keep, but if the "one client" rule holds they will never be exercised outside
  tests — worth either deleting or consciously reserving.

## G-Minor — `moderation_warning` notification has no mobile icon

`POST /super/moderation/reports/:id/resolve` with `action: 'warn_user'` sends a notification of
type `moderation_warning`
([super.js](backend/src/routes/super.js#L399)), but the mobile `FACES` map in
[notifications.jsx](mobile/app/notifications.jsx) has no entry for it, so it renders with the
generic bell icon instead of a moderation-specific glyph. Cosmetic only — the notification still
appears and reads correctly.

## Coverage confirmation — endpoints that DO line up

For completeness, these mobile calls were each matched to an existing backend route with a
compatible contract (no gap):

- **Auth / profile:** `POST /auth/otp/send`, `POST /auth/otp/verify`, `GET /auth/session`,
  `GET /me`, `PATCH /me`, `GET /me/export`, `DELETE /me`.
- **Play / catalog:** `GET /home`, `GET /topics`, `GET /topics/:id`,
  `GET /leaderboards/overall`, `GET /leaderboards/topic/:topicId`, `GET /matches`,
  `GET /matches/:id`.
- **Economy / progression:** `GET /me/stats`, `GET /me/topics`, `GET /me/rewards`,
  `POST /me/chests/:key/claim`, `POST /me/shop/buy`, `GET /me/interests/candidates`,
  `PUT /me/interests`, `GET /config/progression`.
- **Social:** `GET /users/search`, `GET /users/:id`, `GET /friends`, `GET /friends/suggestions`,
  `POST /friends/request`, `POST /friends/:id/accept`, `POST /friends/:id/decline`,
  `POST /friends/:userId/react`, `GET /challenges`, `POST /challenges`,
  `POST /challenges/:id/accept|decline|cancel`, `POST /reports`, `GET/POST /me/notifications(/read)`.
- **Spaces:** `GET /spaces/mine`, `GET /spaces/lookup/:code`, `POST /spaces/join`,
  `DELETE /spaces/:spaceId/membership`, `GET /spaces/:spaceId/home|contests|assignments`,
  `GET /spaces/:spaceId/contests/:contestId/standings`.
- **Admin:** dashboard, questions (list/get/create/patch/bulk/fork), CSV import
  (validate/commit), categories (list/create), topics (list/create/patch), students
  (list/decision), invite (get/rotate), settings (get/patch), admins, audit, reports
  (items/topic/batches/periods), review (get/batch), contests (create/list/finalise/delete),
  assignments (list/create), and `POST /uploads/:kind`.
- **Superadmin:** central summary + feature, analytics + liquidity, system, moderation
  (reports/flags/resolve), users status, tenants (list/create/decision/impersonate), and the
  progression writers (curve, leagues, cosmetics ±delete, chests ±delete).

---

# Part 3 — Additional verified defects (deep file-by-file pass)

This part is the result of reading **every** backend file (all routes, services, jobs, models,
middleware, `app.js`/`server.js`) and the mobile screens/state individually, rather than tracing
one feature at a time. Each finding below was confirmed against the source and its call sites.

## B3 — Monthly soft-reset can halve every rating twice after a crash (Medium, data-corruption risk)

**Where**
- [backend/src/services/seasonService.js](backend/src/services/seasonService.js#L122-L127) — `runMonthlyCycle()`
- [seasonService.js](backend/src/services/seasonService.js#L143-L152) — `runMonthlyCycleIfDue()` (the re-run guard)

**What**
The monthly turnover is guarded against double-running by checking whether this month's chests
already exist:

```js
export async function runMonthlyCycleIfDue() {
  const period = currentPeriod();
  const current = await Chest.countDocuments({ period });
  if (current > 0) return { period, ran: false };   // ← the guard
  …
  const result = await runMonthlyCycle();
```

But inside `runMonthlyCycle()` the **non-idempotent** step runs *before* the marker that guard
reads is written:

```js
const archived = await archiveMonth({ at });        // idempotent
const reset    = softReset ? await softResetRatings() : { reset: 0 };  // ← NOT idempotent
const chests   = await ensureMonthlyChests({ period });                // ← writes the period marker
```

The function's own doc-comment says the soft reset is *"guarded on the period having actually
changed, recorded by the caller"* — but the record (`ensureMonthlyChests`) is written on the line
**after** the step it is meant to protect.

**Impact**
If the process crashes or is redeployed in the window between `softResetRatings()` and
`ensureMonthlyChests()`, no chest carries the new period, so the next hourly `runMonthlyCycleIfDue`
tick sees `count === 0`, treats the month as un-run, and calls `runMonthlyCycle()` again —
halving every player's ranked rating a **second** time (e.g. 1400 → 1300 → 1250). That is a
platform-wide ladder corruption, once a month, in a real (if narrow) crash window. `softResetRatings`
is explicitly called out in the same file as the one step *"running it twice would halve every
rating twice."*

**Fix**
Write the period marker (or a dedicated `seasonRun` record) **before** `softResetRatings()`, or make
the soft reset idempotent by keying it on a stored "last reset period" per user so a re-run is a
no-op.

## B4 — The `streak_7` achievement is awarded one match late (Low–Med, logical bug)

**Where**
- [backend/src/services/achievementService.js](backend/src/services/achievementService.js#L55) — the check
- [backend/src/services/matchService.js](backend/src/services/matchService.js#L356) — the advanced streak is computed
- [matchService.js](backend/src/services/matchService.js#L391-L399) — but the stale `user` is passed to the evaluator

**What**
`updatePlayerProfile` advances the streak into a **local** variable, then calls
`evaluateAchievements` with the still-unmodified `user` document:

```js
const streak = advanceStreak(user.streak, new Date(summary.completedAt));  // 356 — the NEW streak
…
const earned = await evaluateAchievements({ user, verdict, /* … */ });      // 391 — user.streak is still OLD
```

Inside the evaluator:

```js
if (level >= 10) award('topic_level_10');                 // uses the POST-match level (passed in) ✓
if ((user.streak?.current ?? 0) >= 7) award('streak_7');  // uses the PRE-match streak ✗
if ((user.matchesPlayed ?? 0) + 1 >= 100) award('centurion');  // compensates with +1 ✓
```

`user.streak.current` is the value loaded before the match, and the advanced `streak` is never
passed in. Note the inconsistency with the two lines around it, which correctly use the post-match
`level` and a `+1` compensation.

**Impact**
On the very match that reaches a 7-day streak, `user.streak.current` still reads `6`, so the badge
is **not** granted. It is only picked up on the next qualifying match (when the pre-match streak
finally reads `7`) — and if the streak breaks first, never. The badge fires late.

**Fix**
Pass the advanced streak to the evaluator (e.g. `streak: streak.current`) and test that, or compute
`advanceStreak` before `evaluateAchievements` and mutate `user.streak` first.

## B5 — Daily streak-break job zeroes streaks of players active just after midnight (Low, logical bug)

**Where**
[backend/src/jobs/index.js](backend/src/jobs/index.js#L294-L300) — `evaluateStreaks()`, scheduled at `dailyAt(0, 5, …)`

**What**
```js
export async function evaluateStreaks() {
  const yesterday = istYesterdayKey();
  const result = await User.updateMany(
    { 'streak.current': { $gt: 0 }, 'streak.lastPlayedOn': { $nin: [yesterday, null] } },
    { $set: { 'streak.current': 0 } },
  );
```

The job runs at 00:05 IST. A player who finished a match between 00:00 and 00:05 has
`streak.lastPlayedOn === today`, which is neither `yesterday` nor `null`, so they match the filter
and their **just-extended** streak is reset to `0`.

**Impact**
Any player active in that five-minute post-midnight window loses their streak — the opposite of
what the job is for. Small window, but a real correctness bug (and a bad one to be on the receiving
end of).

**Fix**
Exclude today's key too: `'streak.lastPlayedOn': { $nin: [todayKey(), yesterday, null] }`.

## B6 — Overall leaderboard `total` and off-page rank count deleted/banned users (Low, logical bug)

**Where**
[backend/src/services/leaderboardService.js](backend/src/services/leaderboardService.js#L188) — the rows filter
vs. [leaderboardService.js](backend/src/services/leaderboardService.js#L221-L223) — the total count

**What**
The visible rows exclude deleted/banned accounts:

```js
{ $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
{ $unwind: '$user' },
{ $match: { 'user.status': { $nin: ['deleted', 'banned'] } } },   // rows only
```

But the paired `total` count — and the off-page viewer-rank (`above`) aggregation — never join
`users` or apply that status filter:

```js
Rating.aggregate([{ $match: match }, { $group: { _id: '$userId' } }, { $count: 'n' }]),  // no status filter
```

**Impact**
`total` is inflated relative to the rows that are actually shown, so pagination can advertise more
players than exist and the last page comes up short or empty. The same omission in the `above`
aggregation can push a viewer's off-page rank higher than their true position (deleted/banned
accounts counted as "above" them).

**Fix**
Apply the same `$lookup` + `user.status` `$nin` filter in the count and the `above` pipelines (or
factor the audience filter so all three share it).

## B7 — Contest `stats.entrants` is never incremented (Low, logical bug)

**Where**
- [backend/src/services/contestService.js](backend/src/services/contestService.js#L525) — the no-op `$inc`
- [contestService.js](backend/src/services/contestService.js#L467-L485) — `openEntry` (also never increments it)

**What**
```js
await Contest.updateOne(
  { _id: oid(contestId), spaceId: oid(spaceId) },
  {
    $set: { 'stats.completed': row?.n ?? 0, /* … */ },
    $inc: { 'stats.entrants': 0 },        // ← increments by zero: a no-op
  },
);
```

`stats.completed` is recomputed on every finished run, but `stats.entrants` is incremented by `0`,
and `openEntry` (which actually creates the entry row) never touches it either. So the stored
`stats.entrants` stays at its seed value throughout a live contest.

**Impact**
The contest **list** views (`shapeContest` / `listContestsForStudent`) read `stats.entrants` and
therefore show `entrants: 0` while `stats.completed` climbs above it — a visibly inconsistent
"0 entrants, 5 completed". The single-contest `getContest` masks it by overriding with a live
`countDocuments`, so only the list surfaces the bug.

**Fix**
Increment `stats.entrants` in `openEntry` (`$inc: { 'stats.entrants': 1 }`), or recompute it from
`ContestEntry.countDocuments` in `recordEntryResult` the way `getContest` already does.

## B8 — Per-account rate limiting is silently disabled (Low–Med, config bug)

**Where**
[backend/src/app.js](backend/src/app.js#L44-L60)

**What**
```js
await app.register(rateLimit, {
  global: true,
  max: 500,
  timeWindow: '1 minute',
  keyGenerator: (request) => request.user?._id?.toString() ?? request.ip,
  …
```

`@fastify/rate-limit` runs on the **`onRequest`** hook by default, but `request.user` is only
populated by the `authenticate` hook, which every route registers as a **`preHandler`** — a hook
that runs *after* `onRequest`. So at `keyGenerator` time `request.user` is always `undefined` and
the key **always** falls back to `request.ip`.

**Impact**
The intended per-account throttle never takes effect; the global limiter is purely IP-based. On
mobile this matters: many users behind carrier CGNAT or a corporate NAT share one public IP and
therefore share a single 500-req/min bucket, so unrelated users can rate-limit each other. (The
per-number OTP throttle and the socket queue-join limiter are separate and unaffected; those
correctly want IP/entity keying.)

**Fix**
Register the limiter with `hook: 'preHandler'` so it runs after `authenticate`, or supply the user
id from a source available at `onRequest` time.

## D2 — Space-home brand spread runs on a `.lean()` document (Low, dead code)

**Where**
[backend/src/routes/spaces.js](backend/src/routes/spaces.js#L106) (the `.lean()` read) and
[spaces.js](backend/src/routes/spaces.js#L125) (the spread)

**What**
```js
const [space /* … */] = await Promise.all([ Space.findById(scope.spaceId).lean(), /* … */ ]);
…
space: {
  ...space.toBrand?.(),   // space is a lean() plain object → toBrand is undefined → spread of undefined → no-op
  id: String(space._id),
  name: space.name,
  logoUrl: space.logoUrl,
  accentColor: space.accentColor,
  roundDurationMs: space.settings?.roundDurationMs,
},
```

`.lean()` strips schema methods, so `space.toBrand` is always `undefined`; `...undefined` in an
object literal contributes nothing.

**Impact**
Harmless at runtime — the explicitly-listed fields are what the client uses — but it is dead code
that *reads* as if it were adding the model's brand fields (e.g. `slug`, `isPublic`), which are in
fact silently absent from this payload.

**Fix**
Drop the dead spread, or build the brand object from a non-lean doc / an explicit helper if those
extra fields are actually wanted here.

## Areas re-read and found clean (Part 3)

Beyond the confirmations already listed in Parts 1–2, this pass verified:

- **All route input schemas** — no route reads a body/query field its schema doesn't declare
  (which, under `removeAdditional: 'all'` + `coerceTypes: false`, would be silently dropped or
  string-compared). Every numeric query param is declared as a string and parsed with `Number()`,
  and there are no numeric/boolean **querystring** schemas anywhere.
- **Tenant scoping** — space-scoped model queries carry a `spaceId` filter; handlers read
  `request.scope.spaceId`, never the client-supplied `spaceId` (the ESLint rule enforces this).
  A superadmin reaching `/admin/*` for the Public Arena is intentional (`resolveScope` elevates
  them to admin of the public space).
- **Models** — every uniqueness constraint the code relies on (chest grants, contest entries,
  friendships, ratings, memberships) is backed by a unique index; no field the routes write is
  missing from its schema.
- **Mobile screens & state** — the socket lifecycle in
  [game.jsx](mobile/src/state/game.jsx#L149) (single-flight reconnect, queue re-join guard,
  identity-scoped socket teardown), the single-flight token refresh in
  [api.js](mobile/src/lib/api.js#L119), and the focus-scoped contest poll in
  [contest/[id].jsx](mobile/app/contest/%5Bid%5D.jsx#L71) are all correct. The `match:answer`
  ack returns the authoritative `points`, which the client ignores in favour of its local
  prediction (both run identical `shared/scoring.js`, and `round:result` settles the real value) —
  intentional, not a bug.

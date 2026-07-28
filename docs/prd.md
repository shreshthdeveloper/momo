# Product Requirements — Real-Time Trivia Platform

**Product:** Mimo
**Version:** 2.0
**Date:** 25 July 2026
**Owner:** Product
**Companion documents:** `design.md` (experience and visual system), `tech.md` (architecture and implementation)

---

## 1. Purpose of this document

This document defines **what** the product does and **why**. It contains no implementation detail and no visual specification — those live in `tech.md` and `design.md` respectively.

Every feature carries an ID (`F1.2.3`) so it can be referenced in tickets, test plans, and the other two documents.

---

## 2. Product summary

A mobile trivia game where two players answer the same seven questions on a chosen topic, simultaneously, in real time, scored on both correctness and speed.

The product has **two connected worlds**:

- **Public Arena** — open to everyone, superadmin-curated topics, global matchmaking and leaderboards.
- **Institute Spaces** — private, branded environments where a coaching centre, school, or college loads its own questions, manages its own students, and runs its own competitions.

Same app, same mechanics, different content and different opponent pool.

### 2.1 Positioning

For students and quiz enthusiasts who find studying dull and single-player quiz apps forgettable, this is a real-time competitive quiz game where every match is against a real person. Unlike generic trivia apps, any institute can load its own syllabus and run its own leaderboards inside the same product.

### 2.2 Why two worlds

The Public Arena is the acquisition surface — it makes the app worth downloading before any institute exists, and it means an institute's students already have it installed. Institute Spaces are the revenue surface. Neither depends on the other succeeding first.

---

## 3. Goals and non-goals

### 3.1 Goals

| # | Goal | Measured by | Target |
|---|---|---|---|
| G1 | A new user completes their first match fast | Time from install to first completed match, p50 | Under 90 seconds |
| G2 | A match never fails to find an opponent | Match fill rate | ≥ 99% |
| G3 | An institute goes live quickly and unaided | Signup → students playing own questions | Within one working day |
| G4 | Players come back | D7 retention | ≥ 25% |
| G5 | Revenue is independent of ad scale | Paying institutes, MRR | Live from Phase 2 |

### 3.2 Non-goals for v1

Team or group matches. Live voice or video. Real-money gaming or wagering. User-generated public topics. A web player client. Offline play. In-app chat.

---

## 4. Users and roles

| Role | Scope | Description |
|---|---|---|
| **Guest** | Public | Unregistered. Plays up to 3 matches, then must sign up. |
| **Player** | Public | Registered. Full Public Arena access. May belong to 0..N spaces. |
| **Student** | Space | A Player who has joined an Institute Space. Same account, additional access. |
| **Sub-Admin** | Space | Delegated by an Institute Admin. Configurable permissions. |
| **Institute Admin** | Space | Owns one Space. Full control of its content, students, and competitions. |
| **Superadmin** | Platform | Manages tenants, central content, moderation, plans, platform config. |

### 4.1 Permission matrix

| Capability | Guest | Player | Student | Sub-Admin | Admin | Superadmin |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Play public topics | 3 max | ✓ | ✓ | ✓ | ✓ | ✓ |
| Play space topics | — | — | ✓ | ✓ | ✓ | ✓ |
| View public leaderboards | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| View space leaderboards | — | — | ✓ | ✓ | ✓ | ✓ |
| Report a question or user | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create/edit space questions | — | — | — | Configurable | ✓ | ✓ |
| Publish space questions | — | — | — | Configurable | ✓ | ✓ |
| Manage space students | — | — | — | Configurable | ✓ | ✓ |
| Create contests, assignments | — | — | — | Configurable | ✓ | ✓ |
| View space analytics | — | — | Own only | ✓ | ✓ | ✓ |
| Manage central question bank | — | — | — | — | — | ✓ |
| Approve/suspend institutes | — | — | — | — | — | ✓ |
| Platform analytics | — | — | — | — | — | ✓ |

---

## 5. Core concepts

| Term | Definition |
|---|---|
| **Space** | A tenant. Exactly one **Public Space** (superadmin-owned) and N **Institute Spaces**. |
| **Category** | Top-level grouping — Science, Cinema, Physics, SSC. Contains topics. |
| **Topic** | What players actually pick — "Organic Chemistry", "Bollywood 1990s". Ranking, mastery, and leaderboards are all per-topic. |
| **Question** | A single MCQ. Belongs to the **Central Bank** (superadmin-owned, usable by any space) or a **Space Bank** (private to one space). |
| **Match** | One 1v1 game: 7 questions from one topic. |
| **Rating** | Per-topic skill score. Also an overall rating derived from the player's strongest topics. |
| **Mastery** | Per-topic level 1–50, earned by playing regardless of result. Progression, not skill. |
| **Contest** | A scheduled, time-boxed event inside a Space with a fixed question set and its own standings. |
| **Assignment** | An admin-set requirement for students — e.g. play 5 matches in a topic before Friday. |

### 5.1 Scoping rules

These govern the entire product. They are requirements, not implementation notes.

1. Every **Topic** belongs to exactly one Space.
2. Every **Question** originates from either the Central Bank or exactly one Space Bank.
3. A Space topic may draw from the Central Bank, its own Space Bank, or both. **Never from another Space's bank.**
4. Matchmaking for a public topic draws from all players globally. For a Space topic, only from that Space's members.
5. Leaderboards follow the same scoping. A Space topic's leaderboard is never visible outside that Space.
6. A user has one account. Space membership is additive and revocable. Leaving a Space removes access and leaderboard presence but does not delete the account.

---

## 6. Player experience

### 6.1 Onboarding and authentication

- **F6.1.1** Sign in with phone + OTP (primary), Google, or Apple. Email and password as fallback.
- **F6.1.2** Guest mode — play 3 matches without an account. Progress migrates on signup.
- **F6.1.3** Profile setup: display name, avatar (upload or preset), optional city, optional date of birth.
- **F6.1.4** Interest selection — pick 3 to 8 topics on first run, used to seed the home feed.
- **F6.1.5** If the user arrived via an institute invite link, offer to join that Space during onboarding.
- **F6.1.6** Account deletion available in-app with a 30-day grace period.

### 6.2 Home and discovery

- **F6.2.1** Home feed: continue-playing topics, recommendations from selected interests, trending topics, friend activity.
- **F6.2.2** Category browsing — grid of categories, each opening to its topics.
- **F6.2.3** Topic search, typo-tolerant, across topic and category names.
- **F6.2.4** Topic card shows name, cover image, active player count, the viewer's mastery level and rank.
- **F6.2.5** Space switcher — persistent control to move between the Public Arena and any joined Space.

### 6.3 Match types

| Type | Opponent | Rated |
|---|---|:---:|
| **Quick play** | Live player, or ghost if none available | ✓ |
| **Friend challenge** | A specific friend, async, 24h to respond | ✓ |
| **Rematch** | Same opponent, if still online | ✓ |
| **Practice** | Ghost only | — |
| **Contest match** | Space members, fixed question set | Separate standings |

### 6.4 The match loop

The heart of the product. It must feel fast and fair.

**Finding an opponent**

- **F6.4.1** On queue join, show a searching state with the topic name.
- **F6.4.2** The system looks for a live opponent of similar skill, widening its search each second.
- **F6.4.3** If no live opponent is found within **3 seconds**, the player is matched against a **ghost** — a replay of a real past player's game (§6.7). The player is never told which they received.
- **F6.4.4** A 3-second versus screen precedes the match: both avatars, names, topic ratings.

**Playing**

- **F6.4.5** **7 questions**, identical and in identical order for both players.
- **F6.4.6** Difficulty is balanced across the match and weighted toward the players' average skill.
- **F6.4.7** **4 options** per question, exactly one correct.
- **F6.4.8** **10 seconds** per question, shown as a draining countdown.
- **F6.4.9** The opponent's answer *state* is shown live — answered or not — but never their choice or whether they were right.
- **F6.4.10** An answer cannot be changed once submitted.
- **F6.4.11** A round resolves when both have answered or the timer expires.
- **F6.4.12** On resolution both players see: the correct option, their own choice, the opponent's choice, points awarded.
- **F6.4.13** A 2.5-second interval, then the next round.

**Scoring**

- **F6.4.14** Correct: **20 base points plus up to 20 speed bonus**, proportional to time remaining.
- **F6.4.15** Wrong or timed out: **0 points**. No negative marking.
- **F6.4.16** Maximum match score: 280.
- **F6.4.17** Higher total wins. Equal totals are a draw.

**After**

- **F6.4.18** Result screen: winner, final scores, round-by-round breakdown, rating change, XP earned.
- **F6.4.19** Actions: rematch, add opponent as friend, share result, return home.
- **F6.4.20** Full question review — every question, both answers, the correct answer, and an explanation where one exists.
- **F6.4.21** Report a question from the review screen.

### 6.5 Progression

- **F6.5.1** **Per-topic rating**, adjusted after every rated match based on result and opponent strength.
- **F6.5.2** **Per-topic mastery level** 1–50, earned from every match regardless of result. Higher levels take progressively longer.
- **F6.5.3** **Overall rating** derived from the player's five strongest topics.
- **F6.5.4** **Achievements** — first win, 10-match streak, perfect match, topic level 10, beating a much stronger opponent, and similar.
- **F6.5.5** **Daily streak** — consecutive days with at least one match.

### 6.6 Leaderboards

- **F6.6.1** Scopes: global, country, city, friends; inside a Space: space-wide and batch-wide.
- **F6.6.2** Filters: per-topic and overall.
- **F6.6.3** Periods: all-time, this month, this week.
- **F6.6.4** The viewer's own row is pinned and always visible, even when outside the loaded page.
- **F6.6.5** Ties broken by fewer matches played, then by who reached the score first.

### 6.7 Ghost matches

A launch requirement, not an optimisation. With a small user base, a live opponent for a specific topic at a specific skill level at a specific hour frequently will not exist. Without a fallback, the player sees an empty lobby and leaves.

- **F6.7.1** Every completed match is stored as a replay — the question set, each answer, and each response time.
- **F6.7.2** When live matchmaking fails, the system replays a stored game from a player of similar skill on that topic.
- **F6.7.3** The ghost answers at the originally recorded times, so the pacing feels human.
- **F6.7.4** Where no replay exists, a synthetic opponent is generated from the topic's aggregate accuracy and speed statistics.
- **F6.7.5** Ghosts display the original player's name and avatar and are not labelled as ghosts.
- **F6.7.6** A ghost match affects the live player's rating, never the replayed player's.
- **F6.7.7** Ghost ratio is a tracked health metric. Sustained above 60% on a topic means that topic lacks real liquidity.

### 6.8 Social

- **F6.8.1** Friend requests, accept and decline, friend list.
- **F6.8.2** Find friends by username, or from device contacts with explicit permission.
- **F6.8.3** Public profile: avatar, name, city, overall rating, top topics, achievements, recent matches, head-to-head record with the viewer.
- **F6.8.4** Block and report a user.
- **F6.8.5** Share a match result as an image to any share target.

> **Excluded from v1:** forums, direct messaging, follower feeds. The reference product added these only after reaching tens of millions of users. Built at low user counts they produce visibly empty rooms and make the app feel abandoned.

### 6.9 Notifications

| Trigger | Default |
|---|:---:|
| Friend challenged you | On |
| Friend accepted your request | On |
| Someone passed your topic rank | On |
| Daily streak about to break | On |
| New contest in your space | On |
| Contest starting in 15 minutes | On |
| Assignment due tomorrow | On |
| Weekly performance summary | Off |
| Re-engagement after 7 days inactive | On |

- **F6.9.1** Every category individually toggleable.
- **F6.9.2** Quiet hours, user-configurable, default 22:00–08:00.

### 6.10 Settings

Account details, notification preferences, language, sound and haptics, privacy (profile visibility, contact discovery), joined spaces with leave option, blocked users, data export, delete account, help, terms, privacy policy.

---

## 7. Student experience inside a Space

- **F7.1** Join via 6-character code, invite link, or QR code.
- **F7.2** Admin approval required first, when the Space is set to approval mode.
- **F7.3** Space home: institute branding, assigned topics, upcoming contests, pending assignments, class leaderboard, personal progress.
- **F7.4** **Assignments** — requirement, progress, due date, completion state.
- **F7.5** **Contests** — scheduled, time-boxed, fixed question set, live standings, final rank.
- **F7.6** Personal performance: accuracy per topic, average response time, weakest topics, improvement over time.
- **F7.7** A student may belong to multiple Spaces at once.
- **F7.8** A student may always leave a Space without admin permission.

---

## 8. Admin Portal

Responsive web application for Institute Admins and Sub-Admins.

### 8.1 Dashboard

- **F8.1.1** Summary cards — total students, active today and this week, matches played, average accuracy, questions in bank.
- **F8.1.2** Engagement chart over a selectable period.
- **F8.1.3** Weakest topics, ranked by lowest average accuracy.
- **F8.1.4** Most active students, and least active students — the more actionable list.
- **F8.1.5** Recent activity feed.
- **F8.1.6** Alerts — students pending approval, questions pending review, contests starting soon.

### 8.2 Question bank

- **F8.2.1** List with filters: topic, category, difficulty, status, tag, creator, date.
- **F8.2.2** Full-text search across question and option text.
- **F8.2.3** Create a question — text, 4 options, correct option, difficulty, topic, tags, optional explanation, optional image, optional time-limit override.
- **F8.2.4** Edit, duplicate, archive. Hard delete only for questions never served in a match; otherwise archive.
- **F8.2.5** **Bulk CSV import** with a downloadable template, row-level validation, and an error report naming the failing row and reason.
- **F8.2.6** **AI-assisted drafting** — admin gives topic, difficulty and count; generated questions land in a review queue. Nothing goes live without explicit human approval.
- **F8.2.7** **Duplicate detection** on save and import, flagging questions similar to existing ones in the same topic.
- **F8.2.8** **Review workflow** — draft → in review → published → archived. Sub-Admins may submit; publishing may be restricted to the Admin.
- **F8.2.9** **Central bank browser** — search superadmin-curated questions and add them to Space topics. Central questions are read-only, but may be forked into the Space bank and edited.
- **F8.2.10** **Item analysis** per question — times served, percent correct, average response time, option distribution. Automatically flags questions where under 20% choose the marked-correct option (likely a wrong answer key) or over 95% do (too easy to discriminate).

### 8.3 Categories and topics

- **F8.3.1** Create and edit categories within the Space.
- **F8.3.2** Create and edit topics — name, category, description, cover image, question sources, publish state.
- **F8.3.3** A topic requires **21 published questions** before going live — three matches' worth. Progress toward this is shown in the UI.
- **F8.3.4** Assign topics to specific batches or make them Space-wide.
- **F8.3.5** Reorder topics for display.

### 8.4 Students

- **F8.4.1** Student list with search, filters, and sort.
- **F8.4.2** Invite by join code, link, QR, or bulk CSV of phone numbers.
- **F8.4.3** Approve or reject join requests, individually or in bulk.
- **F8.4.4** Suspend or remove a student.
- **F8.4.5** **Batches** — create, assign students, and use batches to scope assignments, contests, and leaderboards.
- **F8.4.6** Individual student view — matches, accuracy per topic, average response time, contest history, assignment completion, activity timeline.

### 8.5 Contests and assignments

- **F8.5.1** Create a contest: name, topics, question count, start and end time, eligible batches, standings visibility.
- **F8.5.2** Questions selected automatically from the topic, or curated manually.
- **F8.5.3** Live standings during the window.
- **F8.5.4** Final results, exportable.
- **F8.5.5** Create an assignment: topic, requirement (N matches, or a minimum accuracy), due date, target batches.
- **F8.5.6** Per-student completion tracking.

### 8.6 Reports

- **F8.6.1** Space overview — engagement, accuracy, participation over time.
- **F8.6.2** Topic report — accuracy, participation, average score, difficulty calibration.
- **F8.6.3** Student report — individual performance card, printable.
- **F8.6.4** Question item-analysis across the full bank.
- **F8.6.5** Comparison — batch vs batch, period vs period.
- **F8.6.6** All reports exportable as CSV and PDF.

### 8.7 Space settings

- **F8.7.1** Branding — institute name, logo, accent colour.
- **F8.7.2** Join mode — open with code, approval required, or invite-only.
- **F8.7.3** Sub-admin management — invite, assign granular permissions, revoke.
- **F8.7.4** Plan and billing — current plan, seat usage, invoices, upgrade.
- **F8.7.5** Audit log of admin actions.

---

## 9. Superadmin Portal

### 9.1 Tenants

- **F9.1.1** Institute registration queue — approve or reject with a reason.
- **F9.1.2** Institute list with plan, seats, activity, status.
- **F9.1.3** Suspend or reactivate a Space.
- **F9.1.4** Impersonate an admin for support. Every session is logged and visible in that institute's own audit log.

### 9.2 Central content

- **F9.2.1** Full control of global categories and public topics.
- **F9.2.2** Central question bank, with the same tooling as §8.2 plus publishing to all Spaces.
- **F9.2.3** Curate the public home feed — featured topics, trending overrides, seasonal collections.
- **F9.2.4** Bulk operations and AI-assisted drafting.

### 9.3 Moderation

- **F9.3.1** Reported questions queue — reporter, reason, question, and resolution actions.
- **F9.3.2** Reported users queue — warn, suspend, ban.
- **F9.3.3** Reported display names and avatars.
- **F9.3.4** Automated flags — suspected cheating, abnormal rating gain, mass reporting.

### 9.4 Platform

- **F9.4.1** Analytics — DAU, MAU, matches per day, retention cohorts, match fill rate, ghost ratio, average queue time.
- **F9.4.2** Global user search and management.
- **F9.4.3** Plan and pricing configuration.
- **F9.4.4** Feature flags, including per-Space overrides.
- **F9.4.5** Push announcements to all users or a segment.
- **F9.4.6** System health view.

---

## 10. Content requirements

### 10.1 Question types

| Type | v1 | Note |
|---|:---:|---|
| Single-correct MCQ, 4 options | ✓ | The only type at launch |
| Image-based question | ✓ | Image plus 4 text options |
| True / False | — | v1.1 |
| Audio question | — | v2 |
| Multi-correct | — | Incompatible with speed scoring; likely never |

### 10.2 Quality rules

- Options must be mutually exclusive and similar in length — a conspicuously longer correct option is a tell.
- No "all of the above" or "none of the above".
- No question whose answer changes over time without a date qualifier.
- Explanations are strongly encouraged for institute content. Post-match review is where the learning actually happens.

---

## 11. Monetization

| Stream | Who pays | Model | Priority |
|---|---|---|---|
| **Institute subscription** | Institute admin | Monthly or annual, tiered by active student seats | **Primary** |
| Content digitisation service | Institute admin | One-time fee to convert an existing question bank | Secondary |
| Ads in Public Arena | Advertisers | Interstitial between matches, frequency-capped | Tertiary |
| Ad-free pass | Players | Low-cost monthly | Tertiary |
| Cosmetics | Players | Avatar frames, profile themes | Later |

**Constraint.** The reference product reached 80 million users and still went to zero, because it never solved monetization and every user was a cost. Institute billing must be live in Phase 2, not deferred. The Public Arena is an acquisition and credibility channel and is not expected to pay for itself.

---

## 12. Success metrics

**Player funnel:** install → first open → topic selected → match started → match completed → signup → D1 return.

**Core:** DAU, MAU, DAU/MAU, matches per active user per day, session length, D1/D7/D30 retention, time-to-first-match, match fill rate, ghost ratio, average queue time, match abandonment rate.

**Institute:** admin activation time, questions created per Space, invite acceptance rate, weekly active students per Space, contest participation rate, seat utilisation, Space churn.

---

## 13. Quality requirements

These are product-level targets. Implementation is specified in `tech.md`.

- Answering feels instant — no perceptible lag between tap and acknowledgement.
- A match starts promptly once an opponent is found.
- The home feed loads quickly on a mid-range Android phone over 4G.
- The app degrades gracefully — if matchmaking fails entirely, offer practice mode rather than an error.
- Tenant data never crosses Space boundaries under any circumstance.
- Users under 18 are expected in the institute segment. Space profiles are not publicly discoverable, contact discovery is disabled for accounts flagged as minors, and in-Space social features are limited to leaderboards.
- Compliant with India's DPDP Act for consent, export, and deletion.

---

## 14. Release plan

### Phase 1 — Public Arena MVP · 12–16 weeks

Auth, profile, categories and topics, quick play with live matchmaking and ghost fallback, the full match loop, scoring, per-topic rating, post-match review, global and topic leaderboards, friends and friend challenges, push notifications, and the superadmin portal with central question bank and topic management.

**Ship criterion:** a stranger installs the app and completes an enjoyable match in under 90 seconds, with no empty lobby, ever.

### Phase 2 — Institute Spaces · 8–10 weeks

Space creation and approval, join flows, Space-scoped topics and matchmaking, the full admin portal, Space leaderboards, branding, and subscription billing.

**Ship criterion:** an institute admin, unaided, goes from signup to students playing their own questions within one working day.

### Phase 3 — Depth · 8 weeks

Contests, assignments, item analysis, AI-assisted drafting, achievements, streaks, advanced reporting, sub-admin roles.

**Ship criterion:** an admin schedules a contest on Friday and does nothing on the day — it opens, runs, closes and publishes its standings on its own.

### Phase 4 — Scale

Infrastructure split, regional and language expansion, and a revisit of social features once concurrency makes them feel populated.

---

## 15. Out of scope

Team matches, bracket tournaments, real-money play, live streaming, a web player client, offline mode, user-created public topics, in-app chat, and any question type incompatible with speed-based scoring.

---

## 16. Open questions

| # | Question | Needed by |
|---|---|---|
| Q1 | Pricing — per-seat, flat tier, or hybrid? What is the free tier ceiling? | Phase 2 start |
| Q2 | Do institutes need topics invisible even in aggregate platform analytics? | Phase 2 design |
| ~~Q3~~ | ~~Language at launch~~ — **resolved: English only, with an i18n-ready schema.** Question text lives under a language key (`content.en`) rather than at the top level, so adding Hindi is an additive write instead of a migration across the match engine, the admin portal and every document. | ~~Phase 1 design~~ |
| Q4 | Minimum age policy, and whether parental consent is required for the institute segment. | Phase 1 legal review |
| Q5 | Does institute performance ever surface on a public profile, or are the two permanently separate? | Phase 2 design |
| Q6 | Who owns a question an admin forks from the central bank and edits? | Phase 2 terms |
| Q7 | AI-drafted questions carry `source: 'ai'` and pass through human review. Does that provenance need to be visible to students, or only to the institute? | Phase 3 terms |

---

## 17. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Not enough players for live matches | High | Ghost matches from day one, tracked as a core metric |
| Monetization deferred, as with the reference product | Critical | Institute billing live in Phase 2; public app not expected to carry itself |
| Topics without enough questions | High | 21-question gate, AI-assisted drafting with human review, central bank seeding |
| Cheating undermining leaderboard credibility | Medium | Specified in `tech.md` §9 |
| Tenant data leaking between institutes | Critical | Enforced at the query layer; automated cross-tenant denial tests |
| Admins abandoning the portal after setup | High | Onboarding checklist, CSV import, and a paid service to digitise their bank |

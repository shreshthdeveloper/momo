# Leagues and progression — spec

Status: **built and shipped**, and **partly superseded**. Extends
[rating-and-levels.md](rating-and-levels.md), which describes the system as it
existed before it.

> **§4 and §5 have been replaced by
> [coins-and-cosmetics.md](coins-and-cosmetics.md).** The account level now runs
> to 100 on a rescaled curve and unlocks a title every fifth level and nothing
> else; avatars and banners are bought with coins by rarity, or drawn from a
> monthly chest. Everything else here — the two modes, the ranked rating, the
> leagues, what a finished match does, and progression-as-configuration — still
> describes the system exactly.

The shape of it: **two things can fall, two things never can.** Ranked rating (and
the league that reads from it) is the risk. Account level and topic level are the
reward for showing up. A bad night still ends closer to an unlock.

---

## 1. Two modes

Players choose between exactly two things. Practice stays a backend-only ghost mode
and is not a third choice; contests are entered from the contest screen as today.

| | Quick play | Ranked |
|---|---|---|
| Opponent | Live, ghost fallback | Live, ghost fallback |
| Ranked rating + league | — | **Yes** |
| Topic rating | — | Yes |
| XP | `40 + 5×correct` | `40 + 5×correct + 30 if won` |

Quick play still feeds the account level, so casual play unlocks things; it simply
carries no stakes and no win bonus. Ranked is strictly the better place to progress.

---

## 2. Ranked rating (new)

One **global** Elo per player, `user.rankedRating`. Every ranked match moves it,
whatever the topic — this is what makes a ranked loss always count.

- Start **1200**, floor **800**, K **32** (same constants as topic Elo).
- Ranked matches update **both** the global ranked rating and the per-topic rating.
- Quick play updates neither.
- **Migration:** each existing player's ranked rating is seeded from their current
  `overallRating`, so nobody starts over.

`overallRating` (mean of best 5 topics) stays in the database but leaves the UI —
ranked rating replaces it on the profile and the overall leaderboard. That also
retires the "average of what?" confusion the old number caused.

---

## 3. Leagues

A league is a **band of ranked rating** — no separate ladder, no new state to drift.
Five leagues, three divisions each, **75 rating points per division**. A loss
between even players is −16, so **4–5 straight losses drops one division**.

| League | Range | III | II | I |
|---|---|---|---|---|
| Bronze | 800–1224 | 800–1074 | 1075–1149 | 1150–1224 |
| Silver | 1225–1449 | 1225–1299 | 1300–1374 | 1375–1449 |
| Gold | 1450–1674 | 1450–1524 | 1525–1599 | 1600–1674 |
| Diamond | 1675–1899 | 1675–1749 | 1750–1824 | 1825–1899 |
| **Black** | 1900+ | — | — | — |

A new player at 1200 opens in **Bronze I** — top of the bottom league, so the first
promotion is two wins away. Black at 1900 is roughly 44 net wins.

**No seasons.** One permanent ladder; no resets, no end dates. Seasons can be added
later without redoing any of this.

---

## 4. Account level (new)

> **Superseded by coins-and-cosmetics.md §4.** The coefficient is 18 rather than
> 75 and the ladder runs to 100, so level 100 now costs what level 50 cost here.
> The curve below is what shipped first and what the migration reads existing
> players' levels against before it moves them.

A global level rising from `user.totalXp`, which **already accumulates in the
database and is displayed nowhere** — so the data exists from day one.

`accountXpForLevel(L) = 75 × (L−1) × (L+2)`, levels 1–50. At roughly 70 XP a match:

| Level | Total XP | ≈ matches |
|---|---|---|
| 2 | 300 | 4 |
| 3 | 750 | 11 |
| 5 | 2,100 | 30 |
| 10 | 8,100 | 116 |
| 20 | 31,350 | 448 |
| 50 | 191,100 | 2,730 |

The first unlock lands inside the first session. Per-topic levels are untouched and
keep their own faster curve — they describe mastery of one subject, this describes
time in the app.

---

## 5. Perks

> **Superseded by coins-and-cosmetics.md §2–§4.** Only titles still hang off the
> account level, one every fifth. Avatars and banners are bought with coins by
> rarity or drawn from a chest, and ownership is written into `grantedPerks`
> rather than derived. The permanence rule below is unchanged and is now the
> reason `grantedPerks` is append-only.

Unlocks hang off the **account level** — the global one from §4, never a topic
level — and they are **permanent**: nothing ever un-unlocks, which is why XP never
falls.

Topic levels unlock nothing. They describe mastery of one subject; if perks hung off
them you would earn "Rookie" once per topic and "level 6" would have to ask "in
which?". One ladder, one set of rewards.

**Avatars** — 14 drawn faces exist. Six stay free; the rest unlock at account levels
3, 5, 7, 9, 12, 15, 18, 22. **Banners** — 8 exist; three free, the rest at account
levels 4, 8, 11, 14, 20. **Anything a player already wears is grandfathered** at migration,
locked or not.

**Titles** ("headings") — a short line under the name on the profile and versus
screens. Draft set, to be edited freely:

| Account level | Title | Account level | Title |
|---|---|---|---|
| 2 | Rookie | 20 | Veteran |
| 4 | Regular | 25 | Relentless |
| 6 | Quick Draw | 30 | Scholar |
| 8 | Contender | 35 | Unshaken |
| 10 | Sharpshooter | 40 | Prodigy |
| 13 | Bookworm | 45 | Legend |
| 16 | Giant Slayer | 50 | Grandmaster |

One more is earned rather than levelled: **Untouchable**, for reaching Black league.

**Stickers are phase 2** — in-match emotes need new realtime plumbing and a
moderation story, and neither should hold up the ladder.

---

## 6. What one finished match does

1. Outcome → win `1`, draw `0.5`, loss `0`.
2. **Ranked only:** update the global ranked rating; recompute the league band.
3. **Ranked only:** update the per-topic rating (as today).
4. Add XP — with the win bonus only in ranked — to the topic and to `totalXp`.
5. Recompute topic level and **account level**; collect anything newly unlocked.
6. Accuracy and response-time totals, as today.

The client receives, in addition to today's fields: `rankedBefore`, `rankedAfter`,
`rankedDelta`, `league` (before and after, so promotion and demotion can be staged),
`accountLevel`, `accountLevelUp`, and `unlocked[]`.

### When nothing competitive moves

- **Quick play** — XP only.
- **Contest** — XP only, own standings. A student's league must never drop because
  their teacher set a hard paper, and an organization must not be able to inflate
  its students' standing.
- **Void** (both disconnected) — XP only.
- **Ghost match** — the replayed player is never affected, as today.

---

## 7. Four numbers, two pairs

Every player carries four figures, and they pair up. A **rating** measures skill and
moves both ways; a **level** measures time invested and only ever rises.

| | Rating | Level |
|---|---|---|
| **Account** | ranked rating → league | from lifetime XP → unlocks perks |
| **Topic** | per-topic Elo | from topic XP → **matches the queue** |

The two pairs never feed each other: the ranked rating is its own Elo, not a mean of
topic ratings. Wherever one of a pair is shown, the other is shown beside it — a level
without its rating reads as skill, and a rating without its level reads as XP.

### Matchmaking runs on the topic level

Pairing looks for the **same topic level**, widening by one level every 1.2s to a hard
cap of ±5, then falling back to a ghost at 8s. Ratings are not an input.

The reason is what the versus screen can honestly say. A level is earned by playing, so
two players at the same topic level have put comparable time into the subject — and
because the queue matched them that way, the two levels on screen are near-identical,
which reads as *evenly matched* rather than as a threat. Ghosts are selected on level
too, or a replayed opponent would contradict this in the one place a player can see it.

### Where each number surfaces

- **Play screen** — two buttons: Quick play, Ranked.
- **Searching** — the topic and the level range being searched, widening as it opens.
- **Versus** — league badge (global standing) and topic level. **No rating.**
- **Your profile** — league and account level as the headline; your own per-topic levels
  *and* ratings below, because they are yours rather than a comparison.
- **Someone else's profile** — ranked rating, account level, per-topic **levels only**.
- **Global leaderboard** — account level + ranked rating, ordered by ranked rating.
- **Topic leaderboard** — topic level + topic rating, ordered by topic rating. This is
  the only place another player's topic rating appears.
- **Match result** — ranked delta, league promotion/demotion, XP, and a real account
  level-up moment with what it unlocked.
- **A rewards screen** — what is unlocked, what is next, and what equips.

This also clears most of the UI audit: the invisible one-line level-up becomes a real
moment, the profile header finally carries progression, and the unlabelled numbers
become league badges.

---

## 8. Build order

1. **Foundation** — constants, `shared/league.js`, account-level maths, mirrored to
   mobile. Pure functions, unit tested.
2. **Backend** — `rankedRating` on the user, mode handling in the orchestrator and
   `finalizeMatch`, unlock evaluation, the migration that seeds ranked ratings.
3. **Mobile** — mode picker, league badge component, profile, versus, result screen,
   rewards screen.
4. **Audit fixes** — the `TOTAL XP` label bug and the remaining unlabelled numbers,
   folded in as their screens are touched.

---

## 9. Progression as configuration

Status: **built and shipped.** Everything in §3–§5 above became data a superadmin
edits, rather than numbers a deploy changes. What did not move is the shape: two
ladders, unlocks that are permanent, and a rating that is the only thing that can
fall.

The rule the whole thing rests on is one-way:

> **The server computes, the client displays.**

A client never applies a curve or a band to work out a level or a league, because
the copy it holds may be a version behind the one being enforced. Every payload
that needs a level, a league or an ownership flag carries it.

### 9.1 What is editable

| | Editable | Fixed |
|---|---|---|
| **Cosmetics** | name, unlock rule, art, order, availability | the `key`, once created |
| **Account XP** | all 50 rows of the table | the shape: ascending, level 1 at 0 |
| **Leagues** | name, floor, colour of each of the five | 3 divisions of 75; the bottom floor at 800 |
| **Owner accounts** | an optional name at organization creation | that a manager's onboarding is one step |
| **Chests** | trigger, contents, availability | that a chest is won once |

Per-topic mastery is deliberately **not** editable. It gates nothing, so tuning it
would move a number on a card and nothing else.

### 9.2 The three tiers of avatar

Sign-up offers the **free tier and nothing else** — a grid where the best-looking
faces do nothing is worse than a smaller grid.

| Tier | Count | Levels | What |
|---|---|---|---|
| Flowers | 6 | free | rose, sunflower, daisy, tulip, lotus, blossom |
| Animals | 28 | 2–24 | the original sixteen, plus dog, wolf, bee, whale, shark, octopus, turtle, dino, unicorn, deer, hedgehog, crab |
| Personas | 32 | 22–50 | ninja, agent, samurai, pirate, astronaut, wizard, knight, viking, detective, dragon, skull, chef, DJ, cyborg, cowboy, pilot, doctor, scientist, boxer, racer, sailor, yeti, vampire, mummy, demon, angel, pharaoh, gladiator, zombie, monk, jester, punk |

Sixty-six in all, drawn to be told apart at 44px: flowers are radially
symmetric, animals have ears, personas have headgear. All of it is generated by
`mobile/scripts/make_art.py`.

A release that adds art backfills it into an existing install — inserts only, so
a row an operator has already moved, renamed or switched off stays theirs.

### 9.3 An unlock rule is one of four things

`free`, a **level**, a **league**, or `chest` — the last meaning no amount of
climbing produces it. Ownership is then: *is it free, is the level reached, is the
league reached, or is the key in `grantedPerks`?* That last clause is what makes
every unlock permanent — grandfathering at migration, and a claimed chest surviving
the demotion that follows it, are the same mechanism.

### 9.4 Editing a curve cannot demote anyone

Before a new table is stored, every player is stamped with the level they hold
under the outgoing one (`user.accountLevelFloor`). The displayed level is
`max(curve(xp), floor)`, so an edit can promote on the spot and can never take a
level away. The console reports how many players were pinned — a large number means
the edit was a steepening.

### 9.5 Chests

A chest opens on a **ranked rating** or on **entering a league**. The test is *has
reached*, not *just crossed*, so a chest added today finds the players already above
it. It is written the moment a ranked match ends and **waits** — the contents are
granted when the player opens it on the rewards screen, because a gift that unwraps
itself in the corner of a scoreboard is not a gift.

Each grant carries its **own copy** of what was inside. Editing a chest afterwards
never changes what somebody already won, and deleting one never orphans an unopened
gift. A chest may hold something the ladder would eventually give anyway (early
access) or something it never will (`chest`-only).

### 9.6 Where it lives

- `models/progression.js` — `Cosmetic`, `ProgressionConfig`, `Chest`, `ChestGrant`
- `services/progressionService.js` — the snapshot, the seeding, the writes, the awards
- `lib/progressionCache.js` — a leaf module, so the User model can read a level synchronously
- `GET /config/progression` — unauthenticated; the sign-up picker needs it before there is an account
- `PUT/DELETE /super/progression/*` — audited, versioned
- `mobile/app/super/progression.jsx` — the operator's four tabs
- `mobile/src/state/progression.jsx` — served config, cached on device, falling back to the built-in set

The shipped constants in `shared/` are now **the seed and the offline fallback**,
never a second source of truth once the server has spoken.

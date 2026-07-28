# Rating and levels

Mimo scores a player twice, on purpose. **Rating** says how good you are. **Level**
says how much you have done. They are deliberately different numbers, they move for
different reasons, and the UI must never let them be mistaken for one another.

Both are tracked **per topic**. Your Python rating knows nothing about your Roman
Numbers rating.

**Read this before anything else, because it is the part people get wrong:**

- A **topic rating** is the real thing. You have one per topic, and a finished match
  changes **exactly one of them** — the topic you just played.
- The **overall rating** on your profile is a *summary*: the average of your five
  best topic ratings, recalculated after every match. Nobody plays for it directly.
- **Level has no overall equivalent.** You are "Level 7 in Python", never just
  "Level 7".

So the single number on the profile does rise and fall — but only because a topic
rating underneath it moved. It is a mirror, not a number of its own. Think of a
report card: topic ratings are the subject marks, the overall rating is the
aggregate printed on the front, and you never sit an exam in "aggregate".

| | Rating | Level (mastery) |
|---|---|---|
| Question it answers | How good are you? | How much have you put in? |
| Can it fall? | **Yes** | Never |
| Depends on the result? | Entirely | Only for a small bonus |
| Depends on the opponent? | Yes — beating someone stronger pays more | No |
| Starts at | 1200 | 1 (0 XP) |
| Range | 800 floor, no ceiling | 1 to 50 |
| Source | `shared/elo.js` | `shared/mastery.js` |

> Rule of thumb: **you cannot lose a level, and you cannot fake a rating.**

---

## Rating — Elo, per topic

Standard Elo with `ELO_K = 32`, `ELO_FLOOR = 800`, `ELO_START = 1200`
(`shared/constants.js`).

New players start at **1200** rather than 0 because Elo is a *relative* scale: the
midpoint lets the number move both ways from the first match. Starting at 0 would
make the rating a measure of how long you have played rather than how well.

How much one match moves it:

| You vs opponent | Win | Loss | Draw |
|---|---|---|---|
| Equal — 1200 v 1200 | +16 | −16 | 0 |
| Underdog — 1200 v 1400 | **+24** | −8 | +8 |
| Favourite — 1200 v 1000 | +8 | **−24** | −8 |

So an upset pays roughly triple a routine win, and losing to someone far better
barely costs anything. The floor of 800 means a bad run cannot drop you out of the
system.

### The overall rating on your profile

The headline number is the mean of your **five strongest** topic ratings
(`OVERALL_RATING_TOPIC_COUNT = 5`) — an average of *topics*, not of matches:

- `[1320, 1260, 1200, 1150, 900]` → **1166**
- add a sixth topic at 800 → still **1166** (the weakest is ignored)
- fewer than five topics averages whatever exists; none at all reads **1200**, so a
  new profile does not display 0

Trying a new topic and losing your first few matches therefore cannot damage your
headline rating once you have five going. That is the point: it makes experimenting
free.

Watch both levels of the system move together — one player, three topics:

| She plays | That topic | All her topics | Overall |
|---|---|---|---|
| Python, won | 1200 → **1216** | Python 1216 | **1216** |
| Python, won | 1216 → **1234** | Python 1234 | **1234** |
| MySQL, lost | 1200 → **1188** | Python 1234, MySQL 1188 | **1211** |
| MySQL, lost | 1188 → **1173** | Python 1234, MySQL 1173 | **1204** |
| Maths, won | 1200 → **1216** | Python 1234, MySQL 1173, Maths 1216 | **1208** |

Row three is the one worth staring at: she lost at **MySQL**, her **Python** rating
did not move at all, and yet the profile number still fell from 1234 to 1211 —
because the average now has a weak topic in it. Nothing "the rating" did; the
average simply re-read its inputs.

---

## Level — mastery, per topic

XP earned from one match (`xpForMatch`):

```
40   for playing
+5   per correct answer
+30  if you won   (+15 for a draw)
```

A win with 5 correct = **95 XP**. A *loss* with 3 correct still = **55 XP**. This is
why a losing streak stays survivable: the level bar always moves.

The curve is quadratic — `xpForLevel(l) = 25 × (l−1) × (l+2)` — so levels get slower
as they go:

| Level | Total XP | Roughly |
|---|---|---|
| 2 | 100 | 2 matches |
| 3 | 250 | 3 matches |
| 5 | 700 | 9 matches |
| 10 | 2,700 | ~32 matches |
| 50 | 63,700 | the long haul |

Early levels arrive fast so a new player sees movement immediately; a high level is
evidence of real time spent on that topic.

---

## What one finished match does

In order (`ratingService.applyMatchOutcome`):

1. Work out the outcome — win `1`, draw `0.5`, loss `0`.
2. New Elo for **that topic** from your rating, the opponent's rating and the outcome.
3. Update `peakRating` if this is a new high.
4. Add to the win / loss / draw tally.
5. Add XP; recompute the level from the new XP total.
6. Add correct answers, total answers and response time (these feed accuracy stats).
7. Recompute the **overall rating** from your five strongest topics.

The client is told `ratingBefore`, `ratingAfter`, `ratingDelta`, `xpEarned`, `level`
and `levelUp` in the `match:end` payload.

### When the rating does *not* move

Elo is frozen — but **XP and levels still accrue** — when the match is:

- **Practice** — never counts toward skill.
- **A contest** — the organization set the paper, so it gets its own standings; a
  student's public rating must not move because their teacher wrote a hard test.
- **Void** — both players disconnected; nobody's rating moves.

And in a **ghost match** (a replay opponent), only the live player is affected; the
recorded player's rating is untouched.

---

## A worked example

One new player, one topic, four matches. Real numbers from the formulas above:

| Match | Opponent | Result | Correct | Rating | XP | Level |
|---|---|---|---|---|---|---|
| 1 | 1200 | won | 5/7 | 1200 → 1216 (+16) | 95 | 1 (95/100) |
| 2 | 1250 | **lost** | 3/7 | 1216 → 1202 (−14) | 150 | **1 → 2** |
| 3 | 1400 | won | 6/7 | 1202 → 1226 (+24) | 250 | **2 → 3** |
| 4 | 1180 | lost | 2/7 | 1226 → 1208 (−18) | 300 | 3 (50/200) |

Match 2 is the whole design in one row: **she lost, her rating fell, and she levelled
up anyway.** Match 4 is the other half: losing to a *weaker* player cost 18 — more
than the 14 she lost to a stronger one.

---

## Where each number appears

**Rating** — home banner chip, profile stat card (overall), per-topic rows on the
profile, topic detail card, topic and overall leaderboards, friends list, public
profiles, the versus screen (per topic), and the match result tile with its `+16`.

**Level** — `Lv` badge on topic cards, the topic picker, per-topic rows on the
profile, the topic detail card with its XP bar and "140 XP to level 8", public
profiles, and the `Level 8 reached` line on the match result.

Two cautions for anyone touching this UI:

- "Rating" means the **overall** number on the profile and the **per-topic** number
  on the versus screen. Label the scope wherever both could be meant.
- Never put a bare rating next to a level badge with nothing between them — a
  four-digit number beside "Level 5" reads as XP.

# Design — Real-Time Trivia Platform

**Product:** Mimo
**Version:** 2.0 — visual system rebuilt light and indigo; v1 was dark and amber under the working name *Tez*. Section 2.4 records why.
**Date:** 25 July 2026
**Owner:** Design
**Companion documents:** `prd.md` (what and why), `tech.md` (how it's built)

---

## 1. Design brief

**Subject.** A 70-second head-to-head quiz duel.
**Audience.** Students and quiz players in India, roughly 15–25, mostly on mid-range Android, mostly playing in the evening.
**The single job of the app.** Make answering a question feel like a sport.

Everything below follows from that last sentence. This is not a study app that happens to be competitive — it is a competitive game that happens to teach.

---

## 2. Direction

### 2.1 Where the visual language comes from

Three artifacts, deliberately fused:

**The modern quiz app.** Light paper, indigo brand, rounded cards, and four fixed colours for four answers. This is the language the audience already reads fluently — they have played something that looks like this, and it costs them nothing to learn. It gives the app its ground, its warmth, and its permission to be fun.

**The OMR sheet.** Every competitive exam in India is answered by filling a bubble with a pencil. It is the most recognisable answer-interaction in the audience's life. It gives the app its signature: **you do not tap a button to answer, you fill a bubble.**

**The scoreboard.** Not its darkness, but its manners: numerals that are the largest thing on the screen, scores that roll rather than fade, one clock owned by two people.

The fusion is the point. The quiz-app surface supplies familiarity and speed of learning; the bubble supplies the quiet joke — the thing that means anxiety in an exam hall becomes the thing that means speed in a game — and the scoreboard supplies the tension.

### 2.2 What this direction rejects

- **Bevels, glossy gradients, cartoon mascots.** Rounded and friendly is not the same as childish, and the audience takes their exams seriously.
- **Edtech blue and grey.** Reads as homework and kills the game feeling instantly. Indigo is a deliberate step away from institutional blue.
- **Neon-on-black.** The default "competitive app" look, and now a decade old. The app is played in the evening but read in daylight too, and a student comparing an assignment to a textbook should not be squinting.
- **Colour as decoration.** Every saturated surface in this app means something. See §3.2 and §3.4.

### 2.3 The signature

**The dual countdown over four coloured answers.** A single horizontal bar shows both players' remaining time and answer state at once. Four full-width answer rows sit below the question, each in its fixed colour with an OMR bubble at its left edge. Tapping fills the bubble with a short ink-spread animation, the row locks, and the player's half of the countdown bar freezes.

You can see your opponent has answered — the tension of that — without seeing what they chose. This one element carries the entire product.

### 2.4 Why v1 was replaced

v1 was dark, petrol-green, and amber-accented, built on a stadium-at-night metaphor. It was coherent, and it was wrong for two reasons that only showed up in use.

**It read as a niche app.** The metaphor had to be explained. Every product the audience already plays in this category is light and friendly, and asking them to learn a new visual language before their first match is a tax paid at exactly the wrong moment.

**It fought its own second job.** Half of Mimo is coursework: assignments, contests, and a review screen with explanations meant to be read at length. Dark, high-contrast chrome is good for a 70-second duel and hostile to seven explanations in a row.

What survived is what was actually load-bearing: the OMR bubble, the dual countdown, colour discipline, and the rule that one screen gets one primary button. Those are in §6.1, §6.2, §3.2 and §6.5, and none of them changed.

---

## 3. Colour

### 3.1 Palette

| Token | Hex | Role |
|---|---|---|
| `--indigo` | `#5B4CE6` | The brand, the one primary button, and **you**. |
| `--indigo-press` | `#4A3BD4` | Pressed primary. |
| `--indigo-deep` | `#3F31B8` | The foot of the indigo field, the podium. |
| `--indigo-soft` | `#EDEBFE` | Tinted fills: soft buttons, active chips, the viewer's row. |
| `--canvas` | `#FFFFFF` | App ground. |
| `--sunken` | `#F4F4FA` | Inputs, search fields, skeletons — a surface that recedes. |
| `--hairline` | `#EBEBF3` | Borders and dividers. |
| `--ink` | `#1B1B2F` | Primary text. |
| `--ink-muted` | `#6B6C82` | Secondary text and labels. |
| `--ink-faint` | `#9C9DB2` | Metadata, placeholder, disabled. |
| `--rival` | `#FF5C7A` | The opponent, everywhere and always. |
| `--correct` | `#2FBF83` | Correct answer confirmation only. |
| `--wrong` | `#E9534E` | Wrong answer only. |
| `--option-a…d` | see §3.4 | The four answer colours. Positional, never a verdict. |

### 3.2 Colour discipline

This is the rule that keeps the design from drifting:

**`--indigo` means the brand, and in a match it means you.** The one primary button on a screen, the viewer's own row in a leaderboard, the player's half of the countdown, the player's score. It is never used to make something merely look important — that is the job of size and position.

**`--rival` means the opponent.** Their avatar ring, their half of the countdown, their score, their choice in the result reveal. Never used for anything else.

**`--correct` and `--wrong` appear only at round resolution.** They are the two-frame verdict, then they are gone. They are deliberately not drawn from the four option colours (§3.4), because an option that happens to be green must not read as pre-marked.

Everything else is ink on paper. The restraint is what lets one indigo button per screen actually mean *press this*.

### 3.3 Space theming

An Institute Space overrides exactly two things: the **logo** in the Space header, and a single **accent** used for Space-specific chrome — the identity band on the space home, and assignment progress bars.

The accent **never** replaces `--indigo`, `--rival`, `--correct`, or `--wrong`. Game state colours are constant across every Space, so a student switching worlds is never confused about what a colour means. Admins choose from a curated set of eight accents, every one of which clears 4.5:1 with white text; free colour entry is not offered, because a Space accent fills a band the student reads their own name against.

### 3.4 The four option colours

| Token | Hex | Option |
|---|---|---|
| `--option-a` | `#3B82F6` | A |
| `--option-b` | `#EC5A5A` | B |
| `--option-c` | `#F2A03D` | C |
| `--option-d` | `#3CC28B` | D |

**These are positional, not semantic.** Option A is blue in every question the player ever sees; a red option is not a wrong option, it is the second option. This is the one place in the app where saturated colour carries no meaning, and it works precisely because it is consistent — after three matches the player is reaching for a position, not reading a label.

They are overridden only at resolution, when `--correct` and `--wrong` take the row completely.

Unchosen rows **recede to 40% rather than turning red.** Exactly one option was wrong; colouring three of them as failures teaches the wrong lesson and buries the answer the player is meant to take away.

---

## 4. Typography

### 4.1 Faces

| Role | Face | Weights | Rationale |
|---|---|---|---|
| **Headings, questions, numerals** | Poppins | 600, 700 | A geometric with near-circular bowls. It is what makes a heading feel friendly rather than institutional, and its figures are wide and unambiguous at score sizes. |
| **Interface and body** | Inter | 400, 500, 600 | The taller x-height that keeps a 12px metadata line legible on a mid-range Android screen. |

Using one for the other's job breaks both: Poppins at 12px loses its footing, and Inter at 48px is merely correct.

Both are open-licensed and available on Google Fonts, so they ship as bundled assets with no licensing cost. Five faces are bundled, imported from per-weight entry points rather than the package index — the index reaches every weight of the family, and Metro bundles what it can reach.

### 4.2 Scale

| Token | Size / line | Face | Use |
|---|---|---|---|
| `score-hero` | 48 / 54 | Poppins 700 | Final score, the verdict |
| `score-live` | 30 / 34 | Poppins 700 | Live score during a match |
| `timer` | 22 / 26 | Poppins 700 | A number standing alone: a rating, a stat tile |
| `display` | 26 / 34 | Poppins 600 | Screen titles |
| `title` | 19 / 26 | Poppins 600 | Card and section titles |
| `question` | 21 / 29 | Poppins 600 | Question text |
| `option` | 16 / 22 | Inter 600 | Answer option text |
| `body` | 15 / 23 | Inter 400 | General copy |
| `body-strong` | 15 / 23 | Inter 500 | List rows, settings labels |
| `label` | 14 / 20 | Inter 600 | Buttons, field labels |
| `meta` | 12 / 17 | Inter 500 | Timestamps, counts, captions |
| `tiny` | 11 / 15 | Inter 500 | Badges, tab labels |

**Question text is capped at 140 characters.** Beyond that it drops to 18px, and beyond 200 it is rejected at authoring time. A question nobody can read in ten seconds is a broken question, and this is enforced in the admin portal rather than left to chance.

---

## 5. Layout and spacing

**Spacing scale (px):** 4, 8, 12, 16, 24, 32, 48, 64. Nothing between.

**Screen gutter:** 20px. **Card padding:** 16px. **Gap between stacked cards:** 12px.

**Radii:** 18px on cards and sheets, 14px on inputs, 12px on chips, fully rounded on buttons and pills. The radii are generous and deliberately so: this is a light app about play, and a 4px corner would make it read as a form. Bubbles and avatars are circles.

**Touch targets:** 48px minimum. Answer rows are 60px tall and span the full content width — under time pressure, a player should never miss.

**Safe areas:** honoured on all screens. The countdown bar sits below the notch, never under it.

### 5.1 Elevation

Three levels and no more.

| Level | Shadow | Use |
|---|---|---|
| `raised` | y5, blur 14, 6% | A card resting on paper |
| `floating` | y10, blur 22, 12% | Something that has left the page: the tab bar's Play button |
| `sheet` | y-6, blur 32, 20% | A modal or bottom sheet |

A fourth would only ever be used to make something look more important than the thing beside it, which is the job of position and size. Elevations are never stacked — a raised card does not contain another raised card.

---

## 6. Components

### 6.1 Answer row — the answer control

The most important component in the product. Two ideas welded together.

The **colour** is the quiz-app convention the audience already knows: four options, four fixed colours, A through D (§3.4). The **bubble** is ours: a 26px circle at the row's left edge, white ring, empty.

**Resting:** the option's own colour fills the row, 60px tall, radius 14, white `option` text, open bubble carrying the option letter.

**Pressed:** the row scales to 0.98 over 60ms. Nothing else moves — there is no time for it.

**Filled:** ink spreads from the centre of the bubble in 180ms with an ease-out curve, deliberately reminiscent of a pencil. The row gains a 3px white outline, and every other row drops to 40%. The row is now locked.

**Resolution — correct:** the row becomes `--correct` and a check lands on the right over 200ms.

**Resolution — wrong:** the row becomes `--wrong` with a cross, plus a 4px `--rival` marker on the right edge if that was the opponent's choice.

**Resolution — correct but unchosen:** that row *also* becomes `--correct`. This is the teaching state, and it is why unchosen rows recede rather than redden (§3.4).

### 6.2 Dual countdown

An 8px bar directly beneath the question, full content width, split at the centre.

The left half drains right-to-left in `--indigo` — that is the player. The right half drains left-to-right in `--rival` — that is the opponent. Both drain in real time from 10 seconds.

When a player answers, their half **freezes** at its current length and gains a 3px `--ink` cap. Frozen length is the visible record of how fast they were. When both halves are frozen, or both reach zero, the round resolves.

This single element replaces an opponent status indicator, a timer readout, and a speed indicator. It is why the match screen has room to breathe.

### 6.3 Score display

Player score left in `--indigo`, opponent score right in `--rival`, both at `score-live`, both in Poppins.

On increment the digits **roll** upward over 300ms rather than cross-fading — a split-flap reference, and it makes points feel earned. Rolling is suppressed under reduced-motion, where the value simply updates.

### 6.4 Topic card

Three shapes, one component.

**tile** — the unit of every horizontal row on Home. Cover at 16:11 on top, name and metadata on white beneath, one badge in the cover's corner.
**hero** — the same card full width with the name over a scrim, for "Start here" and for a single result.
**row** — a 76px thumbnail beside two lines of text, for dense lists like search.

Cover art carries topic identity, so the chrome stays minimal: **exactly one badge** — the level the viewer has reached, or the question count if they have not played it. The moment a card carries two badges, neither is read.

A topic with no cover art gets a generated glyph: its initial on a tint derived from its name, so the placeholder is still distinct per topic rather than a grey rectangle.

### 6.5 Buttons

| Variant | Fill | Text | Use |
|---|---|---|---|
| Primary | `--indigo` | white | One per screen. The main action. |
| Soft | `--indigo-soft` | `--indigo` | The companion directly beneath a primary |
| Outline | transparent, 1.5px `--indigo` | `--indigo` | Supporting actions |
| Ghost | none | `--ink-muted` | Tertiary, dismissals |
| Danger | transparent, 1.5px `--wrong` | `--wrong` | Leave, delete, block |
| On-colour | white | `--indigo` | The primary when the screen is the indigo field |
| On-colour soft | 18% white | white | Its companion there |

Height 54px, fully rounded, `label` scale at 16px. Press scales to 0.97 over 80ms — enough to feel, not enough to notice.

### 6.6 Avatar

Circular. Sizes 32, 44, 56, 84, 96. In a match the player's avatar carries a 2.5px `--indigo` ring and the opponent's a 2.5px `--rival` ring — so identity and colour are bound together from the versus screen onward. With no image it falls back to initials on `--indigo-soft`.

### 6.7 Chips and segmented controls

**Chip** — a filter pill, 38px tall, fully rounded. Filled `--indigo` with white text when on, `--indigo` outline on white when off. Used for leaderboard periods and search categories.

**Segmented** — one row on a `--sunken` track, the selected pane in white with its own small shadow. Used where the options are exclusive *and* exhaustive, which is what separates it from a row of chips: leaderboard scope is segmented, leaderboard period is chips.

---

## 7. Motion

**Principle: motion is reserved for the moments that carry emotion.** Navigation is quiet. The match is not.

| Moment | Motion | Duration |
|---|---|---|
| Screen transition | Horizontal slide | 240ms, ease-out |
| Bubble fill | Ink spread from centre | 180ms, ease-out |
| Round transition | Vertical wipe, question up and out, next down and in | 320ms |
| Score increment | Digit roll upward | 300ms |
| Result reveal | Scores count up from zero, then the verdict lands | 900ms total |
| Rating change | Number ticks to its new value | 600ms |
| Searching for opponent | Slow pulse on the topic cover, 2s loop | Ambient |

**Reduced motion:** every animation above degrades to an instant state change or a 120ms opacity fade. The bubble still fills, because the fill is state rather than decoration — it simply appears without the spread.

---

## 8. Screens — mobile

### 8.1 Onboarding

**The intro is three pages and one button.** Per page: one illustration, one headline, one line. Below the pager, three dots and a single **Let's go**. The field is night lit from the left in the player's teal and from the right in the rival's coral — the only two colours on the screen, and the two that mean *you* and *them* everywhere else.

| Page | Says |
|---|---|
| the two of them playing | Think fast. Win faster. |
| the two of them with a topic between them | Pick your battlefield. |
| the two of them celebrating | Climb. Then keep it. |

For a long time the hero was the mechanic: two catalogue avatars in their player rings with a VS badge struck between them. It said "one against one" with total precision and nothing at all about why anyone would want that. **The first screen of an app is not where a mechanic gets explained — it is where someone decides whether the people in it are having a good time.**

**On returning to a pager.** The original intro was also three swipeable pages, and the note that killed it read *nobody swipes them, and a claim is weaker than the thing itself*. Both were true of what it was: three walls of text behind a Next button, where swiping was work and the reward was more reading. Pictures change that trade, and one rule keeps the old failure from returning — **the primary button is live on page one and says the same thing on all three.** Nothing is ever gated behind a swipe; a player who never touches the pager loses a picture, not a step. That is precisely the property the first version lacked.

The screen also lost about half of what was on it — the three-cell claim rail (its claims *are* the three pages now) and the fine print under the button.

**Then four steps, one idea per screen.** Phone entry → OTP → name and avatar → pick your interests, with a progress bar carried across all four. A skip is available on the interests step, defaulting to trending topics.

The OTP step is six boxes over one hidden input. A real six-input implementation has to chase focus on every keystroke and on backspace, and it breaks SMS autofill on both platforms; the hidden field keeps `oneTimeCode` working, which is the only thing on that screen that actually matters.

Interests are a two-column grid of tiles, not a chip cloud. A chip cloud reflows every time a topic name is long and gives no sense of how many there are; a grid is countable.

Copy is plain and short. There is still no feature tour — the audience learns the match by playing one.

### 8.2 Home

**Home is a dashboard, not a catalogue.** It listed topics once, and so did the Play sheet — the same rows, from the same request, with a tile that opened a topic on one screen and started a match on the other. The catalogue moved to Play (§8.16), which is now the only place in the app that lists topics, and Home kept the four things a dashboard is for.

Avatar and space switcher top-left, coin balance top-right — the same two corners the Shop and the profile use. No search (it lives on the list it searches) and no gear (Settings is on the profile band). The switcher shows the current world's logo and stays in that corner in both worlds (§8.12).

Under the name, the **level card**: level, the XP bar to the next one, and the league badge. **One card, one target** — the whole thing opens the profile. The badge was briefly a nested press target of its own with a chevron beside it, opening the leaderboard while the card around it opened the profile; two destinations in one card, and the chevron implied the badge was the card's action when the card had a different one. The badge is data. Rankings has its own tile eight points below, where nothing competes to be pressed.

XP is the number on that bar rather than rating, because it is the one that moves after **every** match. The league only moves on a ranked result and the level only moves when the bar fills, so the bar is the part with something to say most days.

Then the **Arena poster** — the one place on Home that asks for something, and the only card here carrying artwork (§12.2). Copy on the left over flat night, the two players bottom-right and clipped by the card, a gradient between them so there is no edge to misread. It names the topic it will play in the line under the title: your last one, or the featured topic if you have never played. A match is always about a topic (the queue is keyed on one), so a button reading "Play now" with no named topic could only send you to a list to answer a question the app already knew. Under the button, quietly, *Choose a different topic*.

The copy column is held clear of the art with a **percentage** padding, not points — the art is sized in per cent too, and two fixed numbers would agree on exactly one screen width.

Then the **streak card**. A streak is the one number in the app that goes down by doing nothing, which is what earns it a card. Gold and asking on the day it has not been fed; quiet with a tick once it has; at zero it reads *Start a streak* and says what one match today would begin.

Then **two ladder tiles**, half width each: *Rankings* with your rating (or "Unranked"), and *Achievements* with `n of 7`.

Last, *Jump back in*: up to **three** topics with a match behind them, as list rows. History, not discovery. The moment it grows past three it is the catalogue again.

They were cover tiles three across, and that was wrong for a reason worth keeping: three tiles looked deliberate, one tile looked like two had failed to load — and one is the common case, because most players have a topic rather than a shelf of them. A list reads the same at any length and has room for the level, which is the actual reason to return to a topic.

**Everything above the last row is unconditional, and that is the point.** The first build of this screen hid the streak at zero and the history when empty, on the reasoning that a card with nothing to say should not draw. On a new account that left a header, one button, and eight hundred points of nothing — a screen that reads as broken rather than as new. Every one of these rows has something true to say on a fresh account: you are level 1, this is the topic to start on, you have no streak *yet*, and here are two ladders you have not climbed. The fix for a card that sounds like a scold is different words, not a missing card.

### 8.3 Topic

Cover image header. Topic name and category. The viewer's mastery level and rank. Below: topic leaderboard top 10 with the viewer's row pinned, then their recent matches on this topic.

A primary button pinned to the bottom, and it **names the stake**: *Play ranked* or *Play quick match*. The mode is chosen on the Play tab and held in game state, so by the time a player reaches this button the choice was made on a different screen — possibly days ago. A button reading only "Play" would be the app quietly deciding whether this match moves a rating. This is the last screen before it is taken, so this is where it has to be said.

### 8.4 Searching

The indigo field, with the topic cover behind it at 16% and the player's own face at the centre, two rings breathing outward from it. Centred: "Finding an opponent". A cancel button sits at the bottom.

The rings pulse rather than spin, and that is deliberate — a spinner is a promise that something might take a while.

This screen is visible for at most 3 seconds, always. There is no long-wait state and no "still looking" copy, because there is never a long wait — a ghost is served instead.

### 8.5 Versus

Both avatars slide in from opposite edges. Names, topic ratings, head-to-head record if any. Topic name centred. Three-second countdown. No skip — this is the breath before the match and it earns its time.

### 8.6 Match

The whole product in one screen.

```
┌────────────────────────────────┐
│       Correct!    +140         │   verdict banner, at resolution only
├────────────────────────────────┤
│  ●You  118          142  Rival●│   scores, live
│           Round 4 of 7         │   meta
│  ┌──────────────────────────┐  │
│  │  Which element has the   │  │   question
│  │  atomic number 26?       │  │
│  └──────────────────────────┘  │
│  ████████████░░░░│░░░░████████ │   dual countdown
│  ┌──────────────────────────┐  │
│  │ ⓐ  Iron                  │  │   blue
│  ├──────────────────────────┤  │
│  │ ⓑ  Copper                │  │   red
│  ├──────────────────────────┤  │
│  │ ⓒ  Zinc                  │  │   amber
│  ├──────────────────────────┤  │
│  │ ⓓ  Nickel                │  │   green
│  └──────────────────────────┘  │
└────────────────────────────────┘
```

This is the one screen not adapted from a reference. A hosted quiz shows one player their own progress; this shows two players one clock, and every decision in the layout exists to serve that.

Nothing else. No chat, no emotes, no settings, no back button. Leaving mid-match requires a confirmation that names the consequence: "Leave now and you forfeit."

### 8.7 Round result

The rows resolve in place — no screen change. The correct answer turns `--correct`, the player's wrong choice turns `--wrong`, the rows they did not take recede to 40%, and the opponent's choice gains a `--rival` edge marker. A verdict banner drops from the top edge over 260ms carrying the word and the points; it is the only element in the app that covers something, and it earns that because the eye is already at the top of the screen watching the score. 2.5 seconds, then the wipe.

Staying on the same screen matters: the player's eyes never have to relocate, which keeps the pace tight across seven rounds.

### 8.8 Match result

**One scoreboard card**, then the progressions beneath it.

Verdict, faces, scores and the round strip used to be three floating blocks stacked down the page. They are one fact — what happened in this match — and splitting them made the eye assemble it, while every section below (rating, XP, level) was already a bordered card. The receipt was the only part of the screen that did not look composed.

Inside the card, in order of what the player came for:

1. the **verdict** at `score-hero`, after the scores count up from zero
2. the **two scores**, separated by an em dash. The winner's is tinted, set in the display face rather than the score face, **and** ticked — three signals, because green-against-red at equal weight is exactly the pair roughly one man in twelve cannot separate, and this is the one number they came to read
3. the **faces** at 64, not 92. They identify the players; they are not the news
4. the **rounds** on a hairline below — seven dots, plus *4 of 7 right*, because seven dots is a thing to count and nobody counts

A win gets a warmer rim on the card and nothing else. Artwork was tried here and removed (§12.2): this is a screen reached several times an hour, and its type is already the loudest thing in the app.

Beneath: ranked rating with its league band, three stat tiles, the level-up card with what it unlocked. Actions: **Rematch** (primary), Review questions, Share, Home.

### 8.9 Review

A scrollable list, one card per question: the question, all four options with the correct one marked, both players' choices, and the explanation where the question has one.

For institute content this is the screen where learning actually happens, which is why explanations are strongly encouraged in the PRD. Design it for reading, not for skimming — generous line height, full text, no truncation.

### 8.10 Profile

Avatar, name, city, overall rating. Achievement row. Top topics with mastery levels. Recent matches. On another player's profile, the head-to-head record sits directly under their name.

### 8.11 Leaderboard

Segmented control for scope, a dropdown for period. Rows show rank, avatar, name, rating. The viewer's row is pinned to the bottom edge with a 4px `--indigo` left border when they are outside the visible range. The top three ranks carry a medal disc instead of a plain number — the one ornament on the screen, and it is doing real work: three ranks people actually care about, distinguishable at a glance from the ninety-seven that are just an ordering.

### 8.12 Space home

Institute logo and accent band at the top. Then: pending assignments with progress, upcoming or live contests, assigned topics, class leaderboard, personal progress summary.

Visually a sibling of Home, not a different app. Same components, same spacing, different content and one accent.

**The order is the argument.** Work first, because that is what a student is accountable for; then events, which have a deadline; then the open-ended stuff. A student who opens this and reads "two matches left on Mechanics" knows what to do without reading anything else.

It is the same screen as Home rather than a separate tab. The space switcher stays in the same corner in both worlds, so switching feels like changing channel rather than changing app.

### 8.13 Assignment card

Title, then the requirement in one plain sentence, then a progress bar, then the fraction in words beneath it.

**The bar is the point.** A tick tells a student they are done; a bar tells them how much is left, and "two more matches" is the only version of this that gets someone to open the app again.

The bar uses the **Space accent** — an assignment is not live, it is owed, so it never borrows the colour of something happening right now. It turns `--correct` when complete and `--wrong` when overdue. The due date is always relative: "Due in 3 days", "Due tomorrow", "2 days late". A calendar date makes the reader do arithmetic.

### 8.14 Contest card and contest screen

**The card** leads with the clock and lets nothing else compete. A live contest ticks down in real time; that ticking is the only moving number on the screen, which is exactly why it pulls the eye. **A live contest is the one card in the app that inverts** — indigo fill, white text. Everything else in the feed is ink on paper, so the single thing with a running clock is impossible to scroll past by accident. Nothing else in the app gets this treatment, and if a second thing ever does, this one stops working.

**The screen** is the window, three facts, one action, and the standings.

The action is a single **Enter** button. When the student cannot enter, the button is *replaced by a sentence saying why* — never a disabled button with no explanation. "This opens in 3 hr. You will get a notification." "You have already played this contest." "This contest is for a different batch." Each names a different thing they can do about it.

Standings rows carry rank, avatar, name, total answering time and score. The viewer's own row is pinned to the bottom when it falls outside the visible range, exactly as §8.11 specifies for leaderboards — the same component, the same rule.

The screen splits the two things a contest is across two surfaces: the indigo header carries the **deadline**, the white sheet below carries the **ranking**. They never share a surface.

### 8.15 The dock

Five equal slots on a floating pill, inset from the screen edges: **Home · Shop · Play · Friends · You**.

It went through two earlier shapes and both are worth recording, because the reasons they failed are the reasons this one holds.

**Four tabs and a raised centre button.** Play was something you *do* rather than somewhere you can *be*, so it rose clear of the bar, carried the mark, and opened a modal — which meant it never became a place you were "in" and had no selected state to get wrong. That worked at four slots. At five the button crowded both its neighbours and the notch cut a pill that no longer had any symmetry to cut, and the dock read as broken rather than as a feature.

**Five slots, one of them a pseudo-tab.** Play kept the middle but still pushed a modal, marked by a tinted disc instead of a selected bar. Honest, and it survived exactly as long as Play was a sheet that asked one question and closed.

**Five identical slots.** Play is the topic library now — a place you browse, filter, and come back to — so it is an ordinary tab with an ordinary selected bar and the disc is gone. Nothing in the dock is doing something different from its neighbours, which is the point: five things want five equal slots.

Ranks left the bar when Shop and Play both needed one. It is a screen people visit occasionally, and three contextual doors (§8.2, §8.10, Friends) beat a permanent slot.

The bar is separated by a hairline and its own shadow rather than by a filled strip, so a list scrolling under it reads as one surface. Each slot's press target is the whole flexed cell rather than the glyph, which is what keeps it past 44pt with five of them on the narrowest phone.

### 8.16 Play — the topic library

Every topic, and what a match on it is worth. This is the only screen in the app that lists topics; Home's grid and the standalone search screen were both folded into it.

Pinned at the top: the title, a **stake pill**, a search field, and category chips derived from the results actually returned (a filter that can return nothing is worse than no filter). Below, a virtualized two-up grid of covers.

**The stake is a pill, not two cards.** Ranked-or-quick used to be two 64pt explanatory cards, which was right on a sheet whose only job was to ask and wrong on a browsing screen, where it plus a title plus a field plus a filter row pins two hundred points of chrome above the first cover. The pill opens a sheet holding those same two cards with their reasoning intact, and the choice persists in game state.

**Tapping a topic opens the topic, not a match.** One rule for every topic tile in the app, no exceptions to remember — and it removes a real hazard, because with a mode armed at the top of a scrolling grid, tile-taps-queue means one stray thumb costs you rating. The match is joined from the topic screen's button, which names the stake (§8.3).

### 8.17 Friends

Title with an **Invite** button beside it, then a search field. Below, in order: a **Rankings** row, live challenges, incoming requests, the friend list, and *You played them recently*.

**The empty state used to be a dead end** — a title, a sentence, and a search field that asks you to already know somebody's exact name. Every new account landed on it and there was nothing on the screen a person could press. Two things fix that, and neither is copy:

- **Invite** opens the OS share sheet, so it works with whatever the player actually talks to their friends on. The message carries a link to the sender's own profile, so accepting lands on a page that says who asked. It stays visible once there *are* friends, because invites do not stop mattering.
- **People you played** is the only suggestion source we have that can explain itself: you went seven questions with them an hour ago, and the row says so. Anyone already in a friendship row — accepted, pending, declined, blocked — is excluded. Re-offering someone who declined is the exact behaviour that makes people stop trusting a suggestion list.

The **Rankings** row is the one row here that is not a person, which is why it is a bordered card rather than a list item. "How do I compare to my friends" is a question about people, the leaderboard already has a Friends scope, and this is the tab a player is on when they ask it.

### 8.18 Shop

Documented with the economy it serves — see `coins-and-cosmetics.md` §3.2.

---

## 9. Screens — admin portal

### 9.1 Why the admin portal is light

It is used in daylight, for long sessions, on a laptop, and its output gets printed. Since v2 the app is light too, which removes the old contrast between the two — but the portal is still a *different* light: a faintly cooler ground so that a page of dense tables settles back, where the app's pure white pushes cards forward.

**Ground** `#F6F6FB`, **surface** `#FFFFFF`, **border** `#EBEBF3`, **text** `#1B1B2F` and `#6B6C82`. The Space accent carries through for primary actions and active navigation, so it still feels like the same product. `--correct` and `--wrong` keep their meanings in data views, and the type scale is shared.

### 9.2 Structure

Left sidebar navigation — Dashboard, Questions, Topics, Students, Contests, Reports, Settings. Content area with a page header, a filter bar, and the working surface. Breadcrumbs on nested views.

### 9.3 The question editor

The most-used screen in the portal, and the one that decides whether an admin stays.

Single column, generous width. Question text with a live character count that turns amber past 140. Four option rows, each with a radio to mark it correct — using the same OMR bubble as the game, so admins see exactly what students will see. The live preview panel beside it tracks the app rather than the portal: when the match screen went from ink to paper and the four option colours arrived, the preview had to follow, or it would be previewing a product that no longer exists. Difficulty as a three-way segmented control. Topic and tag pickers. Collapsible optional section for explanation, image, and time override.

A **live preview panel** on the right renders the question exactly as it appears in the match screen, in the game's dark theme, at real size. Admins write better questions when they can see the ten-second reality of them.

Save and add another is the primary action, because admins work in batches. Keyboard shortcuts throughout — the single highest-leverage thing for anyone entering hundreds of questions.

### 9.4 Bulk import

Three steps, one screen. Upload, then a validation table showing every row with its errors inline and editable, then confirm. Nothing imports until every row is valid or explicitly skipped. The error report is downloadable.

### 9.5 Contests and assignments

**Contests** are grouped by clock, not by name: live at the top with the time remaining, scheduled next with the countdown to open, finished below with their standings. That is the order an admin thinks in on the day.

Creation defaults to tomorrow evening for an hour, so the common case is one field of typing. Once students have entered, the questions and the start time lock, and the sheet says so in a sentence rather than by greying out fields with no explanation.

**Assignments** exist to answer one question: *who has not done it*. So the per-assignment view lists every targeted student — including, especially, the ones who have done nothing — sorted not-started first. The list row leads with the fraction rather than the due date: a due date tells you when to worry, the fraction tells you whether to.

There is no "mark as complete". An assignment is satisfied by playing, which is the entire reason it belongs in this product rather than in a spreadsheet.

### 9.6 The review queue

Oldest first, because a queue sorted newest-first is a queue whose bottom never gets read.

Every draft shows its whole self on the card: the question, all four options, the marked answer, the explanation. A reviewer who has to click into a question to see its answer key will stop checking answer keys — and a wrong answer key is the single worst thing this queue can pass through.

Bulk approve exists because a reviewer works through forty at a time, but it is the secondary action and the count is in the label: **Publish 12**, never just **Publish**.

### 9.7 Dashboard

Six summary cards across the top. Engagement chart below. Two ranked lists side by side: weakest topics, and least active students. An alerts strip sits above everything when action is pending.

Sparse by design. A dashboard that shows everything gets read as wallpaper.

### 9.8 Comparison reports

Period vs period is deliberately **not a chart**. A chart shows a shape; the question here is "is this better or worse than it was", which is a number and a direction. Four figures, each with an arrow, a percentage and the word *up* or *down* — so it survives grayscale, per §13.6.

---

## 10. Voice and copy

**Register:** plain, direct, second person, sentence case. Never exclamatory, never congratulatory beyond what was earned.

| Situation | Write | Not |
|---|---|---|
| Match won | Won | Congratulations! You crushed it! 🎉 |
| Match lost | Lost by 34 | Better luck next time! |
| No opponent | *(never shown — a ghost is served)* | No players available |
| Empty topic list | No topics yet. Your admin adds them here. | Nothing to see here! |
| Network failure | Lost connection. Reconnecting. | Oops! Something went wrong |
| Forfeit warning | Leave now and you forfeit. | Are you sure you want to quit? |
| Question reported | Reported. We'll review it. | Thank you for your feedback! |

**Errors state what happened and what to do.** They do not apologise and they are never vague.

**Empty states are invitations.** Every one names the single next action.

**Buttons keep their name through the flow.** The button that says Publish produces a state that says Published.

---

## 11. Accessibility

- **Contrast:** all text meets WCAG AA on its background. `--ink` on `--canvas` is 15.1:1 and `--ink-muted` on `--canvas` is 5.4:1; white on `--indigo` is 6.1:1, and white on every one of the four option colours clears 4.5:1 at 16px semibold.
- **Colour is never the only signal.** Correct answers carry a check alongside `--correct`; wrong answers carry a cross alongside `--wrong`. The dual countdown pairs colour with position — the player is always the left half, whatever the colours are doing. This matters more since v2 than it did before: the four option colours are meaningless by design, so a player who cannot separate red from green must never have needed to.
- **Touch targets** are 48px minimum, 56px for answer rows.
- **Screen readers:** every bubble announces its option letter, its text, and its state. The countdown announces at 5 and 3 seconds rather than continuously.
- **Reduced motion** respected throughout, per §7.
- **Dynamic type** supported to 200%. Question text reflows; the match layout is tested at maximum size with the longest permitted question.
- **The 10-second limit is configurable per Space**, so an institute supporting students who need longer can raise it without leaving the product.

---

## 12. Assets

- **The mark:** two overlapping circles, the left filled and the right an open ring. It is the two `o`s of *Mimo*, it is an OMR bubble filled and unfilled, and it is the product — two players, one question, one of them ahead. A mark that has to be explained is a bad mark; this one only has to be seen twice.
- **App icon and splash:** the mark in white on `--indigo`.
- **Topic covers:** 1200×675, under 100KB, served as WebP with JPEG fallback. A generated fallback — the topic initial on a tint derived from its name — covers topics without art.
- **Avatars:** 512×512 source, served at 96 and 192. Twelve presets ship with the app for users who skip upload.
- **Icons:** a single geometric outline set, drawn from plain views rather than an icon font or an SVG runtime. That is a real constraint — a couple of these glyphs would be two bezier curves in a drawing tool — but it ships no third asset pipeline and it keeps the set honest about how simple it should be.

### 12.2 Illustration

The default is **drawn from views in the app's own palette, not shipped as artwork**. The topic glyphs, the league metals and the treasure chest are all composed from Views. Two reasons, and the second is the real one:

1. Full-bleed PNGs at 3× are most of a megabyte, on a first launch, over 4G, before the player has seen anything.
2. Stock illustration is the fastest way to make a product look like every other product. Views are the app's own components at size — the answer rows, the countdown, the bubbles — so a screen shows the thing itself rather than a drawing of people being happy near it.

**The exception, and the rule that bounds it.** Shipped artwork appears on exactly two surfaces: the **welcome pager** (§8.1) and the **Arena poster** on Home (§8.2). Both are places trying to make someone **want** something. Everything else *reports* — level, streak, rating, history, prices — and flat night is what reporting should look like.

So the test for adding an illustration is not "would this look nicer". It is: **is this surface asking, or telling?** A card that has to be wanted needs a face on it. A card stating a number does not, and putting one there is how a product ends up with artwork on its settings screen.

It briefly appeared on a won match too, and that was wrong twice over: the result screen is one a player reaches several times an hour, which is the last place to spend 60 KB on decoration, and its type is already the loudest thing in the app.

**Production.** The renders arrive as opaque RGBA on a white studio ground, which on night is not a background but a white rectangle. `mobile/scripts/cutout.py` keys them:

- **Flood fill from the frame edge**, not a global threshold. The girl wears a cream cardigan, white socks and white flowers; a threshold erases all of them. Background is the region *connected* to the edge, so anything white enclosed by the subject survives by construction.
- **A second, softer pass** for the contact shadow, which is nowhere near white and therefore survives a strict key. It sets alpha from luminance so the shadow *fades* — a hard cut around a soft shadow is more obviously wrong than the shadow was.
- **Un-compositing the rim.** Anti-aliased pixels are the subject blended toward white; left alone they read as a pale halo on a dark ground. Each partially-transparent pixel is pushed away from white in proportion to its transparency.

Output is **lossy WebP with alpha**, max 700px wide. As PNG the three came to 1.9 MB loading on the first screen of the app; as WebP they are 305 KB and the cut-out edge is intact. Metro carries `.webp` in `assetExts` by default and `expo-image` decodes it on both platforms.

---

## 13. What to check before shipping any screen

1. Does `--indigo` appear anywhere it does not mean *the brand action* or *you*?
2. Does a saturated colour appear anywhere it carries no meaning (§3.2, §3.4)?
3. Is there more than one primary button?
4. Does the layout survive the longest permitted question at 200% type?
5. Does every empty state name an action?
6. Does every error say what happened and what to do next?
7. Would this screen still be usable in grayscale?
8. Is anything raised drawn outside its parent's bounds? On Android that is an untappable control.
9. Remove one element. Is the screen worse? If not, leave it removed.

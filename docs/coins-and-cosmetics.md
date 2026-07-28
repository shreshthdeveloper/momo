# Coins and cosmetics

Status: **built.** Extends
[leagues-and-progression.md](leagues-and-progression.md), which describes the
progression system as it stood before this and which this replaces in one
specific place: how avatars and banners are obtained.

The shape of it: **levels pay in titles and money; the economy pays in
cosmetics.** A level used to hand you an avatar. Now a level hands you coins
and, every fifth one, a title, and every avatar and banner is bought, dropped or
won. Nothing does two jobs.

---

## 1. What changed, in one table

| | Before | Now |
|---|---|---|
| Avatars / banners | Level-locked | **Bought with coins, by rarity** |
| Catalogue | 66 avatars + 8 banners | **150 avatars + 50 banners** |
| Titles ("tags") | 16, level-gated to 50 | **22 — 20 on multiples of 5, plus two earned** |
| Account max level | 50 | **100** |
| Currency | — | **Coins** |
| Ranked rating | Never reset | **Soft reset on the 1st** |
| Chests | 3, once-ever, fixed contents | **2, monthly, 20 slots, draw one** |
| Guest accounts | Dead code, still wired through | **Removed, schema included** |

---

## 2. Rarity

Four tiers. The colour does most of the work — a player reads rarity before
they read a name or a price — so legendary takes **gold**, not the purple the
rare tier already owns. Two tiers sharing a colour defeats colour-coding them.

| Rarity | Colour | Avatars | Banners | Price | Obtained by |
|---|---|---|---|---|---|
| Common | grey `#9C99B4` | 50 | 20 | 200–300 | buy · level-up drop · chest |
| Uncommon | light blue `#5FBBE0` | 50 | 15 | 500–800 | buy · chest |
| Rare | purple `#A98BF0` | 30 | 8 | 1500–2000 | buy · chest |
| Legendary | gold `#F5B62E` | 20 | 7 | — | **chest only** |

Rarity is a property of the CONCEPT, not of where an item used to sit on the old
climb. That is what makes the shelves legible:

| Tier | Avatars are… |
|---|---|
| **Common** (50) | 20 food · 12 flowers · 18 simple animals |
| **Uncommon** (50) | 8 flowers · 26 animals · 16 professions |
| **Rare** (30) | the archetypes — ninja, pirate, samurai, wizard, witch, assassin, cyborg, android, superhero, villain, astronaut, dragon … |
| **Legendary** (20) | ten premium collections, two each |

Food is deliberately the floor of the catalogue. Twenty items in a grid of
faces is the fastest way to make the common shelf read as a different thing from
the rare one, and a slice of pizza is legible at 44px in a way a fourteenth
brown animal is not.

### 2.1 Prices are computed, not typed

A tier's items are spread evenly across its band in five steps, by their
position in the tier — so the common shelf runs 200 · 225 · 250 · 275 · 300,
uncommon 500 · 575 · 650 · 725 · 800, rare 1500 · 1625 · 1750 · 1875 · 2000.

`priceFor(rarity, index, tierSize)` in `shared/perks.js` is the whole of it. A
hand-written price per row is a number somebody has to keep in step with the
band it belongs to, and eventually will not. The value is still STORED on each
catalogue row, so a superadmin can retune one item without retuning a band.

Legendary returns `null`: a price on it would be an offer the shop cannot
honour.

### 2.2 Colour is never the only signal

Roughly one man in twelve cannot separate the purple from the grey reliably, so
every tier carries three signals at once:

- its **name**, in the shelf header — "RARE · 4 of 30"
- a **ring weight** that rises with the tier — 1 / 1.5 / 2 / 3
- a **price in words** on every locked tile

`mobile/src/lib/rarity.js` derives the tints from the served colour, so a
retuned tier looks the same on every surface it appears on.

### 2.3 The ten legendary collections

Two avatars each, chest-only, and they wear a frame nothing else in the
catalogue has — an outer bloom and a struck rim, so a legendary reads as one
before its face is even identified.

| Collection | The two |
|---|---|
| Cyberpunk Legends | Cyber Oni · Neon Runner |
| Celestial Gods | Sun Deity · Moon Deity |
| Shadow Assassins | Shadow Blade · Void Stalker |
| Dragon Masters | Dragon Lord · Scale Rider |
| Mythical Guardians | Phoenix Guard · Griffin Ward |
| Royal Dynasty | Emperor · Maharaja |
| Steampunk Elite | Brass Captain · Gear Baron |
| Arcane Mages | Archmage · Rune Weaver |
| Space Commanders | Star Admiral · Nova Captain |
| Samurai Shoguns | Demon Shogun · Oni Daimyo |

Seven of the fifty banners are legendary too, and they are the only ones with a
gradient and a vignette rather than a flat field: Neon Grid, Cosmic Veil, Void
Rift, Dragon Hide, Phoenix Fire, Royal Crest, Brass Works.

### 2.4 How the art was made

`mobile/scripts/make_art.py` generates all 200 with PIL — flat fills, no
gradients outside the premium tier, no outlines, every avatar a tinted disc.

The food, the professions and all twenty legendaries are **hand-authored**, one
function each. An earlier attempt built them by recombining a parts vocabulary
and it failed the only test that matters: at 44px every result read as the same
bear in a different coat. Silhouette, not colour, is what survives being shrunk.

The flowers and the extra animals are still parts-built, because a flower really
is a petal count and a palette.

Assets weigh ~1 MB. Keys are the wire format: append only, never rename, or
somebody loses the avatar they are wearing.

---

## 3. Coins

One number on the account. **No ledger** — no transaction history, no refunds,
no "where did it go" screen. A balance that only the server writes. A history is
a second source of truth that has to agree with the balance for ever, and
nothing in the product needs one.

Coins are **earned only**. There is no real-money purchase and no hook for one.

### 3.1 In

| Event | Coins |
|---|---|
| Ranked win | 50 |
| Ranked draw | 25 |
| Ranked loss | 10 |
| Quick play win | 20 |
| Level up | 150 |
| Level up on a multiple of 5 | 300 **+ that milestone's title + a random common** |
| Division promotion | 150 |
| League promotion | 500 |
| Chest coin slot | 25 / 50 / 100 (§5.3) |
| Duplicate from a chest | 50 / 150 / 400 / 800 by rarity (§5.5) |

A loss still pays. A currency that only rewards winning punishes exactly the
players who most need a reason to play the next match — the same argument
leagues-and-progression.md §1 makes for XP.

Quick play pays on a win alone, and challenge, practice and contest pay nothing.
They are XP-only modes by design, and a challenge is a thing two friends could
run all afternoon.

Roughly: 10 matches a day at an even win rate is ~300 coins/day. A common is a
day, a rare is a week.

**Everything a match pays is banked in the same write that banks the XP.** Two
writes would leave a window in which a player had levelled up and not been paid,
and with no transaction history there would be no way to detect it afterwards.

### 3.2 Out

The **Shop is a bottom-nav tab** — the fifth, beside Home, Ranks, Friends and
You. It started as the old Rewards screen with prices bolted on, and that was
wrong twice over: a stats page with prices on it reads as an inventory, and a
currency whose one use is buried two taps inside the profile may as well not
exist.

What it looks like now: a chest at the top as a case you can spin, then four
sliding shelves — one per tier — with a gold price tag on everything you do not
own. The XP bar and the league card went back to the profile, where the rest of
"how am I doing" already lives. This screen answers "what can I get".

`POST /me/shop/buy { type, key }`. The whole transaction is one conditional
update — deduct the price and add the key, on the condition that the balance
still covers it and the key is not already owned. That condition IS the
concurrency control: two taps that arrive together cannot both succeed, because
the second no longer matches its own filter. No lock, no transaction, nothing to
reconcile.

Legendary items appear in the shop and are never purchasable; they show what
they are and where they come from.

---

## 4. Levels and titles

**100 levels, 20 titles** — one every fifth level, at 5, 10, 15 … 100, granted
automatically by reaching the level.

One per level was the first plan and it made the title worthless: a thing you
receive a hundred times is a receipt, not a title. Every fifth makes the
milestone levels the ones that matter and gives the other four something to
count toward.

The fourteen that existed before keep their names and their order and simply
move onto the new ladder — somebody is wearing them:

> rookie · regular · quick-draw · contender · sharpshooter · bookworm ·
> giant-slayer · veteran · relentless · scholar · unshaken · prodigy · legend ·
> grandmaster · **titan · virtuoso · luminary · paragon · ascendant · immortal**

Two more are not level rewards and cannot be reached by playing long enough:
`untouchable` for the Black league, and `trailblazer`, granted the first time a
Legendary Chest is opened.

### 4.1 The curve was rescaled, not extended

On the old curve (`75 × (level−1)(level+2)`, ~95 XP per ranked win) level 100
would have cost **~7,700 wins — over two years**. Extending it would have put
half the titles out of reach of all but a fraction of a percent.

So the coefficient dropped **75 → 18**, and level 100 costs what level 50 used
to:

| | Before | Now |
|---|---|---|
| Level 25 | 455 wins | ~123 wins |
| Level 50 | 1,896 wins | ~483 wins |
| Level 100 | — | ~1,913 wins (~6 months) |

**Every existing player's level roughly doubles.** A level 25 becomes about 50.
That is safe by construction: `accountLevelFloor` already guarantees a level can
never fall (leagues-and-progression.md §9.4), so a curve edit can only ever give
people more. The migration stamps the floor under the OLD curve before writing
the new one anyway — relying on "the new curve is gentler" is relying on
arithmetic staying true after somebody retunes a coefficient.

### 4.2 What a level pays

| Level | Pays |
|---|---|
| Any level | 150 coins |
| Every 5th | 300 coins **+ that milestone's title + one random common** |

The random common is one the player does not already own; if they own all 70, it
pays **250 coins** instead — the midpoint of the common band, derived from the
band rather than typed, so retuning what a common costs retunes this too. Never
a dead level-up.

Two milestones crossed in one match draw two different commons: the pool is
spliced, not sampled twice.

So four levels in five pay money only. That is the deliberate shape of it: the
milestone has to be worth arriving at, and it cannot be if the four levels
before it each handed over a title and a cosmetic too.

Avatars and banners are no longer level-gated at all.

---

## 5. The monthly cycle

The reason to come back. On the **1st**, one job:

1. **Archive** the finished month's leaderboard.
2. **Soft-reset** every ranked rating halfway toward 1200.
3. **Roll two fresh chests** from the catalogue.
4. **Clear** last month's unopened chests.

The order matters. The archive goes first because the soft reset rewrites the
ratings the standings are read against. Clearing goes last, so a player whose
old chest is deleted already has this month's waiting.

### 5.1 It is checked hourly, not fired at midnight

The trigger is "the month is not the one the chests were rolled for", checked
every hour, and that condition stays true until the work is actually done. A job
that only exists at 00:05 on the 1st is a job a deploy window can delete. It
also means an install that was DOWN over the 1st runs the turnover the moment it
comes back rather than skipping the month.

The chests' own `period` field is the record of having run — written by the same
step that ends the cycle, so the two cannot disagree. There is no separate
"last ran" state anywhere.

Boot calls `ensureMonthlyChests()` too, so a fresh install serves this month's
pool rather than none at all.

### 5.2 Soft reset

`next = 1200 + (current − 1200) / 2`, floored at 800.

| Before | After |
|---|---|
| 1900 (Black) | 1550 |
| 1600 | 1400 |
| 1200 (start) | 1200 |
| 1000 | 1100 |

Halfway rather than all the way, because a Black player made to grind back from
1200 every month simply stops. Strong players re-reach chest 1 in a few wins and
chest 2 in a real month's climb; weak players are lifted off the floor rather
than pinned to it.

One aggregation-pipeline update, not a cursor: it touches every account in the
database, and a hundred thousand round trips on the 1st of the month is a
self-inflicted outage.

### 5.3 The two chests

Rolled fresh each month. **Twenty slots each: 8 coins and 12 cosmetics.**

| Chest | Slots | Unlocks on |
|---|---|---|
| **Chest** | 8 coins · 6 common · 4 uncommon · 2 rare | reaching **Gold** |
| **Legendary Chest** | 8 coins · 3 common · 3 uncommon · 4 rare · 2 legendary | reaching **Diamond** |

Free to open — reaching the league is the price.

Common is deliberately the minority of the cosmetic slots in both. A chest is
earned by climbing a league, so it should beat the shop: commons are what coins
buy in a day, and a chest that mostly handed them over would be a worse reward
than the rating that unlocked it.

Cosmetics are sampled **without replacement inside a tier**, so a single chest
never holds the same avatar twice — a box with two of one thing in it has
quietly lost a slot.

#### Why leagues rather than fixed ratings

The thresholds were originally 1600 and 2000. Against a monthly soft reset those
are far harder than they look: Elo is K=32, so at a 65% win rate a player nets
about +5 rating per match, which put chest 2 at ~90–160 matches in a single
month — top-of-ladder only, with most accounts opening nothing most months.

Gold and Diamond (1450 / 1675) land the same intent at reachable numbers, and
retuning a league floor later moves the chest with it instead of leaving two
orphan constants behind that silently mean something different.

#### The draw

Opening draws **one slot from the 20, uniformly**. The composition *is* the odds
— no separate weighting table that can drift out of step with the contents:

| | Chest | Legendary Chest |
|---|---|---|
| Coins | 40% | 40% |
| Common | 30% | 15% |
| Uncommon | 20% | 15% |
| Rare | 10% | 20% |
| Legendary | — | **10%** |

Legendary keeps **2 slots** rather than being scaled down with everything else.
It is the entire reason chest 2 exists; thinning it to one slot to preserve a
ratio would be preserving the wrong thing.

The contents are **published in full** — `GET /config/progression` sends every
slot's type, key, name and rarity, and the shop lays them out as a case you can
spin (§5.5).

The first cut withheld the keys, on the theory that knowing which legendary was
in the pool turned a reveal into a lookup. That was wrong about where the drama
is. A case you can look INTO is the whole appeal of a case: the suspense is
*which one*, never *what is in there*, and a chest described only as "two
legendary slots" is a chest nobody has a reason to want. Publishing the list
publishes the odds along with it, which was the other half of the argument for
showing anything at all.

The draw happens BEFORE the write and is stored on the grant in the same update
that claims it. That ordering is what makes it safe under a race — the losing
tap cannot re-roll, because the roll it would have to overwrite is already
committed.

#### Coins in the box

Coin slots carry **25, 50 or 100**, weighted so the legendary chest pays a
little better:

| | 25 | 50 | 100 | average |
|---|---|---|---|---|
| Chest | 4 slots | 3 | 1 | ~44 |
| Legendary Chest | 2 slots | 3 | 3 | ~63 |

These are deliberately modest — a fifth of a common at best. They exist so an
open is never worthless, not as an earning route. **If chests ever need to feel
more rewarding, these values are the dial**, and moving them changes nothing
else in the system.

### 5.4 The case

The chest is drawn as a carousel of its twenty slots, which the player turns.

It is a horizontally snapping list with every transform interpolated off the
scroll offset — `rotateY` behind a perspective, scale and opacity by distance
from the middle — so it reads as a wheel turning and nothing touches the JS
thread while a finger is down. A true circle would need each item's position to
be cos/sin of a shared angle, which RN's piecewise-linear `interpolate` can only
approximate with per-item arrays of a few hundred points; the thing a circle
actually buys here is depth, and depth comes from the perspective.

Every slot is drawn in the same square token, banners cropped into it. A
carousel of mixed widths cannot snap — the interval that centres one item leaves
the next one short.

**The case opens over the shop; it does not sit in front of it.** This took
three tries and the middle one is worth recording.

The first cut put each chest on the page as a full-width card — seal, name,
carousel, button — which at two chests was a screen and a half of window display
before the first price tag. A shop whose display case blocks the shelves.

The second went too far the other way: a rail of 56pt seals with a caption
under each. It fixed the height and lost the chest. Two small grey rounded
squares with padlocks in them read as *disabled controls*, and at that size the
name underneath was the only thing arguing otherwise.

So: **a square card each, two across.** Big enough to carry the chest and say
what it is and what it wants from you — gold ground and a dot when one is ready
to open, unlit when it is not — and still a fraction of the original height.
Pressing one opens the real case as a sheet. Nothing is lost: a locked chest
still says it exists, because the second-best thing a shop can do after selling
you something is show you what you are climbing toward.

**The chest is drawn, not a glyph.** It was the icon set's `gift`, which is a
wrapped present — a birthday, not a hoard — and that was half of why the small
version read as a disabled control: a 24px monochrome outline has no material.
It is composed from Views like everything else here (`Chest.jsx`), which is also
what makes the lid a separate layer, and therefore able to lift. Three states,
one object:

| State | |
|---|---|
| `locked` | unlit, and still |
| `ready` | gold, and it breathes — a 2° rock at 1.4s, and a glow that swells |
| `opening` | the lid swings back past its stop and settles; light comes out |

`ready` moves because it is the one state asking for something, and a static
gold box among static gold boxes is not asking. It stops dead under
`prefers-reduced-motion`.

**Opening is a spin, and a lid.** The chest's lid swings open while the wheel is
thrown across its slots — one gesture, two things moving — at the instant the
claim request goes out, and the reveal waits for both it and a floor of 1.1s.
Two reasons, and the second is the real one. A claim is one round trip, and the
honest version of waiting for it is a spinner on a button; spinning the case
turns the wait into the anticipation, which is what a case is for. And even on a
fast connection the reveal used to be instant — the Takeover landed before the
finger left the button, which is not a reveal at all. A slow response simply
lands after the floor, with the wheel still turning.

Avatars / Banners / Titles is pinned above the scroll rather than riding it. It
is the shop's own navigation, and navigation that scrolls away is navigation
people stop using.

**One bug worth remembering.** The carousel shipped completely frozen and
nothing in the layout suggested why: the shared `Sheet` wrapped its contents in
a `Pressable` so a tap on the sheet would not fall through to the dismissing
scrim. A `Pressable` claims the touch responder on touch *start*; a child
ScrollView only asks for it on *move*, by which point the ancestor already owns
the gesture. The scrim is an absolutely-positioned sibling now and the sheet is
a plain `View` — a tap on the sheet never reaches the scrim because it never
hits it, which needs no interception to arrange.

---

### 5.5 Duplicates pay coins

If the draw lands on a cosmetic already owned, it pays out instead of granting
nothing — roughly a quarter of that rarity's shop price:

| Duplicate | Pays |
|---|---|
| Common | 50 |
| Uncommon | 150 |
| Rare | 400 |
| Legendary | 800 |

Between this and the coin slots, **no open is ever dead.** That was the whole
worry: with a dud-on-duplicate rule, a player who owned most commons would have
opened an empty chest roughly four times in five by the third month.

The reveal says so plainly — "You already had it — paid 150 coins instead."
Quietly paying out and calling it a win is the sort of thing that gets noticed
once and distrusted for ever.

Ratings reset, so both chests are re-earned every month. That is the loop.

---

## 6. A new account

Two avatars and one banner, all common: **Rose**, **Sunflower**,
**Grape Dots**. Zero coins, level 1.

Two rather than six, so the first thing a player does in the shop is buy
something rather than discover they already own the shelf.

A girl-and-boy starter pair was asked for and is not possible yet — the art is
food, flowers, animals and archetypes, with no human faces. The starter set is
data, so it is a one-line change the day that art exists.

---

## 7. Existing players

Everything below runs once, at boot, recorded by name on the progression config
so a process killed halfway through a release does not repeat what already
landed. `backend/tests/migration.test.js` builds an old-world database and
checks each one.

| Migration | What it does |
|---|---|
| `purge-guest-fields` | `$unset` `isGuest` / `guestMatchesPlayed`; retires `role: 'guest'` accounts |
| `grandfather-level-unlocks` | writes every cosmetic a player owned UNDER THE OLD LADDER into `grantedPerks` |
| `cosmetics-to-rarity` | rewrites the catalogue rows onto rarity, price and `unlockKind: shop` |
| `retire-orphan-cosmetics` | disables rows whose art no longer ships and that carry no upload |
| `rescale-account-curve` | stamps `accountLevelFloor` under the old curve, then writes the 100-level one |
| `monthly-chests` | grants the contents of any unopened legacy chest, then deletes the three old ones |

Order matters as much as idempotency: grandfathering reads the catalogue and the
curve **as they stand**, so it has to run before either is rewritten. Run it the
other way round and every level-unlocked avatar would come back with a price on
it.

- Keep every cosmetic they already own. Nothing is taken back.
- Levels roughly double with the rescale (§4.1).
- Balance starts at **0**. No back-pay for matches already played.
- The demo account owns every wearable outright and starts with 250,000 coins,
  because after this a level unlocks nothing wearable — a demo account that has
  to shop first is a demo account with an empty wardrobe.

### 7.1 The bug worth writing down

The first `purge-guest-fields` was called `drop-guest-fields`, ran, reported
success, matched every row and **modified none**. Mongoose applies strict mode
to update paths, so `$unset: { isGuest }` against a schema that no longer
declares `isGuest` was silently discarded.

A migration that removes a field must always pass `{ strict: false }`, because
the field being gone from the schema is the entire premise of running it. It is
renamed rather than fixed in place so installs that recorded the broken name
still run the working one.

---

## 8. Guests, removed

The guest entry point was already gone — the welcome screen goes straight to
phone sign-in. The machinery behind it was not, and it was woven through the
exact places this work touches: the coin balance lands on `/me`, the awards land
in match finalise, and the guest match limit sat in `joinQueue` beside them.
Threading a currency around branches for a user type that can no longer be
created is how dead code becomes permanent.

**All of it came out, schema included.**

| Backend | Mobile |
|---|---|
| `POST /auth/guest` | `playAsGuest`, `auth.guest()` |
| `startGuestSession`, `migrateGuest` | `getDeviceId()` |
| `rejectGuests` middleware + its call sites | `signOutCopy(isGuest)` |
| `GUEST_MATCH_LIMIT` check in `joinQueue` | Upsell block on the home screen |
| `'guest'` role in the User enum | Upsell block on the profile screen |
| `isGuest`, `guestMatchesPlayed` fields | `isGuest` reads throughout |
| `guestUserId` on the OTP verify body | |

---

## 9. Where it lives

| Concern | File |
|---|---|
| Tiers, prices, coin awards, chest specs | `shared/constants.js` |
| Catalogue, price computation, ownership rules | `shared/perks.js` |
| `coinsForMatch`, `coinsForLevels`, the curve | `shared/mastery.js` |
| `promotionAward` | `shared/league.js` |
| Config, migrations, the shop, level rewards | `services/progressionService.js` |
| Rolling, awarding, opening, duplicates | `services/chestService.js` |
| Soft reset, archive, the turnover | `services/seasonService.js` |
| Balance, shelves, buy, claim | `routes/me.js` |
| The Shop (a bottom-nav tab) | `mobile/app/(tabs)/shop.jsx` |
| One tier, as a sliding shelf | `mobile/src/components/ShopShelf.jsx` |
| The chest, as a case you turn | `mobile/src/components/ChestCarousel.jsx` |
| The balance, in every header | `mobile/src/components/CoinBalance.jsx` |
| Tier tints and the coin formatter | `mobile/src/lib/rarity.js` |
| Level-up, coins and chest reveals | `mobile/src/components/Takeover.jsx` |
| Achievements, earned and not | `shared/achievements.js`, `mobile/app/achievements.jsx` |

Tests: `economy.test.js` (28), `migration.test.js` (7), `progression.test.js`
(21).

---

## 10. Decisions, and what was rejected

Recorded so they are not re-litigated.

| Decision | Rejected alternative | Why |
|---|---|---|
| Rarity replaces level-gating | Level **or** buy; keep levels and add a separate coin catalogue | Two systems owning the same item means every item needs both a level and a price, and the shop fills with things you would get free anyway |
| Ownership is written down | Keep deriving it from the level | A purchase cannot be recomputed from XP. `grantedPerks` went from a migration footnote to the record of what a player owns |
| Prices computed from the tier | A price typed on every row | A hand-written price is a number somebody has to keep in step with its band, and eventually will not |
| Soft reset | Hard reset to 1200; no reset at all | Hard reset makes strong players quit; no reset kills the monthly loop |
| Chests trigger on leagues | Fixed 1600 / 2000 | Against a monthly reset, 2000 was ~90–160 matches — most accounts would open nothing, most months |
| Hourly "is the month over" check | A cron at 00:05 on the 1st | A job that exists for one minute a month is a job a deploy window deletes |
| 8 coin slots inside the 20 | 40% coin chance beside an intact 20 | The box is twenty things. Keeping it literally twenty cost the 16/3/1 composition, which was rescaled to 12 |
| Duplicates pay coins | Grant nothing; re-roll from unowned | "Nothing" was the first call and was reversed once the cost was written down: ~4 dead opens in 5 by month three |
| Legendary keeps 2 slots | Scale it to 1 with everything else | It is the reason chest 2 exists; a preserved ratio is the wrong thing to preserve |
| Common is the minority of chest slots | Keep 16/3/1 | A chest is earned by climbing a league, so it has to beat what a day of coins already buys |
| Publish the whole chest | Hide the keys; hide everything | Reversed. The suspense is which slot, not what the slots are — a case you cannot look into is a case nobody wants |
| A title every 5th level, 20 in total | One per level, 100 in total | A thing you receive a hundred times is a receipt, not a title |
| Rescale the curve | Extend it as-is | Level 100 has to be reachable or half the titles are decoration |
| The Shop is a bottom-nav tab | A page hanging off the profile | It is the only screen with something to spend on. A currency a player cannot find a use for may as well not exist. Five tabs is the ceiling, so the next thing that wants a slot has to take one |
| Four sliding shelves, one per tier | A grid of everything | 150 avatars in rows of four is 38 rows — reaching legendary meant scrolling past 130 items, and the page never fit a screen in any state |
| Progression moved back to the profile | Keep the XP bar on the Shop | A stats page with prices on it reads as an inventory. The Shop answers "what can I get"; the profile answers "how am I doing" |
| Buying goes through a sheet | Buy on tap | A purchase is irreversible and there is no ledger to appeal to. Equipping stays a bare tap, and the asymmetry is the point |
| Coins staged only on a bonus | A takeover on every match | 50 for a win happens every match, and a celebration that fires every match is a step between the player and the rematch button |
| Two starters, not six | Six free flowers as before | The first thing a shop should prompt is a purchase, not a shrug |
| Concepts hand-authored, one function each | Recombine a parts vocabulary | The parts pass produced 34 animals that all read as the same bear at 44px |
| Food is the common floor | More animals and flowers | Twenty non-faces make the common shelf legibly different from the rare one |
| Legendaries wear a frame | Rely on the face alone | A player reads the frame before the face, so chest-only has to look chest-only on a shelf |
| Orphan art disabled, not deleted | Delete it; leave it | A level-gated orphan makes `nextUnlock` promise an avatar no client can draw. Disabling withdraws it without confiscating it from whoever wears it |

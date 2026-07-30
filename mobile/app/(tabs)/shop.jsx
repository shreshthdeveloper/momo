import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { api } from '../../src/lib/api.js';
import { useAuth } from '../../src/state/auth.jsx';
import {
  Text,
  Button,
  ErrorNotice,
  Segmented,
  Sheet,
  Skeleton,
  TabHeader,
} from '../../src/components/ui.jsx';
import Icon from '../../src/components/Icon.jsx';
import CoinBalance from '../../src/components/CoinBalance.jsx';
import ChestCarousel from '../../src/components/ChestCarousel.jsx';
import Chest from '../../src/components/Chest.jsx';
import { StreakFlame, StreakSheet } from '../../src/components/StreakFlame.jsx';
import ShopShelf from '../../src/components/ShopShelf.jsx';
import Takeover, { eventFromChest } from '../../src/components/Takeover.jsx';
import { faceName, faceSource, faceUri } from '../../src/lib/avatar.js';
import { bannerName, bannerSource, bannerUri } from '../../src/lib/banner.js';
import { useProgression } from '../../src/state/progression.jsx';
import { coins as fmtCoins, rarityTone, RARITY_ORDER } from '../../src/lib/rarity.js';
import { colors, fonts, layout, space } from '../../src/theme/index.js';

/**
 * The Shop (coins-and-cosmetics.md §3.2).
 *
 * A tab rather than a page hanging off the profile, because it is the only
 * screen in the app with something to spend on and a player has to be able to
 * find it without being told. It is also the reason to care about the coins a
 * match just paid, which is worth one of the five slots in the dock.
 *
 * ── It has to look like a shop ───────────────────────────────────────────────
 *
 * The version this replaces was the progression screen with prices bolted on:
 * an XP bar at the top, a league card, then grids. That is a stats page, and a
 * stats page with prices on it reads as an inventory. Three changes make it a
 * store instead:
 *
 *   1. **A window, not a barricade.** The chests are two square cards across
 *      the top — the one thing here you cannot buy — and pressing one opens the
 *      real case over the shop. They used to be full-width cards with their
 *      twenty-slot carousels inline, which put a screen and a half of display
 *      case in front of the first price tag.
 *   2. **Shelves, not grids.** Four sliding rows, one per tier, so the whole
 *      catalogue is on one screen and the tiers are the structure.
 *   3. **Price tags.** Gold, on the art, on every item you do not own. Nothing
 *      else in the app carries a price, and a grid of art with prices on it is
 *      the difference between a wardrobe and a shop.
 *
 * Avatars / Banners / Titles is pinned above the scroll rather than riding it.
 * It is this screen's own navigation, and navigation that scrolls away is
 * navigation people stop using.
 *
 * The level bar and the league card went back to the profile, where the rest of
 * "how am I doing" already lives. This screen answers "what can I get".
 */
/** How long the case turns for, at minimum, before the reveal. */
const SPIN_MS = 1100;

export default function Shop() {
  const { user, updateProfile, refreshProfile } = useAuth();
  const { config } = useProgression();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  /**
   * What the last purchase actually cost, confirmed after the fact. The buy
   * sheet states a price and the balance then changes by it; without a line
   * saying so, a player who is charged has to work out for themselves whether
   * the number they were shown is the number that left their balance.
   */
  const [spent, setSpent] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('avatar');

  /**
   * The optimistic layer for equipping. A key present here wins over the saved
   * profile until the request settles, and dropping it is the rollback: what
   * shows underneath is whatever the server actually holds.
   */
  const [override, setOverride] = useState({});
  const seq = useRef({});

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await api.get('/me/rewards'));
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const equip = useCallback(
    async (field, value, patch) => {
      const id = (seq.current[field] = (seq.current[field] ?? 0) + 1);
      setNotice(null);
      setOverride((o) => ({ ...o, [field]: value }));
      try {
        await updateProfile(patch);
        if (field === 'title' && seq.current[field] === id) {
          setData((d) => (d ? { ...d, title: value } : d));
        }
      } catch (err) {
        if (seq.current[field] === id) setNotice(err);
      } finally {
        if (seq.current[field] === id) {
          setOverride((o) => {
            const next = { ...o };
            delete next[field];
            return next;
          });
        }
      }
    },
    [updateProfile],
  );

  const balance = data?.coins ?? user?.coins ?? 0;
  const rarities = data?.rarities;

  const wornTitle =
    'title' in override
      ? override.title
      : user && 'title' in user
        ? user.title
        : (data?.title ?? null);
  const wornAvatar = override.avatar ?? faceName(user?.avatarUrl);
  const wornBanner = override.banner ?? bannerName(user?.banner);

  const avatars = useMemo(
    () => imageShelf('avatar', data?.shelves?.avatars, config, (k) => Boolean(faceSource(k))),
    [data, config],
  );
  const banners = useMemo(
    // `bannerSource`, not the bundled map: an uploaded banner is drawable too,
    // and filtering on the bundle alone dropped every one of them off the shelf.
    () => imageShelf('banner', data?.shelves?.banners, config, (k) => Boolean(bannerSource(k))),
    [data, config],
  );
  const titles = useMemo(() => titleShelf(data?.shelves?.titles, wornTitle), [data, wornTitle]);

  // ── Chests ────────────────────────────────────────────────────────────────
  const [opening, setOpening] = useState(null);
  const [busyChest, setBusyChest] = useState(null);
  /** The chest whose case is open. `null` is the shelves, undisturbed. */
  const [viewing, setViewing] = useState(null);
  const chests = useMemo(() => data?.chests ?? [], [data]);
  const unopened = useMemo(() => chests.filter((c) => !c.claimedAt), [chests]);
  /**
   * What the window shows when nothing is waiting: the next one to aim at.
   *
   * A chest ALREADY EARNED this period is never a teaser, opened or not. Only
   * unopened grants were excluded before, so the moment a claim succeeded the
   * chest reappeared as a locked card — seconds after the reveal, reading as
   * "it failed" or "it re-locked" rather than "that one is done".
   */
  const earnedKeys = useMemo(
    () => new Set(chests.map((c) => c.key)),
    [chests],
  );
  const teaser = useMemo(
    () => (config.chests ?? []).filter((c) => !earnedKeys.has(c.key)),
    [config, earnedKeys],
  );
  /**
   * Ready first, then locked. The eye starts at the left, so a chest that can
   * actually be opened is never the second card.
   */
  const chestCards = useMemo(
    () => [
      ...unopened.map((c) => ({ ...c, ready: true })),
      ...teaser.map((c) => ({ ...c, locked: true })),
    ],
    [unopened, teaser],
  );

  /**
   * Opening a chest.
   *
   * The wheel is thrown at the same instant the request goes out, and the
   * reveal waits for both. Two reasons, and the second is the real one:
   *
   *   1. A claim is one round trip, and on a bad connection the honest version
   *      of this is a spinner on a button. Spinning the case turns the wait
   *      into the anticipation, which is what a case is for.
   *   2. Even on a fast connection the reveal was instant, and an instant
   *      reveal is not a reveal — the Takeover landed before the finger left
   *      the button.
   *
   * `SPIN_MS` is a floor, not a delay: a slow response simply lands after it,
   * and the wheel is still turning when it does.
   */
  const openChest = useCallback(
    async (chest) => {
      if (busyChest) return;
      setBusyChest(chest.key);
      setNotice(null);
      try {
        const [result] = await Promise.all([
          api.post(`/me/chests/${chest.key}/claim`),
          new Promise((done) => setTimeout(done, SPIN_MS)),
        ]);
        await Promise.all([load(), refreshProfile?.()]);
        setViewing(null);
        setOpening(result);
      } catch (err) {
        // The sheet closes on failure too. Leaving it open would hide the
        // notice that says what went wrong behind the thing that caused it.
        setViewing(null);
        setNotice(err);
      } finally {
        setBusyChest(null);
      }
    },
    [busyChest, load, refreshProfile],
  );

  // ── Buying ────────────────────────────────────────────────────────────────
  const [offer, setOffer] = useState(null);
  const [buying, setBuying] = useState(false);

  const buy = useCallback(async () => {
    if (!offer || buying) return;
    setBuying(true);
    setNotice(null);
    setSpent(null);
    try {
      /**
       * The price this shelf is showing travels with the tap. Prices are
       * editable and a shelf can be minutes old, so the server compares the two
       * and refuses rather than quietly charging a number the player never saw.
       */
      const result = await api.post('/me/shop/buy', {
        type: offer.type,
        key: offer.key,
        expectedPrice: offer.price ?? null,
      });
      setOffer(null);
      await Promise.all([load(), refreshProfile?.()]);
      if (Number.isFinite(result?.spent)) {
        setSpent({ name: offer.name ?? result?.item?.name ?? 'That', coins: result.spent });
      }
    } catch (err) {
      setOffer(null);
      setNotice(err);
    } finally {
      setBuying(false);
    }
  }, [offer, buying, load, refreshProfile]);

  /**
   * The freeze, bought from its own sheet.
   *
   * The sheet closes only on success. A failure leaves it open with the notice
   * showing above it, because the one thing a player needs after a refused
   * purchase is the price and the button, still there — closing the sheet would
   * make them find their way back to it to try again.
   */
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [freezing, setFreezing] = useState(false);
  const [freezeError, setFreezeError] = useState(null);
  const buyFreeze = useCallback(async () => {
    if (freezing) return;
    setFreezing(true);
    setFreezeError(null);
    setSpent(null);
    try {
      const result = await api.post('/me/streak-freeze', {});
      // Both: `/me/rewards` holds the balance this screen draws, and the profile
      // holds the streak the flame draws. Reloading one leaves the other stale.
      await Promise.all([load(), refreshProfile?.()]);
      setFreezeOpen(false);
      setSpent({ name: 'A streak freeze', coins: result?.spent ?? 0 });
    } catch (err) {
      setFreezeError(err);
    } finally {
      setFreezing(false);
    }
  }, [freezing, load, refreshProfile]);

  /**
   * One tap, three meanings, decided by what the tile is. Owned equips on the
   * spot; for sale opens the sheet; chest-only explains itself, because a tile
   * that does nothing when tapped is a tile a player assumes is broken.
   */
  const onPick = useCallback(
    (item) => {
      if (item.owned) {
        if (item.type === 'avatar') equip('avatar', item.key, { avatarUrl: faceUri(item.key) });
        else equip('banner', item.key, { banner: bannerUri(item.key) });
        return;
      }
      setOffer({ ...item, affordable: (item.price ?? 0) <= balance });
    },
    [equip, balance],
  );

  const shelf = tab === 'avatar' ? avatars : banners;
  /** How many are sitting there unopened — the mark on the Chests tab. */
  const readyCount = unopened.length;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* The header carries the two account-level facts and nothing else: what
          you can spend, and what you are holding. Both are true no matter which
          shelf is showing, which is precisely what earns a place up here — and
          why the freeze belongs beside the balance rather than in the scroll. */}
      <TabHeader
        title="Shop"
        caption="Win coins. Spend them here."
        right={
          <View style={styles.headerRight}>
            {/* The same flame as Home's top bar, opening the same sheet. The
                Shop is where coins are spent, so it keeps a door to the one
                thing on this screen that is not a look. */}
            <StreakFlame
              streak={user?.streak}
              onPress={() => {
                setFreezeError(null);
                setFreezeOpen(true);
              }}
            />
            <CoinBalance value={balance} onPress={null} />
          </View>
        }
      />

      <ErrorNotice error={error} onRetry={load} />
      <ErrorNotice error={notice} />
      {spent ? (
        <Text variant="meta" color={colors.inkMuted} style={styles.spentNote}>
          {spent.name} is yours — {fmtCoins(spent.coins)} coins spent.
        </Text>
      ) : null}

      {!data && !error ? (
        <ShopSkeleton />
      ) : (
        <>
          {/**
           * Four panes, and the chests are one of them.
           *
           * The chests used to live ABOVE this control, permanently, which meant
           * every visit to the shop opened on a block of things you cannot buy
           * before a single price tag came into view — and it was the block that
           * kept getting the layout wrong, because it was the one part of the
           * screen with no structure holding it.
           *
           * As a pane it inherits the structure the catalogue already has, and
           * the shelves start at the top of the screen where a shop's shelves
           * belong. The gold dot is what stops that being a loss: a chest ready
           * to open is marked on the tab whichever pane you are looking at.
           *
           * Pinned, not scrolled: this is the shop's own navigation, and
           * navigation that scrolls away is navigation people stop using.
           */}
          <Segmented
            style={styles.tabs}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'avatar', label: 'Avatars' },
              { value: 'banner', label: 'Banners' },
              { value: 'title', label: 'Titles' },
              { value: 'chest', label: 'Chests', dot: readyCount > 0 },
            ]}
          />

          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                tintColor={colors.accent}
                onRefresh={async () => {
                  setRefreshing(true);
                  await load();
                  setRefreshing(false);
                }}
              />
            }
          >
            {tab === 'chest' ? (
              <ChestPane chests={chestCards} ready={readyCount} onPick={setViewing} />
            ) : tab === 'title' ? (
              <View style={styles.titles}>
                <Text variant="meta" color={colors.inkFaint} style={styles.titleNote}>
                  Titles are not for sale. One arrives every fifth account level.
                </Text>
                <TitleRow
                  first
                  name="No title"
                  hint="Just your name."
                  owned
                  worn={!wornTitle}
                  onPress={() => equip('title', null, { title: null })}
                />
                {titles.map((item) => (
                  <TitleRow
                    key={item.key}
                    name={item.name}
                    requirement={item.requirement}
                    owned={item.owned}
                    worn={wornTitle === item.key}
                    onPress={() => equip('title', item.key, { title: item.key })}
                  />
                ))}
              </View>
            ) : (
              RARITY_ORDER.map((rarity) => (
                <ShopShelf
                  key={`${tab}:${rarity}`}
                  kind={tab}
                  rarity={rarity}
                  tone={rarityTone(rarity, rarities)}
                  items={shelf.filter((c) => c.rarity === rarity)}
                  worn={tab === 'avatar' ? wornAvatar : wornBanner}
                  onPick={onPick}
                />
              ))
            )}
          </ScrollView>
        </>
      )}

      <ChestCase
        chest={viewing}
        rarities={rarities}
        busy={busyChest === viewing?.key}
        spinning={busyChest === viewing?.key}
        onOpen={() => openChest(viewing)}
        onClose={() => setViewing(null)}
      />

      <StreakSheet
        visible={freezeOpen}
        streak={user?.streak}
        balance={balance}
        busy={freezing}
        /** A refusal has to be readable WHERE it happened. The screen's own
         *  notice sits behind the modal, so a failed buy would have looked like
         *  a button that simply did nothing. */
        error={freezeError}
        onBuy={buyFreeze}
        onClose={() => {
          setFreezeError(null);
          setFreezeOpen(false);
        }}
      />

      <BuySheet
        offer={offer}
        balance={balance}
        rarities={rarities}
        loading={buying}
        onBuy={buy}
        onClose={() => setOffer(null)}
      />

      {opening ? (
        <Takeover
          events={eventFromChest(opening, { rarities })}
          onDone={() => setOpening(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

/**
 * The chests pane, two cards across.
 *
 * ── The shapes this has been ─────────────────────────────────────────────────
 *
 * Full-width cards stacked, each carrying its own twenty-slot carousel — a
 * screen and a half of window display before the first thing you can buy. Then
 * a rail of 56pt seals, which solved the height and lost the chest: two grey
 * rounded squares with padlocks read as disabled controls, not as treasure.
 * Then cards two across, which was right except that a third chest stretched to
 * the full width on its own row. Then a horizontal scroller, which fixed the
 * stretching by hiding it — the third chest was permanently half off the right
 * edge — and needed a stated height, which is what cut the cards top and bottom
 * the moment the content did not fit inside the number.
 *
 * Every one of those was the same underlying problem: this block had no place of
 * its own, so it kept being reshaped to fit above a control it had no relation
 * to. It has a pane now. The grid inside it is the plain one — `flexGrow: 0` so
 * the odd one out keeps its size instead of filling the row, and no stated
 * height at all, so there is no number for the content to outgrow.
 *
 * ── It says what it is for ───────────────────────────────────────────────────
 *
 * A pane can be arrived at deliberately, which the old block could not, so it
 * can afford the sentence the block never had room for: these are the free ones,
 * and this is what makes them open.
 */
function ChestPane({ chests, ready, onPick }) {
  if (!chests.length) return null;

  return (
    <View>
      <Text variant="meta" color={colors.inkFaint} style={styles.chestNote}>
        {ready > 0
          ? `${ready === 1 ? 'One chest is' : `${ready} chests are`} ready to open. Chests are never bought — they arrive for climbing.`
          : 'Chests are never bought. They arrive for climbing, and open free.'}
      </Text>

      <View style={styles.chests}>
      {chests.map((chest) => (
        <Pressable
          key={`${chest.key}:${chest.period ?? 'locked'}`}
          onPress={() => onPick(chest)}
          accessibilityRole="button"
          accessibilityLabel={
            chest.ready
              ? `${chest.name}, ready to open`
              : `${chest.name}, locked. See what is inside.`
          }
          style={({ pressed }) => [
            styles.chestCard,
            chest.ready ? styles.chestCardReady : styles.chestCardLocked,
            pressed && { opacity: 0.75 },
          ]}
        >
          <View style={styles.seal}>
            <Chest size={52} state={chest.ready ? 'ready' : 'locked'} />
            {/* The one unread-style mark in the app, and it earns it: this is
                a thing waiting to be collected, not a notification. */}
            {chest.ready ? <View style={styles.sealDot} /> : null}
          </View>

          <Text
            variant="label"
            color={chest.ready ? colors.ink : colors.inkMuted}
            numberOfLines={1}
            style={styles.chestName}
          >
            {chest.name}
          </Text>
          <Text
            variant="tiny"
            color={chest.ready ? colors.gold : colors.inkFaint}
            numberOfLines={1}
            style={styles.chestName}
          >
            {chest.ready ? 'Ready to open' : (chest.triggerLabel ?? 'Locked')}
          </Text>
        </Pressable>
        ))}
      </View>
    </View>
  );
}

/**
 * One chest, opened over the shop.
 *
 * The carousel is the whole point — twenty slots, one draw, and a player who
 * can look into the case before opening it. Showing the odds as a row of dots
 * was accurate and made nobody want the box.
 *
 * It was also, until the `Sheet` rewrite, completely frozen: the sheet wrapped
 * its contents in a `Pressable`, which takes the touch responder on touch start
 * and never gives it to a child ScrollView on move. See the note on `Sheet`.
 *
 * `spinning` is the open. The wheel is thrown across its slots and left to
 * settle while the claim is in flight, so the wait for the server is the
 * anticipation rather than a stalled button — and the Takeover lands on the
 * real result the moment both are done.
 */
function ChestCase({ chest, rarities, busy, spinning, onOpen, onClose }) {
  if (!chest) return null;
  const slots = chest.slots ?? chest.rewards ?? [];
  const legendary = slots.filter((s) => s.rarity === 'legendary').length;
  const locked = Boolean(chest.locked);

  return (
    <Sheet
      visible
      onClose={busy ? undefined : onClose}
      title={chest.name}
      accessibilityLabel={`${chest.name}, one of ${slots.length} rewards`}
    >
      {/* The box itself, above its own contents. It is what the player pressed
          to get here, and on `Open it` the lid swings back while the wheel
          spins underneath — one gesture, two things moving, no dead beat while
          the claim is in flight. */}
      <View style={styles.caseChest}>
        <Chest size={78} state={spinning ? 'opening' : locked ? 'locked' : 'ready'} />
      </View>

      <Text variant="meta" color={colors.inkFaint} style={styles.caseLine}>
        {locked
          ? chest.description
          : `${chest.triggerLabel} · one of ${slots.length}${legendary ? ` · ${legendary} legendary` : ''}`}
      </Text>

      <ChestCarousel
        slots={slots}
        rarities={rarities}
        spinning={spinning}
        style={styles.caseReel}
      />

      {locked ? (
        <Text variant="meta" color={colors.inkFaint} style={styles.caseFoot}>
          {/* What THIS chest asks for. The line used to tell every locked case
              to go and reach a league — including the rating-triggered ones,
              and now the event chests, which ask for nothing at all. */}
          {chest?.triggerKind === 'event'
            ? 'A gift for everyone. It will be waiting here.'
            : chest?.recurrence === 'monthly'
              ? `Re-rolled on the 1st. ${chest?.triggerLabel ?? 'Climb'} and it is yours to open, free.`
              : `${chest?.triggerLabel ?? 'Climb'} and it is yours to open, free.`}
        </Text>
      ) : (
        <Button
          label={busy ? 'Opening…' : 'Open it'}
          loading={busy}
          onPress={onOpen}
        />
      )}
    </Sheet>
  );
}

/**
 * The purchase sheet.
 *
 * A buy is irreversible and there is no transaction history to appeal to, so it
 * shows the three things needed to decide once: what you get, what it costs,
 * and what you have left afterwards. The last is the one usually missing, and
 * the only one that answers "can I still afford the thing I actually wanted".
 */
function BuySheet({ offer, balance, rarities, loading, onBuy, onClose }) {
  if (!offer) return null;
  const tone = rarityTone(offer.rarity, rarities);
  const forSale = offer.unlockKind === 'shop' && offer.price != null;
  const after = balance - (offer.price ?? 0);

  return (
    <Sheet
      visible
      onClose={loading ? undefined : onClose}
      title={offer.name}
      accessibilityLabel={`${offer.name}, ${tone.name}`}
    >
      <View style={styles.offer}>
        <View
          style={[
            offer.type === 'banner' ? styles.offerBanner : styles.offerFace,
            { borderColor: tone.edge, borderWidth: tone.ring * 2, backgroundColor: tone.soft },
          ]}
        >
          {offer.type === 'avatar' && faceSource(offer.key) ? (
            <Image source={faceSource(offer.key)} style={styles.fill} contentFit="cover" />
          ) : bannerSource(offer.key) ? (
            <Image source={bannerSource(offer.key)} style={styles.fill} contentFit="cover" />
          ) : null}
        </View>

        <View style={[styles.tierPill, { borderColor: tone.edge, backgroundColor: tone.soft }]}>
          <View style={[styles.tierDot, { backgroundColor: tone.ink }]} />
          <Text allowFontScaling={false} style={[styles.tierName, { color: tone.ink }]}>
            {tone.name.toUpperCase()}
          </Text>
        </View>
      </View>

      {forSale ? (
        <>
          <View style={styles.ledger}>
            <LedgerRow label="Price" value={`${fmtCoins(offer.price)} coins`} />
            <LedgerRow label="You have" value={fmtCoins(balance)} muted />
            <LedgerRow
              label="After"
              value={fmtCoins(Math.max(0, after))}
              tone={after < 0 ? colors.wrong : colors.ink}
            />
          </View>

          {offer.affordable ? (
            <Button label={`Buy for ${fmtCoins(offer.price)}`} loading={loading} onPress={onBuy} />
          ) : (
            <>
              <Text variant="meta" color={colors.inkMuted} style={styles.offerNote}>
                {fmtCoins((offer.price ?? 0) - balance)} short. A ranked match pays 50, and a level
                pays 150.
              </Text>
              <Button label="Not enough coins" disabled onPress={() => {}} />
            </>
          )}
        </>
      ) : (
        <>
          <Text variant="body" color={colors.inkMuted} style={styles.offerNote}>
            Legendary. Coins cannot buy this one at any price — it only comes out of the Legendary
            Chest, which opens when you reach Diamond.
          </Text>
          <Button variant="soft" label="Got it" onPress={onClose} />
        </>
      )}
    </Sheet>
  );
}

function LedgerRow({ label, value, muted, tone }) {
  return (
    <View style={styles.ledgerRow}>
      <Text variant="meta" color={colors.inkMuted}>
        {label}
      </Text>
      <Text
        allowFontScaling={false}
        style={[styles.ledgerValue, { color: tone ?? (muted ? colors.inkMuted : colors.ink) }]}
      >
        {value}
      </Text>
    </View>
  );
}

function TitleRow({ name, hint, requirement, owned, worn, first, onPress }) {
  return (
    <Pressable
      onPress={owned ? onPress : undefined}
      disabled={!owned}
      accessibilityRole="radio"
      accessibilityState={{ selected: Boolean(worn), disabled: !owned }}
      accessibilityLabel={
        owned ? `${name}${worn ? ', worn' : ''}` : `${name}, locked — ${requirement ?? 'not yet earned'}`
      }
      style={({ pressed }) => [
        styles.row,
        !first && styles.rowDivided,
        worn && styles.rowOn,
        pressed && owned && styles.rowPressed,
      ]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="label" color={owned ? colors.ink : colors.inkFaint} numberOfLines={1}>
          {name}
        </Text>
        {hint ? (
          <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
            {hint}
          </Text>
        ) : null}
      </View>
      {!owned ? (
        <View style={styles.chip}>
          <Text variant="tiny" color={colors.inkMuted}>
            {requirement ?? 'Locked'}
          </Text>
        </View>
      ) : null}
      {owned && worn ? (
        <View style={styles.tick}>
          <Icon name="check" size={12} color={colors.onAccent} />
        </View>
      ) : null}
    </Pressable>
  );
}

/** `grape-dots` → `Grape dots`, for anything the catalogue does not name. */
function prettify(key) {
  const words = String(key ?? '').split('-');
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

/**
 * The server's shelf, restricted to what this build can actually draw.
 *
 * The shelf is the authority on what is OWNED; the config catalogue is the
 * authority on what EXISTS. A row can arrive that this build has no art for —
 * an operator added it after release — and it is dropped rather than rendered
 * as a hole.
 */
function imageShelf(type, sent, config, canDraw) {
  const byKey = new Map((sent ?? []).map((item) => [item.key, item]));
  return (config.cosmetics ?? [])
    .filter((c) => c.type === type && canDraw(c.key))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((row) => {
      const item = byKey.get(row.key);
      return {
        ...row,
        ...item,
        name: item?.name ?? row.name ?? prettify(row.key),
        owned: item?.owned ?? false,
        requirement: item?.requirement ?? requirementOf(row),
      };
    });
}

function titleShelf(sent, worn) {
  const list = (sent ?? []).map((item) => ({ ...item, name: item.name ?? prettify(item.key) }));
  if (worn && !list.some((item) => item.key === worn)) {
    list.push({ key: worn, type: 'title', name: prettify(worn), owned: true });
  }
  return list;
}

function requirementOf(row) {
  if (row?.unlockKind === 'shop') {
    return row.price != null ? `${fmtCoins(row.price)} coins` : 'In the shop';
  }
  if (row?.unlockKind === 'level') return `Level ${row.unlockLevel}`;
  if (row?.unlockKind === 'league') {
    return `${String(row.unlockLeague ?? '').replace(/^./, (c) => c.toUpperCase())} league`;
  }
  if (row?.unlockKind === 'chest') return 'From a chest';
  return null;
}

/** The wait, in the shape of the answer: the rail, the tabs, and two shelves. */
function ShopSkeleton() {
  return (
    <View style={styles.content}>
      {/* The tabs land first now that the chests are behind one of them, so
          the wait is the shape of the pane that actually opens. */}
      <Skeleton
        height={48}
        radius={layout.radiusPill}
        style={{ marginHorizontal: layout.gutter }}
      />
      {[0, 1].map((i) => (
        <View key={i} style={{ marginTop: space.xl }}>
          <Skeleton width={130} height={13} radius={7} />
          <View style={styles.skeletonRow}>
            {[0, 1, 2, 3, 4].map((j) => (
              <Skeleton key={j} width={74} height={74} radius={37} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  /** The shelves bleed to the screen edge, so gutters live on their children. */
  content: { paddingTop: space.md, paddingBottom: layout.dockClearance },

  // ── The header ───────────────────────────────────────────────────────────
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // ── The chests ───────────────────────────────────────────────────────────
  /**
   * A plain wrapping grid. No scroller, and no stated height.
   *
   * The rail was a mistake twice over. A horizontal `ScrollView` has no
   * intrinsic height, so it had to be told one — and a container with a fixed
   * height around content that grows with the system font scale is a clipping
   * bug waiting for the first person who has ever touched their font settings.
   * It also hid whatever did not fit off the right edge, which on three chests
   * meant the third one was permanently half-visible.
   *
   * A grid has neither problem. Nothing is off-screen, and nothing is cut.
   */
  chestNote: {
    paddingHorizontal: layout.gutter,
    paddingTop: space.lg,
    paddingBottom: space.md,
  },
  chests: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: layout.cardGap,
    paddingHorizontal: layout.gutter,
  },
  /**
   * `flexGrow: 0` is the whole fix for the odd one out.
   *
   * The original grid had `flexGrow: 1`, so a third chest landed alone on the
   * second row and stretched to the full width — the same shelf drawing two
   * different objects. Growing is what caused that; a basis that does not grow
   * leaves the third card the same size as the first two, sitting under them.
   *
   * `minHeight` rather than `height`: the card is sized by what is in it, and a
   * row of them matches because a wrapping row stretches its children to the
   * tallest. That is the property that makes clipping impossible rather than
   * merely unlikely — there is no number here for the content to outgrow.
   */
  chestCard: {
    flexBasis: '48%',
    flexGrow: 0,
    minHeight: 132,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.lg,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
  },
  chestName: { textAlign: 'center' },
  chestCardReady: {
    backgroundColor: colors.goldSoft,
    borderColor: 'rgba(245, 182, 46, 0.38)',
  },
  /** Not yet earned: the same object, unlit. */
  chestCardLocked: { backgroundColor: colors.sunken, borderColor: colors.hairline },
  /** The chest draws its own material, so this only reserves room for it. */
  seal: { alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  sealDot: {
    position: 'absolute',
    top: -2,
    right: 0,
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: colors.gold,
    borderWidth: 2,
    borderColor: colors.goldSoft,
  },

  // ── The case, open ───────────────────────────────────────────────────────
  caseChest: { alignItems: 'center', paddingBottom: space.md },
  caseLine: { textAlign: 'center', paddingBottom: space.md },
  /** Negative margin so the reel runs edge to edge inside the sheet. */
  caseReel: { marginHorizontal: -layout.gutter, marginBottom: space.lg },
  caseFoot: { textAlign: 'center', paddingBottom: space.sm },

  tabs: { marginTop: space.md, marginBottom: space.xs, marginHorizontal: layout.gutter },

  // ── Titles ───────────────────────────────────────────────────────────────
  titles: {
    marginTop: space.lg,
    marginHorizontal: layout.gutter,
    backgroundColor: colors.sunken,
    borderRadius: layout.radiusCard,
    overflow: 'hidden',
  },
  titleNote: { padding: space.lg, paddingBottom: space.sm },
  spentNote: { paddingHorizontal: layout.gutter, paddingBottom: space.sm, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.hairline },
  rowOn: { backgroundColor: colors.accentSoft },
  rowPressed: { backgroundColor: colors.hairline },
  chip: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: layout.radiusPill,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── The buy sheet ────────────────────────────────────────────────────────
  offer: { alignItems: 'center', gap: space.md, marginBottom: space.lg },
  offerFace: {
    width: 108,
    height: 108,
    borderRadius: 54,
    overflow: 'hidden',
  },
  offerBanner: {
    width: 224,
    height: 98,
    borderRadius: layout.radiusInput,
    overflow: 'hidden',
  },
  fill: { width: '100%', height: '100%' },
  tierPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 5,
    borderRadius: layout.radiusPill,
    borderWidth: 1,
  },
  tierDot: { width: 8, height: 8, borderRadius: 4 },
  tierName: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.8,
    includeFontPadding: false,
  },
  ledger: {
    backgroundColor: colors.sunken,
    borderRadius: layout.radiusInput,
    paddingHorizontal: space.lg,
    marginBottom: space.lg,
  },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  ledgerValue: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 21,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  offerNote: { textAlign: 'center', marginBottom: space.lg },

  skeletonRow: { flexDirection: 'row', gap: space.md, marginTop: space.md },
});

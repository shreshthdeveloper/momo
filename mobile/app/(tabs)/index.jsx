import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '../../src/lib/api.js';
import { useAuth } from '../../src/state/auth.jsx';
import { useGame } from '../../src/state/game.jsx';
import { useProgression } from '../../src/state/progression.jsx';
import { useNotifications } from '../../src/state/notifications.jsx';
import {
  Text,
  ErrorNotice,
  Avatar,
  Button,
  ProgressBar,
  SectionHeader,
} from '../../src/components/ui.jsx';
import { HomeFeedSkeleton } from '../../src/components/Skeletons.jsx';
import Icon from '../../src/components/Icon.jsx';
import CoinBalance from '../../src/components/CoinBalance.jsx';
import TopicCard from '../../src/components/TopicCard.jsx';
import TopicPlaySheet from '../../src/components/TopicPlaySheet.jsx';
import TopicMedallion, { withAlpha, resolveTopicFace } from '../../src/components/TopicMedallion.jsx';
import { resolveBanner } from '../../src/lib/banner.js';
import { LeagueBadge } from '../../src/components/League.jsx';
import SpaceHome from '../../src/components/SpaceHome.jsx';
import { leagueFor } from '../../src/lib/league.js';
import { streakState } from '../../src/lib/streak.js';
import { colors, elevation, layout, space, type } from '../../src/theme/index.js';
import { PUBLIC_SPACE_ID } from '../../src/shared/constants.js';
import { ACHIEVEMENTS } from '../../src/shared/achievements.js';
import { accountProgress } from '../../src/shared/mastery.js';

/** The two of them, mid-match. See the note on `PlayCard`. */
const DUO_PLAY = require('../../assets/art/duo-play.webp');

/**
 * design.md §8.2 — home, and §8.12 — space home.
 *
 * ── Home is a dashboard, not a catalogue ─────────────────────────────────────
 *
 * It used to flatten the whole feed into one grid of covers — "Pick your
 * battlefield" — and the Play sheet listed the same topics from the same
 * request. Two screens, one dataset, and a tile that opened a topic here and
 * started a match there.
 *
 * The catalogue moved to the Play tab, which is now the only place in the app
 * that lists topics. What is left here is the four things a dashboard is for:
 *
 *   1. Who you are and where you stand   — header and level card
 *   2. One button that starts a match    — the Arena card
 *   3. Whether today is still intact     — the streak card
 *   4. Two things worth chasing          — rankings and achievements
 *   5. What you were in the middle of    — up to three you have actually played
 *
 * Nothing on this screen is a way to browse. Row 5 is history, capped at three,
 * and absent for a player with none.
 *
 * ── Everything above row 5 is unconditional ──────────────────────────────────
 *
 * The first cut of this screen drew a thin standing strip, one card, and hid
 * the streak at zero and the history when empty. On a new account that left a
 * header, a button, and eight hundred points of nothing — a screen that reads
 * as broken rather than as new.
 *
 * The rule now is that rows 1 to 4 always draw, because every one of them has
 * something true to say on a fresh account: you are level 1, this is the topic
 * to start on, you have no streak YET, and here are two ladders you have not
 * climbed. An empty dashboard is a design failure, not an honest one.
 *
 * ── The header lost two icons ────────────────────────────────────────────────
 *
 * Search went with the catalogue: it lives at the top of the Play tab, on the
 * list it searches. The gear went because Settings was already reachable from
 * the profile band, and a second door to it here bought nothing but a sixth
 * control in a corner that also has to hold the space switcher.
 *
 * What is left is avatar and world on the left, balance on the right — the
 * shape the Shop and the profile also use.
 */
export default function Home() {
  const router = useRouter();
  const { user, spaces, activeSpaceId, setActiveSpaceId, refreshProfile } = useAuth();
  const game = useGame();
  const { config } = useProgression();
  const earned = user?.achievements?.length ?? 0;
  const [feed, setFeed] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  /**
   * The badge is live now — the provider keeps it, the socket moves it, and
   * this screen only reads it. It used to be fetched here alongside the feed,
   * so the bell only ever changed when Home itself was reloaded: the count was
   * as stale as the last time the player happened to visit.
   */
  const { unread } = useNotifications();
  /** The topic whose card is open — see `TopicPlaySheet`. */
  const [chosen, setChosen] = useState(null);

  const inSpace = activeSpaceId && activeSpaceId !== PUBLIC_SPACE_ID;

  const load = useCallback(async () => {
    try {
      setError(null);
      // Two different endpoints, one screen. The space home carries the
      // assignments, contests and personal progress the Arena has no concept
      // of. The unread count is no longer fetched here — it belongs to the
      // notifications provider, which keeps it current from the socket.
      const data = inSpace
        ? await api.get(`/spaces/${activeSpaceId}/home`)
        : await api.get('/home', { spaceId: activeSpaceId });
      setFeed(data);
    } catch (err) {
      setError(err);
    }
  }, [activeSpaceId, inSpace]);

  useEffect(() => {
    setFeed(null);
    load();
  }, [load]);

  // The connection is opened on entering home rather than at launch, so a
  // player who never plays never holds a socket.
  //
  // The feed is refetched here too, WITHOUT clearing it first: the effect above
  // owns the space switch and blanks the screen for it, but coming back from a
  // match is not a switch, and blanking a feed that is about to be replaced by
  // an almost identical one reads as a stutter. Refetching on focus is what
  // makes a match's XP, rating and streak show up on the home header without a
  // manual pull.
  const connect = game.connect;
  useFocusEffect(
    useCallback(() => {
      connect();
      load();
      refreshProfile?.().catch(() => {});
    }, [connect, load, refreshProfile]),
  );

  /**
   * The topics this player has actually played, most recent first. The server
   * already sorts `jump_back_in` by recency, so [0] is the last match's topic —
   * which is what the Arena card offers, and what the row below it continues.
   */
  const recent = useMemo(() => {
    const rows = feed?.rows ?? [];
    return (rows.find((r) => r.key === 'jump_back_in')?.topics ?? []).slice(0, 3);
  }, [feed]);

  /**
   * What the one button plays. Your last topic if you have one; otherwise the
   * first thing the server put in front of you, which is the featured or most
   * played topic in this world.
   *
   * There is no topic-less "quick match": the matchmaking pool is keyed on
   * (space, topic), so a match is always about something. Choosing here rather
   * than making the player choose is the whole point of the card.
   */
  const target = useMemo(() => {
    if (recent[0]) return recent[0];
    const rows = feed?.rows ?? [];
    return rows.flatMap((r) => r.topics ?? [])[0] ?? null;
  }, [feed, recent]);

  /**
   * The slides behind the Arena card, one per reason.
   *
   * The card used to be a single poster showing one topic — whatever you played
   * last — which is the right default and a poor way to spend the largest object
   * on the screen. A player who did not want that one topic had a link to a
   * catalogue and nothing in between.
   *
   * So it takes the FIRST topic from each shelf the server sent, and wears that
   * shelf's own title as its eyebrow: Jump back in, For you, Trending, Friends
   * are playing. Every slide is therefore there for a different reason and can
   * say what the reason is — which is the whole argument for a carousel over a
   * row of four identical tiles. The order is the server's, so "jump back in"
   * stays first when it exists and a new account opens on "start here".
   */
  const heroes = useMemo(() => {
    const rows = feed?.rows ?? [];
    const seen = new Set();
    const out = [];

    for (const row of rows) {
      if (out.length >= 4) break;
      const topic = (row.topics ?? []).find((t) => t?.id && !seen.has(t.id));
      if (!topic) continue;
      seen.add(topic.id);
      out.push({ topic, eyebrow: (row.title ?? 'Arena').toUpperCase() });
    }

    // A world with one shelf would otherwise produce a one-slide carousel,
    // which is a poster with a dot under it. Fill from what is left.
    if (out.length < 3) {
      for (const topic of rows.flatMap((r) => r.topics ?? [])) {
        if (out.length >= 3) break;
        if (!topic?.id || seen.has(topic.id)) continue;
        seen.add(topic.id);
        out.push({ topic, eyebrow: 'ARENA' });
      }
    }
    return out;
  }, [feed]);

  /**
   * Straight into a match, at the stake already chosen. The Arena card and the
   * space home both use this — their whole argument is one tap and no decision,
   * so neither of them stops to ask.
   */
  const play = useCallback(
    (topic, mode) => {
      if (!topic) return;
      router.push({
        pathname: '/match/searching',
        params: {
          topicId: topic.id,
          spaceId: topic.spaceId ?? activeSpaceId,
          coverUrl: topic.coverUrl ?? '',
          name: topic.name,
          ...(mode ? { mode } : null),
        },
      });
    },
    [router, activeSpaceId],
  );

  /**
   * The card behind a topic row, shared with the Play tab so a topic tile means
   * the same thing in both places. The rows below used to push the topic page —
   * which is now the link at the foot of the card rather than the only door.
   */
  const selectMode = game.selectMode;
  const playChosen = useCallback(
    (mode) => {
      const topic = chosen;
      if (!topic) return;
      setChosen(null);
      selectMode(mode);
      play(topic, mode);
    },
    [chosen, selectMode, play],
  );

  const openChosenDetails = useCallback(() => {
    const topic = chosen;
    if (!topic) return;
    setChosen(null);
    router.push(`/topic/${topic.id}`);
  }, [chosen, router]);

  const spaceName = feed?.space?.name ?? (inSpace ? '' : 'Public Arena');
  const firstName = (user?.displayName ?? 'there').split(' ')[0];

  const header = (
    <>
      {/* Who and where on the left, what you have on the right. */}
      <View style={styles.header}>
        {/* The face was a 44pt object at the top-left of the app's first screen
            that did nothing at all — the one place every product on the phone
            puts a door to your own profile. It is a button now. */}
        <Pressable
          onPress={() => router.push('/profile')}
          accessibilityRole="button"
          accessibilityLabel="Your profile"
          hitSlop={6}
          style={({ pressed }) => (pressed ? { opacity: 0.75 } : null)}
        >
          <Avatar url={user?.avatarUrl} name={user?.displayName} size={44} />
        </Pressable>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="meta" color={colors.inkFaint}>
            Hey, {firstName}
          </Text>
          {/* The switcher opens unconditionally. It used to require an existing
              membership, which meant the one row that JOINS an organization was
              unreachable for exactly the people who had none — and Home is the
              only place that row appears. */}
          <Pressable
            onPress={() => setSwitcherOpen((v) => !v)}
            style={({ pressed }) => [styles.spaceButton, pressed && { opacity: 0.7 }]}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ expanded: switcherOpen }}
            accessibilityLabel={`Current world: ${spaceName}. Tap to switch.`}
          >
            {feed?.space?.logoUrl ? (
              <Image source={{ uri: feed.space.logoUrl }} style={styles.spaceLogo} contentFit="cover" />
            ) : null}
            <Text variant="label" numberOfLines={1} style={{ maxWidth: 170 }}>
              {spaceName}
            </Text>
            <Icon name="chevronDown" size={13} color={colors.inkMuted} />
          </Pressable>
        </View>

        <BellButton unread={unread} onPress={() => router.push('/notifications')} />
        <CoinBalance />
      </View>

      {/* Directly under the name, because it describes the player. */}
      <LevelCard user={user} curve={config.accountCurve} />

      {/* prd.md F6.2.5 — the switcher itself */}
      {switcherOpen ? (
        <View style={styles.switcher}>
          <SwitcherRow
            label="Public Arena"
            active={activeSpaceId === PUBLIC_SPACE_ID}
            onPress={() => {
              setActiveSpaceId(PUBLIC_SPACE_ID);
              setSwitcherOpen(false);
            }}
          />
          {spaces
            .filter((s) => !s.isPublic && s.status === 'active')
            .map((s) => (
              <SwitcherRow
                key={s.id}
                label={s.name}
                accent={s.accentColor}
                active={activeSpaceId === s.id}
                onPress={() => {
                  setActiveSpaceId(s.id);
                  setSwitcherOpen(false);
                }}
              />
            ))}
          <SwitcherRow
            label="Join an organization"
            icon="plus"
            onPress={() => {
              setSwitcherOpen(false);
              router.push('/join');
            }}
          />
        </View>
      ) : null}
    </>
  );

  // The feed arrives into its own shape rather than replacing a spinner, so
  // nothing on the screen moves when it lands.
  if (!feed && !error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        {header}
        <ScrollView scrollEnabled={false} showsVerticalScrollIndicator={false}>
          <HomeFeedSkeleton />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Inside an organization (design.md §8.12) ─────────────────────────────
  if (inSpace && feed) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ErrorNotice error={error} onRetry={load} />
        <SpaceHome feed={feed} onPlay={play} header={header} />
      </SafeAreaView>
    );
  }

  // ── The Public Arena (design.md §8.2) ────────────────────────────────────
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {header}
      <ErrorNotice error={error} onRetry={load} />

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
        <HeroCarousel
          heroes={heroes}
          fallback={target}
          onPlay={play}
          onBrowse={() => router.push('/play')}
        />

        <StreakCard streak={user?.streak} />

        {/* Two ladders, side by side. Neither is ever empty: on a fresh
            account they read "Unranked" and "0 of 7", which is a starting line
            rather than a blank. */}
        <View style={styles.doors}>
          <DoorTile
            icon="trophy"
            tint={colors.gold}
            label="Rankings"
            value={rankLine(user)}
            onPress={() => router.push('/leaderboard')}
          />
          <DoorTile
            icon="medal"
            tint={colors.accent}
            label="Achievements"
            value={`${earned} of ${ACHIEVEMENTS.length}`}
            onPress={() => router.push('/achievements')}
          />
        </View>

        {recent.length > 0 ? (
          <>
            <SectionHeader
              title="Jump back in"
              action="All topics"
              onAction={() => router.push('/play')}
              style={styles.rowHead}
            />
            {/**
              * Three at most, and only topics with a match behind them. It is
              * history, not discovery — the moment it grows past a row it
              * becomes the catalogue again, which is the thing that moved out.
              *
              * Rows, not cover tiles. Three tiles across looked deliberate and
              * one tile across looked like two had failed to load, and one is
              * the common case: most players have a topic, not a shelf of them.
              * A list reads the same at any length, and it has room for the
              * level — which is the actual reason to come back to a topic.
              */}
            <View style={styles.recent}>
              {recent.map((topic) => (
                <TopicCard
                  key={topic.id}
                  variant="row"
                  topic={topic}
                  onPress={() => setChosen(topic)}
                />
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      <TopicPlaySheet
        visible={chosen !== null}
        topic={chosen}
        rankedRating={user?.rankedRating}
        onPlay={playChosen}
        onDetails={openChosenDetails}
        onClose={() => setChosen(null)}
      />
    </SafeAreaView>
  );
}

/**
 * The inbox, as a header control.
 *
 * The count is capped at "9+" rather than growing — a badge is a signal that
 * there is something waiting, and past a handful the exact number changes
 * nothing about what you do next while a three-digit one starts pushing the
 * balance beside it around.
 *
 * The dot is not the only carrier: the count is in the accessibility label, so
 * a screen reader gets "Notifications, 3 unread" rather than "Notifications".
 */
function BellButton({ unread, onPress }) {
  const has = unread > 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={has ? `Notifications, ${unread} unread` : 'Notifications'}
      hitSlop={6}
      style={({ pressed }) => [styles.bell, pressed && { backgroundColor: colors.hairline }]}
    >
      <Icon name="bell" size={19} color={has ? colors.ink : colors.inkMuted} />
      {has ? (
        <View style={styles.badge}>
          <Text allowFontScaling={false} style={styles.badgeText}>
            {unread > 9 ? '9+' : unread}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The Arena card, as a deck you can flick through.
 *
 * One card per shelf, each naming its own reason — see `heroes` above. It is
 * NOT auto-advancing: a banner that moves on its own takes the card out from
 * under a thumb already reaching for it, and design.md §7 spends the motion
 * budget inside the match rather than on the dashboard. It moves when a finger
 * moves it.
 *
 * `snapToInterval` rather than `pagingEnabled`, because the cards are inset by
 * the gutter and paging snaps to whole screen widths — which would leave every
 * card after the first sitting a gutter's width off centre.
 */
function HeroCarousel({ heroes, fallback, onPlay, onBrowse }) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);

  const cardWidth = width - layout.gutter * 2;
  const stride = cardWidth + layout.cardGap;

  const onMomentumEnd = useCallback(
    (e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / stride)),
    [stride],
  );

  const renderCard = useCallback(
    ({ item }) => (
      <PlayCard
        topic={item.topic}
        eyebrow={item.eyebrow}
        width={cardWidth}
        onPlay={() => onPlay(item.topic)}
        onBrowse={onBrowse}
      />
    ),
    [cardWidth, onPlay, onBrowse],
  );

  // Nothing to deal: one card, which knows how to say "browse" when it has no
  // topic either. It keeps the poster's own margins, so it needs no wrapper.
  if (heroes.length === 0) {
    return <PlayCard topic={fallback} onPlay={() => onPlay(fallback)} onBrowse={onBrowse} />;
  }

  return (
    <View style={styles.deck}>
      <FlatList
        data={heroes}
        keyExtractor={(h) => h.topic.id}
        renderItem={renderCard}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={stride}
        decelerationRate="fast"
        onMomentumScrollEnd={onMomentumEnd}
        contentContainerStyle={styles.deckContent}
        getItemLayout={(_, i) => ({ length: stride, offset: stride * i, index: i })}
      />

      {/* Where you are in the deck. Drawn only when there is more than one, so
          a single card is never given a lone dot to explain it. */}
      {heroes.length > 1 ? (
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {heroes.map((h, i) => (
            <View key={h.topic.id} style={[styles.dot, i === index && styles.dotOn]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The front door — a poster, and the one thing this screen is for.
 *
 * It names the topic rather than saying "Play now". A match is always about
 * something (the queue is keyed on a topic), and a card that just said "Play
 * now" had to send the player to a list to answer a question the app already
 * knew the answer to: whatever you played last. Naming it turns two taps and a
 * decision into one tap and no decision, and the small print under the button
 * is there for the day the answer is wrong.
 *
 * ── Every card wears its own topic ───────────────────────────────────────────
 *
 * The first version of the deck drew the SAME shipped illustration on all four
 * slides. That was defensible while there was one card — design.md §12.2 allows
 * exactly one illustration on one screen, for the one object trying to make
 * somebody do something — but four identical pictures is the opposite of a
 * deck: it makes flicking through them feel like nothing is happening, and the
 * only thing distinguishing the cards is a line of type.
 *
 * So the backdrop is the TOPIC's, in this order:
 *
 *   1. its cover image, if an operator uploaded one
 *   2. otherwise a preset banner picked from the topic's name — the same
 *      abstract patterns players wear, resolved by the same seed-from-a-string
 *      trick, so a topic gets the same backdrop on every launch and two topics
 *      almost never collide
 *
 * A pattern is the right fallback rather than a flat colour: a flat panel of
 * hue on a dark field reads as an error state, and these are already drawn to
 * sit under type.
 *
 * The medallion rides on top so the SUBJECT is identifiable at a glance, which
 * a pattern alone cannot do.
 *
 * ── The button is a full-width foot, not a floating chip ─────────────────────
 *
 * It used to hug its label and sit in a body squeezed to 54% of the card by a
 * `paddingRight` reserving room for the artwork. That left the primary action
 * as a small tab adrift in the middle-left of a large card, with a different
 * amount of space around it on every screen width. It is the widest thing on
 * the card now, at the foot, with the browse link centred underneath — the
 * shape a call to action has everywhere else in this app.
 */
function PlayCard({ topic, eyebrow = 'ARENA', width, onPlay, onBrowse }) {
  const face = topic ? resolveTopicFace(topic.coverUrl, topic.name) : null;
  // A real cover if there is one; a preset pattern seeded from the name if not.
  // `resolveBanner(null, seed)` is the same stable-from-a-string pick the
  // profile uses, so a topic keeps its backdrop between launches.
  const backdrop =
    face?.kind === 'image' ? { uri: face.uri } : topic ? resolveBanner(null, topic.name) : null;

  return (
    <View
      style={[
        styles.poster,
        width ? { width, marginHorizontal: 0, marginBottom: 0 } : null,
        elevation.raised,
      ]}
    >
      {backdrop ? (
        <Image source={backdrop} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} />
      ) : (
        /* No topic at all — the shipped illustration keeps the one card that
           has nothing of its own to wear from being an empty rectangle. */
        <Image
          source={DUO_PLAY}
          style={styles.posterArt}
          contentFit="contain"
          contentPosition="top right"
          pointerEvents="none"
        />
      )}

      {/**
        * Night, bottom-heavy. The copy sits on the lower two thirds, so the
        * scrim is opaque there and lets the pattern through at the top.
        *
        * The clear stop is the card's own colour at zero alpha, never the
        * keyword `transparent` — Android interpolates that through black and
        * leaves a dirty band across the middle of the card.
        */}
      <LinearGradient
        colors={['rgba(23, 20, 34, 0.25)', 'rgba(23, 20, 34, 0.86)', 'rgba(23, 20, 34, 0.97)']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={styles.posterBody}>
        <View style={styles.posterHead}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.eyebrowRow}>
              <View style={styles.eyebrowRule} />
              {/* The shelf this card came off, in its own words. */}
              <Text variant="tiny" color={colors.accent} style={styles.eyebrow} numberOfLines={1}>
                {eyebrow}
              </Text>
            </View>

            <Text variant="display" color={colors.onColor} numberOfLines={2} style={styles.posterTitle}>
              {topic?.name ?? 'Find a rival now'}
            </Text>

            <Text variant="meta" color="rgba(255,255,255,0.78)" numberOfLines={1}>
              {topic
                ? [
                    topic.viewer ? `Level ${topic.viewer.level}` : null,
                    topic.categoryName,
                    'Seven questions',
                  ]
                    .filter(Boolean)
                    .join('  ·  ')
                : 'Seven questions. Ten seconds each.'}
            </Text>
          </View>

          {/* The subject, so a pattern is never the only thing identifying the
              card. Circular, the same emblem the topic wears in every list. */}
          {topic ? (
            <TopicMedallion coverUrl={topic.coverUrl} name={topic.name} size={54} />
          ) : null}
        </View>

        <Button
          label={topic ? 'Play now' : 'Browse topics'}
          iconRight="arrowRight"
          onPress={topic ? onPlay : onBrowse}
          style={styles.posterButton}
        />

        {topic ? (
          <Pressable
            onPress={onBrowse}
            hitSlop={10}
            accessibilityRole="button"
            style={({ pressed }) => [styles.posterAlt, pressed && { opacity: 0.6 }]}
          >
            <Text variant="tiny" color="rgba(255,255,255,0.6)">
              Choose a different topic
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Today, in one card.
 *
 * A streak is the only number in the app that can go DOWN by doing nothing,
 * which is what earns it a place on a dashboard.
 *
 * It used to hide itself at zero, reasoning that "0 day streak" is a scold on a
 * new account. The instinct was right and the conclusion was wrong: the fix for
 * a scold is different words, not a missing card. At zero it now says *Start a
 * streak* and what one match today would begin — which is an invitation, and
 * happens to be the single most useful sentence on a brand-new Home.
 *
 * Three states, one shape. Gold and asking on the day the run has not been fed;
 * quiet with a tick once it has; quiet and inviting when there is no run.
 */
function StreakCard({ streak }) {
  const { current, longest, playedToday, atRisk, showsBest } = streakState(streak);
  const none = current === 0;
  const lit = atRisk || none;

  const title = none ? 'Start a streak' : `${current} day${current === 1 ? '' : 's'} in a row`;
  const body = none
    ? 'One match today, and again tomorrow.'
    : playedToday
      ? showsBest
        ? `Today is safe. Your best is ${longest}.`
        : 'Today is safe.'
      : 'Play one match today to keep it.';

  return (
    <View style={[styles.streak, atRisk && styles.streakAtRisk]}>
      <View style={[styles.streakGlyph, lit && styles.streakGlyphLit]}>
        <Icon name="bolt" size={18} color={lit ? colors.gold : colors.inkMuted} />
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" color={atRisk ? colors.gold : colors.ink}>
          {title}
        </Text>
        <Text variant="meta" color={colors.inkFaint}>
          {body}
        </Text>
      </View>

      {playedToday && !none ? (
        <View style={styles.streakDone}>
          <Icon name="check" size={13} color={colors.correct} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Where the player stands, as a card rather than a line.
 *
 * It was a hairline strip — badge, level, the word Rankings, a chevron — on the
 * argument that this is identity rather than an instrument panel. That reads
 * beautifully under a screen with something below it, and this screen turned
 * out not to have one on a new account: a 34pt strip over eight hundred points
 * of empty is not restraint, it is an unfinished page.
 *
 * So the same three facts, plus the one that was missing. **XP to the next
 * level** is the number that moves after every single match, which makes it the
 * one worth a bar — the league only moves on a ranked result, and the level
 * only moves when the bar fills.
 *
 * ── One card, one target ─────────────────────────────────────────────────────
 *
 * The badge used to be a nested Pressable with its own chevron, opening the
 * leaderboard while the card around it opened the profile. Two destinations in
 * one card, and the chevron sat there implying the badge was the card's action
 * when the card had a different one.
 *
 * The badge is data now. The whole card goes to the profile, and rankings has
 * its own tile eight points below — a door that says where it goes, in a place
 * where nothing else is competing to be pressed.
 */
function LevelCard({ user, curve }) {
  const router = useRouter();
  const level = user?.accountLevel ?? 1;
  const rating = user?.rankedRating;
  /**
   * The server's own answer, when it sent one.
   *
   * Recomputing it here against a cached curve is how Home and the profile
   * came to disagree about the same account after a curve edit — the config in
   * hand can be a version behind, and the level bar is not something two
   * screens may have different opinions about. The local computation stays
   * only as the fallback for a payload from an older server.
   */
  const progress = user?.accountProgress ?? accountProgress(user?.totalXp ?? 0, curve, level);
  const capped = progress.xpForNextLevel === 0;

  return (
    <Pressable
      onPress={() => router.push('/profile')}
      accessibilityRole="button"
      accessibilityLabel={`Level ${level}. ${
        capped ? 'Maximum level.' : `${progress.xpIntoLevel} of ${progress.xpForNextLevel} XP.`
      }${Number.isFinite(rating) ? ` ${leagueFor(rating).label}.` : ''} Opens your profile.`}
      style={({ pressed }) => [styles.level, pressed && { opacity: 0.8 }]}
    >
      <View style={styles.levelHead}>
        <Text variant="label">Level {level}</Text>
        <View style={{ flex: 1 }} />
        {Number.isFinite(rating) ? <LeagueBadge rating={rating} size="sm" /> : null}
      </View>

      <ProgressBar
        value={progress.xpIntoLevel}
        max={progress.xpForNextLevel || 1}
        height={6}
      />

      <Text variant="tiny" color={colors.inkFaint}>
        {capped
          ? 'Maximum level reached.'
          : `${progress.xpForNextLevel - progress.xpIntoLevel} XP to level ${level + 1}`}
      </Text>
    </Pressable>
  );
}

/**
 * One of the two ladders under the streak — a half-width tile with a number on
 * it. They are tiles rather than list rows because side by side they fill a
 * band the old screen left blank, and because neither is a place you go often
 * enough to earn a full row of its own.
 *
 * ── The number is the tile ───────────────────────────────────────────────────
 *
 * It used to be `label` at 14pt over `tiny` at 11 — two lines of near-identical
 * type in a tile whose entire job is to report ONE figure, so the eye had to
 * read both to find out which was the answer. The figure takes the display face
 * at 22 now and the word under it stays quiet, which is the same hierarchy the
 * stat cards on the profile already use. The glyph gets a well so the two tiles
 * have an anchor at the top rather than a floating 15pt mark.
 */
function DoorTile({ icon, tint, label, value, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${value}.`}
      style={({ pressed }) => [styles.door, pressed && { opacity: 0.75 }]}
    >
      <View style={styles.doorTop}>
        <View style={[styles.doorGlyph, { backgroundColor: withAlpha(tint, 0.15) }]}>
          <Icon name={icon} size={15} color={tint} />
        </View>
        <View style={{ flex: 1 }} />
        <Icon name="chevronRight" size={13} color={colors.inkFaint} />
      </View>
      {/* `adjustsFontSizeToFit` so a four-digit rating still fits a half-width
          tile instead of ellipsing the thing the tile exists to show. */}
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={styles.doorValue}
      >
        {value}
      </Text>
      <Text variant="tiny" color={colors.inkFaint} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The rankings tile's number. A player with no ranked match has no rating and
 * no rank, and "—" would be a shrug; naming the league they will start in is
 * both true and something to move away from.
 */
function rankLine(user) {
  const rating = user?.rankedRating;
  return Number.isFinite(rating) ? String(Math.round(rating)) : 'Unranked';
}

function SwitcherRow({ label, accent, active, icon, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.switcherRow, pressed && { backgroundColor: colors.sunken }]}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(active) }}
    >
      {icon ? (
        <Icon name={icon} size={16} color={colors.accent} />
      ) : (
        <View style={[styles.switcherDot, { backgroundColor: accent ?? colors.accent, opacity: active ? 1 : 0.35 }]} />
      )}
      <Text variant="bodyStrong" color={active ? colors.ink : colors.inkMuted} style={{ flex: 1 }}>
        {label}
      </Text>
      {active ? <Icon name="check" size={15} color={colors.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.gutter,
    paddingVertical: space.md,
  },
  spaceButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 26 },
  spaceLogo: { width: 18, height: 18, borderRadius: 5, overflow: 'hidden' },

  /** 40 square plus 6 of slop — 52 of target, past both platform minimums. */
  bell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sunken,
  },
  /**
   * Sits half off the glyph's corner so it reads as attached to the bell rather
   * than as a second object beside it. The canvas-coloured ring is what keeps
   * it legible when it overlaps the well behind.
   */
  badge: {
    position: 'absolute',
    top: 1,
    right: 1,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rival,
    borderWidth: 2,
    borderColor: colors.canvas,
  },
  badgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 10, lineHeight: 13, color: colors.onColor },
  switcher: {
    marginHorizontal: layout.gutter,
    backgroundColor: colors.canvas,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: space.sm,
    marginBottom: space.md,
    ...elevation.raised,
  },
  switcherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: layout.radiusInput,
  },
  switcherDot: { width: 10, height: 10, borderRadius: 5 },
  content: { paddingBottom: layout.dockClearance },

  // ── The deck ─────────────────────────────────────────────────────────────
  deck: { marginBottom: space.lg },
  deckContent: { paddingHorizontal: layout.gutter, gap: layout.cardGap },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: space.md },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.hairline },
  dotOn: { backgroundColor: colors.accent, width: 18 },

  // ── The poster ───────────────────────────────────────────────────────────
  poster: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    marginHorizontal: layout.gutter,
    marginBottom: space.lg,
    overflow: 'hidden',
  },
  /**
   * Only the topic-less fallback card now — see `PlayCard`.
   *
   * Top-right, not bottom-right. It used to sit on the card's floor beside a
   * copy column inset to 54%, and both of those are gone: the copy is
   * bottom-anchored across the full width and the button is the widest thing
   * on the card, so anything on the floor is underneath the primary action.
   * The upper band is the part of the card the content no longer uses.
   */
  posterArt: { position: 'absolute', right: -8, top: 0, width: '46%', height: '58%' },
  /**
   * The full width, with a minimum height so a short topic name and a long one
   * produce the same card — a deck whose slides are different heights jumps as
   * you flick through it.
   */
  posterBody: { padding: space.lg, gap: space.sm, minHeight: 196, justifyContent: 'flex-end' },
  /** Copy on the left, the subject emblem on the right. */
  posterHead: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, flex: 1 },
  posterTitle: { marginTop: space.sm, marginBottom: 2 },
  /** The widest thing on the card, at its foot. */
  posterButton: { marginTop: space.md },
  posterAlt: { marginTop: space.sm, minHeight: 30, alignItems: 'center', justifyContent: 'center' },

  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: 2 },
  /** The one stroke of accent at the head of the card — a rule, not a fill. */
  eyebrowRule: { width: 3, height: 12, borderRadius: 2, backgroundColor: colors.accent },
  eyebrow: { letterSpacing: 1.4 },

  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 64,
    paddingHorizontal: layout.cardPadding,
    paddingVertical: space.md,
    marginHorizontal: layout.gutter,
    marginBottom: space.xl,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.sunken,
  },
  /** Gold only on the day it is asking for something. */
  streakAtRisk: { borderColor: 'rgba(245, 182, 46, 0.4)', backgroundColor: colors.goldSoft },
  streakGlyph: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
  },
  streakGlyphLit: { backgroundColor: 'rgba(245, 182, 46, 0.16)' },
  streakDone: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.correctSoft,
  },

  /** Standing, as a card: level, the bar that moves every match, the badge. */
  level: {
    gap: space.sm,
    marginHorizontal: layout.gutter,
    marginBottom: space.lg,
    paddingHorizontal: layout.cardPadding,
    paddingVertical: space.md,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.sunken,
  },
  levelHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },

  doors: {
    flexDirection: 'row',
    gap: layout.cardGap,
    paddingHorizontal: layout.gutter,
    paddingBottom: space.xl,
  },
  door: {
    flex: 1,
    gap: 2,
    minHeight: 96,
    justifyContent: 'center',
    paddingHorizontal: layout.cardPadding,
    paddingVertical: space.md,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.sunken,
  },
  doorTop: { flexDirection: 'row', alignItems: 'center', marginBottom: space.sm },
  doorGlyph: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  /** The one figure the tile is for — the profile's stat face, at tile size. */
  doorValue: { ...type.timer, color: colors.ink },

  rowHead: { paddingHorizontal: layout.gutter },
  recent: { paddingHorizontal: layout.gutter, paddingBottom: space.lg },
});

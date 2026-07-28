import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '../../src/lib/api.js';
import { useAuth } from '../../src/state/auth.jsx';
import { useGame } from '../../src/state/game.jsx';
import { useProgression } from '../../src/state/progression.jsx';
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
import { LeagueBadge } from '../../src/components/League.jsx';
import SpaceHome from '../../src/components/SpaceHome.jsx';
import { leagueFor } from '../../src/lib/league.js';
import { streakState } from '../../src/lib/streak.js';
import { colors, elevation, layout, space } from '../../src/theme/index.js';
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
  const { user, spaces, activeSpaceId, setActiveSpaceId } = useAuth();
  const game = useGame();
  const { config } = useProgression();
  const earned = user?.achievements?.length ?? 0;
  const [feed, setFeed] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const inSpace = activeSpaceId && activeSpaceId !== PUBLIC_SPACE_ID;

  const load = useCallback(async () => {
    try {
      setError(null);
      // Two different endpoints, one screen. The space home carries the
      // assignments, contests and personal progress the Arena has no concept of.
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
  const connect = game.connect;
  useFocusEffect(
    useCallback(() => {
      connect();
    }, [connect]),
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

  const play = useCallback(
    (topic) => {
      if (!topic) return;
      router.push({
        pathname: '/match/searching',
        params: {
          topicId: topic.id,
          spaceId: topic.spaceId ?? activeSpaceId,
          coverUrl: topic.coverUrl ?? '',
          name: topic.name,
        },
      });
    },
    [router, activeSpaceId],
  );

  const spaceName = feed?.space?.name ?? (inSpace ? '' : 'Public Arena');
  const firstName = (user?.displayName ?? 'there').split(' ')[0];

  const header = (
    <>
      {/* Who and where on the left, what you have on the right. Two controls,
          not five. */}
      <View style={styles.header}>
        <Avatar url={user?.avatarUrl} name={user?.displayName} size={44} />

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
        <PlayCard topic={target} onPlay={() => play(target)} onBrowse={() => router.push('/play')} />

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
                  onPress={() => router.push(`/topic/${topic.id}`)}
                />
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * The front door — a poster, and the one thing this screen is for.
 *
 * It names the topic rather than saying "Play now". A match is always about
 * something (the queue is keyed on a topic), and the version that said "Play
 * now" had to send the player to a list to answer a question the app already
 * knew the answer to: whatever you played last. Naming it turns two taps and a
 * decision into one tap and no decision, and the small print under the button
 * is there for the day the answer is wrong.
 *
 * ── Why it earns artwork when nothing else here does ─────────────────────────
 *
 * design.md §12.2 argues against shipped illustration, and every argument still
 * holds for the places it was written about — the onboarding scenes are the
 * app's own components at size, which is better than a drawing of people being
 * happy near a product.
 *
 * This is the exception, for one reason: it is the only object on the screen
 * that is trying to make someone do something. Everything around it reports
 * (level, streak, rank, history) and reporting is what flat night is good at.
 * A card that has to be *wanted* needs a face on it, and two kids playing
 * against each other is exactly what the button does.
 *
 * The art is a cut-out on transparency, laid on the card's own night with a
 * gradient carrying it back to nothing before the copy starts — so the card is
 * still the app's surface with a picture on it, not a picture with type over
 * it. One illustration, one screen. The moment there are two, this argument is
 * gone.
 */
function PlayCard({ topic, onPlay, onBrowse }) {
  return (
    <View style={[styles.poster, elevation.raised]}>
      {/* Bottom-anchored and clipped by the card: the crop puts the two of them
          in the lower right, sitting on the card's floor rather than floating
          in the middle of it. */}
      <Image
        source={DUO_PLAY}
        style={styles.posterArt}
        contentFit="contain"
        contentPosition="bottom right"
        pointerEvents="none"
      />
      {/* Night → nothing, left to right. The copy needs a flat ground and the
          art needs an edge that is not a line.
          The clear stop is the card's own colour at zero alpha, never the
          keyword `transparent` — Android interpolates that through black and
          leaves a dirty band across the middle of the card. */}
      <LinearGradient
        colors={[colors.nightRaised, 'rgba(39, 34, 54, 0.94)', 'rgba(39, 34, 54, 0)']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        locations={[0, 0.42, 0.86]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={styles.posterBody}>
        <View style={styles.eyebrowRow}>
          <View style={styles.eyebrowRule} />
          <Text variant="tiny" color={colors.accent} style={styles.eyebrow}>
            ARENA
          </Text>
        </View>

        {/* No forced line break — the body's width does the wrapping, so the
            card survives Dynamic Type instead of tearing at a hard newline. */}
        <Text variant="display" style={styles.posterTitle}>
          Find a rival now
        </Text>

        <Text variant="meta" color={colors.inkMuted} numberOfLines={2} style={styles.posterLine}>
          {topic
            ? `${topic.name}${topic.viewer ? `  ·  Level ${topic.viewer.level}` : ''}`
            : 'Seven questions. Ten seconds each.'}
        </Text>

        <Button
          label={topic ? 'Play now' : 'Browse topics'}
          iconRight="arrowRight"
          fullWidth={false}
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
            <Text variant="tiny" color={colors.inkFaint}>
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
  // `accountLevel` is already floored by the server, so handing it back as the
  // floor reproduces the server's own answer exactly.
  const progress = accountProgress(user?.totalXp ?? 0, curve, level);
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
        <Icon name={icon} size={15} color={tint} />
        <View style={{ flex: 1 }} />
        <Icon name="chevronRight" size={13} color={colors.inkFaint} />
      </View>
      <Text variant="label" numberOfLines={1}>
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
   * Bottom-right and clipped by the card, so the two of them sit on its floor.
   * Pulled a few points past the right edge because the cut-out has air on that
   * side that would otherwise read as a margin the copy does not share.
   */
  posterArt: { position: 'absolute', right: -8, bottom: 0, width: '52%', height: '94%' },
  /**
   * `paddingRight` in per cent, not points: the copy column has to stay clear
   * of the art on a 360dp phone and on a tablet, and the art is sized in per
   * cent too. Two fixed numbers would agree on exactly one screen width.
   */
  posterBody: { padding: space.lg, paddingRight: '46%', gap: 3 },
  posterTitle: { marginTop: 2 },
  posterLine: { marginBottom: space.md },
  posterButton: { alignSelf: 'flex-start', paddingHorizontal: space.lg },
  posterAlt: { marginTop: space.sm, minHeight: 26, justifyContent: 'center' },

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
  levelBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 28 },

  doors: {
    flexDirection: 'row',
    gap: layout.cardGap,
    paddingHorizontal: layout.gutter,
    paddingBottom: space.xl,
  },
  door: {
    flex: 1,
    gap: 2,
    minHeight: 78,
    justifyContent: 'center',
    paddingHorizontal: layout.cardPadding,
    paddingVertical: space.md,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.sunken,
  },
  doorTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },

  rowHead: { paddingHorizontal: layout.gutter },
  recent: { paddingHorizontal: layout.gutter, paddingBottom: space.lg },
});

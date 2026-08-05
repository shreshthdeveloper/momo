import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useGame } from '../../src/state/game.jsx';
import { Text, Button, Avatar, useScrollBottom } from '../../src/components/ui.jsx';
import { LeagueBadge, leagueMetal } from '../../src/components/League.jsx';
import Icon from '../../src/components/Icon.jsx';
import Takeover, { eventsFromResult } from '../../src/components/Takeover.jsx';
import { coins as fmtCoins } from '../../src/lib/rarity.js';
import { leagueFor, leagueMovement } from '../../src/lib/league.js';
import { colors, fonts, layout, space, type, motion } from '../../src/theme/index.js';
import { useReducedMotion } from '../../src/lib/motion.js';
import { success } from '../../src/lib/haptics.js';
import { sfx } from '../../src/lib/sound.js';
import { setSeenLevel } from '../../src/lib/seen.js';
import { MATCH_MODE } from '../../src/shared/constants.js';

/**
 * design.md §8.8 + leagues-and-progression.md §7 — the match result, staged in
 * the order the drama actually arrives:
 *
 *   ┌───────────────────────────┐
 *   │        YOU WIN!           │  ← the verdict, huge, after the count-up
 *   │       Well played.        │
 *   │  (you)    —      (them)   │  ← faces at 64, winner's score tinted,
 *   │  Shreshth ✓5    3 Rival   │     heavier, and ticked
 *   │  ─────────────────────    │
 *   │  ● ● ● ○ ● ● ●  4 of 7    │  ← the rounds, and the number they imply
 *   └───────────────────────────┘
 *   ┌───────────────────────────┐
 *   │ RANKED RATING 1216  +16   │  ← ranked only: the climb, and the league
 *   │ ▓▓▓▓▓▓▓░░░  59 to Gold I  │     it lands in. Promotion springs the badge.
 *   └───────────────────────────┘
 *   ┌────────┐ ┌────────┐ ┌────────┐
 *   │ MATCH  │ │  XP    │ │ACCOUNT │  ← outlined tiles, each in its accent
 *   └────────┘ └────────┘ └────────┘
 *   ┌───────────────────────────┐
 *   │ Account level 12          │  ← the level-up moment, WITH what it unlocked
 *   │ · Pig — Avatar            │
 *   │ [ Open the Shop ]         │
 *   └───────────────────────────┘
 *   Python level 8 · assignments · void notice
 *   [ Rematch ]  [ Review ]  Share · Home
 *
 * Three separate progressions live on this screen and none of them may be
 * mistaken for another: the **ranked rating** (global, can fall, carries the
 * league), the **account level** (global, never falls, carries the unlocks) and
 * the **topic level** (this subject only, never falls). Every one of them is
 * labelled with its scope for exactly that reason.
 *
 * Quick play shows none of the ranked furniture, because nothing ranked moved.
 */

const PERK_ICON = { avatar: 'user', banner: 'flag', title: 'sparkle' };
const PERK_WORD = { avatar: 'Avatar', banner: 'Banner', title: 'Title' };
/** A stable empty array, so a missing `unlocked[]` is not a new dep each render. */
const NO_UNLOCKS = [];

/** §7 — the scores count up over this, then the verdict lands. */
const COUNT_MS = 600;
/** A beat between the verdict and the rating starting to move. */
const RATING_DELAY = 200;
/** Unlocks deal in one after another rather than all at once. */
const UNLOCK_STAGGER = 40;
const UNLOCK_FADE = 200;

export default function MatchResult() {
  const game = useGame();
  const scrollBottom = useScrollBottom();
  const router = useRouter();
  const reduced = useReducedMotion();
  const result = game.result;
  const you = game.you;

  // ── What the payload says happened ──────────────────────────────────────
  // Every read is defensive: a payload from an older server simply degrades to
  // the pre-league screen rather than rendering a league for a rating it never
  // sent.
  const isVoid = Boolean(result?.isVoid);
  const contest = result?.contest ?? null;
  const ranked = result ? (result.ranked ?? !(contest || isVoid)) : false;

  const rankedAfter = result?.rankedAfter ?? result?.ratingAfter ?? 0;
  const rankedBefore = result?.rankedBefore ?? result?.ratingBefore ?? rankedAfter;
  const rankedDelta = result?.rankedDelta ?? rankedAfter - rankedBefore;

  const standing = result?.leagueAfter ?? leagueFor(rankedAfter);
  const movement = result?.leagueMovement ?? leagueMovement(rankedBefore, rankedAfter);
  const promoted = ranked && !isVoid && !contest && movement === 'promoted';
  const demoted = ranked && !isVoid && !contest && movement === 'demoted';

  const accountLevel = result?.accountLevel ?? null;
  const unlocks = Array.isArray(result?.unlocked) ? result.unlocked : NO_UNLOCKS;
  /**
   * Chests are NOT staged here. One was won by crossing a rating, and it is
   * opened on the rewards screen — so this screen's job is to say it exists
   * and point at the door, not to unwrap it in a corner of a scoreboard.
   */
  const chestsWon = Array.isArray(result?.chestsWon) ? result.chestsWon : NO_UNLOCKS;
  const wonChest = chestsWon.length > 0;
  const unlockCount = unlocks.length;
  const levelledUp =
    Boolean(result?.accountLevelUp) || unlockCount > 0 || chestsWon.length > 0;

  /**
   * ── The takeover owns the celebration; this screen keeps the receipt.
   *
   * A promotion, a level-up and every unlock used to be staged inline here,
   * which put the biggest moments in the game in a scrolling column beside the
   * Rematch button. They now play full screen, one at a time, once the rating
   * has finished counting. What stays behind is the record of it — the badge,
   * the tile, the list — rendered plainly rather than performed twice.
   */
  const events = useMemo(() => eventsFromResult(result, { promoted }), [result, promoted]);
  const hasTakeover = events.length > 0;
  const [celebrating, setCelebrating] = useState(false);
  /** Only this screen stages a card when nothing bigger is going to. */
  const inlinePromo = promoted && !hasTakeover;
  const inlineLevel = levelledUp && !hasTakeover;

  const [displayed, setDisplayed] = useState({ you: 0, opponent: 0 });
  const [showVerdict, setShowVerdict] = useState(reduced);
  const [rankedShown, setRankedShown] = useState(rankedBefore);
  const verdictScale = useRef(new Animated.Value(reduced ? 1 : 0.85)).current;
  const verdictOpacity = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  // Staged pieces start hidden from the very first frame — set in the effect
  // instead, they would flash for one paint before the timeline hid them.
  const badgeScale = useRef(new Animated.Value(inlinePromo ? 0.6 : 1)).current;
  const badgeOpacity = useRef(new Animated.Value(inlinePromo ? 0 : 1)).current;
  const levelScale = useRef(new Animated.Value(inlineLevel ? 0.94 : 1)).current;
  const levelOpacity = useRef(new Animated.Value(inlineLevel ? 0 : 1)).current;
  const unlockDrive = useRef(new Animated.Value(inlineLevel ? 0 : 1)).current;

  /**
   * Sound and haptics fire once per screen, not once per effect run — the
   * reduced-motion flag arrives asynchronously, which re-runs the timeline.
   */
  const promoCued = useRef(false);
  const levelCued = useRef(false);

  // §7 — the reveal, in order: scores, verdict, rating, league, level.
  useEffect(() => {
    if (!result) return undefined;

    const timers = [];
    const intervals = [];
    const stop = () => {
      timers.forEach(clearTimeout);
      intervals.forEach(clearInterval);
    };

    const cue = (flag, sound) => {
      if (flag.current) return;
      flag.current = true;
      success();
      sound();
    };

    // §7 — reduced motion: everything is simply already true. The cues still
    // fire; sound and haptics are not motion.
    if (reduced) {
      setDisplayed(result.scores);
      setRankedShown(rankedAfter);
      setShowVerdict(true);
      badgeOpacity.setValue(1);
      badgeScale.setValue(1);
      levelOpacity.setValue(1);
      levelScale.setValue(1);
      unlockDrive.setValue(1);
      // Reduced motion removes the staging, not the moment: the takeover still
      // opens, with every band already at its final value.
      if (hasTakeover) setCelebrating(true);
      if (inlinePromo) cue(promoCued, sfx.found);
      if (inlineLevel) cue(levelCued, sfx.correct);
      return undefined;
    }

    const scoreStart = Date.now();
    const scoreTick = setInterval(() => {
      const t = Math.min(1, (Date.now() - scoreStart) / COUNT_MS);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplayed({
        you: Math.round(result.scores.you * ease),
        opponent: Math.round(result.scores.opponent * ease),
      });
      if (t >= 1) clearInterval(scoreTick);
    }, 30);
    intervals.push(scoreTick);

    timers.push(
      setTimeout(() => {
        setShowVerdict(true);
        Animated.parallel([
          Animated.timing(verdictOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
          Animated.spring(verdictScale, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }),
        ]).start();
      }, COUNT_MS),
    );

    // §7 — the ranked rating ticks to its new value over 600ms.
    if (ranked && !isVoid && !contest) {
      timers.push(
        setTimeout(() => {
          const start = Date.now();
          const tick = setInterval(() => {
            const t = Math.min(1, (Date.now() - start) / motion.ratingTick);
            const ease = 1 - Math.pow(1 - t, 3);
            setRankedShown(Math.round(rankedBefore + (rankedAfter - rankedBefore) * ease));
            if (t >= 1) clearInterval(tick);
          }, 30);
          intervals.push(tick);
        }, COUNT_MS + RATING_DELAY),
      );
    }

    // The badge lands the instant the number stops climbing — the promotion is
    // the *consequence* of the count, so it must not pre-empt it.
    const standAt =
      ranked && !isVoid && !contest ? COUNT_MS + RATING_DELAY + motion.ratingTick : COUNT_MS;

    /**
     * The takeover opens a beat after the rating stops climbing.
     *
     * That order is the whole reason it works: the promotion is the
     * *consequence* of the number moving, so a player has to watch the number
     * move first or the celebration is about nothing.
     */
    if (hasTakeover) {
      timers.push(setTimeout(() => setCelebrating(true), standAt + 260));
    }

    if (inlinePromo) {
      timers.push(
        setTimeout(() => {
          cue(promoCued, sfx.found);
          Animated.parallel([
            Animated.timing(badgeOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
            Animated.spring(badgeScale, { toValue: 1, friction: 5, tension: 110, useNativeDriver: true }),
          ]).start();
        }, standAt),
      );
    }

    if (inlineLevel) {
      const unlockMs = Math.max(UNLOCK_FADE, UNLOCK_FADE + UNLOCK_STAGGER * (unlockCount - 1));
      timers.push(
        setTimeout(
          () => {
            cue(levelCued, sfx.correct);
            Animated.parallel([
              Animated.timing(levelOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
              Animated.spring(levelScale, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }),
              Animated.timing(unlockDrive, {
                toValue: 1,
                duration: unlockCount > 0 ? unlockMs : 0,
                delay: 140,
                easing: Easing.linear,
                useNativeDriver: true,
              }),
            ]).start();
          },
          // A promotion gets the stage to itself first; the level-up follows it.
          standAt + (inlinePromo ? 480 : 120),
        ),
      );
    }

    return stop;
  }, [
    result,
    reduced,
    ranked,
    isVoid,
    contest,
    rankedBefore,
    rankedAfter,
    hasTakeover,
    inlinePromo,
    inlineLevel,
    unlockCount,
    verdictOpacity,
    verdictScale,
    badgeOpacity,
    badgeScale,
    levelOpacity,
    levelScale,
    unlockDrive,
  ]);

  /**
   * Navigating out is an effect, not a render — a replace dispatched while
   * React is still rendering logs a warning and can pop the stack past Home.
   */
  useEffect(() => {
    if (!result) router.replace('/');
  }, [result, router]);

  if (!result) return <View style={styles.blank} />;

  const wonIt = result.verdict === 'won';
  const lostIt = result.verdict === 'lost';
  const margin = Math.abs((result.scores?.you ?? 0) - (result.scores?.opponent ?? 0));

  /**
   * Who walked, if anyone.
   *
   * The side is read from the VERDICT rather than by comparing `forfeitedBy`
   * against this player's id. With a forfeit the winner is by definition the
   * player who stayed, so the verdict the server already computed says which
   * side of it this device is on — and it says so without this screen having
   * to know the shape of the id it holds. The local flag is consulted only as
   * corroboration for the quitter, since it exists solely on the device that
   * pressed the button.
   */
  const forfeitedBy = result.forfeitedBy ?? null;
  const wasForfeit = forfeitedBy != null && !isVoid;
  /**
   * The verdict wins over the local flag.
   *
   * When both players press Leave at almost the same moment the engine's first
   * `complete()` takes it and the slower quitter is handed `won` — so trusting
   * the local flag stacked "YOU LEFT / You forfeited the match" above a green
   * rating gain and a win being banked. A player who is told they won did win,
   * whatever their own device remembers about the button they pressed.
   */
  const youQuit = wasForfeit && !wonIt && (lostIt || Boolean(game.forfeitedByYou));
  const theyQuit = wasForfeit && !youQuit;

  // §10 — the loss copy consoles rather than announces. Nobody needs YOU
  // LOSE in 44pt; a close loss is "so close", a big one is still "nice try".
  // A forfeit is stated plainly instead: the scoreboard behind it is not what
  /**
   * A solo drill has no verdict, because there was nobody to beat.
   *
   * Whatever the server computes for `verdict` on a one-player match, declaring
   * "YOU WIN!" over an empty opposite half is nonsense — and "NICE TRY" would be
   * worse, since there is nothing to have lost to. So a drill reports what it
   * actually has: how many you got right.
   */
  const solo = !result.opponent;
  /**
   * A self-race is the one match with an opponent who is not a person.
   *
   * It is NOT `solo` — there are two entries, so it ends in a real won/lost/draw
   * and the server is right to compute one. But `solo` was this screen's only
   * signal, so beating your own recorded run was announced as "YOU WIN! · Well
   * played" — the app congratulating you for defeating yourself, and never once
   * naming the score you actually went after. `matchService` documents the
   * intended copy in as many words; the screen simply had no way to know.
   *
   * `result.mode` is what it now knows. The opponent's score is the target,
   * because the opponent IS the target.
   */
  const isSelf = result.mode === MATCH_MODE.SELF;
  const target = result.scores?.opponent ?? 0;
  // `correctCount` is computed further down for the round dots; this needs the
  // same number, so it is worked out here rather than duplicated.
  const landed = (result.rounds ?? []).filter(
    (r) => r.you?.optionIndex != null && r.you.optionIndex === r.correctIndex,
  ).length;
  const totalRounds = (result.rounds ?? []).length;

  const headline = solo
    ? `${landed} OF ${totalRounds}`
    : isSelf
    ? wonIt
      ? 'NEW BEST!'
      : lostIt
        ? 'NOT THIS TIME'
        : 'DEAD EVEN'
    : theyQuit
    ? 'OPPONENT LEFT'
    : youQuit
      ? 'YOU LEFT'
      : wonIt
        ? 'YOU WIN!'
        : lostIt
          ? margin <= 40
            ? 'SO CLOSE!'
            : 'NICE TRY!'
          : result.verdict === 'draw'
            ? 'DEAD EVEN'
            : 'VOID';
  const subline = solo
    ? landed === totalRounds
      ? 'Every one. Nothing left to practise here.'
      : 'Tap below to see the ones you missed.'
    : isSelf
    ? wonIt
      ? `You beat your best of ${target}. This run is the one to beat now.`
      : lostIt
        ? `Your best of ${target} still stands. Same paper, whenever you want it.`
        : `Exactly your best of ${target}. Not a point in it.`
    : theyQuit
    ? `${game.opponent?.displayName ?? 'Your opponent'} left the match, so it goes to you.`
    : youQuit
      ? 'You forfeited the match.'
      : wonIt
        ? 'Well played.'
        : lostIt
          ? 'Better luck next time.'
          : result.verdict === 'draw'
            ? 'Neither of you gave an inch.'
            : null;

  const ringFor = (winner) =>
    result.verdict === 'draw' || isVoid ? colors.inkFaint : winner ? colors.correct : colors.wrong;

  /** How many of the seven landed — the number the dots only imply. */
  const correctCount = result.rounds.filter(
    (r) => r.you.optionIndex !== null && r.you.optionIndex === r.correctIndex,
  ).length;

  const metal = leagueMetal(standing.key, standing.color);
  const showLeague = ranked && !isVoid && !contest;
  const showQuietLine = !ranked && !isVoid && !contest;
  const quietLine =
    result.mode === MATCH_MODE.SELF
      ? 'Against your own best — nothing at stake.'
      : result.mode === MATCH_MODE.PRACTICE
        ? 'On your own — nothing at stake.'
        : 'Quick play — nothing at stake.';
  // Three tiles is the row; a contest or a void already spends the middle slot.
  const showAccountTile = accountLevel != null && !contest && !isVoid;
  const topicName = game.topic?.name ?? null;

  const unlockStyle = (index) => {
    const span = UNLOCK_FADE + UNLOCK_STAGGER * Math.max(0, unlockCount - 1);
    const from = (UNLOCK_STAGGER * index) / span;
    const to = (UNLOCK_STAGGER * index + UNLOCK_FADE) / span;
    return {
      opacity: unlockDrive.interpolate({
        inputRange: [from, to],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      }),
      transform: [
        {
          translateY: unlockDrive.interpolate({
            inputRange: [from, to],
            outputRange: [8, 0],
            extrapolate: 'clamp',
          }),
        },
      ],
    };
  };

  return (
    <View style={styles.screen}>

      {/**
        * Above the result, not instead of it — the receipt is already behind
        * this and stays exactly where the player left it when they tap through.
        */}
      {celebrating ? (
        <Takeover
          events={events}
          onDone={() => {
            setCelebrating(false);
            // Whatever the takeover just showed has been seen, so the rewards
            // shelf must not offer it again as an unopened chest.
            if (accountLevel != null) setSeenLevel(accountLevel);
          }}
        />
      ) : null}

      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {/* The screen ends in Share and Home, so the padding under them is the
            navigation bar's height rather than a guess at it — 32 cleared an
            iPhone's home indicator and left the buttons half behind Android's
            48dp three-button bar. */}
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: scrollBottom }]}
          showsVerticalScrollIndicator={false}
        >
          {/**
            * ── The scoreboard.
            *
            * Verdict, faces, scores and the seven rounds used to be three
            * floating blocks stacked down the page. They are one fact — what
            * happened in this match — and splitting them meant the eye had to
            * assemble it, while every later section (rating, XP, level) was
            * already a bordered card. The receipt was the only part of the
            * screen that did not look composed.
            *
            * So it is one card, and the hierarchy inside it is deliberate:
            *
            *   1. the verdict, in the largest type on the screen
            *   2. the two scores, with the winner's tinted AND heavier AND
            *      marked with a tick — never colour alone, because roughly one
            *      man in twelve cannot separate the green from the red
            *   3. the faces, at 64 rather than 92: they identify the players,
            *      they are not the news
            *   4. the rounds, on a hairline under everything, where a detail
            *      belongs
            *
            * It carries no illustration. A win briefly had one behind the
            * verdict, and it was the wrong place for it twice over: the screen
            * a player reaches four times an hour is the last one that should
            * pay for a 350 KB decoration, and the type here is already the
            * loudest thing in the app. Artwork lives where something has to be
            * WANTED — the poster and the welcome — not where it is reported.
            */}
          <View style={[styles.board, wonIt && styles.boardWon]}>
            {showVerdict ? (
              <Animated.View
                style={{
                  opacity: verdictOpacity,
                  transform: [{ scale: verdictScale }],
                  alignItems: 'center',
                }}
              >
                <Text style={styles.headline} accessibilityRole="header" allowFontScaling={false}>
                  {headline}
                </Text>
                {subline ? (
                  <Text variant="meta" color={colors.inkMuted} style={{ marginTop: 2 }}>
                    {subline}
                  </Text>
                ) : null}
              </Animated.View>
            ) : (
              <View style={{ height: 56 }} />
            )}

            {/* A faceoff needs two faces. A drill shows one score, centred,
                with no dash and no empty seat opposite it. */}
            <View style={styles.faceoff}>
              <Side
                name={you?.displayName ?? 'You'}
                avatarUrl={you?.avatarUrl}
                score={displayed.you}
                ring={solo ? undefined : ringFor(wonIt)}
                won={!solo && wonIt && !isVoid}
                tone={
                  solo || result.verdict === 'draw' || isVoid
                    ? colors.ink
                    : wonIt
                      ? colors.correct
                      : colors.inkMuted
                }
              />

              {/* An em dash, not a bolt. The thing between two scores is the
                  relationship between them, and a lightning glyph was saying
                  something about speed that this line is not about. */}
              {solo ? null : (
                <Text allowFontScaling={false} style={styles.dash}>
                  —
                </Text>
              )}

              {solo ? null : (
              <Side
                name={result.opponent?.displayName ?? 'Rival'}
                avatarUrl={result.opponent?.avatarUrl}
                score={displayed.opponent}
                ring={ringFor(lostIt)}
                won={lostIt && !isVoid}
                tone={result.verdict === 'draw' || isVoid ? colors.ink : lostIt ? colors.correct : colors.inkMuted}
              />
              )}
            </View>

            {/* ── The seven rounds, at a glance, and how many landed. */}
            <View style={styles.rounds}>
              <View style={styles.strip} accessibilityLabel="Round by round result">
                {result.rounds.map((round, i) => {
                  const correct = round.you.optionIndex === round.correctIndex;
                  const answered = round.you.optionIndex !== null;
                  return (
                    <View
                      key={i}
                      style={[
                        styles.dot,
                        {
                          backgroundColor: !answered
                            ? colors.hairline
                            : correct
                              ? colors.correct
                              : colors.wrong,
                        },
                      ]}
                      accessibilityLabel={`Round ${i + 1}: ${!answered ? 'no answer' : correct ? 'correct' : 'wrong'}`}
                    />
                  );
                })}
              </View>
              {/* The dots are a shape; this is the number. Seven dots is a
                  thing to count, and nobody counts. */}
              <Text variant="tiny" color={colors.inkFaint}>
                {correctCount} of {result.rounds.length} right
              </Text>
            </View>
          </View>

          {/* ── Ranked: the global rating, and the league band it lands in.
              A league is a band of that number, so the badge derives itself
              from the rating and the two can never disagree. */}
          {showLeague ? (
            <View style={styles.leagueCard}>
              <View style={styles.leagueHead}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="tiny" color={colors.inkMuted} style={styles.statLabel}>
                    RANKED RATING
                  </Text>
                  <View style={styles.ratingRow}>
                    <Text
                      allowFontScaling={false}
                      style={[type.scoreLive, styles.ratingValue]}
                    >
                      {rankedShown}
                    </Text>
                    {rankedDelta === 0 ? null : (
                      <View
                        style={[
                          styles.deltaPill,
                          {
                            backgroundColor:
                              rankedDelta > 0 ? colors.correctSoft : colors.wrongSoft,
                          },
                        ]}
                      >
                        <Text
                          allowFontScaling={false}
                          style={[
                            type.option,
                            { color: rankedDelta > 0 ? colors.correct : colors.wrong },
                          ]}
                        >
                          {rankedDelta > 0 ? `+${rankedDelta}` : `−${Math.abs(rankedDelta)}`}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                <Animated.View
                  style={{ opacity: badgeOpacity, transform: [{ scale: badgeScale }] }}
                >
                  <LeagueBadge rating={rankedAfter} size="lg" />
                </Animated.View>
              </View>

              {/* The climb reads off the NEW division, so on a promotion it
                  waits with the badge rather than announcing it early. Where
                  nothing was promoted `badgeOpacity` is a constant 1. */}
              <Animated.View style={[styles.climb, { opacity: badgeOpacity }]}>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.fill,
                      {
                        width: `${Math.round((standing.fraction ?? 0) * 100)}%`,
                        backgroundColor: metal.ink,
                      },
                    ]}
                  />
                </View>

                <Text variant="meta" color={colors.inkFaint}>
                  {standing.isTop || standing.pointsForNext == null
                    ? 'Top of the ladder. Nothing above this.'
                    : `${standing.pointsForNext} to ${leagueFor(rankedAfter + standing.pointsForNext).label}`}
                </Text>
              </Animated.View>

              {/* Promotion is a moment; demotion is a fact. It is stated in the
                  same place, in muted ink, with nothing staged around it. */}
              {promoted ? (
                <Animated.View style={[styles.movementRow, { opacity: badgeOpacity }]}>
                  <Icon name="sparkle" size={16} color={metal.ink} />
                  <Text variant="label" color={metal.ink}>
                    Promoted to {standing.label}
                  </Text>
                </Animated.View>
              ) : demoted ? (
                <Text variant="label" color={colors.inkMuted}>
                  Demoted to {standing.label}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/**
           * What was played, and what it cost.
           *
           * This said "Quick play — nothing at stake" for every unranked result,
           * which is three quarters wrong: it appeared under a practice drill,
           * under a revision drill and under a self-race, none of which is quick
           * play. The clause it exists for — *nothing at stake* — is true of all
           * four, and it is the only part that has to survive; the mode in front
           * of it should be the mode that was actually played.
           */}
          {showQuietLine ? (
            <Text variant="meta" color={colors.inkFaint} style={styles.quiet}>
              {quietLine}
            </Text>
          ) : null}

          {/* ── The numbers, each in its own outlined tile. */}
          <View style={styles.tiles}>
            <StatBox label="Match score" tint={colors.close} value={`${result.scores.you}`} />
            {isVoid ? (
              <StatBox label="Rating" tint={colors.inkFaint} value="—" />
            ) : contest ? (
              <StatBox
                label={contest.name}
                tint={colors.optionC}
                value={contest.rank ? `#${contest.rank}` : 'In'}
              />
            ) : null}
            <StatBox label="XP earned" tint={colors.accent} value={`+${result.xpEarned ?? 0}`} />
            {/* Coins sit on the receipt beside XP because that is what they are
                — a figure this match produced. The takeover only stages them
                when a level or a promotion made the number unusual; fifty for a
                win happens every match, and a celebration that fires every
                match is not a celebration. */}
            {result.coinsEarned > 0 ? (
              <StatBox
                label="Coins"
                tint={colors.gold}
                value={`+${fmtCoins(result.coinsEarned)}`}
              />
            ) : null}
            {showAccountTile ? (
              <StatBox label="Account level" tint={colors.optionC} value={`${accountLevel}`} />
            ) : null}
          </View>

          {/* ── The account level-up: the one number that never falls, and the
              only one that hands anything over. It gets the moment. */}
          {levelledUp ? (
            <Animated.View
              style={[
                styles.levelCard,
                { opacity: levelOpacity, transform: [{ scale: levelScale }] },
              ]}
            >
              <View style={styles.levelHead}>
                <View style={styles.levelIcon}>
                  <Icon name="sparkle" size={20} color={colors.accent} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="title" color={colors.ink}>
                    {result?.accountLevelUp
                      ? `Account level ${accountLevel}`
                      : wonChest
                        ? 'A chest is waiting'
                        : 'Account level up'}
                  </Text>
                  <Text variant="meta" color={colors.inkMuted}>
                    {unlockCount > 0
                      ? unlockCount === 1
                        ? 'One new thing is yours.'
                        : `${unlockCount} new things are yours.`
                      : wonChest
                        ? chestsWon[0].triggerLabel
                        : 'Your account level only ever rises.'}
                  </Text>
                </View>
              </View>

              {unlocks.map((perk, i) => (
                <Animated.View key={perk.key ?? i} style={[styles.unlockRow, unlockStyle(i)]}>
                  <View style={styles.unlockIcon}>
                    <Icon name={PERK_ICON[perk.type] ?? 'sparkle'} size={15} color={colors.accent} />
                  </View>
                  <Text variant="label" color={colors.ink} numberOfLines={1} style={{ flex: 1 }}>
                    {perk.name}
                  </Text>
                  <Text variant="meta" color={colors.inkFaint}>
                    {PERK_WORD[perk.type] ?? 'Reward'}
                  </Text>
                </Animated.View>
              ))}

              {chestsWon.map((chest) => (
                <View key={chest.key} style={styles.chestRow}>
                  <View style={styles.chestSeal}>
                    <Icon name="gift" size={15} color={colors.gold} />
                  </View>
                  <Text variant="label" color={colors.ink} numberOfLines={1} style={{ flex: 1 }}>
                    {chest.name}
                  </Text>
                  <Text variant="meta" color={colors.gold}>
                    unopened
                  </Text>
                </View>
              ))}

              <Button
                variant="soft"
                size="md"
                label={chestsWon.length ? 'Open your chest' : 'Open the Shop'}
                iconRight="arrowRight"
                style={{ marginTop: space.sm }}
                onPress={() => router.push('/shop')}
              />
            </Animated.View>
          ) : null}

          {/* ── One-line footnotes: the topic level, assignments, void.
              "Python level 8" is this subject only — never the account level
              above it, which is why the topic is named. */}
          {result.levelUp ? (
            <Text variant="label" color={colors.optionC} style={styles.footnote}>
              {topicName ? `${topicName} level ${result.level}` : `Topic level ${result.level}`}
            </Text>
          ) : null}
          {result.assignmentsCompleted?.length > 0 ? (
            <Text variant="meta" color={colors.inkMuted} style={styles.footnote}>
              {result.assignmentsCompleted.length === 1
                ? `Assignment done — ${result.assignmentsCompleted[0].title}`
                : `${result.assignmentsCompleted.length} assignments finished`}
            </Text>
          ) : null}
          {isVoid ? (
            <Text variant="meta" color={colors.inkMuted} style={styles.footnote}>
              Both players disconnected — no rating change
            </Text>
          ) : null}

          {/* ── prd.md F6.4.19 — rematch, review, share, home. One primary.
              A contest allows one attempt, so its primary is the standings. */}
          {contest ? (
            <Button
              label="See the standings"
              style={styles.primary}
              onPress={() => router.replace(`/contest/${contest.contestId}`)}
            />
          ) : game.rematchInvite ? (
            /**
             * They asked first. Both sides have to ask for the handshake to
             * complete, so this is the other half of it — and until the
             * invitation had an event of its own, this prompt could not exist
             * and a one-sided rematch simply expired in silence.
             */
            <>
              <Text variant="meta" color={colors.gold} style={styles.footnote}>
                {game.rematchInvite.from?.displayName ?? 'Your rival'} wants a rematch
              </Text>
              <Button
                label="Play again"
                style={styles.primary}
                onPress={() => {
                  game.rematch();
                  router.replace('/match/searching');
                }}
              />
              <Button
                variant="soft"
                label="Not now"
                onPress={() => game.declineRematch()}
                style={{ marginTop: space.md }}
              />
            </>
          ) : (
            <Button
              label={game.rematchPending ? 'Waiting for them…' : 'Rematch'}
              disabled={game.rematchPending}
              style={styles.primary}
              onPress={() => {
                game.rematch();
                router.replace('/match/searching');
              }}
            />
          )}

          <Button
            variant="soft"
            label="Review the questions"
            onPress={() => router.push(`/review/${result.matchId}`)}
            style={{ marginTop: space.md }}
          />

          <View style={styles.secondaryRow}>
            <Button
              variant="soft"
              size="md"
              label="Share"
              icon="share"
              style={{ flex: 1 }}
              onPress={() =>
                Share.share({
                  message: `${headline} ${result.scores.you}–${result.scores.opponent} on Mimo.`,
                }).catch(() => {})
              }
            />
            <Button
              variant="soft"
              size="md"
              label="Home"
              icon="home"
              style={{ flex: 1 }}
              onPress={() => {
                game.reset();
                router.replace('/');
              }}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/** An outlined stat tile — the label above, the number in the tile's accent. */
/**
 * One player on the scoreboard: face, name, score.
 *
 * The winner is marked three ways — the score is tinted green, set in the
 * display face rather than the score face, and carries a tick. `color-not-only`
 * is not a checkbox here: green and red at the same weight is precisely the
 * pair that roughly one man in twelve cannot separate, and this is the one
 * number on the screen they came to read.
 */
function Side({ name, avatarUrl, score, ring, won, tone }) {
  return (
    <View style={styles.side}>
      <Avatar url={avatarUrl} name={name} size={64} style={[styles.face, { borderColor: ring }]} />
      <Text variant="meta" color={colors.inkMuted} numberOfLines={1} style={styles.sideName}>
        {name}
      </Text>
      <View style={styles.wonMark}>
        {won ? <Icon name="check" size={13} color={colors.correct} /> : null}
        <Text
          allowFontScaling={false}
          style={[styles.sideScore, won && styles.sideScoreWon, { color: tone }]}
        >
          {score}
        </Text>
      </View>
    </View>
  );
}

function StatBox({ label, value, tint }) {
  return (
    <View style={styles.statBox}>
      <Text variant="tiny" color={colors.inkMuted} numberOfLines={2} style={styles.statLabel}>
        {label.toUpperCase()}
      </Text>
      <View style={[styles.statFrame, { borderColor: tint }]}>
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={[type.timer, { color: tint, fontVariant: ['tabular-nums'] }]}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.night },
  /** Night, not white: this frame sits between the match and Home. */
  blank: { flex: 1, backgroundColor: colors.night },
  content: { padding: layout.gutter, alignItems: 'stretch' },

  headline: {
    ...type.scoreHero,
    fontSize: 40,
    lineHeight: 48,
    color: colors.ink,
    letterSpacing: 3,
    textAlign: 'center',
  },

  // ── The scoreboard ───────────────────────────────────────────────────────
  board: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: layout.cardPadding,
    paddingTop: space.lg,
    paddingBottom: space.md,
    overflow: 'hidden',
  },
  /** A win gets a warmer rim. One property, and only on the state that earns it. */
  boardWon: { borderColor: 'rgba(47, 191, 131, 0.34)' },
  faceoff: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginTop: space.lg,
  },
  side: { alignItems: 'center', gap: 3, flex: 1 },
  /** 64, not 92. The faces identify the players; they are not the news. */
  face: { borderWidth: 3 },
  sideName: { maxWidth: 120, marginTop: 2 },
  sideScore: { ...type.scoreLive, includeFontPadding: false },
  /** The winner's number carries weight as well as colour. */
  sideScoreWon: { fontFamily: fonts.display },
  wonMark: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dash: {
    ...type.scoreLive,
    color: colors.inkFaint,
    paddingTop: 60,
    paddingHorizontal: space.xs,
    includeFontPadding: false,
  },

  rounds: {
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.lg,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  strip: { flexDirection: 'row', justifyContent: 'center', gap: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },

  leagueCard: {
    marginTop: space.xl,
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: layout.cardPadding,
    gap: space.md,
  },
  leagueHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  ratingValue: { color: colors.ink, fontVariant: ['tabular-nums'] },
  /**
   * The delta explains the number beside it, so it is sized to be read — a
   * `tiny` +16 next to a 30pt rating was the audit's "third the size" note.
   */
  deltaPill: {
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: layout.radiusPill,
  },
  climb: { gap: space.sm },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.hairline, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  movementRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },

  quiet: { textAlign: 'center', marginTop: space.xl },

  tiles: {
    flexDirection: 'row',
    gap: space.md,
    marginTop: space.xl,
    // Bottom-aligned so a two-line label never knocks its tile out of the row.
    alignItems: 'flex-end',
  },
  statBox: { flex: 1, alignItems: 'center', gap: space.sm },
  statLabel: { letterSpacing: 1.2, textAlign: 'center' },
  statFrame: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderRadius: layout.radiusInput,
    minHeight: 56,
    paddingHorizontal: space.sm,
  },

  levelCard: {
    marginTop: space.xl,
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: layout.cardPadding,
    gap: space.md,
  },
  levelHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  levelIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.sm,
  },
  chestSeal: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldSoft,
  },
  unlockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.sunken,
    borderRadius: layout.radiusInput,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 44,
  },
  unlockIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  footnote: { textAlign: 'center', marginTop: space.md },

  primary: { marginTop: space.xl },
  secondaryRow: { flexDirection: 'row', gap: space.md, marginTop: space.md },
});

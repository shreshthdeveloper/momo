import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useGame } from '../../src/state/game.jsx';
import { useAuth } from '../../src/state/auth.jsx';
import { Text, Button, ErrorNotice, Avatar } from '../../src/components/ui.jsx';
import Globe from '../../src/components/Globe.jsx';
import { SoloDeck, ChallengeWait } from '../../src/components/MatchIntro.jsx';
import { colors, layout, space, type } from '../../src/theme/index.js';
import { DECK, MATCH_MODE } from '../../src/shared/constants.js';
import { useReducedMotion } from '../../src/lib/motion.js';
import { heavy } from '../../src/lib/haptics.js';
import { sfx } from '../../src/lib/sound.js';

/**
 * design.md §8.4 — searching, as a planet being swept for one other person.
 *
 * This used to be a dark world map panning between the Americas and Asia with
 * player pins dropping onto it. The staging was right and the object was wrong:
 * a rectangle of coastline sliding sideways is a *background*, and nothing on
 * it was ever the subject. A globe is a thing — people ride round the back of
 * it, a satellite orbits it, and a scan can sweep it pole to pole. See
 * Globe.jsx for how it is projected; the short version is that it is real
 * spherical geometry rather than a circle with rings drawn on it.
 *
 * It is still theatre — the queue is a Redis set, not a planet — but it is
 * honest theatre: somewhere out there is a person, and this is the looking.
 *
 * When the matchmaker answers, the spin stops, the satellite flies round to its
 * firing angle, the beam falls on the rival's dot, the ping goes out and FOUND
 * ONE! stamps in — the hurray beat, before the versus ceremony takes over.
 *
 * The budget used to be "at most 3 seconds, always", which is why the camera
 * never had to slow down honestly. Level-based pairing searches a narrower pool
 * than the rating bands it replaced, so the deadline is now 8s to give a live
 * opponent a real chance of turning up — long enough that the screen has to say
 * what it is doing rather than just look busy. That is what the band caption is
 * for.
 */

/** The achievement voice, from the palette — see `colors.gold`. */
const GOLD = colors.gold;

/**
 * Long enough for the lock-on to finish before the versus screen takes over.
 * The beam and the ping run to ~1050ms inside the globe; leaving on 1100 cut
 * the ping off at the moment it was making its point.
 */
const FOUND_HOLD_MS = 1600;

/**
 * The same beat, for a match with nobody to introduce.
 *
 * `FOUND_HOLD_MS` is the length of the lock-on: the globe stops, the satellite
 * flies round, the beam falls, the ping goes out. A drill has none of that — the
 * deck squares up and a tick lands, which is over in a spring — so holding for
 * the full 1.6s was 1.6s of a finished animation.
 *
 * Together with the server's `SOLO_COUNTDOWN_MS` this is the whole of "practice
 * and revise are slow": between them the two delays put about seven seconds of
 * nothing between the button and the first question, on the one mode whose
 * questions are ready before the finger leaves the screen.
 */
const SOLO_HOLD_MS = 800;

/**
 * What the matchmaker is actually doing, as a caption.
 *
 * Pairing starts at your exact topic level and opens by one level every
 * `bandStepMs` up to `bandMax` (constants.js). That used to be over in three
 * seconds; it now runs to eight, and eight seconds of an unchanging SEARCHING
 * reads as a hung screen no matter how good the globe looks. So the widening is
 * shown: "Level 5", then "Level 4–6", then "Level 3–7". It is the literal truth
 * about the query being run, and it turns waiting into visible progress.
 *
 * The server sends the band parameters with QUEUE_SEARCHING so this never has
 * to guess; with an older server they are absent and the caption falls back to
 * the topic name alone.
 */
function useSearchBand(game) {
  const { level, bandStepMs, bandMax } = game.topic ?? {};
  const searching = game.status === 'searching';
  const [band, setBand] = useState(0);

  useEffect(() => {
    if (!searching || !Number.isFinite(level) || !bandStepMs) return undefined;
    setBand(0);
    const startedAt = Date.now();
    const id = setInterval(() => {
      const open = Math.floor((Date.now() - startedAt) / bandStepMs);
      setBand(Math.min(bandMax ?? 5, Math.max(0, open)));
    }, 200);
    return () => clearInterval(id);
  }, [searching, level, bandStepMs, bandMax]);

  if (!Number.isFinite(level)) return null;
  return {
    band,
    label: band === 0 ? `Level ${level}` : `Level ${Math.max(1, level - band)}–${level + band}`,
    widening: band > 0,
  };
}

export default function Searching() {
  const game = useGame();
  const { user } = useAuth();
  const router = useRouter();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { topicId, spaceId, name, mode, challengeId, opponent, avatarUrl, deck } =
    useLocalSearchParams();
  /**
   * A drill never searches, so it must not say it is searching.
   *
   * Practice resolves server-side the moment it is asked for, so this screen is on
   * screen for a few hundred milliseconds — long enough to read. "SEARCHING FOR
   * OPPONENT" over a mode that has no opponent is the one sentence the whole solo
   * design exists to avoid, and it was flashing up on every drill.
   */
  const isDrill = String(mode ?? '') === MATCH_MODE.PRACTICE;
  /** Beating your own best run. An opponent exists on the paper and not in the
   *  world — it is a recording, and it was queueing under the open-queue staging
   *  because only PRACTICE was ever checked here. */
  const isSelf = String(mode ?? '') === MATCH_MODE.SELF;
  const isRevision = String(deck ?? '') === DECK.MISTAKES;
  /** Nobody is on the other side of this one. */
  const soloRun = isDrill || isSelf;
  /** Exactly one person can answer this, and the screen already knows who. */
  const isChallenge = Boolean(challengeId);
  const { width: screenW } = useWindowDimensions();

  // The globe is the hero, but its frame carries the satellite's orbit as well,
  // so the sphere itself is a little over half the width rather than most of it.
  // The two stages that replace it are sized to match, so the layout does not
  // jump between modes.
  const stageSize = Math.min(320, Math.round(screenW * 0.66));

  const glow = useRef(new Animated.Value(0)).current;
  const stamp = useRef(new Animated.Value(0)).current;
  const [found, setFound] = useState(false);

  // The searching line breathes.
  useEffect(() => {
    if (reduced || found) return undefined;
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    breathe.start();
    return () => breathe.stop();
  }, [glow, reduced, found]);

  useEffect(() => {
    if (game.status !== 'idle' || game.error) return;
    // A challenge carries its own topic — the server reads it off the
    // challenge row — so it is the one way into this screen without one.
    if (challengeId) {
      game.joinQueue(null, { challengeId: String(challengeId) });
      return;
    }
    if (topicId) {
      // The stake travels with the route, so a cold start straight into this
      // screen queues for what the player actually chose rather than the
      // session default. So does the deck, for the same reason.
      game.joinQueue(String(topicId), {
        spaceId: spaceId ? String(spaceId) : undefined,
        mode: mode ? String(mode) : undefined,
        deck: deck ? String(deck) : undefined,
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Lock-on: the globe stops, the satellite takes its shot, the stamp
  // lands, and only then does the versus ceremony take over.
  useEffect(() => {
    if (game.status === 'playing') {
      router.replace('/match/play');
      return undefined;
    }
    /**
     * A rematch that nobody took up puts the last result back in hand. Without
     * this the screen keeps searching for a match that is never coming, since
     * every other exit from here is a match starting.
     */
    if (game.status === 'finished') {
      router.replace('/match/result');
      return undefined;
    }
    if (game.status !== 'found' && game.status !== 'countdown') return undefined;

    if (!found) {
      setFound(true);
      heavy();
      sfx.found();
      Animated.spring(stamp, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }).start();
    }

    /**
     * A solo drill has nobody to introduce, so it skips the ceremony.
     *
     * The versus screen is two faces, two flags and two league badges. With no
     * opponent it would have to invent something to put on the right-hand side,
     * and inventing an opponent for the one mode that has none is exactly the
     * confusion practice exists to avoid. `game.opponent` is null straight from
     * the server, so the branch reads the truth rather than the mode.
     */
    const solo = !game.opponent;
    const onward = setTimeout(
      () => router.replace(solo ? '/match/play' : '/match/versus'),
      reduced ? 400 : solo ? SOLO_HOLD_MS : FOUND_HOLD_MS,
    );
    return () => clearTimeout(onward);
  }, [game.status, game.opponent, found, stamp, reduced, router]);

  const topicName = name ?? game.topic?.topicName ?? game.topic?.name ?? '';
  const search = useSearchBand(game);

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />

      {/**
       * The stage, chosen by what is actually being waited for.
       *
       * A globe is the right object for the open queue and the wrong one
       * everywhere else — see MatchIntro.jsx. Three cases, three pictures, and
       * each of them matches the sentence already printed underneath it.
       */}
      <View style={styles.stage} pointerEvents="none">
        {soloRun ? (
          <SoloDeck
            size={stageSize}
            ready={found}
            reduced={reduced}
            tone={isRevision ? colors.optionC : colors.gold}
          />
        ) : isChallenge ? (
          <ChallengeWait
            size={stageSize}
            me={{ displayName: user?.displayName, avatarUrl: user?.avatarUrl }}
            // Their face comes off the route until the server names them, then
            // off the server — so the picture is right from the first frame and
            // still correct if the caller had no avatar to pass.
            them={{
              displayName: game.opponent?.displayName ?? (opponent ? String(opponent) : null),
              avatarUrl: game.opponent?.avatarUrl ?? (avatarUrl ? String(avatarUrl) : null),
            }}
            ready={found}
            reduced={reduced}
          />
        ) : (
          <Globe size={stageSize} found={found} opponent={game.opponent} reduced={reduced} />
        )}
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]} pointerEvents="box-none">
        <ErrorNotice error={game.error} />

        {found ? (
          <Animated.View
            style={[
              styles.foundWrap,
              { opacity: stamp, transform: [{ scale: stamp.interpolate({ inputRange: [0, 1], outputRange: [1.5, 1] }) }] },
            ]}
          >
            {/**
             * "FOUND ONE!" over a drill would be announcing an opponent that does
             * not exist, and the row beneath it would draw an empty avatar with the
             * word "A rival" under it. A drill has nothing to find — it has a paper
             * that is ready — so it says that instead.
             */}
            <Text allowFontScaling={false} style={styles.foundWord}>
              {soloRun ? 'READY' : 'FOUND ONE!'}
            </Text>
            {soloRun ? (
              <View style={styles.rivalRow}>
                <Text variant="label" color={colors.onColor} numberOfLines={1} style={{ maxWidth: 240 }}>
                  {isRevision
                    ? 'Seven you got wrong'
                    : isSelf
                      ? 'Your best run, played back'
                      : 'Seven questions, no opponent'}
                </Text>
              </View>
            ) : (
              <View style={styles.rivalRow}>
                <Avatar
                  url={game.opponent?.avatarUrl}
                  name={game.opponent?.displayName}
                  size={26}
                  style={styles.rivalFace}
                />
                {/* Their level, not their topic rating — the level is what the
                    queue matched on, and it is what the versus screen is about
                    to show. The rating stays off both. */}
                <Text variant="label" color={colors.onColor} numberOfLines={1} style={{ maxWidth: 220 }}>
                  {game.opponent?.displayName ?? 'A rival'}
                  {Number.isFinite(game.opponent?.level) ? `  ·  Level ${game.opponent.level}` : ''}
                </Text>
              </View>
            )}
          </Animated.View>
        ) : (
          <>
            <Animated.Text
              allowFontScaling={false}
              style={[
                styles.searchWord,
                { opacity: reduced ? 1 : glow.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) },
              ]}
            >
              {/* A challenge is not a search. There is exactly one person this
                  can pair with, the band never widens, and saying "SEARCHING"
                  over a two-person queue would be theatre with nothing behind
                  it — so it names who is being waited for instead. */}
              {soloRun
                ? isRevision
                  ? 'BUILDING YOUR REVISION'
                  : isSelf
                    ? 'RACKING UP YOUR BEST'
                    : 'DEALING YOUR QUESTIONS'
                : isChallenge
                  ? `WAITING FOR ${String(opponent ?? 'YOUR FRIEND').toUpperCase()}`
                  : search?.widening
                    ? 'WIDENING THE SEARCH'
                    : 'SEARCHING FOR OPPONENT'}
            </Animated.Text>
            {/* Topic, then the level range being searched — the two things that
                actually define the query. Without the band the line is just the
                topic, as it was before levels drove pairing. */}
            {topicName || search ? (
              <Text variant="meta" color="rgba(255,255,255,0.45)" style={styles.topicLine} numberOfLines={1}>
                {soloRun
                  ? [
                      topicName,
                      isRevision
                        ? 'the ones you got wrong'
                        : isSelf
                          ? 'against your own best'
                          : 'on your own',
                    ]
                      .filter(Boolean)
                      .join('  ·  ')
                  : isChallenge
                    ? [topicName, 'they have to open the app too'].filter(Boolean).join('  ·  ')
                    : [topicName, search?.label].filter(Boolean).join('  ·  ')}
              </Text>
            ) : null}
            <Button
              variant="onColorSoft"
              size="md"
              label="Cancel"
              fullWidth={false}
              style={styles.cancel}
              onPress={() => {
                game.leaveQueue();
                router.back();
              }}
            />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.night, overflow: 'hidden' },

  /**
   * The globe sits above centre rather than on it. Everything that speaks —
   * the state, the band, the cancel — lives at the bottom, and a hero centred
   * between two blocks of nothing reads as a loading spinner.
   */
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: '18%' },

  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: layout.gutter,
  },
  searchWord: {
    ...type.title,
    fontSize: 17,
    color: GOLD,
    letterSpacing: 3,
    textAlign: 'center',
  },
  topicLine: { marginTop: space.xs, textAlign: 'center' },
  cancel: { marginTop: space.lg, minWidth: 132 },

  foundWrap: { alignItems: 'center', gap: space.md },
  foundWord: {
    ...type.scoreHero,
    fontSize: 38,
    lineHeight: 46,
    color: GOLD,
    letterSpacing: 2,
  },
  rivalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: space.md,
    paddingVertical: 5,
    borderRadius: layout.radiusPill,
  },
  rivalFace: { borderWidth: 2, borderColor: colors.rival },
});

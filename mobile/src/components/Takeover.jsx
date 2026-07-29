import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from './ui.jsx';
import Icon from './Icon.jsx';
import { leagueFor, nextLeagueLabel } from '../lib/league.js';
import { leagueMetal } from './League.jsx';
import { faceSource } from '../lib/avatar.js';
import { bannerSource } from '../lib/banner.js';
import { coins as fmtCoins, rarityTone } from '../lib/rarity.js';
import { colors, fonts, layout, space } from '../theme/index.js';
import { useReducedMotion } from '../lib/motion.js';
import { heavy, success, tap as tapHaptic } from '../lib/haptics.js';
import { sfx } from '../lib/sound.js';

/**
 * The takeover — the full-screen moment for something earned.
 *
 * Everything here used to happen inline on the result screen: the promotion,
 * the account level, the list of unlocks, all cards in a scrolling column next
 * to the Rematch button. The information was right and the staging was wrong.
 * The biggest moment in the game was a row in a list, and a row in a list is
 * how you tell someone something does not matter.
 *
 * So the result screen keeps the receipt and this owns the moment: one thing at
 * a time, full screen, tap to continue.
 *
 * ── The spine ────────────────────────────────────────────────────────────────
 *
 * Every scene is the same four bands, and the middle one is the whole idea:
 *
 *     PROMOTED                ← what happened, in one word
 *     ┌──────────┐
 *     │  BRONZE  │            ← the object, struck and lit
 *     │    II    │
 *     └──────────┘
 *     BRONZE III  ➜  BRONZE II   ← the DELTA, never just the end state
 *     59 to Bronze I             ← and what is next
 *
 * "Account level 12" tells a player nothing they can feel. "11 ➜ 12" is the
 * same fact and it is a story, because it contains the thing they no longer
 * are. Every scene owes that row.
 *
 * ── One object, three tones ──────────────────────────────────────────────────
 *
 * The league plate, the level plate and the unlock chest are the SAME struck
 * plaque, drawn at three tints — the same construction as the league badge and
 * the topic medallion. That is deliberate and it is the whole answer to making
 * this feel expensive without an art pipeline: the references that inspired it
 * are 3D-asset games where the render carries the screen, and imitating that
 * with bevels and neon on flat assets is exactly what reads cheap. Weight comes
 * from scale, timing and one light source, not from gloss.
 *
 * ── Motion ───────────────────────────────────────────────────────────────────
 *
 * One `Animated.Value` per scene, linear, driving every band by interpolation —
 * the same approach as the splash, and the reason all of this runs on the
 * native driver with no spring chains to keep in sync. Overshoot is written
 * into the keyframes rather than sprung.
 */

/** The whole staged sequence. Every constant below is a fraction of it. */
const SHOW_MS = 1500;

/** The chest's own sequence, once the player breaks the seal. */
const OPEN_MS = 1100;

/**
 * Taps are dead for this long.
 *
 * The takeover opens automatically when the result screen finishes counting,
 * and a player whose thumb is already moving would otherwise dismiss the thing
 * before a frame of it registered.
 */
const TAP_DEAD_MS = 600;

const ROMAN = ['I', 'II', 'III'];

/** Tint, rim and ink for a struck plate. The league brings its own metal. */
const ACCENT_TONE = { soft: 'rgba(58, 159, 178, 0.16)', edge: 'rgba(58, 159, 178, 0.36)', ink: colors.accent };
const GOLD_TONE = { soft: 'rgba(245, 182, 46, 0.14)', edge: 'rgba(245, 182, 46, 0.40)', ink: colors.gold };

const PERK_WORD = { avatar: 'Avatar', banner: 'Banner', title: 'Title' };

/**
 * @param {object} props
 * @param {Array} props.events  ordered scenes; see `eventsFromResult`
 * @param {Function} props.onDone  called once, after the last scene is dismissed
 */
export default function Takeover({ events, onDone }) {
  const [index, setIndex] = useState(0);
  const finished = useRef(false);

  const done = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onDone?.();
  }, [onDone]);

  useEffect(() => {
    if (index >= (events?.length ?? 0)) done();
  }, [index, events, done]);

  if (!events?.length || index >= events.length) return null;

  return (
    /**
     * Keyed on the index so every scene mounts fresh.
     *
     * Without it the second scene would inherit the first one's finished
     * animation values and simply appear, which is the one thing a sequence of
     * reveals cannot do.
     */
    <Scene
      key={index}
      event={events[index]}
      step={index + 1}
      total={events.length}
      onNext={() => setIndex((i) => i + 1)}
    />
  );
}

function Scene({ event, step, total, onNext }) {
  const reduced = useReducedMotion();
  const drive = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const open = useRef(new Animated.Value(0)).current;
  const [ready, setReady] = useState(reduced);
  const [opened, setOpened] = useState(false);
  const cued = useRef(false);

  // A perk arrives sealed: the player opens it, and only then may they leave.
  const sealed = event.kind === 'perk' || event.kind === 'chest';
  const canLeave = ready && (!sealed || opened);

  useEffect(() => {
    if (!cued.current) {
      cued.current = true;
      if (event.kind === 'league') {
        heavy();
        sfx.found();
      } else if (event.kind === 'level' || event.kind === 'coins') {
        success();
        sfx.correct();
      } else {
        sfx.reveal();
      }
    }

    if (reduced) {
      drive.setValue(1);
      setReady(true);
      return undefined;
    }

    const anim = Animated.timing(drive, {
      toValue: 1,
      duration: SHOW_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    anim.start();
    const t = setTimeout(() => setReady(true), TAP_DEAD_MS);
    return () => {
      anim.stop();
      clearTimeout(t);
    };
  }, [drive, reduced, event.kind]);

  const onOpen = useCallback(() => {
    if (opened) return;
    setOpened(true);
    success();
    sfx.win();
    if (reduced) {
      open.setValue(1);
      return;
    }
    /**
     * Linear, and longer than the old 620ms fade.
     *
     * Linear for the reason the scene driver is linear: the chest's beats —
     * brace, lock, hinge, light, rise, settle — carry their own easing in
     * their keyframes, and an eased driver would squash the last three
     * together. 1100ms is what six beats need to read as six; below about
     * 900 the lid and the reward arrive at once and it collapses back into a
     * fade.
     */
    Animated.timing(open, {
      toValue: 1,
      duration: OPEN_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [opened, open, reduced]);

  const onPress = useCallback(() => {
    if (sealed && !opened) {
      onOpen();
      return;
    }
    if (!canLeave) return;
    tapHaptic();
    onNext();
  }, [sealed, opened, canLeave, onOpen, onNext]);

  // ── The bands, in the order they arrive ──────────────────────────────────
  const band = (from, to, dy = 10) => ({
    opacity: drive.interpolate({ inputRange: [from, to], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [
      { translateY: drive.interpolate({ inputRange: [from, to], outputRange: [dy, 0], extrapolate: 'clamp' }) },
    ],
  });

  const tone = toneFor(event);

  return (
    <Pressable
      style={styles.root}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={labelFor(event)}
      accessibilityHint={sealed && !opened ? 'Opens the reward' : 'Continues'}
    >
      {/* The one light source, running the full width so it has no side edge —
          the mistake the welcome screen's old halo made was having a rim. */}
      <Animated.View
        style={[styles.glowWrap, { opacity: drive.interpolate({ inputRange: [0, 0.2], outputRange: [0, 1], extrapolate: 'clamp' }) }]}
        pointerEvents="none"
      >
        <LinearGradient
          colors={['rgba(0,0,0,0)', tone.soft, 'rgba(0,0,0,0)']}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <View style={styles.body}>
        <Animated.View style={band(0.06, 0.22, -8)}>
          <Text allowFontScaling={false} style={[styles.eyebrow, { color: tone.ink }]}>
            {eyebrowFor(event)}
          </Text>
        </Animated.View>

        <View style={styles.stage}>
          {/* The strike — a ring rolling off the impact, then gone. */}
          {!reduced ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.strike,
                {
                  borderColor: tone.edge,
                  opacity: drive.interpolate({
                    inputRange: [0.12, 0.2, 0.52],
                    outputRange: [0, 0.55, 0],
                    extrapolate: 'clamp',
                  }),
                  transform: [
                    {
                      scale: drive.interpolate({
                        inputRange: [0.12, 0.52],
                        outputRange: [0.66, 2.1],
                        extrapolate: 'clamp',
                      }),
                    },
                  ],
                },
              ]}
            />
          ) : null}

          <Animated.View
            style={{
              opacity: drive.interpolate({ inputRange: [0.1, 0.24], outputRange: [0, 1], extrapolate: 'clamp' }),
              transform: [
                {
                  /**
                   * Overshoot in the keyframes, not a spring — one linear
                   * driver stays in step with every other band.
                   *
                   * Deliberately gentle now. The plate carries its own
                   * entrance (it turns over), so a hard 0.62→1.08 punch here
                   * fought it: two entrances on one object read as a stutter.
                   * This only gives the flip somewhere to land.
                   */
                  scale: drive.interpolate({
                    inputRange: [0.1, 0.28, 0.38, 0.44],
                    outputRange: [0.88, 1.04, 0.99, 1],
                    extrapolate: 'clamp',
                  }),
                },
              ],
            }}
          >
            <Hero event={event} tone={tone} drive={drive} open={open} opened={opened} reduced={reduced} />
          </Animated.View>
        </View>

        <Delta event={event} tone={tone} drive={drive} />

        {captionFor(event) ? (
          <Animated.View style={band(0.68, 0.84)}>
            <Text variant="meta" color={colors.inkMuted} style={styles.caption}>
              {captionFor(event)}
            </Text>
          </Animated.View>
        ) : null}
      </View>

      <View style={styles.foot}>
        {total > 1 ? (
          <Animated.View style={[styles.pips, band(0.7, 0.86, 0)]}>
            {Array.from({ length: total }, (_, i) => (
              <View
                key={i}
                style={[
                  styles.pip,
                  i < step ? { backgroundColor: tone.ink } : null,
                  i === step - 1 ? styles.pipNow : null,
                ]}
              />
            ))}
          </Animated.View>
        ) : null}

        <Animated.View style={band(0.78, 0.94, 6)}>
          <Text variant="meta" color={colors.inkFaint}>
            {sealed && !opened ? 'Tap to open' : 'Tap to continue'}
          </Text>
        </Animated.View>
      </View>
    </Pressable>
  );
}

// ── The heroes. One plate, three tones. ─────────────────────────────────────

function Hero({ event, tone, drive, open, opened, reduced }) {
  if (event.kind === 'league') {
    const league = leagueFor(event.after);
    return (
      <Plate tone={tone} drive={drive} reduced={reduced}>
        <Text allowFontScaling={false} style={[styles.plateName, { color: tone.ink }]}>
          {league.name.toUpperCase()}
        </Text>
        {!league.isTop ? (
          <>
            <View style={[styles.plateRule, { backgroundColor: tone.edge }]} />
            <Text allowFontScaling={false} style={[styles.plateBig, { color: tone.ink }]}>
              {ROMAN[league.division - 1]}
            </Text>
          </>
        ) : null}
      </Plate>
    );
  }

  if (event.kind === 'level') {
    return (
      <Plate tone={tone} drive={drive} reduced={reduced}>
        <Text allowFontScaling={false} style={[styles.plateName, { color: tone.ink }]}>
          LEVEL
        </Text>
        <View style={[styles.plateRule, { backgroundColor: tone.edge }]} />
        <Text allowFontScaling={false} style={[styles.plateBig, { color: tone.ink }]}>
          {event.after}
        </Text>
      </Plate>
    );
  }

  /**
   * Coins get the same struck plate as a level, and that is the point of them
   * having one at all: money earned is an achievement in this app, not a
   * transaction, so it is staged as one. The plus sign is part of the number
   * because "+300" is the event and "300" is only a fact.
   */
  if (event.kind === 'coins') {
    return (
      <Plate tone={tone} drive={drive} reduced={reduced}>
        <View style={styles.coinMark}>
          <Icon name="sparkle" size={17} color={tone.ink} />
          <Text allowFontScaling={false} style={[styles.plateName, { color: tone.ink }]}>
            COINS
          </Text>
        </View>
        <View style={[styles.plateRule, { backgroundColor: tone.edge }]} />
        <Text allowFontScaling={false} style={[styles.plateCoins, { color: tone.ink }]}>
          +{fmtCoins(event.amount)}
        </Text>
      </Plate>
    );
  }

  return (
    <Chest
      perk={event.perk}
      tone={tone}
      open={open}
      opened={opened}
      reduced={reduced}
    />
  );
}

/**
 * The struck plaque every plate hero is made of.
 *
 * It TURNS OVER rather than merely appearing. A level and a promotion are both
 * a card being dealt face-up, and the flip is the only motion that says so —
 * the plate used to scale in from 62%, which is the same gesture a modal makes
 * and therefore said nothing about what it was. Rotation is about the vertical
 * axis with perspective in front of it, so the plate has a near edge and a far
 * edge and reads as a physical object rather than a growing rectangle.
 *
 * Then the light crosses it. That is the whole reason the plate is struck metal
 * in the first place: a bevel only exists when something moves across it. The
 * sheen runs ONCE, after the flip settles, and never returns — a plate that
 * glints on a loop is a slot machine.
 */
function Plate({ tone, drive, reduced, children, style }) {
  /**
   * Overshoot lives in the keyframes, as everywhere else here: past square at
   * 8°, back through -3°, and settled. A spring would need its own driver and
   * would drift out of step with the delta row underneath it.
   */
  const spin = reduced
    ? '0deg'
    : drive.interpolate({
        inputRange: [0.1, 0.28, 0.37, 0.44],
        outputRange: ['-86deg', '9deg', '-3deg', '0deg'],
        extrapolate: 'clamp',
      });

  const sheenX = drive.interpolate({
    inputRange: [0.44, 0.66],
    outputRange: [-PLATE_W * 1.2, PLATE_W * 1.2],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      style={[
        styles.plate,
        { backgroundColor: tone.soft, borderColor: tone.edge },
        { transform: [{ perspective: 900 }, { rotateY: spin }] },
        style,
      ]}
    >
      {children}

      {!reduced ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.sheen,
            {
              opacity: drive.interpolate({
                inputRange: [0.44, 0.48, 0.62, 0.66],
                outputRange: [0, 1, 1, 0],
                extrapolate: 'clamp',
              }),
              transform: [{ rotate: '16deg' }, { translateX: sheenX }],
            },
          ]}
        >
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/**
 * The chest.
 *
 * It opens as a REVEAL, never as a gamble. What a level hands over is fixed —
 * `perksBetween` is pure, and the rewards screen already lists every locked
 * item beside the exact level that opens it — so dressing a known reward as a
 * loot box would teach the player within three opens that the animation is
 * theatre. Worse, it would put the grammar of a paid mechanic on something
 * nobody paid for. The drama here is "look what I earned", not "what did I
 * get", and that is a promise the app can actually keep.
 *
 * The lid parts rather than fading, because a thing that opens has to move.
 */
function Chest({ perk, tone, open, opened, reduced }) {
  /**
   * The beats, as fractions of `open`. Written down because six things have to
   * agree on them, and a magic number repeated six times is six chances to
   * drift:
   *
   *   0.00–0.10  the chest braces — squashes down, the way anything does
   *              before it springs
   *   0.08–0.20  the lock lets go and the seam lights
   *   0.12–0.55  the lid swings back on its hinge
   *   0.18–0.60  the light from inside opens out
   *   0.30–0.85  the reward rises out and settles
   *   0.55–1.00  the chest dims, so the reward owns the frame
   */
  const at = (from, to, out) =>
    open.interpolate({ inputRange: [from, to], outputRange: out, extrapolate: 'clamp' });

  /** The brace. Only a few points of squash — any more reads as a wobble. */
  const braceY = open.interpolate({
    inputRange: [0, 0.06, 0.14],
    outputRange: [1, 1.06, 1],
    extrapolate: 'clamp',
  });

  /**
   * The lid, hinged along its own bottom edge — where a real chest's hinge is,
   * at the back of the rim. `transformOrigin` does the pivot (RN 0.76+), and
   * the perspective in front of the rotation is what stops it reading as a
   * rectangle being squashed vertically.
   *
   * It stops at 62°, well short of flat. Past 90° the lid crosses edge-on and
   * comes back showing its own front face mirrored, which is the moment the
   * illusion dies; and even at 80 it is so foreshortened there is nothing left
   * to look at. Leaning back to 62 is what a chest looks like in every drawing
   * of one — open, and still an object.
   */
  const lidTransform = [
    { perspective: 620 },
    {
      rotateX: reduced
        ? '62deg'
        : open.interpolate({
            inputRange: [0.12, 0.4, 0.5, 0.58],
            outputRange: ['0deg', '70deg', '58deg', '62deg'],
            extrapolate: 'clamp',
          }),
    },
  ];

  return (
    <View style={styles.chestWrap}>
      {/* ── The light from inside, opening out behind everything. */}
      {!reduced ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.chestBeam,
            {
              opacity: at(0.18, 0.34, [0, 1]),
              transform: [{ scaleY: at(0.18, 0.6, [0.2, 1]) }, { scaleX: at(0.18, 0.6, [0.5, 1]) }],
            },
          ]}
        >
          {/* Brightest at the bottom, where the chest is, fading upward — the
              light has a source, which is the whole difference between a glow
              and a gradient someone added. */}
          <LinearGradient
            colors={['rgba(0,0,0,0)', tone.soft]}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}

      {/* ── The reward, rising out of the open chest and settling above it. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.chestItem,
          {
            opacity: at(0.3, 0.42, [0, 1]),
            /**
             * Up and out, overshooting a little before it settles — the arc of
             * something buoyant leaving a box, rather than a lift.
             */
            transform: [
              { translateY: at(0.3, 0.74, [CHEST_BODY_H, 0]) },
              { scale: at(0.3, 0.66, [0.4, 1]) },
            ],
          },
        ]}
      >
        <PerkFace perk={perk} tone={tone} size={70} />
      </Animated.View>

      {/* ── Sparks off the seal. Six, thrown once, gone by 0.7 — the whole
          budget for "excessive motion" is spent here rather than sprinkled
          across the scene. */}
      {!reduced && opened
        ? SPARKS.map((sp) => (
            <Animated.View
              key={sp.r}
              pointerEvents="none"
              style={[
                styles.spark,
                {
                  backgroundColor: tone.ink,
                  opacity: at(0.1, 0.24, [0, 0.9]),
                  transform: [
                    { rotate: `${sp.r}deg` },
                    { translateY: at(0.1, 0.7, [0, -sp.d]) },
                    { scale: at(0.4, 0.7, [1, 0]) },
                  ],
                },
              ]}
            />
          ))
        : null}

      {/* ── The chest itself. It STAYS: the lid hinges back and the trunk keeps
          holding the reward. The old one faded both halves out entirely, which
          is why it never read as a chest — a container that vanishes at the
          moment of opening was only ever two rectangles. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.chestStage, { transform: [{ scaleY: braceY }] }]}
      >
        {/* ── The trunk. Solid, banded, and dark inside. */}
        <View style={styles.chestBody}>
          {/* The mouth — the inside of the box, revealed as the lid leaves.
              Drawn first so the bands and the rim sit over it. */}
          <Animated.View style={[styles.chestMouth, { opacity: at(0.12, 0.4, [0, 1]) }]} />

          {/* Two bands down the trunk, in the scene's metal. */}
          <View style={[styles.chestStrap, styles.chestStrapLeft, { backgroundColor: tone.ink }]} />
          <View style={[styles.chestStrap, styles.chestStrapRight, { backgroundColor: tone.ink }]} />

          {/* The lip: the rim the lid closes onto, and the brightest edge on
              the object because it is the one facing the light. */}
          <View style={[styles.chestRim, { backgroundColor: tone.ink }]} />

          {/* Feet, so it sits on something rather than floating. */}
          <View style={[styles.chestFoot, styles.chestFootLeft]} />
          <View style={[styles.chestFoot, styles.chestFootRight]} />
        </View>

        {/* ── The lock, which lets go before anything else moves. */}
        <Animated.View
          style={[
            styles.chestLock,
            {
              backgroundColor: tone.ink,
              opacity: at(0.08, 0.22, [1, 0]),
              transform: [
                { scale: at(0.08, 0.22, [1, 1.6]) },
                { translateY: at(0.08, 0.22, [0, 10]) },
              ],
            },
          ]}
        >
          <View style={styles.chestKeyhole} />
        </Animated.View>

        {/* ── The lid: arched, lit from above, banded to meet the trunk. */}
        <Animated.View style={[styles.chestLid, { transform: lidTransform }]}>
          <LinearGradient
            colors={[CHEST_LID, CHEST_TRUNK]}
            style={styles.chestLidFace}
          >
            <View style={[styles.chestLidStrap, styles.chestStrapLeft, { backgroundColor: tone.ink }]} />
            <View style={[styles.chestLidStrap, styles.chestStrapRight, { backgroundColor: tone.ink }]} />
            {/* The highlight along the crown — the one specular line. */}
            <View style={styles.chestCrown} />
          </LinearGradient>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/**
 * What came out: a face, a banner swatch, a pile of coins, or a name.
 *
 * The ring is drawn in the tier's colour and thickens with it — a legendary
 * arrives wearing something a common never does, so the tier registers before
 * the face is even identified. It is not the only signal; the eyebrow says the
 * tier in words directly above.
 */
function PerkFace({ perk, tone, size = 104 }) {
  const face = { width: size, height: size, borderRadius: size / 2 };
  const ring = {
    ...face,
    borderWidth: (tone.ring ?? 1) * 2,
    borderColor: tone.edge,
    overflow: 'hidden',
  };

  if (perk.type === 'coins') {
    return (
      <View style={[styles.coinPile, { backgroundColor: tone.soft, borderColor: tone.edge }]}>
        <Text allowFontScaling={false} style={[styles.coinPileText, { color: tone.ink }]}>
          +{fmtCoins(perk.amount)}
        </Text>
      </View>
    );
  }
  if (perk.type === 'avatar' && faceSource(perk.key)) {
    return (
      <View style={ring}>
        <Image source={faceSource(perk.key)} style={face} resizeMode="cover" />
      </View>
    );
  }
  if (perk.type === 'banner' && bannerSource(perk.key)) {
    return (
      <View style={ring}>
        <Image source={bannerSource(perk.key)} style={face} resizeMode="cover" />
      </View>
    );
  }
  return (
    <View style={[styles.perkTitle, { borderColor: tone.edge, backgroundColor: tone.soft }]}>
      <Text allowFontScaling={false} style={[styles.perkTitleText, { color: tone.ink }]} numberOfLines={2}>
        {perk.name}
      </Text>
    </View>
  );
}

/**
 * The before → after row.
 *
 * The old value stays on screen, muted, because a number you have left behind
 * is what gives the new one its size.
 */
function Delta({ event, tone, drive }) {
  const pair = deltaFor(event);
  if (!pair) return null;

  const at = (from, to, dx = 0) => ({
    opacity: drive.interpolate({ inputRange: [from, to], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [
      { translateX: drive.interpolate({ inputRange: [from, to], outputRange: [dx, 0], extrapolate: 'clamp' }) },
    ],
  });

  return (
    <View style={styles.delta}>
      <Animated.View style={at(0.4, 0.52)}>
        <Text allowFontScaling={false} style={styles.deltaBefore}>
          {pair.before}
        </Text>
      </Animated.View>

      <Animated.View style={at(0.5, 0.6, -10)}>
        <Icon name="arrowRight" size={20} color={colors.inkFaint} />
      </Animated.View>

      <Animated.View
        style={{
          opacity: drive.interpolate({ inputRange: [0.56, 0.64], outputRange: [0, 1], extrapolate: 'clamp' }),
          transform: [
            {
              scale: drive.interpolate({
                inputRange: [0.56, 0.68, 0.76],
                outputRange: [0.6, 1.12, 1],
                extrapolate: 'clamp',
              }),
            },
          ],
        }}
      >
        <Text allowFontScaling={false} style={[styles.deltaAfter, { color: tone.ink }]}>
          {pair.after}
        </Text>
      </Animated.View>
    </View>
  );
}

// ── What each kind says ─────────────────────────────────────────────────────

function toneFor(event) {
  if (event.kind === 'league') {
    const after = leagueFor(event.after);
    const metal = leagueMetal(after.key, after.color);
    return { soft: metal.soft, edge: metal.edge, ink: metal.ink };
  }
  if (event.kind === 'level') return ACCENT_TONE;
  if (event.kind === 'coins') return GOLD_TONE;

  /**
   * A drop wears its own tier, so the whole screen — the light behind it, the
   * ring around it, the number under it — turns the colour of what was won. A
   * legendary arriving in the same gold as an ordinary unlock would be the one
   * moment the app had a chance to say "this is different" and did not.
   */
  const tone = rarityTone(event.perk?.rarity, event.rarities);
  if (!event.perk?.rarity) return GOLD_TONE;
  return { soft: tone.soft, edge: tone.edge, ink: tone.ink, ring: tone.ring };
}

function eyebrowFor(event) {
  if (event.kind === 'league') return 'PROMOTED';
  if (event.kind === 'level') return 'LEVEL UP';
  if (event.kind === 'coins') return 'EARNED';
  if (event.kind === 'chest') {
    if (event.perk?.type === 'coins') return 'COINS';
    // The tier, in words, above the object it belongs to — so the colour is
    // never the only thing carrying it.
    return (rarityTone(event.perk?.rarity, event.rarities).name ?? 'REWARD').toUpperCase();
  }
  return 'UNLOCKED';
}

function deltaFor(event) {
  if (event.kind === 'league') {
    return { before: leagueFor(event.before).label.toUpperCase(), after: leagueFor(event.after).label.toUpperCase() };
  }
  if (event.kind === 'level') return { before: String(event.before), after: String(event.after) };
  // A balance is a before and an after like any other number, and showing both
  // is what turns "you have 1,450 coins" into "you earned 300".
  if (event.kind === 'coins' && event.before != null) {
    return { before: fmtCoins(event.before), after: fmtCoins(event.before + event.amount) };
  }
  return null;
}

function captionFor(event) {
  if (event.kind === 'league') {
    const league = leagueFor(event.after);
    if (league.isTop) return 'Top of the ladder. Nothing above this.';
    return `${league.pointsForNext} to ${nextLabel(league)}`;
  }
  if (event.kind === 'level') {
    // What is next comes from the server with the result — the ladder is
    // configuration, so a client cannot work it out from a table of its own.
    const next = event.next;
    return next ? `Level ${next.unlockLevel} opens ${next.name}` : 'Everything is yours.';
  }
  if (event.kind === 'coins') return event.reason ?? 'Spend them in the Shop.';
  if (event.kind === 'chest') {
    if (event.perk?.type === 'coins') return 'Straight into your balance.';
    // A duplicate has to say so plainly. Quietly paying coins for something a
    // player already owns and calling it a win is the sort of thing that gets
    // noticed once and distrusted for ever.
    if (event.duplicate) {
      return `You already had it — paid ${fmtCoins(event.coinsAwarded)} coins instead.`;
    }
    return `${PERK_WORD[event.perk?.type] ?? 'Reward'} · wear it from the Shop`;
  }
  return `${PERK_WORD[event.perk.type] ?? 'Reward'} · wear it from the Shop`;
}

function labelFor(event) {
  if (event.kind === 'league') return `Promoted to ${leagueFor(event.after).label}`;
  if (event.kind === 'level') return `Account level ${event.after}`;
  if (event.kind === 'coins') return `${event.amount} coins earned`;
  if (event.perk?.type === 'coins') return `${event.perk.amount} coins from a chest`;
  return `${event.perk.name} unlocked`;
}

/** Mirrors League.jsx — what sits one step up, per the served ladder. */
function nextLabel(league) {
  if (league.division > 1) return `${league.name} ${ROMAN[league.division - 2]}`;
  return nextLeagueLabel(league);
}

/**
 * Turn a match result into the scenes it earned, in the order they matter.
 *
 * Topic level-ups are deliberately NOT here. They land on nearly every match,
 * and a celebration that fires every time is not a celebration — it is a step
 * between the player and the rematch button. It stays a footnote on the result.
 */
export function eventsFromResult(result, { promoted, rarities } = {}) {
  const events = [];
  if (!result) return events;

  if (promoted) {
    const after = result.rankedAfter ?? result.ratingAfter ?? 0;
    const before = result.rankedBefore ?? result.ratingBefore ?? after;
    events.push({ kind: 'league', before, after });
  }

  if (result.accountLevelUp && result.accountLevel != null) {
    events.push({
      kind: 'level',
      before: result.accountLevelBefore ?? result.accountLevel - 1,
      after: result.accountLevel,
      next: result.nextUnlock ?? null,
    });
  }

  /**
   * Coins get a scene only when the match paid MORE than the flat rate for
   * playing it — a level, a promotion, or both.
   *
   * Fifty coins for a win is wallpaper: it happens every single match, and a
   * full-screen celebration that fires every match is not a celebration, it is
   * a step between the player and the rematch button. The same argument this
   * file already makes for topic level-ups.
   */
  const bonus = (result.coinsEarned ?? 0) - (result.coinsFromMatch ?? 0);
  if (bonus > 0) {
    events.push({
      kind: 'coins',
      amount: result.coinsEarned ?? 0,
      before: result.coins != null ? result.coins - (result.coinsEarned ?? 0) : null,
      reason: result.promotion
        ? `${result.promotion.label} · spend them in the Shop`
        : 'Spend them in the Shop.',
    });
  }

  for (const perk of Array.isArray(result.unlocked) ? result.unlocked : []) {
    if (perk?.key) events.push({ kind: 'perk', perk, rarities });
  }

  return events;
}

/**
 * The scene for one opened chest.
 *
 * Unlike a level unlock — which is a REVEAL of something already decided and
 * already listed on the shelf — this one genuinely is a draw, and the animation
 * is honest about it: the server rolled before the lid moved, and what comes out
 * is what came out. The distinction matters. Dressing a known reward as a loot
 * box teaches a player within three opens that the theatre is a lie; dressing a
 * real draw as one is simply what it is.
 */
export function eventFromChest(chest, { rarities } = {}) {
  if (!chest?.drawn) return [];
  return [
    {
      kind: 'chest',
      perk: chest.drawn,
      duplicate: Boolean(chest.duplicate),
      coinsAwarded: chest.coinsAwarded ?? 0,
      rarities,
    },
  ];
}

const PLATE_W = 168;
const PLATE_H = 148;

/**
 * The chest's own geometry. The trunk sits on the floor of the plate-sized
 * stage and the lid rests on its rim, which leaves the top third empty — that
 * space is not spare, it is where the reward rises to.
 */
const CHEST_W = 118;
const CHEST_BODY_H = 60;
const CHEST_LID_H = 40;

/**
 * The chest is SOLID, and that is the entire fix.
 *
 * It was built out of `tone.soft` — a 14% tint — so on the night field it was
 * a faint outline with nothing inside it. A tint works for the plate, which is
 * a large flat shape carrying type, and fails completely for a small object
 * that has to read as having volume. Wood is opaque. So these are solid values,
 * lit from above (`LID` lighter than `TRUNK`, `SHADOW` under the rim), and the
 * only thing that takes the scene's colour is the metal — the bands, the rim
 * and the lock, in `tone.ink` at full strength. One light source, one accent.
 */
const CHEST_LID = '#453C5E';
const CHEST_TRUNK = '#332C48';
const CHEST_TRUNK_DEEP = '#241F33';
const CHEST_SHADOW = 'rgba(0,0,0,0.42)';

/** Six sparks off the seal: angle around the chest, and how far each is thrown. */
const SPARKS = [
  { r: -68, d: 92 },
  { r: -34, d: 74 },
  { r: -12, d: 100 },
  { r: 12, d: 86 },
  { r: 34, d: 70 },
  { r: 68, d: 96 },
];

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.night,
    zIndex: 60,
    elevation: 60,
    justifyContent: 'space-between',
    paddingHorizontal: layout.gutter,
  },
  glowWrap: { position: 'absolute', left: 0, right: 0, top: '14%', height: '52%' },

  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl },
  eyebrow: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 3.4,
    includeFontPadding: false,
  },

  stage: { alignItems: 'center', justifyContent: 'center' },
  /**
   * Centred by half-offsets, not by the parent.
   *
   * An absolutely positioned child does not inherit `alignItems` or
   * `justifyContent` — it falls back to its static position, which for both
   * the stage and the chest is the top-left corner. The ring would have
   * expanded out of the corner rather than off the plate.
   */
  strike: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -PLATE_W / 2,
    marginLeft: -PLATE_W / 2,
    width: PLATE_W,
    height: PLATE_W,
    borderRadius: PLATE_W / 2,
    borderWidth: 2,
  },

  plate: {
    width: PLATE_W,
    height: PLATE_H,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    /** So the sheen is clipped to the plate's own face. */
    overflow: 'hidden',
  },
  /** A band of light wider than it needs to be, so the ends never show. */
  sheen: {
    position: 'absolute',
    top: -PLATE_H,
    bottom: -PLATE_H,
    width: PLATE_W * 0.42,
  },
  plateName: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 2.2,
    includeFontPadding: false,
  },
  plateRule: { width: 42, height: 1 },
  plateBig: {
    fontFamily: fonts.display,
    fontSize: 52,
    lineHeight: 60,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },

  chestWrap: { width: PLATE_W, height: PLATE_H, alignItems: 'center', justifyContent: 'flex-end' },

  /** The trunk and its lid, anchored to the floor of the wrap. */
  chestStage: { width: CHEST_W, height: CHEST_BODY_H, alignItems: 'center' },
  chestBody: {
    position: 'absolute',
    bottom: 0,
    width: CHEST_W,
    height: CHEST_BODY_H,
    borderRadius: 8,
    backgroundColor: CHEST_TRUNK,
    overflow: 'hidden',
  },
  /** Two bands down the object, continuous from lid to trunk. */
  chestStrap: { position: 'absolute', top: 0, bottom: 0, width: 8 },
  chestLidStrap: { position: 'absolute', top: 0, bottom: 0, width: 8 },
  chestStrapLeft: { left: CHEST_W * 0.19 },
  chestStrapRight: { right: CHEST_W * 0.19 },
  /**
   * The lip of the trunk, and the brightest edge on the whole object — it is
   * the face pointing at the light, and it is what makes the lid look like it
   * came OFF something rather than out of nowhere.
   */
  chestRim: { position: 'absolute', top: 0, left: 0, right: 0, height: 7 },
  /** Depth inside the trunk, under the rim. */
  chestMouth: {
    position: 'absolute',
    top: 7,
    left: 0,
    right: 0,
    height: 18,
    backgroundColor: CHEST_TRUNK_DEEP,
    borderBottomWidth: 6,
    borderBottomColor: CHEST_SHADOW,
  },
  chestFoot: {
    position: 'absolute',
    bottom: 0,
    width: 14,
    height: 7,
    backgroundColor: CHEST_TRUNK_DEEP,
  },
  chestFootLeft: { left: 8 },
  chestFootRight: { right: 8 },
  /** The catch on the front rim, straddling the seam. */
  chestLock: {
    position: 'absolute',
    bottom: CHEST_BODY_H - 13,
    width: 24,
    height: 20,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chestKeyhole: {
    width: 5,
    height: 8,
    borderRadius: 2,
    backgroundColor: CHEST_TRUNK_DEEP,
  },
  /**
   * The lid, pivoting on its own bottom edge — the hinge line at the back of
   * the rim. `transformOrigin` is what makes it swing rather than tumble about
   * its middle, and it is why this reads as a chest at all.
   */
  chestLid: {
    position: 'absolute',
    bottom: CHEST_BODY_H - 3,
    width: CHEST_W,
    height: CHEST_LID_H,
    transformOrigin: 'center bottom',
  },
  chestLidFace: {
    flex: 1,
    /** Arched: a barrel top, which is what makes it a chest and not a box. */
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    overflow: 'hidden',
  },
  /** One specular line along the crown. */
  chestCrown: {
    position: 'absolute',
    top: 3,
    left: 16,
    right: 16,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },

  /**
   * What was inside — it rises out and comes to rest just clear of the rim.
   * Drawn BEFORE the chest in the tree, so the trunk paints over it and the
   * reward genuinely emerges from behind rather than fading in on top.
   */
  chestItem: {
    /**
     * Clear of the open lid. The lid leans back to 62°, so it still stands
     * about 19pt proud of the rim — resting the reward on the rim itself would
     * bury a quarter of it behind the very thing that just opened.
     */
    position: 'absolute',
    bottom: CHEST_BODY_H + 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The light out of the trunk, widening as the lid clears it. */
  chestBeam: {
    position: 'absolute',
    bottom: CHEST_BODY_H * 0.5,
    width: CHEST_W * 1.5,
    height: 112,
  },
  spark: { position: 'absolute', bottom: CHEST_BODY_H, width: 3, height: 12, borderRadius: 2 },

  perkTitle: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: PLATE_W,
  },
  perkTitleText: {
    fontFamily: fonts.display,
    fontSize: 19,
    lineHeight: 25,
    textAlign: 'center',
    includeFontPadding: false,
  },

  /** The coin plate: a mark, a rule, and the amount — a level plate's spine. */
  coinMark: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  plateCoins: {
    fontFamily: fonts.display,
    fontSize: 40,
    lineHeight: 48,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  /**
   * Coins out of a chest are not a face, so they are drawn as the one thing
   * they are: a number, large, on the tier's fill. Sized to the same 70pt disc
   * the faces occupy so the reward always rises to the same place.
   */
  coinPile: {
    minWidth: 96,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coinPileText: {
    fontFamily: fonts.display,
    fontSize: 26,
    lineHeight: 32,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },

  delta: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 40 },
  deltaBefore: {
    fontFamily: fonts.semibold,
    fontSize: 17,
    lineHeight: 24,
    color: colors.inkFaint,
    letterSpacing: 0.6,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  deltaAfter: {
    fontFamily: fonts.display,
    fontSize: 27,
    lineHeight: 34,
    letterSpacing: 0.4,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  caption: { textAlign: 'center' },

  foot: { alignItems: 'center', gap: space.md, paddingBottom: space.huge },
  pips: { flexDirection: 'row', gap: 6 },
  pip: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.hairline },
  pipNow: { width: 16 },
});

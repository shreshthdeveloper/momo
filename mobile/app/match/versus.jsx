import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useGame } from '../../src/state/game.jsx';
import { Text, Avatar } from '../../src/components/ui.jsx';
import { LeagueBadge } from '../../src/components/League.jsx';
import { resolveBanner } from '../../src/lib/banner.js';
import { flagEmoji, countryName } from '../../src/lib/country.js';
import { colors, layout, space, type } from '../../src/theme/index.js';
import { useReducedMotion } from '../../src/lib/motion.js';

/**
 * design.md §8.5 — versus, staged the way QuizUp staged it: the screen IS the
 * two players. Your half of the screen wears YOUR banner, theirs wears
 * theirs; the halves slam together from the top and bottom edges, and the
 * seam where they meet takes the gold line and the VS coin, sparks flying.
 *
 * Identity per half: name, league, and where they play from — flag and all.
 * The banner doing the background work is what makes every match feel like
 * two actual people rather than two rows of the same purple.
 *
 * prd.md F6.7.5 — nothing here reveals whether the opponent is a ghost.
 */
const SPARKS = [
  { x: -52, y: -34, size: 7 },
  { x: 48, y: -46, size: 5 },
  { x: 62, y: 18, size: 6 },
  { x: -44, y: 40, size: 5 },
  { x: 10, y: -62, size: 4 },
  { x: -14, y: 58, size: 6 },
];

/** The achievement voice, from the palette — see `colors.gold`. */
const GOLD = colors.gold;

export default function Versus() {
  const game = useGame();
  const router = useRouter();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [count, setCount] = useState(null);

  const top = useRef(new Animated.Value(-1)).current;
  const bottom = useRef(new Animated.Value(1)).current;
  const strike = useRef(new Animated.Value(0)).current;
  const sparks = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const beat = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduced) {
      top.setValue(0);
      bottom.setValue(0);
      strike.setValue(1);
      return;
    }
    Animated.sequence([
      // The halves slam together…
      Animated.parallel([
        Animated.spring(top, { toValue: 0, friction: 8, tension: 46, useNativeDriver: true }),
        Animated.spring(bottom, { toValue: 0, friction: 8, tension: 46, useNativeDriver: true }),
      ]),
      // …and the seam lands where they meet: line, coin, sparks, one white frame.
      Animated.parallel([
        Animated.spring(strike, { toValue: 1, friction: 6, tension: 130, useNativeDriver: true }),
        Animated.timing(sparks, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(flash, { toValue: 0.25, duration: 60, useNativeDriver: true }),
          Animated.timing(flash, { toValue: 0, duration: 240, useNativeDriver: true }),
        ]),
      ]),
    ]).start();
  }, [top, bottom, strike, sparks, flash, reduced]);

  // The count reads the SERVER's clock, not a local 3-2-1 — the ceremony
  // holds for exactly as long as the countdown the match engine granted it.
  useEffect(() => {
    const tick = () => {
      if (!game.startsAt) return;
      const serverNow = Date.now() - game.serverOffsetMs;
      setCount(Math.max(0, Math.ceil((game.startsAt - serverNow) / 1000)));
    };
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [game.startsAt, game.serverOffsetMs]);

  useEffect(() => {
    if (reduced || count === null) return;
    beat.setValue(1.35);
    Animated.spring(beat, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }).start();
  }, [count, reduced, beat]);

  useEffect(() => {
    if (game.status === 'playing') router.replace('/match/play');
    if (game.status === 'idle') router.replace('/');
  }, [game.status, router]);

  const h2h = game.headToHead;
  const you = game.you ?? {};
  const rival = game.opponent ?? {};

  return (
    <View style={styles.screen}>

      {/* ── Your half, wearing your banner. */}
      <Animated.View
        style={[
          styles.half,
          { transform: [{ translateY: top.interpolate({ inputRange: [-1, 0], outputRange: [-500, 0] }) }] },
        ]}
      >
        <Image source={resolveBanner(you.banner, you.displayName)} style={StyleSheet.absoluteFill} contentFit="cover" />
        <View style={styles.shade} />

        <View style={[styles.stampWrap, { paddingTop: insets.top + space.sm }]}>
          <Text style={styles.stamp} allowFontScaling={false}>
            MATCH FOUND
          </Text>
          <View style={styles.topicPill}>
            <Text variant="meta" color={colors.onColor}>
              {game.topic?.name ?? ''}
            </Text>
          </View>
        </View>

        <View style={styles.halfBody}>
          <View style={styles.who}>
            <Text style={[type.display, styles.name]} numberOfLines={1}>
              {you.displayName ?? 'You'}
            </Text>
            <Standing player={you} topic={game.topic?.name} />
            <PlayingFrom country={you.country} city={you.city} />
          </View>
          <Avatar url={you.avatarUrl} name={you.displayName} size={92} style={styles.faceYou} />
        </View>
      </Animated.View>

      {/* ── Their half, wearing theirs — mirrored. */}
      <Animated.View
        style={[
          styles.half,
          { transform: [{ translateY: bottom.interpolate({ inputRange: [0, 1], outputRange: [0, 500] }) }] },
        ]}
      >
        <Image
          source={resolveBanner(rival.banner, rival.displayName)}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
        <View style={styles.shade} />

        <View style={[styles.halfBody, { paddingTop: space.xxl }]}>
          <Avatar url={rival.avatarUrl} name={rival.displayName} size={92} style={styles.faceRival} />
          <View style={[styles.who, styles.whoRight]}>
            <Text style={[type.display, styles.name]} numberOfLines={1}>
              {rival.displayName ?? 'Rival'}
            </Text>
            <Standing player={rival} topic={game.topic?.name} right />
            <PlayingFrom country={rival.country} city={rival.city} right />
          </View>
        </View>

        <View style={[styles.countWrap, { paddingBottom: insets.bottom + space.md }]}>
          {h2h?.played > 0 ? (
            <View style={styles.h2hPill}>
              <Text variant="meta" color={colors.onColor}>
                Head to head — you {h2h.wins}, them {h2h.losses}
                {h2h.draws ? `, ${h2h.draws} drawn` : ''}
              </Text>
            </View>
          ) : (
            <Text variant="meta" color="rgba(255,255,255,0.7)">
              First meeting
            </Text>
          )}
          <Animated.Text
            style={[type.scoreHero, { color: colors.onColor, transform: [{ scale: beat }] }]}
            accessibilityLiveRegion="assertive"
            allowFontScaling={false}
          >
            {count === null ? ' ' : count > 0 ? count : 'Go'}
          </Animated.Text>
        </View>
      </Animated.View>

      {/* ── The seam: a straight gold line, the coin riding it. */}
      <View style={styles.seamWrap} pointerEvents="none">
        <Animated.View
          style={[styles.seam, { opacity: strike, transform: [{ scaleX: strike }] }]}
        />
        <Animated.View
          style={[
            styles.coinWrap,
            {
              opacity: strike,
              transform: [{ scale: strike.interpolate({ inputRange: [0, 1], outputRange: [2.2, 1] }) }],
            },
          ]}
        >
          <View style={styles.vsCoin}>
            <Text allowFontScaling={false} style={styles.vsText}>
              VS
            </Text>
          </View>

          {SPARKS.map((spark, i) => (
            <Animated.View
              key={i}
              style={[
                styles.spark,
                {
                  width: spark.size,
                  height: spark.size,
                  borderRadius: spark.size / 2,
                  opacity: sparks.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] }),
                  transform: [
                    { translateX: sparks.interpolate({ inputRange: [0, 1], outputRange: [0, spark.x] }) },
                    { translateY: sparks.interpolate({ inputRange: [0, 1], outputRange: [0, spark.y] }) },
                  ],
                },
              ]}
            />
          ))}
        </Animated.View>
      </View>

      {/* One frame of white when the seam lands. */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF', opacity: flash }]}
        pointerEvents="none"
      />
    </View>
  );
}

/**
 * Where a player stands — in the two senses this screen is allowed to mean.
 *
 * The league leads: it is the global standing, the one thing that carries
 * across every topic (leagues-and-progression.md §7). Under it sits the TOPIC
 * LEVEL, because that is what this pair was matched on — the queue looks for
 * your level and widens by one at a time, so the two numbers here are almost
 * always equal or within a level, and reading them side by side is meant to
 * say "evenly matched" rather than invite a comparison.
 *
 * The topic RATING is deliberately absent. It exists, it moves every ranked
 * match, and it is visible on the topic leaderboard and your own profile — but
 * not here. Two numbers on a three-second screen is one too many, and the level
 * is the one that was actually used to pick this opponent.
 *
 * The badge takes the screen's own dark chip fill rather than its metal tint,
 * for the same reason the topic and head-to-head pills do — a banner can be
 * any colour underneath, and the metal border and lettering still carry the
 * league.
 */
function Standing({ player, topic, right }) {
  const ranked = Number.isFinite(player.rankedRating) ? player.rankedRating : null;
  const level = Number.isFinite(player.level) ? player.level : null;
  if (ranked === null && level === null) return null;

  return (
    <View style={[styles.standing, right && { alignItems: 'flex-end' }]}>
      {ranked !== null ? (
        <LeagueBadge
          rating={ranked}
          size="sm"
          style={[styles.standingBadge, right && { alignSelf: 'flex-end' }]}
        />
      ) : null}
      {level !== null ? (
        <Text variant="meta" color="rgba(255,255,255,0.85)" numberOfLines={1}>
          {topic ? `${topic} · Level ${level}` : `Level ${level}`}
        </Text>
      ) : null}
    </View>
  );
}

/** "🇮🇳 Playing from Patna, India" — the flag carried by the system font. */
function PlayingFrom({ country, city, right }) {
  if (!country && !city) return null;
  const place = [city, countryName(country)].filter(Boolean).join(', ');
  const flag = flagEmoji(country);
  return (
    <View style={[styles.fromRow, right && { justifyContent: 'flex-end' }]}>
      {flag ? (
        <Text allowFontScaling={false} style={styles.flag}>
          {flag}
        </Text>
      ) : null}
      <Text variant="meta" color="rgba(255,255,255,0.7)" numberOfLines={1} style={{ flexShrink: 1 }}>
        Playing from {place}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // The token, not the hex: a retune of the night canvas has to reach the
  // middle of the match flow too, or versus fades to a stale black.
  screen: { flex: 1, backgroundColor: colors.night },

  half: { flex: 1, overflow: 'hidden' },
  /** Enough shade that white type always wins against any banner pattern. */
  shade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(18, 14, 30, 0.38)' },

  stampWrap: { alignItems: 'center', gap: space.sm },
  stamp: {
    ...type.title,
    color: colors.onColor,
    letterSpacing: 4,
  },
  topicPill: {
    backgroundColor: 'rgba(0,0,0,0.28)',
    paddingHorizontal: space.lg,
    paddingVertical: 5,
    borderRadius: layout.radiusPill,
  },

  halfBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.gutter + space.sm,
    gap: space.lg,
  },
  who: { flex: 1, gap: 3 },
  whoRight: { alignItems: 'flex-end' },
  standing: { gap: 4, marginTop: 2 },
  standingBadge: { backgroundColor: 'rgba(0,0,0,0.34)' },
  name: { color: colors.onColor },
  fromRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  flag: { fontSize: 16, lineHeight: 20 },
  faceYou: { borderWidth: 4, borderColor: colors.onColor },
  faceRival: { borderWidth: 4, borderColor: colors.rival },

  countWrap: { alignItems: 'center', gap: space.xs },
  h2hPill: {
    backgroundColor: 'rgba(0,0,0,0.28)',
    paddingHorizontal: space.lg,
    paddingVertical: 5,
    borderRadius: layout.radiusPill,
  },

  seamWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seam: {
    position: 'absolute',
    left: '-8%',
    right: '-8%',
    top: '50%',
    height: 4,
    marginTop: -2,
    backgroundColor: GOLD,
    borderRadius: 2,
    shadowColor: GOLD,
    shadowOpacity: 0.7,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  coinWrap: { alignItems: 'center', justifyContent: 'center' },
  vsCoin: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.92)',
    shadowColor: GOLD,
    shadowOpacity: 0.55,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  vsText: {
    ...type.timer,
    fontSize: 27,
    lineHeight: 33,
    color: '#3F2D00',
    letterSpacing: 1,
    transform: [{ skewX: '-8deg' }],
    includeFontPadding: false,
  },
  spark: {
    position: 'absolute',
    backgroundColor: GOLD,
  },
});

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, Button } from '../../src/components/ui.jsx';
import { Wordmark } from '../../src/components/Brand.jsx';
import { colors, fonts, layout, space } from '../../src/theme/index.js';
import { useReducedMotion } from '../../src/lib/motion.js';

/**
 * design.md §8.1 — the title screen.
 *
 * ── What "the product" turned out to mean ────────────────────────────────────
 *
 * For a long time it meant the mechanic: two catalogue avatars in their player
 * rings, arriving from opposite sides, with a VS badge struck between them. It
 * said "one against one" with total precision and it said nothing about why
 * anybody would want that.
 *
 * The first screen of an app is not where a mechanic gets explained. It is
 * where someone decides whether the people in it are having a good time. So the
 * mechanic moved into the headlines, and the pictures do the other job.
 *
 * These and the Arena poster on Home are the only shipped illustrations a
 * player ever sees, and the same argument covers both: art belongs where
 * something has to be *wanted*, not where something has to be *reported*. The
 * rest of the app reports.
 *
 * ── On going back to a pager ─────────────────────────────────────────────────
 *
 * The original version of this screen WAS three swipeable pages, and the note
 * that killed it read: nobody swipes them, and a claim is weaker than the thing
 * itself. Both were true of what it was — three walls of text behind a Next
 * button, where swiping was work and the reward was more reading.
 *
 * Pictures change that trade, and one rule keeps the old failure from coming
 * back: **the primary button is live on page one and says the same thing on all
 * three.** Nothing is ever gated behind a swipe. Someone who never touches the
 * pager loses a picture, not a step — which is exactly the property the old
 * three-slide intro did not have.
 *
 * The screen also lost about half of what was on it: the sub-claim rail (its
 * three claims are now the three pages) and the fine print under the button.
 * One picture, one headline, one line, one button.
 *
 * ── Notes from the version before that ───────────────────────────────────────
 *
 * Three things were wrong with it, and all three were about coherence rather
 * than taste:
 *
 *   1. **It was lit in a colour the app no longer owns.** The halo behind the
 *      duel was `rgba(106, 92, 240, …)` — the discarded violet, and the last
 *      two references to it anywhere in the app. Every other screen had moved
 *      to the teal, so the one screen a new player sees first was the only one
 *      still tinted by the old brand.
 *   2. **It was two compositions.** A symmetrical duel centred on the screen,
 *      then a left-aligned headline, sub and claim row underneath it. Neither
 *      alignment was wrong; having both is what read as unresolved. The duel
 *      is symmetric by nature — two rivals mirrored across a seam — so the
 *      page commits to centre.
 *   3. **It carried six hues.** Teal, coral, the violet halo, and the four
 *      quiz colours as a row of decorative dots. The dots said nothing the
 *      screen did not already say and cost four more colours to say it.
 *
 * The field was two banner halves parted on a diagonal — the versus screen's
 * own construction, which was the right instinct and the wrong execution. Two
 * saturated patterns meeting on a hard seam share no value, so the cut read as
 * a rendering fault rather than a composition; and the scrim that had to sit
 * over the lower half to keep the copy legible turned a coral banner into mud.
 * Six hues had become two, and the two were fighting.
 *
 * What replaced it says the same thing with one surface: the app's night field,
 * lit from the left in the player's teal and from the right in the rival's
 * coral. No seam to misread, no scrim to muddy — the arena IS the gradient, and
 * the only colours on the screen are the two that mean "you" and "them"
 * everywhere else in the app. The illustration now stands in that light.
 *
 * One primary action, because there is only one thing to do here. Everything
 * else exists to say what happens after it is pressed.
 */

/**
 * Three pages. One picture and one line each — the rule is that a page has to
 * be readable in the time it takes to swipe past it, which is about a second.
 *
 * The three claims the old screen carried in a rail (live rivals, ten seconds a
 * question, a real rating) are not gone; they are these three pages. A claim
 * with a picture attached is the same claim, arriving in a way somebody might
 * actually look at.
 */
const PAGES = [
  {
    art: require('../../assets/art/duo-play.webp'),
    ratio: 0.99,
    title: 'Think fast.\nWin faster.',
    line: 'Live one-on-one battles. Seven questions, ten seconds each.',
  },
  {
    art: require('../../assets/art/duo-magic.webp'),
    ratio: 1.63,
    title: 'Pick your\nbattlefield.',
    line: 'Code, maths, mythology, movies — every topic has its own ladder.',
  },
  {
    art: require('../../assets/art/duo-cheer.webp'),
    ratio: 1.33,
    title: 'Climb.\nThen keep it.',
    line: 'Win coins, open chests, and hold your league to the end of the month.',
  },
];

export default function Welcome() {
  const router = useRouter();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const enter = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const float = useRef(new Animated.Value(0)).current;
  const [page, setPage] = useState(0);

  /**
   * The hero, clamped at both ends and against the screen's own height. Two
   * constraints because the pages are different shapes — the standing pair is
   * half again as tall as the seated one — and a width that suits the widest
   * would run the tallest off the bottom of a short phone.
   */
  const hero = Math.min(256, Math.max(168, width * 0.58));

  useEffect(() => {
    if (reduced) return;
    Animated.timing(enter, {
      toValue: 1,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    // The rivals breathe on opposite phases: the screen stays alive without
    // anything moving enough to compete with the button. This is the only loop
    // left on the screen — the guideline is one or two animated elements per
    // view, and an entrance that plays once does not count against a page the
    // way a thing that never stops moving does.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [enter, float, reduced]);

  const slice = (from, to, dy = 16) => ({
    opacity: enter.interpolate({ inputRange: [from, to], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [
      {
        translateY: enter.interpolate({
          inputRange: [from, to],
          outputRange: [dy, 0],
          extrapolate: 'clamp',
        }),
      },
    ],
  });

  const bob = (up) => float.interpolate({ inputRange: [0, 1], outputRange: up ? [-3, 3] : [3, -3] });

  const onScrollEnd = (e) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== page) setPage(next);
  };

  return (
    <View style={styles.field}>
      <StatusBar style="light" />

      <Arena />

      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Animated.View style={[styles.brand, slice(0, 0.3, 8)]}>
          <Wordmark size={22} tone="onColor" />
        </Animated.View>

        {/**
          * ── Three pages, one button.
          *
          * The very first version of this screen was three swipeable claims and
          * the note against it read "nobody swipes them". That was true of what
          * it was: three walls of text with a Next button, where swiping was
          * WORK and the reward for it was more reading.
          *
          * Pictures change the trade. There is something to see on each page,
          * the copy is one line under it, and — the part that makes this safe —
          * the primary button is live on page one and says the same thing on
          * all three. Nobody is ever gated behind a swipe. A player who never
          * touches the pager loses a picture, not a step.
          */}
        <Animated.View style={[styles.pagerWrap, slice(0.1, 0.6, 22)]}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onScrollEnd}
            scrollEventThrottle={16}
          >
            {PAGES.map((p, i) => (
              <View key={p.title} style={[styles.page, { width }]}>
                <View style={styles.stage}>
                  {/* The bob is inherited from the rivals this replaced: three
                      points at four seconds, and it is what stops a cut-out
                      looking pasted onto the field. */}
                  <Animated.View
                    style={{ transform: [{ translateY: reduced ? 0 : bob(i % 2 === 0) }] }}
                  >
                    <Image
                      source={p.art}
                      style={{ width: hero, height: hero * p.ratio }}
                      contentFit="contain"
                      /* The first page is what the app opens on, every time. */
                      priority={i === 0 ? 'high' : 'normal'}
                    />
                  </Animated.View>
                </View>

                <View style={styles.copy}>
                  <Text allowFontScaling={false} style={styles.hero}>
                    {p.title}
                  </Text>
                  <Text variant="body" color="rgba(255,255,255,0.72)" style={styles.sub}>
                    {p.line}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </Animated.View>

        {/* Where you are, and how much is left. Not tappable: three dots are
            a 10pt target, and the pager is right above them. */}
        <View style={styles.dots} accessibilityLabel={`Page ${page + 1} of ${PAGES.length}`}>
          {PAGES.map((p, i) => (
            <View key={p.title} style={[styles.dot, i === page && styles.dotOn]} />
          ))}
        </View>

        {/* ── The one thing to do. */}
        <Animated.View style={[styles.actions, slice(0.6, 1)]}>
          <Button label="Let's go" onPress={() => router.push('/(auth)/phone')} />
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

/**
 * The arena: one field, lit from two sides.
 *
 * React Native has no radial gradient and this app carries no SVG, so the
 * light is built from two linear washes laid over the night canvas — teal
 * entering from the left, coral from the right, both fading to nothing well
 * before the copy starts. The result is a field that is unmistakably the app's
 * (night, with the two match colours) and has no edge in it to misread.
 *
 * A third wash weights the foot of the page, so the headline and the button
 * sit on something close to flat night without a scrim over the whole screen.
 */
function Arena() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/**
        * Full height, both of them. A diagonal gradient does not reach zero
        * along the bottom EDGE of its own view — the left of that edge is still
        * lit when the right has faded out — so a view that stopped short of the
        * screen drew a hard horizontal line across the page. Let the washes run
        * the whole way and let the floor below do the darkening.
        */}
      {/* Four stops rather than three, so the light PEAKS behind the duel
          instead of in the top corners. A wash that is brightest where nothing
          is standing lights the wrong thing. */}
      <LinearGradient
        colors={[
          'rgba(58, 159, 178, 0.14)',
          'rgba(58, 159, 178, 0.36)',
          'rgba(58, 159, 178, 0.07)',
          'rgba(58, 159, 178, 0)',
        ]}
        locations={[0, 0.32, 0.62, 0.84]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.95, y: 0.9 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[
          'rgba(255, 92, 122, 0.12)',
          'rgba(255, 92, 122, 0.32)',
          'rgba(255, 92, 122, 0.07)',
          'rgba(255, 92, 122, 0)',
        ]}
        locations={[0, 0.32, 0.62, 0.84]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.05, y: 0.9 }}
        style={StyleSheet.absoluteFill}
      />
      {/* The floor. Keeps the copy on near-flat night without dimming the duel. */}
      <LinearGradient
        colors={['rgba(23,20,34,0)', 'rgba(23,20,34,0.72)', 'rgba(23,20,34,0.96)']}
        locations={[0, 0.5, 1]}
        style={styles.floor}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flex: 1, backgroundColor: colors.night, overflow: 'hidden' },
  /**
   * No horizontal padding on the screen any more — the pager has to be able to
   * reach both edges or a page snaps to a position its own content is inset
   * from. The gutter moved onto the page and onto the actions.
   */
  screen: { flex: 1 },
  brand: { alignItems: 'center', paddingTop: space.md },

  floor: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '52%' },

  pagerWrap: { flex: 1 },
  page: { flex: 1, paddingHorizontal: layout.gutter, justifyContent: 'flex-end' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', minHeight: 150 },

  copy: { paddingTop: space.lg, alignItems: 'center' },
  hero: {
    fontFamily: fonts.display,
    fontSize: 32,
    lineHeight: 38,
    color: colors.onColor,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  sub: { marginTop: space.sm, maxWidth: 300, textAlign: 'center' },

  dots: { flexDirection: 'row', justifyContent: 'center', gap: space.sm, paddingTop: space.lg },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
  /** The current page widens rather than only brightening — `color-not-only`. */
  dotOn: { width: 18, backgroundColor: colors.accent },

  actions: { paddingTop: space.lg, paddingBottom: space.sm, paddingHorizontal: layout.gutter },
});

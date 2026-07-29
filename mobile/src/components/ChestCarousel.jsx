import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Text } from './ui.jsx';
import { faceSource } from '../lib/avatar.js';
import { BANNERS } from '../lib/banner.js';
import { coins as fmtCoins, rarityTone } from '../lib/rarity.js';
import { useReducedMotion } from '../lib/motion.js';
import { colors, fonts, layout, space } from '../theme/index.js';

/**
 * The twenty slots in a chest, on a wheel you can spin.
 *
 * A chest is one draw from twenty, and until now the only thing the screen said
 * about that was a row of coloured dots. Dots describe the odds correctly and
 * make nobody want the box. A case you can look INTO is the whole appeal of a
 * case — the suspense was never "what is in there", it is "which one" — so the
 * contents are laid out on a carousel and the player turns it.
 *
 * ── Why it is a scroll view and not a wheel ──────────────────────────────────
 *
 * A true circle needs each item's position to be cos/sin of a shared angle, and
 * RN's `interpolate` is piecewise-linear: approximating trig over several turns
 * means per-item input arrays of a few hundred points, or moving the maths to
 * the JS thread and paying for it on every frame. Neither is worth it, because
 * the thing a circle actually buys here is DEPTH — items turning away as they
 * leave the middle — and that comes from `rotateY` behind a perspective, which
 * a scroll offset drives directly.
 *
 * So: one native-driven scroll position, every transform interpolated off it,
 * nothing on the JS thread while a finger is down. It reads as a carousel
 * turning and it costs one `Animated.event`.
 *
 * ── Why every slot is a square ───────────────────────────────────────────────
 *
 * Banners are 16:7 and avatars are circles, and a carousel of mixed widths
 * cannot snap — the interval that centres one item leaves the next one short.
 * Every slot is therefore drawn inside the same square token and the banner is
 * cropped into it. Uniform geometry is what makes the snap exact.
 */

const ITEM = 92;
const GAP = space.md;
const STRIDE = ITEM + GAP;

/** How far either side of centre still gets drawn at full depth. */
const REACH = 2;

export default function ChestCarousel({ slots = [], rarities, spinning = false, style }) {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const scrollX = useRef(new Animated.Value(0)).current;
  const listRef = useRef(null);

  /** Side padding that puts the first and last item in the middle of the screen. */
  const pad = Math.max(space.lg, (width - layout.gutter * 2 - ITEM) / 2);

  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: true,
      }),
    [scrollX],
  );

  const renderItem = useCallback(
    ({ item, index }) => (
      <Slot slot={item} index={index} scrollX={scrollX} rarities={rarities} reduced={reduced} />
    ),
    [scrollX, rarities, reduced],
  );

  /**
   * Fixed geometry, declared rather than measured. Without it a horizontal list
   * measures every child on mount, which is exactly the frame budget a carousel
   * of twenty images cannot spare.
   */
  const getItemLayout = useCallback(
    (_, index) => ({ length: STRIDE, offset: STRIDE * index, index }),
    [],
  );

  /**
   * The open: three hops down the wheel, each shorter than the last, so it
   * reads as a throw settling rather than a scroll.
   *
   * Animated `scrollToOffset` is the platform's own smooth scroll — it runs off
   * the JS thread and needs no interpolation of ours, which is what makes this
   * three lines instead of a physics model. The landing slot is derived from
   * the number of slots rather than randomised: `Math.random` here would give
   * a different answer on every re-render, and the point is a wheel that stops,
   * not a wheel that lies about the result. The real result is the Takeover.
   *
   * Reduced motion skips it entirely and the reveal simply arrives.
   */
  useEffect(() => {
    if (!spinning || reduced || slots.length < 3 || !listRef.current) return undefined;

    const last = slots.length - 1;
    const hops = [
      { at: 0, offset: STRIDE * last },
      { at: 380, offset: STRIDE * Math.floor(last * 0.35) },
      { at: 720, offset: STRIDE * Math.floor(last * 0.6) },
    ];
    const timers = hops.map(({ at, offset }) =>
      setTimeout(() => listRef.current?.scrollToOffset({ offset, animated: true }), at),
    );
    return () => timers.forEach(clearTimeout);
  }, [spinning, reduced, slots.length]);

  if (!slots.length) return null;

  return (
    <Animated.FlatList
      ref={listRef}
      style={style}
      data={slots}
      keyExtractor={(s, i) => `${s.type}:${s.key ?? s.amount}:${i}`}
      renderItem={renderItem}
      getItemLayout={getItemLayout}
      horizontal
      showsHorizontalScrollIndicator={false}
      /**
       * A wheel you can actually throw.
       *
       * This was `decelerationRate="fast"` plus `disableIntervalMomentum`, and
       * the second one is the whole problem: it pins the scroll to the NEXT
       * item on release regardless of how hard the gesture was. A flick and a
       * shove did the same thing — advance one — so twenty slots took twenty
       * deliberate swipes and the wheel felt geared rather than spun.
       *
       * Dropping it restores momentum, and `normal` deceleration lets a hard
       * throw coast several slots before it settles. `snapToInterval` still has
       * the last word, so wherever it runs out of speed it lands centred on a
       * slot — the fling is free, the resting place is not.
       */
      snapToInterval={STRIDE}
      decelerationRate="normal"
      /** A finger on the wheel mid-throw fights the animation and wins badly. */
      scrollEnabled={!spinning}
      onScroll={onScroll}
      scrollEventThrottle={16}
      contentContainerStyle={{ paddingHorizontal: pad, gap: GAP }}
      initialNumToRender={5}
      maxToRenderPerBatch={4}
      windowSize={7}
      /**
       * Not `removeClippedSubviews`. It blanks cells on Android during a fast
       * programmatic scroll — which is precisely what the open does — and with
       * twenty items of fixed layout there was nothing to save.
       */
      accessibilityLabel={`${slots.length} possible rewards. Swipe to browse.`}
    />
  );
}

/**
 * One slot, turned away from the middle in proportion to how far it is from it.
 *
 * `memo` matters more than it looks: `scrollX` is a stable ref and the props
 * never change, so once a slot is mounted it never re-renders — the animation
 * happens entirely inside the native driver. Without it, twenty slots would
 * reconcile on every parent render.
 */
const Slot = memo(function Slot({ slot, index, scrollX, rarities, reduced }) {
  const tone = rarityTone(slot.rarity, rarities);
  const isCoins = slot.type === 'coins';

  // The window this item animates across: one stride either side of centred.
  const centre = index * STRIDE;
  const range = [centre - STRIDE * REACH, centre, centre + STRIDE * REACH];

  const at = (out) =>
    scrollX.interpolate({ inputRange: range, outputRange: out, extrapolate: 'clamp' });

  const transform = reduced
    ? []
    : [
        { perspective: 700 },
        { rotateY: at(['42deg', '0deg', '-42deg']) },
        { scale: at([0.68, 1, 0.68]) },
        { translateY: at([10, 0, 10]) },
      ];

  return (
    <Animated.View
      style={[
        styles.slot,
        { transform, opacity: reduced ? 1 : at([0.45, 1, 0.45]) },
      ]}
      accessibilityLabel={
        isCoins ? `${slot.amount} coins` : `${slot.name ?? slot.key}, ${tone.name}`
      }
    >
      <View
        style={[
          styles.token,
          {
            borderColor: tone.edge,
            borderWidth: tone.ring * 2,
            backgroundColor: isCoins ? colors.goldSoft : tone.soft,
          },
        ]}
      >
        {isCoins ? (
          <Text allowFontScaling={false} style={styles.coins}>
            {fmtCoins(slot.amount)}
          </Text>
        ) : slot.type === 'avatar' && faceSource(slot.key) ? (
          <Image source={faceSource(slot.key)} style={styles.fill} contentFit="cover" />
        ) : BANNERS[slot.key] ? (
          <Image source={BANNERS[slot.key]} style={styles.fill} contentFit="cover" />
        ) : null}
      </View>

      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={[styles.caption, { color: isCoins ? colors.gold : tone.ink }]}
      >
        {isCoins ? 'COINS' : tone.name.toUpperCase()}
      </Text>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  slot: { width: ITEM, alignItems: 'center', gap: 6 },
  token: {
    width: ITEM,
    height: ITEM,
    borderRadius: layout.radiusCard,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: { width: '100%', height: '100%' },
  coins: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 28,
    color: colors.gold,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  caption: {
    fontFamily: fonts.semibold,
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 1.4,
    includeFontPadding: false,
  },
});

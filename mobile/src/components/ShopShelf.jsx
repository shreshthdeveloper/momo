import { memo, useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Text } from './ui.jsx';
import Icon from './Icon.jsx';
import { faceSource } from '../lib/avatar.js';
import { BANNERS } from '../lib/banner.js';
import { coins as fmtCoins } from '../lib/rarity.js';
import { colors, fonts, layout, space } from '../theme/index.js';

/**
 * One tier of the shop, as a shelf you slide.
 *
 * The grid this replaces was correct and unusable: 150 avatars in rows of four
 * is 38 rows, so reaching the legendary tier meant scrolling past 130 items,
 * and the page never fit on a screen in any state. Four shelves — one per tier,
 * each sliding sideways — puts the whole catalogue on one screen and makes the
 * tiers the structure rather than a heading you scroll past.
 *
 * ── Not lagging is a design constraint here, not a detail ────────────────────
 *
 * Two hundred images is enough to drop frames on a mid-range Android if the
 * list is naive, so three things are deliberate:
 *
 *   1. `getItemLayout` — fixed geometry, declared. Otherwise the list measures
 *      every child on mount, which is the whole frame budget on the one screen
 *      that has to feel like a game.
 *   2. `memo` on the tile with a primitive-only prop surface, so a parent
 *      re-render (a purchase, a refresh) reconciles the shelf and not 50 tiles.
 *   3. `windowSize: 3` — three screens of content live at a time. A horizontal
 *      shelf is one row tall, so the window costs almost nothing to widen, and
 *      almost nothing is what it needs to be when there are eight of them.
 */

const FACE = 74;
const BANNER_W = 150;
const BANNER_H = Math.round((BANNER_W * 7) / 16);
const GAP = space.md;

export default function ShopShelf({ kind, rarity, tone, items, worn, onPick }) {
  const isBanner = kind === 'banner';
  const stride = (isBanner ? BANNER_W : FACE) + GAP;
  const owned = items.filter((i) => i.owned).length;

  const renderItem = useCallback(
    ({ item }) => (
      <Tile
        item={item}
        kind={kind}
        tone={tone}
        worn={worn === item.key}
        onPress={() => onPick(item)}
      />
    ),
    [kind, tone, worn, onPick],
  );

  const getItemLayout = useCallback(
    (_, index) => ({ length: stride, offset: stride * index, index }),
    [stride],
  );

  if (!items.length) return null;

  return (
    <View style={styles.shelf}>
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: tone.ink }]} />
        <Text allowFontScaling={false} style={[styles.tier, { color: tone.ink }]}>
          {tone.name.toUpperCase()}
        </Text>
        <View style={[styles.rule, { backgroundColor: tone.edge }]} />
        {/* The one number that measures a collection rather than a balance. */}
        <Text variant="meta" color={colors.inkFaint}>
          {owned} / {items.length}
        </Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.key}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={3}
        removeClippedSubviews
        accessibilityLabel={`${tone.name} ${kind}s, ${owned} of ${items.length} owned`}
      />
    </View>
  );
}

/**
 * One item, priced.
 *
 * A shop tile says three things at once and none of them is a colour on its
 * own: the art, a ring in the tier's colour whose WEIGHT rises with the tier,
 * and a tag that reads either a price or "Owned". A player who cannot tell the
 * purple from the grey still reads the tag and the ring.
 */
const Tile = memo(
  function Tile({ item, kind, tone, worn, onPress }) {
    const isBanner = kind === 'banner';
    const source = isBanner ? BANNERS[item.key] : faceSource(item.key);
    if (!source) return null;

    const locked = !item.owned;
    const chestOnly = item.unlockKind === 'chest';

    return (
      <Pressable
        onPress={onPress}
        accessibilityRole={locked ? 'button' : 'radio'}
        accessibilityState={{ selected: Boolean(worn) }}
        accessibilityLabel={
          locked
            ? `${item.name}, ${tone.name} ${kind}, ${item.requirement}`
            : `${item.name}, ${tone.name} ${kind}${worn ? ', worn' : ''}`
        }
        style={({ pressed }) => [
          styles.tile,
          { width: isBanner ? BANNER_W : FACE },
          pressed && { transform: [{ scale: 0.95 }] },
        ]}
      >
        <View
          style={[
            isBanner ? styles.bannerArt : styles.faceArt,
            {
              width: isBanner ? BANNER_W : FACE,
              height: isBanner ? BANNER_H : FACE,
              borderWidth: tone.ring * 2,
              borderColor: worn ? colors.accent : tone.edge,
            },
          ]}
        >
          <Image source={source} style={[styles.fill, locked && styles.dim]} contentFit="cover" />
          {worn ? (
            <View style={styles.tick}>
              <Icon name="check" size={11} color={colors.onAccent} />
            </View>
          ) : null}
        </View>

        {locked ? (
          <View
            style={[
              styles.tag,
              chestOnly && { borderColor: tone.edge, backgroundColor: tone.soft },
            ]}
          >
            {chestOnly ? (
              <Icon name="gift" size={9} color={tone.ink} />
            ) : (
              <View style={styles.coin} />
            )}
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              style={[styles.price, chestOnly && { color: tone.ink }]}
            >
              {chestOnly ? 'Chest' : fmtCoins(item.price)}
            </Text>
          </View>
        ) : (
          <Text variant="tiny" color={colors.inkMuted} numberOfLines={1} style={styles.name}>
            {worn ? 'Worn' : item.name}
          </Text>
        )}
      </Pressable>
    );
  },
  // The only things that can change a tile: whether it is owned, whether it is
  // worn, and its price. Everything else about a catalogue row is fixed.
  (a, b) =>
    a.item.key === b.item.key &&
    a.item.owned === b.item.owned &&
    a.item.price === b.item.price &&
    a.worn === b.worn &&
    a.tone.ink === b.tone.ink,
);

const styles = StyleSheet.create({
  shelf: { marginTop: space.xl },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.md,
    paddingHorizontal: layout.gutter,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tier: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.8,
    includeFontPadding: false,
  },
  rule: { flex: 1, height: 1 },

  /** The shelf bleeds to both edges, so a row reads as continuing off-screen. */
  row: { paddingHorizontal: layout.gutter, gap: GAP },
  tile: { alignItems: 'center', gap: 6 },

  faceArt: { borderRadius: 999, overflow: 'hidden', backgroundColor: colors.sunken },
  bannerArt: {
    borderRadius: layout.radiusChip,
    overflow: 'hidden',
    backgroundColor: colors.sunken,
  },
  fill: { width: '100%', height: '100%' },
  dim: { opacity: 0.3 },
  tick: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /** The price tag — the one thing that makes a grid of art read as a shop. */
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: layout.radiusPill,
    borderWidth: 1,
    borderColor: 'rgba(245, 182, 46, 0.30)',
    backgroundColor: colors.goldSoft,
    maxWidth: '100%',
  },
  coin: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gold },
  price: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 15,
    color: colors.gold,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  name: { maxWidth: '100%' },
});

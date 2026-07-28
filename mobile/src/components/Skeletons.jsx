import { StyleSheet, View } from 'react-native';
import { Skeleton } from './ui.jsx';
import { colors, elevation, layout, space } from '../theme/index.js';

/**
 * Screen-shaped loading states.
 *
 * design.md §5 lists `sunken` as the skeleton surface, and the rule these
 * follow is that a skeleton has to be the shape of the answer. A spinner says
 * "something is happening"; a skeleton says "a row of topic cards is
 * happening", and when the data lands nothing on the screen moves — the same
 * blocks simply gain their content. On a mid-range Android over 4G that
 * difference is most of what the app feels like.
 *
 * So these mirror their real counterparts exactly: same gutters, same card
 * radius, same row heights. Where a skeleton and its screen drift apart the
 * layout visibly jumps at the swap, which is worse than having shown nothing.
 */

/**
 * The Arena dashboard: the Arena card, the streak, the two ladder tiles.
 *
 * It used to draw a saturated banner and a two-up grid of four covers, which
 * was the shape of the old Home. Home is a dashboard now and the grid moved to
 * the Play tab, so this follows it — otherwise the screen visibly reflows at
 * the swap, which is the one thing a skeleton exists to prevent.
 *
 * The *Jump back in* strip is deliberately absent. It is the only conditional
 * section on the screen and it is the last one, so a player with no history
 * sees nothing appear and a player with history sees it arrive below the fold
 * — either way nothing already on screen moves. Drawing three placeholder
 * covers and then deleting them would be the only version that jumps.
 */
export function HomeFeedSkeleton() {
  return (
    <View style={styles.feed}>
      <View style={[styles.banner, elevation.raised]}>
        <Skeleton width={54} height={10} radius={5} />
        <Skeleton width="58%" height={18} radius={9} />
        <Skeleton width="42%" height={12} radius={6} />
        <Skeleton width="100%" height={52} radius={26} style={{ marginTop: space.sm }} />
      </View>

      <View style={styles.streak}>
        <Skeleton width={34} height={34} radius={17} />
        <View style={{ flex: 1, gap: space.sm }}>
          <Skeleton width="46%" height={13} radius={7} />
          <Skeleton width="68%" height={11} radius={6} />
        </View>
      </View>

      <View style={styles.gridWrap}>
        {[0, 1].map((tile) => (
          <View key={tile} style={styles.doorTile}>
            <Skeleton width={16} height={16} radius={8} />
            <Skeleton width="62%" height={14} radius={7} />
            <Skeleton width="44%" height={10} radius={5} />
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * The list-row shape behind Friends, Ranks and any leaderboard: a leading disc,
 * two lines of text, and a trailing number.
 */
export function ListSkeleton({ rows = 7, avatar = true, rank = false, trailing = true, shape = 'circle' }) {
  const lead =
    shape === 'thumb'
      ? { width: 76, height: 72, radius: layout.radiusInput }
      : { width: 44, height: 44, radius: 22 };

  return (
    <View style={styles.list}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={[styles.listRow, shape === 'thumb' && styles.listRowTall]}>
          {rank ? <Skeleton width={30} height={30} radius={15} /> : null}
          {avatar ? <Skeleton width={lead.width} height={lead.height} radius={lead.radius} /> : null}
          <View style={styles.listText}>
            {/* Names are not all one length, and a column of identical bars
                reads as a table rather than as people. */}
            <Skeleton width={`${58 + ((i * 13) % 26)}%`} height={13} radius={6} />
            <Skeleton width={`${34 + ((i * 7) % 18)}%`} height={11} radius={6} />
          </View>
          {trailing ? <Skeleton width={38} height={16} radius={8} /> : null}
        </View>
      ))}
    </View>
  );
}

/** Stacked cards: assignments, contests, the review screen. */
export function CardsSkeleton({ count = 3, lines = 2, bar = true }) {
  return (
    <View style={styles.cardsStack}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.stackCard, elevation.raised]}>
          <View style={styles.stackHead}>
            <Skeleton width="52%" height={14} radius={7} />
            <Skeleton width={72} height={20} radius={10} />
          </View>
          {Array.from({ length: lines }).map((__, l) => (
            <Skeleton key={l} width={l === lines - 1 ? '58%' : '88%'} height={11} radius={6} />
          ))}
          {bar ? <Skeleton width="100%" height={8} radius={4} style={{ marginTop: space.xs }} /> : null}
        </View>
      ))}
    </View>
  );
}

/**
 * Profile and the public profile: the banner band is already painted by the
 * screen, so this is only the stat card and the sections beneath it.
 */
export function ProfileBodySkeleton() {
  return (
    <View style={styles.profile}>
      <View style={styles.section}>
        <Skeleton width={128} height={16} radius={8} />
        <View style={styles.chips}>
          {[92, 74, 108].map((w) => (
            <Skeleton key={w} width={w} height={32} radius={16} />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Skeleton width={104} height={16} radius={8} />
        {[0, 1].map((i) => (
          <View key={i} style={styles.topicBlock}>
            <View style={styles.stackHead}>
              <Skeleton width="46%" height={13} radius={6} />
              <Skeleton width={64} height={18} radius={9} />
            </View>
            <Skeleton width="66%" height={11} radius={6} />
            <Skeleton width="100%" height={6} radius={3} />
          </View>
        ))}
      </View>
    </View>
  );
}

/** The topic screen: cover, the overlapping mastery card, then a board. */
export function TopicSkeleton() {
  return (
    <View style={{ flex: 1 }}>
      <Skeleton width="100%" height={240} radius={0} />
      <View style={styles.topicBody}>
        <View style={[styles.masteryCard, elevation.raised]}>
          <View style={styles.stackHead}>
            <Skeleton width={84} height={14} radius={7} />
            <Skeleton width={132} height={11} radius={6} />
          </View>
          <Skeleton width="100%" height={8} radius={4} />
          <Skeleton width="48%" height={11} radius={6} />
        </View>
        <ListSkeleton rows={5} rank />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  feed: { paddingBottom: space.xxl },
  /** Night, like the card it stands in for — it stopped being accent-filled. */
  banner: {
    gap: space.sm,
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: space.lg,
    marginHorizontal: layout.gutter,
    marginBottom: space.md,
    justifyContent: 'center',
  },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 64,
    paddingHorizontal: layout.cardPadding,
    marginHorizontal: layout.gutter,
    marginBottom: space.xl,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.sunken,
  },
  rowHead: { paddingHorizontal: layout.gutter, marginBottom: space.md },
  gridWrap: {
    flexDirection: 'row',
    gap: layout.cardGap,
    paddingHorizontal: layout.gutter,
  },
  /** The two ladder tiles — same 78pt floor and padding as the real ones. */
  doorTile: {
    flex: 1,
    gap: space.sm,
    minHeight: 78,
    justifyContent: 'center',
    paddingHorizontal: layout.cardPadding,
    paddingVertical: space.md,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.sunken,
  },
  list: { paddingHorizontal: layout.gutter },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 68,
    paddingHorizontal: space.sm,
  },
  listRowTall: { minHeight: 88 },
  listText: { flex: 1, gap: space.sm },
  cardsStack: { paddingHorizontal: layout.gutter, paddingTop: space.sm },
  stackCard: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    padding: layout.cardPadding,
    marginBottom: layout.cardGap,
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  stackHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  profile: { paddingHorizontal: layout.gutter, paddingTop: space.xl },
  section: { marginBottom: space.xl, gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  topicBlock: {
    gap: space.sm,
    padding: space.md,
    borderRadius: layout.radiusInput,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  topicBody: { paddingHorizontal: layout.gutter },
  masteryCard: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    padding: layout.cardPadding,
    marginTop: -24,
    marginBottom: space.xl,
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
});

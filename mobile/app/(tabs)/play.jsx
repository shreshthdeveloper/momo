import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useAuth } from '../../src/state/auth.jsx';
import { useGame } from '../../src/state/game.jsx';
import {
  Text,
  ErrorNotice,
  EmptyState,
  SearchField,
  Sheet,
  Chip,
} from '../../src/components/ui.jsx';
import { ListSkeleton } from '../../src/components/Skeletons.jsx';
import TopicCard from '../../src/components/TopicCard.jsx';
import { LeagueBadge } from '../../src/components/League.jsx';
import Icon from '../../src/components/Icon.jsx';
import { colors, layout, space } from '../../src/theme/index.js';
import { MATCH_MODE, RANKED_START } from '../../src/shared/constants.js';

/**
 * Play — the topic library.
 *
 * ── Why this used to be a sheet, and why it is not one now ───────────────────
 *
 * Play was a modal behind the dock's centre button, and it listed topics. Home
 * also listed topics. Both read `GET /home`, both flattened `feed.rows` into one
 * deduplicated list — the same data, drawn twice, from the same request. Worse,
 * the same tile MEANT different things: on Home it opened the topic, in the
 * sheet it dropped you into a live match. A tile with no stable meaning is the
 * kind of thing players learn to distrust rather than learn.
 *
 * So the duplication is resolved by giving each screen one job. Home is a
 * dashboard — where you stand and one button to play. This is the library, and
 * it is the only place in the app that lists topics. `/search` was a third copy
 * of the same list (field, category chips, results) and has been folded in
 * here; there is now one topic list, one search, one set of filters.
 *
 * ── The stake is a pill, not two cards ───────────────────────────────────────
 *
 * Ranked-or-quick is the most consequential choice on the screen, and it used
 * to be two 64pt explanatory cards. That was right on a sheet whose only job
 * was to ask. On a browsing screen those cards plus a title plus a search field
 * plus a filter row would have pinned two hundred points of chrome above the
 * first cover. It is a compact pill on the title row instead, and pressing it
 * opens the two cards in a sheet with all their reasoning intact.
 *
 * The choice persists in game state, so it is armed for every topic you open
 * until you change it — and the topic screen's button names it at the moment
 * the match is actually joined.
 *
 * ── Tapping a topic opens the topic ──────────────────────────────────────────
 *
 * Not "starts a match". One rule for every topic tile in the app, no exceptions
 * to remember. It also removes a real hazard: with a mode armed at the top of a
 * scrolling grid, tile-taps-queue means one stray thumb costs you rating.
 */
export default function PlayLibrary() {
  const router = useRouter();
  const { activeSpaceId, user } = useAuth();
  const game = useGame();
  const { width } = useWindowDimensions();

  /**
   * The cell, in points, worked out rather than flexed.
   *
   * The first version handed the card `{ flexBasis: 'auto', flex: 1 }` and let
   * the card's own `aspectRatio: 1.05` supply the height. A grid of fourteen
   * topics rendered as fourteen invisible rectangles — the "14 topics" count
   * sat above a completely empty screen.
   *
   * Two style objects were fighting. `TopicCard`'s grid shape declares
   * `flexBasis: '48%'` AND `flexGrow: 0`, sized for the wrapping row on Home;
   * the override replaced the basis but never touched `flexGrow`, and Yoga
   * takes an explicitly-set `flexGrow` over the one implied by the `flex`
   * shorthand. So the cell had `flexGrow: 0` with `flexBasis: auto` — size to
   * content — and the card's content is a cover on `absoluteFill` plus a
   * caption, which measures to almost nothing.
   *
   * The lesson is not "override harder". It is that a card carrying layout
   * assumptions for one parent cannot be re-flexed by a different parent and
   * be trusted. Stated width and height cannot be argued with, cost two
   * multiplications, and buy `getItemLayout` on top — which is what stops a
   * sixty-cover grid measuring every child on mount.
   */
  const CELL = Math.floor((width - layout.gutter * 2 - layout.cardGap) / 2);
  const CELL_H = Math.round(CELL / 1.05);
  const ROW_H = CELL_H + layout.cardGap;

  const [query, setQuery] = useState('');
  const [topics, setTopics] = useState(null);
  const [error, setError] = useState(null);
  const [category, setCategory] = useState(null);
  const [stakeOpen, setStakeOpen] = useState(false);

  const mode = game.preferredMode;
  const ranked = mode === MATCH_MODE.RANKED;
  const rankedRating = user?.rankedRating ?? RANKED_START;

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        setError(null);
        const data = await api.get('/topics', {
          spaceId: activeSpaceId,
          q: query.trim(),
          limit: 60,
        });
        if (alive) setTopics(data.items ?? []);
      } catch (err) {
        if (alive) setError(err);
      }
    }, query ? 240 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, activeSpaceId]);

  // The categories the results actually contain, rather than a fixed taxonomy —
  // a filter that can return nothing is worse than no filter.
  const categories = useMemo(
    () => [...new Set((topics ?? []).map((t) => t.categoryName).filter(Boolean))],
    [topics],
  );
  const shown = useMemo(
    () => (category ? (topics ?? []).filter((t) => t.categoryName === category) : (topics ?? [])),
    [topics, category],
  );

  // A category can vanish under a new search. Clearing the filter beats showing
  // an empty grid under a chip that is no longer on screen.
  useEffect(() => {
    if (category && topics && !categories.includes(category)) setCategory(null);
  }, [category, categories, topics]);

  const choose = useCallback(
    (next) => {
      game.selectMode(next);
      setStakeOpen(false);
    },
    [game],
  );

  const renderTopic = useCallback(
    ({ item }) => (
      <TopicCard
        variant="grid"
        topic={item}
        style={{ flexBasis: CELL, flexGrow: 0, width: CELL, height: CELL_H, aspectRatio: undefined }}
        onPress={() => router.push(`/topic/${item.id}`)}
      />
    ),
    [router, CELL, CELL_H],
  );

  const getItemLayout = useCallback(
    (_, index) => ({ length: ROW_H, offset: ROW_H * index, index }),
    [ROW_H],
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* Title and stake share a row. The stake belongs up here because it is
          true of every card below it, not of any one of them. */}
      <View style={styles.head}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="display">Play</Text>
          {/* Short enough to survive the stake pill on a 360dp screen — the
              longer version ended in an ellipsis on every phone. */}
          <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
            Pick a topic to battle on.
          </Text>
        </View>

        <Pressable
          onPress={() => setStakeOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Playing ${ranked ? 'ranked' : 'quick play'}. Tap to change.`}
          style={({ pressed }) => [
            styles.stake,
            ranked ? styles.stakeRanked : null,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Icon name={ranked ? 'trophy' : 'bolt'} size={13} color={ranked ? colors.accent : colors.inkMuted} />
          <Text variant="tiny" color={ranked ? colors.accent : colors.inkMuted}>
            {ranked ? 'Ranked' : 'Quick'}
          </Text>
          <Icon name="chevronDown" size={11} color={ranked ? colors.accent : colors.inkFaint} />
        </Pressable>
      </View>

      {/* Pinned, both of them: a filter you have to scroll back up to reach is
          a filter people stop using. */}
      <SearchField
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        onClear={() => setQuery('')}
        placeholder="Search topics"
        autoCapitalize="none"
        returnKeyType="search"
      />

      {categories.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          /**
           * `flexGrow: 0` and a centred content container, both load-bearing:
           * a horizontal ScrollView is still a flex child of this column, so
           * without them a row of 38pt chips stretches into giant ovals.
           */
          style={styles.filterRow}
          contentContainerStyle={styles.filters}
        >
          <Chip label="All" active={category === null} onPress={() => setCategory(null)} />
          {categories.map((name) => (
            <Chip
              key={name}
              label={name}
              active={category === name}
              onPress={() => setCategory(category === name ? null : name)}
            />
          ))}
        </ScrollView>
      ) : null}

      <ErrorNotice error={error} />

      {!topics && !error ? (
        <ListSkeleton rows={6} shape="thumb" trailing={false} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={query ? 'search' : 'book'}
          title={query ? 'Nothing matches that' : 'No topics yet'}
          body={
            query
              ? 'Try a shorter search, or clear the category filter.'
              : 'Topics appear here once your organization publishes one, or the Arena has one live.'
          }
          actionLabel={query ? 'Clear search' : undefined}
          onAction={query ? () => setQuery('') : undefined}
        />
      ) : (
        /**
         * Virtualized rather than a wrapping ScrollView. Sixty covers is past
         * the point where mounting them all costs a visible hitch on the first
         * scroll, and this is the one screen in the app guaranteed to hold the
         * whole catalogue.
         */
        <FlatList
          data={shown}
          keyExtractor={(t) => t.id}
          renderItem={renderTopic}
          numColumns={2}
          columnWrapperStyle={styles.rowWrap}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          getItemLayout={getItemLayout}
          initialNumToRender={8}
          windowSize={7}
          /**
           * Deliberately NOT `removeClippedSubviews`. On Android it is a known
           * source of blank cells in multi-column lists, and with fixed item
           * layout and a window of seven there is nothing left for it to save.
           */
          ListHeaderComponent={
            <Text variant="meta" color={colors.inkFaint} style={styles.count}>
              {shown.length} {shown.length === 1 ? 'topic' : 'topics'}
              {category ? ` in ${category}` : ''}
            </Text>
          }
        />
      )}

      {/* The two modes, with the reasoning the pill has no room for.
          leagues-and-progression.md §1 — ranked first, because it is the half
          with consequences. */}
      <Sheet
        visible={stakeOpen}
        title="What is this match worth?"
        onClose={() => setStakeOpen(false)}
        accessibilityLabel="Choose ranked or quick play"
      >
        <View style={styles.modes} accessibilityRole="radiogroup">
          <ModeCard
            title="Ranked"
            body="Your rating and league move."
            selected={ranked}
            onPress={() => choose(MATCH_MODE.RANKED)}
            trailing={<LeagueBadge rating={rankedRating} size="sm" />}
          />
          <ModeCard
            title="Quick play"
            body="Just for fun. XP only, nothing at stake."
            selected={!ranked}
            onPress={() => choose(MATCH_MODE.QUICK)}
          />
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

/**
 * One of the two modes, as a card rather than a segment: a segmented control
 * makes the most consequential choice on the screen look like a filter.
 * Selected takes the accent border and the tick; unselected stays quiet.
 */
function ModeCard({ title, body, trailing, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${body}`}
      style={({ pressed }) => [
        styles.mode,
        selected ? styles.modeOn : null,
        pressed ? { opacity: 0.86 } : null,
      ]}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.modeTitleRow}>
          <Text variant="label" color={selected ? colors.ink : colors.inkMuted}>
            {title}
          </Text>
          {trailing}
        </View>
        <Text variant="meta" color={colors.inkFaint}>
          {body}
        </Text>
      </View>

      <View style={[styles.tick, selected ? styles.tickOn : null]}>
        {selected ? <Icon name="check" size={13} color={colors.onAccent} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.gutter,
    paddingTop: space.md,
  },
  /** Small, but the whole pill is the target and it clears 44pt with hitSlop. */
  stake: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 34,
    paddingHorizontal: space.md,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.sunken,
  },
  stakeRanked: { borderColor: colors.accent, backgroundColor: colors.accentSoft },

  search: { marginHorizontal: layout.gutter, marginTop: space.md, marginBottom: space.sm },
  filterRow: { flexGrow: 0 },
  filters: {
    paddingHorizontal: layout.gutter,
    gap: space.sm,
    paddingVertical: space.sm,
    alignItems: 'center',
  },

  count: { paddingBottom: space.sm },
  grid: { paddingHorizontal: layout.gutter, paddingBottom: layout.dockClearance },
  /**
   * `flex-start` rather than the default `stretch`: the cells carry their own
   * height now, and stretching them to the row would undo it.
   */
  rowWrap: { gap: layout.cardGap, marginBottom: layout.cardGap, alignItems: 'flex-start' },

  modes: { gap: space.sm, paddingTop: space.sm },
  mode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    // Comfortably past the 44pt minimum — two lines of type sit inside it.
    minHeight: 64,
    paddingHorizontal: layout.cardPadding,
    paddingVertical: space.md,
    borderRadius: layout.radiusInput,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.sunken,
  },
  modeOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  modeTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickOn: { backgroundColor: colors.accent, borderColor: colors.accent },
});

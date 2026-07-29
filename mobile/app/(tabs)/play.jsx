import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useAuth } from '../../src/state/auth.jsx';
import { useGame } from '../../src/state/game.jsx';
import { Text, ErrorNotice, EmptyState, SearchField, Chip } from '../../src/components/ui.jsx';
import { ListSkeleton } from '../../src/components/Skeletons.jsx';
import TopicCard from '../../src/components/TopicCard.jsx';
import TopicPlaySheet from '../../src/components/TopicPlaySheet.jsx';
import { colors, layout, space } from '../../src/theme/index.js';
import { RANKED_START } from '../../src/shared/constants.js';

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
 * ── Tapping a topic opens a card, not a page ─────────────────────────────────
 *
 * It used to push the whole topic screen — cover, mastery, leaderboard, match
 * history — at someone who almost always wanted to start a match. A sheet with
 * the topic's face on it and the two ways to play answers that in one tap, and
 * carries a link to the full page for the times the answer really was "show me
 * the board". See `TopicPlaySheet`.
 *
 * ── The stake moved into the card, and the pill went with it ─────────────────
 *
 * Ranked-or-quick was a pill on this header that armed a mode and remembered
 * it, and the note that used to sit here flagged the hazard itself: with a mode
 * armed at the top of a scrolling grid, one stray thumb costs you rating. The
 * question is asked at the moment of commitment now, on the card, where the two
 * options can each say what they are worth. Keeping the pill as well would have
 * left two controls for one decision and a header that no longer governed
 * anything below it.
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
  /** The topic whose card is open. `null` is the grid, undisturbed. */
  const [chosen, setChosen] = useState(null);

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

  /**
   * Start the match, at the stake that was just pressed.
   *
   * `selectMode` is called on the way out so the rest of the app — Home's
   * one-tap Play, the topic page's button — follows the last stake actually
   * taken rather than a filter flipped once and forgotten.
   */
  const selectMode = game.selectMode;
  const play = useCallback(
    (mode) => {
      const topic = chosen;
      if (!topic) return;
      setChosen(null);
      selectMode(mode);
      router.push({
        pathname: '/match/searching',
        params: {
          topicId: topic.id,
          spaceId: topic.spaceId ?? activeSpaceId,
          coverUrl: topic.coverUrl ?? '',
          name: topic.name,
          mode,
        },
      });
    },
    [chosen, selectMode, router, activeSpaceId],
  );

  const openDetails = useCallback(() => {
    const topic = chosen;
    if (!topic) return;
    setChosen(null);
    router.push(`/topic/${topic.id}`);
  }, [chosen, router]);

  /**
   * A stable identity, so the sixty cards below are not rebuilt every time the
   * sheet opens or closes. The card it opens comes from the row itself.
   */
  const renderTopic = useCallback(
    ({ item }) => (
      <TopicCard
        variant="grid"
        topic={item}
        style={{ flexBasis: CELL, flexGrow: 0, width: CELL, height: CELL_H, aspectRatio: undefined }}
        onPress={() => setChosen(item)}
      />
    ),
    [CELL, CELL_H],
  );

  const getItemLayout = useCallback(
    (_, index) => ({ length: ROW_H, offset: ROW_H * index, index }),
    [ROW_H],
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* The title has the row to itself now that the stake is asked on the
          card, so the caption is free to be the longer, clearer sentence that
          used to end in an ellipsis on every phone. */}
      <View style={styles.head}>
        <Text variant="display">Play</Text>
        <Text variant="meta" color={colors.inkFaint}>
          Pick a topic, then choose what the match is worth.
        </Text>
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

      {/* The card behind every tile: what the topic is, and the two ways in.
          leagues-and-progression.md §1 — ranked first, because it is the half
          with consequences. */}
      <TopicPlaySheet
        visible={chosen !== null}
        topic={chosen}
        rankedRating={rankedRating}
        onPlay={play}
        onDetails={openDetails}
        onClose={() => setChosen(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  head: { gap: 2, paddingHorizontal: layout.gutter, paddingTop: space.md },

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
});

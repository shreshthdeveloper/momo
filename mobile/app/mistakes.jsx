import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/lib/api.js';
import { Text, Header, ErrorNotice, EmptyState, Badge, useScrollBottom } from '../src/components/ui.jsx';
import { ListSkeleton } from '../src/components/Skeletons.jsx';
import TopicMedallion from '../src/components/TopicMedallion.jsx';
import Icon from '../src/components/Icon.jsx';
import { DECK, MATCH_MODE, ROUNDS_PER_MATCH } from '../src/shared/constants.js';
import { colors, layout, space } from '../src/theme/index.js';

/**
 * The questions you got wrong, waiting to be got right.
 *
 * Every answer a player has ever given was already stored; nothing in the app
 * used it to help them improve. This screen is the missing half of the review
 * screen: review tells you what you missed in ONE match and then that match
 * scrolls out of history forever.
 *
 * ── Why it is a list of topics rather than one big button ────────────────────
 *
 * A match belongs to exactly one topic — the mastery write, the assignment hook
 * and the leaderboards all read `Match.topicId` — so a single mixed deck would
 * have to credit one subject with the XP earned across several. Choosing a
 * subject is also how revision actually works. So each row is a subject, and each
 * row is a button.
 *
 * ── The empty state is the goal, not a failure ───────────────────────────────
 *
 * Most "empty list" copy apologises. This one congratulates: an empty deck means
 * every question you have ever missed, you have since got right. That is the
 * whole point of the feature, and a screen that treats the win as an absence
 * teaches the player to read arriving here as bad news.
 */
export default function Mistakes() {
  const scrollBottom = useScrollBottom();
  const router = useRouter();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.get('/me/mistakes');
      setItems(data.items ?? []);
    } catch (err) {
      setError(err);
    }
  }, []);

  /**
   * Reloaded on focus, not once on mount.
   *
   * The deck is the one list in the app that the player changes by leaving it:
   * they tap a row, drill it, and come back. Loading on mount alone would show
   * "12 to revisit" on a topic they just cleared, and the number that has to be
   * trustworthy is the whole feature.
   */
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const revise = useCallback(
    (row) => {
      router.push({
        pathname: '/match/searching',
        params: {
          topicId: row.topic.id,
          spaceId: row.topic.spaceId,
          name: row.topic.name,
          coverUrl: row.topic.coverUrl ?? '',
          mode: MATCH_MODE.PRACTICE,
          deck: DECK.MISTAKES,
        },
      });
    },
    [router],
  );

  const total = (items ?? []).reduce((sum, row) => sum + row.count, 0);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Your mistakes" onBack={() => router.back()} />
      <ErrorNotice error={error} onRetry={load} />

      {items === null ? (
        error ? null : <ListSkeleton rows={5} avatar trailing={false} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="check"
          title="Nothing to revise"
          body="Every question you have got wrong, you have since got right. Play a few more and anything you miss will collect here."
          actionLabel="Find a topic"
          onAction={() => router.replace('/play')}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(row) => row.topic.id}
          renderItem={({ item }) => <MistakeRow row={item} onPress={revise} />}
          contentContainerStyle={[styles.list, { paddingBottom: scrollBottom }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.accent}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
          ListHeaderComponent={
            <>
              {/**
               * What the list IS, before the list.
               *
               * The screen opened on a bare count — "29 questions across 10
               * topics · most missed first" — which describes the rows without
               * ever saying what they are or what pressing one does. A player
               * arriving from a banner labelled "Revise your mistakes" then met a
               * list of subject names and had to work out for themselves that
               * each row is a playable drill rather than a report.
               *
               * One sentence fixes it, and it is worth the two lines it costs:
               * this is the only screen in the app whose rows start a match
               * without saying "play" anywhere on them.
               */}
              <View style={styles.intro}>
                <View style={styles.introIcon}>
                  <Icon name="target" size={18} color={colors.optionC} />
                </View>
                <Text variant="body" color={colors.inkMuted} style={{ flex: 1 }}>
                  These are the subjects you have questions owed in. Tap one to play the ones you
                  got wrong.
                </Text>
              </View>

              <Text variant="meta" color={colors.inkFaint} style={styles.count}>
                {total} {total === 1 ? 'question' : 'questions'} across {items.length}{' '}
                {items.length === 1 ? 'topic' : 'topics'} · most missed first
              </Text>
            </>
          }
          ListFooterComponent={
            <Text variant="tiny" color={colors.inkFaint} style={styles.foot}>
              A question leaves this list the moment you get it right. Drills are on your own — no
              opponent, no rating.
            </Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

/**
 * One subject's owed questions.
 *
 * The count is the headline because it is the thing that changes, and the second
 * line says what pressing will actually do. `full` distinguishes a topic that can
 * fill a whole drill from one that cannot — a player who taps "2 to revisit" and
 * gets a seven-round match deserves to have been told the other five would be new.
 */
function MistakeRow({ row, onPress }) {
  const { topic, count, full } = row;
  const padding = ROUNDS_PER_MATCH - count;

  return (
    <Pressable
      onPress={() => onPress(row)}
      accessibilityRole="button"
      accessibilityLabel={`Revise ${count} ${count === 1 ? 'question' : 'questions'} in ${topic.name}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <TopicMedallion coverUrl={topic.coverUrl} name={topic.name} size={44} shape="rounded" />

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="label" numberOfLines={1}>
          {topic.name}
        </Text>
        <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
          {full
            ? 'Enough for a full drill'
            : `Plus ${padding} ${padding === 1 ? 'new question' : 'new questions'} to fill the drill`}
        </Text>
      </View>

      <Badge tone={full ? 'amber' : 'quiet'} label={String(count)} />
      <Icon name="chevronRight" size={16} color={colors.inkFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  list: { paddingHorizontal: layout.gutter },
  intro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: layout.cardPadding,
    marginBottom: space.md,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: 'rgba(242, 160, 61, 0.30)',
    backgroundColor: colors.card,
  },
  introIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.amberSoft,
  },
  count: { paddingBottom: space.md },
  foot: { paddingTop: space.lg, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 64,
    paddingHorizontal: layout.cardPadding,
    paddingVertical: space.sm,
    marginBottom: space.sm,
    borderRadius: layout.radiusInput,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
  },
  pressed: { opacity: 0.86, transform: [{ scale: 0.995 }] },
});

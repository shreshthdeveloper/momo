import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { api } from '../../src/lib/api.js';
import { useAuth } from '../../src/state/auth.jsx';
import { useGame } from '../../src/state/game.jsx';
import {
  Text,
  Button,
  ErrorNotice,
  Avatar,
  ProgressBar,
  SectionHeader,
  IconButton,
  Badge,
} from '../../src/components/ui.jsx';
import Icon from '../../src/components/Icon.jsx';
import { flagEmoji } from '../../src/lib/country.js';
import { TopicSkeleton } from '../../src/components/Skeletons.jsx';
import { LinearGradientFallback } from '../../src/components/Scrim.jsx';
import { TopicGlyph } from '../../src/components/Illustration.jsx';
import { colors, elevation, layout, space, type } from '../../src/theme/index.js';
import { masteryProgress } from '../../src/shared/mastery.js';
import { MATCH_MODE } from '../../src/shared/constants.js';

/** How many rows the topic board shows before the pinned "you" row matters. */
const BOARD_ROWS = 10;

/**
 * design.md §8.3 — topic.
 *
 * "Cover image header. Topic name and category. The viewer's mastery level and
 * rank. A primary Play button. Below: topic leaderboard top 10 with the
 * viewer's row pinned, then their recent matches on this topic."
 *
 * The mastery card overlaps the cover for the same reason it does on the
 * profile: level, rank and rating are about *this* topic, and floating them
 * over its artwork says so without a heading.
 */
export default function TopicScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { activeSpaceId } = useAuth();
  const game = useGame();
  const ranked = game.preferredMode === MATCH_MODE.RANKED;
  const [topic, setTopic] = useState(null);
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [t, b] = await Promise.all([
        api.get(`/topics/${id}`, { spaceId: activeSpaceId }),
        api.get(`/leaderboards/topic/${id}`, { spaceId: activeSpaceId }).catch(() => null),
      ]);
      setTopic(t);
      setBoard(b);
    } catch (err) {
      setError(err);
    }
  }, [id, activeSpaceId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * The rows this screen actually draws, and whether the viewer is among them.
   *
   * The server pages fifty and reports `inPage` against that; this list shows
   * ten. Deciding the pinned row from the server's answer therefore hid it
   * from exactly the players who needed it — anyone ranked 11th to 50th.
   */
  const shownEntries = useMemo(() => (board?.entries ?? []).slice(0, BOARD_ROWS), [board]);
  const viewerVisible = useMemo(
    () =>
      Boolean(board?.viewerRow) &&
      shownEntries.some((e) => String(e.userId) === String(board.viewerRow.userId)),
    [shownEntries, board],
  );

  if (error) {
    return (
      <SafeAreaView style={styles.screen}>
        <ErrorNotice error={error} onRetry={load} />
        <Button variant="ghost" label="Back" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  if (!topic) {
    return (
      <View style={styles.screen}>
        <StatusBar style="light" />
        <TopicSkeleton />
      </View>
    );
  }

  const mastery = topic.viewer ? masteryProgress(topic.viewer.xp) : null;

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ paddingBottom: 132 }} showsVerticalScrollIndicator={false}>
        <View style={styles.cover}>
          {topic.coverUrl ? (
            <Image source={{ uri: topic.coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.glyphWrap]}>
              <TopicGlyph name={topic.name} size={220} radius={0} tone={topic.categoryColor} />
            </View>
          )}
          <LinearGradientFallback />
          <SafeAreaView edges={['top']} style={styles.coverTop}>
            <IconButton name="back" tone="onColor" onPress={() => router.back()} label="Back" />
          </SafeAreaView>
          <View style={styles.coverText}>
            {topic.categoryName ? (
              <Badge label={topic.categoryName} style={{ alignSelf: 'flex-start' }} />
            ) : null}
            <Text variant="display" color={colors.onColor} style={{ marginTop: space.sm }}>
              {topic.name}
            </Text>
          </View>
        </View>

        <View style={styles.body}>
          {topic.viewer ? (
            <View style={[styles.masteryCard, elevation.raised]}>
              <View style={styles.between}>
                <Text variant="label">Level {mastery.level}</Text>
                <Text variant="meta" color={colors.inkFaint}>
                  {topic.viewerRank ? `Rank ${topic.viewerRank}` : 'Unranked'} · rating {topic.viewer.rating}
                </Text>
              </View>
              <ProgressBar
                value={mastery.xpIntoLevel}
                max={mastery.xpForNextLevel || 1}
                height={8}
              />
              <Text variant="meta" color={colors.inkFaint}>
                {mastery.xpForNextLevel
                  ? `${mastery.xpForNextLevel - mastery.xpIntoLevel} XP to level ${mastery.level + 1}`
                  : 'Top level reached'}
              </Text>
            </View>
          ) : (
            <View style={[styles.masteryCard, elevation.raised]}>
              <Text variant="body" color={colors.inkMuted}>
                {topic.description ?? 'You have not played this topic yet. Win a match to start a level here.'}
              </Text>
            </View>
          )}

          {/* `readiness` only accompanies a topic the viewer can see counts
              for; without the guard a not-yet-live topic from any other path
              reads `.published` off undefined and takes the screen down. */}
          {!topic.isLive ? (
            <View style={styles.notReady}>
              <Text variant="meta" color={colors.inkMuted}>
                {topic.readiness
                  ? `Not ready to play — ${topic.readiness.published} of ${topic.readiness.required} questions published.`
                  : 'Not ready to play yet. Check back once more questions are published.'}
              </Text>
            </View>
          ) : null}

          {board?.entries?.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader title="Top players" />
              {/* A topic board pairs this topic's two numbers: the LEVEL, which
                  is what matchmaking uses and what a rival sees on the versus
                  screen, and the RATING, which is what the board is ordered by.
                  This is the one place a topic rating is shown for other
                  people — off a board it invites a comparison it cannot
                  fairly settle. */}
              {shownEntries.map((e) => (
                <Pressable
                  key={e.userId}
                  onPress={() => router.push(`/user/${e.userId}`)}
                  style={({ pressed }) => [styles.boardRow, pressed && { opacity: 0.65 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${e.displayName}, level ${e.level ?? 1}`}
                >
                  <Avatar url={e.avatarUrl} name={e.displayName} size={38} />
                  <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                    {e.displayName}
                  </Text>
                  {flagEmoji(e.country) ? (
                    <Text allowFontScaling={false} style={styles.flag}>
                      {flagEmoji(e.country)}
                    </Text>
                  ) : null}
                  {Number.isFinite(e.level) ? (
                    <Text variant="tiny" color={colors.inkFaint}>{`Lv ${e.level}`}</Text>
                  ) : null}
                  <View style={styles.ratingChip}>
                    <Icon name="bolt" size={11} color={colors.accent} />
                    <Text variant="tiny" color={colors.accent}>
                      {e.rating}
                    </Text>
                  </View>
                </Pressable>
              ))}

              {/* prd.md F6.6.4 — the viewer's own row is pinned when outside the page.

                  "The page" here is what is actually ON SCREEN, not the fifty
                  rows the server computed `inPage` against. This list shows
                  ten, so for anyone ranked 11th–50th the server said "they can
                  see themselves" while their row had been sliced away — no row
                  in the list, and no pinned row either. */}
              {board.viewerRow && !viewerVisible ? (
                <View style={[styles.boardRow, styles.pinned]}>
                  <Avatar
                    url={board.viewerRow.avatarUrl}
                    name={board.viewerRow.displayName}
                    size={38}
                    ring="you"
                  />
                  <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                    You
                  </Text>
                  {flagEmoji(board.viewerRow.country) ? (
                    <Text allowFontScaling={false} style={styles.flag}>
                      {flagEmoji(board.viewerRow.country)}
                    </Text>
                  ) : null}
                  {Number.isFinite(board.viewerRow.level) ? (
                    <Text variant="tiny" color={colors.inkFaint}>{`Lv ${board.viewerRow.level}`}</Text>
                  ) : null}
                  <View style={styles.ratingChip}>
                    <Icon name="bolt" size={11} color={colors.accent} />
                    <Text variant="tiny" color={colors.accent}>
                      {board.viewerRow.rating}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          {topic.recentMatches?.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader title="Your recent matches" />
              {topic.recentMatches.map((m) => (
                <Pressable
                  key={m.id}
                  style={({ pressed }) => [styles.matchRow, pressed && { backgroundColor: colors.hairline }]}
                  onPress={() => router.push(`/review/${m.id}`)}
                >
                  <View
                    style={[
                      styles.verdict,
                      {
                        backgroundColor:
                          m.verdict === 'won' ? colors.correctSoft : m.verdict === 'lost' ? colors.wrongSoft : colors.sunken,
                      },
                    ]}
                  >
                    <Text
                      variant="tiny"
                      color={
                        m.verdict === 'won'
                          ? colors.correct
                          : m.verdict === 'lost'
                            ? colors.wrong
                            : colors.inkMuted
                      }
                    >
                      {m.verdict === 'won' ? 'Won' : m.verdict === 'lost' ? 'Lost' : 'Draw'}
                    </Text>
                  </View>
                  <Text variant="bodyStrong" color={colors.inkMuted} style={{ flex: 1 }} numberOfLines={1}>
                    {m.opponent?.displayName ?? 'Opponent'}
                  </Text>
                  <Text style={[type.label, styles.scoreText]}>
                    {m.scores.you}–{m.scores.opponent}
                  </Text>
                  <Icon name="chevronRight" size={13} color={colors.inkFaint} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/**
        * design.md §6.5 — one primary button per screen.
        *
        * It names the stake. The mode is chosen on the Play tab and held in
        * game state, which means by the time a player reaches this button the
        * choice was made on a different screen — possibly days ago. A button
        * that just says "Play" would be the app quietly deciding whether this
        * match moves a rating. Naming it is the one place the stake HAS to be
        * said, because it is the last screen before it is taken.
        */}
      <SafeAreaView edges={['bottom']} style={styles.playBar}>
        <Button
          label={topic.isLive ? (ranked ? 'Play ranked' : 'Play quick match') : 'Not ready yet'}
          disabled={!topic.isLive}
          onPress={() =>
            router.push({
              pathname: '/match/searching',
              params: {
                topicId: topic.id,
                spaceId: topic.spaceId,
                coverUrl: topic.coverUrl ?? '',
                name: topic.name,
                mode: game.preferredMode,
              },
            })
          }
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  cover: { aspectRatio: 16 / 10, justifyContent: 'flex-end', backgroundColor: colors.sunken },
  glyphWrap: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  coverTop: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: layout.gutter },
  coverText: { padding: layout.gutter, paddingBottom: space.xxl },
  body: { paddingHorizontal: layout.gutter },
  masteryCard: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    padding: layout.cardPadding,
    marginTop: -24,
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  notReady: {
    backgroundColor: colors.sunken,
    borderRadius: layout.radiusInput,
    padding: space.md,
    marginTop: space.lg,
  },
  section: { marginTop: space.xl },
  /** Soft card rows — the game-list grammar shared with the leaderboard. */
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 54,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: layout.radiusInput,
    backgroundColor: colors.sunken,
    marginBottom: space.sm,
  },
  pinned: { backgroundColor: colors.accentSoft },
  flag: { fontSize: 15, lineHeight: 19 },
  ratingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: layout.radiusPill,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 54,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: layout.radiusInput,
    backgroundColor: colors.sunken,
    marginBottom: space.sm,
  },
  scoreText: { color: colors.ink, fontVariant: ['tabular-nums'] },
  verdict: { width: 46, alignItems: 'center', paddingVertical: 4, borderRadius: layout.radiusPill },
  playBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: layout.gutter,
    paddingTop: space.md,
    backgroundColor: colors.canvas,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
});

import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, Badge, ProgressBar } from './ui.jsx';
import { masteryProgress } from '../shared/mastery.js';
import { colors, layout, space, type } from '../theme/index.js';

/**
 * The two rows the profile is made of, extracted so the profile and the
 * full-list screens behind its "See all" links draw the identical thing.
 *
 * They were inline in profile.jsx, which was fine while that was the only place
 * they appeared. The moment "Your topics" got a second home, an inline row
 * would have meant two copies of the same forty lines drifting apart — and the
 * one thing a "see all" page must never do is show a subtly different row from
 * the one that sent you there.
 */

/**
 * One topic's standing.
 *
 * Everything on it is PER TOPIC — the level, the rating and the bar all belong
 * to the subject named on the row, and none of them is the account level or the
 * ranked rating from the header above. An earlier version put "Level 3" and
 * "rating 1216" in one breath with no scope on either, which reads as one
 * number and its badge. So the badge is the level, the rating gets its own line
 * under its own words, and the bar gets a readout — an unlabelled sliver of
 * accent tells nobody what it measures or how much is left.
 */
export const TopicProgressRow = memo(function TopicProgressRow({ topic, onPress }) {
  const m = masteryProgress(topic.xp);

  return (
    <Pressable
      onPress={() => onPress(topic.topicId)}
      accessibilityRole="button"
      accessibilityLabel={`${topic.name}, level ${m.level}, topic rating ${topic.rating}`}
      style={({ pressed }) => [styles.topic, pressed && styles.pressed]}
    >
      <View style={styles.between}>
        <Text variant="label" numberOfLines={1} style={{ flex: 1 }}>
          {topic.name}
        </Text>
        <Badge label={`Level ${m.level}`} tone="soft" />
      </View>

      <Text variant="meta" color={colors.inkFaint} style={{ marginTop: space.sm }}>
        {/* Brighter than the tallies around it, and a line away from the badge,
            so the two never merge into "Level 3, 1216 of something". */}
        <Text variant="meta" color={colors.inkMuted}>
          Topic rating {topic.rating}
        </Text>
        {`  ·  ${topic.wins}W ${topic.losses}L`}
        {topic.accuracy !== null && topic.accuracy !== undefined
          ? `  ·  ${Math.round(topic.accuracy * 100)}% correct`
          : ''}
      </Text>

      <View style={styles.topicMeter}>
        <View style={{ flex: 1 }}>
          <ProgressBar value={m.xpIntoLevel} max={m.xpForNextLevel || 1} height={6} />
        </View>
        <Text variant="tiny" color={colors.inkFaint}>
          {m.xpForNextLevel
            ? `${m.xpForNextLevel - m.xpIntoLevel} XP to level ${m.level + 1}`
            : 'Top level reached'}
        </Text>
      </View>
    </Pressable>
  );
});

/**
 * One finished match.
 *
 * The right-hand column is a score over a rating move. It shows the LADDER
 * move, not the topic Elo: this list spans every topic, so the number a player
 * recognises from the header is the ranked one. Quick play shows the word
 * rather than a zero, because nothing moved and "+0" would imply it might have.
 */
export const MatchHistoryRow = memo(function MatchHistoryRow({ match: m, onPress }) {
  const won = m.verdict === 'won';
  const lost = m.verdict === 'lost';
  /**
   * A drill, which is a row with no other side to it.
   *
   * Left to the general case this row claimed three things that were not true:
   * "Draw" (nobody drew), "vs opponent" (there was none) and a score of "5–0"
   * against them. The server reports the verdict as `solo` and sends no
   * opponent; either would do, and reading both means a row cannot end up
   * half-converted.
   */
  const solo = m.verdict === 'solo' || !m.opponent;
  const fill = solo ? colors.sunken : won ? colors.correctSoft : lost ? colors.wrongSoft : colors.sunken;
  const ink = solo ? colors.inkMuted : won ? colors.correct : lost ? colors.wrong : colors.inkMuted;

  return (
    <Pressable
      onPress={() => onPress(m.id)}
      accessibilityRole="button"
      accessibilityLabel={
        solo
          ? `Practised ${m.topic?.name ?? ''} on your own, scored ${m.you?.score}`
          : `${won ? 'Won' : lost ? 'Lost' : 'Drew'} ${m.topic?.name ?? ''} against ${
              m.opponent?.displayName ?? 'an opponent'
            }, ${m.you?.score} to ${m.opponent?.score}`
      }
      style={({ pressed }) => [styles.match, pressed && styles.pressed]}
    >
      <View style={[styles.verdict, { backgroundColor: fill }]}>
        <Text variant="tiny" color={ink}>
          {solo ? 'Solo' : won ? 'Won' : lost ? 'Lost' : 'Draw'}
        </Text>
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="label" numberOfLines={1}>
          {m.topic?.name}
        </Text>
        <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
          {solo ? 'Practice on your own' : `vs ${m.opponent?.displayName ?? 'opponent'}`}
        </Text>
      </View>

      <View style={{ alignItems: 'flex-end' }}>
        {/* One score, not a scoreline. A dash with nothing after it reads as a
            missing number rather than a missing opponent. */}
        <Text style={[type.label, styles.score]}>
          {solo ? m.you?.score : `${m.you?.score}–${m.opponent?.score}`}
        </Text>
        {m.you?.rankedDelta ? (
          <Text variant="meta" color={m.you.rankedDelta > 0 ? colors.correct : colors.wrong}>
            {m.you.rankedDelta > 0 ? `+${m.you.rankedDelta}` : m.you.rankedDelta}
          </Text>
        ) : m.ranked === false ? (
          <Text variant="meta" color={colors.inkFaint}>
            {/* The mode, when nothing moved. "Quick" for every unranked row was
                wrong the moment practice shipped as a second one. */}
            {solo ? 'Practice' : m.mode === 'contest' ? 'Contest' : 'Quick'}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  topic: {
    marginBottom: space.md,
    padding: space.md,
    borderRadius: layout.radiusInput,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
  },
  /** The bar and its readout are one object: the number is what tells you which
   *  level the sliver belongs to and how much of it is left. */
  topicMeter: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md },
  match: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 60,
    paddingHorizontal: space.sm,
    borderRadius: layout.radiusInput,
  },
  verdict: { width: 46, alignItems: 'center', paddingVertical: 4, borderRadius: layout.radiusPill },
  /** Tabular, so a 5–3 and a 12–10 keep the column aligned. */
  score: { color: colors.ink, fontVariant: ['tabular-nums'] },
  pressed: { backgroundColor: colors.sunken },
});

import { Pressable, StyleSheet, View } from 'react-native';
import { Text, Sheet } from './ui.jsx';
import Icon from './Icon.jsx';
import TopicMedallion from './TopicMedallion.jsx';
import { LeagueBadge } from './League.jsx';
import { colors, layout, space } from '../theme/index.js';
import { MATCH_MODE } from '../shared/constants.js';

/**
 * Tap a topic, get a card: what it is, and the two ways to play it.
 *
 * ── What this replaces ───────────────────────────────────────────────────────
 *
 * Tapping a topic used to push the full topic screen — cover, mastery card,
 * leaderboard, match history — for a player who, nine times in ten, wanted to
 * start a match. That is a whole page load and a back press between a decision
 * and the thing decided. The page is still there and still worth having; it is
 * a link at the foot of this sheet rather than the only door.
 *
 * ── The stake is asked here now ──────────────────────────────────────────────
 *
 * Ranked-or-quick used to be armed on the Play header and remembered, so the
 * button that actually took the rating was on a different screen from the
 * choice — possibly chosen days earlier. play.jsx's own note flagged the hazard:
 * "with a mode armed at the top of a scrolling grid, one stray thumb costs you
 * rating."
 *
 * Two buttons at the point of commitment settle it. Nothing queues without a
 * press that names what it is worth, so there is no armed state to get wrong,
 * and the sentence under each is the reasoning the old pill had no room for.
 * The choice is still remembered — Home's one-tap Play needs a default — but it
 * is now set by the last stake a player actually took rather than by a filter
 * they flipped once.
 */
export default function TopicPlaySheet({ visible, topic, rankedRating, onPlay, onDetails, onClose }) {
  if (!topic) return null;

  const level = topic.viewer?.level;
  const meta = [topic.categoryName, Number.isFinite(level) ? `Level ${level}` : null]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <Sheet visible={visible} onClose={onClose} accessibilityLabel={`Play ${topic.name}`}>
      <View style={styles.head}>
        <TopicMedallion coverUrl={topic.coverUrl} name={topic.name} size={56} shape="rounded" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="title" numberOfLines={2}>
            {topic.name}
          </Text>
          {meta ? (
            <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
      </View>

      {/**
        * The topic's own words, when it has any. Two lines: this is a card on
        * the way to a match, not the topic page — a description that runs on
        * pushes the buttons below the fold on a small screen.
        */}
      {topic.description ? (
        <Text variant="body" color={colors.inkMuted} numberOfLines={2} style={styles.blurb}>
          {topic.description}
        </Text>
      ) : null}

      <View style={styles.options}>
        <PlayOption
          title="Play ranked"
          body="Your rating and league move."
          primary
          trailing={
            Number.isFinite(rankedRating) ? <LeagueBadge rating={rankedRating} size="sm" /> : null
          }
          onPress={() => onPlay(MATCH_MODE.RANKED)}
        />
        <PlayOption
          title="Quick play"
          body="Just for fun. XP only, nothing at stake."
          onPress={() => onPlay(MATCH_MODE.QUICK)}
        />
      </View>

      {/* Everything the old destination had — the topic board, your mastery,
          your matches on it — one press away rather than in the way. */}
      <Pressable
        onPress={onDetails}
        accessibilityRole="button"
        accessibilityLabel={`Open the ${topic.name} topic page`}
        style={({ pressed }) => [styles.details, pressed && { opacity: 0.6 }]}
      >
        <Text variant="label" color={colors.inkMuted}>
          Topic details
        </Text>
        <Icon name="chevronRight" size={14} color={colors.inkFaint} />
      </Pressable>
    </Sheet>
  );
}

/**
 * One of the two ways in.
 *
 * It borrows the shape of the mode cards this replaces so the two modes still
 * read as the same pair of things, and swaps the selection tick for an arrow —
 * because these no longer set a preference, they start a match, and a control
 * that leaves the screen should not look like one that toggles.
 */
function PlayOption({ title, body, trailing, primary, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}`}
      style={({ pressed }) => [
        styles.option,
        primary ? styles.optionPrimary : null,
        pressed ? styles.optionPressed : null,
      ]}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.optionTitleRow}>
          <Text variant="label" color={primary ? colors.accent : colors.ink}>
            {title}
          </Text>
          {trailing}
        </View>
        <Text variant="meta" color={colors.inkFaint}>
          {body}
        </Text>
      </View>
      <Icon name="arrowRight" size={17} color={primary ? colors.accent : colors.inkFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingBottom: space.md },
  blurb: { paddingBottom: space.md },
  options: { gap: space.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    // Two lines of type inside it, and far past the 44pt minimum.
    minHeight: 68,
    paddingHorizontal: layout.cardPadding,
    paddingVertical: space.md,
    borderRadius: layout.radiusInput,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.sunken,
  },
  optionPrimary: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  optionPressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  optionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  details: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 48,
    marginTop: space.sm,
  },
});

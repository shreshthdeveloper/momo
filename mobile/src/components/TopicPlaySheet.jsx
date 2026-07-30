import { Pressable, StyleSheet, View } from 'react-native';
import { Text, Sheet, Badge } from './ui.jsx';
import Icon from './Icon.jsx';
import TopicMedallion from './TopicMedallion.jsx';
import { LeagueBadge } from './League.jsx';
import { colors, layout, space } from '../theme/index.js';
import { DECK, MATCH_MODE } from '../shared/constants.js';

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
export default function TopicPlaySheet({
  visible,
  topic,
  rankedRating,
  /**
   * How many questions in THIS topic the player got wrong and has not since got
   * right. Zero hides the option entirely — an always-present "revise 0" would be
   * a dead control, and it is the count that makes the offer worth reading.
   */
  mistakeCount = 0,
  /**
   * Your best recorded run on THIS topic — `{ score, recordedAt }` — or null if
   * you have never finished one. Null hides the option: a race against a run that
   * does not exist is a button that fails.
   */
  bestRun = null,
  onPlay,
  onDetails,
  onClose,
}) {
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
        {/**
         * Third, and framed as what it is: no opponent at all.
         *
         * The wording matters more than it looks. "Practice" against an unnamed
         * opponent would invite the question the whole ghost design exists to
         * avoid — so the body line says outright that nobody is on the other
         * side. A player who reads "on your own" never wonders who they played.
         */}
        <PlayOption
          title="Practice on your own"
          body="No opponent, no rating. Just the questions and the clock."
          onPress={() => onPlay(MATCH_MODE.PRACTICE)}
        />
        {/**
         * The revision deck, offered at the moment the topic was chosen.
         *
         * This is the one place the offer is worth more than on its own screen: the
         * player has already decided what subject they want, and the answer to
         * "what should I play in it" is *the things you got wrong* far more often
         * than it is "seven more at random". It sits last because it is the
         * narrowest choice, and only appears when there is something in it.
         */}
        {mistakeCount > 0 ? (
          <PlayOption
            title="Revise your mistakes"
            body={
              mistakeCount === 1
                ? 'One question you got wrong. On your own, no rating.'
                : `${mistakeCount} questions you got wrong. On your own, no rating.`
            }
            trailing={<Badge tone="amber" label={String(mistakeCount)} />}
            onPress={() => onPlay(MATCH_MODE.PRACTICE, { deck: DECK.MISTAKES })}
          />
        ) : null}
        {/**
         * Your own best run, offered by name and by date.
         *
         * The only place in the product a replay is played back undisguised — and
         * that is not an exception to the ghost rule so much as the proof of it:
         * a replay is masked when it belongs to somebody else, and this one
         * belongs to the person reading. Naming the score is what makes it a
         * target rather than a curiosity.
         */}
        {bestRun ? (
          <PlayOption
            title="Beat your best"
            body={`Your ${bestRun.score} from ${formatRunDate(bestRun.recordedAt)}, played back. Same questions.`}
            trailing={<Badge tone="quiet" label={String(bestRun.score)} />}
            onPress={() => onPlay(MATCH_MODE.SELF)}
          />
        ) : null}
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
 * "today", "yesterday", or a date — the shortest true thing.
 *
 * A run from four hours ago described as "30 Jul" reads as ancient history and
 * makes the target feel unbeatable; one from March described as "yesterday" would
 * be a lie. The two recent cases are the ones a player will actually see most.
 */
function formatRunDate(iso) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'an earlier run';
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
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

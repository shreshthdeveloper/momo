import { Pressable, StyleSheet, View } from 'react-native';
import { Text, ProgressBar } from './ui.jsx';
import Icon from './Icon.jsx';
import { colors, elevation, layout, space } from '../theme/index.js';

/**
 * prd.md F7.4 / design.md §8.12 — "pending assignments with progress".
 *
 * The bar is the point. A tick tells a student they are done; a bar tells them
 * how much is left, and "two more matches" is the only version of this that
 * ever gets someone to open the app again. So the bar is thick, it is the
 * widest thing on the card, and the number beside it is a countdown rather than
 * a tally.
 *
 * design.md §3.3 — the Space accent carries assignment progress bars, and only
 * these. It never stands in for `correct` or `wrong`.
 */
export default function AssignmentCard({ assignment, accent = colors.accent, onPress }) {
  const { you } = assignment;
  const done = you?.complete;
  const overdue = assignment.overdue && !done;

  const barColor = done ? colors.correct : overdue ? colors.wrong : accent;
  const dueTone = done ? colors.correct : overdue ? colors.wrong : colors.inkMuted;
  const duePill = done ? colors.correctSoft : overdue ? colors.wrongSoft : colors.sunken;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, elevation.raised, pressed && onPress ? styles.pressed : null]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${assignment.title}. ${assignment.requirementText} ${
        done ? 'Complete.' : `${you?.label ?? ''}.`
      }${overdue ? ' Overdue.' : ''}`}
    >
      <View style={styles.head}>
        <Text variant="label" numberOfLines={1} style={{ flex: 1 }}>
          {assignment.title}
        </Text>
        <View style={[styles.duePill, { backgroundColor: duePill }]}>
          <Icon name={done ? 'check' : 'clock'} size={12} color={dueTone} />
          <Text variant="tiny" color={dueTone}>
            {done ? (you.late ? 'Done, late' : 'Done') : dueText(assignment.dueAt, overdue)}
          </Text>
        </View>
      </View>

      <Text variant="meta" color={colors.inkMuted} style={styles.requirement} numberOfLines={2}>
        {assignment.requirementText}
      </Text>

      <ProgressBar value={you?.fraction ?? 0} max={1} color={barColor} height={8} />

      <Text variant="meta" color={done ? colors.correct : colors.inkFaint} style={{ marginTop: space.sm }}>
        {you?.label ?? 'Not started'}
      </Text>
    </Pressable>
  );
}

/** design.md §10 — plain, and relative, because "Friday" needs a calendar. */
function dueText(dueAt, overdue) {
  const ms = new Date(dueAt).getTime() - Date.now();
  if (overdue) {
    const days = Math.ceil(Math.abs(ms) / 86_400_000);
    return days <= 1 ? 'Due yesterday' : `${days} days late`;
  }
  const hours = ms / 3_600_000;
  if (hours < 1) return 'Due within the hour';
  if (hours < 24) return `Due in ${Math.round(hours)} hr`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Due tomorrow' : `Due in ${days} days`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    padding: layout.cardPadding,
    marginBottom: layout.cardGap,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  pressed: { backgroundColor: colors.sunken },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
  duePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: layout.radiusPill,
  },
  requirement: { marginBottom: space.md },
});

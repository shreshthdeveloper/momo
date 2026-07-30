import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Text, ProgressBar, EmptyState, SectionHeader, Card, Stat, Button } from './ui.jsx';
import TopicCard from './TopicCard.jsx';
import AssignmentCard from './AssignmentCard.jsx';
import ContestCard from './ContestCard.jsx';
import { TopicGlyph } from './Illustration.jsx';
import Icon from './Icon.jsx';
import { colors, layout, space } from '../theme/index.js';
import { MATCH_MODE } from '../shared/constants.js';

/**
 * design.md §8.12 — space home.
 *
 * "Institute logo and accent band at the top. Then: pending assignments with
 * progress, upcoming or live contests, assigned topics, class leaderboard,
 * personal progress summary. Visually a sibling of Home, not a different app.
 * Same components, same spacing, different content and one accent."
 *
 * The order is the argument. Work first, because that is what a student is
 * accountable for; then events, which have a deadline; then the open-ended
 * stuff. A student who opens this and sees "two matches left on Mechanics"
 * knows what to do without reading anything else.
 *
 * §3.3 — the accent touches exactly two things: the identity band and the
 * assignment progress bars. It never replaces `accent`, `rival`, `correct` or
 * `wrong`, so a student switching worlds is never confused about a colour.
 */
export default function SpaceHome({ feed, onPlay, header }) {
  const router = useRouter();
  const accent = feed.space?.accentColor ?? colors.accent;

  const assignments = feed.assignments ?? [];
  const contests = feed.contests ?? [];
  const outstanding = assignments.filter((a) => !a.you?.complete);
  const live = contests.filter((c) => c.phase === 'open' || c.phase === 'upcoming');
  const finished = contests.filter((c) => c.phase === 'closed');

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {header}

      {/* The identity band. One of exactly two places the Space's colour appears. */}
      <View style={[styles.identity, { backgroundColor: accent }]}>
        {feed.space?.logoUrl ? (
          <Image source={{ uri: feed.space.logoUrl }} style={styles.logo} contentFit="cover" />
        ) : (
          <TopicGlyph name={feed.space?.name ?? 'S'} size={46} radius={14} tone="rgba(255,255,255,0.22)" />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="title" color={colors.onColor} numberOfLines={1}>
            {feed.space?.name}
          </Text>
          <Text variant="meta" color="rgba(255,255,255,0.78)">
            {feed.batch ? `${feed.batch.name} · ` : ''}
            {feed.memberCount} {feed.memberCount === 1 ? 'student' : 'students'}
          </Text>
        </View>
      </View>

      {/* 1. Assignments — the thing with a name on it. */}
      {outstanding.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader
            title={outstanding.length === 1 ? '1 assignment open' : `${outstanding.length} assignments open`}
            action={assignments.length > outstanding.length ? 'See all' : null}
            onAction={() => router.push('/assignments')}
          />
          {outstanding.slice(0, 3).map((assignment) => (
            <AssignmentCard
              key={assignment.id}
              assignment={assignment}
              accent={accent}
              onPress={() =>
                onPlay({
                  id: assignment.topic.id,
                  name: assignment.topic.name,
                  spaceId: feed.space.id,
                  coverUrl: assignment.topic.coverUrl,
                })
              }
            />
          ))}
        </View>
      ) : null}

      {/**
       * 1.5 — the three things that only exist inside an organization.
       *
       * A row of three, above contests, because each is a *place* rather than a
       * task: join the lesson your teacher just started, see where your class
       * stands, see who is left in the bracket. None of them belongs in the
       * assignment list (they have no deadline) or the topic row (they are not
       * topics), and all three were unreachable without them.
       */}
      <View style={styles.section}>
        <View style={styles.shortcuts}>
          <Shortcut
            icon="play"
            label="Join a session"
            hint="With a code"
            onPress={() => router.push('/session')}
          />
          <Shortcut
            icon="ranks"
            label="Class table"
            hint="Your class vs theirs"
            onPress={() => router.push('/class-table')}
          />
          <Shortcut
            icon="trophy"
            label="Tournaments"
            hint="Knockout brackets"
            onPress={() => router.push('/tournaments')}
          />
        </View>
      </View>

      {/* 2. Contests — the thing with a clock on it. */}
      {live.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title={live.some((c) => c.phase === 'open') ? 'Contests' : 'Coming up'} />
          {live.map((contest) => (
            <ContestCard
              key={contest.id}
              contest={contest}
              onPress={() => router.push(`/contest/${contest.id}`)}
            />
          ))}
        </View>
      ) : null}

      {/* 3. Topics — the open-ended part. Same card as the Public Arena.
             The row bleeds to both screen edges while its heading keeps the
             gutter, which is what makes this read as the same app. */}
      {feed.topics?.length > 0 ? (
        <View style={styles.sectionBleed}>
          <SectionHeader title="Your topics" style={styles.bleedHead} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            // Same as Home — leave room below the cards for their shadow.
            contentContainerStyle={{ paddingHorizontal: layout.gutter, paddingTop: space.xs, paddingBottom: space.lg }}
          >
            {feed.topics.map((topic) => (
              <TopicCard
                key={topic.id}
                topic={{ ...topic, spaceId: feed.space.id }}
                onPress={() => router.push(`/topic/${topic.id}`)}
              />
            ))}
          </ScrollView>
        </View>
      ) : (
        <View style={{ paddingHorizontal: layout.gutter }}>
          <EmptyState title="No topics yet" body="Your admin adds them here." icon="book" />
        </View>
      )}

      {/* 4. Personal progress. */}
      {feed.performance ? (
        <Performance
          performance={feed.performance}
          accent={accent}
          spaceId={feed.space?.id}
          onPlay={onPlay}
        />
      ) : null}

      {/* 5. Finished contests, last — a record rather than a call to action. */}
      {finished.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Past contests" />
          {finished.slice(0, 3).map((contest) => (
            <ContestCard
              key={contest.id}
              contest={contest}
              onPress={() => router.push(`/contest/${contest.id}`)}
            />
          ))}
        </View>
      ) : null}

      {assignments.length === 0 && contests.length === 0 && feed.topics?.length > 0 ? (
        <Text variant="meta" color={colors.inkFaint} style={styles.quiet}>
          No assignments or contests right now. Play anything above — it all counts toward your
          topic levels.
        </Text>
      ) : null}
    </ScrollView>
  );
}

/**
 * One of the three organization shortcuts.
 *
 * Icon over two lines of type, three across. The hint is not decoration: "Class
 * table" alone is a noun nobody has met before, and one line saying what it
 * compares is the difference between a tile people press and a tile people
 * ignore.
 */
function Shortcut({ icon, label, hint, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${hint}`}
      style={({ pressed }) => [styles.shortcut, pressed && { opacity: 0.7 }]}
    >
      <Icon name={icon} size={20} color={colors.accent} />
      <Text variant="label" numberOfLines={1} style={{ marginTop: space.xs }}>
        {label}
      </Text>
      <Text variant="tiny" color={colors.inkFaint} numberOfLines={1}>
        {hint}
      </Text>
    </Pressable>
  );
}

/**
 * prd.md F7.6 — "accuracy per topic, average response time, weakest topics,
 * improvement over time".
 *
 * The weakest topic is the only one shown by name. A student given a ranked
 * list reads it as a report card; a student given one topic reads it as a next
 * step.
 */
function Performance({ performance, accent, spaceId, onPlay }) {
  const weakest = performance.weakest?.[0];
  const improvement = performance.improvement;

  if (!performance.matchesPlayed) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Your progress" />
        <Card>
          <Text variant="meta" color={colors.inkFaint}>
            Play a match and your accuracy, speed and weakest topic appear here.
          </Text>
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SectionHeader title="Your progress" />

      <Card>
        <View style={styles.stats}>
          <Stat value={performance.matchesPlayed} label="matches" />
          <View style={styles.statDivider} />
          <Stat
            value={performance.overallAccuracy !== null ? `${Math.round(performance.overallAccuracy)}%` : '—'}
            label="accuracy"
          />
          <View style={styles.statDivider} />
          <Stat
            value={performance.avgResponseMs ? `${(performance.avgResponseMs / 1000).toFixed(1)}s` : '—'}
            label="avg answer"
          />
        </View>

        {improvement !== null && improvement !== undefined ? (
          <Text
            variant="meta"
            color={improvement > 0 ? colors.correct : improvement < 0 ? colors.wrong : colors.inkFaint}
            style={{ marginTop: space.lg }}
          >
            {improvement > 0
              ? `Up ${improvement} points on accuracy since you started`
              : improvement < 0
                ? `Down ${Math.abs(improvement)} points on accuracy`
                : 'Accuracy steady'}
          </Text>
        ) : null}

        {weakest ? (
          <View style={styles.weakest}>
            <Text variant="meta" color={colors.inkMuted}>
              Weakest right now — {weakest.name}, {Math.round(weakest.accuracy)}%
            </Text>
            <ProgressBar value={weakest.accuracy} max={100} color={accent} height={6} />
            {/**
             * The next step, as a step.
             *
             * The note above this function has always claimed that naming one topic
             * makes it "a next step" rather than a report card — but there was no
             * step: a name, a percentage and a bar, and nothing to press. Telling a
             * student their weakest subject and leaving them to go and find it is
             * the report card the design was trying not to be.
             *
             * Practice rather than ranked. Being handed your worst topic and dropped
             * into a rated match is a punishment; drilling it alone is the thing a
             * student would actually choose.
             */}
            {weakest.topicId && onPlay ? (
              <Button
                variant="soft"
                size="sm"
                fullWidth={false}
                label="Practise this on your own"
                style={styles.weakestAction}
                onPress={() =>
                  onPlay(
                    { id: weakest.topicId, name: weakest.name, spaceId },
                    MATCH_MODE.PRACTICE,
                  )
                }
              />
            ) : null}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: space.xxl },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: layout.gutter,
    marginBottom: space.xl,
    padding: space.lg,
    borderRadius: layout.radiusCard,
  },
  logo: { width: 46, height: 46, borderRadius: 14, overflow: 'hidden' },
  section: { marginBottom: space.xl, paddingHorizontal: layout.gutter },
  sectionBleed: { marginBottom: space.xl },
  bleedHead: { paddingHorizontal: layout.gutter },
  stats: { flexDirection: 'row', alignItems: 'center' },
  statDivider: { width: 1, height: 28, backgroundColor: colors.hairline },
  weakest: { marginTop: space.md, gap: space.sm },
  weakestAction: { marginTop: space.xs, alignSelf: 'flex-start' },
  shortcuts: { flexDirection: 'row', gap: space.sm },
  shortcut: {
    flex: 1,
    minHeight: 84,
    paddingHorizontal: space.sm,
    paddingVertical: space.md,
    borderRadius: layout.radiusInput,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
  },
  quiet: { paddingHorizontal: layout.gutter, textAlign: 'center' },
});

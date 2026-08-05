import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useAuth } from '../../src/state/auth.jsx';
import { useGame } from '../../src/state/game.jsx';
import {
  Text,
  Button,
  Loading,
  ErrorNotice,
  Avatar,
  SectionHeader,
  IconButton,
  Stat,
  useScrollBottom,
} from '../../src/components/ui.jsx';
import { BrandField } from '../../src/components/Brand.jsx';
import { CardsSkeleton } from '../../src/components/Skeletons.jsx';
import Icon from '../../src/components/Icon.jsx';
import { colors, elevation, layout, space, type } from '../../src/theme/index.js';
import { maxScoreForRounds } from '../../src/shared/scoring.js';

/**
 * prd.md F7.5 — a contest: its window, its standings, and one way in.
 *
 * design.md §13 asks for one primary button per screen. Here it is "Enter" —
 * and when the student cannot enter, the button is replaced by a sentence
 * saying why, not by a disabled button with no explanation. Every refusal the
 * server can give has a distinct code, and each one names a different thing
 * the student can do about it.
 *
 * The night header carries the clock and the sheet below carries the
 * standings, so the two things a contest is — a deadline and a ranking — never
 * share a surface.
 */
export default function ContestScreen() {
  const scrollBottom = useScrollBottom();
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const game = useGame();
  const { activeSpaceId, user } = useAuth();

  const [contest, setContest] = useState(null);
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [entering, setEntering] = useState(false);

  const load = useCallback(async () => {
    if (!activeSpaceId) return;
    try {
      setError(null);
      const [list, standings] = await Promise.all([
        api.get(`/spaces/${activeSpaceId}/contests`),
        api.get(`/spaces/${activeSpaceId}/contests/${id}/standings`).catch(() => null),
      ]);
      setContest(list.items.find((c) => c.id === id) ?? standings?.contest ?? null);
      setBoard(standings);
    } catch (err) {
      setError(err);
    }
  }, [activeSpaceId, id]);

  useEffect(() => {
    load();
  }, [load]);

  // A live board moves while you are looking at it. That is the point of a
  // contest, so it is worth the poll — but only while the screen is focused.
  useFocusEffect(
    useCallback(() => {
      if (contest?.phase !== 'open') return undefined;
      const timer = setInterval(load, 20_000);
      return () => clearInterval(timer);
    }, [contest?.phase, load]),
  );

  const enter = async () => {
    setEntering(true);
    const ack = await game.enterContest(String(id));
    setEntering(false);
    if (ack?.ok) router.replace('/match/versus');
  };

  if (!contest && !error) {
    return (
      <View style={styles.plain}>
        <BrandField style={styles.band}>
          <SafeAreaView edges={['top']}>
            <View style={styles.bandTop}>
              <IconButton name="back" tone="onColor" onPress={() => router.back()} label="Back" />
            </View>
            <View style={styles.bandBody}>
              <Loading tone="onColor" label="Loading the contest" />
            </View>
          </SafeAreaView>
        </BrandField>
        <CardsSkeleton count={3} bar={false} />
      </View>
    );
  }

  const entered = Boolean(contest?.yourEntry);
  const maxScore = maxScoreForRounds(contest?.questionCount ?? 7);
  const live = contest?.phase === 'open';

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: scrollBottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.accent}
            progressViewOffset={80}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        {/* ── The clock */}
        <BrandField style={styles.band}>
          <SafeAreaView edges={['top']}>
            <View style={styles.bandTop}>
              <IconButton name="back" tone="onColor" onPress={() => router.back()} label="Back" />
              {live ? (
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <Text variant="tiny" color={colors.onColor}>
                    LIVE
                  </Text>
                </View>
              ) : null}
            </View>

            {contest ? (
              <View style={styles.bandBody}>
                <Text variant="display" color={colors.onColor}>
                  {contest.name}
                </Text>
                <View style={styles.windowRow}>
                  <Icon name="clock" size={14} color="rgba(255,255,255,0.8)" />
                  <Text variant="meta" color="rgba(255,255,255,0.8)">
                    {windowText(contest)}
                  </Text>
                </View>
                {contest.description ? (
                  <Text variant="body" color="rgba(255,255,255,0.82)" style={{ marginTop: space.md }}>
                    {contest.description}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </SafeAreaView>
        </BrandField>

        <ErrorNotice error={error} onRetry={load} />
        <ErrorNotice error={game.error} />

        {contest ? (
          <>
            {/* ── Three facts, overlapping the band */}
            <View style={[styles.facts, elevation.raised]}>
              <Stat value={contest.questionCount} label="questions" />
              <View style={styles.factDivider} />
              <Stat value={maxScore} label="best possible" />
              <View style={styles.factDivider} />
              <Stat value={contest.stats?.completed ?? 0} label="entries" />
            </View>

            {/* One primary action, or one sentence saying why there is none. */}
            <View style={styles.action}>
              {contest.phase === 'open' && !entered ? (
                <>
                  <Button label="Enter the contest" loading={entering} onPress={enter} />
                  <Text variant="meta" color={colors.inkFaint} style={styles.note}>
                    One attempt. Everyone answers the same {contest.questionCount} questions, and
                    equal scores are separated by who was faster.
                  </Text>
                </>
              ) : null}

              {entered ? (
                <View style={[styles.yours, elevation.raised]}>
                  <Icon name="check" size={18} color={colors.correct} />
                  <Text variant="label" style={{ flex: 1 }}>
                    You scored {contest.yourEntry.score}
                    {contest.yourEntry.rank ? `, ${ordinal(contest.yourEntry.rank)} place` : ''}
                  </Text>
                  {contest.yourEntry.matchId ? (
                    <Button
                      variant="soft"
                      size="sm"
                      label="Review"
                      fullWidth={false}
                      onPress={() => router.push(`/review/${contest.yourEntry.matchId}`)}
                    />
                  ) : null}
                </View>
              ) : null}

              {contest.phase === 'upcoming' && !entered ? (
                <Reason text={`This opens ${relative(contest.msUntilStart)} from now. You will get a notification.`} />
              ) : null}

              {contest.phase === 'closed' && !entered ? <Reason text="This contest has closed." /> : null}

              {contest.phase === 'cancelled' ? (
                <Reason text="Your organization cancelled this contest." />
              ) : null}
            </View>

            <View style={styles.boardWrap}>
              <Standings board={board} viewerId={user?.id} />
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Reason({ text }) {
  return (
    <View style={styles.reason}>
      <Text variant="body" color={colors.inkMuted} style={{ textAlign: 'center' }}>
        {text}
      </Text>
    </View>
  );
}

/**
 * prd.md F6.6.4 applies here too — the viewer's own row is always visible, so
 * it is pinned at the bottom when it falls outside the loaded page.
 */
function Standings({ board, viewerId }) {
  if (!board) return null;

  if (board.hidden) {
    return (
      <>
        <SectionHeader title="Standings" />
        <View style={styles.quiet}>
          <Text variant="meta" color={colors.inkFaint}>
            {board.reason}
          </Text>
        </View>
      </>
    );
  }

  if (!board.rows.length) {
    return (
      <>
        <SectionHeader title="Standings" />
        <View style={styles.quiet}>
          <Text variant="meta" color={colors.inkFaint}>
            Nobody has finished yet. Be first.
          </Text>
        </View>
      </>
    );
  }

  const youInPage = board.rows.some((r) => String(r.userId) === String(viewerId));

  return (
    <>
      <SectionHeader title={`Standings · ${board.total ?? board.rows.length}`} />

      {board.rows.map((row) => (
        <Row key={row.userId} row={row} viewerId={viewerId} />
      ))}

      {!youInPage && board.you ? (
        <View style={styles.pinned}>
          <Row row={board.you} viewerId={viewerId} />
        </View>
      ) : null}
    </>
  );
}

function Row({ row, viewerId }) {
  const isYou = String(row.userId) === String(viewerId);
  return (
    <View
      style={[styles.row, isYou && styles.rowYou]}
      accessibilityLabel={`${row.rank}. ${row.displayName}, ${row.score} points.`}
    >
      <Text style={[type.label, styles.rank, { color: isYou ? colors.accent : colors.inkFaint }]}>
        {row.rank}
      </Text>
      <Avatar url={row.avatarUrl} name={row.displayName} size={34} ring={isYou ? 'you' : undefined} />
      <Text
        variant="bodyStrong"
        color={isYou ? colors.ink : colors.inkMuted}
        numberOfLines={1}
        style={{ flex: 1 }}
      >
        {row.displayName}
      </Text>
      <Text variant="meta" color={colors.inkFaint} style={styles.time}>
        {(row.totalResponseMs / 1000).toFixed(1)}s
      </Text>
      <Text style={[type.label, styles.score, { color: isYou ? colors.accent : colors.ink }]}>
        {row.score}
      </Text>
    </View>
  );
}

function windowText(contest) {
  const start = new Date(contest.startsAt);
  const end = new Date(contest.endsAt);
  const fmt = (d) =>
    d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  if (contest.phase === 'open') return `Open until ${fmt(end)} · ${relative(contest.msUntilEnd)} left`;
  if (contest.phase === 'upcoming') return `Opens ${fmt(start)}`;
  return `Closed ${fmt(end)}`;
}

function relative(ms) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hr`;
  return `${Math.round(hours / 24)} days`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  plain: { flex: 1, backgroundColor: colors.canvas },
  content: { },
  band: {
    flex: 0,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    paddingBottom: space.xxxl,
  },
  bandTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.gutter,
    paddingTop: space.sm,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: space.md,
    paddingVertical: 5,
    borderRadius: layout.radiusPill,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.onColor },
  bandBody: { paddingHorizontal: layout.gutter, paddingTop: space.lg },
  windowRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm },
  facts: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.canvas,
    borderRadius: layout.radiusCard,
    marginHorizontal: layout.gutter,
    marginTop: -28,
    paddingVertical: space.lg,
  },
  factDivider: { width: 1, height: 30, backgroundColor: colors.hairline },
  action: { paddingHorizontal: layout.gutter, marginTop: space.xl },
  note: { textAlign: 'center', marginTop: space.md },
  reason: {
    backgroundColor: colors.sunken,
    borderRadius: layout.radiusCard,
    padding: space.lg,
  },
  yours: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.canvas,
    borderRadius: layout.radiusCard,
    padding: space.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  boardWrap: { paddingHorizontal: layout.gutter, marginTop: space.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.sm,
    borderRadius: layout.radiusInput,
  },
  rowYou: { backgroundColor: colors.accentSoft },
  rank: { width: 26, textAlign: 'right', fontVariant: ['tabular-nums'] },
  time: { fontVariant: ['tabular-nums'] },
  score: { width: 44, textAlign: 'right', fontVariant: ['tabular-nums'] },
  pinned: {
    marginTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingTop: space.md,
  },
  quiet: {
    backgroundColor: colors.sunken,
    borderRadius: layout.radiusCard,
    padding: layout.cardPadding,
  },
});

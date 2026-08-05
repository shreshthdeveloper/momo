import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api } from '../src/lib/api.js';
import { useAuth } from '../src/state/auth.jsx';
import {
  Text,
  ErrorNotice,
  Avatar,
  EmptyState,
  Header,
  Segmented,
  RankTile,
  useScrollBottom,
} from '../src/components/ui.jsx';
import { LeagueBadge } from '../src/components/League.jsx';
import { ListSkeleton } from '../src/components/Skeletons.jsx';
import { flagEmoji } from '../src/lib/country.js';
import { colors, elevation, layout, space, type } from '../src/theme/index.js';

/**
 * design.md §8.11 — leaderboard.
 *
 * The top three stand on a podium: a night card, the leader raised in the
 * centre, second and third at their shoulders, each on a medal-coloured ring.
 * Those are the three ranks anyone actually cares about, so they get the one
 * piece of ceremony on the screen — everything below them is just an ordering,
 * and renders as quiet rows.
 *
 * Everything lives in ONE vertical ScrollView. An earlier layout stacked a
 * horizontal chips ScrollView and the list ScrollView as flex siblings, and the
 * two negotiated the column height between them — which is what made the
 * filters and rows collapse into each other on smaller screens.
 *
 * prd.md F6.6.4 — the viewer's own row is pinned to the bottom edge when
 * outside the visible range.
 */
/**
 * ── Two scopes, one period ───────────────────────────────────────────────────
 *
 * This screen used to offer three scopes and three periods — nine boards, from
 * two rows of controls stacked above the podium, on a product whose whole
 * ranking story is one number. Most of the nine were empty or near-identical,
 * and the two rows cost about a hundred points above the fold on a phone.
 *
 * What is left is the two questions anybody actually asks: where do I stand in
 * the world, and where do I stand among the people I know.
 *
 * **City went** because it is the one scope a player cannot fix from here — it
 * needs a city set on the profile, and until then it is a permanently empty
 * board with an instruction on it. It is also the least interesting of the
 * three: a city ladder is a global ladder with most of the people removed.
 *
 * **The periods went** because the season already resets, so "all time" is a
 * month in practice — two more chips to say the same thing three ways. Dropping
 * them also removes a real trap: a period board ranks POINTS EARNED, which no
 * league is computed from, so the badges on it were describing a different
 * number from the one in the column beside them.
 *
 * The server still serves every scope and period; `/leaderboards/overall`
 * defaults `period` to `all`, so this simply stops asking for the rest.
 */
const ARENA_SCOPES = [
  { value: 'global', label: 'Global' },
  { value: 'friends', label: 'Friends' },
];
/** Inside an organization the world IS the organization, so it replaces global. */
const SPACE_SCOPES = [
  { value: 'space', label: 'Organization' },
  { value: 'friends', label: 'Friends' },
];

/** Gold, silver, bronze. Gold is the palette's; the other two are metals
 * that exist nowhere else, so they stay literal here and in `RankTile`. */
const MEDALS = [colors.gold, colors.silver, colors.bronze];

export default function Leaderboard() {
  const scrollBottom = useScrollBottom();
  const router = useRouter();
  const { activeSpaceId, isPublicArena, user } = useAuth();
  const [scope, setScope] = useState(isPublicArena ? 'global' : 'space');
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const scopes = isPublicArena ? ARENA_SCOPES : SPACE_SCOPES;

  /**
   * The two worlds do not offer the same scopes — `space` exists only inside an
   * organization, `global` and `city` only in the Arena — so a scope selected in
   * one is not necessarily offered by the other. Switching worlds used to leave
   * the old value in state, which showed a segmented control with nothing
   * selected and asked the server for a scope it would refuse.
   */
  useEffect(() => {
    if (scopes.some((s) => s.value === scope)) return;
    setScope(isPublicArena ? 'global' : 'space');
  }, [scopes, scope, isPublicArena]);

  const load = useCallback(async () => {
    setError(null);
    try {
      // No `period`: the server defaults it to `all`, which is the only one
      // this screen offers now.
      const data = await api.get('/leaderboards/overall', { spaceId: activeSpaceId, scope });
      setBoard(data);
    } catch (err) {
      setError(err);
    }
  }, [activeSpaceId, scope]);

  useEffect(() => {
    setBoard(null);
    load();
  }, [load]);

  /**
   * One column, one meaning: the ranked rating. That is what the league badges
   * beside it are computed from, so the badge and the number always describe
   * the same thing — which was not true while a period board could put POINTS
   * in this column under a league earned from a rating.
   */
  const valueOf = (e) => e.rating;
  const leagueOf = (e) => (Number.isFinite(e?.rating) ? e.rating : null);

  const entries = board?.entries ?? [];
  // The podium needs three fully-loaded places; with fewer, ceremony would
  // point at empty plinths, so the board falls back to plain rows.
  const hasPodium = entries.length >= 3;
  const podium = hasPodium ? entries.slice(0, 3) : [];
  const rest = hasPodium ? entries.slice(3) : entries;
  const viewerRanked = board?.viewerRow ? leagueOf(board.viewerRow) : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* It left the dock when Play took the middle slot, so it owns a way back
          now. The subtitle stayed: which of the two things this board is
          ranking by is not something a title can carry. */}
      <Header
        title="Ranks"
        subtitle="Ranked rating and league"
        onBack={() => router.back()}
      />

      <Segmented options={scopes} value={scope} onChange={setScope} style={styles.segmented} />

      <ErrorNotice error={error} onRetry={load} />

      {!board && !error ? (
        <ListSkeleton rows={8} rank />
      ) : entries.length === 0 ? (
        <EmptyState
          title="Nobody here yet"
          icon="ranks"
          body={
            scope === 'friends'
              ? 'Add friends to see how you compare.'
              : 'Play a match to appear on this board.'
          }
        />
      ) : (
        <ScrollView
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
        >
          {hasPodium ? (
            <Podium top={podium} valueOf={valueOf} leagueOf={leagueOf} viewerId={user?.id} />
          ) : null}

          {rest.map((e) => (
            <Row key={`${e.userId}-${e.rank}`} entry={e} value={valueOf(e)} ranked={leagueOf(e)} />
          ))}
        </ScrollView>
      )}

      {/* prd.md F6.6.4 — pinned to the bottom edge with an accent left border. */}
      {board?.viewerRow && !board.viewerRow.inPage ? (
        <View style={[styles.pinned, elevation.floating]}>
          <RankTile rank={board.viewerRow.rank} self />
          <Avatar url={board.viewerRow.avatarUrl} name={board.viewerRow.displayName} size={40} ring="you" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="label">You</Text>
            {viewerRanked !== null ? (
              <LeagueBadge rating={viewerRanked} size="sm" showDivision={false} style={styles.rowBadge} />
            ) : null}
          </View>
          <Text style={[type.timer, { color: colors.accent }]}>{valueOf(board.viewerRow)}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/**
 * The podium. Second and third flank the leader on a taller plinth — the same
 * 2-1-3 arrangement every physical podium uses, so it needs no key.
 *
 * It used to be a saturated brand-coloured card with two translucent blobs
 * rotated behind it, which forced every name, badge and figure on it to be
 * white-on-colour and left the three medals with nothing to be brighter than.
 * On night the medals are the brightest things here, which is the point of a
 * podium — and the plinths are drawn rather than implied, so the ranking is
 * legible as a shape before a single number is read.
 */
function Podium({ top, valueOf, leagueOf, viewerId }) {
  const [first, second, third] = top;
  const shared = { valueOf, leagueOf, viewerId };
  return (
    <View style={[styles.podium, elevation.raised]}>
      <View style={styles.podiumRow}>
        <PodiumPlace entry={second} place={2} {...shared} />
        <PodiumPlace entry={first} place={1} {...shared} />
        <PodiumPlace entry={third} place={3} {...shared} />
      </View>
    </View>
  );
}

/** Plinth heights. The gap between them is the ranking, drawn. */
const PLINTH = [52, 34, 24];

function PodiumPlace({ entry, place, valueOf, leagueOf, viewerId }) {
  const medal = MEDALS[place - 1];
  const leader = place === 1;
  const isViewer = String(entry.userId) === String(viewerId ?? '');
  const ranked = leagueOf(entry);

  return (
    <View style={styles.place}>
      <Avatar
        url={entry.avatarUrl}
        name={entry.displayName}
        size={leader ? 68 : 52}
        style={{ borderWidth: leader ? 3 : 2, borderColor: medal }}
      />
      <Text
        variant={leader ? 'label' : 'meta'}
        numberOfLines={1}
        style={styles.placeName}
        color={isViewer ? colors.accent : colors.ink}
      >
        {isViewer ? 'You' : entry.displayName}
      </Text>
      {ranked !== null ? (
        <LeagueBadge rating={ranked} size="sm" showDivision={false} style={styles.placeBadge} />
      ) : null}
      <Text style={[leader ? type.scoreLive : type.timer, { color: colors.ink }]}>
        {valueOf(entry)}
      </Text>

      {/* The plinth: a medal-tinted block with the rank cut into it, capped by
          a solid edge in the medal itself so the three read as one flight of
          steps rather than three unrelated cards. */}
      <View
        style={[
          styles.plinth,
          { height: PLINTH[place - 1], backgroundColor: withAlpha(medal, 0.13), borderTopColor: medal },
        ]}
      >
        <Text allowFontScaling={false} style={[styles.plinthRank, { color: medal }]}>
          {place}
        </Text>
      </View>
    </View>
  );
}

/** `#RRGGBB` + opacity → rgba(). The medals are hex, the tints are not. */
function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Below the podium, every rank is a soft card row with its tile — the same
 * visual grammar as a match list, so the whole app's lists read as one game.
 *
 * A row pairs a level with a rating, and on this board both are the account's:
 * the level comes from lifetime XP, the number in the value column from the
 * ranked ladder. (A topic board pairs the same way with that topic's two.)
 * Tapping opens the player — a board is the natural place to go looking at
 * someone, unlike the versus screen, where a countdown is already running.
 */
function Row({ entry, value, ranked }) {
  const router = useRouter();
  const level = Number.isFinite(entry.level) ? entry.level : null;

  return (
    <Pressable
      onPress={() => (entry.isViewer ? router.push('/profile') : router.push(`/user/${entry.userId}`))}
      style={({ pressed }) => [styles.row, entry.isViewer && styles.rowSelf, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${entry.isViewer ? 'You' : entry.displayName}, rank ${entry.rank}`}
    >
      <RankTile rank={entry.rank} self={entry.isViewer} />
      <Avatar url={entry.avatarUrl} name={entry.displayName} size={40} ring={entry.isViewer ? 'you' : undefined} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.nameRow}>
          <Text variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
            {entry.isViewer ? 'You' : entry.displayName}
          </Text>
          {flagEmoji(entry.country) ? (
            <Text allowFontScaling={false} style={styles.rowFlag}>
              {flagEmoji(entry.country)}
            </Text>
          ) : null}
        </View>
        {/* The league rides the meta line rather than the value column: at row
            density it says what the number means without competing with it,
            and it fits inside the row height the city line already claimed. */}
        {ranked !== null || level !== null || entry.city ? (
          <View style={styles.metaRow}>
            {ranked !== null ? (
              <LeagueBadge rating={ranked} size="sm" showDivision={false} />
            ) : null}
            {level !== null ? (
              <Text variant="meta" color={colors.inkFaint}>{`Level ${level}`}</Text>
            ) : null}
            {entry.city ? (
              <Text variant="meta" color={colors.inkFaint} numberOfLines={1} style={{ flexShrink: 1 }}>
                {entry.city}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      <Text style={[type.timer, { color: entry.isViewer ? colors.accent : colors.ink }]}>{value}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  head: { paddingHorizontal: layout.gutter, paddingTop: space.md, gap: 2 },
  segmented: { marginHorizontal: layout.gutter, marginTop: space.lg, marginBottom: space.lg },
  list: { paddingHorizontal: layout.gutter },

  podium: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    marginBottom: space.lg,
    paddingTop: space.xl,
    paddingHorizontal: space.md,
    overflow: 'hidden',
  },
  podiumRow: {
    flexDirection: 'row',
    // The plinths meet the card's foot, so the steps share one baseline.
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  place: { flex: 1, alignItems: 'center', gap: 2 },
  placeName: { marginTop: space.sm, maxWidth: 104 },
  placeBadge: { alignSelf: 'center', marginTop: 2 },
  plinth: {
    alignSelf: 'stretch',
    marginTop: space.sm,
    marginHorizontal: 3,
    borderTopWidth: 2,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plinthRank: { fontFamily: 'Poppins_700Bold', fontSize: 15, lineHeight: 19 },

  /** Each rank is a soft card — the game-list grammar. */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 62,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: layout.radiusInput,
    backgroundColor: colors.sunken,
    marginBottom: space.sm,
  },
  rowSelf: { backgroundColor: colors.accentSoft },
  rowPressed: { opacity: 0.65 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowFlag: { fontSize: 13, lineHeight: 17 },
  /** Name plus badge stays under the 62pt row: 20 + 2 + 22 + 16 padding. */
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  rowBadge: { marginTop: 2 },

  pinned: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 68,
    paddingHorizontal: layout.gutter,
    backgroundColor: colors.canvas,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    borderLeftWidth: 4,
    borderLeftColor: colors.accent,
  },
  pinnedRank: { width: 26, textAlign: 'center', color: colors.accent, fontVariant: ['tabular-nums'] },
});

import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/lib/api.js';
import { useAuth } from '../../src/state/auth.jsx';
import {
  Text,
  ErrorNotice,
  Avatar,
  Button,
  SearchField,
  SectionHeader,
} from '../../src/components/ui.jsx';
import { LeagueBadge } from '../../src/components/League.jsx';
import { ListSkeleton } from '../../src/components/Skeletons.jsx';
import Icon from '../../src/components/Icon.jsx';
import { inviteFriends } from '../../src/lib/share.js';
import { colors, layout, space, type } from '../../src/theme/index.js';

/**
 * prd.md §6.8 — friend requests, friend list, find by username.
 *
 * ── The empty state was a dead end ───────────────────────────────────────────
 *
 * A title, a sentence and a search field that asks you to already know
 * somebody's exact name. Every new account landed on it, and there was nothing
 * on the screen a person could press.
 *
 * Two things fix that, and neither is copy:
 *
 *   1. **Invite.** One button into the OS share sheet — WhatsApp, Messages, a
 *      copied link, whatever they actually use. It carries a link to the
 *      sender's own profile, so accepting lands on a page that says who asked.
 *   2. **People you played.** The best suggestion source we have, and the only
 *      one that can explain itself: you went seven questions with them an hour
 *      ago. `GET /friends/suggestions` returns recent opponents who are not
 *      already in a friendship row in any state.
 *
 * Both stay visible once there ARE friends — invites do not stop mattering,
 * and the suggestion list is how the roster grows after the first person.
 *
 * ── Rankings live here too ───────────────────────────────────────────────────
 *
 * Ranks has no tab. It is reachable from the Home standing strip and the
 * profile league card, and now from the top of this screen — because "how do I
 * compare to my friends" is a question about people, the leaderboard already
 * has a Friends scope, and this is the tab a player is on when they ask it.
 */
export default function Friends() {
  const router = useRouter();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [challenges, setChallenges] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  /** Rows already acted on, so an "Add" does not sit there looking unpressed. */
  const [asked, setAsked] = useState({});

  const load = useCallback(async () => {
    try {
      setError(null);
      // All three in one pass: a challenge is a thing between friends, and a
      // suggestion is a friend you do not have yet. Both belong on this screen
      // rather than behind tabs that would sit empty most of the time.
      const [friends, challengeList, suggested] = await Promise.all([
        api.get('/friends'),
        api.get('/challenges').catch(() => ({ items: [] })),
        api.get('/friends/suggestions').catch(() => ({ items: [] })),
      ]);
      setData(friends);
      setChallenges(challengeList.items ?? []);
      setSuggestions(suggested.items ?? []);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return undefined;
    }
    const t = setTimeout(() => {
      api
        .get('/users/search', { q: query.trim() })
        .then((r) => setResults(r.items ?? []))
        .catch(() => setResults([]));
    }, 260);
    return () => clearTimeout(t);
  }, [query]);

  const act = async (fn) => {
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err);
    }
  };

  /**
   * Sending a request is optimistic on the row and reloaded underneath. The
   * server is the truth, but "Add" that stays "Add" for a second and a half
   * gets pressed twice, and the second press is a 409.
   */
  const addFriend = useCallback((id) => {
    setAsked((a) => ({ ...a, [id]: true }));
    api
      .post('/friends/request', { userId: id })
      .then(() => load())
      .catch((err) => {
        setAsked((a) => {
          const next = { ...a };
          delete next[id];
          return next;
        });
        setError(err);
      });
  }, [load]);

  const invite = useCallback(
    () => inviteFriends({ displayName: user?.displayName, userId: user?.id }),
    [user],
  );

  const noFriends = !data?.friends?.length && !data?.incoming?.length;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.head}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="display">Friends</Text>
        </View>
        {/* Always available, not just when the list is empty. */}
        <Button
          variant="soft"
          size="sm"
          label="Invite"
          icon="share"
          fullWidth={false}
          onPress={invite}
        />
      </View>

      <SearchField
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        onClear={() => setQuery('')}
        placeholder="Find someone by name"
        autoCapitalize="none"
      />

      <ErrorNotice error={error} onRetry={load} />

      {!data && !error ? (
        <ListSkeleton rows={6} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
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
          {results !== null ? (
            <>
              <SectionHeader title="Search results" />
              {results.length === 0 ? (
                <Text variant="body" color={colors.inkFaint} style={{ paddingVertical: space.md }}>
                  Nobody by that name.
                </Text>
              ) : (
                results.map((u) => (
                  <PersonRow
                    key={u.id}
                    person={u}
                    line={standingLine(u)}
                    asked={asked[u.id]}
                    onOpen={() => router.push(`/user/${u.id}`)}
                    onAdd={() => addFriend(u.id)}
                  />
                ))
              )}
            </>
          ) : (
            <>
              {/* ── Where everyone stands. One row, at the top, because it is
                  the question this tab gets asked and it is not a person. */}
              <Pressable
                onPress={() => router.push('/leaderboard')}
                accessibilityRole="button"
                accessibilityLabel="Rankings. See where you and your friends stand."
                style={({ pressed }) => [styles.ranks, pressed && { opacity: 0.7 }]}
              >
                <View style={styles.ranksGlyph}>
                  <Icon name="trophy" size={16} color={colors.gold} />
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text variant="label">Rankings</Text>
                  <Text variant="meta" color={colors.inkFaint}>
                    You, your friends, your city, the world.
                  </Text>
                </View>
                <Icon name="chevronRight" size={15} color={colors.inkFaint} />
              </Pressable>

              {/* ── Challenges, above everything a friend list would otherwise
                  show. One of these is a match waiting to be played, which
                  outranks a request and certainly outranks a roster. */}
              {challenges.length > 0 ? (
                <>
                  <SectionHeader title="Challenges" />
                  {challenges.map((c) => (
                    <ChallengeRow
                      key={c.id}
                      challenge={c}
                      onAccept={() => act(() => api.post(`/challenges/${c.id}/accept`))}
                      onDecline={() => act(() => api.post(`/challenges/${c.id}/decline`))}
                      onPlay={() =>
                        router.replace({
                          pathname: '/match/searching',
                          params: {
                            challengeId: c.id,
                            opponent: c.opponent?.displayName ?? '',
                            name: c.topic?.name ?? '',
                          },
                        })
                      }
                    />
                  ))}
                </>
              ) : null}

              {data?.incoming?.length > 0 ? (
                <>
                  <SectionHeader
                    title={`${data.incoming.length} request${data.incoming.length === 1 ? '' : 's'}`}
                  />
                  {data.incoming.map((f) => (
                    <View key={f.friendshipId} style={styles.row}>
                      <Avatar url={f.avatarUrl} name={f.displayName} size={44} />
                      <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
                        {f.displayName}
                      </Text>
                      <Button
                        size="sm"
                        label="Accept"
                        fullWidth={false}
                        onPress={() => act(() => api.post(`/friends/${f.friendshipId}/accept`))}
                      />
                      <Pressable
                        onPress={() => act(() => api.post(`/friends/${f.friendshipId}/decline`))}
                        hitSlop={8}
                        accessibilityLabel="Decline"
                        style={({ pressed }) => [styles.decline, pressed && { opacity: 0.7 }]}
                      >
                        <Icon name="close" size={16} color={colors.inkFaint} />
                      </Pressable>
                    </View>
                  ))}
                </>
              ) : null}

              {noFriends ? (
                <InviteBlock onInvite={invite} hasSuggestions={suggestions.length > 0} />
              ) : (
                <>
                  {data?.friends?.length > 0 ? (
                    <SectionHeader
                      title={`${data.friends.length} friend${data.friends.length === 1 ? '' : 's'}`}
                    />
                  ) : null}
                  {data?.friends?.map((f) => (
                    <Pressable
                      key={f.id}
                      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                      onPress={() => router.push(`/user/${f.id}`)}
                    >
                      <View>
                        <Avatar url={f.avatarUrl} name={f.displayName} size={44} />
                        {f.isOnline ? <View style={styles.online} /> : null}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text variant="label" numberOfLines={1}>
                          {f.displayName}
                        </Text>
                        <Text variant="meta" color={f.isOnline ? colors.correct : colors.inkFaint}>
                          {f.isOnline ? 'Online now' : (f.city ?? 'Offline')}
                        </Text>
                      </View>
                      {/* The same standing the search results show, said the
                          same way: a league when there is one, and a rating
                          that names itself when there is not. Never a bare
                          number. */}
                      {Number.isFinite(f.rankedRating) ? (
                        <LeagueBadge rating={f.rankedRating} size="sm" showDivision={false} />
                      ) : Number.isFinite(f.overallRating) ? (
                        <Text style={[type.label, { color: colors.inkMuted }]}>
                          Rating {f.overallRating}
                        </Text>
                      ) : null}
                      {/* The point of having friends. It sits inside the row
                          but takes its own press, so tapping the name still
                          opens the profile. */}
                      <Button
                        variant="soft"
                        size="sm"
                        label="Play"
                        fullWidth={false}
                        onPress={() =>
                          router.push({
                            pathname: '/challenge',
                            params: {
                              userId: f.id,
                              name: f.displayName,
                              avatarUrl: f.avatarUrl ?? '',
                            },
                          })
                        }
                      />
                    </Pressable>
                  ))}
                </>
              )}

              {/* ── People you have played. Below the roster when there is one,
                  because these are candidates and those are friends. */}
              {suggestions.length > 0 ? (
                <>
                  <SectionHeader title="You played them recently" />
                  {suggestions.map((s) => (
                    <PersonRow
                      key={s.id}
                      person={s}
                      line={playedLine(s)}
                      asked={asked[s.id]}
                      onOpen={() => router.push(`/user/${s.id}`)}
                      onAdd={() => addFriend(s.id)}
                    />
                  ))}
                </>
              ) : null}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/**
 * Somebody who is not a friend yet — a search hit or a suggestion. One row for
 * both, because they are the same object at the same distance and giving them
 * different shapes would imply a difference that is not there.
 */
function PersonRow({ person, line, asked, onOpen, onAdd }) {
  const ranked = Number.isFinite(person.rankedRating) ? person.rankedRating : null;

  return (
    <View style={styles.row}>
      <Avatar url={person.avatarUrl} name={person.displayName} size={44} />
      <Pressable
        style={({ pressed }) => [{ flex: 1, minWidth: 0 }, pressed && { opacity: 0.7 }]}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${person.displayName}. Open profile.`}
      >
        <Text variant="label" numberOfLines={1}>
          {person.displayName}
        </Text>
        {ranked !== null || line ? (
          <View style={styles.metaRow}>
            {ranked !== null ? <LeagueBadge rating={ranked} size="sm" showDivision={false} /> : null}
            {line ? (
              <Text variant="meta" color={colors.inkFaint} numberOfLines={1} style={{ flexShrink: 1 }}>
                {line}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Pressable>

      {asked ? (
        <View style={styles.sent}>
          <Icon name="check" size={14} color={colors.correct} />
          <Text variant="tiny" color={colors.correct}>
            Sent
          </Text>
        </View>
      ) : (
        <Button variant="soft" size="sm" label="Add" fullWidth={false} onPress={onAdd} />
      )}
    </View>
  );
}

/**
 * What an empty roster says.
 *
 * Not an `EmptyState` — that component centres an icon and a sentence in the
 * remaining space, which is right for "nothing matched your search" and wrong
 * here, where the screen has three more sections under it and the only correct
 * response is to press something.
 */
function InviteBlock({ onInvite, hasSuggestions }) {
  return (
    <View style={styles.invite}>
      <View style={styles.inviteGlyph}>
        <Icon name="friends" size={22} color={colors.accent} />
      </View>
      <Text variant="title" style={{ textAlign: 'center' }}>
        Nobody here yet
      </Text>
      <Text variant="meta" color={colors.inkFaint} style={styles.inviteBody}>
        {hasSuggestions
          ? 'Add someone you have already played, below — or bring your own.'
          : 'Bring someone in, then challenge them whenever you like.'}
      </Text>
      <Button label="Invite a friend" icon="share" onPress={onInvite} style={styles.inviteButton} />
    </View>
  );
}

/**
 * One challenge, in whichever of its three states it is in.
 *
 * The row is the same shape every time and only its right-hand side changes,
 * because the three states are the same object at different moments and
 * shuffling the layout between them would make them read as different things:
 *
 *   incoming, pending   Accept / decline — they asked, you answer
 *   outgoing, pending   Waiting on them. Nothing to press.
 *   accepted, either    Play. Both sides get this, and both have to press it,
 *                       because a live challenge pairs the two of them in a
 *                       queue only they can enter.
 */
function ChallengeRow({ challenge, onAccept, onDecline, onPlay }) {
  const { direction, status, opponent, topic } = challenge;
  const ready = status === 'accepted';
  const theirs = direction === 'incoming' && status === 'pending';

  const line = ready
    ? 'Ready — press play when they do'
    : theirs
      ? `Challenged you · ${topic?.name ?? 'a topic'}`
      : `Waiting for them · ${topic?.name ?? 'a topic'}`;

  return (
    <View style={[styles.row, ready && styles.rowReady]}>
      <Avatar url={opponent?.avatarUrl} name={opponent?.displayName} size={44} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="label" numberOfLines={1}>
          {opponent?.displayName ?? 'Someone'}
        </Text>
        <Text variant="meta" color={ready ? colors.correct : colors.inkFaint} numberOfLines={1}>
          {line}
        </Text>
      </View>

      {ready ? (
        <Button size="sm" label="Play" fullWidth={false} onPress={onPlay} />
      ) : theirs ? (
        <>
          <Button size="sm" label="Accept" fullWidth={false} onPress={onAccept} />
          <Pressable
            onPress={onDecline}
            hitSlop={8}
            accessibilityLabel="Decline challenge"
            style={({ pressed }) => [styles.decline, pressed && { opacity: 0.7 }]}
          >
            <Icon name="close" size={16} color={colors.inkFaint} />
          </Pressable>
        </>
      ) : (
        <Icon name="clock" size={16} color={colors.inkFaint} />
      )}
    </View>
  );
}

/**
 * The second line of a search result. When a league badge sits beside it the
 * badge is the standing, so the number would only repeat it in another unit;
 * without one, the rating comes back and says its own name.
 */
function standingLine(u) {
  const rating =
    Number.isFinite(u.rankedRating) || !Number.isFinite(u.overallRating)
      ? null
      : `Rating ${u.overallRating}`;
  return [u.city, rating].filter(Boolean).join('  ·  ') || null;
}

/**
 * The second line of a suggestion — why this person is on the screen. A
 * suggestion that cannot say why it is being made is indistinguishable from an
 * advertisement.
 */
function playedLine(s) {
  const n = s.matches ?? 0;
  return n > 1 ? `You have played ${n} matches` : 'You played them recently';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.gutter,
    paddingTop: space.md,
  },
  search: { marginHorizontal: layout.gutter, marginTop: space.lg, marginBottom: space.md },
  list: { paddingHorizontal: layout.gutter, paddingBottom: layout.dockClearance },

  /** The one row on this screen that is not a person. */
  ranks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 60,
    paddingHorizontal: layout.cardPadding,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.sunken,
    marginBottom: space.sm,
  },
  ranksGlyph: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.goldSoft,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 68,
    paddingHorizontal: space.sm,
    borderRadius: layout.radiusInput,
  },
  rowPressed: { backgroundColor: colors.sunken },
  /** A challenge both sides have agreed to is the one row worth looking at. */
  rowReady: {
    backgroundColor: colors.correctSoft,
    borderWidth: 1,
    borderColor: 'rgba(58, 178, 122, 0.34)',
    marginBottom: space.xs,
  },
  /** Badge and place on one line — 20 + 22 still clears the 68pt row. */
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  sent: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm },
  online: {
    position: 'absolute',
    right: 0,
    bottom: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.correct,
    borderWidth: 2,
    borderColor: colors.canvas,
  },
  decline: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },

  invite: {
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xl,
    paddingHorizontal: layout.cardPadding,
    marginTop: space.sm,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.sunken,
  },
  inviteGlyph: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
    marginBottom: space.xs,
  },
  inviteBody: { textAlign: 'center', maxWidth: 280 },
  inviteButton: { marginTop: space.md, alignSelf: 'stretch' },
});

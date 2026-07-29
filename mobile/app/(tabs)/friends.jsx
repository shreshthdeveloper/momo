import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
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
import ReactionSheet from '../../src/components/ReactionSheet.jsx';
import Icon from '../../src/components/Icon.jsx';
import { inviteFriends } from '../../src/lib/share.js';
import { colors, layout, space } from '../../src/theme/index.js';

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

  /**
   * On focus, not on mount.
   *
   * A tab screen mounts once and then stays mounted, so a plain `useEffect`
   * fetched this list a single time for the whole session: a friend request
   * sent from a profile, or a challenge that arrived while the player was on
   * another tab, only appeared after a manual pull-to-refresh. There is no
   * socket event for either — the gateway carries match traffic only — so
   * refetching whenever the screen comes forward is what keeps it honest.
   */
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

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

  /**
   * A once-a-second clock, running only while a challenge is on screen.
   *
   * A challenge is now a two-minute invitation rather than a day-long one
   * (constants.js), and a countdown is the difference between "someone asked
   * you something" and "answer this now". It also lets the list drop rows the
   * moment they lapse, instead of showing a Play button that the server will
   * refuse — the previous behaviour, because nothing re-checked the deadline
   * between refreshes.
   *
   * Gated on there being something to count so an idle Friends tab is not
   * re-rendering every second for nothing.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!challenges.length) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [challenges.length]);

  const liveChallenges = useMemo(
    () => challenges.filter((c) => !c.expiresAt || new Date(c.expiresAt).getTime() > now),
    [challenges, now],
  );

  /**
   * Online first, then by name.
   *
   * Who is online used to be a 12px dot and nothing else. With a two-minute
   * window it is the single most useful fact on the screen — an offline friend
   * cannot accept in time, so a roster sorted alphabetically buries the only
   * people worth challenging right now under the ones who are asleep.
   */
  const friends = useMemo(() => {
    const rows = [...(data?.friends ?? [])];
    return rows.sort((a, b) => {
      if (Boolean(a.isOnline) !== Boolean(b.isOnline)) return a.isOnline ? -1 : 1;
      return String(a.displayName ?? '').localeCompare(String(b.displayName ?? ''));
    });
  }, [data?.friends]);

  const onlineCount = friends.filter((f) => f.isOnline).length;

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

  /**
   * Stable handlers, so the memoised rows below actually stay memoised.
   *
   * The countdown ticks once a second while any challenge is open, and every
   * tick re-renders this component. Without both halves of the fix — `memo` on
   * the row AND a callback identity that does not change — that tick would
   * re-render every friend, every suggestion and every search result once a
   * second to animate two digits on an unrelated card. Passing the row its own
   * data back through the handler is what keeps these free of per-row closures.
   */
  const openProfile = useCallback((id) => router.push(`/user/${id}`), [router]);
  const openChallenge = useCallback(
    (f) =>
      router.push({
        pathname: '/challenge',
        params: { userId: f.id, name: f.displayName, avatarUrl: f.avatarUrl ?? '' },
      }),
    [router],
  );

  /**
   * The nearest thing to chat (see `ReactionSheet`). One sheet for the whole
   * list rather than one per row: six tiles and a modal mounted twenty times
   * over is twenty modals, and only one of them can ever be open.
   */
  const [reactingTo, setReactingTo] = useState(null);
  const openReactions = useCallback((f) => setReactingTo(f), []);
  const closeReactions = useCallback(() => setReactingTo(null), []);

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
                    onOpen={openProfile}
                    onAdd={addFriend}
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
              {liveChallenges.length > 0 ? (
                <>
                  <SectionHeader title="Challenges" />
                  {liveChallenges.map((c) => (
                    <ChallengeRow
                      key={c.id}
                      challenge={c}
                      now={now}
                      onAccept={() => act(() => api.post(`/challenges/${c.id}/accept`))}
                      onDecline={() => act(() => api.post(`/challenges/${c.id}/decline`))}
                      onCancel={() => act(() => api.post(`/challenges/${c.id}/cancel`))}
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
                  {friends.length > 0 ? (
                    <SectionHeader
                      title={
                        onlineCount > 0
                          ? `${onlineCount} online · ${friends.length} friend${friends.length === 1 ? '' : 's'}`
                          : `${friends.length} friend${friends.length === 1 ? '' : 's'}`
                      }
                    />
                  ) : null}
                  {friends.map((f) => (
                    <FriendRow
                      key={f.id}
                      friend={f}
                      onOpen={openProfile}
                      onPlay={openChallenge}
                      onReact={openReactions}
                    />
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
                      onOpen={openProfile}
                      onAdd={addFriend}
                    />
                  ))}
                </>
              ) : null}
            </>
          )}
        </ScrollView>
      )}

      <ReactionSheet
        visible={reactingTo !== null}
        person={reactingTo}
        onClose={closeReactions}
      />
    </SafeAreaView>
  );
}

/**
 * One friend.
 *
 * Extracted and memoised rather than mapped inline. Inline it re-rendered on
 * every parent render, which since the countdown landed means once a second for
 * as long as a challenge is open — twenty rows redrawn to animate two digits on
 * a card none of them are part of. `friend` comes straight off the fetched
 * array so its identity is stable between renders, and the two handlers are
 * `useCallback`s in the parent, so the memo holds.
 */
const FriendRow = memo(function FriendRow({ friend: f, onOpen, onPlay, onReact }) {
  /**
   * The place, or the rating when there is no league badge to say it better.
   * Never both, and never a bare number with nothing naming it.
   */
  const line = f.isOnline
    ? 'Online now'
    : Number.isFinite(f.rankedRating)
      ? (f.city ?? 'Offline')
      : Number.isFinite(f.overallRating)
        ? `Rating ${f.overallRating}`
        : (f.city ?? 'Offline');

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => onOpen(f.id)}
      accessibilityRole="button"
      // Presence is announced, not just tinted green: a screen reader gets
      // nothing from the dot, and online is the fact that decides whether
      // challenging is worth doing at all.
      accessibilityLabel={`${f.displayName}, ${f.isOnline ? 'online now' : 'offline'}. Open profile.`}
    >
      <View>
        <Avatar url={f.avatarUrl} name={f.displayName} size={44} />
        {f.isOnline ? <View style={styles.online} /> : null}
      </View>

      {/* The standing sits beside the presence line rather than on the top
          line with the name and the button, where a long name had about forty
          points to live in and the button — the entire point of the row — was
          what got squeezed. */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="label" numberOfLines={1}>
          {f.displayName}
        </Text>
        <View style={styles.metaRow}>
          {Number.isFinite(f.rankedRating) ? (
            <LeagueBadge rating={f.rankedRating} size="sm" showDivision={false} />
          ) : null}
          <Text
            variant="meta"
            color={f.isOnline ? colors.correct : colors.inkFaint}
            numberOfLines={1}
            style={{ flexShrink: 1 }}
          >
            {line}
          </Text>
        </View>
      </View>

      {/**
        * Say something, in the position every roster puts a message button —
        * left of the primary action, quieter than it.
        *
        * It is an icon and no label, which the guidelines normally forbid, and
        * it earns the exception the way the rule allows: an `accessibilityLabel`
        * for anyone not reading the glyph, and a destination that says its own
        * name the moment it opens. The alternative was a third worded button on
        * a 360dp row, which would have squeezed the name to nothing.
        */}
      <Pressable
        onPress={() => onReact(f)}
        accessibilityRole="button"
        accessibilityLabel={`Send ${f.displayName} a reaction`}
        hitSlop={4}
        style={({ pressed }) => [styles.react, pressed && styles.reactPressed]}
      >
        <Icon name="sparkle" size={17} color={colors.gold} />
      </Pressable>

      {/* Takes its own press, so tapping the name still opens the profile.
          Solid when they are online and soft when they are not: a challenge
          lapses in two minutes, so the button that can actually be answered
          right now should not look identical to the one that cannot. */}
      <Button
        variant={f.isOnline ? 'primary' : 'soft'}
        size="sm"
        label="Play"
        fullWidth={false}
        onPress={() => onPlay(f)}
      />
    </Pressable>
  );
});

/**
 * Somebody who is not a friend yet — a search hit or a suggestion. One row for
 * both, because they are the same object at the same distance and giving them
 * different shapes would imply a difference that is not there.
 */
const PersonRow = memo(function PersonRow({ person, line, asked, onOpen, onAdd }) {
  const ranked = Number.isFinite(person.rankedRating) ? person.rankedRating : null;

  return (
    <View style={styles.row}>
      <Avatar url={person.avatarUrl} name={person.displayName} size={44} />
      <Pressable
        style={({ pressed }) => [{ flex: 1, minWidth: 0 }, pressed && { opacity: 0.7 }]}
        onPress={() => onOpen(person.id)}
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
        <Button
          variant="soft"
          size="sm"
          label="Add"
          fullWidth={false}
          onPress={() => onAdd(person.id)}
        />
      )}
    </View>
  );
});

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
function ChallengeRow({ challenge, now, onAccept, onDecline, onPlay, onCancel }) {
  const { direction, status, opponent, topic } = challenge;
  const ready = status === 'accepted';
  const theirs = direction === 'incoming' && status === 'pending';

  const left = challenge.expiresAt ? new Date(challenge.expiresAt).getTime() - now : null;
  const urgent = left !== null && left <= 30_000;

  const state = ready ? 'Ready' : theirs ? 'Wants to play' : 'Waiting for them';
  const topicName = topic?.name ?? 'A topic';

  return (
    <View style={[styles.challenge, ready && styles.challengeReady]}>
      <View style={styles.challengeHead}>
        <Avatar url={opponent?.avatarUrl} name={opponent?.displayName} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="label" numberOfLines={1}>
            {opponent?.displayName ?? 'Someone'}
          </Text>
          {/*
            The topic, on its own line and never abbreviated.
            It used to be tacked onto the end of a status sentence and dropped
            altogether once the challenge was accepted — so the row that was
            one tap from starting a match was the one row that would not say
            what the match was about.
          */}
          <Text variant="meta" color={colors.inkMuted} numberOfLines={1}>
            {topicName}
          </Text>
        </View>

        <View style={styles.challengeState}>
          {left !== null ? (
            <Text
              variant="label"
              color={urgent ? colors.wrong : ready ? colors.correct : colors.inkMuted}
              style={styles.countdown}
            >
              {formatLeft(left)}
            </Text>
          ) : null}
          <Text variant="tiny" color={ready ? colors.correct : colors.inkFaint}>
            {state}
          </Text>
        </View>
      </View>

      {/*
        Actions on their own row, full width.
        As trailing icons they were a 34pt target crammed against a button on a
        375pt screen, and two of the three states had no way out at all: a
        challenge you sent could not be taken back, and once accepted neither
        side could clear it. Every open state now has a decline.
      */}
      <View style={styles.challengeActions}>
        {ready ? (
          <Button label="Play now" onPress={onPlay} style={{ flex: 1 }} />
        ) : theirs ? (
          <Button label="Accept" onPress={onAccept} style={{ flex: 1 }} />
        ) : (
          <View style={[styles.waiting, { flex: 1 }]}>
            <Icon name="clock" size={14} color={colors.inkFaint} />
            <Text variant="meta" color={colors.inkFaint}>
              Waiting for them to accept
            </Text>
          </View>
        )}
        <Button
          variant="outline"
          label={theirs ? 'Decline' : 'Cancel'}
          onPress={theirs ? onDecline : onCancel}
          style={styles.challengeDismiss}
        />
      </View>
    </View>
  );
}

/** `1:45`, then `45s` under a minute — the unit only appears when it changes. */
function formatLeft(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
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
  /**
   * 40 wide, 44 tall, plus 4 of slop on every side — 48 × 52 of actual target,
   * clear of both platform minimums, and it costs the name beside it forty
   * points rather than the sixty a worded button would have.
   */
  react: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: layout.radiusInput,
    backgroundColor: colors.goldSoft,
  },
  reactPressed: { backgroundColor: 'rgba(245, 182, 46, 0.26)' },

  /**
   * A challenge is a card, not a list row.
   *
   * It carries four things a roster row does not — who, which topic, how long
   * is left, and two actions — and squeezing those into a 68pt row meant the
   * topic got truncated and the dismiss became a 34pt icon wedged against a
   * button. A card gives each of them a line and lets both actions be real
   * touch targets.
   */
  challenge: {
    gap: space.md,
    padding: layout.cardPadding,
    marginBottom: space.sm,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.sunken,
  },
  /** Both sides have agreed — the one card worth looking at twice. */
  challengeReady: {
    backgroundColor: colors.correctSoft,
    borderColor: 'rgba(58, 178, 122, 0.34)',
  },
  challengeHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  challengeState: { alignItems: 'flex-end', gap: 1 },
  challengeActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  /** Hugs its label rather than splitting the row evenly with the primary. */
  challengeDismiss: { minWidth: 96 },
  waiting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs },
  /** Badge and place on one line — 20 + 22 still clears the 68pt row. */
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  /**
   * Tabular figures, so a countdown ticking 1:00 → 0:59 does not change width
   * and shove the sentence beside it a pixel left every second.
   */
  countdown: { fontVariant: ['tabular-nums'], minWidth: 34 },
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

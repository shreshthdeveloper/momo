import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/lib/api.js';
import { useAuth } from '../src/state/auth.jsx';
import { useNotifications } from '../src/state/notifications.jsx';
import { Text, Header, EmptyState, ErrorNotice } from '../src/components/ui.jsx';
import { ListSkeleton } from '../src/components/Skeletons.jsx';
import Icon from '../src/components/Icon.jsx';
import { withAlpha } from '../src/components/TopicMedallion.jsx';
import { colors, layout, space } from '../src/theme/index.js';
import { destinationFor, faceFor } from '../src/lib/notifications.js';

/**
 * prd.md §6.9 — the in-app list.
 *
 * The server side of this has been complete for a long time and nothing ever
 * read it: eleven call sites across friends, challenges, contests, assignments,
 * chests and the streak job write `Notification` rows, `GET /me/notifications`
 * returns them with an unread count, and the app had no screen. Every one of
 * those events was therefore invisible unless the player happened to be looking
 * at the exact screen it concerned.
 *
 * ── Seen is not the same as read ─────────────────────────────────────────────
 *
 * Opening this screen marks everything read on the SERVER, which clears the
 * badge, while the rows keep the unread treatment they arrived with for as long
 * as you are standing here. Marking on tap alone leaves a badge burning over a
 * list you have already looked at; marking and instantly restyling makes the
 * screen flinch and takes away the only thing telling you which of these you
 * had not seen. The distinction is the same one every mail client draws, and
 * `readAtSnapshot` below is the whole implementation of it.
 *
 * ── Unread is a dot and a fill, never a colour alone ─────────────────────────
 *
 * A tint by itself fails for anyone who cannot separate it from the card
 * beneath, so the state is carried three ways: a filled dot, a lifted surface,
 * and a brighter title.
 */
export default function NotificationsScreen() {
  const router = useRouter();
  const { activeSpaceId, setActiveSpaceId } = useAuth();
  const { markAllRead } = useNotifications();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * The read/unread flags as they were when this screen opened, keyed by id.
   * The list re-fetches on pull, and without this a refresh would silently
   * repaint every row as read — see the note above.
   */
  const readAtSnapshot = useRef(new Map());
  const markedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.get('/me/notifications', { limit: 40 });
      const rows = data.items ?? [];
      for (const row of rows) {
        if (!readAtSnapshot.current.has(row.id)) readAtSnapshot.current.set(row.id, row.read);
      }
      setItems(rows);

      // Once, and only if there was something to clear. Firing it on every pull
      // would spend a request to mark zero rows.
      if (!markedRef.current && data.unread > 0) {
        markedRef.current = true;
        // The bell goes quiet on this frame rather than after the round trip:
        // the screen showing the rows IS the acknowledgement.
        markAllRead();
        api.post('/me/notifications/read', {}).catch(() => {});
      }
    } catch (err) {
      setError(err);
    }
  }, [markAllRead]);

  useEffect(() => {
    load();
  }, [load]);

  const open = useCallback(
    (item) => {
      const to = destinationFor(item);
      if (!to) return;
      /**
       * Land in the organization the notification came from.
       *
       * Contests and assignments are org-scoped and the active space resets to
       * the Public Arena on every launch, so tapping "Contest X is open" from
       * a cold start used to ask the Arena for an org's contest: both fetches
       * came back empty and the screen sat on its skeleton for ever, or told a
       * student their organization had set no work.
       */
      if (item.spaceId && item.spaceId !== activeSpaceId) setActiveSpaceId(item.spaceId);
      router.push(to);
    },
    [router, activeSpaceId, setActiveSpaceId],
  );

  const shown = useMemo(
    () =>
      (items ?? []).map((n) => ({ ...n, read: readAtSnapshot.current.get(n.id) ?? n.read })),
    [items],
  );

  const renderItem = useCallback(
    ({ item }) => <NotificationRow item={item} onPress={open} />,
    [open],
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header title="Notifications" onBack={() => router.back()} />
      <ErrorNotice error={error} onRetry={load} />

      {!items && !error ? (
        <ListSkeleton rows={6} trailing={false} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon="bell"
          title="Nothing yet"
          body="Challenges, friend requests and the rewards you unlock all land here."
        />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(n) => n.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
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
        />
      )}
    </SafeAreaView>
  );
}

/**
 * `memo`, because the list re-renders whenever the pull-to-refresh spinner
 * changes state and a row's own content has not moved.
 */
const NotificationRow = memo(function NotificationRow({ item, onPress }) {
  const face = faceFor(item);
  const tappable = destinationFor(item) !== null;

  return (
    <Pressable
      onPress={tappable ? () => onPress(item) : undefined}
      disabled={!tappable}
      accessibilityRole={tappable ? 'button' : 'text'}
      accessibilityLabel={`${item.read ? '' : 'Unread. '}${item.title}${
        item.body ? `. ${item.body}` : ''
      }. ${ago(item.at)}`}
      style={({ pressed }) => [
        styles.row,
        !item.read && styles.rowUnread,
        pressed && tappable && { opacity: 0.72 },
      ]}
    >
      <View style={[styles.glyph, { backgroundColor: withAlpha(face.tint, 0.16) }]}>
        <Icon name={face.icon} size={17} color={face.tint} />
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" color={item.read ? colors.inkMuted : colors.ink}>
          {item.title}
        </Text>
        {item.body ? (
          <Text variant="meta" color={colors.inkFaint}>
            {item.body}
          </Text>
        ) : null}
      </View>

      <View style={styles.trail}>
        <Text variant="tiny" color={colors.inkFaint}>
          {ago(item.at)}
        </Text>
        {/* The dot is what carries "unread" for anyone the tint does not reach. */}
        {item.read ? null : <View style={styles.dot} />}
      </View>
    </Pressable>
  );
});

/**
 * Short relative time. Deliberately coarse past a day — "3d" is as much as
 * anyone needs from a list they are scanning, and a precise timestamp would
 * make every row a different width.
 */
function ago(at) {
  const ms = Date.now() - new Date(at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  list: { paddingHorizontal: layout.gutter, paddingBottom: space.xxl, gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    // Two lines of type plus padding, and comfortably past the 44pt minimum.
    minHeight: 64,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: layout.radiusInput,
    backgroundColor: colors.sunken,
    borderWidth: 1,
    borderColor: colors.transparent,
  },
  /** Lifted off the field and edged, so unread reads as nearer rather than bluer. */
  rowUnread: { backgroundColor: colors.nightRaised, borderColor: colors.hairline },
  glyph: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  trail: { alignItems: 'flex-end', gap: 6, minWidth: 30 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
});

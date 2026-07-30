import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { api } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import { subscribe } from '../lib/liveEvents.js';
import { S2C } from '../shared/protocol.js';

/**
 * The inbox, as live state.
 *
 * Two jobs, and the second is the one that was missing entirely:
 *
 *   1. the unread count the bell wears, kept current rather than fetched once
 *      when Home happened to mount;
 *   2. a queue of things that have just arrived, for the banner to announce.
 *
 * Before this, the ONLY way to discover anything had happened was to navigate
 * to Home and notice the bell had a number on it — so a friend request that
 * arrived while you were in the shop, on a topic, or halfway through a match
 * simply sat there until you went looking for it. The row was written, the
 * push was dead, and nothing on screen ever changed.
 *
 * The socket is the delivery path (see `game.jsx`, which owns it); the fetch on
 * foreground is the backstop for anything that landed while the app was closed
 * or the connection was down.
 */

const NotificationsContext = createContext(null);

/** How many banners may stack before the rest simply wait their turn. */
const QUEUE_MAX = 3;

/**
 * Notification types that change what the ACCOUNT can reach, not just what it
 * has been told.
 *
 * `space_approved` is the one that mattered and the one that was missed. Joining
 * an organization whose door policy is "approval" writes a PENDING membership,
 * so `/spaces/mine` correctly returns nothing playable and the app is right to
 * show nothing. When the admin approves, the server flips the row to `active`
 * and sends this — and the client knew only how to draw its icon. Nothing
 * refetched the membership list, so the organization stayed invisible until the
 * next cold sign-in, which is why joining appeared to require a re-login.
 *
 * A notification that says "you are in" has to be the thing that makes it true
 * on screen.
 *
 * Only `space_approved` is listed because it is the only one the server sends.
 * Suspension and removal write no notification at all, so they cannot be caught
 * here — the foreground refresh below is what covers those.
 */
const REFRESHES_MEMBERSHIPS = new Set(['space_approved']);

export function NotificationsProvider({ children }) {
  const { isAuthenticated, refreshSpaces } = useAuth();
  const [unread, setUnread] = useState(0);
  /** Arrived and not yet shown. The banner shifts one off at a time. */
  const [queue, setQueue] = useState([]);
  /** Ids already queued, so a refetch cannot announce the same row twice. */
  const seen = useRef(new Set());

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      // `unread=1` is the parameter the route reads — `unreadOnly` is silently
      // dropped by the schema's removeAdditional, which would quietly fetch the
      // whole list instead of the unread ones.
      const data = await api.get('/me/notifications', { unread: '1', limit: 30 });
      setUnread(data?.unread ?? (data?.items ?? []).length);
      // Rows fetched here are NOT announced: they may be days old, and a
      // fistful of banners on launch is not a notification, it is a wall.
      const items = data?.items ?? [];
      for (const item of items) seen.current.add(item.id);
      /**
       * ...but an unread approval still has to take effect. This is the path
       * that catches an approval granted while the app was closed or offline:
       * the row arrives in this fetch rather than over the socket, and without
       * this the organization would stay invisible exactly as before.
       */
      if (items.some((item) => REFRESHES_MEMBERSHIPS.has(item.type))) {
        refreshSpaces().catch(() => {});
      }
    } catch {
      // The bell keeps whatever it last knew. A count is not worth an error.
    }
  }, [isAuthenticated, refreshSpaces]);

  useEffect(() => {
    if (!isAuthenticated) {
      setUnread(0);
      setQueue([]);
      seen.current = new Set();
      return;
    }
    refresh();
  }, [isAuthenticated, refresh]);

  /**
   * Anything that landed while the app was away — notifications AND memberships.
   *
   * The membership half covers what no notification can: an admin suspending or
   * removing somebody writes no notification, so a player who has been removed
   * would otherwise keep seeing the organization's topics until they signed out
   * and in again. Coming back to the app is the natural moment to re-ask who you
   * are a member of, and it is one request.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      refresh();
      if (isAuthenticated) refreshSpaces().catch(() => {});
    });
    return () => sub.remove();
  }, [refresh, isAuthenticated, refreshSpaces]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    return subscribe(S2C.NOTIFICATION, (item) => {
      if (!item?.id || seen.current.has(item.id)) return;
      seen.current.add(item.id);
      setUnread((n) => n + 1);
      setQueue((q) => (q.length >= QUEUE_MAX ? q : [...q, item]));
      // Live path: the banner and the membership land on the same frame, so
      // tapping through from "You are in Greenfield High" finds it there.
      if (REFRESHES_MEMBERSHIPS.has(item.type)) refreshSpaces().catch(() => {});
    });
  }, [isAuthenticated, refreshSpaces]);

  /** The banner has finished with the front of the queue. */
  const dismiss = useCallback(() => setQueue((q) => q.slice(1)), []);

  /**
   * Opening the inbox clears the badge here as well as on the server, so the
   * bell goes quiet on the same frame the screen opens rather than after a
   * round trip.
   */
  const markAllRead = useCallback(() => {
    setUnread(0);
    setQueue([]);
  }, []);

  const value = useMemo(
    () => ({ unread, pending: queue[0] ?? null, dismiss, markAllRead, refresh }),
    [unread, queue, dismiss, markAllRead, refresh],
  );

  return (
    <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext) ?? { unread: 0, pending: null };
}

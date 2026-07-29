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

export function NotificationsProvider({ children }) {
  const { isAuthenticated } = useAuth();
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
      for (const item of data?.items ?? []) seen.current.add(item.id);
    } catch {
      // The bell keeps whatever it last knew. A count is not worth an error.
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setUnread(0);
      setQueue([]);
      seen.current = new Set();
      return;
    }
    refresh();
  }, [isAuthenticated, refresh]);

  // Anything that landed while the app was away.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    return subscribe(S2C.NOTIFICATION, (item) => {
      if (!item?.id || seen.current.has(item.id)) return;
      seen.current.add(item.id);
      setUnread((n) => n + 1);
      setQueue((q) => (q.length >= QUEUE_MAX ? q : [...q, item]));
    });
  }, [isAuthenticated]);

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

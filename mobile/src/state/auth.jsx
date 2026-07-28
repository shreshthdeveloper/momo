import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, auth, loadTokens, clearTokens, setUnauthenticatedHandler } from '../lib/api.js';
import { loadHapticsPreference } from '../lib/haptics.js';
import { loadSoundPreference } from '../lib/sound.js';
import { PUBLIC_SPACE_ID } from '../shared/constants.js';

/**
 * Who the player is, and which world they are in.
 *
 * prd.md F6.2.5 — the space switcher moves between the Public Arena and any
 * joined Space. The active space is only a request preference: the server
 * resolves real memberships on every call (tech.md §4), so switching here
 * cannot grant access it should not have.
 */

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [spaces, setSpaces] = useState([]);
  const [activeSpaceId, setActiveSpaceId] = useState(PUBLIC_SPACE_ID);
  const [booting, setBooting] = useState(true);

  const refreshProfile = useCallback(async () => {
    const me = await api.get('/me');
    setUser(me);
    return me;
  }, []);

  const refreshSpaces = useCallback(async () => {
    try {
      const { items } = await api.get('/spaces/mine');
      setSpaces(items ?? []);
      return items ?? [];
    } catch {
      return [];
    }
  }, []);

  // Boot: restore tokens, then confirm the session is still good.
  useEffect(() => {
    let alive = true;
    (async () => {
      // Ride along with the boot round trip rather than adding more of them.
      loadHapticsPreference();
      loadSoundPreference();
      const hasTokens = await loadTokens();
      if (hasTokens) {
        try {
          const me = await api.get('/me');
          if (!alive) return;
          setUser(me);
          await refreshSpaces();
        } catch {
          await clearTokens();
        }
      }
      if (alive) setBooting(false);
    })();
    return () => {
      alive = false;
    };
  }, [refreshSpaces]);

  useEffect(() => {
    setUnauthenticatedHandler(() => setUser(null));
  }, []);

  const signInWithOtp = useCallback(
    async (phone, code) => {
      const data = await auth.verifyOtp(phone, code);
      setUser(data.user);
      await refreshSpaces();
      return data;
    },
    [refreshSpaces],
  );

  const signOut = useCallback(async () => {
    await auth.logout();
    setUser(null);
    setSpaces([]);
    setActiveSpaceId(PUBLIC_SPACE_ID);
  }, []);

  const updateProfile = useCallback(async (patch) => {
    const updated = await api.patch('/me', patch);
    setUser(updated);
    return updated;
  }, []);

  const joinSpace = useCallback(
    async (code) => {
      const result = await api.post('/spaces/join', { code });
      await refreshSpaces();
      return result;
    },
    [refreshSpaces],
  );

  const activeSpace = useMemo(
    () => spaces.find((s) => s.id === activeSpaceId) ?? null,
    [spaces, activeSpaceId],
  );

  const value = useMemo(
    () => ({
      user,
      booting,
      isAuthenticated: Boolean(user),
      /** prd.md F6.1.3/F6.1.4 — onboarding is not done until both are set. */
      needsProfile: Boolean(user && !user.displayName),
      needsInterests: Boolean(user && (user.interests?.length ?? 0) === 0),
      spaces,
      activeSpaceId,
      activeSpace,
      isPublicArena: activeSpaceId === PUBLIC_SPACE_ID,
      setActiveSpaceId,
      signInWithOtp,
      signOut,
      updateProfile,
      joinSpace,
      refreshProfile,
      refreshSpaces,
    }),
    [
      user, booting, spaces, activeSpaceId, activeSpace,
      signInWithOtp, signOut, updateProfile, joinSpace, refreshProfile, refreshSpaces,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

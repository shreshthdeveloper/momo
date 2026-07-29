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

/**
 * Did the server actually refuse this session, as opposed to the request never
 * reaching one?
 *
 * `OFFLINE` and `TIMEOUT` are raised by the API client with status 0 when fetch
 * itself failed, and they say nothing whatsoever about whether the tokens are
 * still good.
 */
function isAuthRejection(err) {
  if (err?.status === 401 || err?.status === 403) return true;
  return ['UNAUTHENTICATED', 'TOKEN_EXPIRED', 'REFRESH_FAILED'].includes(err?.code);
}

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
        } catch (err) {
          /**
           * Only an actual rejection ends the session.
           *
           * This used to clear the tokens on ANY failure, which included the
           * `OFFLINE` and `TIMEOUT` errors the API client raises when the phone
           * has no signal — so opening the app in a dead zone or during a
           * server blip silently signed the player out and made them redo phone
           * and OTP. A dropped packet is not a revoked session: the tokens stay,
           * the player stays signed in, and the next request settles it.
           */
          if (isAuthRejection(err)) await clearTokens();
          if (!alive) return;
        }
      }
      if (alive) setBooting(false);
    })();
    return () => {
      alive = false;
    };
  }, [refreshSpaces]);

  useEffect(() => {
    // An eviction has to clear the whole session, not just the name on it.
    // Leaving `spaces` and `activeSpaceId` behind meant the next account to
    // sign in on this phone inherited the previous one's organization as its
    // active space, and every org-scoped call 403'd until they switched by hand.
    setUnauthenticatedHandler(() => {
      setUser(null);
      setSpaces([]);
      setActiveSpaceId(PUBLIC_SPACE_ID);
    });
  }, []);

  const signInWithOtp = useCallback(
    async (phone, code) => {
      const data = await auth.verifyOtp(phone, code);
      setUser(data.user);
      // Whoever was here before, this account starts in the Arena until its
      // own memberships arrive.
      setActiveSpaceId(PUBLIC_SPACE_ID);
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
      /**
       * The first sign-up step this account has not finished, or null.
       *
       * Each step saves as it goes so the flow "can be resumed rather than
       * restarted" — but nothing ever resumed it: the router only checked for a
       * display name, which exists from step one, so an app killed after the
       * name landed the player on Home with no face and no country and no way
       * back into the flow.
       *
       * Interests are deliberately absent: that step ships with a Skip, and a
       * skipped step is a finished one.
       */
      onboardingStep: !user
        ? null
        : !user.displayName
          ? 'profile'
          : !user.avatarUrl
            ? 'avatar'
            : !user.country
              ? 'country'
              : null,
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

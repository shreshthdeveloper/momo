import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { api } from '../lib/api.js';
import { setRemoteFaces } from '../lib/avatar.js';
import { setActiveLadder } from '../lib/league.js';
import { DEFAULT_CATALOGUE } from '../shared/perks.js';
import { LEAGUES, LEAGUE_DIVISIONS, LEAGUE_DIVISION_WIDTH } from '../shared/constants.js';

/**
 * The progression config, as served (leagues-and-progression.md §9).
 *
 * What the catalogue costs, what the leagues are called and which avatars are
 * free are all things a superadmin changes without shipping a build, so the
 * app asks. What it never does is *compute* with any of it: the server sends
 * the level, the league and every ownership flag, and this config exists only
 * so a screen can put a name and a price next to a picture.
 *
 * Three layers, in order of trust:
 *
 *   1. the server's answer, fetched on launch
 *   2. the last answer this device saw, replayed from secure storage
 *   3. the set compiled into the build
 *
 * Layer 3 is why there is no loading state to design around: the picker always
 * has something to draw, and the network only ever improves it.
 */

const CACHE_KEY = 'mimo.progressionConfig';

const BUILT_IN = {
  version: 0,
  token: null,
  accountCurve: null,
  leagues: LEAGUES.map((l) => ({ ...l, color: null })),
  divisions: LEAGUE_DIVISIONS,
  divisionWidth: LEAGUE_DIVISION_WIDTH,
  cosmetics: DEFAULT_CATALOGUE,
  chests: [],
};

const ProgressionContext = createContext({ config: BUILT_IN, refresh: () => {} });

export function ProgressionProvider({ children }) {
  const [config, setConfig] = useState(BUILT_IN);
  /**
   * The token held, so a refetch can ask for nothing when nothing changed.
   * A token rather than a version number: a re-seeded database starts its
   * counter over, and a client comparing counters would decide it was already
   * up to date with a catalogue that no longer exists.
   */
  const token = useRef(null);

  const apply = useCallback((next) => {
    if (!next?.cosmetics) return;
    token.current = next.token ?? null;
    setConfig(next);
    // Published before anything renders, for the same reason as the faces: a
    // badge drawn from a stale ladder names a league that no longer exists.
    setActiveLadder({
      leagues: next.leagues,
      divisions: next.divisions,
      divisionWidth: next.divisionWidth,
    });
    // Register uploaded art before anything renders it: a face added after
    // this build shipped has to resolve everywhere a bundled one does.
    setRemoteFaces(
      Object.fromEntries(
        next.cosmetics
          .filter((c) => c.type === 'avatar' && c.imageUrl)
          .map((c) => [c.key, c.imageUrl]),
      ),
    );
  }, []);

  const refresh = useCallback(async () => {
    try {
      const fresh = await api.get(
        token.current
          ? `/config/progression?token=${encodeURIComponent(token.current)}`
          : '/config/progression',
      );
      if (fresh?.unchanged) return;
      apply(fresh);
      await SecureStore.setItemAsync(CACHE_KEY, JSON.stringify(fresh)).catch(() => {});
    } catch {
      // Offline, or the API is down. The cached copy — or failing that the
      // built-in one — is already on screen, and progression is not the thing
      // to interrupt a player about.
    }
  }, [apply]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cached = await SecureStore.getItemAsync(CACHE_KEY);
        if (cached && alive) apply(JSON.parse(cached));
      } catch {
        // A corrupt cache is not worth reporting; the built-in set stands in.
      }
      if (alive) await refresh();
    })();
    return () => {
      alive = false;
    };
  }, [apply, refresh]);

  const value = useMemo(() => ({ config, refresh }), [config, refresh]);
  return <ProgressionContext.Provider value={value}>{children}</ProgressionContext.Provider>;
}

export function useProgression() {
  return useContext(ProgressionContext);
}

/** The catalogue rows of one type, in the order the operator arranged them. */
export function useCosmetics(type) {
  const { config } = useProgression();
  return useMemo(
    () =>
      (config.cosmetics ?? [])
        .filter((c) => c.type === type)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [config, type],
  );
}

/**
 * What sign-up offers: the free tier and nothing else.
 *
 * A brand-new account owns exactly these, so showing anything else on the
 * registration step means showing a grid where most taps do nothing.
 */
export function useFreeAvatars() {
  const avatars = useCosmetics('avatar');
  return useMemo(() => avatars.filter((c) => c.unlockKind === 'free'), [avatars]);
}

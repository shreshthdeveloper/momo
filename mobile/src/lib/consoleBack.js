import { useCallback } from 'react';
import { useRouter, useSegments } from 'expo-router';

/**
 * A back button that cannot fall off the end of the stack.
 *
 * The consoles navigate by REPLACE — the sidebar is the navigation, so pushing
 * every section would build a stack nobody asked for. But that means a screen
 * opened from the sidebar has no history behind it, and `router.back()` there
 * throws the navigator's "GO_BACK was not handled by any navigator" straight at
 * the user. It is exactly what happened on signing in as an admin: the console
 * lands on a replaced route, and the first back press had nowhere to go.
 *
 * So: go back if there is anywhere to go, and otherwise return to the console's
 * own root, which is the honest destination for "out of here" on a screen that
 * was entered directly.
 */
export function useConsoleBack() {
  const router = useRouter();
  const segments = useSegments();
  const root = segments[0] === 'super' ? '/super' : '/admin';

  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(root);
  }, [router, root]);
}

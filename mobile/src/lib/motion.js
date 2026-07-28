import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * design.md §7 — reduced motion is respected throughout.
 *
 * "Every animation degrades to an instant state change or a 120ms opacity
 * fade. The bubble still fills, because the fill is state rather than
 * decoration — it simply appears without the spread."
 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => alive && setReduced(value))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);

  return reduced;
}

/** Duration helper: collapses to the reduced-motion fade when required. */
export const duration = (ms, reduced) => (reduced ? Math.min(ms, 120) : ms);

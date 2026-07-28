import { Stack } from 'expo-router';
import { colors, motion } from '../../src/theme/index.js';

/**
 * design.md §8.1 — the title screen, then one idea per screen the whole way:
 * number → code, then name → face → country → organization → interests. Each
 * sign-up step saves as it is passed, so the flow can be resumed rather than
 * restarted. There is still no feature tour — the match is learnt by playing
 * one.
 */
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        animationDuration: motion.screen,
        contentStyle: { backgroundColor: colors.canvas },
      }}
    />
  );
}

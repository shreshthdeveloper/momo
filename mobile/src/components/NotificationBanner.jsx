import { useEffect, useRef } from 'react';
import { Animated, Easing, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './ui.jsx';
import Icon from './Icon.jsx';
import { withAlpha } from './TopicMedallion.jsx';
import { useNotifications } from '../state/notifications.jsx';
import { useGame } from '../state/game.jsx';
import { useAuth } from '../state/auth.jsx';
import { destinationFor, faceFor } from '../lib/notifications.js';
import { useReducedMotion } from '../lib/motion.js';
import { tap } from '../lib/haptics.js';
import { colors, elevation, layout, space } from '../theme/index.js';

/**
 * "Priya wants to be friends" — where you are standing, when it happens.
 *
 * The inbox has always existed and there was no way to learn anything had
 * arrived in it without going to Home and noticing the bell had changed. This
 * is the other half: the same row, announced once, wherever the player is.
 *
 * Three rules it has to follow, and the third is the important one:
 *
 *   1. It says what happened and goes to the screen that answers it — the same
 *      glyph and the same destination as the inbox row, from the same map, so
 *      the banner cannot promise something the list contradicts.
 *   2. It leaves on its own. A notification that has to be dismissed is a
 *      dialog, and the player did not ask for a dialog.
 *   3. It NEVER covers a live match. Seven questions at ten seconds each is the
 *      one part of this product where a banner over the question costs the
 *      player something real. Anything that lands mid-match waits in the queue
 *      and is announced when the match is over.
 */

/** Long enough to read a name and a line, short enough not to be furniture. */
const DWELL_MS = 4200;
const IN_MS = 260;
const OUT_MS = 180;

/** Statuses in which the player is playing and must not be interrupted. */
const IN_MATCH = ['found', 'countdown', 'playing', 'resolved', 'leaving'];

export default function NotificationBanner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { isAuthenticated } = useAuth();
  const { pending, dismiss } = useNotifications();
  const game = useGame();

  const drop = useRef(new Animated.Value(0)).current;
  const timer = useRef(null);

  const busy = IN_MATCH.includes(game.status);
  const item = isAuthenticated && !busy ? pending : null;

  /** Slide out, then let the provider move to the next one. */
  const leave = useRef(() => {});
  leave.current = () => {
    clearTimeout(timer.current);
    Animated.timing(drop, {
      toValue: 0,
      duration: reduced ? 0 : OUT_MS,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => dismiss());
  };

  useEffect(() => {
    if (!item) return undefined;
    tap();
    Animated.timing(drop, {
      toValue: 1,
      duration: reduced ? 0 : IN_MS,
      easing: Easing.out(Easing.back(1.2)),
      useNativeDriver: true,
    }).start();

    clearTimeout(timer.current);
    timer.current = setTimeout(() => leave.current(), DWELL_MS);
    return () => clearTimeout(timer.current);
  }, [item, drop, reduced]);

  /**
   * An upward flick dismisses it, which is where the thumb goes for a thing
   * that came from the top. Horizontal movement is ignored so a swipe meant
   * for the screen underneath is not eaten by a banner passing through.
   */
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy < -6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderRelease: (_e, g) => {
        if (g.dy < -20) leave.current();
      },
    }),
  ).current;

  if (!item) return null;

  const face = faceFor(item);
  const to = destinationFor(item);

  return (
    <Animated.View
      {...pan.panHandlers}
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          paddingTop: insets.top + space.xs,
          opacity: drop,
          transform: [
            { translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [-140, 0] }) },
          ],
        },
      ]}
      accessibilityLiveRegion="polite"
    >
      <Pressable
        onPress={() => {
          clearTimeout(timer.current);
          // The row is answered on the screen that can answer it — and the
          // banner is gone before the navigation lands, so it never trails the
          // player onto the screen it just sent them to.
          leave.current();
          if (to) router.push(to);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}${item.body ? `. ${item.body}` : ''}${
          to ? '. Opens the screen.' : ''
        }`}
        style={({ pressed }) => [styles.card, elevation.floating, pressed && styles.pressed]}
      >
        <View style={[styles.face, { backgroundColor: withAlpha(face.tint, 0.16) }]}>
          <Icon name={face.icon} size={18} color={face.tint} />
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="label" numberOfLines={1}>
            {item.title}
          </Text>
          {item.body ? (
            <Text variant="meta" color={colors.inkMuted} numberOfLines={2}>
              {item.body}
            </Text>
          ) : null}
        </View>

        {to ? <Icon name="chevronRight" size={16} color={colors.inkFaint} /> : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 60,
    paddingHorizontal: space.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.canvas,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  pressed: { opacity: 0.85 },
  face: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

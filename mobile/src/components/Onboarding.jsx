import { useEffect, useRef } from 'react';
import { Animated, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, IconButton } from './ui.jsx';
import { colors, layout, space } from '../theme/index.js';
import { useReducedMotion } from '../lib/motion.js';

/**
 * The onboarding scaffold — one question per screen.
 *
 * design.md §8.1 asks for one idea per screen, and the sign-up form used to
 * break that rule badly: name, face, country and code all stacked in a single
 * scroll. Split into steps, each screen can ask its question in full size and
 * answer it with one control, which is the difference between filling a form
 * and being asked something.
 *
 * The progress rail is segmented rather than a percentage bar because the
 * question a person actually has is "how many more of these", and segments
 * answer it by counting. Content arrives as one staggered rise so the screen
 * assembles rather than blinks — 3 elements, ~60ms apart, all transform and
 * opacity so it stays on the compositor.
 */
export function StepScaffold({
  step,
  total,
  title,
  subtitle,
  onBack,
  children,
  footer,
  scroll = false,
}) {
  const reduced = useReducedMotion();
  const enter = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) return;
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: 520,
      useNativeDriver: true,
    }).start();
  }, [enter, reduced, step]);

  /** A slice of the shared timeline: rises 14px and fades in over its window. */
  const slice = (from, to) => ({
    opacity: enter.interpolate({ inputRange: [from, to], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [
      {
        translateY: enter.interpolate({
          inputRange: [from, to],
          outputRange: [14, 0],
          extrapolate: 'clamp',
        }),
      },
    ],
  });

  const Body = scroll ? ScrollView : View;
  const bodyProps = scroll
    ? {
        contentContainerStyle: styles.scrollBody,
        showsVerticalScrollIndicator: false,
        keyboardShouldPersistTaps: 'handled',
      }
    : { style: styles.body };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      {/**
       * Android gets a behaviour too, and that is the whole point of this line.
       *
       * `behavior={undefined}` makes `KeyboardAvoidingView` render as a plain
       * `View` that does nothing at all, which left the entire sign-up flow —
       * every screen of it, each one auto-focusing its input — relying on the
       * window resizing itself under `adjustResize`. The app is edge-to-edge, so
       * on Android 15 and up the window does NOT resize for the keyboard, and
       * the code entry and its Confirm button sat under the number pad. Older
       * Android still resized, which is why this looked fine on one phone and
       * broken on the next.
       *
       * `padding` is safe in both regimes because it pads by the OVERLAP between
       * the keyboard and this view's own frame: where the window already
       * resized, the frame ends above the keyboard and the padding is zero.
       */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <View style={styles.head}>
          {onBack ? (
            <IconButton name="back" onPress={onBack} label="Back" />
          ) : (
            <View style={styles.backSpacer} />
          )}
          {/* A rail of one segment is not progress, it is a full bar over a
              screen that has not been filled in — a manager's name step is the
              whole flow, so it goes without. */}
          {total > 1 ? (
            <View
              style={styles.rail}
              accessibilityRole="progressbar"
              accessibilityLabel={`Step ${step} of ${total}`}
            >
              {Array.from({ length: total }).map((_, i) => (
                <View key={i} style={[styles.segment, i < step && styles.segmentOn]} />
              ))}
            </View>
          ) : (
            <View style={styles.rail} />
          )}
        </View>

        <Animated.View style={[styles.titles, slice(0, 0.55)]}>
          <Text variant="display">{title}</Text>
          {subtitle ? (
            <Text variant="body" color={colors.inkMuted} style={styles.subtitle}>
              {subtitle}
            </Text>
          ) : null}
        </Animated.View>

        <Animated.View style={[styles.flex, slice(0.2, 0.8)]}>
          <Body {...bodyProps}>{children}</Body>
        </Animated.View>

        <Animated.View style={[styles.footer, slice(0.4, 1)]}>{footer}</Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.gutter,
    paddingVertical: space.md,
  },
  /** Holds the rail's left edge steady on the screens with no back arrow. */
  backSpacer: { width: 40, height: 40 },
  rail: { flex: 1, flexDirection: 'row', gap: 6 },
  segment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.hairline },
  segmentOn: { backgroundColor: colors.accent },
  titles: { paddingHorizontal: layout.gutter, paddingTop: space.lg, paddingBottom: space.xl },
  subtitle: { marginTop: space.sm },
  body: { flex: 1, paddingHorizontal: layout.gutter },
  scrollBody: { paddingHorizontal: layout.gutter, paddingBottom: space.xl },
  footer: { paddingHorizontal: layout.gutter, paddingTop: space.md, paddingBottom: space.md },
});

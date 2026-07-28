import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './ui.jsx';
import Icon from './Icon.jsx';
import { colors, elevation, layout, space } from '../theme/index.js';

/**
 * The console dock — the manager's tab bar.
 *
 * Same floating-pill language as the player dock (design.md §8.15) so the
 * admin app feels like the same product, but with no raised Play button:
 * managers run the game, they do not play it. Screens that are not tabs
 * (editors, forms) still render inside the navigator; the dock simply shows
 * no selection while they are up.
 */
const DOCK_HEIGHT = 64;

function DockTab({ focused, meta, onPress }) {
  const bounce = useRef(new Animated.Value(1)).current;
  const pop = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(pop, { toValue: focused ? 1 : 0, friction: 7, tension: 160, useNativeDriver: true }).start();
  }, [focused, pop]);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => Animated.timing(bounce, { toValue: 0.88, duration: 70, useNativeDriver: true }).start()}
      onPressOut={() => Animated.spring(bounce, { toValue: 1, friction: 4, tension: 300, useNativeDriver: true }).start()}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={meta.label}
      style={({ pressed }) => [styles.tab, pressed && { opacity: 0.7 }]}
    >
      <Animated.View style={[styles.tabInner, { transform: [{ scale: bounce }] }]}>
        <Icon name={meta.icon} size={22} color={focused ? colors.accent : colors.inkFaint} />
        <Text variant="tiny" color={focused ? colors.accent : colors.inkFaint} style={styles.tabLabel}>
          {meta.label}
        </Text>
        <Animated.View style={[styles.indicator, { opacity: pop, transform: [{ scaleX: pop }] }]} />
      </Animated.View>
    </Pressable>
  );
}

export default function ConsoleDock({ tabs, state, navigation }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.md) }]} pointerEvents="box-none">
      <View style={[styles.dock, elevation.floating]}>
        {tabs.map((meta) => {
          const route = state.routes.find((r) => r.name === meta.name);
          if (!route) return null;
          const focused = state.index === state.routes.indexOf(route);
          return (
            <DockTab
              key={route.key}
              focused={focused}
              meta={meta}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.transparent,
    paddingTop: space.sm,
    paddingHorizontal: space.md,
  },
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    height: DOCK_HEIGHT,
    borderRadius: DOCK_HEIGHT / 2,
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: space.xs,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: layout.touchMin },
  tabInner: { alignItems: 'center', justifyContent: 'center', gap: 2, width: 74, height: 50 },
  tabLabel: { includeFontPadding: false },
  indicator: {
    width: 16,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.accent,
    marginTop: 1,
  },
});

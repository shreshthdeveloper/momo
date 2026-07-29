import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../src/components/ui.jsx';
import Icon from '../../src/components/Icon.jsx';
import { colors, elevation, layout, space } from '../../src/theme/index.js';

/**
 * design.md §8.15 — the tab bar, as a game dock on night.
 *
 * A floating pill, inset from the screen edges, holding five equal slots. It
 * used to have a raised circle rising out of the centre for Play; at five slots
 * that button crowded its neighbours and the notch cut a pill that no longer
 * had any symmetry to cut. Five things want five equal slots.
 *
 * ── Play is a screen now ─────────────────────────────────────────────────────
 *
 * It was a pseudo-tab: a slot that pushed a modal, marked by a tinted disc
 * because an action has no selected state to show. That was the honest reading
 * while Play was a sheet that asked one question and closed.
 *
 * It is the topic library now — a place you browse, filter and come back to —
 * so it is an ordinary tab with an ordinary selected bar, and the disc is gone.
 * All five slots are identical, which is the point: nothing here is doing
 * something different from its neighbours any more.
 */
const TABS = [
  { name: 'index', label: 'Home', icon: 'home' },
  { name: 'shop', label: 'Shop', icon: 'gift' },
  { name: 'play', label: 'Play', icon: 'play' },
  { name: 'friends', label: 'Friends', icon: 'friends' },
  { name: 'profile', label: 'You', icon: 'user' },
];

/** Play keeps the middle, because it is still the thing the app is for. */
const ORDER = ['index', 'shop', 'play', 'friends', 'profile'];

/**
 * From the token, not beside it. Two "tab bar height" values were in
 * circulation and had already drifted by 2pt, so anything sized against the
 * token sat 2pt off the dock it was supposed to clear.
 */
const DOCK_HEIGHT = layout.tabBar;

/** One slot. `focused` drives the ink and the bar; nothing else does. */
function DockItem({ focused, label, icon, onPress }) {
  const bounce = useRef(new Animated.Value(1)).current;
  const pop = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(pop, { toValue: focused ? 1 : 0, friction: 7, tension: 160, useNativeDriver: true }).start();
  }, [focused, pop]);

  const ink = focused ? colors.accent : colors.inkFaint;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => Animated.timing(bounce, { toValue: 0.88, duration: 70, useNativeDriver: true }).start()}
      onPressOut={() => Animated.spring(bounce, { toValue: 1, friction: 4, tension: 300, useNativeDriver: true }).start()}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tab, pressed && { opacity: 0.7 }]}
    >
      <Animated.View style={[styles.tabInner, { transform: [{ scale: bounce }] }]}>
        <View style={styles.glyph}>
          <Icon name={icon} size={21} color={ink} />
        </View>
        <Text variant="tiny" color={ink} style={styles.tabLabel}>
          {label}
        </Text>
        {/* Said once, quietly: an accent bar that springs open under the
            active tab. */}
        <Animated.View
          style={[styles.indicator, { opacity: pop, transform: [{ scaleX: pop }] }]}
        />
      </Animated.View>
    </Pressable>
  );
}

function TabBar({ state, navigation }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.md) }]} pointerEvents="box-none">
      <View style={[styles.dock, elevation.floating]}>
        {ORDER.map((name) => {
          const route = state.routes.find((r) => r.name === name);
          const meta = TABS.find((t) => t.name === name);
          if (!route || !meta) return null;
          const focused = state.index === state.routes.indexOf(route);

          return (
            <DockItem
              key={route.key}
              focused={focused}
              label={meta.label}
              icon={meta.icon}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(name);
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
    </Tabs>
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
  /**
   * `alignSelf: stretch` rather than a fixed width — the press target is then
   * the whole flexed slot, which is what keeps it past 44pt when five of them
   * share the dock on the narrowest phone.
   */
  tabInner: { alignItems: 'center', justifyContent: 'center', gap: 1, alignSelf: 'stretch', height: 52 },
  glyph: { width: 34, height: 26, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { includeFontPadding: false, fontSize: 10 },
  indicator: {
    width: 16,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.accent,
    marginTop: 1,
  },
});

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, Avatar, ConfirmSheet } from './ui.jsx';
import Icon from './Icon.jsx';
import { useAuth } from '../state/auth.jsx';
import { ConsoleNav } from './consoleNav.js';
import { signOutCopy } from '../lib/account.js';
import { colors, elevation, layout, space, type } from '../theme/index.js';

/**
 * The console shell — a sidebar, not a tab bar.
 *
 * A manager's app is not a player's app. The player dock carries five things
 * because a player does five things; a console has twenty-odd operations
 * across questions, topics, people, contests, assignments, moderation and
 * settings, and a four-slot dock could only ever show four of them. The rest
 * lived at the end of a chain of pushes with no way to see that they existed —
 * which is how a whole moderation queue and the entire batch feature sat in
 * the product, fully built on both sides, reachable from nowhere.
 *
 * A sidebar lists EVERYTHING. That is the point: the navigation is also the
 * inventory of what this console can do.
 *
 *   ┌──────────────┬───────────────────────────┐
 *   │ ORGANIZATION │  Questions                │
 *   │  Overview    │  ───────────────────────  │
 *   │ CONTENT      │  [ the operation's page ] │
 *   │  Questions ◀ │                           │
 *   │  Topics      │                           │
 *   │  Review      │                           │
 *   │ PEOPLE       │                           │
 *   │  Students    │                           │
 *   │  Batches     │                           │
 *   └──────────────┴───────────────────────────┘
 *
 * Pinned open on a wide screen, and a drawer over the content on a phone —
 * one component either way, because two would drift.
 *
 * ── The one rule about the top-left corner ─────────────────────────────────
 *
 * A screen listed in this sidebar wears the MENU. A screen pushed on top of
 * one — an editor, a detail, a standings table — wears the BACK ARROW. There
 * is no third case, and a screen picks its side by one thing: whether it
 * passes `onBack` to `Header`.
 *
 * Ten of the fourteen rows in the admin console used to pass one. The corner
 * changed between Topics and Students for no reason a person could see, and
 * the arrow on a sidebar row was a lie anyway: those routes are entered by
 * REPLACE, so there was nothing behind them to go back to — `useConsoleBack`
 * exists precisely because pressing it threw a navigator error. An arrow that
 * has to be taught not to crash is an arrow that should not be there.
 *
 * The one screen that still needs a word before the sidebar takes the route
 * away — settings, with an edited form — passes `onMenu` rather than growing
 * an arrow back.
 *
 * ── And the rest of the page ───────────────────────────────────────────────
 *
 * Thirty screens deciding their own layout is how a console ends up looking
 * like thirty products. The parts live in `ui.jsx` (`ListCard`, `ListRow`,
 * `CountRow`, `ConsoleFooter`, `Select`, `RowMenu`, `Tabs`) and the rules are:
 *
 *   Field        `colors.sunken`, every screen. Inset things — inputs, search,
 *                selects — lift to `canvas`; cards lift to `nightRaised`.
 *   Primary      One, full-width, in a `ConsoleFooter`. Never a `+` in the
 *                header, never trailing the last row, never a text link.
 *   Lists        Records → `ListCard` of `ListRow`s. Things with a body (a
 *                question's text, a topic's readiness bar) → a card each. The
 *                data decides which, not the screen.
 *   Counts       A `CountRow` above every list: what is shown, out of what
 *                matched.
 *   Row verbs    The safe expected one may be a `size="sm"` button; every
 *                other, and always the destructive one, goes in a `RowMenu`.
 *   Choices      Fixed and short → `Chip`s. Data-driven → `Select`. A
 *                horizontal scroller of either is never the answer.
 *   Status       Tinted `Badge` tones (`live`, `danger`, `amber`, `quiet`),
 *                because a column of saturated pills outshouts its own list.
 */

const WIDE = 900;
const RAIL = 248;

export default function ConsoleShell({ sections, title, children }) {
  const { width } = useWindowDimensions();
  const pinned = width >= WIDE;
  const [open, setOpen] = useState(false);
  const slide = useRef(new Animated.Value(0)).current;

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    Animated.timing(slide, {
      toValue: open ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, slide]);

  // On a phone the drawer is a layer over the screen, so back should close it
  // rather than leave the console.
  useEffect(() => {
    if (pinned || !open) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [pinned, open, close]);

  // A wide screen has no drawer to leave hanging when it becomes wide.
  useEffect(() => {
    if (pinned) setOpen(false);
  }, [pinned]);

  const nav = useMemo(() => ({ open: () => setOpen(true), toggle, close, pinned }), [toggle, close, pinned]);

  return (
    <ConsoleNav.Provider value={nav}>
      <View style={styles.root}>
        {pinned ? (
          <View style={styles.rail}>
            <Sidebar sections={sections} title={title} onNavigate={close} />
          </View>
        ) : null}

        <View style={styles.content}>{children}</View>

        {!pinned && open ? (
          <>
            <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: slide }]}>
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={close}
                accessibilityRole="button"
                accessibilityLabel="Close the menu"
              />
            </Animated.View>
            <Animated.View
              style={[
                styles.drawer,
                elevation.sheet,
                {
                  transform: [
                    { translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-RAIL, 0] }) },
                  ],
                },
              ]}
            >
              <Sidebar sections={sections} title={title} onNavigate={close} />
            </Animated.View>
          </>
        ) : null}
      </View>
    </ConsoleNav.Provider>
  );
}

/**
 * The list itself.
 *
 * Grouped, because twenty flat rows is a wall. The heading of each group names
 * the thing being managed rather than the screen — "People", not "Students
 * and batches" — so a row can be added to a group without renaming it.
 */
function Sidebar({ sections, title, onNavigate }) {
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const copy = signOutCopy();

  /** `admin/questions` → `questions`; the console root → `index`. */
  const current = segments[1] ?? 'index';

  return (
    <View style={[styles.sidebar, { paddingTop: insets.top + space.md }]}>
      {/**
       * The account lives HERE, and only here.
       *
       * It used to live in two places: this block, and a face in the corner of
       * every screen that happened to use `ConsoleHeader` — which was six of
       * the twenty-nine, so the console had a header with an avatar and a
       * header without one depending on which row of this very sidebar you had
       * pressed. One of them had to go, and a console with a sidebar puts the
       * account in the sidebar; the face was answering a question the sidebar
       * already answers, one tap away, with the sign-out beside it.
       */}
      <View style={styles.brand}>
        <Avatar url={user?.avatarUrl} name={user?.displayName} size={34} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="label" numberOfLines={1}>
            {user?.displayName ?? 'Signed in'}
          </Text>
          <Text variant="tiny" color={colors.inkFaint} numberOfLines={1}>
            {title}
          </Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: space.lg }}
      >
        {sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text variant="tiny" color={colors.inkFaint} style={styles.sectionTitle}>
              {section.title.toUpperCase()}
            </Text>
            {section.items.map((item) => {
              const active = item.match ? item.match.includes(current) : item.route === current;
              return (
                <Pressable
                  key={item.route}
                  onPress={() => {
                    onNavigate?.();
                    /**
                     * The console root is `/admin`, not `/admin/index` — that
                     * second path matches no route and lands on expo-router's
                     * unmatched screen, which is a 404 inside your own app.
                     */
                    const href =
                      item.href ??
                      (item.route === 'index'
                        ? `/${section.base}`
                        : `/${section.base}/${item.route}`);
                    router.replace(href);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={item.label}
                  style={({ pressed }) => [
                    styles.row,
                    active && styles.rowActive,
                    pressed && !active && styles.rowPressed,
                  ]}
                >
                  <Icon
                    name={item.icon}
                    size={18}
                    color={active ? colors.accent : colors.inkMuted}
                  />
                  <Text
                    variant="body"
                    color={active ? colors.accent : colors.ink}
                    numberOfLines={1}
                    style={styles.rowLabel}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>

      {/* Confirmed, like every other way out of an account in the product —
          a sidebar row is easy to hit by accident on the way past. */}
      <Pressable
        onPress={() => setConfirming(true)}
        accessibilityRole="button"
        accessibilityLabel={copy.confirmLabel}
        style={({ pressed }) => [
          styles.row,
          styles.signOut,
          { marginBottom: Math.max(insets.bottom, space.md) },
          pressed && styles.rowPressed,
        ]}
      >
        <Icon name="logout" size={18} color={colors.wrong} />
        <Text variant="body" color={colors.wrong} style={styles.rowLabel}>
          Sign out
        </Text>
      </Pressable>

      <ConfirmSheet
        visible={confirming}
        icon="user"
        title={copy.title}
        body={copy.body}
        confirmLabel={copy.confirmLabel}
        onConfirm={signOut}
        onCancel={() => setConfirming(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.sunken },
  content: { flex: 1, minWidth: 0 },
  rail: { width: RAIL, borderRightWidth: 1, borderRightColor: colors.hairline },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, width: RAIL },
  scrim: { backgroundColor: colors.scrim },
  sidebar: { flex: 1, backgroundColor: colors.canvas },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  section: { paddingTop: space.md },
  sectionTitle: { paddingHorizontal: space.lg, letterSpacing: 1.2, marginBottom: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.touchMin,
    paddingHorizontal: space.lg,
  },
  rowActive: { backgroundColor: colors.accentSoft },
  rowPressed: { backgroundColor: colors.sunken },
  rowLabel: { flex: 1, minWidth: 0, ...type.body },
  signOut: { borderTopWidth: 1, borderTopColor: colors.hairline, marginTop: space.sm },
});

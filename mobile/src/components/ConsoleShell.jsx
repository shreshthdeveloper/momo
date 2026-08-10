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
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, Avatar, ConfirmSheet } from './ui.jsx';
import Icon from './Icon.jsx';
import { useAuth } from '../state/auth.jsx';
import { ConsoleNav } from './consoleNav.js';
import { signOutCopy } from '../lib/account.js';
import { useReducedMotion } from '../lib/motion.js';
/**
 * The console's own styles come from the LIGHT theme statically — this
 * component only ever renders inside a console, so there is nothing to resolve.
 */
import { colors, elevation, layout, space, type } from '../theme/console.js';
/**
 * The RAIL is drawn in the night palette, deliberately — see the note on the
 * sidebar below. It is the one part of a console that is not on paper, so it
 * reaches past `theme/console.js` for the dark tokens by name.
 */
import { colors as night, domains as nightDomains } from '../theme/index.js';
import { PaletteProvider } from '../theme/palette.jsx';

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
 * ── Why the rail is dark when the console is not ───────────────────────────
 *
 * The consoles went fully light for a good reason (see `theme/light.js`: a work
 * tool read in a daylit office is a paper problem). Taken to the whole screen
 * it cost something real, though — the console became grey cards on a grey
 * field with a teal accent and NOTHING ELSE. No anchor for the eye, and not one
 * pixel that belonged to this product rather than to any admin template. Mimo
 * is a night-world game; a console with none of that in it is not neutral, it
 * is severed.
 *
 * So the split moves one level in: the NAVIGATION is the night world and the
 * WORKSPACE is paper. That is the shape most consoles worth copying take, and
 * each half gets the argument that suits it — the dark frame carries the brand
 * and anchors the layout, the light page carries the dense tables and the long
 * forms. The seam between them is 15.8:1, which is why it needs no border.
 *
 * The rail wraps its contents in a night `PaletteProvider` rather than passing
 * dark colours to thirty call sites: `Text`, `Avatar` and `Icon` resolve their
 * own palette from context, so the boundary is declared once and nothing inside
 * it can be accidentally left on paper. The sign-out confirmation is rendered
 * OUTSIDE that provider on purpose — it is a sheet over the whole console, and
 * the console is light.
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
  const insets = useSafeAreaInsets();
  const pinned = width >= WIDE;
  const [open, setOpen] = useState(false);
  const slide = useRef(new Animated.Value(0)).current;
  /**
   * design.md §7 promises reduced motion is respected THROUGHOUT, and eight
   * components in the player app honour it. The console's one animation — this
   * drawer, sliding a full 248pt across the screen — did not, so the single
   * biggest movement either console makes was the one that ignored the setting.
   *
   * Zero rather than a shorter slide, matching `NotificationBanner`: §7's
   * degradation for something that TRAVELS is an instant state change, and the
   * scrim's fade goes with it.
   */
  const reduced = useReducedMotion();

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    Animated.timing(slide, {
      toValue: open ? 1 : 0,
      duration: reduced ? 0 : 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, slide, reduced]);

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
    /**
     * The palette boundary IS the console boundary.
     *
     * Everything below this point draws on paper: the screens get there by
     * importing `theme/console.js` directly, and the shared components from
     * `ui.jsx` — which the player app renders in the night palette from the
     * very same file — get there through this provider. One wrapper, and there
     * is no list of "which screens are light" to keep in step by hand.
     */
    <PaletteProvider theme="paper">
      <ConsoleNav.Provider value={nav}>
        {/* Light glyphs: the top of a console is night chrome now — the rail
            on a wide screen, the header on a phone. */}
        <StatusBar style="light" />
        <View style={styles.root}>
          {pinned ? (
            <View style={styles.rail}>
              <Sidebar sections={sections} title={title} onNavigate={close} />
            </View>
          ) : null}

          {/**
           * With the drawer open the screen under it is inert to touch — the
           * scrim covers it — but a screen reader walked straight through the
           * scrim into the page behind, so swiping past the last sidebar row
           * carried on into a list the user could not actually reach. The drawer
           * is a layer over the console; it has to be a layer for VoiceOver and
           * TalkBack too.
           */}
          <View
            style={styles.content}
            importantForAccessibility={!pinned && open ? 'no-hide-descendants' : 'auto'}
            accessibilityElementsHidden={!pinned && open}
          >
            {/**
             * The status-bar inset, painted by the SHELL rather than by each
             * screen.
             *
             * A `SafeAreaView` paints its own inset in the screen's background,
             * which is the field grey — so a dark header would have hung below
             * a grey strip on every notched phone. Console screens pass
             * `edges={[]}` and this cap owns the space instead, in the same
             * night surface the header uses, so the two are one bar.
             */}
            <View style={[styles.statusCap, { height: insets.top }]} />
            {children}
          </View>

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
                accessibilityViewIsModal
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
    </PaletteProvider>
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
    <>
    <PaletteProvider theme="night">
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
          <Text variant="tiny" color={night.inkFaint} numberOfLines={1}>
            {title}
          </Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: space.lg }}
      >
        {sections.map((section) => {
          /**
           * ── Colour as navigation ─────────────────────────────────────────
           *
           * Every row in here used to be the same teal-when-active, grey-when-
           * not. Twenty rows across five sections, told apart only by reading
           * them — on the one surface whose entire job is telling you where you
           * are. A section's hue is carried by its rows' glyphs and by the bar
           * on the active one, so Content is teal wherever it appears and
           * People is indigo, and the operator navigates by recognition rather
           * than by reading a list twenty items long.
           *
           * The label stays ink. Only the glyph and the marker take the hue —
           * five colours of running text would be a highlighter, not a system.
           */
          const domain = nightDomains[section.tone] ?? nightDomains.content;
          return (
          <View key={section.title} style={styles.section}>
            <Text variant="tiny" color={night.inkFaint} style={styles.sectionTitle}>
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
                    active && { backgroundColor: domain.soft },
                    pressed && !active && styles.rowPressed,
                  ]}
                >
                  {/* A four-point bar in the section's hue, drawn only on the
                      current row. The tinted fill alone was ambiguous at a
                      glance against a pressed row; an edge marker is not. */}
                  <View
                    style={[styles.marker, active && { backgroundColor: domain.hue }]}
                    pointerEvents="none"
                  />
                  <Icon
                    name={item.icon}
                    size={18}
                    color={active ? domain.hue : night.inkMuted}
                  />
                  <Text
                    variant="body"
                    color={active ? night.ink : night.inkMuted}
                    numberOfLines={1}
                    style={[styles.rowLabel, active && styles.rowLabelActive]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          );
        })}
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
        <Icon name="logout" size={18} color={night.wrong} />
        <Text variant="body" color={night.wrong} style={styles.rowLabel}>
          Sign out
        </Text>
      </Pressable>
    </View>
    </PaletteProvider>

    {/* Outside the night provider: this is a sheet over the whole console, and
        the console is paper. */}
    <ConfirmSheet
      visible={confirming}
      icon="user"
      title={copy.title}
      body={copy.body}
      confirmLabel={copy.confirmLabel}
      onConfirm={signOut}
      onCancel={() => setConfirming(false)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.sunken },
  content: { flex: 1, minWidth: 0 },
  statusCap: { backgroundColor: night.canvas },
  // No border: the night rail against the paper field is a 15.8:1 edge, and a
  // hairline on top of that is a line drawn on a line.
  rail: { width: RAIL },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, width: RAIL },
  scrim: { backgroundColor: colors.scrim },
  sidebar: { flex: 1, backgroundColor: night.canvas },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: night.hairline,
  },
  section: { paddingTop: space.md },
  sectionTitle: { paddingHorizontal: space.lg, letterSpacing: 1.2, marginBottom: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.touchMin,
    paddingLeft: space.lg,
    paddingRight: space.md,
  },
  /** The edge marker. Always laid out, only coloured when the row is current. */
  marker: {
    position: 'absolute',
    left: 0,
    top: 6,
    bottom: 6,
    width: 3,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: night.transparent,
  },
  rowPressed: { backgroundColor: night.nightRaised },
  rowLabel: { flex: 1, minWidth: 0, ...type.body },
  rowLabelActive: { fontFamily: type.bodyStrong.fontFamily },
  signOut: { borderTopWidth: 1, borderTopColor: night.hairline, marginTop: space.sm },
});

import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  Easing,
} from 'react-native';
/**
 * `colors` is imported here as `night`, and ONLY the header may touch it.
 *
 * These components render in the player app's night palette AND in both
 * consoles' paper one, so a module-level colour import bakes in whichever
 * happened to load first — every other component in this file resolves its
 * palette from context through `usePalette()` and must keep doing so.
 *
 * The exception is the console header, which is deliberately dark on a light
 * console: chrome is the night world, the workspace is paper. See
 * `headerConsole`. It is not resolving a palette, it is naming a surface.
 */
import {
  colors as night,
  consoleLayout,
  consoleType,
  DEFAULT_FONT_SCALE_CAP,
  fontScaleCap,
  fonts,
  layout,
  space,
  type,
  motion,
} from '../theme/index.js';
import { useDomains, usePalette, useTheme, useThemedStyles } from '../theme/palette.jsx';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConsoleNav } from './consoleNav.js';
import { useReducedMotion } from '../lib/motion.js';
import { resolveAvatar } from '../lib/avatar.js';
import Icon from './Icon.jsx';

/**
 * The gap a screen owes the bottom of the phone.
 *
 * The app is edge-to-edge on Android (`app.json`), so it draws BEHIND the
 * navigation bar, and that bar is three different heights on the three kinds of
 * phone we ship to: 34pt for an iPhone's home indicator, ~24dp for Android
 * gesture navigation, 48dp for Android's three-button bar. Every screen that
 * wrote a number here instead of asking landed correctly on one of the three and
 * under the bar on another — which is exactly why the app looked fine on one
 * device and clipped on the next.
 *
 * `space.md` is the floor, so a phone with no bottom bar at all still ends its
 * content with a gap rather than flush against the glass.
 */
export function useBottomInset() {
  const insets = useSafeAreaInsets();
  return Math.max(insets.bottom, space.md);
}

/** The same, plus the breathing room a scroll wants under its last row. */
export function useScrollBottom() {
  return useBottomInset() + space.xl;
}

/**
 * What every `Modal` in this app passes.
 *
 * Without these two, Android insets the modal's own window below the status bar
 * and above the navigation bar, so a scrim that covers the whole screen on iOS
 * stops short of both on Android — the live screen shows through in a strip at
 * the top, and the sheet's own safe-area padding is measured against a window
 * that has already been shrunk. Turning them on makes the modal genuinely
 * full-bleed on both platforms, which is what lets one set of insets be right
 * everywhere.
 *
 * `navigationBarTranslucent` requires `statusBarTranslucent`; RN warns if it is
 * given on its own, so the two always travel together.
 */
export const FULL_BLEED_MODAL = {
  statusBarTranslucent: true,
  navigationBarTranslucent: true,
};

/**
 * Text bound to the type scale. Nothing outside design.md §4.2 is reachable.
 *
 * Inside a console it binds to the DENSER ramp instead. A manager reading a
 * roster of two hundred names does not want the type a player reads one
 * question at a time in, and the alternative — every console screen naming its
 * own sizes — is how a design system stops being one.
 */
export function Text({ variant = 'body', color, style, children, ...props }) {
  const colors = usePalette();
  const inConsole = Boolean(useConsoleNav());
  const scale = inConsole && consoleType[variant] ? consoleType[variant] : type[variant];
  return (
    <RNText
      // Bounded, not refused — see `fontScaleCap`. A caller that knows better
      // for one instance still wins, because its prop is spread after.
      maxFontSizeMultiplier={fontScaleCap[variant] ?? DEFAULT_FONT_SCALE_CAP}
      style={[scale, { color: color ?? colors.ink }, style]}
      {...props}
    >
      {children}
    </RNText>
  );
}

/**
 * design.md §6.5 — one primary per screen.
 *
 * Primary is a full-width accent pill; `soft` is the tinted companion that
 * sits under it ("I already have an account"); `outline` and `ghost` carry the
 * things a screen offers but does not ask for. Press scales to 0.97 over 80ms —
 * enough to feel, not enough to notice.
 */
export function Button({
  variant = 'primary',
  size = 'lg',
  label,
  onPress,
  disabled,
  loading,
  style,
  icon,
  iconRight,
  fullWidth = true,
}) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { elevation } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const reduced = useReducedMotion();

  const press = (to) =>
    Animated.timing(scale, {
      toValue: to,
      duration: reduced ? 0 : 80,
      useNativeDriver: true,
    }).start();

  const inConsole = Boolean(useConsoleNav());

  /**
   * `press` is the fill a button takes while held.
   *
   * The theme has defined these since it was written — `accentPress`,
   * `accentSoftPress` — and nothing ever applied them, so the only feedback a
   * press gave was the 0.97 scale. On a solid primary button that is very
   * little, and on the soft variant it is almost nothing.
   */
  const palette = {
    primary: { bg: colors.accent, press: colors.accentPress, fg: colors.onAccent, border: colors.transparent },
    soft: { bg: colors.accentSoft, press: colors.accentSoftPress, fg: colors.accent, border: colors.transparent },
    outline: { bg: inConsole ? colors.nightRaised : colors.transparent, press: colors.accentSoft, fg: colors.accent, border: colors.accent },
    /**
     * A ghost in the CONSOLE is a real secondary button; in the player app it
     * stays text.
     *
     * Text-only was making captions out of controls. On the import's first
     * stage "Paste it instead" sat under a tinted "Pick a CSV file" pill as
     * plain grey words in the middle of the screen — one of two equal ways to
     * get the questions in, drawn as if it were a footnote about the other. The
     * same thing happened to "Dismiss" beside "Suspend" on the moderation card
     * and to "Done" in the import footer. A console is dense and monochrome, so
     * a control needs an edge to be a control; the player app is spacious and
     * dark, where a bare word still reads as tappable.
     */
    ghost: inConsole
      ? { bg: colors.nightRaised, press: colors.canvas, fg: colors.inkMuted, border: colors.hairline }
      : { bg: colors.transparent, fg: colors.inkMuted, border: colors.transparent },
    danger: { bg: inConsole ? colors.nightRaised : colors.transparent, press: colors.wrongSoft, fg: colors.wrong, border: colors.wrong },
    /** The two variants for a button sitting on a saturated field. */
    onColor: { bg: colors.canvas, fg: colors.accent, border: colors.transparent },
    onColorSoft: { bg: 'rgba(255,255,255,0.18)', fg: colors.onColor, border: colors.transparent },
  }[variant];

  const borderWidth =
    variant === 'outline' || variant === 'danger' ? 1.5 : inConsole && variant === 'ghost' ? 1 : 0;
  /**
   * `sm` is 44, not 40.
   *
   * Forty points is under the minimum touch target on both platforms (44pt on
   * iOS, 48dp on Material), and `sm` is not a rare decorative size here — it is
   * every Play, Accept and Add button in the friends list, which is the densest
   * screen of tap targets in the app and the one where a mis-tap costs the most
   * (declining instead of accepting). The four points come out of padding that
   * was already generous; nothing reflows, because every row using it is at
   * least 68 tall.
   */
  /**
   * A console's primary button is 44 rather than 54, and its label 14 rather
   * than 16. Still the accessible floor — the height that was lost was
   * presentation, not target.
   */
  const height =
    size === 'sm' ? 44 : size === 'md' ? 46 : inConsole ? consoleLayout.buttonHeight : layout.buttonHeight;
  const labelSize = size === 'sm' || inConsole ? 14 : 16;
  /**
   * The console squares its buttons off; the player app keeps the pill.
   *
   * A stadium is the game's shape — it is the Play button, and everything
   * shaped like it inherits some of that. A console screen is a grid of
   * rectangles: cards at 18, inputs and selects at 14, a header, a table. Full
   * pills dropped into it read as visitors, and with a circular `⋯` beside them
   * a single card was carrying three unrelated geometries. Matching the input
   * radius costs nothing and makes a row of controls look like one family.
   */
  const radius = inConsole ? layout.radiusInput : layout.radiusPill;
  /**
   * A hugging button still has to look like a button. "Approve" and "Live" set
   * at their own width came out barely wider than the word, which is a chip.
   */
  const minWidth = fullWidth ? undefined : size === 'sm' ? 88 : 104;

  return (
    // `center` rather than `flex-start` when hugging: a small button almost
    // always sits in a row beside text, and flex-start would pin it to the top
    // of that row. Anywhere it should hug the left instead, the call site says
    // so through `style` — which is applied second and wins.
    <Animated.View style={[{ transform: [{ scale }], alignSelf: fullWidth ? 'stretch' : 'center' }, style]}>
      <Pressable
        onPress={disabled || loading ? undefined : onPress}
        onPressIn={() => press(0.97)}
        onPressOut={() => press(1)}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: Boolean(disabled || loading) }}
        style={({ pressed }) => [
          styles.button,
          variant === 'primary' && !disabled ? elevation.raised : null,
          {
            height,
            minWidth,
            borderRadius: radius,
            backgroundColor: pressed && palette.press ? palette.press : palette.bg,
            borderColor: palette.border,
            borderWidth,
            paddingHorizontal: size === 'sm' ? space.lg : space.xl,
            opacity: disabled ? 0.45 : 1,
          },
        ]}
      >
        {loading ? (
          /**
           * The Mimo mark, not the platform's ring.
           *
           * A button is where the app waits most often — every save, every
           * approve, every import — and until now every one of those waits was
           * drawn by iOS or Android. Two identical-looking buttons would spin
           * differently depending on the phone, and neither looked like this
           * app. `Spinner` is the same mark the splash and every full-screen
           * wait already use; it just takes the button's own label colour so it
           * works on the accent fill and on paper alike.
           */
          <Spinner size={size === 'sm' ? 20 : 24} color={palette.fg} />
        ) : (
          <>
            {icon ? <Icon name={icon} size={18} color={palette.fg} /> : null}
            <RNText
              numberOfLines={1}
              // The pill's height is fixed and the label may not wrap, so this
              // is the one place the cap has to be tighter than the type scale's.
              maxFontSizeMultiplier={1.2}
              style={[type.label, { fontSize: labelSize, color: palette.fg }]}
            >
              {label}
            </RNText>
            {iconRight ? <Icon name={iconRight} size={16} color={palette.fg} /> : null}
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

/**
 * design.md §6.3 — points are EARNED, and the number should show it. On a
 * change the displayed value counts from the old total to the new one over
 * 300ms with an ease-out, while the whole number takes a small spring pulse —
 * 118 becomes 118…140…165…182 rather than teleporting, which is what makes
 * an award feel like an addition instead of a replacement.
 *
 * Under reduced motion the value simply updates.
 */
export function RollingNumber({ value, style, color }) {
  const colors = usePalette();
  const reduced = useReducedMotion();
  const previous = useRef(value);
  const [shown, setShown] = useState(value);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (previous.current === value) return undefined;
    const from = previous.current;
    previous.current = value;

    if (reduced) {
      setShown(value);
      return undefined;
    }

    pulse.setValue(1.16);
    Animated.spring(pulse, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }).start();

    const started = Date.now();
    const timer = setInterval(() => {
      const t = Math.min(1, (Date.now() - started) / motion.scoreRoll);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (value - from) * eased));
      if (t >= 1) clearInterval(timer);
    }, 30);
    return () => clearInterval(timer);
  }, [value, reduced, pulse]);

  return (
    <Animated.Text
      style={[
        type.scoreLive,
        { color: color ?? colors.ink, fontVariant: ['tabular-nums'], transform: [{ scale: pulse }] },
        style,
      ]}
      accessibilityLiveRegion="polite"
    >
      {shown}
    </Animated.Text>
  );
}

/**
 * design.md §6.6 — circular. In a match the player's avatar carries a 2px
 * accent ring and the opponent's a 2px rival ring, so identity and colour are
 * bound together from the versus screen onward.
 */
export function Avatar({ url, name, size = 48, ring, tint, style }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const initials =
    (name ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?';

  const ringColor = ring === 'you' ? colors.you : ring === 'rival' ? colors.rival : null;
  // A preset resolves to a drawn face or a colour rather than an image; an
  // explicit `tint` (the picker previewing an unsaved choice) wins over
  // whatever is stored.
  const resolved = resolveAvatar(url, name);
  const fill = tint ?? resolved.tint;

  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: ringColor ? 2.5 : 0,
          borderColor: ringColor ?? colors.transparent,
        },
        fill ? { backgroundColor: fill } : null,
        style,
      ]}
    >
      {resolved.source && !tint ? (
        <Image source={resolved.source} style={{ width: '100%', height: '100%' }} />
      ) : resolved.uri && !tint ? (
        <Image source={{ uri: resolved.uri }} style={{ width: '100%', height: '100%' }} />
      ) : (
        <RNText
          allowFontScaling={false}
          // Everything scales with the avatar — the type-scale styles carry a
          // FIXED lineHeight (label: 20), and inheriting one under a scaled
          // fontSize clipped the initials to their bottom half on any avatar
          // over ~44px. Android additionally pads glyphs unless told not to.
          style={{
            fontFamily: fonts.semibold,
            fontSize: Math.round(size * 0.36),
            lineHeight: Math.round(size * 0.52),
            includeFontPadding: false,
            textAlignVertical: 'center',
            color: colors.onColor,
          }}
        >
          {initials}
        </RNText>
      )}
    </View>
  );
}

/** A white card resting on paper. §5.1 — one elevation, never stacked. */
export function Card({ children, style, onPress, flat = false }) {
  const styles = useThemedStyles(makeStyles);
  const { elevation } = useTheme();
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.card,
          flat ? null : elevation.raised,
          pressed ? styles.cardPressed : null,
          style,
        ]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, flat ? null : elevation.raised, style]}>{children}</View>;
}

/**
 * A section heading with an optional trailing action — the "Discover / View all
 * →" pattern that runs down every list screen in the app.
 */
export function SectionHeader({ title, action, onAction, style }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.sectionHeader, style]}>
      <Text variant="title" style={{ flex: 1 }} numberOfLines={1}>
        {title}
      </Text>
      {action ? (
        <Pressable
          onPress={onAction}
          hitSlop={10}
          accessibilityRole="button"
          style={({ pressed }) => [styles.sectionAction, pressed && { opacity: 0.7 }]}
        >
          <Text variant="label" color={colors.accent}>
            {action}
          </Text>
          <Icon name="arrowRight" size={14} color={colors.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** A filter pill. Filled with the accent when on, quiet when off (§6.7). */
export function Chip({ label, active, onPress, style }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  /**
   * A console chip is smaller. Filters are chrome, not content: at the player's
   * 38pt a row of six of them is a band as tall as two rows of the list it is
   * filtering, and the question bank stacked three such rows before the first
   * question appeared.
   */
  const inConsole = Boolean(useConsoleNav());
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: Boolean(active) }}
      style={({ pressed }) => [
        styles.chip,
        inConsole ? styles.chipConsole : null,
        active ? styles.chipOn : styles.chipOff,
        pressed ? { opacity: 0.8 } : null,
        style,
      ]}
    >
      {/* An unselected filter is not an invitation — it is the rest of the
          list. Outlining every one of them in the accent made a row of chips
          compete with the button they sit above, which is the loudest, cheapest
          thing a filter bar can do. Off is quiet; on is the only one coloured. */}
      <Text variant="label" color={active ? colors.onAccent : colors.inkMuted}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Where you are in a flow that has more than one stage.
 *
 * The console has several — the import, a new contest, a new organization —
 * and every one of them replaced the whole screen when it moved on, with
 * nothing saying a stage had passed or how many were left. That is fine on a
 * form you fill in once and forget; it is not fine on the import, where the
 * middle stage asks you to make three hundred decisions and the only clue you
 * were halfway through was that the buttons had changed.
 *
 * Deliberately small: a strip of dots under the header, not a wizard chrome
 * bar. It says which stage and how many, and then gets out of the way.
 *
 * It is a STRIP, though — its own white band closed by a hairline, centred in
 * the screen. Left-aligned on the bare field with no rule under it, the dots
 * sat a few points below the header's own text and read as a fourth line of
 * that header rather than as a separate thing: "Import questions / Central
 * bank / ①Set up ②Check ③Done", all crowded into the same corner. The band is
 * what separates the two, and centring is what stops three short words from
 * hugging the left edge of a screen they are describing the whole of.
 */
export function Steps({ steps, current }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  return (
    <View
      style={styles.steps}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${current + 1} of ${steps.length}: ${steps[current]}`}
      accessibilityValue={{ min: 1, max: steps.length, now: current + 1 }}
    >
      {steps.map((label, i) => {
        const done = i < current;
        const on = i === current;
        return (
          // Not focusable and not labelled one by one: the strip already reads
          // as a whole above, and eight extra stops is a worse experience than
          // one good one.
          <View key={label} style={styles.step} importantForAccessibility="no-hide-descendants">
            {i > 0 ? <View style={[styles.stepLine, (done || on) && styles.stepLineOn]} /> : null}
            <View style={[styles.stepDot, done && styles.stepDotDone, on && styles.stepDotOn]}>
              {done ? (
                <Icon name="check" size={13} color={colors.onAccent} />
              ) : (
                <Text variant="tiny" color={on ? colors.onAccent : colors.inkFaint}>
                  {i + 1}
                </Text>
              )}
            </View>
            <Text
              variant={on ? 'label' : 'meta'}
              color={on ? colors.ink : colors.inkFaint}
              numberOfLines={1}
              style={styles.stepLabel}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * A row of colour choices — a category's colour, an organization's accent.
 *
 * One component because there were three, and all three were wrong in the same
 * way: the dot WAS the button, at 34pt in the organization settings, 36 in the
 * topic form and 40 in the tenant form. Every one of them under the 44pt floor,
 * none of them the same size as the next, and the two that drew a tick inside
 * the dot drew it in two different colours.
 *
 * So the target is 44 and the dot is 32, centred inside it. The dot keeps its
 * size while the finger gets the room the platform asks for, and eight of them
 * still fit two rows on the narrowest phone.
 *
 * `colors` is a list of hex strings — a CURATED list, always. design.md §3.3 is
 * explicit that free colour entry is not offered, because these have to hold
 * contrast against the ink they carry.
 */
export function Swatches({ value, colors: choices, onChange, disabled = false, noun = 'Colour' }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.swatches}>
      {(choices ?? []).map((hex) => {
        const on = value === hex;
        return (
          <Pressable
            key={hex}
            disabled={disabled}
            onPress={() => onChange?.(hex)}
            accessibilityRole="button"
            accessibilityLabel={`${noun} ${hex}`}
            accessibilityState={{ selected: on, disabled }}
            style={({ pressed }) => [
              styles.swatchHit,
              pressed && !disabled ? { opacity: 0.7 } : null,
              disabled ? { opacity: 0.5 } : null,
            ]}
          >
            <View style={[styles.swatchDot, { backgroundColor: hex }, on && styles.swatchDotOn]}>
              {/* Not colour alone: the chosen one carries a tick as well as a
                  ring, so it is still the chosen one to someone who cannot
                  separate two of these hues. */}
              {on ? <Icon name="check" size={16} color={colors.onAccent} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A small count or status pill that sits on artwork — "16 Qs", "Live".
 *
 * Two families, and which one to use is not a matter of taste:
 *
 * - **Solid** (`accent`, `correct`, `wrong`) for a pill sitting ON artwork or
 *   a photo, where only a solid fill separates it from what is behind it.
 * - **Tinted** (`live`, `danger`, `amber`, `soft`, `quiet`) for a pill sitting
 *   in a LIST, which is every status badge in both consoles. §1 of the theme:
 *   saturated fills are for verdicts, standings and actions. A row of fully-lit
 *   green "Live" pills down a topic list is none of those — it is the loudest
 *   thing on a screen whose actual subject is the topic names beside them.
 */
export function Badge({ label, tone = 'ink', style }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const bg = {
    /**
     * The one solid neutral, for a pill sitting ON artwork — a count over a
     * topic cover, where only a solid fill separates it from the picture. It
     * stays dark on paper for that reason: the surface under it is a
     * photograph either way, not the page.
     */
    ink: 'rgba(24, 22, 38, 0.75)',
    accent: colors.accent,
    correct: colors.correct,
    wrong: colors.wrong,
    soft: colors.accentSoft,
    live: colors.correctSoft,
    danger: colors.wrongSoft,
    amber: colors.amberSoft,
    /**
     * One step down from whatever it is drawn on, NOT the field.
     *
     * `sunken` was right when the page was grey and a badge sat on a white
     * card. With a white page it is the colour of both, so the one tone whose
     * whole job is to be a neutral chip had no chip at all. `inset` rather than
     * `canvas` so night keeps the exact value it has today.
     */
    quiet: colors.inset,
  }[tone];
  /**
   * The fill decides its own type rather than one rule covering all of them —
   * and it has to, because the answer flips between palettes. On the night
   * field the accent is bright and takes near-black (white on it is 1.9:1); on
   * paper it is a deep teal and takes white. Both are `onAccent`, which is
   * exactly what that token is for.
   */
  const fg = {
    soft: colors.accent,
    accent: colors.onAccent,
    live: colors.correct,
    danger: colors.wrong,
    amber: colors.optionC,
    quiet: colors.inkMuted,
  }[tone] ?? colors.onColor;
  return (
    <View style={[styles.badge, { backgroundColor: bg }, style]}>
      <Text variant="tiny" color={fg}>
        {label}
      </Text>
    </View>
  );
}

/**
 * A rank in a small tile — the game's way of writing "3rd". The first three
 * ranks carry their medal tint, everyone else sits on quiet paper, and the
 * viewer's own tile is the accent so their row is findable mid-scroll.
 */
/**
 * The first three ranks in their metal. The numeral takes the FULL medal
 * colour on a tint of it — these used to be a dark brown, slate and umber,
 * which were readable when the tile sat on paper and all but vanished once the
 * app went night.
 */
/**
 * The three medals. A function of the palette rather than a constant, because
 * the metals themselves are re-struck on paper — the night gold vanishes at
 * 1.8:1 on white — and a module-level map would have frozen the night ones.
 */
const medalTiles = (colors) => ({
  1: { bg: colors.goldSoft, fg: colors.gold },
  2: { bg: 'rgba(102, 108, 123, 0.14)', fg: colors.silver },
  3: { bg: 'rgba(139, 90, 50, 0.14)', fg: colors.bronze },
});

export function RankTile({ rank, self, size = 30 }) {
  const colors = usePalette();
  const medal = medalTiles(colors)[rank];
  const bg = self ? colors.accent : medal ? medal.bg : colors.sunken;
  // Near-black on the accent — white on it is 1.9:1.
  const fg = self ? colors.onAccent : medal ? medal.fg : colors.inkMuted;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.33,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        allowFontScaling={false}
        variant="label"
        color={fg}
        style={{ fontSize: rank > 99 ? 10 : 13, includeFontPadding: false }}
      >
        {rank}
      </Text>
    </View>
  );
}

/**
 * design.md §6.7 — the scope switcher: a choice INSIDE a form.
 *
 * "Easy / medium / hard", "open / invite only", "everyone / one organization" —
 * a control that answers a field, sitting in a column of fields. It is not the
 * thing at the top of a list screen; see `Tabs` for that.
 *
 * The selected pane used to be `canvas` on the `sunken` track, which is a step
 * of about 1.1:1 — invisible — held up by a shadow struck for white paper that
 * renders as nothing on a near-black field. The one cue that survived was the
 * label turning teal. Now the pane carries the accent's own tint and its edge,
 * so the choice is legible before you read the words.
 */
export function Segmented({ options, value, onChange, style }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.segmented, style]}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={option.dot ? `${option.label}, something waiting` : option.label}
            style={({ pressed }) => [styles.segment, on ? styles.segmentOn : null, pressed && { opacity: 0.7 }]}
          >
            <Text variant="label" color={on ? colors.accent : colors.inkMuted} numberOfLines={1}>
              {option.label}
            </Text>
            {/**
             * `dot` marks a pane with something waiting in it.
             *
             * A tabbed screen hides three quarters of itself by definition, and
             * the one thing that must not be hidden is a reward sitting unopened
             * behind a word. Gold rather than the accent: this is the "there is
             * treasure here" mark the chest cards already use, not a selection
             * state — and it is drawn whether or not the tab is the current one,
             * because it stops being true when the chest is opened, not when the
             * tab is looked at.
             */}
            {option.dot ? <View style={styles.segmentDot} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Page tabs — the top-level switch on a list screen.
 *
 * Every console list screen used `Segmented` for this: Active/Pending/Suspended,
 * Our bank/Central bank, Open/Resolved/Dismissed. A pill track is the wrong
 * shape for the job. It reads as a control you set rather than a place you are,
 * it costs 56pt of the top of the screen before a single row of the list, and
 * on night its selected pane was all but invisible — so the whole band was
 * spending a lot of screen to say very little.
 *
 * Tabs say it the way a phone says it: words on the field, the current one lit
 * and underlined in the accent, and the bar carrying the hairline that closes
 * the header region. Forty points, and the selected state survives a photograph.
 *
 *   ┌────────────────────────────────────────┐
 *   │  Active      Pending      Suspended    │
 *   │  ───────                               │
 *   └────────────────────────────────────────┘
 *
 * Up to four tabs share the width; beyond that they scroll, because four short
 * words is where a shared row stops being readable.
 */
export function Tabs({ options, value, onChange, style }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const spread = options.length <= 4;

  const tabs = options.map((option) => {
    const on = option.value === value;
    return (
      <Pressable
        key={String(option.value)}
        onPress={() => onChange(option.value)}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={option.label}
        style={({ pressed }) => [
          styles.tab,
          spread ? { flex: 1 } : null,
          pressed && !on ? { opacity: 0.7 } : null,
        ]}
      >
        <View style={[styles.tabInner, on ? styles.tabInnerOn : null]}>
          <Text variant="label" color={on ? colors.accent : colors.inkMuted} numberOfLines={1}>
            {option.label}
          </Text>
        </View>
      </Pressable>
    );
  });

  if (spread) {
    return (
      <View style={[styles.tabBar, style]} accessibilityRole="tablist">
        {tabs}
      </View>
    );
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.tabBarScroll, style]}
      contentContainerStyle={styles.tabBarScrollContent}
      accessibilityRole="tablist"
    >
      {tabs}
    </ScrollView>
  );
}

/**
 * One row of filter chips that cannot clip.
 *
 * For a FIXED, short, known-at-design-time set — easy/medium/hard, 7/14/21.
 * Anything driven by data (topics, batches, organizations, categories) belongs
 * in a `Select`: a chip row for those is a horizontal scroller, and a
 * horizontal scroller is a control that hides most of itself off the right
 * edge of the screen and gives you no way to know what is out there.
 */
export function FilterBar({ options, value, onChange, style }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.filterBar, style]}
      contentContainerStyle={styles.filterBarContent}
    >
      {options.map((option) => (
        <Chip
          key={String(option.value)}
          label={option.label}
          active={option.value === value}
          onPress={() => onChange(option.value)}
        />
      ))}
    </ScrollView>
  );
}

/**
 * A single choice out of a list the DATA decides the length of.
 *
 * The console had one answer for this everywhere and it was the wrong one: a
 * horizontal row of chips. Which topic, which batch, which organization, which
 * category — each was a scroller, and every one of them had the same three
 * faults. Most of the options are off-screen with nothing to say so. The chip
 * you want is a swipe away in a list with no order you can predict. And the
 * row has to be re-scrolled every time the screen re-renders to see what is
 * even selected.
 *
 * They were also, quietly, all different: some had "All" first, some didn't,
 * some scrolled under the search field, some over it.
 *
 * This is the one control for the job — a field that states the current choice
 * and opens a list. The list is vertical, so a long one scrolls the way every
 * other long list in the app scrolls, and the selected row is marked rather
 * than merely coloured.
 *
 *   ┌────────────────────────────────┐
 *   │ Batch                          │
 *   │ ┌────────────────────────────┐ │
 *   │ │ Class 9A                 ⌄ │ │
 *   │ └────────────────────────────┘ │
 *   └────────────────────────────────┘
 */
export function Select({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose',
  disabled = false,
  style,
}) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);

  return (
    <View style={style}>
      {label ? (
        <Text variant="label" color={colors.inkMuted} style={styles.selectLabel}>
          {label}
        </Text>
      ) : null}
      <Pressable
        onPress={disabled ? undefined : () => setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label ?? 'Choose'} — ${current?.label ?? placeholder}`}
        accessibilityState={{ disabled, expanded: open }}
        style={({ pressed }) => [
          styles.select,
          disabled && { opacity: 0.5 },
          pressed && { backgroundColor: colors.canvas },
        ]}
      >
        <Text
          variant="body"
          color={current ? colors.ink : colors.inkFaint}
          numberOfLines={1}
          style={{ flex: 1 }}
        >
          {current?.label ?? placeholder}
        </Text>
        <Icon name="chevronDown" size={16} color={colors.inkFaint} />
      </Pressable>

      <Sheet
        visible={open}
        title={label ?? 'Choose'}
        onClose={() => setOpen(false)}
        accessibilityLabel={label ?? 'Choose'}
      >
        <ScrollView
          style={styles.selectList}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {options.map((option) => {
            const on = option.value === value;
            return (
              <Pressable
                key={String(option.value)}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [styles.selectRow, pressed && { opacity: 0.7 }]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="body" color={on ? colors.accent : colors.ink} numberOfLines={1}>
                    {option.label}
                  </Text>
                  {option.meta ? (
                    <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                      {option.meta}
                    </Text>
                  ) : null}
                </View>
                {on ? <Icon name="check" size={18} color={colors.accent} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </Sheet>
    </View>
  );
}

/**
 * ── The console page, as four parts ────────────────────────────────────────
 *
 * Thirty screens each decided these for themselves, and the result is what a
 * console looks like when nobody wrote the rule down: fourteen screens on
 * `canvas` and sixteen on `sunken`; the create button in a footer on six, a `+`
 * in the header on two, trailing the last row on three, and only inside the
 * empty state on four; three different skeletons; and every list picking
 * between a card per record and bare rows on the field.
 *
 * So the parts are components now, and the rule is:
 *
 * 1. **The field is `sunken`.** Every console screen, no exceptions — it is the
 *    colour `ConsoleShell` and the navigator already declare for the content
 *    region, so a screen that used `canvas` was a lighter rectangle sitting on
 *    the console's own backdrop.
 * 2. **One primary, in the footer.** Always full-width, always the last thing
 *    down the screen, never a `+` hiding in the header and never trailing the
 *    last row where it scrolls out of reach.
 * 3. **Records go in a `ListCard`; things with a body get a card each.** The
 *    choice is the data's, not the screen's: a batch is a name and a number, so
 *    it is a row; a question has three lines of question text and a topic has a
 *    readiness bar, so those are cards. Both use the same fill, radius, border
 *    and padding.
 * 4. **A `CountRow` above every list.** What is on screen, out of what matched.
 */

/** The one card a list of records lives in. Rows divide themselves. */
export function ListCard({ children, style }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={[styles.listCard, style]}>{children}</View>;
}

/**
 * One record. `last` drops the divider, which is the whole reason this is a
 * component — every screen was writing that conditional by hand and half of
 * them left a hairline hanging under the final row.
 *
 * ── `card`, for a list long enough to virtualize ────────────────────────────
 *
 * `ListCard` is a container, and a container cannot wrap the rows of a
 * `FlatList` — which is a problem for exactly the lists that most need one,
 * because a table of every account on the platform is the table you cannot
 * afford to mount in full. Pass `card` and each row carries the card's own
 * fill, side borders and padding, with `first`/`last` closing the ends. The
 * result is pixel-identical to the same rows inside a `ListCard`; it just does
 * not need them all to exist at once.
 */
export function ListRow({
  children,
  onPress,
  actions,
  title,
  card = false,
  first = false,
  last = false,
  style,
  accessibilityLabel,
}) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  /**
   * `actions` alone makes the WHOLE ROW the way in.
   *
   * The row used to carry an overflow button, so a list had two targets per
   * line: the row, and a small glyph inside it that opened everything the row
   * could actually do. Handing the row's own press to the sheet removes the
   * competition — there is one target, it is the full width of the line, and
   * the chevron at the end is the label for it rather than a separate control.
   *
   * ── Unless the row leads somewhere ──────────────────────────────────────
   *
   * That reasoning holds right up until the record has a SCREEN of its own,
   * and then it inverts. The roster proved it: a student row handed its press
   * to the sheet, so the more permission an admin had the less they could
   * read — a full admin tapping a name got a menu whose first item was "Open
   * profile", while a sub-admin who could not manage students went straight
   * to the profile. Tapping a person should show you the person.
   *
   * So a row given BOTH navigates on press and ends in a `⋯` for the verbs.
   * The two targets stop competing once they do different things: one opens
   * the record, one acts on it, and that is the same division the topic and
   * organization cards make.
   */
  const [open, setOpen] = useState(false);
  const shown = (actions ?? []).filter(Boolean);
  const hasMenu = shown.length > 0;
  const navigates = Boolean(onPress);
  const press = hasMenu && !navigates ? () => setOpen(true) : onPress;

  /**
   * In card mode the final row keeps its bottom hairline — there it is the
   * card's edge rather than a divider, and both are drawn in the same
   * `hairline`, so the row simply does not drop it.
   */
  const chrome = [
    styles.listRow,
    last && !card && styles.listRowLast,
    card && styles.listRowCard,
    card && first && styles.listRowCardFirst,
    card && last && styles.listRowCardLast,
  ];

  /**
   * The row's own trailing mark. A chevron when the press navigates and there
   * is nothing else to offer; the `⋯` when the verbs need a control of their
   * own beside the destination.
   */
  const tail =
    navigates && hasMenu ? (
      <RowMenu title={title} label={`Actions for ${title ?? 'this row'}`} actions={shown} />
    ) : (
      // A row that leads somewhere says so, whether that somewhere is a sheet
      // of actions or another screen.
      <Icon name="chevronRight" size={16} color={colors.inkFaint} />
    );

  const body = !press ? (
    <View style={[...chrome, style]}>{children}</View>
  ) : (
    <Pressable
      onPress={press}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => [...chrome, pressed && styles.listRowPressed, style]}
    >
      {children}
      {tail}
    </Pressable>
  );

  // The sheet is the row's own only while the row IS the sheet's trigger; once
  // there is a `⋯`, that control owns it.
  if (!hasMenu || navigates) return body;
  return (
    <>
      {body}
      <ActionSheet
        visible={open}
        title={title}
        actions={shown}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/** The sheet of verbs a row or a header opens. One layout for both. */
function ActionSheet({ visible, title, actions, onClose }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  return (
    <Sheet visible={visible} title={title} onClose={onClose} accessibilityLabel={title} scroll>
      <View style={styles.menuList}>
        {actions.map((action) => (
          <Pressable
            key={action.key ?? action.label}
            onPress={() => {
              onClose();
              action.onPress?.();
            }}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            style={({ pressed }) => [
              styles.menuRow,
              action.destructive && styles.menuRowDanger,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Icon
              name={action.icon ?? 'chevronRight'}
              size={18}
              color={action.destructive ? colors.wrong : colors.accent}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="label" color={action.destructive ? colors.wrong : colors.ink}>
                {action.label}
              </Text>
              {action.meta ? (
                <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
                  {action.meta}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

/**
 * What is on screen, out of what matched — and the one screen-level action
 * that is not the primary (Select, Export) on the right.
 */
export function CountRow({ shown, total, noun, action, onAction, meta }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const plural = total === 1 ? noun : `${noun}s`;
  const count =
    shown != null && total != null && shown < total
      ? `${shown} of ${total} ${plural}`
      : `${total ?? shown ?? 0} ${plural}`;
  return (
    <View style={styles.countRow}>
      {/* `meta` carries the one extra fact some lists have — "out of 140", "due
          Friday". It exists so a screen with something to add does not have to
          hand-roll its own count line and lose the Export slot with it, which is
          how the console ended up with the same verb in three places. */}
      <Text variant="meta" color={colors.inkFaint} style={{ flex: 1 }}>
        {meta ? `${count}  ·  ${meta}` : count}
      </Text>
      {action ? (
        <Pressable
          onPress={onAction}
          hitSlop={8}
          accessibilityRole="button"
          style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
        >
          <Text variant="label" color={colors.accent}>
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * A titled card of figures — the unit every console overview is built from.
 *
 * The three overview screens each had their own: a bare row of numbers in a
 * bordered box on one, two rows split by a hairline on another, a third
 * variant on the tenant screen. Same idea, three shapes, three stylesheets,
 * and no way to tell from any of them what the numbers were ABOUT.
 *
 * The header is what fixes that. A glyph on its domain's tint, the domain's
 * name in the domain's hue, and then the figures — so "240 / Students" is
 * filed under People before it is read, and the same three figures on the
 * platform screen, the organization screen and a tenant's screen are
 * recognisably the same kind of statement.
 *
 * The disc sits inside the card on purpose: it is drawn on white, which is the
 * surface its contrast was solved against. See `IconDisc`.
 */
export function StatPanel({ label, icon, tone = 'content', stats, style }) {
  const domains = useDomains();
  const styles = useThemedStyles(makeStyles);
  const { elevation } = useTheme();
  const hue = (domains[tone] ?? domains.content).hue;
  return (
    <View style={[styles.statPanel, elevation.raised, style]}>
      {label ? (
        <View style={styles.statPanelHead}>
          {icon ? <IconDisc name={icon} tone={tone} size={28} /> : null}
          <Text variant="label" color={hue} numberOfLines={1}>
            {label}
          </Text>
        </View>
      ) : null}
      <View style={styles.statPanelBody}>
        {stats.filter(Boolean).map((stat, i) => (
          <View key={stat.label} style={styles.statPanelCell}>
            {i > 0 ? <View style={styles.statPanelDivider} /> : null}
            <Stat {...stat} />
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * The band of chrome between a header and a scrolling list.
 *
 * Search, a topic select, the chips saying what is filtered — every console
 * list has some of this, and every one of them had it sitting loose on the
 * field with a margin above and nothing at all below. Nothing overlaps: the
 * list is BENEATH these controls in layout, not behind them. But with no rule
 * and no gap, the first card comes up flush against the bottom edge of the last
 * control, and a card whose top edge touches a select reads as CLIPPED by it
 * rather than as the start of a list that scrolls underneath.
 *
 * One band with one hairline fixes it everywhere at once: the header region
 * visibly ends, and the list visibly begins. It keeps the field's own colour
 * rather than lifting to a card — a white toolbar under a transparent tab bar
 * would be a third surface in the top eighty points of the screen.
 */
export function ConsoleControls({ children, style }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={[styles.consoleControls, style]}>{children}</View>;
}

/**
 * The footer that holds the one primary action.
 *
 * Its own safe-area inset and its own hairline, so the button sits above the
 * gesture bar on every phone and the list visibly scrolls under it rather than
 * ending in an ambiguous gap.
 */
export function ConsoleFooter({ children }) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.consoleFooter, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
      {children}
    </View>
  );
}

/**
 * An overflow `⋯`, for a CARD or a HEADER — never for a list row.
 *
 * The split, because the two cases genuinely differ:
 *
 *   **List rows** pass `actions` to `ListRow`. The whole line is the target and
 *   a chevron says so. A `⋯` inside a row is a second, smaller target competing
 *   with the row it sits in, which is what made the roster and the batch list
 *   feel fiddly.
 *
 *   **Cards and headers** use this. A card already carries a real button (topic
 *   "Questions", contest "Standings"), so its extra verbs need a control of
 *   their own rather than the card's press — and a chevron in the top-right of a
 *   header would promise navigation the header does not perform.
 *
 * Both open the same `ActionSheet`, so the verbs read identically wherever they
 * were reached from.
 *
 * A console list row used to lay its verbs out end to end — a soft "Rename"
 * pill beside a ghost "Delete", a soft "Batch" beside a ghost "Suspend" — and
 * that had three problems at once. The pair reads as one button and one label,
 * because a tinted pill next to grey text is exactly what a button next to a
 * caption looks like. Rows came out different widths depending on which verbs
 * applied, so the list had no column to read down. And the destructive one was
 * always the plain-text one, sitting a thumb's width from the row you actually
 * meant to tap.
 *
 * Every row in both consoles now ends the same way: one `⋯`, and a sheet that
 * names what it can do. Destructive entries are red and last.
 */
export function RowMenu({ title, actions, label = 'Actions', size = 16, tone = 'ink' }) {
  const [open, setOpen] = useState(false);
  const shown = actions.filter(Boolean);
  if (shown.length === 0) return null;

  return (
    <>
      {/* `tone` is for the two menus that sit in a console HEADER, which is
          night chrome — the sheet it opens stays on paper either way. */}
      <IconButton name="more" size={size} label={label} tone={tone} onPress={() => setOpen(true)} />
      <ActionSheet
        visible={open}
        title={title}
        actions={shown}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/** The rounded search field used on Search, Friends and the join sheet. */
export function SearchField({ value, onChangeText, placeholder, onClear, style, ...props }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.searchField, style]}>
      <Icon name="search" size={18} color={colors.inkFaint} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
        accessibilityLabel={placeholder}
        {...props}
      />
      {value?.length > 0 && onClear ? (
        <Pressable onPress={onClear} hitSlop={10} accessibilityLabel="Clear" style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}>
          <Icon name="close" size={16} color={colors.inkFaint} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** A circular icon button — back arrows, the bell, the gear. */
export function IconButton({ name, onPress, label, tone = 'ink', size = 20, style }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const fg = tone === 'onColor' ? colors.onColor : tone === 'accent' ? colors.accent : colors.ink;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.iconButton,
        tone === 'onColor' ? styles.iconButtonOnColor : styles.iconButtonPlain,
        pressed ? { opacity: 0.6 } : null,
        style,
      ]}
    >
      <Icon name={name} size={size} color={fg} />
    </Pressable>
  );
}

/**
 * Back arrow plus title — the header on every pushed screen.
 *
 * Inside a console it grows a third state: with no `onBack` to show, the slot
 * carries the sidebar's handle instead. That is what gives every console
 * screen a way back to the navigation without each of them having to know a
 * sidebar exists — and it is why the console's twenty-odd operations can be
 * listed somewhere rather than buried behind a chain of pushes.
 */
export function Header({ title, subtitle, onBack, onMenu, right, tone, style }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const console_ = useConsoleNav();
  /**
   * A console header is night chrome, so it takes the on-colour treatment
   * whether or not the caller asked for it — white title, translucent-white
   * icon buttons, a 72%-white caption. See `headerConsole`.
   */
  const resolved = tone ?? (console_ ? 'onColor' : 'ink');
  const fg = resolved === 'onColor' ? colors.onColor : colors.ink;
  const subFg = resolved === 'onColor' ? 'rgba(255,255,255,0.72)' : colors.inkMuted;
  const menu = !onBack && console_ && !console_.pinned;
  return (
    /**
     * A console header is a bar, not a billboard: tighter gutter, less air
     * above and below, and a hairline under it so the content that follows
     * reads as a separate region rather than as more header.
     */
    <View style={[styles.header, console_ && styles.headerConsole, style]}>
      {onBack ? <IconButton name="back" onPress={onBack} label="Back" tone={resolved} /> : null}
      {/* `onMenu` is how a screen with unsaved work gets a word in before the
          sidebar takes it away — the settings form is the only one that needs
          it, and without the hook its guard would have been the reason it kept
          a back arrow nothing else in the console has. */}
      {menu ? (
        <IconButton
          name="menu"
          onPress={onMenu ?? console_.open}
          label="Open the menu"
          tone={resolved}
        />
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        {title ? (
          /**
           * `display` in a console, `title` in the player app.
           *
           * The player's headers sit under a hero or over artwork and 19pt is
           * plenty. A console screen has nothing above it — the header IS the
           * top of the page — and at 16pt (the console's `title`) it read as a
           * caption for the tab bar under it rather than as the name of the
           * screen. 22 is still smaller than the player's 26.
           */
          <Text variant={console_ ? 'display' : 'title'} color={fg} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text variant="meta" color={subFg} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/**
 * The title block on a player TAB.
 *
 * A tab is not a pushed screen, so it has no back arrow and `Header` is the
 * wrong shape for it — which is why Play, Friends and Shop each grew their own.
 * They came out three different heights (12pt of padding above the title on
 * two of them, 8 on the third; 0 below on two, 12 on the third) and two of them
 * called the style `head` while the third called it `header`. Switching tabs
 * moved the title, which is the kind of thing you feel before you see.
 *
 * Home and Profile keep their own tops on purpose: Home's is an identity bar
 * (face, greeting, space switcher, balance) and Profile's is a hero on a
 * gradient. Neither is a title with a caption, so neither is this.
 */
export function TabHeader({ title, caption, right }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.tabHeader}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="display" numberOfLines={1}>
          {title}
        </Text>
        {caption ? (
          <Text variant="meta" color={colors.inkFaint}>
            {caption}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function Divider({ style }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={[styles.divider, style]} />;
}

/**
 * A glyph on a tinted disc of its own hue.
 *
 * One shape, used everywhere the console names a KIND of thing: the audit
 * row's action, the door into a tenant's topics, the empty state, a figure
 * panel. It exists because the alternative — a bare icon in the accent — makes
 * every category of thing look like the same category of thing, and a console
 * is almost entirely categories of things.
 *
 * `tone` is a domain (see the domain palette) or an explicit `{hue, soft}`.
 * The disc is always drawn on a card or on the canvas, never on the bare
 * field: the tint is 12% and the field is already grey, so the two stack into
 * mud and the glyph loses the contrast that was solved for it.
 */
export function IconDisc({ name, tone = 'content', size = 36, style }) {
  const colors = usePalette();
  const domains = useDomains();
  const pair = typeof tone === 'string' ? (domains[tone] ?? domains.content) : tone;
  const hue = pair?.hue ?? colors.accent;
  const soft = pair?.soft ?? colors.accentSoft;
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: soft,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Icon name={name} size={Math.round(size * 0.5)} color={hue} />
    </View>
  );
}

/** design.md §10 — every empty state names the single next action. */
export function EmptyState({ title, body, actionLabel, onAction, icon = 'sparkle', tone = 'content' }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.empty}>
      <IconDisc name={icon} tone={tone} size={64} style={{ marginBottom: space.lg }} />
      <Text variant="title" style={{ textAlign: 'center', marginBottom: space.sm }}>
        {title}
      </Text>
      {body ? (
        <Text
          variant="body"
          color={colors.inkMuted}
          style={{ textAlign: 'center', marginBottom: space.xl, maxWidth: 300 }}
        >
          {body}
        </Text>
      ) : null}
      {actionLabel ? <Button label={actionLabel} onPress={onAction} fullWidth={false} /> : null}
    </View>
  );
}

/**
 * design.md §10 — errors state what happened and what to do. They do not
 * apologise and they are never vague.
 */
export function ErrorNotice({ error, onRetry }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  if (!error) return null;
  return (
    <View style={styles.errorNotice}>
      <Icon name="alert" size={16} color={colors.wrong} />
      <Text variant="label" color={colors.wrong} style={{ flex: 1 }}>
        {error.message ?? 'Lost connection. Reconnecting.'}
      </Text>
      {onRetry ? (
        <Pressable onPress={onRetry} accessibilityRole="button" hitSlop={8} style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}>
          <Text variant="label" color={colors.ink}>
            Retry
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Screen({ children, style }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={[styles.screen, style]}>{children}</View>;
}

/**
 * The app's spinner: the Mimo mark, turning.
 *
 * Two circles on a shared axis — the filled one leading, the ring trailing — so
 * a wait is still the product's own shape rather than the platform's. It runs
 * on the native driver, so it keeps turning even while the JS thread is busy
 * parsing the response it is waiting for, which is exactly when a stuttering
 * spinner looks like a hang.
 */
/**
 * @param color overrides `tone` entirely — for a mark that has to match
 *   something already decided, like the label of the button it is replacing.
 */
export function Spinner({ size = 28, tone = 'accent', color }) {
  const colors = usePalette();
  const spin = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  const fg = color ?? (tone === 'onColor' ? colors.onColor : colors.accent);

  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin, reduced]);

  const d = size * 0.42;
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    /**
     * Under reduced motion the mark simply sits there. It used to hand over to
     * `ActivityIndicator` at this point, which was the one place in the app
     * that drew the platform's ring instead of the product's own shape — and it
     * did it by ANIMATING, on behalf of somebody who asked for less animation.
     * A static mark under a "Loading" role is what the skeletons already do:
     * they stop pulsing and sit still.
     */
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        transform: reduced ? undefined : [{ rotate }],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: fg }} />
        <View
          style={{
            width: d,
            height: d,
            borderRadius: d / 2,
            borderWidth: Math.max(2, d * 0.22),
            borderColor: fg,
            marginLeft: -d * 0.3,
          }}
        />
      </View>
    </Animated.View>
  );
}

/**
 * `flexGrow` rather than `flex: 1`.
 *
 * `flex: 1` sets a zero flex-basis, and inside a `ScrollView` content container
 * — which has no height of its own to distribute — that collapses the whole
 * block to nothing. Growing from a minimum instead means one component works
 * both as the only child of a screen and as a row inside a list.
 */
export function Loading({ label, tone = 'accent', style }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.loading, style]}>
      <Spinner tone={tone} />
      {label ? (
        <Text
          variant="meta"
          color={tone === 'onColor' ? 'rgba(255,255,255,0.78)' : colors.inkFaint}
          style={{ marginTop: space.md }}
        >
          {label}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * design.md §5 — `sunken` is "a surface that recedes … skeletons".
 *
 * A skeleton beats a spinner wherever the shape of the answer is already known,
 * because the page stops moving when the data lands: the same blocks simply
 * gain their content. The pulse is opacity-only so it runs on the native driver
 * and costs nothing on a mid-range Android.
 */
export function Skeleton({ width = '100%', height = 14, radius = 8, style }) {
  const colors = usePalette();
  const pulse = useRef(new Animated.Value(0.55)).current;
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 620, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 620, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: radius, backgroundColor: colors.inset, opacity: reduced ? 0.7 : pulse },
        style,
      ]}
    />
  );
}

/** A run of skeleton lines. The last is short, the way a paragraph ends. */
export function SkeletonText({ lines = 2, width = '100%', gap = space.sm, style }) {
  return (
    <View style={[{ gap }, style]}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 && lines > 1 ? '62%' : width} height={12} radius={6} />
      ))}
    </View>
  );
}

/**
 * The blocking loader for an action that has already been committed to — a
 * match being entered, an account being deleted. It is a scrim rather than an
 * inline spinner because the screen behind it must stop accepting taps.
 */
export function LoadingOverlay({ visible, label }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { elevation } = useTheme();
  if (!visible) return null;
  return (
    <View style={styles.overlay} accessibilityViewIsModal accessibilityLiveRegion="polite">
      <View style={[styles.overlayCard, elevation.sheet]}>
        <Spinner size={32} />
        {label ? (
          <Text variant="label" color={colors.ink} style={{ marginTop: space.md, textAlign: 'center' }}>
            {label}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * design.md §10 — every confirmation names the consequence, and it does so in
 * the app's own sheet rather than the OS alert box. `Alert.alert` renders in
 * the system's type and colour on both platforms, which makes the single most
 * consequential moment on a screen the one moment that looks like it belongs
 * to a different product.
 *
 * One primary decision per sheet: `confirm` (danger red when destructive),
 * with cancel beneath. Pass `cancelLabel={null}` for a single-button notice.
 */
/**
 * The bottom sheet, as chrome.
 *
 * One scrim, one grabber, one title, and whatever the caller puts inside. It
 * exists so a second kind of sheet — the shop's buy sheet, which needs artwork
 * and a small ledger rather than a sentence and two buttons — does not have to
 * reproduce the modal, the scrim behaviour and the corner radii and then drift
 * from them. `ConfirmSheet` is now the common case of this rather than the only
 * one.
 *
 * The scrim is a dismiss target: tapping away is a decision too, and on a phone
 * it is the one a thumb can reach.
 *
 * ── The scrim is a SIBLING, not a parent ─────────────────────────────────────
 *
 * This used to be a `Pressable` scrim wrapping a `Pressable` sheet, the second
 * one holding an empty `onPress` so a tap on the sheet did not fall through and
 * close it. It read cleanly and it broke every scrollable thing ever put inside
 * a sheet.
 *
 * A `Pressable` claims the touch responder on touch START. A child ScrollView
 * only asks for it on MOVE, and by then the ancestor already owns the gesture —
 * so a horizontal drag inside the sheet went nowhere at all. The chest carousel
 * was simply frozen, with no error and nothing in the layout to suggest why.
 *
 * So the scrim is an absolutely-positioned sibling underneath the sheet and the
 * sheet itself is a plain `View`. A tap on the sheet never reaches the scrim
 * because it never hits it, which needs no interception to arrange — and with
 * no ancestor `Pressable` in the way, gestures inside belong to whatever the
 * caller put there.
 */
/**
 * ── Why it is capped, and why it can scroll ─────────────────────────────────
 *
 * The scrim is `justify-content: flex-end`, which means a sheet taller than the
 * screen does not push its own bottom down — it overflows off the TOP, taking
 * its title and first fields with it, unreachable. That was survivable while
 * every sheet held a sentence and two buttons; it stopped being survivable when
 * forms moved in (the new-tournament sheet, the roster sheets), because a form
 * is exactly the thing whose height depends on how many options came back from
 * the server. So the sheet is capped at 88% of the window, and `scroll` gives
 * the tall ones somewhere to put the overflow.
 *
 * `scroll` is opt-in rather than always-on because several sheets already hold
 * their own scroller — `Select`'s option list, the shop's chest carousel — and
 * a vertical ScrollView wrapped around another one fights for the gesture.
 *
 * ── It knows which app it is in ─────────────────────────────────────────────
 *
 * Like `Text` and `Button`, it reads the console context and changes surface:
 * the player's field is `canvas`, so a sheet lifting off it is `canvas` too,
 * while the console's field is `sunken` and its raised things are `nightRaised`.
 * That difference is the only reason five console screens each kept a private
 * copy of this component — they wanted the console's surface and its tighter
 * gutter, and copying the whole sheet was the only way to get them. Reading the
 * context here is what let those five copies go.
 */
export function Sheet({ visible, title, onClose, children, accessibilityLabel, scroll = false }) {
  const styles = useThemedStyles(makeStyles);
  const { elevation } = useTheme();
  const bottom = useBottomInset();
  const inConsole = Boolean(useConsoleNav());
  const Body = scroll ? ScrollView : View;
  const bodyProps = scroll
    ? { contentContainerStyle: styles.sheetScrollBody, keyboardShouldPersistTaps: 'handled', showsVerticalScrollIndicator: false }
    : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      {...FULL_BLEED_MODAL}
    >
      {/* The keyboard is the other thing that can bury a sheet, and a sheet is
          where the app puts most of its short forms. `padding` measures only the
          OVERLAP between the keyboard and this view's own frame, so on an
          Android build where the window still resizes itself it correctly
          resolves to nothing rather than double-counting. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.sheetScrim}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <View
          style={[
            styles.sheet,
            inConsole && styles.sheetConsole,
            { paddingBottom: bottom + space.lg },
            elevation.sheet,
          ]}
          accessibilityViewIsModal
          accessibilityLabel={accessibilityLabel}
        >
          <View style={styles.sheetGrabber} />
          {title ? (
            <Text variant="display" style={styles.sheetTitleCentred}>
              {title}
            </Text>
          ) : null}
          <Body {...bodyProps}>{children}</Body>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  icon,
  onConfirm,
  onCancel,
}) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { elevation } = useTheme();
  const bottom = useBottomInset();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      {...FULL_BLEED_MODAL}
    >
      <View style={styles.sheetScrim}>
        {/* A cancel target, and a sibling rather than a parent — see `Sheet`. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={loading ? undefined : onCancel}
          accessibilityRole="button"
          accessibilityLabel={cancelLabel ?? 'Close'}
        />
        <View style={[styles.sheet, { paddingBottom: bottom + space.lg }, elevation.sheet]}>
          <View style={styles.sheetGrabber} />
          {icon ? (
            <View style={[styles.sheetIcon, destructive ? styles.sheetIconDanger : null]}>
              <Icon name={icon} size={26} color={destructive ? colors.wrong : colors.accent} />
            </View>
          ) : null}
          <Text variant="display" style={styles.sheetTitle}>
            {title}
          </Text>
          {body ? (
            <Text variant="body" color={colors.inkMuted} style={styles.sheetBody}>
              {body}
            </Text>
          ) : null}
          <Button
            variant={destructive ? 'danger' : 'primary'}
            label={confirmLabel}
            loading={loading}
            onPress={onConfirm}
          />
          {cancelLabel !== null ? (
            <Button
              variant="soft"
              label={cancelLabel}
              disabled={loading}
              style={{ marginTop: space.md }}
              onPress={onCancel}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

/**
 * A `ConfirmSheet` that asks for a sentence before it will let you through.
 *
 * Suspending an organization, rejecting a report, dismissing a flag — every
 * moderation verdict in the platform console is owed a reason, because the
 * person on the other end of it gets shown one. So the decision and the sentence
 * that justifies it are the same control, and Confirm stays disabled until the
 * sentence is actually there.
 *
 * It lived twice, once on the organizations screen and once on moderation, as
 * two copies of the same ninety lines that had already drifted — one reset its
 * field on every open, the other prefilled it. Both behaviours were wanted, so
 * they are a prop here rather than a fork.
 *
 * An error keeps the sheet open with the typing intact. Throwing away a
 * paragraph because the request failed is the one thing this must never do.
 */
export function PromptSheet({
  visible,
  title,
  body,
  placeholder,
  confirmLabel,
  destructive = false,
  initialValue = '',
  minLength = 1,
  maxLength = 300,
  loading = false,
  error,
  onConfirm,
  onCancel,
}) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const [text, setText] = useState(initialValue);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (visible) setText(initialValue);
  }, [visible, initialValue]);

  const valid = text.trim().length >= minLength;

  return (
    <Sheet visible={visible} onClose={loading ? undefined : onCancel} accessibilityLabel={title} scroll>
      <Text variant="display" style={{ marginBottom: space.sm }}>
        {title}
      </Text>
      {body ? (
        <Text variant="body" color={colors.inkMuted} style={{ marginBottom: space.lg }}>
          {body}
        </Text>
      ) : null}
      <TextInput
        style={[styles.promptInput, focused && styles.promptInputFocused]}
        value={text}
        onChangeText={setText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
        maxLength={maxLength}
        multiline
        accessibilityLabel={placeholder ?? 'Reason'}
      />
      <ErrorNotice error={error} />
      <Button
        variant={destructive ? 'danger' : 'primary'}
        label={confirmLabel}
        loading={loading}
        disabled={!valid}
        style={{ marginTop: space.lg }}
        onPress={() => onConfirm(text.trim())}
      />
      <Button
        variant="soft"
        label="Cancel"
        disabled={loading}
        style={{ marginTop: space.md }}
        onPress={onCancel}
      />
    </Sheet>
  );
}

/** A progress bar. Indigo by default; a Space passes its own accent (§3.3). */
export function ProgressBar({ value, max, color, height = 8, track }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const pct = Math.max(0, Math.min(1, (value ?? 0) / (max || 1)));
  return (
    <View style={[styles.progressTrack, { height, borderRadius: height / 2, backgroundColor: track ?? colors.sunken }]}>
      <View
        style={{
          width: `${pct * 100}%`,
          height: '100%',
          backgroundColor: color ?? colors.accent,
          borderRadius: height / 2,
        }}
      />
    </View>
  );
}

/** A number over its label. The unit of every stats strip in the app. */
export function Stat({ value, label, sub, subColor, color, icon, tone, onPress, style }) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  /**
   * A number, and — when there is one — the way to the thing it counts.
   *
   * All three consoles open on a panel of figures, and every figure was inert.
   * "Students 240" is not a fact about the organization so much as a door to
   * the roster; "12 waiting" is the review queue with a number on it. Leaving
   * them flat made the first screen of each console a poster, and put the
   * sidebar between the operator and every single thing the poster mentioned.
   *
   * `onPress` is optional because some figures genuinely lead nowhere — a
   * stickiness ratio is not a list — and a stat that cannot be pressed must
   * not look pressable.
   */
  const body = (
    <>
      {/**
       * An optional disc above the figure, in the domain the figure belongs to.
       *
       * A panel of three bare numbers is legible and anonymous; the same three
       * with a glyph each are scannable from across a desk, and on the two
       * overview screens — six figures apiece, which is the whole page — that
       * is the difference between a dashboard and a receipt.
       */}
      {icon ? <IconDisc name={icon} tone={tone ?? 'content'} size={34} style={{ marginBottom: 6 }} /> : null}
      {/**
       * `timer` is 27pt and tabular INSIDE A CONSOLE (see `consoleType`), 22 in
       * the player app. On a dashboard the figure is the content and the label
       * is its caption; at the player's size over a 12pt label the two were
       * close enough in weight that a stats row read as a paragraph.
       */}
      <Text variant="timer" color={color}>
        {value}
      </Text>
      <Text variant="meta" color={onPress ? colors.inkMuted : colors.inkFaint} numberOfLines={1}>
        {label}
      </Text>
      {sub ? (
        <Text variant="tiny" color={subColor ?? colors.inkFaint} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </>
  );

  if (!onPress) return <View style={[styles.stat, style]}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // The number alone is meaningless read aloud out of context, so the
      // label goes with it — "240, Students" rather than "240".
      accessibilityLabel={`${value} ${label}`}
      style={({ pressed }) => [styles.stat, styles.statPressable, pressed && { opacity: 0.6 }, style]}
    >
      {body}
    </Pressable>
  );
}

/**
 * Every style in this file, as a function of the palette.
 *
 * It was a module-level `StyleSheet.create`, which snapshots whatever the
 * colour tokens held at import time — so these components were dark for ever
 * and a light console was impossible without duplicating the whole file. The
 * sheet is now built once PER PALETTE, on first use, and handed out by
 * identity after that; see `useThemedStyles`.
 */
const makeStyles = (colors, elevation) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  button: {
    borderRadius: layout.radiusPill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.sm,
  },
  avatar: {
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  card: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    padding: layout.cardPadding,
    // On night, shadows barely read — the hairline is what draws the card.
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  cardPressed: {
    // One step down from the raised fill, not two — a card that dropped
    // straight to the inset colour read as a different component on press.
    backgroundColor: colors.canvas,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.md,
  },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
  chip: {
    minHeight: 38,
    paddingHorizontal: space.lg,
    borderRadius: layout.radiusPill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  chipConsole: { minHeight: 32, paddingHorizontal: space.md, borderWidth: 1 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipOff: { backgroundColor: colors.nightRaised, borderColor: colors.hairline },
  badge: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: 7,
  },
  segmented: {
    flexDirection: 'row',
    /** The TRACK of a segmented control is a groove, not a card. */
    backgroundColor: colors.control,
    borderRadius: layout.radiusPill,
    padding: 4,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    borderRadius: layout.radiusPill,
    paddingHorizontal: space.sm,
  },
  /** On the corner, so it costs the label no width at four tabs across. */
  segmentDot: {
    position: 'absolute',
    top: 7,
    right: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.gold,
  },
  segmentOn: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
  },

  // ── Page tabs ────────────────────────────────────────────────────────────
  tabBar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.nightRaised,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    paddingHorizontal: space.sm,
  },
  tabBarScroll: {
    flexGrow: 0,
    backgroundColor: colors.nightRaised,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  tabBarScrollContent: { paddingHorizontal: space.sm, alignItems: 'stretch', minHeight: 44 },
  tab: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: space.sm,
  },
  tabInner: {
    paddingBottom: space.sm,
    // The underline is drawn even when off, in the field colour, so a tab does
    // not shift by two points as it becomes the selected one.
    borderBottomWidth: 2,
    borderBottomColor: colors.transparent,
  },
  tabInnerOn: { borderBottomColor: colors.accent },

  // ── Select ───────────────────────────────────────────────────────────────
  selectLabel: { marginBottom: space.xs },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: consoleLayout.buttonHeight,
    paddingHorizontal: space.md,
    borderRadius: layout.radiusInput,
    /**
     * A select is something you OPERATE, so it is recessed rather than raised.
     * It used to be `nightRaised` — which on paper is the colour of the card
     * it sits on and of the page behind that, so the only thing marking the one
     * control in a filter bar was its own hairline.
     */
    backgroundColor: colors.control,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  /**
   * `flexShrink: 1` because React Native defaults it to 0, unlike CSS. Without
   * it the list keeps its full 380 inside a sheet that is now capped at 88% of
   * the window, and on a short phone the bottom of the options is simply cut
   * off with no way to reach it.
   */
  selectList: { maxHeight: 380, flexGrow: 0, flexShrink: 1 },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.touchMin,
    paddingHorizontal: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },

  // ── The console page ─────────────────────────────────────────────────────
  stat: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: 4 },
  /** A pressable figure still has to clear the touch floor. */
  statPressable: { minHeight: layout.touchMin, justifyContent: 'center' },
  /** Its own band, centred, closed by a hairline. See `Steps`. */
  steps: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: consoleLayout.gutter,
    paddingTop: space.md,
    paddingBottom: space.md,
    backgroundColor: colors.nightRaised,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
  stepLine: {
    width: 20,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.hairline,
    marginHorizontal: space.sm,
  },
  stepLineOn: { backgroundColor: colors.accent },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  stepDotOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  stepDotDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  stepLabel: { flexShrink: 1 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  /** The 44pt target. The dot inside it is what you see. */
  swatchHit: {
    width: layout.touchMin,
    height: layout.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: colors.transparent,
  },
  swatchDotOn: { borderColor: colors.ink },
  listCard: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: layout.cardPadding,
    overflow: 'hidden',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: consoleLayout.rowHeight,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  listRowLast: { borderBottomWidth: 0 },
  listRowPressed: { backgroundColor: colors.canvas },
  /** `ListCard`'s chrome, worn by the row — see `ListRow`'s `card`. */
  listRowCard: {
    backgroundColor: colors.nightRaised,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderLeftColor: colors.hairline,
    borderRightColor: colors.hairline,
    paddingHorizontal: layout.cardPadding,
    overflow: 'hidden',
  },
  listRowCardFirst: {
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    borderTopLeftRadius: layout.radiusCard,
    borderTopRightRadius: layout.radiusCard,
  },
  listRowCardLast: {
    borderBottomLeftRadius: layout.radiusCard,
    borderBottomRightRadius: layout.radiusCard,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 32,
    paddingBottom: space.sm,
  },
  consoleFooter: {
    paddingHorizontal: consoleLayout.gutter,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    // White, like the app bar at the other end. Chrome is chrome at both ends
    // of a screen, and a grey footer under a grey list had nothing to say it
    // was not just more list.
    backgroundColor: colors.nightRaised,
  },
  statPanel: {
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  statPanelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: layout.cardPadding,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  statPanelBody: { flexDirection: 'row', paddingVertical: space.lg },
  statPanelCell: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  statPanelDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.hairline },

  /** The footer's opposite number, and the last band of the app bar. */
  consoleControls: {
    paddingHorizontal: consoleLayout.gutter,
    paddingTop: space.sm,
    paddingBottom: space.md,
    gap: space.sm,
    backgroundColor: colors.nightRaised,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },

  // ── RowMenu ──────────────────────────────────────────────────────────────
  menuList: { gap: space.xs },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 52,
    paddingHorizontal: space.md,
    borderRadius: layout.radiusInput,
    /**
     * One step down from the sheet, so a verb reads as a target.
     *
     * These were `nightRaised` — the sheet's own colour — so on paper every
     * safe action in a row menu was an invisible rectangle and only the
     * destructive one, on its red wash, looked like something you could press.
     */
    backgroundColor: colors.canvas,
  },
  menuRowDanger: { backgroundColor: colors.wrongSoft },

  filterBar: { flexGrow: 0 },
  filterBarContent: {
    gap: space.sm,
    alignItems: 'center',
    paddingHorizontal: consoleLayout.gutter,
    // The row owns its height so the scroller cannot squeeze the chips.
    height: 48,
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    /** Recessed, like every other thing you type into. See `select`. */
    backgroundColor: colors.control,
    borderRadius: layout.radiusPill,
    paddingHorizontal: space.lg,
    minHeight: 48,
    /**
     * The edge, because the fill alone is not always one — on night the control
     * fill and the card it sits on are a single step apart, and this is what
     * keeps the field from dissolving into the surface behind it.
     */
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  searchInput: {
    ...type.body,
    color: colors.ink,
    flex: 1,
    paddingVertical: 0,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonPlain: { backgroundColor: colors.inset },
  iconButtonOnColor: { backgroundColor: 'rgba(255, 255, 255, 0.18)' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.gutter,
    paddingVertical: space.md,
  },
  tabHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.gutter,
    paddingTop: space.md,
    paddingBottom: space.md,
  },
  /**
   * ── The console app bar ──────────────────────────────────────────────────
   *
   * A console screen opened with a 20pt title and a 12pt grey subtitle floating
   * on the same grey as everything under them. Then tabs on grey, then a filter
   * band on grey — four stacked strips of identical colour, told apart only by
   * hairlines. Nothing said "this is the top of the screen", so no screen had a
   * beginning.
   *
   * The CONTROLS are white now — the tab bar, the filter band, the footer — so
   * the interactive chrome is a surface and the list is the page. The title
   * block stays on the field, and gets its presence from type instead: 22pt
   * (see `consoleType.display`) with room around it.
   *
   * It stays on the field for a mundane reason worth writing down. Every
   * console screen is a `SafeAreaView` with `edges={['top']}`, which paints the
   * status-bar inset in the SCREEN's colour — so a white header would have hung
   * below a grey strip on every notched phone in the product. Fixing that
   * properly means moving the field colour off `screen` and onto thirty scroll
   * containers; it is not worth it for a band the type already carries.
   */
  /**
   * ── Chrome is night, the workspace is paper ──────────────────────────────
   *
   * A console screen used to open with grey text on the same grey as
   * everything under it: status inset, header, tabs, filters, list — five
   * stacked strips of #EFEFF3 and #FFFFFF, told apart by hairlines. Nothing
   * anchored the page and nothing in it belonged to this product rather than
   * to any admin template.
   *
   * The rule now is the one the sidebar states: NAVIGATION is the night world,
   * WORKSPACE is paper. This is the phone's half of that — on a phone the rail
   * is a drawer, so the header is the only chrome always on screen, and it
   * carries the brand for both.
   *
   * `ConsoleShell` paints the status-bar inset in the same surface, which is
   * why console screens pass `edges={[]}` rather than `['top']`: a
   * `SafeAreaView` paints its inset in the SCREEN's colour, and that grey strip
   * above a dark bar was the reason this was left on the field the first time.
   */
  headerConsole: {
    paddingHorizontal: consoleLayout.gutter,
    paddingTop: space.md,
    paddingBottom: space.md,
    backgroundColor: night.canvas,
  },
  divider: {
    height: 1,
    backgroundColor: colors.hairline,
  },
  empty: {
    // See `Loading` — `flex: 1` collapses inside a ScrollView content container.
    flexGrow: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    padding: layout.gutter,
    paddingVertical: space.xxxl,
  },
  errorNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.wrongSoft,
    borderRadius: layout.radiusInput,
    padding: space.md,
    marginHorizontal: layout.gutter,
    marginBottom: space.md,
  },
  loading: {
    flexGrow: 1,
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xxl,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  overlayCard: {
    minWidth: 180,
    maxWidth: 280,
    backgroundColor: colors.nightRaised,
    borderRadius: layout.radiusCard,
    paddingHorizontal: space.xl,
    paddingVertical: space.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  progressTrack: {
    overflow: 'hidden',
    width: '100%',
  },
  sheetScrim: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.canvas,
    borderTopLeftRadius: layout.radiusCard + 8,
    borderTopRightRadius: layout.radiusCard + 8,
    padding: layout.gutter,
    /**
     * The cap that keeps a tall sheet on the screen rather than off the top of
     * it. `paddingBottom` is not here on purpose: it is the safe area, so it is
     * applied at render from `useBottomInset()`.
     */
    maxHeight: '88%',
  },
  /** The console's raised surface and its tighter gutter — see `Sheet`. */
  sheetConsole: { backgroundColor: colors.nightRaised, padding: consoleLayout.gutter },
  /**
   * The reason field in a `PromptSheet`.
   *
   * `sunken` and a visible edge, because both copies this replaced filled the
   * box with `nightRaised` and gave it a TRANSPARENT border — the same value as
   * the console sheet it sits on. The field was therefore drawn in exactly the
   * colour of the surface behind it, and all that marked the one control on the
   * sheet was its placeholder text floating in space.
   */
  promptInput: {
    ...type.option,
    color: colors.ink,
    backgroundColor: colors.inset,
    borderRadius: layout.radiusInput,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    minHeight: 54,
    textAlignVertical: 'top',
  },
  promptInputFocused: { borderColor: colors.accent },
  sheetScrollBody: { paddingBottom: space.xs },
  sheetGrabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.hairline,
    alignSelf: 'center',
    marginBottom: space.lg,
  },
  sheetIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  sheetIconDanger: { backgroundColor: colors.wrongSoft },
  sheetTitle: { marginBottom: space.sm },
  sheetTitleCentred: { marginBottom: space.lg, textAlign: 'center' },
  sheetBody: { marginBottom: space.xl },
});

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  Easing,
} from 'react-native';
import {
  colors,
  consoleLayout,
  consoleType,
  elevation,
  fonts,
  layout,
  space,
  type,
  motion,
} from '../theme/index.js';
import { useConsoleNav } from './consoleNav.js';
import { useReducedMotion } from '../lib/motion.js';
import { resolveAvatar } from '../lib/avatar.js';
import Icon from './Icon.jsx';

/**
 * Text bound to the type scale. Nothing outside design.md §4.2 is reachable.
 *
 * Inside a console it binds to the DENSER ramp instead. A manager reading a
 * roster of two hundred names does not want the type a player reads one
 * question at a time in, and the alternative — every console screen naming its
 * own sizes — is how a design system stops being one.
 */
export function Text({ variant = 'body', color = colors.ink, style, children, ...props }) {
  const inConsole = Boolean(useConsoleNav());
  const scale = inConsole && consoleType[variant] ? consoleType[variant] : type[variant];
  return (
    <RNText style={[scale, { color }, style]} {...props}>
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
  const scale = useRef(new Animated.Value(1)).current;
  const reduced = useReducedMotion();

  const press = (to) =>
    Animated.timing(scale, {
      toValue: to,
      duration: reduced ? 0 : 80,
      useNativeDriver: true,
    }).start();

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
    outline: { bg: colors.transparent, fg: colors.accent, border: colors.accent },
    ghost: { bg: colors.transparent, fg: colors.inkMuted, border: colors.transparent },
    danger: { bg: colors.transparent, fg: colors.wrong, border: colors.wrong },
    /** The two variants for a button sitting on a saturated field. */
    onColor: { bg: colors.canvas, fg: colors.accent, border: colors.transparent },
    onColorSoft: { bg: 'rgba(255,255,255,0.18)', fg: colors.onColor, border: colors.transparent },
  }[variant];

  const bordered = variant === 'outline' || variant === 'danger';
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
  const inConsole = Boolean(useConsoleNav());
  const height =
    size === 'sm' ? 44 : size === 'md' ? 46 : inConsole ? consoleLayout.buttonHeight : layout.buttonHeight;
  const labelSize = size === 'sm' || inConsole ? 14 : 16;

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
            backgroundColor: pressed && palette.press ? palette.press : palette.bg,
            borderColor: palette.border,
            borderWidth: bordered ? 1.5 : 0,
            paddingHorizontal: size === 'sm' ? space.lg : space.xl,
            opacity: disabled ? 0.45 : 1,
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={palette.fg} />
        ) : (
          <>
            {icon ? <Icon name={icon} size={18} color={palette.fg} /> : null}
            <RNText
              numberOfLines={1}
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
export function RollingNumber({ value, style, color = colors.ink }) {
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
        { color, fontVariant: ['tabular-nums'], transform: [{ scale: pulse }] },
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
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: Boolean(active) }}
      style={({ pressed }) => [
        styles.chip,
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

/** A small count or status pill that sits on artwork — "16 Qs", "Live". */
export function Badge({ label, tone = 'ink', style }) {
  const bg = {
    ink: 'rgba(27, 27, 47, 0.72)',
    accent: colors.accent,
    correct: colors.correct,
    wrong: colors.wrong,
    soft: colors.accentSoft,
  }[tone];
  /**
   * The accent fill takes near-black type, not white: the accent is bright
   * enough that white on it is 1.9:1. `correct` and `wrong` are dark enough to
   * keep white, so the fill decides rather than one rule for all of them.
   */
  const fg =
    tone === 'soft'
      ? colors.accent
      : tone === 'accent'
        ? colors.onAccent
        : colors.onColor;
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
const MEDAL_TILES = {
  1: { bg: 'rgba(245, 182, 46, 0.18)', fg: colors.gold },
  2: { bg: 'rgba(199, 206, 219, 0.18)', fg: colors.silver },
  3: { bg: 'rgba(222, 154, 98, 0.18)', fg: colors.bronze },
};

export function RankTile({ rank, self, size = 30 }) {
  const medal = MEDAL_TILES[rank];
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

/** design.md §6.7 — the scope switcher. One row, the selected pane in white. */
export function Segmented({ options, value, onChange, style }) {
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
            style={({ pressed }) => [styles.segment, on ? styles.segmentOn : null, pressed && { opacity: 0.7 }]}
          >
            <Text variant="label" color={on ? colors.accent : colors.inkMuted} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The rounded search field used on Search, Friends and the join sheet. */
export function SearchField({ value, onChangeText, placeholder, onClear, style, ...props }) {
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
export function Header({ title, subtitle, onBack, right, tone = 'ink', style }) {
  const fg = tone === 'onColor' ? colors.onColor : colors.ink;
  const subFg = tone === 'onColor' ? 'rgba(255,255,255,0.72)' : colors.inkMuted;
  const console_ = useConsoleNav();
  const menu = !onBack && console_ && !console_.pinned;
  return (
    /**
     * A console header is a bar, not a billboard: tighter gutter, less air
     * above and below, and a hairline under it so the content that follows
     * reads as a separate region rather than as more header.
     */
    <View style={[styles.header, console_ && styles.headerConsole, style]}>
      {onBack ? <IconButton name="back" onPress={onBack} label="Back" tone={tone} /> : null}
      {menu ? (
        <IconButton name="menu" onPress={console_.open} label="Open the menu" tone={tone} />
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        {title ? (
          <Text variant="title" color={fg} numberOfLines={1}>
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

export function Divider({ style }) {
  return <View style={[styles.divider, style]} />;
}

/** design.md §10 — every empty state names the single next action. */
export function EmptyState({ title, body, actionLabel, onAction, icon = 'sparkle' }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={30} color={colors.accent} />
      </View>
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
export function Spinner({ size = 28, tone = 'accent' }) {
  const spin = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  const fg = tone === 'onColor' ? colors.onColor : colors.accent;

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

  // Under reduced motion the mark simply sits there — a static logo reads as
  // "loading" in context, and a spinner is decoration the moment it cannot turn.
  if (reduced) {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={fg} />
      </View>
    );
  }

  const d = size * 0.42;
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ rotate }],
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
        { width, height, borderRadius: radius, backgroundColor: colors.sunken, opacity: reduced ? 0.7 : pulse },
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
export function Sheet({ visible, title, onClose, children, accessibilityLabel }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.sheetScrim}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <View
          style={[styles.sheet, elevation.sheet]}
          accessibilityViewIsModal
          accessibilityLabel={accessibilityLabel}
        >
          <View style={styles.sheetGrabber} />
          {title ? (
            <Text variant="display" style={styles.sheetTitleCentred}>
              {title}
            </Text>
          ) : null}
          {children}
        </View>
      </View>
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
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.sheetScrim}>
        {/* A cancel target, and a sibling rather than a parent — see `Sheet`. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={loading ? undefined : onCancel}
          accessibilityRole="button"
          accessibilityLabel={cancelLabel ?? 'Close'}
        />
        <View style={[styles.sheet, elevation.sheet]}>
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

/** A progress bar. Indigo by default; a Space passes its own accent (§3.3). */
export function ProgressBar({ value, max, color = colors.accent, height = 8, track = colors.sunken }) {
  const pct = Math.max(0, Math.min(1, (value ?? 0) / (max || 1)));
  return (
    <View style={[styles.progressTrack, { height, borderRadius: height / 2, backgroundColor: track }]}>
      <View
        style={{
          width: `${pct * 100}%`,
          height: '100%',
          backgroundColor: color,
          borderRadius: height / 2,
        }}
      />
    </View>
  );
}

/** A number over its label. The unit of every stats strip in the app. */
export function Stat({ value, label, color = colors.ink, style }) {
  return (
    <View style={[{ flex: 1, alignItems: 'center', gap: 2 }, style]}>
      <Text variant="timer" color={color}>
        {value}
      </Text>
      <Text variant="meta" color={colors.inkFaint} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipOff: { backgroundColor: colors.sunken, borderColor: colors.hairline },
  badge: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: 7,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.sunken,
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
  segmentOn: {
    backgroundColor: colors.canvas,
    shadowColor: '#1B1B2F',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.sunken,
    borderRadius: layout.radiusPill,
    paddingHorizontal: space.lg,
    minHeight: 48,
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
  iconButtonPlain: { backgroundColor: colors.sunken },
  iconButtonOnColor: { backgroundColor: 'rgba(255, 255, 255, 0.18)' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.gutter,
    paddingVertical: space.md,
  },
  headerConsole: {
    paddingHorizontal: consoleLayout.gutter,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
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
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
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
    paddingBottom: space.xxxl,
  },
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

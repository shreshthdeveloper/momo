/**
 * Mimo — the design system.
 *
 * The app is the night world of the splash and the match, everywhere. Three
 * rules keep it from drifting:
 *
 * 1. **The field is dark and quiet; colour is small and earned.** Every screen
 *    sits on `night`. Saturated fills are reserved for things that carry a
 *    verdict, a standing or an action — never for decoration, and never for a
 *    whole panel. This is the rule the app previously broke: the brand colour
 *    filled banners, podiums and plinths, and the result read as a purple wash
 *    rather than as a game.
 *
 * 2. **`accent` is the brand and the player.** It fills the one primary button
 *    on a screen, it marks the viewer's own row, and in a match it is *you*.
 *    `rival` is the opponent and nothing else, ever. Because those two are
 *    fixed, a player never has to work out who a number belongs to.
 *
 *    It is a deep teal rather than the violet it used to be, and deliberately
 *    a muted one. Saturation is what makes a dark interface look cheap: one
 *    fully-lit hue across a button, a chip and a tab bar reads as a toy. Held
 *    down at this depth it can do all three jobs and still leave the gold and
 *    the verdict colours as the loudest things on screen. It is also the one
 *    hue the quiz four do not already own.
 *
 * 3. **The four quiz colours are positional, not semantic.** Option A is always
 *    blue, B red, C amber, D green — before an answer resolves they carry no
 *    verdict at all. Once the round resolves, `correct` and `wrong` take over
 *    completely, which is why they are separate values and not reused from the
 *    quiz four.
 *
 * `gold` is the third voice: achievement, and only achievement — leagues,
 * medals, streaks, the versus coin. Never an action.
 */

export const colors = {
  // ── Brand ────────────────────────────────────────────────────────────────
  /**
   * A deep, low-saturation teal — deliberately NOT a neon cyan.
   *
   * The first pass at this was `#22C9DE`, and on device it read as cheap: a
   * fully saturated hue at high lightness is the single loudest thing a dark
   * UI can contain, and a whole button of it looks like a warning rather than
   * an invitation. Reference palettes for dark products down-tune bright cyan
   * (`#06B6D4` → `#0891B2`) for exactly this reason; this sits in that band.
   *
   * It is chosen to satisfy BOTH jobs at once, which is what lets the palette
   * stay one token instead of two: against the night canvas it is 5.6:1 as
   * type, and it carries near-black type at 5.7:1 as a fill. A brighter accent
   * fails the first test's spirit by shouting; a deeper one fails the second
   * outright.
   */
  accent: '#3A9FB2',
  accentPress: '#328C9D',
  /** The deep end: gradient feet, pressed plinths, the foot of a fill. */
  accentDeep: '#24697A',
  /** Tinted fills: the secondary button, active chips, the viewer's own row. */
  accentSoft: '#14303A',
  accentSoftPress: '#1A3E4A',
  /**
   * Type on the accent fill is near-black, not white. This is the deliberate
   * signature of the palette: a dark label on a muted teal reads as considered,
   * where white on a bright cyan reads as a default.
   */
  onAccent: '#04161B',

  /**
   * Achievement, and nothing else. A league badge, a medal, a streak, the coin
   * struck on the versus screen. It must never be offered as a button, or the
   * app starts saying "well done" where it means "press this".
   */
  gold: '#F5B62E',
  goldSoft: 'rgba(245, 182, 46, 0.14)',

  // ── The night field ──────────────────────────────────────────────────────
  // One field, from the splash through the match to every list. The violet
  // undertone stays — it is what makes the black feel like this game rather
  // than a terminal — but nothing above it is violet any more.
  /** Every screen. The same value the splash and the match world use. */
  canvas: '#171422',
  /** Inputs, search fields, list rows, skeletons — a surface that recedes. */
  sunken: '#110E19',
  hairline: '#2A2438',

  // ── Ink (light on night) ─────────────────────────────────────────────────
  ink: '#F2F1F8',
  inkMuted: '#A8A5BE',
  /**
   * Lifted from `#7B7794`, which measured 4.23:1 on the canvas. It carries
   * captions and unit labels — small text, so it owes the full 4.5:1 rather
   * than the 3:1 large type gets away with.
   *
   * Measured against the LIGHTEST surface it ever sits on, which is a raised
   * card rather than the canvas: 4.96:1 there, 5.48:1 on the canvas below it.
   * Tuning it against the canvas alone left it failing on every card.
   */
  inkFaint: '#8E8AA8',

  // ── The quiz four (design.md §3.4) — positional, never a verdict ─────────
  optionA: '#3B82F6',
  optionB: '#EC5A5A',
  optionC: '#F2A03D',
  optionD: '#3CC28B',

  // ── Verdict. These appear only once a round has resolved ─────────────────
  correct: '#2FBF83',
  wrong: '#E9534E',
  /** The near-miss banner — a slider or numeric answer inside the margin. */
  close: '#4A9CF0',

  // ── Match identity ───────────────────────────────────────────────────────
  /** You. Same value as `accent`, and that is the point. */
  you: '#3A9FB2',
  /** Them. Cyan against coral is the clearest two-player pairing on night. */
  rival: '#FF5C7A',

  // ── Raised night ─────────────────────────────────────────────────────────
  /**
   * `night` is kept as an alias of the canvas so the match world and the app
   * are now literally the same surface — the split between "paper screens" and
   * "the night match" is what the brand colour used to be papering over.
   */
  night: '#171422',
  /**
   * A card lifted off the field — the only surface above the canvas.
   *
   * Most cards in the app used to be the canvas colour itself, relying on a
   * shadow to separate them. Shadows barely register on a near-black field, so
   * they read as flat regions rather than as cards. This is a real step up,
   * and the hairline still draws the edge.
   */
  nightRaised: '#272236',

  /** Text sitting on any saturated fill. */
  onColor: '#FFFFFF',
  transparent: 'transparent',
  /** Scrim behind modals and sheets. */
  scrim: 'rgba(0, 0, 0, 0.62)',

  /**
   * Soft fills — a tint of the colour on night, never a pastel.
   *
   * The distinction matters and was got wrong in several places: a pastel like
   * `#F1FBF6` is a near-WHITE surface. It works on paper and becomes a glaring
   * light block the moment the app is dark, taking its dark-on-light text with
   * it. These are transparent tints, so they darken with whatever they sit on.
   */
  correctSoft: 'rgba(47, 191, 131, 0.16)',
  wrongSoft: 'rgba(233, 83, 78, 0.16)',
  amberSoft: 'rgba(242, 160, 61, 0.16)',
  /** The opponent's tint — the counterpart to `accentSoft` for "you". */
  rivalSoft: 'rgba(255, 92, 122, 0.16)',
};


/**
 * The full-bleed fields: onboarding, result, and the join sheet.
 *
 * `brand` is a night gradient now, not a colour wash. It used to run three
 * violets, which meant every ceremonial screen was a saturated purple panel and
 * the accent had nowhere left to stand out. Deepening it downward gives the
 * same sense of a lit stage while leaving the accent, the gold and the verdict
 * colours as the only saturated things on screen.
 *
 * `win` and `loss` stay saturated on purpose — a result screen is the one
 * moment the app is allowed to shout.
 */
export const gradients = {
  brand: ['#252036', '#1B1727', '#131019'],
  win: ['#3ED598', '#2FBF83'],
  loss: ['#FF7A75', '#E9534E'],
};

/** design.md §5 — 4, 8, 12, 16, 24, 32, 48, 64. Nothing between. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  huge: 64,
};

export const layout = {
  /** §5 — screen gutter 20, card padding 16, gap between cards 12. */
  gutter: 20,
  cardPadding: 16,
  cardGap: 12,
  /**
   * §5 — the radii are generous, and deliberately so: this is a light app about
   * play, and a 4px corner would make it read as a form.
   */
  radiusCard: 18,
  radiusInput: 14,
  radiusChip: 12,
  radiusPill: 999,
  /** §5 — 48 minimum, 60 for answer rows. */
  touchMin: 48,
  answerRow: 60,
  buttonHeight: 54,
  countdownHeight: 8,
  bubbleSize: 26,
  tabBar: 68,
  /**
   * The floating dock overlays the scene, so every tab screen's scrollable
   * content needs this much bottom padding to clear it — the dock and the
   * gesture bar together. It came down from 140 when the raised Play button
   * left: there is no longer anything rising above the pill to clear.
   */
  dockClearance: 118,
};

/**
 * design.md §4.1 — Poppins carries the voice, Inter carries the information.
 *
 * Poppins is a geometric with near-circular bowls, which is what makes a
 * heading feel friendly rather than institutional; Inter has the taller x-height
 * that keeps a 12px metadata line legible on a mid-range Android screen. Using
 * one for the other's job breaks both.
 */
export const fonts = {
  display: 'Poppins_700Bold',
  heading: 'Poppins_600SemiBold',
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
};

/** design.md §4.2 — the type scale. Nothing outside it. */
export const type = {
  /** The final score, the verdict, the podium. */
  scoreHero: { fontFamily: fonts.display, fontSize: 48, lineHeight: 54 },
  /** Live scores during a match. */
  scoreLive: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34 },
  /** A number that stands alone: a rating, a stat tile, a countdown. */
  timer: { fontFamily: fonts.display, fontSize: 22, lineHeight: 26 },
  /** Screen titles. */
  display: { fontFamily: fonts.heading, fontSize: 26, lineHeight: 34 },
  /** Card and section titles. */
  title: { fontFamily: fonts.heading, fontSize: 19, lineHeight: 26 },
  /** The question itself. */
  question: { fontFamily: fonts.heading, fontSize: 21, lineHeight: 29 },
  /** §4.2 — beyond 140 characters the question drops a step. */
  questionLong: { fontFamily: fonts.heading, fontSize: 18, lineHeight: 26 },
  option: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 23 },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 23 },
  label: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  meta: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 17 },
  tiny: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 15 },
};

/**
 * design.md §5.1 — three elevations and no more.
 *
 * `raised` is a card resting on paper. `floating` is something that has left
 * the page: a bottom bar, the tab bar, the centre Join button. `sheet` is a
 * modal. A fourth would only be used to make something look important, which is
 * the job of position and size.
 */
export const elevation = {
  raised: {
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  floating: {
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  sheet: {
    shadowColor: '#000000',
    shadowOpacity: 0.55,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: -6 },
    elevation: 16,
  },
};

/** design.md §7 — motion is reserved for the moments that carry emotion. */
export const motion = {
  screen: 240,
  bubbleFill: 180,
  roundTransition: 320,
  scoreRoll: 300,
  resultReveal: 900,
  ratingTick: 600,
  searchPulse: 2000,
  bannerDrop: 260,
  /** §7 — reduced motion degrades to an instant change or a 120ms fade. */
  reduced: 120,
};

/**
 * design.md §11 — contrast. `ink` on `canvas` is 15.1:1 and `inkMuted` on
 * `canvas` is 5.4:1; white on `indigo` is 6.1:1 and white on every one of the
 * quiz four clears 4.5:1 at 16px semibold. All AA or better.
 */
export const a11y = {
  minTouch: layout.touchMin,
  answerRowHeight: layout.answerRow,
};

/** Option index → its fixed colour. Positional, never a verdict (§3.4). */
export const OPTION_COLORS = [colors.optionA, colors.optionB, colors.optionC, colors.optionD];

/**
 * design.md §12.1 — "Twelve presets ship with the app for users who skip
 * upload."
 *
 * A preset is a colour, not a picture. The player's own initial sits on it, so
 * every avatar in the app is legible at 34px in a leaderboard row, is distinct
 * from its neighbours, and carries no cultural or gendered reading the way a
 * set of twelve faces or animals would.
 *
 * Twelve hues, evenly spaced around the wheel and all deep enough to hold white
 * type at the sizes an avatar is ever drawn. The first is the accent's deep
 * end, so the default account looks like the product.
 */
export const AVATAR_TINTS = [
  '#24697A',
  '#2563EB',
  '#0891B2',
  '#0D9488',
  '#16A34A',
  '#65A30D',
  '#CA8A04',
  '#EA580C',
  '#DC2626',
  '#E11D48',
  '#DB2777',
  '#4F46E5',
];

export default { colors, gradients, space, layout, fonts, type, elevation, motion, a11y };

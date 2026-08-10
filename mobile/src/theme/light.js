import { colors as night, elevation as nightElevation } from './index.js';

/**
 * The console palette — Mimo on paper.
 *
 * ── Why the consoles are light and the game is not ──────────────────────────
 *
 * design.md's first rule is that the field is dark: "the app is the night world
 * of the splash and the match, everywhere". That rule is about the GAME, and
 * the reasoning behind it — a lit stage, colour that is earned, a room you play
 * in — is reasoning about play. A console is not played. It is a work tool used
 * in a school office in daylight, for half an hour at a time, reading dense
 * tables and typing questions into forms. Those are the conditions paper is
 * for, and the ones a dark field is worst at: long stretches of small text on a
 * bright-ambient screen.
 *
 * So the split is deliberate and total. Everything under `/admin` and `/super`
 * is light; the player app, the splash and the match stay exactly as they were.
 * Nothing here is a runtime setting — see `theme/palette.jsx` for how a screen
 * gets one palette or the other.
 *
 * ── What had to be re-struck, and why ───────────────────────────────────────
 *
 * A light palette is not the dark one inverted. Every colour that carries TEXT
 * had to be re-chosen, because a hue that reads clearly against a near-black
 * field is far too pale against white:
 *
 *   accent   #3A9FB2 → #1A7080   3.1:1 on white, which fails AA for body text
 *   correct  #2FBF83 → #12855A   2.4:1
 *   wrong    #E9534E → #C42B26   3.6:1
 *   optionC  #F2A03D → #B45309   1.9:1 — and this one is the console's amber
 *                                 warning, used in fifteen places
 *
 * Every replacement below is ≥4.5:1 against white (AA for normal text) and the
 * tinted fills are chosen so their own foreground still clears 4.5:1 on top of
 * them — a soft badge is two colours, and both have to work.
 *
 * `onAccent` flips from near-black to white. The dark palette's signature is a
 * dark label on a muted teal; that only works because the teal is light enough
 * to be a light surface. The paper accent is a deep teal — a surface you write
 * white on — so keeping the near-black label would have dropped it to 3.8:1.
 *
 * ── The elevation ladder inverts, and the page is WHITE ─────────────────────
 *
 * The first cut of this palette copied the night ladder's DIRECTION: field
 * darkest, card lifting towards light. So the page was a grey `#EFEFF3` and a
 * card was white. Measured, that is a 1.147:1 step — and it was buying nothing:
 *
 *   · A card was already drawn by its hairline, and `#E1E0EA` against white is
 *     1.308:1. The BORDER was out-separating the field colour it was supposed
 *     to be helping. The grey was not defining cards; the line already was.
 *   · Most of a console screen is card, band and control — all of them white.
 *     So the grey only ever showed in the SEAMS between them. It did not read
 *     as a field, it read as grout.
 *   · And it cost every word on the screen contrast, everywhere, all the time:
 *     ink 15.87 → 18.20, inkMuted 6.60 → 7.57, accent 4.98 → 5.72. Fifteen per
 *     cent off the legibility of the entire console, to buy 0.147 of a step
 *     that a line was already drawing better.
 *
 * So on paper the ladder does not just re-strike, it INVERTS. The page is
 * white, and things recede INTO it rather than lifting off it:
 *
 *   sunken       #FFFFFF   the page. The workspace, and the top of the ladder.
 *   nightRaised  #FFFFFF   a card — the same white, drawn by its hairline.
 *   canvas       #E8E8F0   one step DOWN: a pressed row, a recessed band.
 *   inset        #E8E8F0   a patch cut into a surface: skeleton, prompt box.
 *   control      #E8E8F0   the fill of an input, a select, a search field.
 *
 * The token NAMES are kept — forty-three screens are written against them, and
 * renaming `nightRaised` everywhere would be a far bigger change than
 * re-striking it — so read them as their JOB, not their colour.
 *
 * ── Why the recess could finally get deep enough to see ─────────────────────
 *
 * A grey page cannot also be a grey control: an input filled in the colour of
 * the screen behind it is not an input. That is why every text field in this
 * console was WHITE with a TRANSPARENT border — the only thing separating it
 * from the page was the same 1.147:1, so a form read as a column of faint
 * ghosts, and `inputFocused`'s "lift to white on focus" was a no-op because the
 * box was already white.
 *
 * Deepening the old grey was measured once and rejected, because it broke six
 * tokens (`close` 4.41, `gold` 4.36, `silver` 4.34, and all three status
 * badges at 4.27–4.30) for +0.06 of card separation. That objection dies with
 * the grey page: those six are text drawn on the FIELD, and the field is now
 * white, where every one of them gains contrast instead. The grey is no longer
 * load-bearing for anything except the controls it fills — so it is free to go
 * as deep as its own contents allow, and `#E8E8F0` is where the placeholder
 * inside it still clears AA.
 */

/**
 * Spread over the night palette rather than written from scratch: a token
 * added to the dark system later and forgotten here then falls back to a
 * visible (if wrong) colour instead of `undefined`, which in React Native is a
 * transparent hole rather than an error.
 */
export const colors = {
  ...night,

  // ── Brand ────────────────────────────────────────────────────────────────
  /** 5.7:1 on white as type, and holds white type at 5.7:1 as a fill. */
  accent: '#1A7080',
  accentPress: '#155C6A',
  accentDeep: '#0F4854',
  /** The tinted fill. Accent type on top of it is 5.0:1. */
  accentSoft: '#E6F1F4',
  accentSoftPress: '#D5E8ED',
  /** White, not near-black — the paper accent is a dark surface. See above. */
  onAccent: '#FFFFFF',

  /**
   * Achievement. The night gold is a bright amber that vanishes on white
   * (1.8:1), so paper gets a struck-metal version that survives as type.
   */
  gold: '#8E640A',
  /** Opaque, for the reason the verdict washes below are. */
  goldSoft: '#F4F0E7',
  goldBright: '#B98411',
  goldWarn: '#8A6109',
  silver: '#666C7B',
  bronze: '#8B5A32',

  // ── The page, and the one step below it ──────────────────────────────────
  /** The page every console screen sits on. White — see the ladder note above. */
  sunken: '#FFFFFF',
  /** A card: the same white, separated from the page by its hairline alone. */
  nightRaised: '#FFFFFF',
  card: '#FFFFFF',
  night: '#FFFFFF',
  /**
   * One step DOWN from the page — the only grey left, and the whole reason it
   * can be this deep is that nothing sits on it but its own contents.
   *
   * `canvas` is the pressed state of a row and the recessed band; `inset` is a
   * patch cut into a surface; `control` is the fill of something you operate.
   * One value on paper, three different ones on night, which is exactly why
   * they are three tokens — see the note in `theme/index.js`.
   */
  canvas: '#E8E8F0',
  inset: '#E8E8F0',
  control: '#E8E8F0',

  /**
   * Borders and dividers. Dark enough to hold a line against white without
   * becoming a rule — a hairline that reads as a border is too heavy.
   */
  hairline: '#E1E0EA',

  // ── Type ─────────────────────────────────────────────────────────────────
  /** 16.1:1 on white. Violet-tinted, like the night palette's neutrals. */
  ink: '#16141F',
  /** 7.3:1 — secondary lines, labels, the quieter half of a row. */
  inkMuted: '#55516B',
  /**
   * The quiet tone, and the one the palette keeps having to be pushed on.
   *
   * It is the PLACEHOLDER inside a control as well as the hint under one, so it
   * has to clear 4.5:1 against the deepest surface it is ever drawn on — which
   * is now the recess, not the page. At the old `#6D6981` it managed only
   * 4.32:1 on `#E8E8F0`, so the quiet tone was the single thing capping how
   * deep the recess could go: the grey could not get dark enough to read as a
   * control without taking its own placeholder below AA.
   *
   * Pushed one step, which costs nothing anywhere else — this colour is only
   * ever a foreground, so darkening it can only raise every pair it is in.
   * 5.77:1 on the page and on a card, 4.74:1 on the recess.
   */
  inkFaint: '#676379',

  // ── The quiz four ────────────────────────────────────────────────────────
  /**
   * Positional, never a verdict — but re-struck so each one holds white type
   * as a filled letter chip AND survives as text, which is what `optionC` is
   * doing every time the console warns about something.
   */
  optionA: '#2563EB',
  optionB: '#BC2924',
  optionC: '#A24B08',
  optionD: '#147A3A',

  // ── Verdicts ─────────────────────────────────────────────────────────────
  /**
   * Deeper than a first pass at them, and the reason is the TINTED badge.
   *
   * A status pill is two colours: `live` is `correct` type on a 10% wash of
   * itself, and that wash darkens the surface under the type. Struck to pass
   * against plain white, all three then failed inside their own badge — 3.5:1
   * for "Live" on the field, on the single most repeated element in either
   * console. Each of these now clears 4.5:1 in the worst of the four places it
   * is drawn: on a card, on the field, and on its own tint over either.
   */
  correct: '#0F724D',
  wrong: '#BC2924',
  close: '#1C6AC7',
  /**
   * OPAQUE, and the reason is that a badge does not always sit on the page.
   *
   * These were alpha washes — 10% of the verdict colour, letting the surface
   * beneath show through. That is right on night, where a badge is drawn over
   * several different darks. On paper it made the badge's contrast a function
   * of what was BEHIND it: a "Live" pill inside a list row is 5.15:1 at rest
   * and 4.26:1 the moment a finger goes down on that row, because the pressed
   * fill darkens the wash under its own type. Four tones, all failing AA on
   * touch — on the most repeated element in either console.
   *
   * Pre-composited over white instead. A chip is a chip wherever it lands: it
   * reads identically at rest and pressed, and on a pressed row it now LIFTS
   * off the grey rather than sinking with it, which is what a badge should do.
   *
   * 10% of the hue, not the night palette's 16% — a heavier wash costs the
   * type its contrast.
   */
  correctSoft: '#E7F1ED',
  wrongSoft: '#F8EAE9',
  amberSoft: '#F6EDE6',
  rivalSoft: '#F8E3EB',
  you: '#1A7080',
  rival: '#C2185B',

  /** Type on a saturated fill. Every fill above is deep enough to take white. */
  onColor: '#FFFFFF',

  /**
   * The scrim behind a sheet. Still dark on a light field — a scrim's job is to
   * put the page BEHIND the sheet, and a pale one on pale paper does not.
   */
  scrim: 'rgba(22, 20, 31, 0.45)',
};

/**
 * Shadows, restruck for paper.
 *
 * The night shadows are black at 30–55% opacity, which is invisible on a dark
 * field and filthy on a white one — a card would sit in a grey smudge. On paper
 * a shadow is a hint: low opacity, tight, and tinted with the palette's violet
 * rather than pure black so it does not go grey against the warm white.
 *
 * `elevation` (the Android property) is kept at the night values: it is the
 * platform's own ladder and reads correctly in either theme.
 */
export const elevation = {
  /**
   * Lighter than the last pass, because the page it falls on changed.
   *
   * When the page was grey this was pushed UP to 0.07/12 to force a card off a
   * field it only differed from by 1.147:1. On white that argument reverses
   * twice over: a shadow is far more visible on white than on grey, and the
   * hairline is now a 1.308:1 edge on both sides of itself rather than 1.141
   * on one of them. The line draws the card; this is only the warmth around it.
   *
   * Wider and lighter, so it reads as a halo and never as a drop — a border
   * plus a visible drop shadow is two edges drawn for one card.
   */
  raised: {
    shadowColor: '#1B1830',
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 2 },
    elevation: nightElevation.raised.elevation,
  },
  floating: {
    shadowColor: '#1B1830',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: nightElevation.floating.elevation,
  },
  sheet: {
    shadowColor: '#1B1830',
    shadowOpacity: 0.16,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -4 },
    elevation: nightElevation.sheet.elevation,
  },
};

/**
 * ── The domain palette ──────────────────────────────────────────────────────
 *
 * The one place the console spends colour, and it spends it on INFORMATION.
 *
 * Both consoles are a single teal accent on grey and white, which is a
 * defensible palette for a work tool and a bad one for this particular work
 * tool: a console's dominant cost is not reading a screen, it is knowing which
 * of twenty screens you are on. Twenty rows in a sidebar, five sections, thirty
 * destinations — all rendered in the same teal — means the operator navigates
 * entirely by reading words. Colour that maps to a DOMAIN turns that into
 * recognition: People is always indigo, Content is always the brand teal,
 * wherever they appear.
 *
 * The five are isoluminant on purpose. Solved to land within 0.5 of each other
 * against white (5.72–6.22:1, a spread of 0.51), they read as one family in
 * five hues rather than as five unrelated colours, which is the difference
 * between a system and a highlighter. Each clears 4.5:1 as TYPE on the page, on
 * a card and on its own tint — the worst case in the set is 4.97:1.
 *
 * `content` is the brand accent itself rather than a sixth teal, because
 * content IS what this product is about and the accent should not be competing
 * with a near-identical neighbour.
 *
 * Discipline: a domain hue appears in exactly three places — the sidebar row,
 * the icon disc on a card, and the rule above a panel of its figures. It is
 * never a background for text, never a button fill, and never decorative.
 */
export const domains = {
  content: { hue: colors.accent, soft: colors.accentSoft },
  people: { hue: '#415CAF', soft: '#E8EBF5' },
  learning: { hue: '#8C5321', soft: '#F1EAE4' },
  oversight: { hue: '#9E3D76', soft: '#F3E8EF' },
  platform: { hue: '#2B6E4F', soft: '#E6EEEA' },
};

/** Option index → its fixed colour, on paper. */
export const OPTION_COLORS = [colors.optionA, colors.optionB, colors.optionC, colors.optionD];

/** The console never draws the brand gradient, but the token has to resolve. */
export const gradients = {
  brand: ['#FFFFFF', '#FAFAFC', '#E8E8F0'],
  win: ['#12855A', '#0E6B49'],
  loss: ['#C42B26', '#A3211D'],
};

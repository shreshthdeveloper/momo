/**
 * What a console SCREEN imports instead of `theme/index.js`.
 *
 * Every file under `app/admin` and `app/super` is only ever rendered inside a
 * console, and a console is always light — so those screens do not need to
 * resolve a palette at runtime at all. They swap one import line and their
 * module-level `StyleSheet.create` keeps working exactly as before, which is
 * why thirty-three dense screens could be re-themed without any of them being
 * restructured.
 *
 * The scale tokens — space, layout, type, motion — have no colour in them and
 * are re-exported unchanged, so a screen still gets everything from one import.
 *
 * SHARED components cannot do this. `ui.jsx`, `Skeletons.jsx` and `Icon.jsx`
 * are rendered by the player app too, so they resolve their palette from
 * context instead; see `theme/palette.jsx`.
 */
export { colors, domains, elevation, OPTION_COLORS, gradients } from './light.js';

export {
  space,
  layout,
  fonts,
  type,
  fontScaleCap,
  DEFAULT_FONT_SCALE_CAP,
  consoleType,
  consoleLayout,
  motion,
  a11y,
  AVATAR_TINTS,
} from './index.js';

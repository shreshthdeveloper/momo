import { createContext, useContext, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { colors as night, domains as nightDomains, elevation as nightElevation } from './index.js';
import { colors as paper, domains as paperDomains, elevation as paperElevation } from './light.js';

/**
 * Which palette the tree below is drawn in.
 *
 * A console SCREEN does not need this — it lives under `/admin` or `/super`,
 * it is always light, and it imports `theme/console.js` statically (see the
 * note there). This exists for the components that cannot know where they are:
 * `Button`, `Card`, `ListRow`, `Header` and the rest of `ui.jsx` are rendered
 * by the player app in the night palette and by both consoles on paper, from
 * the same file, sometimes in the same session.
 *
 * The provider is `ConsoleShell`, which wraps every console screen — so the
 * boundary is exactly the console boundary, and there is nothing to keep in
 * step by hand.
 *
 * ── Why the sheets are built once, not per render ───────────────────────────
 *
 * `StyleSheet.create` at module scope was the thing standing in the way of a
 * light console: it snapshots whatever `colors.x` held at import time, so a
 * shared component's styles were dark for ever. The fix is not to build a
 * sheet on every render — that would allocate one per component per frame on
 * screens that already list two hundred rows. Each sheet is built ONCE per
 * palette, the first time it is asked for, and handed out by identity after
 * that. Two palettes exist, so at most two sheets per component file.
 */
const THEMES = {
  night: { key: 'night', colors: night, domains: nightDomains, elevation: nightElevation, dark: true },
  paper: { key: 'paper', colors: paper, domains: paperDomains, elevation: paperElevation, dark: false },
};

/** The player app is the default: nothing has to opt into being the night world. */
const PaletteContext = createContext(THEMES.night);

export function PaletteProvider({ theme = 'paper', children }) {
  const value = THEMES[theme] ?? THEMES.night;
  return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>;
}

/** The active theme: `{ key, colors, elevation, dark }`. */
export function useTheme() {
  return useContext(PaletteContext);
}

/** Just the colours, which is what almost every call site wants. */
export function usePalette() {
  return useContext(PaletteContext).colors;
}

/** `{ content, people, learning, oversight, platform }` → `{ hue, soft }`. */
export function useDomains() {
  return useContext(PaletteContext).domains;
}

/**
 * A component's stylesheet, in the active palette.
 *
 * `factory` is called with `(colors, elevation)` and must return a plain style
 * object. Pass the SAME factory reference every render — define it at module
 * scope, never inline — or the cache below is a memory leak with extra steps.
 *
 *   const makeStyles = (colors) => ({ row: { backgroundColor: colors.sunken } });
 *   function Row() {
 *     const styles = useThemedStyles(makeStyles);
 *   }
 */
const CACHE = new WeakMap();

export function useThemedStyles(factory) {
  const theme = useTheme();
  return useMemo(() => {
    let byTheme = CACHE.get(factory);
    if (!byTheme) {
      byTheme = new Map();
      CACHE.set(factory, byTheme);
    }
    if (!byTheme.has(theme.key)) {
      byTheme.set(theme.key, StyleSheet.create(factory(theme.colors, theme.elevation)));
    }
    return byTheme.get(theme.key);
  }, [factory, theme]);
}

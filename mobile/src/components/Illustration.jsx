import { View } from 'react-native';
import { layout, type } from '../theme/index.js';
// The topic glyph stands in for a cover on the player's home feed and in
// the console's topic list, so its tones follow whichever palette it is in.
import { usePalette } from '../theme/palette.jsx';
import { Text } from './ui.jsx';

/**
 * design.md §12.2 — the drawn glyphs.
 *
 * This file used to open with three full onboarding scenes (`duel`, `speed`,
 * `climb`) composed from Views, and the argument for them was that stock
 * illustration is the fastest way to make a product look like every other
 * product. That argument still stands for everything the app REPORTS, which is
 * most of it.
 *
 * The intro is not that. It is the one screen whose whole job is to make
 * somebody want to press a button, and there the drawn scenes were losing to
 * artwork of two people plainly enjoying themselves — so §8.1 became a pager of
 * shipped illustrations and the three scenes went with it.
 *
 * `TopicGlyph` stays, and it is the rule rather than the exception: a subject
 * needs a mark that is legible at 24px, always about its subject, and free.
 */
export function TopicGlyph({ name, size = 56, radius = layout.radiusInput, tone }) {
  const colors = usePalette();
  const palette = [colors.optionA, colors.optionB, colors.optionC, colors.optionD, colors.accent];
  const seed = (name ?? '?').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const fill = tone ?? palette[seed % palette.length];

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: fill,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        allowFontScaling={false}
        // Generous lineHeight + no Android font padding, or Poppins ascenders
        // clip at larger sizes — the same half-cut bug the Avatar had.
        style={[
          type.display,
          {
            color: colors.onColor,
            fontSize: size * 0.4,
            lineHeight: size * 0.58,
            includeFontPadding: false,
            textAlignVertical: 'center',
          },
        ]}
      >
        {(name ?? '?').charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Icon from './Icon.jsx';
import { Text } from './ui.jsx';
import { fonts } from '../theme/index.js';

/**
 * A topic's face — a tinted disc with its subject's glyph struck on it.
 *
 * This replaces the stock cover photographs. Those were doing real damage: the
 * Python topic wore a photograph of an Arduino board, half the catalogue had no
 * photo at all and fell back to a coloured square with a letter in it, and a
 * feed mixing the two had no visual system holding it together. That mixture is
 * what read as cheap — not the colours.
 *
 * The construction is deliberately the SAME as the league plate: a tint of one
 * hue for the field, a stronger version of it for the rim, and the full hue for
 * the mark. Two of the app's small objects, built one way.
 *
 * Shape is the caller's choice because the two contexts want different things.
 * In a list a circle reads as an emblem beside a name, the way an avatar does.
 * In the home grid the tile is large, and a circle there would leave four empty
 * corners in a layout that is already mostly artwork — so it squares off.
 */

/** Wire scheme, mirroring `mimo:avatar/<name>`. Never rename, only append. */
const ICON_SCHEME = 'mimo:icon/';

/**
 * The subjects, and what each one looks like.
 *
 * Hues are spaced around the wheel and all deep enough to hold their own glyph
 * at 4.5:1 on the tint they sit on. `key` is the wire value: a topic stores
 * `mimo:icon/programming` in `coverUrl`, so no payload anywhere had to learn a
 * new field.
 */
export const SUBJECTS = {
  programming: { icon: 'code', hue: '#4CA9E8' },
  mathematics: { icon: 'calculator', hue: '#9B8CF5' },
  science: { icon: 'flask', hue: '#48C99B' },
  entertainment: { icon: 'film', hue: '#F2789F' },
  sports: { icon: 'trophy', hue: '#F5B62E' },
  history: { icon: 'hourglass', hue: '#E0A46A' },
  general: { icon: 'globe', hue: '#5FC9D6' },
  music: { icon: 'music', hue: '#C98BE8' },
  arts: { icon: 'brush', hue: '#F09A5B' },
  nature: { icon: 'leaf', hue: '#7CC950' },
  fantasy: { icon: 'sparkle', hue: '#9B7BE8' },
  comics: { icon: 'bolt', hue: '#E0554F' },
  mythology: { icon: 'flame', hue: '#F0A93B' },
};

/** `#RRGGBB` + alpha → rgba(). The hues are hex; the tints are not. */
function withAlpha(hex, alpha) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * What a topic's `coverUrl` actually points at.
 *
 * Anything that is not a recognised scheme is treated as a URL, so a real
 * uploaded cover still works and an unknown value degrades to an image fetch
 * rather than to a crash — the same contract `resolveAvatar` honours.
 */
export function resolveTopicFace(coverUrl, name) {
  if (typeof coverUrl === 'string' && coverUrl.startsWith(ICON_SCHEME)) {
    const key = coverUrl.slice(ICON_SCHEME.length);
    if (SUBJECTS[key]) return { kind: 'icon', ...SUBJECTS[key] };
  }
  if (coverUrl) return { kind: 'image', uri: coverUrl };
  // No cover at all: a stable hue from the name, so the same topic is the same
  // colour on every screen and between sessions.
  const keys = Object.keys(SUBJECTS);
  const seed = (name ?? '?').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return { kind: 'letter', hue: SUBJECTS[keys[seed % keys.length]].hue };
}

/**
 * @param {object} props
 * @param {string} props.coverUrl  the topic's stored cover — icon scheme or URL
 * @param {string} props.name      used for the fallback letter and the hue
 * @param {number} props.size
 * @param {'circle'|'tile'} props.shape
 */
export default function TopicMedallion({ coverUrl, name, size = 48, shape = 'circle', style }) {
  const face = resolveTopicFace(coverUrl, name);
  const radius = shape === 'circle' ? size / 2 : Math.round(size * 0.28);

  // A real photograph fills the frame; there is nothing to tint or centre.
  if (face.kind === 'image') {
    return (
      <Image
        source={{ uri: face.uri }}
        style={[{ width: size, height: size, borderRadius: radius }, style]}
        contentFit="cover"
        transition={160}
      />
    );
  }

  return (
    <View
      style={[
        styles.face,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: withAlpha(face.hue, 0.16),
          borderColor: withAlpha(face.hue, 0.32),
        },
        style,
      ]}
    >
      {face.kind === 'icon' ? (
        <Icon name={face.icon} size={Math.round(size * 0.44)} color={face.hue} />
      ) : (
        <Text
          allowFontScaling={false}
          style={{
            fontFamily: fonts.display,
            fontSize: Math.round(size * 0.38),
            // Poppins ascenders clip against a fixed lineHeight from the scale.
            lineHeight: Math.round(size * 0.5),
            includeFontPadding: false,
            color: face.hue,
          }}
        >
          {(name ?? '?').trim().charAt(0).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  face: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
});

export { ICON_SCHEME, withAlpha };

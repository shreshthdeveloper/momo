import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { layout } from '../theme/index.js';
// Drawn in a match AND in both consoles' review queues.
import { usePalette } from '../theme/palette.jsx';

/**
 * The picture on a picture question — "which emblem is this?".
 *
 * A question carries an `imageUrl`, and it resolves exactly the way a topic
 * cover does (TopicMedallion.jsx): a `mimo:art/<key>` wire value is DRAWN here
 * from the app's own Views, and anything else is fetched as an ordinary image.
 * That contract is what lets an admin upload a real photograph through the
 * question editor while the seeded catalogue ships no binaries at all.
 *
 * Drawn rather than shipped, for the reasons TopicMedallion already gives and
 * one more that only applies here: a question bank about emblems is exactly the
 * bank that would otherwise fill up with other people's trademarks. These are
 * geometry in the app's palette — a bolt, a shield, a lotus — so the catalogue
 * can ask "which house does this belong to?" without shipping a single logo.
 *
 * Every emblem is built from the same three primitives (disc, bar, ring) so the
 * set reads as one hand. Nothing here animates: the reveal is the round's job,
 * and a picture that moves under a ten-second clock is a picture nobody reads.
 */

/** Wire scheme, mirroring `mimo:icon/<key>`. Never rename, only append. */
const ART_SCHEME = 'mimo:art/';

/* ── Primitives ───────────────────────────────────────────────────────────── */

/** A filled circle. `d` is a fraction of the frame. */
const Disc = ({ d, tone, x = 0, y = 0, style }) => (
  <View
    style={[
      styles.abs,
      { width: `${d * 100}%`, aspectRatio: 1, borderRadius: 9999, backgroundColor: tone },
      { transform: [{ translateX: x }, { translateY: y }] },
      style,
    ]}
  />
);

/** An unfilled circle — the ring the shield and the chakra are made of. */
const Ring = ({ d, tone, w = 3, x = 0, y = 0 }) => (
  <View
    style={[
      styles.abs,
      {
        width: `${d * 100}%`,
        aspectRatio: 1,
        borderRadius: 9999,
        borderWidth: w,
        borderColor: tone,
        transform: [{ translateX: x }, { translateY: y }],
      },
    ]}
  />
);

/** A rounded bar. `w`/`h` are fractions of the frame; `r` is degrees. */
const Bar = ({ w, h, tone, r = 0, x = 0, y = 0, radius = 2 }) => (
  <View
    style={[
      styles.abs,
      {
        width: `${w * 100}%`,
        height: `${h * 100}%`,
        borderRadius: radius,
        backgroundColor: tone,
        transform: [{ translateX: x }, { translateY: y }, { rotate: `${r}deg` }],
      },
    ]}
  />
);

/**
 * A flag, as bands plus an optional charge.
 *
 * Flags earn their own renderer rather than being drawn emblem-by-emblem: they
 * are all the same object — a 3:2 field divided into bands — so describing one
 * as data keeps six of them honest and identical in construction. They are also
 * the one picture question that needs no invention at all, because a national
 * flag is a matter of public record rather than somebody's trademark.
 */
function Flag({ spec, size }) {
  const w = size * 0.78;
  const h = w * (2 / 3);

  return (
    <View style={[styles.flag, { width: w, height: h }]}>
      <View style={[StyleSheet.absoluteFill, { flexDirection: spec.dir }]}>
        {spec.bands.map((tone, i) => (
          <View key={`${tone}-${i}`} style={{ flex: spec.weights?.[i] ?? 1, backgroundColor: tone }} />
        ))}
      </View>

      {/* The charge: a disc for Japan, a wheel for India, a cross for the Nordics. */}
      {spec.disc ? (
        <View
          style={[
            styles.abs,
            {
              width: h * spec.disc.d,
              height: h * spec.disc.d,
              borderRadius: 9999,
              backgroundColor: spec.disc.tone,
            },
          ]}
        />
      ) : null}
      {spec.wheel ? (
        <View
          style={[
            styles.abs,
            {
              width: h * 0.3,
              height: h * 0.3,
              borderRadius: 9999,
              borderWidth: 2,
              borderColor: spec.wheel,
            },
          ]}
        />
      ) : null}
      {spec.cross ? (
        <>
          <View
            style={[
              styles.abs,
              { width: '100%', height: h * 0.2, backgroundColor: spec.cross.tone },
            ]}
          />
          <View
            style={[
              styles.abs,
              {
                width: w * 0.16,
                height: '100%',
                backgroundColor: spec.cross.tone,
                left: spec.cross.offset ? w * 0.26 : undefined,
              },
            ]}
          />
        </>
      ) : null}
    </View>
  );
}

/* ── The emblems ──────────────────────────────────────────────────────────── */

/**
 * Each entry is a field colour and a draw function taking the frame size in
 * points, so an emblem can place its parts in absolute units where a percentage
 * would not hold its proportions.
 */
export const ART = {
  // ── Wizarding ──
  bolt: {
    hue: '#F5B62E',
    draw: (s) => (
      <>
        <Bar w={0.1} h={0.34} tone="#F5B62E" r={22} x={s * 0.07} y={-s * 0.15} />
        <Bar w={0.1} h={0.3} tone="#F5B62E" r={-28} x={-s * 0.03} y={s * 0.03} />
        <Bar w={0.1} h={0.3} tone="#F5B62E" r={20} x={s * 0.04} y={s * 0.2} />
      </>
    ),
  },
  hallows: {
    hue: '#C7B9F5',
    draw: (s) => (
      <>
        {/* Triangle, as three struck edges. */}
        <Bar w={0.055} h={0.62} tone="#C7B9F5" r={30} x={-s * 0.17} y={0} />
        <Bar w={0.055} h={0.62} tone="#C7B9F5" r={-30} x={s * 0.17} y={0} />
        <Bar w={0.62} h={0.055} tone="#C7B9F5" x={0} y={s * 0.27} />
        <Ring d={0.4} tone="#C7B9F5" w={3} y={s * 0.06} />
        <Bar w={0.045} h={0.6} tone="#C7B9F5" y={0} />
      </>
    ),
  },
  snitch: {
    hue: '#F5C542',
    draw: (s) => (
      <>
        <Bar w={0.34} h={0.1} tone="rgba(255,255,255,0.85)" r={-24} x={-s * 0.22} y={-s * 0.05} radius={9999} />
        <Bar w={0.34} h={0.1} tone="rgba(255,255,255,0.85)" r={24} x={s * 0.22} y={-s * 0.05} radius={9999} />
        <Disc d={0.34} tone="#F5C542" />
        <Bar w={0.34} h={0.035} tone="rgba(0,0,0,0.25)" />
      </>
    ),
  },
  hat: {
    hue: '#9B7BE8',
    draw: (s) => (
      <>
        {/* The cone, as a stack of narrowing bars — a slouching wizard's hat. */}
        <Bar w={0.12} h={0.16} tone="#9B7BE8" r={16} y={-s * 0.28} radius={6} />
        <Bar w={0.2} h={0.16} tone="#9B7BE8" r={8} y={-s * 0.15} radius={5} />
        <Bar w={0.3} h={0.17} tone="#9B7BE8" y={-s * 0.01} radius={4} />
        <Bar w={0.72} h={0.1} tone="#8468D6" y={s * 0.14} radius={9999} />
      </>
    ),
  },

  // ── Assembled heroes ──
  shield: {
    hue: '#5B8DEF',
    draw: () => (
      <>
        <Disc d={0.82} tone="#E05A5A" />
        <Disc d={0.62} tone="rgba(255,255,255,0.92)" />
        <Disc d={0.42} tone="#E05A5A" />
        <Disc d={0.24} tone="#3E6FD9" />
        <Bar w={0.1} h={0.1} tone="rgba(255,255,255,0.95)" r={45} radius={2} />
      </>
    ),
  },
  hammer: {
    hue: '#8FA6C4',
    draw: (s) => (
      <>
        <Bar w={0.11} h={0.5} tone="#8A6A45" y={s * 0.2} radius={4} />
        <Bar w={0.2} h={0.06} tone="#6F5436" y={s * 0.42} radius={9999} />
        <View style={[styles.abs, styles.hammerHead]} />
      </>
    ),
  },
  reactor: {
    hue: '#5FD8E8',
    draw: () => (
      <>
        <Ring d={0.84} tone="rgba(120, 216, 232, 0.35)" w={3} />
        <Ring d={0.6} tone="#78D8E8" w={5} />
        <Disc d={0.4} tone="rgba(190, 245, 252, 0.9)" />
        <Bar w={0.06} h={0.3} tone="rgba(255,255,255,0.9)" />
        <Bar w={0.3} h={0.06} tone="rgba(255,255,255,0.9)" />
      </>
    ),
  },
  arachnid: {
    hue: '#E0554F',
    draw: (s) => (
      <>
        {[-52, -22, 22, 52].map((r) => (
          <Bar key={`l${r}`} w={0.055} h={0.56} tone="#1F1F2E" r={r} x={-s * 0.02} />
        ))}
        {[-52, -22, 22, 52].map((r) => (
          <Bar key={`r${r}`} w={0.055} h={0.56} tone="#1F1F2E" r={-r} x={s * 0.02} />
        ))}
        <Disc d={0.26} tone="#E0554F" />
      </>
    ),
  },
  gauntlet: {
    hue: '#F2B33D',
    draw: (s) => (
      <>
        <Bar w={0.62} h={0.3} tone="#E0A030" radius={12} y={s * 0.06} />
        {['#F5D547', '#7BC96F', '#5B8DEF', '#E0554F', '#B57BE8', '#F2915B'].map((tone, i) => (
          <Disc
            key={tone}
            d={0.12}
            tone={tone}
            x={(i - 2.5) * s * 0.115}
            y={-s * 0.02}
          />
        ))}
      </>
    ),
  },

  // ── Mythology ──
  trishul: {
    hue: '#F0A93B',
    draw: (s) => (
      <>
        <Bar w={0.06} h={0.78} tone="#C98A2E" y={s * 0.06} radius={3} />
        <Bar w={0.06} h={0.4} tone="#F0A93B" y={-s * 0.26} radius={3} />
        <Bar w={0.06} h={0.34} tone="#F0A93B" r={16} x={-s * 0.15} y={-s * 0.24} radius={3} />
        <Bar w={0.06} h={0.34} tone="#F0A93B" r={-16} x={s * 0.15} y={-s * 0.24} radius={3} />
        <Bar w={0.42} h={0.05} tone="#C98A2E" y={-s * 0.07} radius={9999} />
      </>
    ),
  },
  lotus: {
    hue: '#F27FA5',
    draw: (s) => (
      <>
        {[-58, -30, 0, 30, 58].map((r, i) => (
          <Bar
            key={r}
            w={0.16}
            h={0.46}
            tone={i === 2 ? '#F5A0BE' : 'rgba(242, 127, 165, 0.85)'}
            r={r}
            x={Math.sin((r * Math.PI) / 180) * s * 0.16}
            y={s * 0.02}
            radius={9999}
          />
        ))}
        <Bar w={0.5} h={0.07} tone="#4FA88F" y={s * 0.3} radius={9999} />
      </>
    ),
  },
  chakra: {
    hue: '#5FC9D6',
    draw: () => (
      <>
        <Ring d={0.86} tone="#5FC9D6" w={4} />
        {[0, 30, 60, 90, 120, 150].map((r) => (
          <Bar key={r} w={0.05} h={0.82} tone="rgba(95, 201, 214, 0.85)" r={r} radius={9999} />
        ))}
        <Disc d={0.2} tone="#5FC9D6" />
      </>
    ),
  },
  conch: {
    hue: '#EFE3CC',
    draw: (s) => (
      <>
        <Disc d={0.5} tone="#EFE3CC" y={-s * 0.08} />
        <Disc d={0.34} tone="#DCCBAD" y={-s * 0.13} x={s * 0.05} />
        <Disc d={0.2} tone="#EFE3CC" y={-s * 0.17} x={s * 0.1} />
        <Bar w={0.3} h={0.34} tone="#EFE3CC" r={-24} x={-s * 0.13} y={s * 0.18} radius={9999} />
      </>
    ),
  },
  diya: {
    hue: '#F0A93B',
    draw: (s) => (
      <>
        <Bar w={0.16} h={0.2} tone="#FFD166" r={0} y={-s * 0.22} radius={9999} />
        <Disc d={0.1} tone="#FFF0C2" y={-s * 0.24} />
        <Bar w={0.66} h={0.2} tone="#C4703A" y={s * 0.12} radius={9999} />
        <Bar w={0.44} h={0.08} tone="#8C4A22" y={s * 0.24} radius={9999} />
      </>
    ),
  },

  // ── Science ──
  atom: {
    hue: '#48C99B',
    draw: () => (
      <>
        <Ring d={0.9} tone="rgba(72, 201, 155, 0.9)" w={3} />
        <View style={[styles.abs, styles.orbitA]} />
        <View style={[styles.abs, styles.orbitB]} />
        <Disc d={0.2} tone="#48C99B" />
      </>
    ),
  },
  saturn: {
    hue: '#E0A46A',
    draw: (s) => (
      <>
        <Bar w={0.98} h={0.09} tone="rgba(224, 164, 106, 0.85)" r={-18} radius={9999} />
        <Disc d={0.46} tone="#E0A46A" />
        <Bar w={0.98} h={0.045} tone="rgba(240, 200, 160, 0.7)" r={-18} y={s * 0.04} radius={9999} />
      </>
    ),
  },

  // ── Flags. Public record, not anybody's trademark. ──
  'flag-jp': { hue: '#E0554F', flag: { dir: 'row', bands: ['#FFFFFF'], disc: { d: 0.42, tone: '#BC002D' } } },
  'flag-in': {
    hue: '#F0A93B',
    flag: {
      dir: 'column',
      bands: ['#FF9933', '#FFFFFF', '#138808'],
      wheel: '#000080',
    },
  },
  'flag-fr': { hue: '#5B8DEF', flag: { dir: 'row', bands: ['#0055A4', '#FFFFFF', '#EF4135'] } },
  'flag-de': { hue: '#F5B62E', flag: { dir: 'column', bands: ['#000000', '#DD0000', '#FFCE00'] } },
  'flag-ch': { hue: '#E0554F', flag: { dir: 'row', bands: ['#D52B1E'], cross: { tone: '#FFFFFF' } } },
  'flag-se': {
    hue: '#5B8DEF',
    flag: { dir: 'row', bands: ['#006AA7'], cross: { tone: '#FECC00', offset: true } },
  },
};

/**
 * What a question's `imageUrl` actually points at. Anything unrecognised is a
 * URL, so an uploaded photograph still works and a stale key degrades to a
 * fetch rather than to a crash — the contract `resolveTopicFace` honours.
 */
/**
 * Every drawn emblem's key, so the question editor can offer the same set the
 * match screen can draw. Without it an admin could only ever upload a
 * photograph, and the seeded picture questions — which all use these keys —
 * were uneditable without replacing their art.
 */
export const ART_KEYS = Object.keys(ART);

/** The drawn key in a stored value, or null when it is an uploaded URL. */
export function artKeyOf(imageUrl) {
  if (typeof imageUrl !== 'string' || !imageUrl.startsWith(ART_SCHEME)) return null;
  const key = imageUrl.slice(ART_SCHEME.length);
  return ART[key] ? key : null;
}

/** The wire value for a drawn key. */
export function artUri(key) {
  return `${ART_SCHEME}${key}`;
}

export function resolveQuestionArt(imageUrl) {
  if (typeof imageUrl !== 'string' || !imageUrl) return null;
  if (imageUrl.startsWith(ART_SCHEME)) {
    const key = imageUrl.slice(ART_SCHEME.length);
    return ART[key] ? { kind: 'art', key, ...ART[key] } : null;
  }
  return { kind: 'image', uri: imageUrl };
}

/** `#RRGGBB` + alpha → rgba(), so one hue makes both the field and the rim. */
function withAlpha(hex, alpha) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * @param {object} props
 * @param {string} props.imageUrl  `mimo:art/<key>` or a real URL
 * @param {number} props.size      the frame's edge, in points
 * @param {string} [props.label]   what the picture shows, for VoiceOver
 */
export default function QuestionArt({ imageUrl, size = 132, label }) {
  const colors = usePalette();
  const art = resolveQuestionArt(imageUrl);
  if (!art) return null;

  /**
   * The picture is content, not decoration — a question that says "which
   * emblem is this?" is unanswerable without it, so it is announced rather
   * than hidden, and the caller passes what it depicts.
   */
  const a11y = {
    accessible: true,
    accessibilityRole: 'image',
    accessibilityLabel: label ?? 'Picture for this question',
  };

  if (art.kind === 'image') {
    return (
      <View style={[styles.frame, { width: size, height: size, backgroundColor: colors.nightRaised }]} {...a11y}>
        <Image source={{ uri: art.uri }} style={styles.photo} contentFit="cover" transition={140} />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.frame,
        styles.drawn,
        {
          width: size,
          height: size,
          backgroundColor: withAlpha(art.hue, 0.14),
          borderColor: withAlpha(art.hue, 0.34),
        },
      ]}
      {...a11y}
    >
      {art.flag ? (
        <Flag spec={art.flag} size={size} />
      ) : (
        <View style={styles.canvas}>{art.draw(size)}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * No `backgroundColor` here on purpose. Every other style in this file is
   * geometry — positions and radii that are the same in any palette — and only
   * the frame's fill depends on where the picture is drawn, so that one value
   * is applied at render instead of freezing the whole sheet to one theme.
   */
  frame: {
    borderRadius: layout.radiusCard,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawn: { borderWidth: 1 },
  photo: { width: '100%', height: '100%' },
  /** The emblem's own coordinate space: every part is centred, then offset. */
  canvas: { width: '72%', height: '72%', alignItems: 'center', justifyContent: 'center' },
  abs: { position: 'absolute' },
  /** A flag keeps its 3:2 proportion inside the square frame, and clips. */
  flag: {
    borderRadius: 4,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Two crossed electron orbits — ellipses RN can only make by scaling. */
  orbitA: {
    width: '92%',
    height: '38%',
    borderRadius: 9999,
    borderWidth: 3,
    borderColor: 'rgba(72, 201, 155, 0.75)',
    transform: [{ rotate: '58deg' }],
  },
  orbitB: {
    width: '92%',
    height: '38%',
    borderRadius: 9999,
    borderWidth: 3,
    borderColor: 'rgba(72, 201, 155, 0.75)',
    transform: [{ rotate: '-58deg' }],
  },
  /** Mjölnir's head is the one part no primitive covers cleanly. */
  hammerHead: {
    width: '62%',
    height: '34%',
    borderRadius: 6,
    backgroundColor: '#9CB2CC',
    borderWidth: 2,
    borderColor: '#7C93AD',
    transform: [{ translateY: -22 }],
  },
});

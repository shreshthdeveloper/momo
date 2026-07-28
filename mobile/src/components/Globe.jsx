import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Avatar } from './ui.jsx';
import { faceSource } from '../lib/avatar.js';
import { colors } from '../theme/index.js';

/**
 * The search globe — Earth at night, turning, with a satellite finding you an
 * opponent somewhere on it.
 *
 * ── The projection, and the mistake before it ────────────────────────────────
 *
 * The true orthographic projection of a point at latitude λ, longitude φ, on a
 * planet turned by θ, is
 *
 *     x = R·cos λ·sin(φ + θ)
 *     y = −R·sin λ
 *
 * An earlier build cut the map into 48 vertical strips and gave each one
 * `sin(φ + θ)`. That is the second factor and only the second factor: the
 * `cos λ` was missing entirely, so every row of the map got the equator's
 * width. Europe and Canada stretched to twice their size, and the poles slid
 * sideways instead of converging to a point. A sphere whose poles do not
 * converge is a cylinder, and a cylinder wearing a map looks like exactly what
 * it is — a rotating picture.
 *
 * The map is now cut the other way, into horizontal bands (see `EarthBands`).
 * Each band carries its own `cos λ` in its width and in how far it scrolls, so
 * the silhouette converges properly and the planet reads as a ball.
 *
 * ── The texture is a real photograph, warped so the vertical is exact ────────
 *
 * `assets/earth.jpg` is composited from three NASA public-domain layers — Blue
 * Marble surface, the combined cloud layer screened over it, and Earth at Night
 * for the city lights — then given asin-spaced rows, so row y holds latitude
 * asin(1 − 2y/H). Drawn flat at disc height, every coastline lands at
 * y = R·sin λ, exactly where the sphere puts it. The vertical is not an
 * approximation of anything; it is exact.
 *
 * Three earlier attempts drew the map by hand — wireframe, then a dot grid,
 * then flat two-tone continents — and none of them read as a planet, because
 * what makes a photograph of Earth recognisable is not its coastlines. It is
 * cloud, colour, and the blue halo at the limb. Those are not things worth
 * approximating when the real ones are a download away.
 *
 * The spin runs west→east — features drift LEFT edge to RIGHT edge, the way
 * Earth actually turns when you look at it north-up.
 *
 * ── Cost ─────────────────────────────────────────────────────────────────────
 *
 * One looping value drives the rotation, and each band reads it through a
 * single interpolation — 48 in total, down from the 144 the strips needed, all
 * on the native driver. Nothing recomputes in JavaScript per frame, so a socket
 * handshake in flight never stutters the planet.
 */

const EARTH = require('../../assets/earth.jpg');

/**
 * The atmosphere, as a pre-rendered radial sprite.
 *
 * The blue halo at the limb is the single most recognisable thing about a
 * photograph of Earth — without it a textured sphere still reads as a sticker.
 * React Native cannot draw a radial gradient, and the obvious workaround,
 * stacking concentric bordered Views, bands into visible rings no matter how
 * they are tuned: a border is a hard step, and six hard steps look like six
 * hard steps. A 26 KB PNG is a smooth falloff by construction.
 *
 * It is drawn OVER the planet, so the same sprite gives both halves of the
 * effect — the inward bleed across the surface near the edge, and the bloom
 * out into space — with no seam where they meet.
 */
const AIRGLOW = require('../../assets/airglow.png');
/** The sprite's layout size, as a multiple of the globe. Baked into the art. */
const AIRGLOW_SCALE = 1.3;

/**
 * Latitude bands per hemisphere. The step in cos λ is 1/BAND_N, so the worst
 * horizontal error is R/(2·BAND_N) — 2.7pt on a 257pt globe.
 */
const BAND_N = 24;

/** Earth's axis, tipped in the picture plane the way Earth is always drawn. */
const TILT_DEG = -18;
/** In radians, for the marks that carry the tilt in their own coordinates. */
const TILT = (TILT_DEG * Math.PI) / 180;

/**
 * Where the planet starts its turn, in degrees.
 *
 * Not arbitrary. Measuring how much land faces the viewer across a full
 * rotation, it swings from 44% down to 12.6% — and the low is the open Pacific,
 * a disc of featureless water that reads as a broken screen rather than as
 * Earth. The old world map had the same problem and solved it by refusing to
 * pan out over the Pacific at all.
 *
 * A search lasts at most 8s of a 24s turn, so it shows 120° of longitude.
 * Starting at 285° puts that whole window on the land-rich side — Africa, the
 * Middle East, India, then the Atlantic and the Americas — averaging ~40% land
 * for the entire time anyone is looking at it.
 */
const START_DEG = 285;

/** The satellite's orbit: radius as a multiple of R, and how edge-on it sits. */
const ORBIT = 1.26;
const ORBIT_TILT = 0.32;
/** Where the satellite parks to take its shot, as a fraction of one orbit. */
const LOCK_ORBIT_T = 0.1;
/** Where the rival surfaces, in units of R — a good spot on the frozen disc. */
const RIVAL_AT = { x: -0.3, y: -0.24 };

/**
 * The satellite's overall width, as a fraction of the planet's radius, and the
 * drawing units that width is divided into (see `Satellite`).
 *
 * Both matter to the layout: the frame has to hold the orbit AND the craft
 * riding it, so a satellite that grows pushes the planet smaller. 0.42 is the
 * largest that still leaves the solar cells legible without eating into Earth.
 */
const SAT_W = 0.42;
const SAT_UNITS = 76;

/** One full turn. An 8s search shows about a third of the world go by. */
const SPIN_MS = 24_000;
const ORBIT_MS = 7_600;
const SCAN_MS = 3_600;
const LOCK_MS = 1_050;

const STEPS = 72;
const T = Array.from({ length: STEPS + 1 }, (_, i) => i / STEPS);
const table = (fn) => T.map((t) => fn(t * Math.PI * 2));
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const rad = (d) => (d * Math.PI) / 180;
/** An angle folded into (−π, π] — the far side of the planet, in short. */
const wrapPi = (a) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

/**
 * The faces standing on the planet, in city order.
 *
 * Drawn from the starter set and the early unlocks, so they are all faces a
 * real player could plausibly be wearing — the screen is claiming these are
 * people, and dressing them in level-40 rewards would be a small lie.
 */
const PEOPLE_FACES = [
  'panda', 'fox', 'rose', 'owl', 'cat', 'sunflower', 'frog', 'penguin',
  'daisy', 'bear', 'tulip', 'koala', 'lotus', 'tiger', 'blossom', 'rabbit',
];

/** Other players, out there. Real cities, so every one of them is on land. */
const PEOPLE = [
  { lat: 41, lon: -74 },
  { lat: 19, lon: -99 },
  { lat: -23, lon: -46 },
  { lat: 51, lon: 0 },
  { lat: 52, lon: 13 },
  { lat: 30, lon: 31 },
  { lat: 6, lon: 3 },
  { lat: -26, lon: 28 },
  { lat: 55, lon: 37 },
  { lat: 19, lon: 72 },
  { lat: 28, lon: 77 },
  { lat: 13, lon: 100 },
  { lat: -6, lon: 106 },
  { lat: 35, lon: 139 },
  { lat: 39, lon: 116 },
  { lat: -33, lon: 151 },
];

export default function Globe({ size, found, opponent, reduced }) {
  const R = size / 2;
  const Ro = R * ORBIT;
  /**
   * The orbit, plus half a satellite, plus a hair.
   *
   * Measured rather than guessed at with a multiplier — the first attempt used
   * `2·Ro·1.13`, which looked generous and clipped the solar wings off the
   * craft at every screen size, because a multiplier on the orbit knows nothing
   * about how wide the thing riding it is.
   *
   * This is also what caps the planet: the frame has to fit the screen, so
   * every point out here is a point off Earth's diameter.
   */
  const frame = Math.ceil(2 * (Ro + (R * SAT_W) / 2) + 8);
  /** A face on the globe, big enough to recognise and small enough to crowd. */
  const faceD = Math.max(17, Math.round(R * 0.17));

  const spin = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;
  const scan = useRef(new Animated.Value(0)).current;
  const lock = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced || found) return undefined;
    const loops = [
      Animated.loop(Animated.timing(spin, { toValue: 1, duration: SPIN_MS, easing: Easing.linear, useNativeDriver: true })),
      Animated.loop(Animated.timing(orbit, { toValue: 1, duration: ORBIT_MS, easing: Easing.linear, useNativeDriver: true })),
      Animated.loop(Animated.timing(scan, { toValue: 1, duration: SCAN_MS, easing: Easing.inOut(Easing.sin), useNativeDriver: true })),
    ];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [spin, orbit, scan, reduced, found]);

  /**
   * The lock-on. The satellite's orbit value is driven to the firing angle, so
   * it flies there along its own orbit rather than being blended between two
   * poses — one value moves and the geometry stays honest.
   */
  useEffect(() => {
    if (!found) return undefined;
    if (reduced) {
      lock.setValue(1);
      orbit.setValue(LOCK_ORBIT_T);
      return undefined;
    }
    const anim = Animated.parallel([
      Animated.timing(orbit, { toValue: LOCK_ORBIT_T, duration: 560, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      Animated.timing(lock, { toValue: 1, duration: LOCK_MS, easing: Easing.linear, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [found, lock, orbit, reduced]);

  // A still globe must still look like a globe: parked with the Atlantic and
  // both Americas readable, satellite at its photo angle, scan mid-sweep.
  useEffect(() => {
    if (!reduced) return;
    spin.setValue(0.12);
    orbit.setValue(LOCK_ORBIT_T);
    scan.setValue(0.5);
  }, [reduced, spin, orbit, scan]);

  return (
    <View style={{ width: frame, height: frame }} pointerEvents="none">
      <Layer>
        <Stars radius={Ro * 1.12} />
      </Layer>

      {/* The orbit track and the satellite on its far pass, both behind the
          planet so the planet genuinely occludes them. */}
      <Layer>
        <View style={[styles.orbitRing, { width: 2 * Ro, height: 2 * Ro, borderRadius: Ro, transform: [{ scaleY: ORBIT_TILT }] }]} />
      </Layer>
      <Satellite Ro={Ro} orbit={orbit} scale={(R * SAT_W) / SAT_UNITS} behind />

      {/* ── The planet ─────────────────────────────────────────────────── */}
      <Layer>
        <View style={[styles.sphere, { width: size, height: size, borderRadius: R }]}>
          {/**
            * The axis, tipped in the picture plane. Safe against the circular
            * window because a disc rotated about its own centre is the same
            * disc, and the strips are exactly `size` tall — the tilt can never
            * uncover a corner.
            */}
          <Animated.View style={[styles.layer, { transform: [{ rotate: `${TILT_DEG}deg` }] }]}>
            <EarthBands R={R} spin={spin} />

            <ScanLine R={R} scan={scan} found={found} />
          </Animated.View>

          {/* The people, upright — inside the disc so the limb clips them, but
              outside the tipped layer so no face is rendered on a slant. */}
          {PEOPLE.map((p, i) => (
            <Person key={`${p.lat},${p.lon}`} R={R} lat={p.lat} lon={p.lon} index={i} spin={spin} found={found} d={faceD} />
          ))}

          {/**
            * ── The light. All of it upright: the sun does not tilt with the
            * Earth, and the texture rotating under a fixed terminator is what
            * sells a lit ball rather than a lit picture.
            *
            * Far gentler than the flat-colour version needed. That texture was
            * two greys and could take 0.85 black at the rim; a photograph
            * cannot — crush a Blue Marble and you get a dark smudge, which is
            * exactly the "not a globe" the last three attempts kept landing on.
            */}
          {/* The terminator, running from the sunlit upper left to night. */}
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(2,8,22,0.12)', 'rgba(2,8,22,0.60)', 'rgba(2,8,22,0.88)']}
            locations={[0, 0.42, 0.79, 1]}
            start={{ x: 0.05, y: 0 }}
            end={{ x: 0.95, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {/* Limb darkening, both axes — the surface turning away from us. */}
          <LinearGradient
            colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.45)']}
            locations={[0, 0.24, 0.76, 1]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={['rgba(0,0,0,0.4)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.46)']}
            locations={[0, 0.22, 0.78, 1]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {/* The near side, catching the light. */}
          <LinearGradient
            colors={['rgba(175, 222, 255, 0.17)', 'rgba(175, 222, 255, 0.04)', 'rgba(0,0,0,0)']}
            locations={[0, 0.38, 0.74]}
            start={{ x: 0.12, y: 0 }}
            end={{ x: 0.88, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          <View style={[StyleSheet.absoluteFill, styles.limb, { borderRadius: R }]} />
        </View>
      </Layer>

      {/* The air, over the planet — inward bleed and outward bloom in one. */}
      <Layer>
        <Image
          source={AIRGLOW}
          style={{ width: size * AIRGLOW_SCALE, height: size * AIRGLOW_SCALE }}
          contentFit="fill"
        />
      </Layer>

      {found ? <Beam R={R} Ro={Ro} lock={lock} /> : null}
      {found ? <Rival R={R} lock={lock} opponent={opponent} /> : null}
      <Satellite Ro={Ro} orbit={orbit} scale={(R * SAT_W) / SAT_UNITS} />
    </View>
  );
}

/**
 * The projected Earth: horizontal bands, each carrying its own latitude.
 *
 * ── Why this replaced 48 longitude strips ────────────────────────────────────
 *
 * The strips foreshortened correctly in longitude and had NO latitude term at
 * all. The true projection is
 *
 *     x = R·cos λ·sin(φ + θ)
 *
 * and the strips drew `R·sin(φ + θ)` for every row of the map, equator to pole.
 * So the planet was right at the equator and stretched everywhere else — 2×
 * too wide at 60° — which spread Europe, Canada and the Arctic edge to edge
 * and let the polar regions travel sideways instead of converging to a point.
 * A sphere whose poles do not converge is a cylinder, and a cylinder wearing a
 * map is exactly the "rotating image" it looked like.
 *
 * The map is now cut the other way. Each band is a horizontal slice at one
 * latitude, `2R·cos λ` wide, scrolling a copy of the map whose full turn is
 * `2πR·cos λ` — so the width, and the speed, both shrink toward the poles and
 * the silhouette comes out right.
 *
 * ── What this trades away, and why it is the better trade ────────────────────
 *
 * Within a band longitude is linear rather than sine, so a feature crosses at
 * constant speed instead of accelerating through the middle. The scale is
 * matched at the centre of the disc (one radian of longitude = R·cos λ, so the
 * disc shows ±57.3°), which keeps the error to the outer third — where the limb
 * shading has already darkened it. Silhouette is what the eye judges a sphere
 * by; the speed curve is a second-order cue, and getting both would cost bands
 * × strips, which is hundreds of animated views.
 *
 * ── Why the bands step in cos λ ──────────────────────────────────────────────
 *
 * Boundaries are placed at even steps of cos λ, not of latitude or of height,
 * so every band carries the same bounded error and the polar bands come out
 * thin automatically. Rendering it at 40 bands leaves a visible staircase at
 * the rim; at 48 the step is under `R/48` — about 2.7pt — and it falls where
 * the circular clip and the limb darkening are already eating it.
 */
function EarthBands({ R, spin }) {
  const bands = useMemo(() => buildBands(R), [R]);
  return (
    <>
      {bands.map((b) => (
        <Band key={b.key} band={b} R={R} spin={spin} />
      ))}
    </>
  );
}

/** Band edges at even steps of cos λ, both hemispheres, equator outward. */
function buildBands(R) {
  const out = [];
  for (const hemi of [-1, 1]) {
    for (let k = 0; k < BAND_N; k += 1) {
      const cA = 1 - k / BAND_N;
      const cB = 1 - (k + 1) / BAND_N;
      const yA = hemi * R * Math.sqrt(Math.max(0, 1 - cA * cA));
      const yB = hemi * R * Math.sqrt(Math.max(0, 1 - cB * cB));
      const height = Math.abs(yB - yA);
      // A band thinner than a pixel is a view that draws nothing.
      if (height < 0.5) continue;
      out.push({ key: `${hemi}:${k}`, top: Math.min(yA, yB), height, cos: (cA + cB) / 2 });
    }
  }
  return out;
}

/**
 * One latitude band: a window `2R·cos λ` wide, scrolling the map.
 *
 * Three copies of the map rather than two. The row travels a full `span` over
 * one turn, so with two the left edge crosses into the window at the far end
 * of the loop and opens a gap; three costs one more static image and cannot.
 */
function Band({ band, R, spin }) {
  const w = 2 * R * band.cos;
  const span = 2 * Math.PI * R * band.cos;
  /** Points of travel per degree of rotation, at this latitude. */
  const k = ((Math.PI / 180) * span) / (2 * Math.PI);

  /**
   * Solved rather than nudged: for the map column at longitude φ to land on
   * screen at `w/2 + R·cos λ·rad(φ + θ + START)`, the row's left edge has to
   * sit at `w/2 + (START − 180)·k`. φ cancels out, which is the check that the
   * whole band is aligned and not just its middle.
   */
  const rowLeft = w / 2 + (START_DEG - 180) * k;
  // Shifted by whole turns into a range where three copies always cover the
  // window — the map is periodic, so this moves nothing that can be seen.
  const base = rowLeft - span * (Math.floor(rowLeft / span) + 2);

  return (
    <View style={[styles.band, { left: R - w / 2, top: R + band.top, width: w, height: band.height }]}>
      <Animated.View
        style={{
          position: 'absolute',
          left: base,
          top: -(R + band.top),
          width: span * 3,
          height: 2 * R,
          flexDirection: 'row',
          transform: [{ translateX: spin.interpolate({ inputRange: [0, 1], outputRange: [0, span] }) }],
        }}
      >
        {[0, 1, 2].map((i) => (
          <Image key={i} source={EARTH} style={{ width: span, height: 2 * R }} contentFit="fill" />
        ))}
      </Animated.View>
    </View>
  );
}

/**
 * A full-bleed centred layer.
 *
 * An absolutely positioned view with no offsets does not inherit the parent's
 * `alignItems` or `justifyContent` — it falls back to its static position,
 * which is the top-left corner. A layer that fills its parent and centres its
 * children with flexbox cannot be misread, and when the layer itself is
 * transformed its contents move with it from a known origin.
 *
 * `Animated.View` unconditionally: an interpolation handed to a plain `View`
 * does not animate, it paints one frame and stops, and nothing in the build
 * would catch it.
 */
function Layer({ children, style }) {
  return <Animated.View style={[styles.layer, style]}>{children}</Animated.View>;
}

/**
 * One other player, standing on the planet.
 *
 * These were abstract dots, and a dot is a weaker thing to say than a face:
 * the screen means "there are people out there right now", and the app already
 * owns the exact art for a person. So each one wears a real avatar from the
 * same set the player picks their own from.
 *
 * Same projection as the strips — x = R·sin(φ+θ), y = −R·sin λ — so a face
 * stays pinned to its city rather than drifting off it.
 *
 * Unlike the strips, this lives OUTSIDE the tipped layer and carries the tilt
 * in its own coordinates. A face rotated 18° reads as a bug, and the whole
 * point of using avatars is that they are recognisable.
 */
function Person({ R, lat, lon, index, spin, found, d }) {
  // The same START_DEG the strips carry, so a face keeps its city.
  const phi = rad(lon + START_DEG);
  const y = -R * Math.sin(rad(lat));
  const face = PEOPLE_FACES[index % PEOPLE_FACES.length];
  const source = faceSource(face);

  /**
   * The SAME mapping the bands use — linear in longitude, not sine.
   *
   * This is not a simplification, it is a requirement: a marker drawn with the
   * true sine projection over a band drawn linearly would sit on its city at
   * the middle of the disc and slide off it toward the edge, which is worse
   * than either being right.
   *
   * Then sphere → screen by hand, because the tilt is not inherited out here.
   */
  const arc = (th) => R * Math.cos(rad(lat)) * wrapPi(phi + th);
  const sx = (th) => arc(th) * Math.cos(TILT) - y * Math.sin(TILT);
  const sy = (th) => arc(th) * Math.sin(TILT) + y * Math.cos(TILT);

  /**
   * Gone before the rim reaches it, in two ways at once.
   *
   * `facing` retires a face as it rounds the back. That alone is not enough:
   * these are clipped by the disc, and a face whose CENTRE is still inside it
   * is still half-eaten by the edge. So the second term measures how far the
   * marker actually is from the middle and fades it out while it still fits
   * whole — and the threshold has to be measured rather than picked, because
   * how close a marker gets to the rim depends on its latitude. London swings
   * out to the limb at a facing where a point on the equator is still well
   * inside it.
   */
  const room = R - d / 2 - 2;
  const radius = (th) => Math.hypot(sx(th), sy(th));
  // A band shows ±1 radian of longitude; a face is gone by 0.8 of that, well
  // before its own band runs out from under it.
  const facing = (th) =>
    clamp01((0.8 - Math.abs(wrapPi(phi + th))) * 4) * clamp01((room - radius(th)) / (R * 0.1));

  return (
    <Animated.View
      style={[
        styles.person,
        {
          width: d,
          height: d,
          borderRadius: d / 2,
          marginLeft: -d / 2,
          marginTop: -d / 2,
          opacity: found ? 0 : spin.interpolate({ inputRange: T, outputRange: table(facing) }),
          transform: [
            { translateX: spin.interpolate({ inputRange: T, outputRange: table(sx) }) },
            { translateY: spin.interpolate({ inputRange: T, outputRange: table(sy) }) },
            // Smaller toward the limb: further away, and it keeps a crowded
            // hemisphere from reading as a row of stickers.
            { scale: spin.interpolate({ inputRange: T, outputRange: table((th) => 0.72 + 0.28 * clamp01(Math.cos(phi + th))) }) },
          ],
        },
      ]}
    >
      {source ? (
        <Image source={source} style={styles.personFace} contentFit="cover" />
      ) : (
        <View style={[styles.personFace, { backgroundColor: '#FFD36E' }]} />
      )}
    </Animated.View>
  );
}

/**
 * The sweep: a bright line running pole to pole.
 *
 * A line of latitude on a sphere seen with its axis in the picture plane is a
 * straight chord, not an ellipse, so a plain bar is the exact geometry rather
 * than a shortcut. It narrows toward the poles because the surface is falling
 * away there.
 */
function ScanLine({ R, scan, found }) {
  if (found) return null;
  // 80° rather than 90°: a scan line at the pole is a point, and reads as a
  // glitch rather than as the end of a sweep.
  const latAt = (t) => rad(80) * Math.cos(t / 2);

  return (
    <Animated.View
      style={[
        styles.scan,
        {
          width: 2 * R,
          marginLeft: -R,
          transform: [
            { translateY: scan.interpolate({ inputRange: T, outputRange: table((t) => -R * Math.sin(latAt(t))) }) },
            { scaleX: scan.interpolate({ inputRange: T, outputRange: table((t) => Math.cos(latAt(t))) }) },
          ],
        },
      ]}
    >
      <LinearGradient
        colors={['rgba(127,224,228,0)', 'rgba(170,245,250,0.8)', 'rgba(127,224,228,0)']}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

/** Where the rival surfaces. Upright, because a face rotated 18° reads as a bug. */
function Rival({ R, lock, opponent }) {
  return (
    <Layer style={{ transform: [{ translateX: RIVAL_AT.x * R }, { translateY: RIVAL_AT.y * R }] }}>
      <Animated.View
        style={[
          styles.ping,
          {
            opacity: lock.interpolate({ inputRange: [0.55, 0.68, 1], outputRange: [0, 0.8, 0], extrapolate: 'clamp' }),
            transform: [{ scale: lock.interpolate({ inputRange: [0.55, 1], outputRange: [0.35, 2.7], extrapolate: 'clamp' }) }],
          },
        ]}
      />
      <Animated.View
        style={{
          opacity: lock.interpolate({ inputRange: [0.58, 0.76], outputRange: [0, 1], extrapolate: 'clamp' }),
          transform: [{ scale: lock.interpolate({ inputRange: [0.58, 0.84, 0.95], outputRange: [0.3, 1.16, 1], extrapolate: 'clamp' }) }],
        }}
      >
        <Avatar url={opponent?.avatarUrl} name={opponent?.displayName ?? '?'} size={42} style={styles.rivalFace} />
      </Animated.View>
    </Layer>
  );
}

/**
 * The satellite: two solar wings on booms, a bus, and a dish looking down.
 *
 * A dozen rectangles rather than an illustration — at this size the silhouette
 * is the whole recognition, and a correct silhouette beats any icon. It scales
 * off the globe's radius so it is never a speck or a spaceship.
 *
 * Drawn twice: React Native cannot reorder siblings per frame, so one copy sits
 * behind the planet and one in front, each fading in over the half of the orbit
 * it owns. The planet then occludes the far one for real.
 */
function Satellite({ Ro, orbit, scale, behind = false }) {
  const facing = (t) => (behind ? -Math.cos(t) : Math.cos(t));
  const s = (v) => Math.max(1, Math.round(v * scale));

  /**
   * A solar array.
   *
   * Real wings are much longer than the bus and cut into a grid of cells, and
   * the grid is what the eye actually reads as "spacecraft" — a plain blue
   * rectangle reads as a tab. Five columns and two rows of cells is the least
   * that still looks ruled rather than striped.
   */
  const wing = (side) => (
    <View style={[styles.wing, { width: s(26), height: s(15) }]}>
      <View style={styles.wingHalf}>
        {[0, 1, 2, 3, 4].map((c) => (
          <View key={c} style={[styles.cell, c === 4 && styles.cellLast]} />
        ))}
      </View>
      <View style={styles.wingHalf}>
        {[0, 1, 2, 3, 4].map((c) => (
          <View key={c} style={[styles.cell, c === 4 && styles.cellLast]} />
        ))}
      </View>
      {/* The sun catches the array edge-on; the far wing stays in its own shade. */}
      <View style={[styles.wingSheen, side === 'left' ? null : styles.wingSheenDim]} pointerEvents="none" />
    </View>
  );

  return (
    <Layer
      style={{
        opacity: orbit.interpolate({ inputRange: T, outputRange: table((t) => clamp01(facing(t) * 3)) }),
        transform: [
          { translateX: orbit.interpolate({ inputRange: T, outputRange: table((t) => Ro * Math.sin(t)) }) },
          { translateY: orbit.interpolate({ inputRange: T, outputRange: table((t) => Ro * ORBIT_TILT * Math.cos(t)) }) },
        ],
      }}
    >
      {/* The comms mast, above the bus. */}
      <View style={[styles.antenna, { height: s(7) }]} />
      <View style={[styles.antennaTip, { width: s(3), height: s(3), borderRadius: s(3) / 2 }]} />

      <View style={styles.satRow}>
        {wing('left')}
        <View style={[styles.boom, { width: s(5) }]} />
        {/* The bus: gold thermal blanket, a darker instrument deck, and a
            radiator stripe — three bands rather than one flat block, because a
            flat block at this size is a pill. */}
        <View style={[styles.bus, { width: s(14), height: s(19) }]}>
          <View style={styles.busDeck} />
          <View style={styles.busRadiator} />
        </View>
        <View style={[styles.boom, { width: s(5) }]} />
        {wing('right')}
      </View>

      {/* The high-gain dish, slung under the bus and looking down at Earth. */}
      <View style={[styles.mast, { height: s(5) }]} />
      <View style={[styles.dish, { width: s(13), height: s(9), borderTopLeftRadius: s(7), borderTopRightRadius: s(7) }]}>
        <View style={[styles.feed, { height: s(4) }]} />
      </View>
    </Layer>
  );
}

/**
 * The shot: a tapered beam from the parked satellite down to the rival.
 *
 * Both ends are known points, so length and angle are solved once rather than
 * tracked frame by frame. The wrapper is twice the beam's length with the beam
 * filling its right half, which puts the wrapper's centre — and so the origin
 * of both the rotation and the growth — exactly on the satellite. Transforms
 * are ordered so the scale resolves first, then the rotation, then the move.
 */
function Beam({ R, Ro, lock }) {
  const at = LOCK_ORBIT_T * Math.PI * 2;
  const sx = Ro * Math.sin(at);
  const sy = Ro * ORBIT_TILT * Math.cos(at);
  const tx = RIVAL_AT.x * R;
  const ty = RIVAL_AT.y * R;

  const length = Math.hypot(tx - sx, ty - sy);
  const angle = (Math.atan2(ty - sy, tx - sx) * 180) / Math.PI;

  return (
    <Layer>
      <Animated.View
        style={{
          width: length * 2,
          height: 14,
          opacity: lock.interpolate({ inputRange: [0.28, 0.42, 0.8, 1], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' }),
          transform: [
            { translateX: sx },
            { translateY: sy },
            { rotate: `${angle}deg` },
            { scaleX: lock.interpolate({ inputRange: [0.28, 0.56], outputRange: [0.04, 1], extrapolate: 'clamp' }) },
          ],
        }}
      >
        <LinearGradient
          colors={['rgba(245, 182, 46, 0)', 'rgba(245, 182, 46, 0.10)', 'rgba(245, 182, 46, 0.6)']}
          locations={[0, 0.5, 1]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.beamFill}
        />
      </Animated.View>
    </Layer>
  );
}

/** A fixed sky, so the planet hangs in something. */
function Stars({ radius }) {
  return (
    <>
      {Array.from({ length: 26 }, (_, i) => {
        // Golden-angle scatter: the same sky every launch, and no random()
        // re-rolling the field on each render.
        const a = i * 2.399963;
        const r = radius * (0.52 + (0.48 * ((i * 7919) % 97)) / 97);
        return (
          <View
            key={i}
            style={[
              styles.star,
              {
                opacity: 0.14 + ((i * 31) % 40) / 120,
                transform: [{ translateX: r * Math.cos(a) }, { translateY: r * Math.sin(a) * 0.86 }],
              },
            ]}
          />
        );
      })}
    </>
  );
}


const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },

  orbitRing: { borderWidth: 1, borderColor: 'rgba(122, 176, 205, 0.15)' },
  /** Deep ocean, so the extreme rim — where strips have squeezed to nothing —
      resolves into water rather than into a hole. */
  sphere: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#04101F' },
  limb: { borderWidth: 1, borderColor: 'rgba(158, 216, 255, 0.4)' },

  /**
   * Centred by half-offsets rather than by the parent, because an absolutely
   * positioned child does not inherit `alignItems` or `justifyContent`.
   */
  band: { position: 'absolute', overflow: 'hidden' },
  /**
   * A face on the planet.
   *
   * The white rim is doing real work: Earth underneath is blue, green, tan,
   * white and cloud all at once, and every avatar has to read against all of
   * them. A ring is the only edge that survives that, which is why map pins
   * everywhere have one.
   */
  person: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    overflow: 'hidden',
    backgroundColor: colors.nightRaised,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.92)',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  personFace: { width: '100%', height: '100%' },
  scan: { position: 'absolute', left: '50%', top: '50%', height: 2, marginTop: -1 },
  star: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 2,
    height: 2,
    borderRadius: 1,
    marginLeft: -1,
    marginTop: -1,
    backgroundColor: '#CFE8F0',
  },

  ping: { position: 'absolute', width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: colors.gold },
  rivalFace: { borderWidth: 2, borderColor: colors.gold },

  // ── The satellite ────────────────────────────────────────────────────────
  satRow: { flexDirection: 'row', alignItems: 'center' },
  antenna: { width: 1, backgroundColor: '#AEB8C6' },
  antennaTip: { backgroundColor: '#FF8A8A', marginTop: -1, marginBottom: -1 },

  wing: { backgroundColor: '#122E4A', borderWidth: 0.5, borderColor: '#7FB6CE', overflow: 'hidden' },
  wingHalf: { flex: 1, flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#7FB6CE' },
  cell: { flex: 1, borderRightWidth: 0.5, borderRightColor: '#7FB6CE' },
  cellLast: { borderRightWidth: 0 },
  /** A flat blue rectangle reads as a tab; a sheen reads as glass. */
  wingSheen: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(150, 210, 255, 0.22)' },
  wingSheenDim: { backgroundColor: 'rgba(120, 170, 210, 0.08)' },

  boom: { height: 1.5, backgroundColor: '#AEB8C6' },
  /** Gold MLI foil, the most recognisable surface on any spacecraft. */
  bus: { borderRadius: 2, backgroundColor: '#D9A94A', alignItems: 'center', justifyContent: 'flex-start', overflow: 'hidden' },
  busDeck: { width: '100%', height: '34%', backgroundColor: '#3A4250' },
  busRadiator: { width: '100%', height: '16%', marginTop: '14%', backgroundColor: '#E8EDF4' },

  mast: { width: 1.5, backgroundColor: '#AEB8C6', marginTop: -1 },
  /**
   * A dome, not a bowl.
   *
   * The dish points down at Earth, so what faces the viewer is its convex
   * back — rounded on top, open at the bottom, with the feed horn poking out
   * beneath. Rounding the top corners gives exactly that; an earlier
   * `rotate: 180deg` on top of it flipped the dome into a soup bowl aimed at
   * the sky, which is a satellite that has stopped doing its job.
   */
  dish: {
    backgroundColor: '#EDF2F8',
    borderWidth: 1,
    borderColor: '#8A93A0',
    borderBottomWidth: 0,
    marginTop: -1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  feed: { width: 1.5, backgroundColor: '#AEB8C6', marginBottom: -2 },

  beamFill: { flex: 1, borderRadius: 7 },
});

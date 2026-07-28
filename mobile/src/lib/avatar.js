import { AVATAR_TINTS } from '../theme/index.js';

/**
 * Avatar presets, carried inside `avatarUrl`.
 *
 * The server stores one avatar field — a string — and it is the only avatar
 * anything on the wire knows about (`toPublicProfile`, leaderboard rows, match
 * payloads). Rather than add parallel columns that every one of those payloads
 * would then have to learn, a preset is written into that same string and
 * resolved on the client:
 *
 *   mimo:avatar/<name>  one of the drawn faces (assets/avatars) — the picker
 *   mimo:tint/<n>       the older colour-disc presets, still honoured
 *
 * The upshot is that a preset behaves exactly like an uploaded photo
 * everywhere: it survives a round trip, other players see the one you picked,
 * and a real upload later simply overwrites it. Anything that does not match
 * a scheme is treated as a URL, so an unrecognised value degrades to an image
 * fetch rather than to a crash.
 */
const TINT_SCHEME = 'mimo:tint/';
const FACE_SCHEME = 'mimo:avatar/';

/**
 * The drawn faces. Names are the wire format — never rename, only append.
 *
 * Three tiers, drawn to be told apart at 44px: flowers are free and radially
 * symmetric, animals have ears, personas have headgear. What each one costs is
 * not decided here — that is configuration the server serves
 * (leagues-and-progression.md §9). This map only says which art ships inside
 * the app, and everything in it stays instant and works offline.
 */
export const AVATAR_FACES = {
  // ── Common ──
  pizza: require('../../assets/avatars/pizza.png'),
  burger: require('../../assets/avatars/burger.png'),
  sushi: require('../../assets/avatars/sushi.png'),
  donut: require('../../assets/avatars/donut.png'),
  icecream: require('../../assets/avatars/icecream.png'),
  coffee: require('../../assets/avatars/coffee.png'),
  cupcake: require('../../assets/avatars/cupcake.png'),
  taco: require('../../assets/avatars/taco.png'),
  ramen: require('../../assets/avatars/ramen.png'),
  fries: require('../../assets/avatars/fries.png'),
  hotdog: require('../../assets/avatars/hotdog.png'),
  pretzel: require('../../assets/avatars/pretzel.png'),
  avocado: require('../../assets/avatars/avocado.png'),
  watermelon: require('../../assets/avatars/watermelon.png'),
  strawberry: require('../../assets/avatars/strawberry.png'),
  banana: require('../../assets/avatars/banana.png'),
  egg: require('../../assets/avatars/egg.png'),
  boba: require('../../assets/avatars/boba.png'),
  popcorn: require('../../assets/avatars/popcorn.png'),
  cherry: require('../../assets/avatars/cherry.png'),
  rose: require('../../assets/avatars/rose.png'),
  sunflower: require('../../assets/avatars/sunflower.png'),
  daisy: require('../../assets/avatars/daisy.png'),
  tulip: require('../../assets/avatars/tulip.png'),
  lotus: require('../../assets/avatars/lotus.png'),
  blossom: require('../../assets/avatars/blossom.png'),
  iris: require('../../assets/avatars/iris.png'),
  poppy: require('../../assets/avatars/poppy.png'),
  orchid: require('../../assets/avatars/orchid.png'),
  dahlia: require('../../assets/avatars/dahlia.png'),
  peony: require('../../assets/avatars/peony.png'),
  marigold: require('../../assets/avatars/marigold.png'),
  panda: require('../../assets/avatars/panda.png'),
  fox: require('../../assets/avatars/fox.png'),
  frog: require('../../assets/avatars/frog.png'),
  owl: require('../../assets/avatars/owl.png'),
  cat: require('../../assets/avatars/cat.png'),
  penguin: require('../../assets/avatars/penguin.png'),
  bear: require('../../assets/avatars/bear.png'),
  dog: require('../../assets/avatars/dog.png'),
  rabbit: require('../../assets/avatars/rabbit.png'),
  pig: require('../../assets/avatars/pig.png'),
  bee: require('../../assets/avatars/bee.png'),
  mouse: require('../../assets/avatars/mouse.png'),
  hamster: require('../../assets/avatars/hamster.png'),
  sheep: require('../../assets/avatars/sheep.png'),
  hedgehog: require('../../assets/avatars/hedgehog.png'),
  turtle: require('../../assets/avatars/turtle.png'),
  koala: require('../../assets/avatars/koala.png'),
  squirrel: require('../../assets/avatars/squirrel.png'),

  // ── Uncommon ──
  jasmine: require('../../assets/avatars/jasmine.png'),
  camellia: require('../../assets/avatars/camellia.png'),
  zinnia: require('../../assets/avatars/zinnia.png'),
  aster: require('../../assets/avatars/aster.png'),
  violet: require('../../assets/avatars/violet.png'),
  freesia: require('../../assets/avatars/freesia.png'),
  hibiscus: require('../../assets/avatars/hibiscus.png'),
  magnolia: require('../../assets/avatars/magnolia.png'),
  tiger: require('../../assets/avatars/tiger.png'),
  lion: require('../../assets/avatars/lion.png'),
  wolf: require('../../assets/avatars/wolf.png'),
  deer: require('../../assets/avatars/deer.png'),
  monkey: require('../../assets/avatars/monkey.png'),
  whale: require('../../assets/avatars/whale.png'),
  shark: require('../../assets/avatars/shark.png'),
  octopus: require('../../assets/avatars/octopus.png'),
  crab: require('../../assets/avatars/crab.png'),
  dino: require('../../assets/avatars/dino.png'),
  unicorn: require('../../assets/avatars/unicorn.png'),
  otter: require('../../assets/avatars/otter.png'),
  lynx: require('../../assets/avatars/lynx.png'),
  badger: require('../../assets/avatars/badger.png'),
  raccoon: require('../../assets/avatars/raccoon.png'),
  goat: require('../../assets/avatars/goat.png'),
  cow: require('../../assets/avatars/cow.png'),
  horse: require('../../assets/avatars/horse.png'),
  zebra: require('../../assets/avatars/zebra.png'),
  giraffe: require('../../assets/avatars/giraffe.png'),
  elephant: require('../../assets/avatars/elephant.png'),
  rhino: require('../../assets/avatars/rhino.png'),
  hippo: require('../../assets/avatars/hippo.png'),
  camel: require('../../assets/avatars/camel.png'),
  llama: require('../../assets/avatars/llama.png'),
  sloth: require('../../assets/avatars/sloth.png'),
  chef: require('../../assets/avatars/chef.png'),
  doctor: require('../../assets/avatars/doctor.png'),
  scientist: require('../../assets/avatars/scientist.png'),
  detective: require('../../assets/avatars/detective.png'),
  boxer: require('../../assets/avatars/boxer.png'),
  racer: require('../../assets/avatars/racer.png'),
  dj: require('../../assets/avatars/dj.png'),
  sailor: require('../../assets/avatars/sailor.png'),
  pilot: require('../../assets/avatars/pilot.png'),
  farmer: require('../../assets/avatars/farmer.png'),
  firefighter: require('../../assets/avatars/firefighter.png'),
  police: require('../../assets/avatars/police.png'),
  soldier: require('../../assets/avatars/soldier.png'),
  nurse: require('../../assets/avatars/nurse.png'),
  mechanic: require('../../assets/avatars/mechanic.png'),
  barista: require('../../assets/avatars/barista.png'),

  // ── Rare ──
  ninja: require('../../assets/avatars/ninja.png'),
  pirate: require('../../assets/avatars/pirate.png'),
  samurai: require('../../assets/avatars/samurai.png'),
  viking: require('../../assets/avatars/viking.png'),
  knight: require('../../assets/avatars/knight.png'),
  wizard: require('../../assets/avatars/wizard.png'),
  monk: require('../../assets/avatars/monk.png'),
  cowboy: require('../../assets/avatars/cowboy.png'),
  astronaut: require('../../assets/avatars/astronaut.png'),
  robot: require('../../assets/avatars/robot.png'),
  cyborg: require('../../assets/avatars/cyborg.png'),
  alien: require('../../assets/avatars/alien.png'),
  gladiator: require('../../assets/avatars/gladiator.png'),
  vampire: require('../../assets/avatars/vampire.png'),
  mummy: require('../../assets/avatars/mummy.png'),
  zombie: require('../../assets/avatars/zombie.png'),
  yeti: require('../../assets/avatars/yeti.png'),
  jester: require('../../assets/avatars/jester.png'),
  punk: require('../../assets/avatars/punk.png'),
  agent: require('../../assets/avatars/agent.png'),
  skull: require('../../assets/avatars/skull.png'),
  demon: require('../../assets/avatars/demon.png'),
  angel: require('../../assets/avatars/angel.png'),
  pharaoh: require('../../assets/avatars/pharaoh.png'),
  dragon: require('../../assets/avatars/dragon.png'),
  witch: require('../../assets/avatars/witch.png'),
  assassin: require('../../assets/avatars/assassin.png'),
  android: require('../../assets/avatars/android.png'),
  superhero: require('../../assets/avatars/superhero.png'),
  villain: require('../../assets/avatars/villain.png'),

  // ── Legendary ──
  'cyber-oni': require('../../assets/avatars/cyber-oni.png'),
  'neon-runner': require('../../assets/avatars/neon-runner.png'),
  'sun-deity': require('../../assets/avatars/sun-deity.png'),
  'moon-deity': require('../../assets/avatars/moon-deity.png'),
  'shadow-blade': require('../../assets/avatars/shadow-blade.png'),
  'void-stalker': require('../../assets/avatars/void-stalker.png'),
  'dragon-lord': require('../../assets/avatars/dragon-lord.png'),
  'scale-rider': require('../../assets/avatars/scale-rider.png'),
  'phoenix-guard': require('../../assets/avatars/phoenix-guard.png'),
  'griffin-ward': require('../../assets/avatars/griffin-ward.png'),
  emperor: require('../../assets/avatars/emperor.png'),
  maharaja: require('../../assets/avatars/maharaja.png'),
  'brass-captain': require('../../assets/avatars/brass-captain.png'),
  'gear-baron': require('../../assets/avatars/gear-baron.png'),
  archmage: require('../../assets/avatars/archmage.png'),
  'rune-weaver': require('../../assets/avatars/rune-weaver.png'),
  'star-admiral': require('../../assets/avatars/star-admiral.png'),
  'nova-captain': require('../../assets/avatars/nova-captain.png'),
  'demon-shogun': require('../../assets/avatars/demon-shogun.png'),
  'oni-daimyo': require('../../assets/avatars/oni-daimyo.png'),
};

export const AVATAR_FACE_NAMES = Object.keys(AVATAR_FACES);

/**
 * Faces a superadmin uploaded after this build shipped.
 *
 * A cosmetic added through the console carries an image URL rather than a
 * bundled asset, but it is still `mimo:avatar/<key>` on the wire — so it has
 * to resolve exactly like a bundled one everywhere, or a player wearing a new
 * face would appear blank to anyone on an older build. Registered by the
 * progression provider the moment the config lands.
 */
let remoteFaces = {};

export function setRemoteFaces(map) {
  remoteFaces = map ?? {};
}

export function faceUri(name) {
  return `${FACE_SCHEME}${name}`;
}

/** The face name in an avatar value, or null. */
export function faceName(avatarUrl) {
  if (typeof avatarUrl !== 'string' || !avatarUrl.startsWith(FACE_SCHEME)) return null;
  const name = avatarUrl.slice(FACE_SCHEME.length);
  return AVATAR_FACES[name] || remoteFaces[name] ? name : null;
}

/** What to draw for a face key: a bundled asset, or an uploaded image. */
export function faceSource(name) {
  if (AVATAR_FACES[name]) return AVATAR_FACES[name];
  if (remoteFaces[name]) return { uri: remoteFaces[name] };
  return null;
}

export function presetUri(index) {
  return `${TINT_SCHEME}${((index % AVATAR_TINTS.length) + AVATAR_TINTS.length) % AVATAR_TINTS.length}`;
}

/** The tint-preset index in an avatar value, or null if it is not one. */
export function presetIndex(avatarUrl) {
  if (typeof avatarUrl !== 'string' || !avatarUrl.startsWith(TINT_SCHEME)) return null;
  const index = Number.parseInt(avatarUrl.slice(TINT_SCHEME.length), 10);
  if (!Number.isInteger(index) || index < 0 || index >= AVATAR_TINTS.length) return null;
  return index;
}

/**
 * Resolves an avatar to what should actually be drawn.
 *
 * `{ source }` for a drawn face, `{ uri }` for a real image, `{ tint }` for a
 * colour preset — and `{ tint }` derived from the name when there is nothing,
 * so a player who has never touched the picker still gets a stable colour
 * rather than a grey disc, the same colour on every screen because it is
 * derived rather than random.
 */
export function resolveAvatar(avatarUrl, name) {
  if (typeof avatarUrl === 'string' && avatarUrl.length > 0) {
    const face = faceName(avatarUrl);
    if (face) {
      const source = faceSource(face);
      // A remote face is an image fetch like any other, so it takes the `uri`
      // branch the rest of the app already knows how to draw.
      if (source?.uri) return { uri: source.uri };
      if (source) return { source };
    }
    const index = presetIndex(avatarUrl);
    if (index !== null) return { tint: AVATAR_TINTS[index] };
    return { uri: avatarUrl };
  }

  const seed = (name ?? '').split('').reduce((total, c) => total + c.charCodeAt(0), 0);
  return { tint: AVATAR_TINTS[seed % AVATAR_TINTS.length] };
}

export { AVATAR_TINTS };

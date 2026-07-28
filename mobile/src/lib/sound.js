import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Game sound, two channels.
 *
 * **Cues** — one-shots, every one synthesised and small:
 *
 *   tap      an answer committed
 *   reveal   the options dealing in
 *   correct  the round resolved your way
 *   wrong    it did not
 *   tick     the last three seconds, one soft tick each
 *   round    a round is about to start
 *   found    an opponent locked in — the "found one!" fanfare
 *   win      the match verdict, won
 *   lose     the match verdict, lost
 *
 * **Music** — one looping bed under the whole match: a smooth trivia-battle
 * loop that fades in when an opponent is found and fades out on the verdict,
 * so the win/lose stinger lands on silence. Music has its own preference and
 * its own volume: it sits UNDER the cues, never beside them.
 *
 * Same contract as haptics (lib/haptics.js): every call is fire-and-forget and
 * synchronous at the call site, because most of these sit on the answer path
 * where an await is a dropped frame. iOS's silent switch is respected — a
 * quiz app that plays through silent mode in a classroom gets deleted in the
 * classroom.
 */

const KEY = 'mimo.sounds';
const MUSIC_KEY = 'mimo.music';

const SOURCES = {
  tap: require('../../assets/sfx/tap.wav'),
  reveal: require('../../assets/sfx/reveal.wav'),
  correct: require('../../assets/sfx/correct.wav'),
  wrong: require('../../assets/sfx/wrong.wav'),
  tick: require('../../assets/sfx/tick.wav'),
  round: require('../../assets/sfx/round.wav'),
  found: require('../../assets/sfx/found.wav'),
  win: require('../../assets/sfx/win.wav'),
  lose: require('../../assets/sfx/lose.wav'),
};

const MUSIC_SOURCE = require('../../assets/sfx/music_battle.wav');
/** The bed sits well under the cues — calm is the entire brief. */
const MUSIC_VOLUME = 0.38;

let enabled = true;
let musicEnabled = true;
let players = null;
let musicPlayer = null;
let musicWanted = false;
let fadeTimer = null;

/** Players are created once, on first use — not at import, which is boot. */
function ensurePlayers() {
  if (players) return players;
  setAudioModeAsync({ playsInSilentMode: false, interruptionModeAndroid: 'duckOthers' }).catch(() => {});
  players = {};
  for (const [name, source] of Object.entries(SOURCES)) {
    try {
      players[name] = createAudioPlayer(source);
    } catch {
      // A failed player mutes that cue, never the app.
    }
  }
  return players;
}

function play(name) {
  if (!enabled) return;
  try {
    const player = ensurePlayers()[name];
    if (!player) return;
    // One-shots replay from the top; a rapid second tap restarts the cue.
    player.seekTo(0);
    player.play();
  } catch {
    // Sound is garnish. It must never throw into game state handling.
  }
}

export const sfx = {
  tap: () => play('tap'),
  reveal: () => play('reveal'),
  correct: () => play('correct'),
  wrong: () => play('wrong'),
  tick: () => play('tick'),
  round: () => play('round'),
  found: () => play('found'),
  win: () => play('win'),
  lose: () => play('lose'),
};

// ── Music ────────────────────────────────────────────────────────────────────

function ensureMusic() {
  if (musicPlayer) return musicPlayer;
  ensurePlayers(); // audio mode is set once, there
  try {
    musicPlayer = createAudioPlayer(MUSIC_SOURCE);
    musicPlayer.loop = true;
  } catch {
    musicPlayer = null;
  }
  return musicPlayer;
}

/**
 * Volume moves in steps rather than a snap — a bed that cuts in at full volume
 * reads as a mistake, one that swells in reads as a curtain rising.
 */
function fadeTo(target, ms, onDone) {
  const player = ensureMusic();
  if (!player) return;
  clearInterval(fadeTimer);
  const STEP = 50;
  const steps = Math.max(1, Math.round(ms / STEP));
  const from = player.volume ?? 0;
  let i = 0;
  fadeTimer = setInterval(() => {
    i += 1;
    try {
      player.volume = from + (target - from) * (i / steps);
    } catch {
      clearInterval(fadeTimer);
      return;
    }
    if (i >= steps) {
      clearInterval(fadeTimer);
      onDone?.();
    }
  }, STEP);
}

export const music = {
  /** The battle bed. Fades in; safe to call when already playing. */
  battle() {
    musicWanted = true;
    if (!enabled || !musicEnabled) return;
    try {
      const player = ensureMusic();
      if (!player) return;
      if (!player.playing) {
        player.volume = 0;
        player.seekTo(0);
        player.play();
      }
      fadeTo(MUSIC_VOLUME, 700);
    } catch {
      // Never throw into game state handling.
    }
  },

  /** Fade out and stop. The verdict stinger plays over the tail. */
  stop() {
    musicWanted = false;
    try {
      if (!musicPlayer || !musicPlayer.playing) return;
      fadeTo(0, 450, () => {
        try {
          musicPlayer.pause();
          musicPlayer.seekTo(0);
        } catch {
          /* already torn down */
        }
      });
    } catch {
      /* sound is garnish */
    }
  },
};

// Backgrounding pauses the bed; coming back resumes it — but only if a match
// still wants it. One-shots need no such care: they are over in under a second.
AppState.addEventListener('change', (next) => {
  try {
    if (!musicPlayer) return;
    if (next !== 'active') {
      if (musicPlayer.playing) musicPlayer.pause();
    } else if (musicWanted && enabled && musicEnabled && !musicPlayer.playing) {
      musicPlayer.play();
    }
  } catch {
    /* sound is garnish */
  }
});

// ── Preferences ──────────────────────────────────────────────────────────────

export function setSoundEnabled(value) {
  enabled = Boolean(value);
  if (!enabled) music.stop();
  SecureStore.setItemAsync(KEY, enabled ? '1' : '0').catch(() => {});
}

export function getSoundEnabled() {
  return enabled;
}

export function setMusicEnabled(value) {
  musicEnabled = Boolean(value);
  if (!musicEnabled) {
    music.stop();
  } else if (musicWanted) {
    // Flipped back on mid-match: the bed returns.
    musicWanted = true;
    music.battle();
  }
  SecureStore.setItemAsync(MUSIC_KEY, musicEnabled ? '1' : '0').catch(() => {});
}

export function getMusicEnabled() {
  return musicEnabled;
}

/** Called once at boot, alongside the haptics preference. */
export async function loadSoundPreference() {
  try {
    const stored = await SecureStore.getItemAsync(KEY);
    if (stored !== null) enabled = stored === '1';
    const storedMusic = await SecureStore.getItemAsync(MUSIC_KEY);
    if (storedMusic !== null) musicEnabled = storedMusic === '1';
  } catch {
    // Keychain unavailable — the default stands.
  }
  return enabled;
}

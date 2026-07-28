#!/usr/bin/env python3
"""Synthesise the Mimo sound pack — pure python, no deps.

Outputs 16-bit mono WAVs at 22050 Hz into mobile/assets/sfx/:

  music_battle.wav  a seamless 8-bar trivia-battle loop (smooth, low-key)
  tap.wav           an answer committed — a soft, low bloop
  reveal.wav        the options dealing in — quick pop
  correct.wav       round won — a soft rising fifth
  wrong.wav         round lost — a descending minor third
  round.wav         a round about to start — riser + thump
  found.wav         opponent found — a calm arrival, root and fifth
  win.wav           the match, won — full fanfare
  lose.wav          the match, lost — warm sympathetic descend
  tick.wav          final-seconds clock tick, very quiet
"""

import math
import os
import random
import struct
import wave

SR = 22050
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "sfx")

TWO_PI = 2 * math.pi


def buf(seconds):
    return [0.0] * int(SR * seconds)


def add(dest, src, at=0.0, gain=1.0, wrap=False):
    """Mix src into dest at time `at` (seconds). wrap=True folds overflow back
    to the start, which is what makes the music loop seamless."""
    start = int(at * SR)
    n = len(dest)
    for i, s in enumerate(src):
        j = start + i
        if j >= n:
            if not wrap:
                break
            j %= n
        dest[j] += s * gain


def env(i, n, attack, release, curve=3.0):
    """Attack/exponential-release envelope for sample i of n."""
    a = int(attack * SR)
    if i < a:
        return i / max(1, a)
    t = (i - a) / max(1, n - a)
    return math.exp(-curve * t)


def tone(freq, seconds, harmonics=((1, 1.0),), attack=0.004, curve=4.0,
         vibrato=0.0, vib_rate=5.5, glide=None):
    """A tone built from (multiple, gain) harmonics with an exp-decay envelope.
    glide: (from_freq, to_freq) linear sweep overriding freq."""
    n = int(seconds * SR)
    out = [0.0] * n
    phase = [0.0] * len(harmonics)
    for i in range(n):
        t = i / SR
        f = freq
        if glide:
            f = glide[0] + (glide[1] - glide[0]) * (i / n)
        if vibrato:
            f *= 1.0 + vibrato * math.sin(TWO_PI * vib_rate * t)
        e = env(i, n, attack, seconds, curve)
        s = 0.0
        for h, (mult, gain) in enumerate(harmonics):
            phase[h] += TWO_PI * f * mult / SR
            s += math.sin(phase[h]) * gain
        out[i] = s * e
    return out


def noise(seconds, curve=8.0, lp=0.15):
    """Filtered noise burst — the hats, the whooshes."""
    n = int(seconds * SR)
    out = [0.0] * n
    prev = 0.0
    for i in range(n):
        prev = prev + lp * (random.uniform(-1, 1) - prev)
        out[i] = prev * env(i, n, 0.001, seconds, curve)
    return out


def lowpass(samples, alpha):
    out = [0.0] * len(samples)
    prev = 0.0
    for i, s in enumerate(samples):
        prev = prev + alpha * (s - prev)
        out[i] = prev
    return out


def normalize(samples, peak=0.85):
    m = max(abs(s) for s in samples) or 1.0
    return [s / m * peak for s in samples]


def write(name, samples, peak=0.85):
    samples = normalize(samples, peak)
    path = os.path.join(OUT, name)
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = b"".join(
            struct.pack("<h", int(max(-1.0, min(1.0, s)) * 32767)) for s in samples
        )
        w.writeframes(frames)
    print(f"  {name}  {len(samples)/SR:.2f}s  {os.path.getsize(path)//1024}KB")


# ── Timbres ──────────────────────────────────────────────────────────────────

BELL = ((1, 1.0), (3, 0.28), (5.02, 0.10))
"""
A bell with its glare taken off.

BELL's partials sit at 3× and 5.02× the fundamental, which on anything at or
above C6 lands them between 3 and 5 kHz — the band the ear is most sensitive to
and the one "harsh" actually means. Fine for a single flourish; not for a cue
that fires seven times a match. This keeps a second partial for shape and drops
the rest, so the brightness comes from the note rather than from its overtones.
"""
SOFTBELL = ((1, 1.0), (2, 0.20), (3, 0.06))
"""
Barely a timbre at all — a sine with a whisper of octave on top.

The two answer cues fire on every question of every match, which makes them the
most-heard sounds in the product by a wide margin. At that rate the job is not
to be noticed; it is to be missed when it is gone. Anything with real harmonic
content starts to nag by the third match.
"""
GLASS = ((1, 1.0), (2, 0.09))
PLUCK = ((1, 1.0), (2, 0.35), (3, 0.12))
BRASS = ((1, 1.0), (2, 0.55), (3, 0.32), (4, 0.16))
WARM = ((1, 1.0), (2, 0.18))
PAD = ((1, 1.0), (2, 0.22), (4, 0.05))


def note(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


# midi numbers
F2, G2, A2, C3, E3, F3, G3, A3, B3 = 41, 43, 45, 48, 52, 53, 55, 57, 59
C4, D4, E4, F4, G4, A4, B4 = 60, 62, 64, 65, 67, 69, 71
C5, D5, E5, F5, G5, A5 = 72, 74, 76, 77, 79, 81
C6, E6, G6, C7 = 84, 88, 91, 96


# ── The battle bed ───────────────────────────────────────────────────────────
# Very calm, very minimal: no percussion of any kind. Four maj7/m7 chords at a
# resting-heart 60 BPM, carried by a heavily low-passed pad, a barely-there
# sub, and a handful of soft plucked notes per chord — the sparkle without the
# drive. The pressure in a round comes from the clock; the music's whole job
# is to keep the shoulders down.

def music_battle():
    beat = 1.0  # 60 BPM
    bars = 4    # one chord per bar, 4 beats each → a 16s seamless loop
    total = bars * 4 * beat
    mix = buf(total)

    prog = [
        (C3, [C4, E4, G4, B4]),   # Cmaj7
        (A2, [A3, C4, E4, G4]),   # Am7
        (F2, [F3, A3, C4, E4]),   # Fmaj7
        (G2, [G3, B3, D4, A4]),   # G add9
    ]

    # a slow, fixed melody — two or three notes per chord, never more
    MELODY = [
        ((E5, 0.5, 0.9), (G5, 2.5, 0.6)),
        ((C5, 0.5, 0.8), (E5, 2.0, 0.6), (A4, 3.0, 0.5)),
        ((A4, 0.5, 0.8), (C5, 2.5, 0.6)),
        ((B4, 0.5, 0.7), (D5, 2.0, 0.55), (G4, 3.25, 0.5)),
    ]

    for c, (bass_root, chord) in enumerate(prog):
        bar_at = c * 4 * beat

        # the pad — long, soft-attacked, filtered until it is only warmth
        for p in chord:
            pad = tone(note(p), 4 * beat * 1.1, PAD, attack=1.3, curve=0.8)
            add(mix, lowpass(pad, 0.06), bar_at, 0.055, wrap=True)

        # the sub — one gentle root per chord, felt more than heard
        sub = tone(note(bass_root - 12), 3.6, ((1, 1.0),), attack=0.5, curve=1.2)
        add(mix, lowpass(sub, 0.08), bar_at, 0.11, wrap=True)

        # the plucks — pure sine, long ring, far apart
        for p, at, g in MELODY[c]:
            pl = tone(note(p), 1.6, ((1, 1.0), (2, 0.08)), attack=0.012, curve=2.2)
            add(mix, pl, bar_at + at * beat, 0.055 * g, wrap=True)

    write("music_battle.wav", mix, peak=0.4)


# ── One-shots ────────────────────────────────────────────────────────────────

def sfx_tap():
    """
    An answer committed — the first half of submitting.

    This fires immediately before `correct`/`wrong`, so the two are heard as one
    gesture and have to be balanced as one. Softening the verdicts alone left
    this at peak 0.5 against their 0.25: a bright click, then a quiet chime, and
    the click is the part that stung.

    Down to 0.30 so it sits under what follows, an octave lower, and off the
    plucked timbre whose partials reached past 2.6 kHz. The attack goes from
    4ms to 9 — still immediate to the hand, no longer a tick.
    """
    mix = buf(0.14)
    add(mix, tone(note(E5), 0.11, GLASS, attack=0.009, curve=8.0), 0, 0.9)
    write("tap.wav", lowpass(mix, 0.6), peak=0.30)


def sfx_reveal():
    mix = buf(0.16)
    add(mix, tone(0, 0.09, PLUCK, curve=7.0, glide=(note(E5), note(A5))), 0, 0.8)
    write("reveal.wav", mix, peak=0.38)


def sfx_tick():
    mix = buf(0.07)
    add(mix, tone(1900, 0.05, ((1, 1.0), (2.7, 0.3)), attack=0.001, curve=14.0), 0, 0.8)
    write("tick.wav", mix, peak=0.35)


def sfx_correct():
    """
    A right answer. Seven of these a match, so it must not tire the ear.

    It was a three-note BELL arpeggio topped with a pure C7 — 2093 Hz sitting
    on top of partials already reaching past 5 kHz. Measured, 15.6% of its
    energy was above 2 kHz, the most of any cue in the pack, and it peaked at
    0.6. That is what "harsh" was.

    Now two notes, a rising fifth, on the softened bell. The top note is G5 at
    784 Hz, so its brightest partial lands near 1.6 kHz instead of 5 — still
    bright enough to read as a win, an octave and a half below where it hurt.
    """
    mix = buf(0.72)
    # Nearly together rather than an arpeggio — two notes that arrive as one
    # soft chime read as calm, where the same two dealt out read as a jingle.
    add(mix, tone(note(C5), 0.40, GLASS, attack=0.028, curve=3.4), 0.0, 0.60)
    add(mix, tone(note(G5), 0.52, GLASS, attack=0.032, curve=3.0), 0.055, 0.44)
    # One last shave off the top, so nothing survives to glint.
    write("correct.wav", lowpass(mix, 0.55), peak=0.26)


def sfx_wrong():
    """
    A wrong answer. It has to say "not that one", not "WRONG".

    The old pair was D4 down to G#3 — six semitones, a tritone, which is the
    most dissonant interval there is. That was not brightness (only 4.2% of its
    energy sat above 2 kHz); it was the interval itself, hit at full volume with
    a 4ms attack. The ear reads it as a buzzer because it is one.

    A descending minor third instead: F4 to D4. It falls, so it still means no,
    and it resolves, so it does not punish. Softer onset, and a third quieter.
    """
    mix = buf(0.62)
    add(mix, tone(note(F4), 0.30, GLASS, attack=0.026, curve=3.8), 0.0, 0.58)
    add(mix, tone(note(D4), 0.42, GLASS, attack=0.030, curve=3.2), 0.10, 0.56)
    write("wrong.wav", lowpass(mix, 0.40), peak=0.24)


def sfx_round():
    """A round begins: two soft bell notes, nothing else. Minimal on purpose —
    this plays seven times a match and must never tire."""
    mix = buf(0.7)
    add(mix, tone(note(A4), 0.5, BELL, attack=0.008, curve=3.5), 0.0, 0.6)
    add(mix, tone(note(E5), 0.45, BELL, attack=0.008, curve=3.5), 0.11, 0.4)
    write("round.wav", mix, peak=0.38)


def sfx_found():
    """
    An opponent has arrived. Calm, not a jackpot.

    This was a brass fanfare — four rising notes, the last held with vibrato,
    with a bell arpeggio sparkling up to C7 over the top. Measured, it peaked
    at 0.62 with a brightness climbing past 1.3 kHz, and it fired on EVERY
    match. A celebration that happens every single time is not a celebration,
    it is a noise you learn to brace for, and this one was loud, busy and high
    exactly where the ear is most sensitive.

    So: an arrival instead. A soft low swell, then two WARM notes a fifth apart
    landing together — an interval that resolves, rather than a fanfare that
    demands applause — and one quiet bell an octave up to put a lid on it.
    Nothing above 1 kHz carries any weight, and the peak is down by two thirds.

    The match's actual celebration still exists; it is `win.wav`, and it plays
    when the player has done something.
    """
    mix = buf(1.15)
    # A breath of air rising into it — heavily low-passed, so it reads as
    # arrival rather than as the whoosh it used to be.
    add(mix, lowpass(noise(0.34, curve=1.6, lp=0.16), 0.10), 0.0, 0.075)
    # The two notes: root and fifth, together, warm and soft-edged.
    add(mix, tone(note(F4), 0.85, WARM, attack=0.035, curve=2.6), 0.06, 0.30)
    add(mix, tone(note(C5), 0.80, WARM, attack=0.045, curve=2.7), 0.10, 0.22)
    # One bell, an octave over the root, well under the notes it sits on.
    add(mix, tone(note(F5), 0.55, BELL, attack=0.012, curve=4.5), 0.16, 0.085)
    # A low root underneath for body, felt more than heard.
    add(mix, tone(note(F3), 0.70, PAD, attack=0.05, curve=3.0), 0.05, 0.16)
    write("found.wav", mix, peak=0.34)


def sfx_win():
    mix = buf(2.0)
    add(mix, tone(60, 0.25, ((1, 1.0),), curve=5.0, glide=(110, 50)), 0.0, 0.7)
    # rising arpeggio…
    for i, p in enumerate((C5, E5, G5)):
        add(mix, tone(note(p), 0.20, BRASS, curve=3.0), i * 0.11, 0.42)
    # …into the chord, held with vibrato.
    for p, g in ((C5, 0.5), (E5, 0.42), (G5, 0.4), (C6, 0.5)):
        add(mix, tone(note(p), 1.35, BRASS, attack=0.012, curve=1.8,
                      vibrato=0.007), 0.34, g * 0.5)
    # shimmer
    for i, p in enumerate((C6, E6, G6, C7, G6, E6, C6, E6)):
        add(mix, tone(note(p), 0.25, BELL, curve=8.0), 0.5 + i * 0.07, 0.12)
    write("win.wav", mix, peak=0.65)


def sfx_lose():
    mix = buf(1.6)
    line = ((E5, 0.0, 0.30), (C5, 0.22, 0.30), (A4, 0.44, 0.34), (F4, 0.68, 0.6))
    for p, at, dur in line:
        add(mix, tone(note(p), dur, WARM, attack=0.015, curve=2.2), at, 0.55)
    # soft closing minor colour underneath
    for p, g in ((F3, 0.5), (A3, 0.35), (C4, 0.3)):
        add(mix, lowpass(tone(note(p), 0.8, PAD, attack=0.10, curve=1.5), 0.12), 0.68, g * 0.5)
    write("lose.wav", mix, peak=0.5)


if __name__ == "__main__":
    random.seed(7)
    os.makedirs(OUT, exist_ok=True)
    print("writing to", OUT)
    music_battle()
    sfx_tap()
    sfx_reveal()
    sfx_tick()
    sfx_correct()
    sfx_wrong()
    sfx_round()
    sfx_found()
    sfx_win()
    sfx_lose()
    print("done")

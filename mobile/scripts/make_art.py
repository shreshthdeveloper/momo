#!/usr/bin/env python3
"""The avatar and banner sets — flat, geometric, drawn with PIL.

Avatars: three tiers of flat faces on tinted discs, 256x256, QuizUp-flavoured.

  flowers   the free tier every new player picks from — soft, friendly, no teeth
  animals   the early unlocks, levels 2-20
  personas  the late unlocks, levels 22-50 — ninja, agent, samurai and the rest

The tiers are drawn to read differently at 44px, which is the size that
actually matters: flowers are radially symmetric, animals have ears, personas
have headgear. You can tell which tier something is from across the room.

Banners: eight 720x320 patterned cards, deliberately NOT all purple.

Outputs to mobile/assets/avatars/ and mobile/assets/banners/.
Rerun any time; the app resolves them by name (src/lib/avatar.js, banner.js).
"""

import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AV_DIR = os.path.join(ROOT, "assets", "avatars")
BN_DIR = os.path.join(ROOT, "assets", "banners")
S = 256  # avatar canvas


def canvas():
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def disc(d, color):
    d.ellipse([8, 8, S - 8, S - 8], fill=color)


def save(im, name):
    im.save(os.path.join(AV_DIR, f"{name}.png"), optimize=True)
    print(" avatar", name)


def E(d, cx, cy, rx, ry, fill):
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=fill)


# ── Avatars ──────────────────────────────────────────────────────────────────

def panda():
    im, d = canvas()
    disc(d, (243, 244, 250))
    E(d, 70, 62, 34, 34, (34, 34, 44))          # ears
    E(d, 186, 62, 34, 34, (34, 34, 44))
    E(d, 128, 140, 92, 84, (255, 255, 255))     # face
    d.ellipse([62, 96, 118, 168], fill=(34, 34, 44))   # eye patches
    d.ellipse([138, 96, 194, 168], fill=(34, 34, 44))
    E(d, 92, 130, 10, 10, (255, 255, 255))      # pupils
    E(d, 164, 130, 10, 10, (255, 255, 255))
    E(d, 94, 132, 4, 4, (34, 34, 44))
    E(d, 166, 132, 4, 4, (34, 34, 44))
    E(d, 128, 176, 13, 9, (34, 34, 44))         # nose
    d.arc([104, 176, 152, 208], 20, 160, fill=(34, 34, 44), width=6)
    save(im, "panda")


def fox():
    im, d = canvas()
    disc(d, (255, 224, 200))
    d.polygon([(48, 96), (68, 26), (110, 76)], fill=(216, 106, 50))   # ears
    d.polygon([(208, 96), (188, 26), (146, 76)], fill=(216, 106, 50))
    d.polygon([(56, 100), (72, 46), (102, 82)], fill=(60, 40, 40))
    d.polygon([(200, 100), (184, 46), (154, 82)], fill=(60, 40, 40))
    E(d, 128, 140, 90, 80, (232, 122, 60))      # face
    d.polygon([(128, 236), (60, 160), (196, 160)], fill=(255, 246, 238))  # muzzle
    E(d, 94, 122, 11, 13, (48, 34, 34))         # eyes
    E(d, 162, 122, 11, 13, (48, 34, 34))
    E(d, 97, 118, 4, 4, (255, 255, 255))
    E(d, 165, 118, 4, 4, (255, 255, 255))
    E(d, 128, 186, 13, 10, (48, 34, 34))        # nose
    save(im, "fox")


def frog():
    im, d = canvas()
    disc(d, (214, 242, 220))
    E(d, 82, 66, 36, 36, (92, 190, 96))         # eye mounds
    E(d, 174, 66, 36, 36, (92, 190, 96))
    E(d, 128, 150, 92, 78, (104, 202, 108))     # face
    E(d, 82, 66, 24, 24, (255, 255, 255))       # eyes
    E(d, 174, 66, 24, 24, (255, 255, 255))
    E(d, 86, 70, 10, 10, (40, 44, 40))
    E(d, 178, 70, 10, 10, (40, 44, 40))
    d.arc([70, 120, 186, 200], 25, 155, fill=(36, 92, 44), width=8)   # smile
    E(d, 104, 176, 7, 5, (66, 150, 72))         # nostrils... cheeks
    E(d, 152, 176, 7, 5, (66, 150, 72))
    save(im, "frog")


def owl():
    im, d = canvas()
    disc(d, (232, 226, 214))
    E(d, 128, 140, 92, 86, (150, 110, 74))      # body
    d.polygon([(70, 60), (96, 92), (52, 96)], fill=(150, 110, 74))    # ear tufts
    d.polygon([(186, 60), (160, 92), (204, 96)], fill=(150, 110, 74))
    E(d, 94, 122, 34, 34, (244, 238, 226))      # eye rings
    E(d, 162, 122, 34, 34, (244, 238, 226))
    E(d, 94, 122, 15, 15, (52, 40, 32))
    E(d, 162, 122, 15, 15, (52, 40, 32))
    E(d, 98, 117, 5, 5, (255, 255, 255))
    E(d, 166, 117, 5, 5, (255, 255, 255))
    d.polygon([(128, 150), (110, 178), (146, 178)], fill=(238, 152, 60))  # beak
    E(d, 100, 196, 6, 6, (122, 88, 58))          # chest speckles
    E(d, 128, 204, 6, 6, (122, 88, 58))
    E(d, 156, 196, 6, 6, (122, 88, 58))
    save(im, "owl")


def cat():
    im, d = canvas()
    disc(d, (250, 232, 238))
    d.polygon([(56, 96), (66, 30), (116, 70)], fill=(120, 126, 148))  # ears
    d.polygon([(200, 96), (190, 30), (140, 70)], fill=(120, 126, 148))
    d.polygon([(68, 86), (74, 48), (104, 72)], fill=(240, 170, 190))
    d.polygon([(188, 86), (182, 48), (152, 72)], fill=(240, 170, 190))
    E(d, 128, 146, 88, 78, (136, 142, 164))     # face
    E(d, 96, 130, 11, 13, (44, 44, 56))
    E(d, 160, 130, 11, 13, (44, 44, 56))
    E(d, 99, 126, 4, 4, (255, 255, 255))
    E(d, 163, 126, 4, 4, (255, 255, 255))
    d.polygon([(128, 158), (117, 172), (139, 172)], fill=(240, 140, 160))  # nose
    for y in (168, 182):                         # whiskers
        d.line([(40, y), (86, y + 4)], fill=(94, 100, 122), width=5)
        d.line([(216, y), (170, y + 4)], fill=(94, 100, 122), width=5)
    save(im, "cat")


def penguin():
    im, d = canvas()
    disc(d, (206, 232, 246))
    E(d, 128, 138, 88, 88, (40, 46, 60))        # head
    E(d, 128, 158, 62, 62, (245, 248, 252))     # face patch
    E(d, 98, 120, 16, 16, (245, 248, 252))
    E(d, 158, 120, 16, 16, (245, 248, 252))
    E(d, 98, 122, 9, 9, (40, 46, 60))
    E(d, 158, 122, 9, 9, (40, 46, 60))
    E(d, 101, 119, 3, 3, (255, 255, 255))
    E(d, 161, 119, 3, 3, (255, 255, 255))
    d.polygon([(128, 138), (110, 162), (146, 162)], fill=(240, 158, 60))  # beak
    save(im, "penguin")


def bear():
    im, d = canvas()
    disc(d, (240, 226, 208))
    E(d, 70, 64, 30, 30, (150, 104, 66))        # ears
    E(d, 186, 64, 30, 30, (150, 104, 66))
    E(d, 70, 66, 14, 14, (196, 152, 108))
    E(d, 186, 66, 14, 14, (196, 152, 108))
    E(d, 128, 142, 90, 82, (166, 118, 76))      # face
    E(d, 128, 178, 44, 34, (222, 188, 148))     # muzzle
    E(d, 96, 122, 10, 12, (52, 38, 30))
    E(d, 160, 122, 10, 12, (52, 38, 30))
    E(d, 99, 118, 4, 4, (255, 255, 255))
    E(d, 163, 118, 4, 4, (255, 255, 255))
    E(d, 128, 170, 13, 10, (52, 38, 30))        # nose
    d.arc([112, 176, 144, 200], 20, 160, fill=(52, 38, 30), width=5)
    save(im, "bear")


def koala():
    im, d = canvas()
    disc(d, (226, 234, 228))
    E(d, 56, 92, 42, 42, (142, 150, 160))       # big ears
    E(d, 200, 92, 42, 42, (142, 150, 160))
    E(d, 56, 94, 22, 22, (222, 178, 190))
    E(d, 200, 94, 22, 22, (222, 178, 190))
    E(d, 128, 146, 84, 78, (164, 172, 182))     # face
    E(d, 98, 128, 10, 12, (46, 46, 54))
    E(d, 158, 128, 10, 12, (46, 46, 54))
    E(d, 101, 124, 4, 4, (255, 255, 255))
    E(d, 161, 124, 4, 4, (255, 255, 255))
    d.rounded_rectangle([112, 148, 144, 196], radius=16, fill=(46, 46, 54))  # big nose
    save(im, "koala")


def tiger():
    im, d = canvas()
    disc(d, (255, 234, 204))
    E(d, 70, 62, 28, 28, (234, 138, 52))        # ears
    E(d, 186, 62, 28, 28, (234, 138, 52))
    E(d, 128, 142, 90, 82, (244, 152, 60))      # face
    for x1, y1, x2, y2 in ((44, 116, 70, 128), (44, 148, 72, 152), (212, 116, 186, 128), (212, 148, 184, 152)):
        d.line([(x1, y1), (x2, y2)], fill=(60, 42, 32), width=9)      # stripes
    d.polygon([(112, 62), (128, 92), (96, 92)], fill=(60, 42, 32))
    d.polygon([(144, 62), (128, 92), (160, 92)], fill=(60, 42, 32))
    E(d, 128, 182, 42, 32, (255, 244, 230))     # muzzle
    E(d, 96, 124, 10, 12, (52, 38, 30))
    E(d, 160, 124, 10, 12, (52, 38, 30))
    E(d, 99, 120, 4, 4, (255, 255, 255))
    E(d, 163, 120, 4, 4, (255, 255, 255))
    E(d, 128, 172, 12, 9, (52, 38, 30))
    save(im, "tiger")


def alien():
    im, d = canvas()
    disc(d, (222, 226, 248))
    E(d, 128, 132, 74, 92, (118, 146, 238))     # head
    E(d, 128, 210, 30, 16, (118, 146, 238))     # chin
    E(d, 100, 128, 26, 34, (34, 36, 48))        # big eyes
    E(d, 156, 128, 26, 34, (34, 36, 48))
    E(d, 92, 116, 9, 12, (255, 255, 255))
    E(d, 148, 116, 9, 12, (255, 255, 255))
    E(d, 118, 196, 4, 4, (86, 112, 210))        # freckles
    E(d, 138, 196, 4, 4, (86, 112, 210))
    E(d, 128, 206, 4, 4, (86, 112, 210))
    save(im, "alien")


def pig():
    im, d = canvas()
    disc(d, (252, 228, 232))
    d.polygon([(62, 92), (72, 40), (112, 74)], fill=(240, 148, 158))   # ears
    d.polygon([(194, 92), (184, 40), (144, 74)], fill=(240, 148, 158))
    E(d, 128, 144, 88, 80, (247, 168, 178))     # face
    E(d, 96, 124, 10, 12, (60, 40, 44))         # eyes
    E(d, 160, 124, 10, 12, (60, 40, 44))
    E(d, 99, 120, 4, 4, (255, 255, 255))
    E(d, 163, 120, 4, 4, (255, 255, 255))
    d.rounded_rectangle([98, 154, 158, 198], radius=22, fill=(240, 148, 158))  # snout
    E(d, 114, 176, 7, 10, (140, 70, 82))        # nostrils
    E(d, 142, 176, 7, 10, (140, 70, 82))
    save(im, "pig")


def lion():
    im, d = canvas()
    disc(d, (255, 238, 210))
    E(d, 128, 138, 96, 92, (200, 120, 40))      # mane
    for ang in range(0, 360, 30):               # mane spikes via outer dots
        import math as _m
        x = 128 + int(100 * _m.cos(_m.radians(ang)))
        y = 138 + int(96 * _m.sin(_m.radians(ang)))
        E(d, x, y, 16, 16, (200, 120, 40))
    E(d, 128, 142, 72, 68, (244, 178, 84))      # face
    E(d, 100, 126, 10, 12, (60, 42, 30))
    E(d, 156, 126, 10, 12, (60, 42, 30))
    E(d, 103, 122, 4, 4, (255, 255, 255))
    E(d, 159, 122, 4, 4, (255, 255, 255))
    E(d, 128, 176, 36, 26, (255, 240, 220))     # muzzle
    d.polygon([(128, 158), (116, 172), (140, 172)], fill=(96, 62, 40))  # nose
    save(im, "lion")


def rabbit():
    im, d = canvas()
    disc(d, (222, 240, 236))
    d.rounded_rectangle([76, 18, 108, 110], radius=16, fill=(236, 240, 246))   # ears
    d.rounded_rectangle([148, 18, 180, 110], radius=16, fill=(236, 240, 246))
    d.rounded_rectangle([84, 30, 100, 100], radius=8, fill=(244, 190, 205))
    d.rounded_rectangle([156, 30, 172, 100], radius=8, fill=(244, 190, 205))
    E(d, 128, 158, 80, 72, (246, 248, 252))     # face
    E(d, 100, 142, 10, 12, (52, 52, 62))
    E(d, 156, 142, 10, 12, (52, 52, 62))
    E(d, 103, 138, 4, 4, (255, 255, 255))
    E(d, 159, 138, 4, 4, (255, 255, 255))
    d.polygon([(128, 168), (118, 180), (138, 180)], fill=(244, 160, 178))      # nose
    d.line([(128, 180), (128, 194)], fill=(200, 204, 214), width=4)
    d.arc([108, 182, 128, 206], 0, 100, fill=(200, 204, 214), width=4)         # mouth
    d.arc([128, 182, 148, 206], 80, 180, fill=(200, 204, 214), width=4)
    save(im, "rabbit")


def robot():
    im, d = canvas()
    disc(d, (218, 232, 244))
    d.line([(128, 34), (128, 58)], fill=(120, 136, 156), width=6)              # antenna
    E(d, 128, 30, 9, 9, (240, 112, 90))
    d.rounded_rectangle([52, 58, 204, 196], radius=30, fill=(148, 164, 184))   # head
    d.rounded_rectangle([68, 84, 188, 152], radius=20, fill=(48, 58, 72))      # visor
    E(d, 100, 118, 14, 14, (120, 220, 240))     # eyes
    E(d, 156, 118, 14, 14, (120, 220, 240))
    d.rounded_rectangle([96, 164, 160, 180], radius=8, fill=(94, 108, 126))    # mouth grill
    E(d, 52, 128, 10, 18, (110, 124, 144))      # side bolts
    E(d, 204, 128, 10, 18, (110, 124, 144))
    save(im, "robot")


def monkey():
    im, d = canvas()
    disc(d, (240, 230, 214))
    E(d, 54, 128, 30, 30, (150, 104, 66))       # ears
    E(d, 202, 128, 30, 30, (150, 104, 66))
    E(d, 54, 128, 15, 15, (226, 188, 152))
    E(d, 202, 128, 15, 15, (226, 188, 152))
    E(d, 128, 138, 82, 78, (166, 118, 76))      # head
    E(d, 128, 156, 62, 54, (238, 202, 164))     # face patch
    E(d, 128, 108, 44, 30, (238, 202, 164))     # brow patch
    E(d, 104, 126, 10, 12, (54, 38, 28))
    E(d, 152, 126, 10, 12, (54, 38, 28))
    E(d, 107, 122, 4, 4, (255, 255, 255))
    E(d, 155, 122, 4, 4, (255, 255, 255))
    E(d, 118, 168, 5, 7, (120, 82, 52))         # nostrils
    E(d, 138, 168, 5, 7, (120, 82, 52))
    d.arc([106, 168, 150, 198], 20, 160, fill=(120, 82, 52), width=5)          # smile
    save(im, "monkey")


def ghost():
    im, d = canvas()
    disc(d, (226, 226, 240))
    d.rounded_rectangle([64, 56, 192, 176], radius=64, fill=(250, 250, 255))   # body top
    d.rectangle([64, 120, 192, 176], fill=(250, 250, 255))
    for i, x in enumerate(range(64, 193, 32)):                                 # wavy hem
        E(d, x + 16, 176, 16, 16, (250, 250, 255))
    E(d, 104, 116, 12, 16, (52, 52, 66))        # eyes
    E(d, 152, 116, 12, 16, (52, 52, 66))
    E(d, 107, 111, 4, 5, (255, 255, 255))
    E(d, 155, 111, 4, 5, (255, 255, 255))
    E(d, 128, 152, 10, 12, (120, 120, 140))     # mouth
    E(d, 84, 140, 8, 6, (234, 178, 192))        # blush
    E(d, 172, 140, 8, 6, (234, 178, 192))
    save(im, "ghost")


# ── Flowers: the free tier ───────────────────────────────────────────────────
#
# What a brand-new player picks from at sign-up, so they are drawn softer than
# the animals: rounded petals, no teeth, no headgear. Radial symmetry is the
# tell — at thumbnail size a flower reads as a flower before you can name it.


def petal_ring(d, cx, cy, orbit, rp, color, n=8, phase=0):
    """Rounded petals on a circle — the daisy/rose construction."""
    for i in range(n):
        a = math.radians(phase + i * 360.0 / n)
        E(d, cx + int(orbit * math.cos(a)), cy + int(orbit * math.sin(a)), rp, rp, color)


def spike_ring(d, cx, cy, inner, outer, half, color, n=12, phase=0):
    """Pointed petals — one triangle per step, base sitting on the inner circle."""
    for i in range(n):
        a = math.radians(phase + i * 360.0 / n)
        lo, hi = a - math.radians(half), a + math.radians(half)
        d.polygon(
            [
                (cx + outer * math.cos(a), cy + outer * math.sin(a)),
                (cx + inner * math.cos(lo), cy + inner * math.sin(lo)),
                (cx + inner * math.cos(hi), cy + inner * math.sin(hi)),
            ],
            fill=color,
        )


def rot_petal(im, cx, cy, w, h, angle, color):
    """One rounded petal, leaning.

    PIL cannot rotate an ellipse in place, so the petal is drawn upright on its
    own layer, rotated, and composited back. Triangles were the cheaper option
    and they read as spikes — a lotus needs a petal with a shoulder.
    """
    p = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(p).ellipse([0, 0, w - 1, h - 1], fill=color)
    p = p.rotate(angle, expand=True, resample=Image.BICUBIC)
    im.alpha_composite(p, (int(cx - p.width / 2), int(cy - p.height / 2)))


def smiley(d, cx, cy, eye=(62, 46, 42), spread=22, lift=6, mouth=True, blush=None):
    """The two-dot-and-an-arc face every flower wears."""
    E(d, cx - spread, cy - lift, 9, 11, eye)
    E(d, cx + spread, cy - lift, 9, 11, eye)
    E(d, cx - spread + 3, cy - lift - 4, 4, 4, (255, 255, 255))
    E(d, cx + spread + 3, cy - lift - 4, 4, 4, (255, 255, 255))
    if mouth:
        d.arc([cx - 18, cy + 4, cx + 18, cy + 30], 20, 160, fill=eye, width=5)
    if blush:
        E(d, cx - spread - 18, cy + 10, 9, 6, blush)
        E(d, cx + spread + 18, cy + 10, 9, 6, blush)


def rose():
    im, d = canvas()
    disc(d, (255, 226, 232))
    petal_ring(d, 128, 128, 62, 36, (206, 56, 90), n=8, phase=22)
    petal_ring(d, 128, 128, 34, 30, (232, 92, 122), n=6)
    E(d, 128, 128, 46, 46, (248, 138, 158))
    smiley(d, 128, 132, eye=(104, 26, 50), spread=20)
    save(im, "rose")


def sunflower():
    im, d = canvas()
    disc(d, (255, 244, 212))
    spike_ring(d, 128, 128, 46, 112, 13, (240, 180, 34), n=14)
    spike_ring(d, 128, 128, 44, 96, 15, (255, 214, 82), n=14, phase=12.8)
    E(d, 128, 128, 54, 54, (118, 76, 40))
    E(d, 128, 128, 46, 46, (148, 96, 48))
    smiley(d, 128, 132, eye=(52, 32, 20), spread=19)
    save(im, "sunflower")


def daisy():
    im, d = canvas()
    disc(d, (222, 238, 250))
    petal_ring(d, 128, 128, 66, 33, (255, 255, 255), n=9, phase=10)
    E(d, 128, 128, 48, 48, (250, 202, 66))
    smiley(d, 128, 132, eye=(96, 62, 18), spread=19)
    save(im, "daisy")


def tulip():
    im, d = canvas()
    disc(d, (240, 232, 252))
    d.line([(128, 150), (128, 228)], fill=(72, 158, 96), width=10)
    E(d, 90, 198, 32, 14, (96, 186, 116))
    E(d, 166, 198, 32, 14, (96, 186, 116))
    d.rounded_rectangle([64, 74, 192, 182], radius=56, fill=(174, 92, 220))
    E(d, 88, 86, 30, 40, (194, 118, 236))
    E(d, 168, 86, 30, 40, (194, 118, 236))
    E(d, 128, 70, 34, 44, (210, 138, 244))
    smiley(d, 128, 132, eye=(74, 28, 104), spread=21)
    save(im, "tulip")


def lotus():
    """A fan rather than a ring — a full ring of spikes just reads as a sun."""
    im, d = canvas()
    disc(d, (228, 244, 250))
    for dx, dy, ang, col in ((-64, -4, 58, (224, 112, 164)), (64, -4, -58, (224, 112, 164)),
                             (-38, -44, 30, (242, 148, 190)), (38, -44, -30, (242, 148, 190))):
        rot_petal(im, 128 + dx, 166 + dy, 56, 112, ang, col)
    rot_petal(im, 128, 106, 62, 120, 0, (250, 176, 208))                         # crown petal
    E(d, 128, 178, 74, 52, (255, 208, 228))                                      # cup
    smiley(d, 128, 174, eye=(124, 38, 82), spread=22, blush=(248, 166, 196))
    save(im, "lotus")


def blossom():
    im, d = canvas()
    disc(d, (255, 234, 242))
    petal_ring(d, 128, 128, 58, 40, (248, 162, 192), n=5, phase=-90)
    E(d, 128, 128, 46, 46, (255, 250, 252))
    for i in range(5):
        a = math.radians(-90 + i * 72 + 36)
        E(d, 128 + int(34 * math.cos(a)), 128 + int(34 * math.sin(a)), 5, 5, (250, 206, 92))
    smiley(d, 128, 130, eye=(154, 60, 96), spread=18)
    save(im, "blossom")


# ── Personas: the late unlocks ───────────────────────────────────────────────
#
# Levels 22-50. Every one of these is a face under headgear, because that is
# what survives the 44px test — a hood, a helmet, a hat. The silhouette does
# the work; the detail inside it is a bonus at full size.


def ninja():
    im, d = canvas()
    disc(d, (74, 82, 106))
    E(d, 128, 142, 82, 84, (38, 42, 58))                                        # hood
    d.polygon([(206, 92), (250, 74), (244, 118)], fill=(206, 58, 58))           # band tail
    d.rounded_rectangle([46, 118, 210, 156], radius=19, fill=(232, 202, 176))   # eye strip
    E(d, 100, 137, 15, 13, (28, 30, 40))
    E(d, 156, 137, 15, 13, (28, 30, 40))
    E(d, 104, 132, 5, 5, (255, 255, 255))
    E(d, 160, 132, 5, 5, (255, 255, 255))
    d.rounded_rectangle([44, 92, 212, 120], radius=12, fill=(206, 58, 58))      # headband
    save(im, "ninja")


def agent():
    im, d = canvas()
    disc(d, (204, 212, 226))
    E(d, 128, 152, 76, 78, (236, 202, 176))                                     # face
    d.line([(104, 194), (152, 194)], fill=(148, 100, 84), width=6)              # flat mouth
    d.rounded_rectangle([56, 114, 200, 150], radius=16, fill=(24, 26, 34))      # shades
    d.rectangle([124, 124, 132, 140], fill=(24, 26, 34))
    E(d, 90, 132, 19, 11, (92, 102, 124))                                       # glint
    d.rounded_rectangle([38, 60, 218, 94], radius=15, fill=(30, 32, 42))        # brim
    d.rounded_rectangle([70, 20, 186, 72], radius=22, fill=(40, 42, 54))        # crown
    d.rounded_rectangle([70, 56, 186, 74], radius=8, fill=(22, 24, 32))         # band
    save(im, "agent")


def samurai():
    im, d = canvas()
    disc(d, (238, 224, 214))
    d.rounded_rectangle([48, 70, 208, 200], radius=46, fill=(62, 68, 90))       # kabuto
    d.polygon([(128, 16), (106, 74), (150, 74)], fill=(224, 174, 60))           # crest
    d.rounded_rectangle([42, 60, 214, 98], radius=16, fill=(48, 54, 72))        # brim
    d.rounded_rectangle([66, 108, 190, 178], radius=26, fill=(232, 198, 172))   # opening
    E(d, 100, 136, 13, 12, (40, 34, 40))
    E(d, 156, 136, 13, 12, (40, 34, 40))
    E(d, 104, 131, 4, 4, (255, 255, 255))
    E(d, 160, 131, 4, 4, (255, 255, 255))
    d.rounded_rectangle([54, 128, 76, 194], radius=11, fill=(48, 54, 72))       # cheek guards
    d.rounded_rectangle([180, 128, 202, 194], radius=11, fill=(48, 54, 72))
    d.rounded_rectangle([86, 170, 170, 212], radius=20, fill=(146, 44, 48))     # menpo
    d.rounded_rectangle([86, 170, 170, 184], radius=7, fill=(112, 32, 36))
    d.line([(96, 196), (160, 196)], fill=(190, 154, 74), width=4)               # gold trim
    save(im, "samurai")


def pirate():
    im, d = canvas()
    disc(d, (220, 232, 242))
    E(d, 128, 150, 78, 78, (238, 200, 170))                                     # face
    E(d, 100, 148, 12, 13, (44, 34, 34))
    E(d, 104, 143, 4, 4, (255, 255, 255))
    d.arc([104, 178, 156, 210], 20, 160, fill=(150, 92, 78), width=5)           # grin
    d.line([(140, 128), (214, 106)], fill=(30, 30, 38), width=6)                # strap
    E(d, 158, 148, 17, 15, (30, 30, 38))                                        # patch
    d.rounded_rectangle([46, 72, 210, 116], radius=18, fill=(190, 54, 54))      # bandana
    d.polygon([(52, 94), (16, 82), (26, 128)], fill=(164, 42, 42))              # knot
    for x in (78, 108, 138, 168):                                               # dots
        E(d, x, 94, 5, 5, (240, 226, 226))
    save(im, "pirate")


def astronaut():
    im, d = canvas()
    disc(d, (204, 222, 244))
    d.rounded_rectangle([34, 114, 58, 158], radius=9, fill=(186, 196, 212))     # pods
    d.rounded_rectangle([198, 114, 222, 158], radius=9, fill=(186, 196, 212))
    d.rounded_rectangle([40, 60, 216, 210], radius=62, fill=(242, 246, 252))    # helmet
    d.rounded_rectangle([58, 92, 198, 180], radius=42, fill=(38, 46, 72))       # visor
    # The glare sits in the corner of the glass. Run it across the middle and it
    # reads as a slash through the face.
    d.rounded_rectangle([74, 104, 108, 126], radius=11, fill=(70, 128, 194))
    E(d, 106, 142, 13, 13, (152, 222, 246))
    E(d, 150, 142, 13, 13, (152, 222, 246))
    d.arc([104, 150, 152, 180], 20, 160, fill=(110, 166, 208), width=5)
    save(im, "astronaut")


def wizard():
    im, d = canvas()
    disc(d, (226, 220, 250))
    E(d, 128, 148, 64, 58, (238, 204, 178))                                     # face
    E(d, 106, 146, 9, 10, (54, 44, 40))
    E(d, 150, 146, 9, 10, (54, 44, 40))
    E(d, 109, 142, 4, 4, (255, 255, 255))
    E(d, 153, 142, 4, 4, (255, 255, 255))
    E(d, 128, 170, 8, 7, (222, 174, 148))                                       # nose
    E(d, 92, 168, 9, 6, (240, 168, 168))                                        # cheeks
    E(d, 164, 168, 9, 6, (240, 168, 168))
    # The beard has to stop at the cheekbones. Any wider and the face it is
    # meant to belong to disappears behind it.
    d.rounded_rectangle([94, 182, 162, 236], radius=30, fill=(240, 242, 248))   # beard
    d.rounded_rectangle([102, 176, 154, 194], radius=9, fill=(226, 230, 240))   # moustache
    d.polygon([(128, 6), (50, 116), (206, 116)], fill=(90, 72, 188))            # hat
    d.rounded_rectangle([34, 104, 222, 136], radius=15, fill=(72, 56, 162))     # brim
    E(d, 150, 64, 8, 8, (250, 214, 96))
    E(d, 106, 88, 6, 6, (250, 214, 96))
    E(d, 168, 96, 5, 5, (250, 214, 96))
    save(im, "wizard")


def knight():
    im, d = canvas()
    disc(d, (216, 226, 238))
    d.polygon([(128, 14), (108, 62), (148, 62)], fill=(202, 62, 62))            # plume
    E(d, 128, 26, 21, 21, (202, 62, 62))
    d.rounded_rectangle([56, 52, 200, 212], radius=52, fill=(174, 184, 202))    # helm
    d.rounded_rectangle([56, 94, 200, 108], radius=6, fill=(144, 154, 174))     # brow
    d.rounded_rectangle([56, 118, 200, 144], radius=8, fill=(44, 50, 64))       # slit
    E(d, 100, 131, 11, 8, (150, 220, 240))
    E(d, 156, 131, 11, 8, (150, 220, 240))
    for y in (164, 182, 200):
        d.rounded_rectangle([102, y, 154, y + 8], radius=4, fill=(68, 76, 92))  # breaths
    save(im, "knight")


def viking():
    im, d = canvas()
    # A cool disc, not a cream one: bone horns on cream vanish at thumbnail size.
    disc(d, (206, 218, 230))
    d.polygon([(70, 108), (8, 32), (28, 122)], fill=(246, 242, 230))            # horns
    d.polygon([(186, 108), (248, 32), (228, 122)], fill=(246, 242, 230))
    d.polygon([(70, 108), (32, 60), (38, 118)], fill=(214, 206, 188))           # horn shade
    d.polygon([(186, 108), (224, 60), (218, 118)], fill=(214, 206, 188))
    E(d, 128, 150, 70, 68, (238, 202, 176))                                     # face
    d.pieslice([54, 40, 202, 176], 180, 360, fill=(148, 156, 172))              # helm dome
    d.rounded_rectangle([54, 96, 202, 124], radius=12, fill=(126, 134, 150))    # helm rim
    d.rectangle([122, 108, 134, 152], fill=(138, 146, 162))                     # nose guard
    E(d, 100, 138, 10, 11, (54, 40, 34))
    E(d, 156, 138, 10, 11, (54, 40, 34))
    E(d, 103, 134, 4, 4, (255, 255, 255))
    E(d, 159, 134, 4, 4, (255, 255, 255))
    d.rounded_rectangle([90, 180, 166, 236], radius=30, fill=(206, 130, 56))    # beard
    d.rounded_rectangle([98, 166, 158, 188], radius=10, fill=(224, 152, 72))    # moustache
    save(im, "viking")


def detective():
    im, d = canvas()
    disc(d, (226, 228, 218))
    E(d, 128, 154, 74, 74, (238, 204, 178))                                     # face
    E(d, 102, 148, 11, 12, (52, 42, 36))
    E(d, 106, 143, 4, 4, (255, 255, 255))
    E(d, 156, 148, 11, 12, (52, 42, 36))
    d.rounded_rectangle([98, 192, 158, 206], radius=7, fill=(88, 72, 56))       # moustache
    d.ellipse([132, 120, 194, 182], outline=(70, 74, 90), width=8)              # monocle
    d.line([(190, 168), (216, 190)], fill=(70, 74, 90), width=5)                # chain
    d.rounded_rectangle([44, 74, 212, 112], radius=18, fill=(136, 114, 88))     # brim
    d.rounded_rectangle([64, 38, 192, 88], radius=22, fill=(156, 132, 102))     # crown
    save(im, "detective")


def dragon():
    im, d = canvas()
    disc(d, (214, 240, 224))
    d.polygon([(76, 68), (56, 12), (110, 54)], fill=(230, 198, 92))             # horns
    d.polygon([(180, 68), (200, 12), (146, 54)], fill=(230, 198, 92))
    E(d, 128, 140, 84, 78, (66, 172, 112))                                      # head
    E(d, 128, 186, 52, 40, (108, 204, 146))                                     # snout
    d.polygon([(98, 206), (110, 228), (122, 206)], fill=(250, 250, 252))        # fangs
    d.polygon([(134, 206), (146, 228), (158, 206)], fill=(250, 250, 252))
    E(d, 112, 184, 6, 8, (32, 90, 60))
    E(d, 144, 184, 6, 8, (32, 90, 60))
    E(d, 100, 126, 15, 17, (250, 244, 214))                                     # eyes
    E(d, 156, 126, 15, 17, (250, 244, 214))
    E(d, 100, 126, 6, 13, (34, 40, 36))                                         # slit pupils
    E(d, 156, 126, 6, 13, (34, 40, 36))
    save(im, "dragon")


def skull():
    im, d = canvas()
    disc(d, (222, 226, 236))
    d.rounded_rectangle([94, 176, 162, 228], radius=18, fill=(246, 246, 250))   # jaw
    E(d, 128, 128, 82, 78, (248, 248, 252))                                     # cranium
    E(d, 98, 128, 24, 26, (38, 40, 52))                                         # sockets
    E(d, 158, 128, 24, 26, (38, 40, 52))
    E(d, 104, 122, 7, 7, (150, 220, 240))
    E(d, 164, 122, 7, 7, (150, 220, 240))
    d.polygon([(128, 156), (114, 180), (142, 180)], fill=(38, 40, 52))          # nose
    d.line([(94, 190), (162, 190)], fill=(198, 202, 214), width=4)
    for x in (110, 128, 146):
        d.line([(x, 190), (x, 218)], fill=(198, 202, 214), width=4)
    save(im, "skull")


def chef():
    im, d = canvas()
    disc(d, (250, 236, 222))
    E(d, 128, 154, 74, 72, (240, 206, 178))                                     # face
    E(d, 102, 144, 10, 11, (56, 42, 36))
    E(d, 154, 144, 10, 11, (56, 42, 36))
    E(d, 105, 140, 4, 4, (255, 255, 255))
    E(d, 157, 140, 4, 4, (255, 255, 255))
    E(d, 84, 172, 10, 7, (244, 168, 168))                                       # blush
    E(d, 172, 172, 10, 7, (244, 168, 168))
    E(d, 108, 182, 22, 12, (88, 66, 52))                                        # moustache
    E(d, 148, 182, 22, 12, (88, 66, 52))
    E(d, 78, 54, 34, 34, (252, 252, 254))                                       # toque
    E(d, 128, 40, 41, 41, (252, 252, 254))
    E(d, 178, 54, 34, 34, (252, 252, 254))
    d.rounded_rectangle([70, 64, 186, 110], radius=12, fill=(246, 246, 251))
    save(im, "chef")


def dj():
    im, d = canvas()
    disc(d, (36, 38, 60))
    E(d, 128, 150, 74, 74, (232, 196, 168))                                     # face
    d.arc([104, 178, 156, 210], 20, 160, fill=(150, 100, 84), width=5)
    d.rounded_rectangle([54, 118, 202, 154], radius=16, fill=(22, 24, 34))      # shades
    d.rectangle([124, 128, 132, 144], fill=(22, 24, 34))
    E(d, 88, 134, 18, 9, (118, 212, 236))
    d.arc([46, 56, 210, 196], 180, 360, fill=(118, 212, 236), width=13)         # band
    d.rounded_rectangle([28, 108, 68, 178], radius=19, fill=(118, 212, 236))    # cups
    d.rounded_rectangle([188, 108, 228, 178], radius=19, fill=(118, 212, 236))
    save(im, "dj")


def cyborg():
    im, d = canvas()
    disc(d, (212, 224, 238))
    E(d, 128, 142, 80, 80, (238, 202, 176))                                     # face
    d.pieslice([48, 62, 208, 222], 270, 90, fill=(154, 164, 184))               # plate
    E(d, 100, 132, 12, 13, (48, 40, 38))                                        # human eye
    E(d, 104, 127, 4, 4, (255, 255, 255))
    d.arc([94, 174, 134, 202], 20, 160, fill=(140, 96, 80), width=5)            # half smile
    d.rounded_rectangle([138, 116, 186, 148], radius=11, fill=(38, 44, 58))     # optic
    E(d, 162, 132, 11, 11, (248, 88, 88))
    E(d, 162, 132, 5, 5, (255, 202, 202))
    for y in (86, 100):
        d.line([(148, y), (192, y)], fill=(124, 134, 154), width=4)             # brow plates
    d.rounded_rectangle([140, 170, 196, 184], radius=6, fill=(124, 134, 154))   # jaw plate
    d.line([(128, 64), (128, 220)], fill=(120, 130, 150), width=3)              # seam
    save(im, "cyborg")


# ── More animals ─────────────────────────────────────────────────────────────


def dog():
    im, d = canvas()
    disc(d, (246, 232, 214))
    d.rounded_rectangle([44, 96, 92, 200], radius=24, fill=(150, 104, 66))     # ears
    d.rounded_rectangle([164, 96, 212, 200], radius=24, fill=(150, 104, 66))
    E(d, 128, 140, 82, 78, (196, 146, 96))                                     # head
    E(d, 128, 182, 46, 36, (240, 216, 190))                                    # muzzle
    E(d, 100, 126, 11, 12, (52, 38, 30))
    E(d, 156, 126, 11, 12, (52, 38, 30))
    E(d, 103, 121, 4, 4, (255, 255, 255))
    E(d, 159, 121, 4, 4, (255, 255, 255))
    E(d, 128, 172, 14, 10, (52, 38, 30))                                       # nose
    d.arc([108, 178, 148, 206], 20, 160, fill=(120, 82, 54), width=5)
    d.rounded_rectangle([118, 198, 138, 224], radius=10, fill=(238, 130, 148)) # tongue
    save(im, "dog")


def wolf():
    im, d = canvas()
    disc(d, (222, 230, 240))
    d.polygon([(60, 100), (74, 34), (114, 84)], fill=(122, 132, 150))          # ears
    d.polygon([(196, 100), (182, 34), (142, 84)], fill=(122, 132, 150))
    d.polygon([(68, 92), (78, 52), (104, 84)], fill=(80, 88, 104))
    d.polygon([(188, 92), (178, 52), (152, 84)], fill=(80, 88, 104))
    E(d, 128, 142, 82, 78, (146, 156, 174))                                    # head
    E(d, 128, 172, 52, 44, (222, 228, 238))                                    # muzzle
    E(d, 100, 128, 12, 11, (240, 196, 64))                                     # eyes
    E(d, 156, 128, 12, 11, (240, 196, 64))
    E(d, 100, 128, 5, 8, (36, 38, 46))
    E(d, 156, 128, 5, 8, (36, 38, 46))
    d.polygon([(128, 162), (114, 178), (142, 178)], fill=(40, 42, 52))         # nose
    d.line([(128, 178), (128, 192)], fill=(120, 128, 142), width=4)
    save(im, "wolf")


def bee():
    im, d = canvas()
    disc(d, (255, 246, 214))
    d.line([(96, 62), (78, 30)], fill=(60, 50, 34), width=6)                   # antennae
    d.line([(160, 62), (178, 30)], fill=(60, 50, 34), width=6)
    E(d, 78, 28, 9, 9, (60, 50, 34))
    E(d, 178, 28, 9, 9, (60, 50, 34))
    E(d, 52, 128, 30, 40, (198, 226, 246))                                     # wings
    E(d, 204, 128, 30, 40, (198, 226, 246))
    E(d, 128, 146, 78, 76, (246, 200, 54))                                     # body
    for y0, y1 in ((176, 196), (206, 220)):                                    # stripes
        d.rounded_rectangle([70, y0, 186, y1], radius=8, fill=(58, 48, 32))
    E(d, 102, 130, 12, 13, (48, 40, 28))
    E(d, 154, 130, 12, 13, (48, 40, 28))
    E(d, 106, 125, 4, 4, (255, 255, 255))
    E(d, 158, 125, 4, 4, (255, 255, 255))
    d.arc([108, 140, 148, 168], 20, 160, fill=(120, 96, 40), width=5)
    save(im, "bee")


def whale():
    im, d = canvas()
    disc(d, (206, 232, 248))
    d.line([(128, 64), (128, 34)], fill=(160, 214, 246), width=8)              # spout
    E(d, 128, 28, 14, 12, (180, 226, 250))
    E(d, 106, 40, 8, 7, (180, 226, 250))
    E(d, 150, 40, 8, 7, (180, 226, 250))
    E(d, 128, 152, 88, 72, (74, 134, 200))                                     # body
    E(d, 128, 186, 62, 40, (206, 230, 246))                                    # belly
    E(d, 102, 136, 12, 13, (30, 44, 66))
    E(d, 156, 136, 12, 13, (30, 44, 66))
    E(d, 106, 131, 4, 4, (255, 255, 255))
    E(d, 160, 131, 4, 4, (255, 255, 255))
    d.arc([104, 158, 152, 190], 20, 160, fill=(30, 44, 66), width=5)
    save(im, "whale")


def shark():
    im, d = canvas()
    disc(d, (204, 226, 238))
    d.polygon([(128, 22), (96, 82), (160, 82)], fill=(96, 116, 136))           # fin
    E(d, 128, 146, 84, 76, (122, 144, 166))                                    # head
    d.chord([44, 150, 212, 230], 0, 180, fill=(238, 242, 246))                 # jaw
    E(d, 100, 126, 12, 12, (32, 38, 48))
    E(d, 156, 126, 12, 12, (32, 38, 48))
    E(d, 104, 121, 4, 4, (255, 255, 255))
    E(d, 160, 121, 4, 4, (255, 255, 255))
    for x in (86, 108, 130, 152, 174):                                         # teeth
        d.polygon([(x - 10, 168), (x, 190), (x + 10, 168)], fill=(255, 255, 255))
    d.line([(52, 166), (204, 166)], fill=(90, 108, 128), width=5)
    save(im, "shark")


def octopus():
    im, d = canvas()
    disc(d, (238, 224, 248))
    for x in (68, 100, 128, 156, 188):                                         # tentacles
        E(d, x, 208, 17, 22, (170, 108, 210))
        E(d, x, 220, 9, 9, (188, 134, 226))
    E(d, 128, 134, 84, 78, (186, 122, 224))                                    # head
    E(d, 100, 128, 17, 18, (255, 255, 255))
    E(d, 156, 128, 17, 18, (255, 255, 255))
    E(d, 102, 130, 8, 9, (48, 32, 62))
    E(d, 158, 130, 8, 9, (48, 32, 62))
    E(d, 84, 158, 10, 7, (240, 168, 200))                                      # blush
    E(d, 172, 158, 10, 7, (240, 168, 200))
    d.arc([110, 154, 146, 180], 20, 160, fill=(80, 44, 100), width=5)
    save(im, "octopus")


def turtle():
    im, d = canvas()
    disc(d, (214, 240, 228))
    E(d, 128, 176, 100, 64, (58, 116, 74))                                     # shell
    for cx, cy in ((80, 180), (128, 168), (176, 180), (104, 208), (152, 208)):
        d.polygon([(cx, cy - 20), (cx + 19, cy - 7), (cx + 12, cy + 16),
                   (cx - 12, cy + 16), (cx - 19, cy - 7)], fill=(120, 176, 98))
    E(d, 128, 118, 72, 66, (150, 204, 124))                                    # head
    E(d, 104, 110, 13, 14, (34, 52, 38))
    E(d, 152, 110, 13, 14, (34, 52, 38))
    E(d, 108, 105, 5, 5, (255, 255, 255))
    E(d, 156, 105, 5, 5, (255, 255, 255))
    E(d, 92, 134, 9, 6, (240, 170, 150))
    E(d, 164, 134, 9, 6, (240, 170, 150))
    d.arc([108, 124, 148, 152], 20, 160, fill=(42, 74, 48), width=5)
    save(im, "turtle")


def dino():
    im, d = canvas()
    disc(d, (222, 242, 220))
    for i, y in enumerate((72, 100, 130)):                                     # back spikes
        d.polygon([(196 - i * 4, y), (232, y - 10), (214, y + 26)], fill=(220, 180, 70))
    E(d, 124, 138, 84, 76, (92, 176, 108))                                     # head
    d.rounded_rectangle([56, 158, 190, 214], radius=26, fill=(120, 198, 128))  # snout
    E(d, 82, 180, 6, 8, (40, 84, 54))
    E(d, 108, 180, 6, 8, (40, 84, 54))
    for x in (70, 96, 122, 148, 172):                                          # teeth
        d.polygon([(x - 9, 214), (x, 232), (x + 9, 214)], fill=(250, 252, 250)) 
    E(d, 104, 122, 14, 15, (250, 250, 244))                                    # eyes
    E(d, 158, 122, 14, 15, (250, 250, 244))
    E(d, 104, 122, 6, 9, (34, 44, 36))
    E(d, 158, 122, 6, 9, (34, 44, 36))
    save(im, "dino")


def unicorn():
    im, d = canvas()
    disc(d, (250, 232, 246))
    d.polygon([(128, 12), (108, 78), (148, 78)], fill=(246, 202, 84))          # horn
    d.line([(116, 46), (140, 40)], fill=(226, 170, 52), width=5)
    d.line([(112, 62), (144, 56)], fill=(226, 170, 52), width=5)
    d.polygon([(74, 108), (58, 56), (108, 88)], fill=(250, 250, 254))          # ears
    d.polygon([(182, 108), (198, 56), (148, 88)], fill=(250, 250, 254))
    d.rounded_rectangle([44, 70, 92, 190], radius=24, fill=(246, 160, 200))    # mane
    d.rounded_rectangle([164, 70, 212, 190], radius=24, fill=(160, 190, 246))
    E(d, 128, 148, 76, 74, (250, 250, 254))                                    # face
    E(d, 128, 192, 30, 20, (248, 236, 242))                                    # muzzle
    E(d, 102, 134, 12, 14, (74, 58, 82))
    E(d, 154, 134, 12, 14, (74, 58, 82))
    E(d, 105, 128, 5, 5, (255, 255, 255))
    E(d, 157, 128, 5, 5, (255, 255, 255))
    E(d, 120, 190, 4, 5, (206, 170, 192))
    E(d, 136, 190, 4, 5, (206, 170, 192))
    E(d, 88, 168, 10, 7, (248, 186, 208))
    E(d, 168, 168, 10, 7, (248, 186, 208))
    save(im, "unicorn")


def deer():
    im, d = canvas()
    disc(d, (244, 232, 214))
    for sx in (-1, 1):                                                         # antlers
        d.line([(128 + sx * 50, 104), (128 + sx * 78, 30)], fill=(146, 104, 60), width=14)
        d.line([(128 + sx * 66, 66), (128 + sx * 108, 52)], fill=(146, 104, 60), width=12)
        d.line([(128 + sx * 74, 44), (128 + sx * 56, 12)], fill=(146, 104, 60), width=12)
        E(d, 128 + sx * 108, 52, 8, 8, (146, 104, 60))
        E(d, 128 + sx * 56, 12, 8, 8, (146, 104, 60))
    E(d, 66, 130, 24, 18, (176, 128, 82))                                      # ears
    E(d, 190, 130, 24, 18, (176, 128, 82))
    E(d, 128, 148, 74, 74, (198, 148, 96))                                     # head
    E(d, 128, 186, 44, 32, (240, 220, 196))                                    # muzzle
    E(d, 102, 134, 11, 12, (56, 40, 30))
    E(d, 154, 134, 11, 12, (56, 40, 30))
    E(d, 105, 129, 4, 4, (255, 255, 255))
    E(d, 157, 129, 4, 4, (255, 255, 255))
    E(d, 128, 176, 12, 9, (60, 44, 34))
    save(im, "deer")


def hedgehog():
    im, d = canvas()
    disc(d, (240, 232, 220))
    spike_ring(d, 128, 132, 60, 116, 11, (122, 88, 60), n=13, phase=182)
    E(d, 128, 140, 78, 74, (150, 110, 76))                                     # head fur
    E(d, 128, 168, 62, 52, (238, 210, 180))                                    # face
    E(d, 108, 158, 10, 11, (52, 38, 28))
    E(d, 148, 158, 10, 11, (52, 38, 28))
    E(d, 111, 153, 4, 4, (255, 255, 255))
    E(d, 151, 153, 4, 4, (255, 255, 255))
    E(d, 128, 190, 12, 9, (48, 34, 26))                                        # nose
    E(d, 92, 180, 9, 6, (240, 170, 176))
    E(d, 164, 180, 9, 6, (240, 170, 176))
    save(im, "hedgehog")


def crab():
    im, d = canvas()
    disc(d, (252, 224, 214))
    E(d, 46, 172, 26, 30, (214, 74, 60))                                       # claws
    E(d, 210, 172, 26, 30, (214, 74, 60))
    d.line([(100, 78), (100, 40)], fill=(214, 74, 60), width=7)                # eye stalks
    d.line([(156, 78), (156, 40)], fill=(214, 74, 60), width=7)
    E(d, 100, 34, 15, 15, (250, 250, 252))
    E(d, 156, 34, 15, 15, (250, 250, 252))
    E(d, 100, 34, 7, 7, (40, 34, 34))
    E(d, 156, 34, 7, 7, (40, 34, 34))
    E(d, 128, 158, 76, 56, (232, 88, 70))                                      # shell
    E(d, 128, 150, 60, 38, (244, 122, 100))
    d.arc([104, 160, 152, 188], 20, 160, fill=(120, 34, 28), width=5)
    E(d, 96, 166, 9, 6, (250, 178, 168))
    E(d, 160, 166, 9, 6, (250, 178, 168))
    for sx in (-1, 1):                                                         # claws, on top
        cx = 128 + sx * 78
        E(d, cx, 176, 26, 24, (214, 70, 58))
        d.polygon([(cx - sx * 6, 158), (cx + sx * 30, 142), (cx + sx * 12, 176)],
                  fill=(232, 96, 82))
    save(im, "crab")


# ── More personas ────────────────────────────────────────────────────────────


def cowboy():
    im, d = canvas()
    disc(d, (240, 222, 200))
    E(d, 128, 154, 74, 74, (238, 202, 172))                                    # face
    E(d, 102, 146, 11, 12, (54, 40, 34))
    E(d, 154, 146, 11, 12, (54, 40, 34))
    E(d, 105, 141, 4, 4, (255, 255, 255))
    E(d, 157, 141, 4, 4, (255, 255, 255))
    d.rounded_rectangle([96, 186, 160, 202], radius=8, fill=(120, 88, 62))     # moustache
    E(d, 128, 84, 108, 26, (150, 104, 60))                                     # brim
    d.rounded_rectangle([80, 30, 176, 92], radius=26, fill=(168, 118, 68))     # crown
    d.rounded_rectangle([80, 66, 176, 88], radius=8, fill=(96, 66, 44))        # band
    save(im, "cowboy")


def pilot():
    im, d = canvas()
    disc(d, (214, 226, 240))
    E(d, 128, 152, 74, 74, (238, 204, 176))                                    # face
    d.arc([104, 178, 152, 208], 20, 160, fill=(150, 100, 82), width=5)
    d.rounded_rectangle([48, 58, 208, 148], radius=42, fill=(132, 96, 62))     # cap
    d.rounded_rectangle([40, 104, 62, 158], radius=12, fill=(112, 80, 52))     # flaps
    d.rounded_rectangle([194, 104, 216, 158], radius=12, fill=(112, 80, 52))
    d.rounded_rectangle([48, 108, 208, 148], radius=18, fill=(72, 82, 100))    # goggles
    E(d, 100, 128, 22, 18, (140, 200, 226))
    E(d, 156, 128, 22, 18, (140, 200, 226))
    E(d, 92, 122, 7, 5, (250, 252, 254))
    E(d, 148, 122, 7, 5, (250, 252, 254))
    save(im, "pilot")


def doctor():
    im, d = canvas()
    disc(d, (222, 240, 240))
    E(d, 128, 148, 76, 74, (240, 208, 180))                                    # face
    E(d, 102, 136, 11, 12, (52, 42, 40))
    E(d, 154, 136, 11, 12, (52, 42, 40))
    E(d, 105, 131, 4, 4, (255, 255, 255))
    E(d, 157, 131, 4, 4, (255, 255, 255))
    d.rounded_rectangle([70, 162, 186, 216], radius=22, fill=(226, 240, 244))  # mask
    d.line([(70, 176), (46, 158)], fill=(200, 218, 224), width=5)
    d.line([(186, 176), (210, 158)], fill=(200, 218, 224), width=5)
    d.rounded_rectangle([54, 62, 202, 116], radius=24, fill=(238, 248, 250))   # cap
    d.polygon([(120, 74), (136, 74), (136, 90), (152, 90), (152, 104),
               (136, 104), (136, 118), (120, 118), (120, 104), (104, 104),
               (104, 90), (120, 90)], fill=(224, 82, 82))                      # cross
    save(im, "doctor")


def scientist():
    im, d = canvas()
    # A darker disc: white hair on a pale one disappeared at thumbnail size.
    disc(d, (108, 130, 158))
    E(d, 128, 150, 78, 76, (240, 208, 180))                                    # face
    d.rounded_rectangle([48, 60, 208, 118], radius=28, fill=(244, 246, 252))   # hair
    E(d, 50, 112, 28, 34, (244, 246, 252))
    E(d, 206, 112, 28, 34, (244, 246, 252))
    d.ellipse([74, 116, 126, 168], outline=(70, 76, 92), width=7)              # glasses
    d.ellipse([130, 116, 182, 168], outline=(70, 76, 92), width=7)
    d.line([(126, 140), (130, 140)], fill=(70, 76, 92), width=7)
    E(d, 100, 142, 8, 9, (48, 40, 38))
    E(d, 156, 142, 8, 9, (48, 40, 38))
    d.arc([106, 176, 150, 204], 20, 160, fill=(150, 100, 82), width=5)
    save(im, "scientist")


def boxer():
    im, d = canvas()
    disc(d, (244, 220, 216))
    E(d, 128, 150, 74, 74, (232, 190, 158))                                    # face
    E(d, 102, 142, 11, 11, (50, 36, 32))
    E(d, 154, 142, 11, 11, (50, 36, 32))
    d.rounded_rectangle([104, 182, 152, 196], radius=7, fill=(140, 84, 70))    # mouth
    d.rounded_rectangle([48, 66, 208, 142], radius=40, fill=(206, 66, 66))     # headgear
    d.rounded_rectangle([84, 108, 172, 150], radius=18, fill=(232, 190, 158))  # opening
    d.rounded_rectangle([40, 100, 70, 168], radius=14, fill=(180, 50, 50))     # cheeks
    d.rounded_rectangle([186, 100, 216, 168], radius=14, fill=(180, 50, 50))
    E(d, 100, 138, 11, 11, (50, 36, 32))
    E(d, 156, 138, 11, 11, (50, 36, 32))
    E(d, 103, 133, 4, 4, (255, 255, 255))
    E(d, 159, 133, 4, 4, (255, 255, 255))
    save(im, "boxer")


def racer():
    im, d = canvas()
    disc(d, (40, 44, 58))
    d.rounded_rectangle([46, 52, 210, 214], radius=64, fill=(226, 62, 62))     # helmet
    d.rounded_rectangle([106, 52, 150, 122], radius=6, fill=(248, 248, 250))   # stripe
    d.rounded_rectangle([58, 118, 198, 176], radius=28, fill=(40, 46, 62))     # visor
    d.rounded_rectangle([74, 130, 112, 150], radius=10, fill=(96, 150, 200))
    E(d, 110, 150, 12, 12, (150, 220, 240))
    E(d, 154, 150, 12, 12, (150, 220, 240))
    d.rounded_rectangle([88, 190, 168, 210], radius=9, fill=(178, 40, 40))     # chin bar
    save(im, "racer")


def sailor():
    im, d = canvas()
    disc(d, (212, 228, 244))
    E(d, 128, 150, 74, 74, (240, 206, 176))                                    # face
    E(d, 102, 142, 11, 12, (48, 44, 60))
    E(d, 154, 142, 11, 12, (48, 44, 60))
    E(d, 105, 137, 4, 4, (255, 255, 255))
    E(d, 157, 137, 4, 4, (255, 255, 255))
    d.arc([104, 172, 152, 202], 20, 160, fill=(150, 100, 82), width=5)
    E(d, 128, 96, 84, 30, (248, 250, 254))                                     # cap
    d.rounded_rectangle([70, 52, 186, 98], radius=22, fill=(250, 252, 255))
    d.rounded_rectangle([70, 82, 186, 98], radius=6, fill=(48, 78, 140))       # band
    d.polygon([(120, 44), (136, 44), (132, 62), (124, 62)], fill=(214, 70, 70))
    save(im, "sailor")


def yeti():
    im, d = canvas()
    disc(d, (120, 158, 190))
    petal_ring(d, 128, 140, 78, 30, (238, 246, 252), n=11)                     # shaggy fur
    E(d, 128, 140, 84, 80, (240, 248, 252))                                    # fur
    E(d, 128, 162, 62, 54, (206, 226, 240))                                    # face
    E(d, 106, 148, 13, 14, (44, 60, 76))
    E(d, 150, 148, 13, 14, (44, 60, 76))
    E(d, 110, 143, 5, 5, (255, 255, 255))
    E(d, 154, 143, 5, 5, (255, 255, 255))
    d.rounded_rectangle([104, 180, 152, 200], radius=9, fill=(70, 92, 112))    # mouth
    d.polygon([(110, 180), (118, 194), (126, 180)], fill=(250, 252, 254))
    d.polygon([(130, 180), (138, 194), (146, 180)], fill=(250, 252, 254))
    save(im, "yeti")


def vampire():
    im, d = canvas()
    disc(d, (222, 214, 236))
    E(d, 128, 152, 74, 74, (236, 232, 240))                                    # pale face
    d.polygon([(46, 96), (128, 128), (210, 96), (210, 64), (46, 64)],
              fill=(34, 32, 44))                                               # widow's peak
    E(d, 128, 78, 84, 40, (34, 32, 44))
    E(d, 102, 144, 11, 12, (206, 62, 74))                                      # red eyes
    E(d, 154, 144, 11, 12, (206, 62, 74))
    E(d, 105, 139, 4, 4, (255, 235, 235))
    E(d, 157, 139, 4, 4, (255, 235, 235))
    d.rounded_rectangle([102, 180, 154, 196], radius=8, fill=(150, 40, 52))    # mouth
    d.polygon([(108, 194), (114, 212), (120, 194)], fill=(252, 252, 254))      # fangs
    d.polygon([(136, 194), (142, 212), (148, 194)], fill=(252, 252, 254))
    save(im, "vampire")


def mummy():
    im, d = canvas()
    # A dark disc: bandages are near-white, and on a cream ground the whole
    # face vanished — the wraps have to be the thing you see.
    disc(d, (92, 84, 68))
    E(d, 128, 142, 84, 82, (214, 202, 172))                                    # head
    for i, y in enumerate(range(66, 222, 21)):                                 # bandages
        x0 = 44 + (12 if i % 2 else 0)
        d.rounded_rectangle([x0, y, x0 + 168, y + 16], radius=8,
                            fill=(248, 243, 226) if i % 2 else (222, 212, 186))
        d.line([(x0, y + 16), (x0 + 168, y + 16)], fill=(176, 164, 138), width=2)
    d.rounded_rectangle([84, 118, 176, 150], radius=13, fill=(38, 36, 34))     # eye slot
    E(d, 150, 134, 13, 12, (188, 216, 120))
    E(d, 153, 130, 5, 5, (255, 255, 255))
    d.polygon([(48, 198), (22, 232), (78, 216)], fill=(248, 243, 226))         # loose end
    save(im, "mummy")


def demon():
    im, d = canvas()
    disc(d, (48, 34, 44))
    d.polygon([(70, 84), (44, 20), (110, 62)], fill=(46, 40, 50))              # horns
    d.polygon([(186, 84), (212, 20), (146, 62)], fill=(46, 40, 50))
    E(d, 128, 146, 82, 78, (198, 62, 58))                                      # face
    E(d, 100, 132, 15, 13, (250, 214, 84))                                     # eyes
    E(d, 156, 132, 15, 13, (250, 214, 84))
    E(d, 100, 132, 6, 10, (56, 26, 26))
    E(d, 156, 132, 6, 10, (56, 26, 26))
    d.polygon([(70, 108), (116, 120), (70, 124)], fill=(140, 34, 34))          # brows
    d.polygon([(186, 108), (140, 120), (186, 124)], fill=(140, 34, 34))
    d.rounded_rectangle([94, 176, 162, 196], radius=9, fill=(74, 24, 26))      # grin
    for x in (104, 122, 140, 154):
        d.polygon([(x - 7, 176), (x, 192), (x + 7, 176)], fill=(250, 246, 240))
    save(im, "demon")


def angel():
    im, d = canvas()
    disc(d, (232, 240, 252))
    d.ellipse([84, 24, 172, 62], outline=(246, 208, 96), width=9)              # halo
    E(d, 60, 140, 30, 40, (250, 252, 255))                                     # wings
    E(d, 196, 140, 30, 40, (250, 252, 255))
    d.rounded_rectangle([56, 74, 200, 140], radius=34, fill=(250, 226, 150))   # hair
    E(d, 128, 152, 72, 72, (246, 214, 190))                                    # face
    d.rounded_rectangle([56, 74, 200, 116], radius=30, fill=(250, 226, 150))
    E(d, 104, 146, 11, 12, (72, 62, 88))
    E(d, 152, 146, 11, 12, (72, 62, 88))
    E(d, 107, 141, 4, 4, (255, 255, 255))
    E(d, 155, 141, 4, 4, (255, 255, 255))
    E(d, 88, 168, 10, 7, (246, 176, 182))
    E(d, 168, 168, 10, 7, (246, 176, 182))
    d.arc([108, 172, 148, 198], 20, 160, fill=(150, 104, 92), width=5)
    save(im, "angel")


def gladiator():
    im, d = canvas()
    disc(d, (236, 226, 208))
    d.rounded_rectangle([104, 10, 152, 64], radius=14, fill=(196, 68, 60))     # crest
    for x in range(108, 150, 12):
        d.line([(x, 12), (x, 62)], fill=(168, 48, 44), width=4)
    E(d, 128, 150, 74, 74, (238, 202, 174))                                    # face
    d.rounded_rectangle([48, 56, 208, 206], radius=54, fill=(196, 160, 94))    # helm
    d.rounded_rectangle([72, 116, 184, 204], radius=30, fill=(238, 202, 174))  # opening
    d.rounded_rectangle([118, 116, 138, 176], radius=8, fill=(196, 160, 94))   # nasal
    d.rounded_rectangle([48, 96, 208, 118], radius=8, fill=(164, 130, 72))     # brow
    E(d, 98, 142, 12, 13, (48, 38, 32))                                        # eyes
    E(d, 158, 142, 12, 13, (48, 38, 32))
    E(d, 101, 137, 4, 4, (255, 255, 255))
    E(d, 161, 137, 4, 4, (255, 255, 255))
    d.line([(104, 186), (152, 186)], fill=(150, 100, 82), width=5)
    save(im, "gladiator")


def monk():
    im, d = canvas()
    disc(d, (244, 230, 210))
    d.rounded_rectangle([44, 96, 212, 236], radius=54, fill=(206, 122, 52))    # robe hood
    E(d, 128, 138, 72, 74, (232, 194, 158))                                    # face
    E(d, 128, 96, 66, 34, (238, 202, 166))                                     # bald crown
    E(d, 104, 134, 10, 5, (60, 44, 34))                                        # calm eyes
    E(d, 152, 134, 10, 5, (60, 44, 34))
    d.arc([108, 148, 148, 176], 20, 160, fill=(140, 96, 74), width=5)
    for i, x in enumerate(range(76, 190, 22)):                                 # beads
        E(d, x, 206 + (6 if i % 2 else 0), 9, 9, (140, 76, 40))
    save(im, "monk")


def jester():
    im, d = canvas()
    disc(d, (240, 226, 246))
    for x, tone in ((56, (198, 62, 96)), (128, (86, 176, 132)), (200, (198, 62, 96))):
        d.polygon([(128, 96), (x, 30), (x + 20, 34)], fill=tone)               # points
        E(d, x + 8, 30, 12, 12, (246, 208, 96))                                # bells
    d.rounded_rectangle([54, 84, 202, 128], radius=20, fill=(120, 84, 190))    # band
    E(d, 128, 158, 74, 70, (242, 210, 182))                                    # face
    E(d, 102, 150, 11, 12, (58, 42, 62))
    E(d, 154, 150, 11, 12, (58, 42, 62))
    E(d, 105, 145, 4, 4, (255, 255, 255))
    E(d, 157, 145, 4, 4, (255, 255, 255))
    E(d, 86, 172, 10, 7, (238, 142, 160))
    E(d, 170, 172, 10, 7, (238, 142, 160))
    d.arc([98, 168, 158, 206], 20, 160, fill=(150, 76, 96), width=6)
    save(im, "jester")


def punk():
    im, d = canvas()
    disc(d, (232, 224, 240))
    d.polygon([(128, 8), (96, 82), (160, 82)], fill=(60, 176, 190))            # mohawk
    d.polygon([(128, 24), (110, 82), (146, 82)], fill=(120, 220, 226))
    d.rounded_rectangle([56, 74, 200, 122], radius=22, fill=(44, 40, 56))      # shaved sides
    E(d, 128, 154, 76, 74, (238, 202, 176))                                    # face
    E(d, 102, 146, 11, 12, (48, 40, 52))
    E(d, 154, 146, 11, 12, (48, 40, 52))
    E(d, 105, 141, 4, 4, (255, 255, 255))
    E(d, 157, 141, 4, 4, (255, 255, 255))
    E(d, 196, 156, 9, 9, (222, 208, 108))                                      # earring
    d.line([(94, 186), (162, 186)], fill=(140, 92, 78), width=6)
    save(im, "punk")


def pharaoh():
    im, d = canvas()
    disc(d, (236, 224, 196))
    # The nemes falls beside the face rather than over it — two lappets, not a
    # hood. Drawn first so the face sits in front of them.
    d.polygon([(42, 224), (56, 84), (96, 84), (86, 224)], fill=(58, 96, 178))
    d.polygon([(214, 224), (200, 84), (160, 84), (170, 224)], fill=(58, 96, 178))
    for x0, x1 in ((48, 62), (66, 80), (176, 190), (194, 208)):
        d.line([(x0 + 4, 92), (x1 - 6, 218)], fill=(222, 186, 74), width=8)
    E(d, 128, 150, 68, 70, (226, 178, 128))                                    # face
    d.rounded_rectangle([48, 60, 208, 98], radius=14, fill=(222, 186, 74))     # band
    d.polygon([(128, 30), (114, 62), (142, 62)], fill=(200, 158, 56))          # cobra
    E(d, 128, 28, 12, 12, (200, 158, 56))
    E(d, 104, 142, 12, 13, (44, 34, 30))
    E(d, 152, 142, 12, 13, (44, 34, 30))
    E(d, 107, 137, 4, 4, (255, 255, 255))
    E(d, 155, 137, 4, 4, (255, 255, 255))
    d.line([(108, 178), (148, 178)], fill=(150, 104, 76), width=5)
    d.polygon([(116, 196), (140, 196), (134, 226), (122, 226)], fill=(52, 44, 40))
    save(im, "pharaoh")


def zombie():
    im, d = canvas()
    disc(d, (214, 226, 208))
    E(d, 128, 146, 82, 78, (146, 186, 122))                                    # face
    d.rounded_rectangle([48, 72, 208, 112], radius=18, fill=(76, 62, 54))      # hair
    E(d, 102, 134, 16, 17, (250, 250, 244))                                    # eyes
    E(d, 158, 130, 11, 12, (250, 250, 244))
    E(d, 104, 136, 6, 6, (40, 46, 38))
    E(d, 158, 130, 5, 5, (40, 46, 38))
    d.line([(150, 168), (178, 168)], fill=(88, 128, 78), width=4)              # stitches
    for x in range(152, 180, 8):
        d.line([(x, 160), (x, 176)], fill=(88, 128, 78), width=4)
    d.rounded_rectangle([94, 186, 158, 204], radius=8, fill=(70, 58, 52))      # mouth
    d.polygon([(100, 186), (106, 200), (112, 186)], fill=(244, 246, 236))
    d.polygon([(136, 186), (142, 200), (148, 186)], fill=(244, 246, 236))
    save(im, "zombie")


# ── The expanded set ─────────────────────────────────────────────────────────
#
# Everything above is drawn one face at a time, which is the right way to make
# thirty of something and the wrong way to make a hundred and fifty. These are
# built from a parts vocabulary instead: the PARTS are designed here — ear
# shapes, eye styles, muzzles, headgear — and each character is one line naming
# which parts it wears and in what colours.
#
# The construction is deliberately identical to the hand-drawn set: a tinted
# disc, flat fills, no gradients, no outlines, and the same tier tells (flowers
# are radially symmetric, animals have ears, personas have headgear). A
# generated fox has to sit beside the drawn one without looking like it came
# from somewhere else.


def _named(fn, name):
    """The main loop and the contact sheet both read `fn.__name__`."""
    fn.__name__ = name
    return fn


def shade(c, f):
    """Same hue, different light. `f` below 1 darkens, above 1 lifts."""
    return tuple(max(0, min(255, int(v * f))) for v in c)


# ── Flowers ──────────────────────────────────────────────────────────────────

def bloom(name, bg, petal, inner, core, n=8, style="round", eye=(70, 46, 44), blush=None):
    def draw():
        im, d = canvas()
        disc(d, bg)
        if style == "round":
            petal_ring(d, 128, 128, 62, 36, petal, n=n, phase=22)
            petal_ring(d, 128, 128, 34, 30, inner, n=max(5, n - 2))
        elif style == "spike":
            spike_ring(d, 128, 128, 46, 112, 13, petal, n=n)
            spike_ring(d, 128, 128, 44, 96, 15, inner, n=n, phase=180.0 / n)
        elif style == "lean":
            # Leaning petals need a shoulder, so they go through rot_petal.
            # The orbit has to clear the petal's own half-width or they merge
            # into one disc and the flower loses its shape entirely — which is
            # exactly what the first pass did.
            for i in range(n):
                a = i * 360.0 / n
                rad = math.radians(a)
                rot_petal(im, 128 + 70 * math.cos(rad), 128 + 70 * math.sin(rad),
                          38, 78, -a, petal)
            petal_ring(d, 128, 128, 34, 24, inner, n=max(5, n - 2))
        elif style == "wide":
            petal_ring(d, 128, 128, 66, 42, petal, n=n, phase=18)
            petal_ring(d, 128, 128, 30, 34, inner, n=max(4, n - 4))
        E(d, 128, 128, 46, 46, core)
        smiley(d, 128, 132, eye=eye, spread=20, blush=blush)
        save(im, name)
    return _named(draw, name)


MORE_FLOWERS = [bloom(*a) for a in [
    ("iris",       (232, 226, 250), (108,  78, 178), (138, 106, 206), (196, 176, 240), 6, "lean"),
    ("poppy",      (255, 226, 220), (214,  56,  52), (238,  92,  78), (250, 158, 132), 7, "round"),
    ("orchid",     (245, 226, 244), (166,  74, 158), (196, 108, 186), (232, 168, 218), 5, "lean"),
    ("dahlia",     (255, 232, 222), (222,  96,  46), (240, 132,  74), (252, 186, 132), 12, "spike"),
    ("peony",      (255, 230, 238), (216,  88, 130), (238, 126, 162), (250, 176, 198), 10, "round"),
    ("marigold",   (255, 240, 208), (232, 146,  26), (248, 178,  54), (252, 214, 120), 14, "spike"),
    ("jasmine",    (226, 216, 186), (250, 246, 228), (255, 252, 242), (246, 206,  92), 5, "wide"),
    ("camellia",   (255, 228, 232), (198,  54,  84), (224,  90, 118), (244, 158, 172), 8, "round"),
    ("zinnia",     (255, 236, 216), (240, 118,  60), (250, 152,  92), (252, 202, 136), 16, "spike"),
    ("aster",      (234, 232, 252), (118, 110, 200), (150, 142, 220), (204, 200, 244), 18, "spike"),
    ("violet",     (238, 230, 250), (126,  84, 176), (154, 112, 200), (206, 180, 234), 5, "lean"),
    ("freesia",    (255, 248, 224), (246, 208,  74), (250, 224, 120), (252, 240, 186), 6, "wide"),
    ("hibiscus",   (255, 224, 226), (226,  48,  74), (244,  88, 108), (252, 172, 128), 5, "wide"),
    ("magnolia",   (214, 190, 204), (250, 238, 244), (255, 248, 252), (216, 150, 108), 7, "lean"),
]]


# ── Animals ──────────────────────────────────────────────────────────────────

def creature(name, bg, fur, face="round", ear="round", eye="big", muzzle=None,
             nose=None, extra=None, ink=(36, 34, 46), accent=None):
    """One animal, from parts.

    The first pass of this varied colour and almost nothing else, and every
    result read as the same bear in a different coat — which fails the only test
    that matters, the 44px one. So SILHOUETTE is what varies most here: the head
    shape, the ears and the snout are all chosen per animal, and no two share
    the same pair. Colour is the last thing to differ, not the first.
    """
    def draw():
        im, d = canvas()
        disc(d, bg)
        dark = shade(fur, 0.80)
        inner = accent or shade(fur, 1.24)

        # ── Ears, behind the head so the head overlaps their base.
        if ear == "round":
            E(d, 68, 58, 38, 38, dark); E(d, 188, 58, 38, 38, dark)
            E(d, 68, 60, 20, 20, inner); E(d, 188, 60, 20, 20, inner)
        elif ear == "point":
            d.polygon([(40, 112), (66, 8), (124, 76)], fill=dark)
            d.polygon([(216, 112), (190, 8), (132, 76)], fill=dark)
            d.polygon([(60, 96), (74, 40), (106, 78)], fill=inner)
            d.polygon([(196, 96), (182, 40), (150, 78)], fill=inner)
        elif ear == "long":
            E(d, 90, 34, 22, 62, dark); E(d, 166, 34, 22, 62, dark)
            E(d, 90, 36, 11, 44, inner); E(d, 166, 36, 11, 44, inner)
        elif ear == "side":
            E(d, 30, 138, 30, 42, dark); E(d, 226, 138, 30, 42, dark)
        elif ear == "flop":
            E(d, 44, 118, 26, 52, dark); E(d, 212, 118, 26, 52, dark)
        elif ear == "tuft":
            d.polygon([(54, 86), (62, 14), (102, 68)], fill=dark)
            d.polygon([(202, 86), (194, 14), (154, 68)], fill=dark)
        elif ear == "horn":
            d.polygon([(84, 64), (52, 6), (114, 48)], fill=inner)
            d.polygon([(172, 64), (204, 6), (142, 48)], fill=inner)
        elif ear == "antler":
            for sx in (-1, 1):
                d.line([(128 + sx * 40, 74), (128 + sx * 62, 18)], fill=inner, width=11)
                d.line([(128 + sx * 52, 44), (128 + sx * 82, 30)], fill=inner, width=9)
                d.line([(128 + sx * 58, 30), (128 + sx * 46, 4)], fill=inner, width=9)
        elif ear == "crest":
            d.polygon([(128, 2), (96, 62), (160, 62)], fill=inner)
            d.polygon([(96, 20), (74, 70), (120, 58)], fill=dark)
            d.polygon([(160, 20), (182, 70), (136, 58)], fill=dark)

        # ── Head. This is the part that does the work at thumbnail size.
        if face == "round":
            E(d, 128, 142, 92, 84, fur)
        elif face == "wide":
            E(d, 128, 148, 104, 72, fur)
        elif face == "tall":
            E(d, 128, 136, 76, 96, fur)
        elif face == "blocky":
            d.rounded_rectangle([38, 76, 218, 216], radius=42, fill=fur)
        elif face == "snout":
            E(d, 128, 128, 88, 76, fur)
            E(d, 128, 190, 44, 36, muzzle or shade(fur, 1.18))
        elif face == "beaky":
            E(d, 128, 132, 84, 82, fur)

        # ── Markings.
        if extra == "mane":
            for i in range(15):
                a = math.radians(i * 360.0 / 15)
                E(d, 128 + int(106 * math.cos(a)), 142 + int(98 * math.sin(a)), 24, 24, dark)
            E(d, 128, 142, 86, 78, fur)
            if face == "snout":            # the redraw above buried it
                E(d, 128, 190, 44, 36, muzzle or shade(fur, 1.18))
        elif extra == "stripes":
            for x, h in ((86, 44), (128, 54), (170, 44)):
                d.rounded_rectangle([x - 8, 68, x + 8, 68 + h], radius=8, fill=dark)
        elif extra == "spots":
            for cx, cy, r in ((80, 116, 15), (176, 124, 13), (104, 182, 12), (166, 178, 14)):
                E(d, cx, cy, r, r - 2, dark)
        elif extra == "mask":
            d.rounded_rectangle([56, 112, 200, 164], radius=26, fill=dark)
        elif extra == "patch":
            E(d, 92, 130, 30, 32, dark)

        # ── Eyes.
        ey = 120 if face == "snout" else 136
        if eye == "big":
            E(d, 100, ey, 17, 18, ink); E(d, 156, ey, 17, 18, ink)
            E(d, 105, ey - 6, 6, 6, (255, 255, 255)); E(d, 161, ey - 6, 6, 6, (255, 255, 255))
        elif eye == "dot":
            E(d, 102, ey, 10, 11, ink); E(d, 154, ey, 10, 11, ink)
        elif eye == "sleepy":
            d.arc([84, ey - 12, 118, ey + 16], 190, 350, fill=ink, width=7)
            d.arc([138, ey - 12, 172, ey + 16], 190, 350, fill=ink, width=7)
        elif eye == "wide":
            E(d, 98, ey, 22, 22, (255, 255, 255)); E(d, 158, ey, 22, 22, (255, 255, 255))
            E(d, 101, ey + 2, 11, 11, ink); E(d, 161, ey + 2, 11, 11, ink)

        # ── Snout, nose, mouth.
        if muzzle and face != "snout":
            E(d, 128, 184, 44, 32, muzzle)
        if nose:
            ny = 176 if face == "snout" else 174
            E(d, 128, ny, 14, 11, nose)
            d.arc([106, ny + 4, 150, ny + 34], 20, 160, fill=nose, width=5)

        if extra == "beak":
            d.polygon([(102, 166), (154, 166), (128, 212)], fill=(244, 178, 60))
        elif extra == "longbeak":
            d.polygon([(100, 158), (152, 158), (126, 232)], fill=(240, 148, 52))
        elif extra == "tusk":
            E(d, 98, 202, 8, 20, (250, 248, 240)); E(d, 158, 202, 8, 20, (250, 248, 240))
        elif extra == "trunk":
            d.rounded_rectangle([114, 168, 142, 228], radius=14, fill=shade(fur, 0.9))
        save(im, name)
    return _named(draw, name)


# No two share a face+ear pair — that combination IS the silhouette, and the
# silhouette is the whole of what survives being shrunk to a 44px circle.
MORE_ANIMALS = [creature(*a) for a in [
    # name          bg                 fur              face      ear       eye       muzzle           nose             extra
    ("otter",     (218, 236, 240), (128,  92,  66), "snout",  "side",   "big",    (232, 214, 190), ( 62,  46,  38)),
    ("lynx",      (232, 236, 244), (198, 176, 150), "tall",   "tuft",   "wide",   (240, 230, 216), ( 78,  62,  54), "spots"),
    ("badger",    (234, 234, 240), ( 74,  74,  86), "tall",   "round",  "big",    (238, 238, 244), ( 40,  38,  48), "stripes"),
    ("raccoon",   (226, 230, 240), (150, 154, 170), "wide",   "point",  "big",    (232, 234, 242), ( 48,  46,  58), "mask"),
    ("squirrel",  (250, 232, 214), (196, 118,  58), "tall",   "tuft",   "big",    (246, 226, 202), ( 88,  56,  34)),
    ("hamster",   (252, 238, 216), (232, 190, 128), "wide",   "side",   "dot",    (250, 234, 214), (120,  80,  48)),
    ("mouse",     (238, 236, 244), (176, 178, 192), "tall",   "side",   "dot",    (240, 240, 246), (198, 128, 140)),
    ("goat",      (240, 240, 236), (232, 230, 224), "snout",  "horn",   "sleepy", (246, 246, 242), (120, 112, 104)),
    ("sheep",     (244, 244, 248), (248, 248, 250), "blocky", "flop",   "dot",    None,            (108, 104, 112)),
    ("cow",       (240, 242, 240), (248, 248, 250), "snout",  "side",   "big",    (244, 210, 206), (196, 132, 132), "spots"),
    ("horse",     (240, 232, 226), (150, 102,  66), "snout",  "point",  "big",    (206, 168, 132), ( 74,  52,  36), "mane"),
    ("zebra",     (240, 240, 244), (250, 250, 252), "snout",  "long",   "big",    (240, 240, 244), ( 48,  46,  56), "stripes"),
    ("giraffe",   (252, 240, 212), (244, 198, 106), "tall",   "horn",   "big",    (250, 226, 178), (128,  86,  40), "spots"),
    ("elephant",  (232, 234, 240), (162, 168, 184), "blocky", "side",   "big",    None,            None,            "trunk"),
    ("rhino",     (234, 234, 238), (150, 152, 164), "blocky", "round",  "sleepy", (198, 200, 210), ( 84,  86,  96), "tusk"),
    ("hippo",     (238, 232, 240), (170, 142, 178), "blocky", "round",  "dot",    (214, 190, 218), (110,  84, 118)),
    ("camel",     (250, 238, 214), (216, 176, 120), "snout",  "flop",   "sleepy", (244, 226, 196), (128,  94,  56)),
    ("llama",     (246, 242, 232), (238, 228, 208), "tall",   "long",   "big",    (248, 242, 230), (120, 100,  80)),
    ("sloth",     (238, 238, 230), (176, 158, 132), "round",  "flop",   "sleepy", (232, 220, 200), ( 96,  82,  64), "mask"),
]]


# ── Food: the common tier ────────────────────────────────────────────────────
#
# Not faces. That is the point of them — twenty items in a grid of a hundred and
# fifty heads is the fastest way to make the common shelf feel like a different
# thing from the rare one, and a slice of pizza is legible at 44px in a way a
# fourteenth brown animal is not.

def food(name, bg, painter):
    def draw():
        im, d = canvas()
        disc(d, bg)
        painter(im, d)
        save(im, name)
    return _named(draw, name)


def _pizza(im, d):
    d.polygon([(128, 216), (44, 74), (212, 74)], fill=(246, 206, 118))       # cheese
    d.polygon([(128, 200), (58, 82), (198, 82)], fill=(244, 186, 92))
    d.rounded_rectangle([40, 56, 216, 92], radius=18, fill=(214, 160, 92))   # crust
    for cx, cy in ((104, 118), (156, 122), (128, 168)):
        E(d, cx, cy, 15, 14, (204, 62, 58))


def _burger(im, d):
    d.chord([44, 52, 212, 148], 180, 360, fill=(232, 176, 96))               # top bun
    for x in (96, 128, 160):
        E(d, x, 78, 5, 4, (250, 236, 206))                                   # seeds
    d.rounded_rectangle([40, 106, 216, 130], radius=11, fill=(122, 190, 96))  # lettuce
    d.rounded_rectangle([46, 126, 210, 160], radius=13, fill=(122, 78, 52))   # patty
    d.rounded_rectangle([42, 156, 214, 178], radius=10, fill=(240, 196, 72))  # cheese
    d.rounded_rectangle([44, 174, 212, 212], radius=19, fill=(224, 166, 88))  # base


def _sushi(im, d):
    E(d, 128, 150, 78, 58, (250, 248, 244))                                   # rice
    d.rounded_rectangle([100, 90, 156, 210], radius=6, fill=(52, 62, 60))     # nori
    d.rounded_rectangle([46, 88, 210, 128], radius=16, fill=(238, 122, 84))   # salmon
    for x in (72, 120, 168):
        d.rounded_rectangle([x, 94, x + 22, 122], radius=8, fill=(246, 168, 132))


def _donut(im, d):
    E(d, 128, 134, 92, 90, (222, 168, 106))
    E(d, 128, 128, 92, 88, (246, 146, 178))                                   # icing
    E(d, 128, 134, 32, 30, (243, 244, 250))                                   # hole
    for cx, cy, c in ((80, 100, (250, 232, 96)), (168, 108, (122, 210, 232)),
                      (96, 176, (140, 226, 150)), (172, 170, (250, 240, 120)),
                      (128, 74, (154, 212, 250))):
        d.rounded_rectangle([cx, cy, cx + 20, cy + 8], radius=4, fill=c)


def _icecream(im, d):
    d.polygon([(80, 132), (176, 132), (128, 226)], fill=(216, 164, 96))       # cone
    for i in range(3):
        d.line([(90 + i * 18, 138), (128 + i * 12, 210)], fill=(190, 138, 76), width=4)
    E(d, 100, 118, 42, 40, (246, 158, 186))
    E(d, 158, 118, 42, 40, (152, 214, 236))
    E(d, 128, 84, 44, 42, (250, 232, 140))


def _coffee(im, d):
    d.ellipse([182, 116, 232, 172], outline=(238, 240, 246), width=13)        # handle
    d.rounded_rectangle([44, 100, 196, 216], radius=22, fill=(248, 250, 252))
    d.rounded_rectangle([44, 100, 196, 132], radius=14, fill=(214, 84, 68))   # sleeve
    d.rounded_rectangle([62, 148, 178, 184], radius=12, fill=(120, 78, 52))   # brew
    for x, y in ((104, 56), (140, 46)):
        d.arc([x, y, x + 30, y + 44], 100, 300, fill=(206, 212, 226), width=6)


def _cupcake(im, d):
    d.polygon([(66, 136), (190, 136), (172, 220), (84, 220)], fill=(232, 196, 148))
    for x in range(76, 182, 20):
        d.line([(x, 140), (x + 6, 216)], fill=(206, 166, 118), width=5)
    E(d, 96, 122, 34, 32, (246, 158, 186))                                    # frosting
    E(d, 160, 122, 34, 32, (246, 158, 186))
    E(d, 128, 96, 38, 36, (250, 186, 208))
    E(d, 128, 58, 15, 15, (214, 62, 74))                                      # cherry


def _taco(im, d):
    d.chord([36, 84, 220, 232], 180, 360, fill=(244, 204, 118))               # shell
    d.rounded_rectangle([50, 140, 206, 162], radius=10, fill=(120, 192, 100))  # lettuce
    d.rounded_rectangle([56, 154, 200, 180], radius=10, fill=(150, 92, 62))    # meat
    for cx in (86, 128, 170):
        E(d, cx, 178, 12, 9, (226, 76, 66))                                    # salsa
    d.chord([36, 84, 220, 200], 180, 360, outline=(224, 178, 96), width=7)


def _ramen(im, d):
    d.chord([34, 96, 222, 232], 180, 360, fill=(226, 236, 240))               # bowl
    d.rounded_rectangle([34, 96, 222, 122], radius=12, fill=(196, 210, 220))
    for x in range(56, 200, 24):                                              # noodles
        d.arc([x, 118, x + 26, 150], 180, 360, fill=(248, 226, 150), width=7)
    E(d, 96, 134, 24, 20, (250, 250, 246))                                    # egg
    E(d, 96, 134, 12, 10, (246, 190, 78))
    d.rounded_rectangle([150, 118, 190, 146], radius=8, fill=(214, 130, 98))   # chashu
    d.line([(170, 44), (206, 108)], fill=(160, 116, 78), width=7)              # chopsticks
    d.line([(192, 40), (222, 106)], fill=(160, 116, 78), width=7)


def _fries(im, d):
    for x, h in ((78, 46), (100, 28), (122, 20), (144, 30), (166, 50)):
        d.rounded_rectangle([x, h, x + 20, 168], radius=8, fill=(248, 208, 96))
    d.polygon([(62, 128), (194, 128), (176, 226), (80, 226)], fill=(216, 66, 62))
    d.rounded_rectangle([84, 150, 172, 176], radius=9, fill=(240, 236, 232))


def _hotdog(im, d):
    d.rounded_rectangle([32, 120, 224, 188], radius=34, fill=(234, 186, 108))
    d.rounded_rectangle([28, 132, 228, 172], radius=20, fill=(206, 96, 74))    # sausage
    pts = []
    for i in range(9):
        pts.append((48 + i * 20, 140 if i % 2 else 160))
    d.line(pts, fill=(248, 214, 78), width=8, joint="curve")                   # mustard


def _pretzel(im, d):
    for cx, cy, r in ((88, 150, 44), (168, 150, 44), (128, 96, 40)):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(176, 116, 62), width=20)
    d.rounded_rectangle([98, 178, 158, 200], radius=11, fill=(176, 116, 62))
    for x, y in ((92, 78), (164, 82), (128, 62), (72, 138), (186, 142)):
        E(d, x, y, 4, 4, (248, 246, 238))                                      # salt


def _avocado(im, d):
    E(d, 128, 140, 76, 92, (94, 140, 62))
    E(d, 128, 140, 62, 78, (196, 216, 120))
    E(d, 128, 152, 34, 36, (140, 96, 52))


def _watermelon(im, d):
    d.chord([26, 40, 230, 244], 180, 360, fill=(78, 158, 84))
    d.chord([38, 52, 218, 232], 180, 360, fill=(246, 246, 240))
    d.chord([48, 62, 208, 222], 180, 360, fill=(232, 84, 92))
    for x, y in ((96, 108), (160, 108), (128, 140), (86, 152), (170, 152)):
        E(d, x, y, 7, 10, (48, 42, 46))


def _strawberry(im, d):
    d.chord([46, 60, 210, 224], 0, 180, fill=(224, 58, 66))
    d.rounded_rectangle([46, 100, 210, 150], radius=40, fill=(224, 58, 66))
    for x, y in ((96, 120), (156, 118), (128, 150), (86, 162), (168, 160), (128, 96)):
        E(d, x, y, 6, 8, (250, 226, 150))
    d.polygon([(128, 34), (78, 82), (178, 82)], fill=(84, 162, 76))            # calyx
    d.rounded_rectangle([120, 22, 136, 56], radius=7, fill=(70, 138, 64))


def _banana(im, d):
    d.arc([40, 44, 216, 220], 30, 160, fill=(246, 206, 74), width=44)
    d.arc([40, 44, 216, 220], 30, 160, fill=(250, 226, 128), width=18)
    E(d, 52, 118, 12, 14, (150, 116, 52))


def _egg(im, d):
    E(d, 128, 148, 96, 74, (250, 250, 246))
    E(d, 78, 118, 34, 28, (250, 250, 246))
    E(d, 186, 172, 30, 24, (250, 250, 246))
    E(d, 128, 142, 40, 38, (248, 194, 66))


def _boba(im, d):
    d.polygon([(58, 84), (198, 84), (182, 226), (74, 226)], fill=(240, 226, 202))
    d.polygon([(66, 146), (190, 146), (182, 226), (74, 226)], fill=(198, 152, 108))
    for x, y in ((92, 190), (124, 202), (156, 190), (108, 212), (146, 214), (172, 200)):
        E(d, x, y, 13, 13, (58, 44, 40))                                       # pearls
    d.rounded_rectangle([48, 70, 208, 92], radius=10, fill=(226, 208, 180))     # lid
    d.rounded_rectangle([140, 20, 162, 108], radius=10, fill=(232, 108, 128))   # straw


def _popcorn(im, d):
    for cx, cy, r in ((88, 92, 26), (128, 68, 28), (168, 90, 25),
                      (104, 62, 20), (152, 58, 19), (128, 104, 22)):
        E(d, cx, cy, r, r - 2, (250, 246, 226))
        E(d, cx - 6, cy - 6, r // 2, r // 2, (240, 232, 200))
    d.polygon([(62, 118), (194, 118), (176, 226), (80, 226)], fill=(228, 232, 238))
    for i, x in enumerate(range(62, 194, 22)):
        if i % 2 == 0:
            d.polygon([(x, 118), (x + 22, 118), (x + 14, 226), (x + 6, 226)], fill=(214, 66, 62))


def _cherry(im, d):
    d.arc([100, 40, 200, 140], 160, 280, fill=(96, 152, 70), width=8)
    d.arc([70, 40, 160, 140], 250, 20, fill=(96, 152, 70), width=8)
    d.polygon([(128, 46), (176, 30), (150, 66)], fill=(84, 162, 76))           # leaf
    E(d, 88, 168, 44, 44, (208, 44, 58))
    E(d, 172, 176, 40, 40, (186, 36, 50))
    E(d, 74, 154, 12, 10, (246, 152, 160))


FOOD = [food(*a) for a in [
    ("pizza",      (255, 238, 214), _pizza),      ("burger",     (252, 236, 212), _burger),
    ("sushi",      (238, 244, 246), _sushi),      ("donut",      (252, 232, 240), _donut),
    ("icecream",   (250, 238, 244), _icecream),   ("coffee",     (240, 232, 226), _coffee),
    ("cupcake",    (252, 234, 240), _cupcake),    ("taco",       (252, 240, 216), _taco),
    ("ramen",      (240, 240, 240), _ramen),      ("fries",      (252, 236, 216), _fries),
    ("hotdog",     (252, 238, 220), _hotdog),     ("pretzel",    (246, 236, 220), _pretzel),
    ("avocado",    (236, 246, 226), _avocado),    ("watermelon", (250, 234, 234), _watermelon),
    ("strawberry", (252, 230, 232), _strawberry), ("banana",     (254, 246, 214), _banana),
    ("egg",        (224, 216, 200), _egg),        ("boba",       (244, 236, 226), _boba),
    ("popcorn",    (238, 216, 214), _popcorn),    ("cherry",     (250, 230, 232), _cherry),
]]


# ── Personas ─────────────────────────────────────────────────────────────────

def figure(name, bg, skin, gear, gear_color, accent=None, ink=(40, 34, 40), beard=None):
    def draw():
        im, d = canvas()
        disc(d, bg)
        trim = accent or shade(gear_color, 0.78)

        if gear == "hood":
            E(d, 128, 142, 84, 86, gear_color)
            E(d, 128, 152, 62, 66, skin)
        elif gear == "helm":
            d.rounded_rectangle([48, 66, 208, 198], radius=44, fill=gear_color)
            d.rounded_rectangle([44, 58, 212, 96], radius=16, fill=trim)
            d.rounded_rectangle([68, 110, 188, 180], radius=26, fill=skin)
        elif gear == "cap":
            E(d, 128, 152, 78, 80, skin)
            d.rounded_rectangle([40, 82, 216, 112], radius=14, fill=trim)
            d.rounded_rectangle([64, 38, 192, 90], radius=26, fill=gear_color)
        elif gear == "crown":
            E(d, 128, 152, 78, 80, skin)
            d.polygon([(56, 90), (56, 40), (86, 66), (128, 26), (170, 66), (200, 40), (200, 90)],
                      fill=gear_color)
            d.rounded_rectangle([54, 84, 202, 106], radius=9, fill=trim)
        elif gear == "band":
            E(d, 128, 150, 80, 82, skin)
            d.rounded_rectangle([44, 92, 212, 122], radius=13, fill=gear_color)
            d.polygon([(206, 96), (250, 78), (244, 122)], fill=trim)
        elif gear == "wrap":
            E(d, 128, 148, 82, 84, gear_color)
            d.rounded_rectangle([50, 116, 206, 158], radius=20, fill=skin)
        elif gear == "hat":
            E(d, 128, 154, 78, 78, skin)
            d.polygon([(20, 96), (236, 96), (128, 12)], fill=gear_color)
            d.rounded_rectangle([16, 90, 240, 116], radius=13, fill=trim)
        elif gear == "visor":
            E(d, 128, 150, 80, 82, skin)
            d.rounded_rectangle([50, 112, 206, 152], radius=18, fill=gear_color)
            d.rounded_rectangle([62, 120, 118, 144], radius=10, fill=trim)
        elif gear == "horns":
            E(d, 128, 150, 80, 82, skin)
            d.polygon([(72, 78), (44, 18), (108, 62)], fill=gear_color)
            d.polygon([(184, 78), (212, 18), (148, 62)], fill=gear_color)
        elif gear == "halo":
            E(d, 128, 154, 78, 78, skin)
            d.ellipse([76, 20, 180, 58], outline=gear_color, width=11)

        if gear in ("hood", "wrap"):
            E(d, 106, 146, 13, 13, ink)
            E(d, 150, 146, 13, 13, ink)
            E(d, 110, 141, 4, 4, (255, 255, 255))
            E(d, 154, 141, 4, 4, (255, 255, 255))
        elif gear == "visor":
            pass  # the visor is the face
        else:
            E(d, 102, 148, 14, 15, ink)
            E(d, 154, 148, 14, 15, ink)
            E(d, 107, 142, 5, 5, (255, 255, 255))
            E(d, 159, 142, 5, 5, (255, 255, 255))
            if beard:
                d.chord([76, 150, 180, 232], 0, 180, fill=beard)
            else:
                d.arc([104, 176, 152, 206], 20, 160, fill=shade(skin, 0.62), width=5)
        save(im, name)
    return _named(draw, name)


# ── The premium tier ─────────────────────────────────────────────────────────
#
# Twenty legendaries, ten collections of two. They can only come out of a chest,
# so they have to look like it from across the room — which is what `halo` is
# for: a struck ring and an outer glow that nothing in the other three tiers
# wears. The tell is the frame, not just the face, because a player scrolling a
# shelf reads the frame first.

def halo(d, ring, glow):
    """The premium frame — an outer bloom, then a struck rim."""
    d.ellipse([2, 2, S - 2, S - 2], fill=glow)
    d.ellipse([10, 10, S - 10, S - 10], fill=ring)
    d.ellipse([16, 16, S - 16, S - 16], outline=(255, 255, 255, 60), width=2)


def legend(name, glow, ring, painter):
    def draw():
        im, d = canvas()
        halo(d, ring, glow)
        painter(im, d)
        save(im, name)
    return _named(draw, name)


def _eyes_glow(d, c, y=146, r=13):
    E(d, 100, y, r, r, c)
    E(d, 156, y, r, r, c)
    E(d, 100, y, r - 5, r - 5, (255, 255, 255))
    E(d, 156, y, r - 5, r - 5, (255, 255, 255))


def _visor(d, band, glow, y=124, h=34):
    d.rounded_rectangle([46, y, 210, y + h], radius=15, fill=band)
    d.rounded_rectangle([56, y + 8, 200, y + h - 10], radius=9, fill=glow)


# Cyberpunk Legends
def _cyber_oni(im, d):
    E(d, 128, 148, 84, 86, (44, 38, 62))                                       # mask
    d.polygon([(70, 74), (40, 16), (110, 58)], fill=(232, 60, 138))            # horns
    d.polygon([(186, 74), (216, 16), (146, 58)], fill=(232, 60, 138))
    _visor(d, (28, 24, 44), (60, 244, 232), y=118, h=32)
    d.rounded_rectangle([86, 186, 170, 206], radius=9, fill=(232, 60, 138))    # grin plate
    for x in range(94, 168, 18):
        d.line([(x, 186), (x, 206)], fill=(28, 24, 44), width=4)


def _neon_runner(im, d):
    E(d, 128, 152, 78, 80, (38, 34, 56))                                       # hood
    d.rounded_rectangle([44, 92, 212, 124], radius=14, fill=(24, 22, 40))
    _visor(d, (22, 20, 36), (250, 78, 200), y=126, h=30)
    for x in (60, 196):                                                        # cheek lines
        d.line([(x, 152), (x, 190)], fill=(60, 244, 232), width=5)
    d.line([(80, 206), (176, 206)], fill=(60, 244, 232), width=5)


# Celestial Gods
def _sun_deity(im, d):
    spike_ring(d, 128, 128, 92, 126, 8, (250, 206, 78), n=16)
    E(d, 128, 138, 74, 76, (252, 226, 150))                                    # face
    d.rounded_rectangle([54, 60, 202, 84], radius=11, fill=(240, 178, 48))     # diadem
    E(d, 128, 60, 17, 17, (255, 246, 208))
    _eyes_glow(d, (240, 168, 40), y=142)
    d.arc([104, 168, 152, 200], 20, 160, fill=(214, 148, 44), width=6)


def _moon_deity(im, d):
    for x, y, r in ((52, 58, 5), (206, 70, 4), (70, 196, 4), (198, 186, 5), (128, 34, 4)):
        E(d, x, y, r, r, (250, 250, 255))                                      # stars
    E(d, 128, 150, 78, 78, (226, 234, 250))                                    # face
    E(d, 128, 62, 40, 40, (244, 246, 252))                                     # crescent
    E(d, 146, 56, 34, 34, (62, 74, 132))                                       # bitten out
    d.rounded_rectangle([56, 94, 200, 116], radius=10, fill=(178, 196, 240))   # diadem
    _eyes_glow(d, (120, 146, 226), y=150)
    d.arc([104, 174, 152, 204], 20, 160, fill=(150, 168, 216), width=6)


# Shadow Assassins
def _shadow_blade(im, d):
    E(d, 128, 148, 84, 86, (54, 52, 72))                                       # hood
    d.rounded_rectangle([48, 118, 208, 156], radius=17, fill=(16, 16, 26))
    E(d, 156, 138, 15, 12, (226, 44, 68))                                      # one eye
    E(d, 160, 134, 5, 5, (255, 220, 226))
    d.line([(180, 32), (240, 100)], fill=(226, 232, 246), width=11)            # blade
    d.line([(180, 40), (196, 24)], fill=(90, 90, 106), width=9)


def _void_stalker(im, d):
    E(d, 128, 146, 84, 86, (30, 22, 48))
    E(d, 128, 140, 58, 60, (16, 12, 28))                                       # void
    for r, c in ((44, (78, 42, 140)), (30, (126, 74, 200)), (16, (196, 158, 250))):
        d.ellipse([128 - r, 140 - r, 128 + r, 140 + r], outline=c, width=4)
    d.polygon([(74, 76), (52, 24), (108, 62)], fill=(78, 42, 140))
    d.polygon([(182, 76), (204, 24), (148, 62)], fill=(78, 42, 140))


# Dragon Masters
def _dragon_lord(im, d):
    d.polygon([(66, 82), (18, 14), (114, 60)], fill=(214, 168, 62))            # horns
    d.polygon([(190, 82), (238, 14), (142, 60)], fill=(214, 168, 62))
    E(d, 128, 150, 84, 84, (52, 96, 78))                                       # helm
    for cx, cy in ((92, 108), (128, 96), (164, 108), (110, 132), (146, 132)):
        E(d, cx, cy, 13, 11, (74, 128, 100))                                   # scales
    d.rounded_rectangle([48, 128, 208, 164], radius=15, fill=(30, 58, 50))
    _eyes_glow(d, (250, 186, 62), y=146, r=12)
    d.rounded_rectangle([54, 62, 202, 84], radius=10, fill=(214, 168, 62))


def _scale_rider(im, d):
    E(d, 128, 150, 82, 84, (46, 82, 108))
    for j, y in enumerate((100, 128, 156)):                                    # scale rows
        for x in range(70 + (j % 2) * 16, 196, 32):
            d.chord([x, y, x + 30, y + 26], 180, 360, fill=(66, 112, 144))
    d.polygon([(78, 74), (56, 22), (116, 56)], fill=(226, 130, 60))
    d.polygon([(178, 74), (200, 22), (140, 56)], fill=(226, 130, 60))
    _eyes_glow(d, (250, 160, 60), y=152, r=12)


# Mythical Guardians
def _phoenix_guard(im, d):
    spike_ring(d, 128, 118, 74, 128, 11, (240, 126, 44), n=11)
    spike_ring(d, 128, 118, 70, 108, 13, (250, 176, 62), n=11, phase=16)
    E(d, 128, 152, 66, 68, (246, 220, 176))                                    # face
    d.polygon([(128, 74), (96, 122), (160, 122)], fill=(226, 84, 42))          # crest
    _eyes_glow(d, (214, 78, 40), y=152, r=12)


def _griffin_ward(im, d):
    for sx in (-1, 1):                                                         # wings
        for i, (dx, dy, w) in enumerate(((44, 30, 30), (60, 62, 26), (52, 94, 22))):
            x = 128 + sx * dx
            E(d, x, 74 + dy, w, w - 6, (150, 132, 96) if i % 2 else (176, 156, 116))
    E(d, 128, 142, 76, 78, (238, 228, 200))                                    # head
    d.rounded_rectangle([56, 70, 200, 98], radius=13, fill=(198, 160, 74))     # circlet
    E(d, 128, 46, 13, 13, (226, 86, 66))
    _eyes_glow(d, (176, 132, 54), y=134, r=12)
    d.polygon([(108, 168), (148, 168), (128, 208)], fill=(240, 186, 66))       # beak
    d.line([(108, 180), (148, 180)], fill=(206, 154, 48), width=4)


# Royal Dynasty
def _emperor(im, d):
    E(d, 128, 156, 78, 78, (238, 202, 172))
    d.polygon([(48, 92), (48, 30), (82, 62), (128, 16), (174, 62), (208, 30), (208, 92)],
              fill=(240, 196, 62))
    d.rounded_rectangle([46, 86, 210, 112], radius=10, fill=(214, 164, 44))
    for x in (68, 128, 188):
        E(d, x, 50, 9, 9, (216, 62, 82))                                       # jewels
    E(d, 102, 152, 13, 14, (48, 38, 40)); E(d, 154, 152, 13, 14, (48, 38, 40))
    d.chord([88, 168, 168, 226], 0, 180, fill=(96, 76, 62))                    # beard


def _maharaja(im, d):
    E(d, 128, 160, 76, 76, (216, 168, 128))
    d.chord([34, 44, 222, 190], 180, 360, fill=(240, 232, 220))                # turban
    for y in (78, 96, 112):
        d.arc([38, 44, 218, 190], 182, 358, fill=(222, 208, 190), width=5)
    E(d, 128, 74, 17, 17, (196, 52, 76))                                       # jewel
    d.polygon([(128, 20), (116, 58), (140, 58)], fill=(240, 196, 62))          # plume
    E(d, 104, 156, 13, 14, (52, 36, 34)); E(d, 152, 156, 13, 14, (52, 36, 34))
    d.chord([94, 176, 162, 216], 0, 180, fill=(64, 46, 40))


# Steampunk Elite
def _brass_captain(im, d):
    E(d, 128, 158, 76, 76, (238, 204, 174))
    d.rounded_rectangle([56, 34, 200, 96], radius=14, fill=(72, 58, 46))       # top hat
    d.rounded_rectangle([32, 86, 224, 112], radius=12, fill=(58, 46, 38))
    d.rounded_rectangle([56, 74, 200, 94], radius=7, fill=(196, 146, 62))      # band
    E(d, 96, 128, 26, 26, (198, 150, 66)); E(d, 160, 128, 26, 26, (198, 150, 66))
    E(d, 96, 128, 17, 17, (108, 158, 172)); E(d, 160, 128, 17, 17, (108, 158, 172))
    d.rounded_rectangle([118, 122, 138, 134], radius=5, fill=(198, 150, 66))
    d.chord([100, 176, 156, 214], 0, 180, fill=(120, 92, 66))


def _gear_baron(im, d):
    for cx, cy, r in ((60, 66, 26), (200, 76, 22)):                            # cogs
        spike_ring(d, cx, cy, r - 6, r + 6, 22, (176, 132, 58), n=8)
        E(d, cx, cy, r - 8, r - 8, (206, 162, 76))
    E(d, 128, 152, 78, 80, (240, 206, 176))
    d.rounded_rectangle([60, 88, 196, 110], radius=9, fill=(120, 92, 60))      # brow strap
    E(d, 158, 146, 27, 27, (186, 142, 60))                                     # monocle
    E(d, 158, 146, 19, 19, (168, 206, 214))
    E(d, 100, 146, 13, 14, (52, 40, 36))
    d.chord([98, 172, 158, 214], 0, 180, fill=(126, 96, 68))


# Arcane Mages
def _archmage(im, d):
    E(d, 128, 158, 74, 74, (238, 206, 178))
    d.polygon([(20, 104), (236, 104), (128, 4)], fill=(74, 58, 152))           # hat
    d.rounded_rectangle([16, 96, 240, 122], radius=13, fill=(58, 44, 128))
    for x, y, r in ((92, 62, 6), (150, 48, 5), (128, 82, 5), (176, 78, 4)):
        E(d, x, y, r, r, (250, 226, 120))                                      # stars
    _eyes_glow(d, (140, 110, 226), y=152, r=12)
    d.chord([88, 176, 168, 226], 0, 180, fill=(224, 224, 232))


def _rune_weaver(im, d):
    E(d, 128, 150, 82, 84, (52, 44, 88))                                       # hood
    E(d, 128, 158, 58, 60, (30, 26, 52))
    _eyes_glow(d, (120, 240, 206), y=154, r=12)
    for a in range(0, 360, 45):                                                # orbiting runes
        rad = math.radians(a)
        x, y = 128 + 88 * math.cos(rad), 128 + 88 * math.sin(rad)
        d.rounded_rectangle([x - 8, y - 8, x + 8, y + 8], radius=3,
                            outline=(120, 240, 206), width=3)


# Space Commanders
def _star_admiral(im, d):
    E(d, 128, 158, 76, 76, (238, 204, 176))
    d.rounded_rectangle([48, 78, 208, 108], radius=12, fill=(34, 44, 78))      # cap
    d.rounded_rectangle([36, 100, 220, 124], radius=11, fill=(24, 32, 60))     # brim
    d.rounded_rectangle([70, 44, 186, 86], radius=18, fill=(44, 56, 96))
    d.polygon([(128, 50), (118, 74), (94, 74), (114, 88), (106, 112),
               (128, 98), (150, 112), (142, 88), (162, 74), (138, 74)],
              fill=(244, 202, 78))                                             # star
    E(d, 102, 152, 13, 14, (44, 36, 38)); E(d, 154, 152, 13, 14, (44, 36, 38))


def _nova_captain(im, d):
    d.rounded_rectangle([28, 106, 54, 156], radius=9, fill=(198, 206, 224))
    d.rounded_rectangle([202, 106, 228, 156], radius=9, fill=(198, 206, 224))
    d.rounded_rectangle([36, 48, 220, 216], radius=68, fill=(238, 242, 250))   # helmet
    d.rounded_rectangle([50, 74, 206, 190], radius=54, fill=(22, 18, 48))      # visor
    for x, y, r in ((92, 108, 4), (150, 96, 5), (168, 140, 4), (110, 150, 3)):
        E(d, x, y, r, r, (250, 248, 255))                                      # stars
    E(d, 128, 132, 44, 38, (140, 84, 210))                                     # nebula
    E(d, 114, 122, 24, 20, (216, 128, 232))
    d.rounded_rectangle([70, 66, 130, 78], radius=6, fill=(255, 255, 255))     # glare


# Samurai Shoguns
def _demon_shogun(im, d):
    d.rounded_rectangle([44, 64, 212, 200], radius=44, fill=(58, 42, 52))      # kabuto
    d.polygon([(128, 6), (100, 66), (156, 66)], fill=(238, 190, 66))           # crest
    d.rounded_rectangle([38, 54, 218, 94], radius=16, fill=(44, 32, 40))
    E(d, 128, 152, 66, 62, (198, 54, 52))                                      # oni mask
    _eyes_glow(d, (250, 232, 120), y=140, r=12)
    d.rounded_rectangle([88, 172, 168, 200], radius=10, fill=(150, 34, 38))
    for x in range(96, 166, 16):
        d.polygon([(x, 172), (x + 12, 172), (x + 6, 196)], fill=(250, 246, 236))
    d.rounded_rectangle([46, 122, 70, 194], radius=11, fill=(44, 32, 40))
    d.rounded_rectangle([186, 122, 210, 194], radius=11, fill=(44, 32, 40))


def _oni_daimyo(im, d):
    d.rounded_rectangle([44, 66, 212, 202], radius=44, fill=(34, 40, 62))
    for sx in (-1, 1):                                                         # wing crest
        d.polygon([(128 + sx * 34, 60), (128 + sx * 96, 8), (128 + sx * 74, 70)],
                  fill=(216, 176, 78))
    d.rounded_rectangle([38, 56, 218, 96], radius=16, fill=(26, 32, 52))
    E(d, 128, 154, 64, 62, (232, 226, 214))                                    # menpo
    _eyes_glow(d, (196, 60, 72), y=142, r=12)
    d.rounded_rectangle([90, 176, 166, 202], radius=10, fill=(60, 52, 70))
    d.rounded_rectangle([46, 124, 70, 196], radius=11, fill=(26, 32, 52))
    d.rounded_rectangle([186, 124, 210, 196], radius=11, fill=(26, 32, 52))


LEGENDARY = [legend(*a) for a in [
    ("cyber-oni",     ( 92,  28,  74), ( 52,  20,  52), _cyber_oni),
    ("neon-runner",   ( 84,  24,  86), ( 44,  20,  56), _neon_runner),
    ("sun-deity",     (250, 214, 128), (252, 236, 186), _sun_deity),
    ("moon-deity",    (108, 124, 190), ( 62,  74, 132), _moon_deity),
    ("shadow-blade",  ( 58,  30,  40), ( 30,  22,  32), _shadow_blade),
    ("void-stalker",  ( 74,  40, 128), ( 40,  24,  70), _void_stalker),
    ("dragon-lord",   (196, 152,  58), (108, 128,  92), _dragon_lord),
    ("scale-rider",   ( 76, 128, 160), ( 44,  84, 116), _scale_rider),
    ("phoenix-guard", (250, 168,  72), (240, 118,  46), _phoenix_guard),
    ("griffin-ward",  (216, 186, 108), (238, 226, 194), _griffin_ward),
    ("emperor",       (240, 196,  62), (196, 46,  70),  _emperor),
    ("maharaja",      (238, 190,  70), (176, 42,  74),  _maharaja),
    ("brass-captain", (198, 150,  66), (110,  86,  62), _brass_captain),
    ("gear-baron",    (206, 162,  76), (128, 100,  66), _gear_baron),
    ("archmage",      (128,  98, 216), ( 66,  50, 140), _archmage),
    ("rune-weaver",   ( 92, 200, 176), ( 44,  62, 100), _rune_weaver),
    ("star-admiral",  (244, 202,  78), ( 40,  52,  90), _star_admiral),
    ("nova-captain",  (150,  96, 220), ( 58,  50, 110), _nova_captain),
    ("demon-shogun",  (208,  70,  66), (100,  36,  46), _demon_shogun),
    ("oni-daimyo",    (216, 176,  78), ( 48,  56,  84), _oni_daimyo),
]]


MORE_PERSONAS = [figure(*a) for a in [
    # ── The seven professions the named list was missing, plus the five
    #    archetypes (witch, assassin, android, superhero, villain) that had no
    #    art. Everything else in that list already existed.
    ("farmer",     (246, 240, 218), (232, 190, 148), "hat",   (222, 186, 106)),
    ("firefighter",(252, 232, 228), (238, 202, 172), "helm",  (206,  56,  52), (244, 210, 96)),
    ("police",     (228, 234, 246), (238, 202, 172), "cap",   ( 44,  58, 104), (222, 190, 74)),
    ("soldier",    (232, 238, 226), (226, 190, 152), "helm",  ( 96, 114,  76)),
    ("nurse",      (240, 246, 250), (240, 206, 176), "cap",   (250, 250, 252), (214,  62,  66)),
    ("mechanic",   (238, 238, 232), (232, 194, 158), "visor", ( 74,  92, 128), (206, 214, 226)),
    ("barista",    (240, 232, 224), (238, 202, 172), "cap",   (108,  76,  56)),
    ("witch",      (236, 230, 246), (196, 216, 172), "hat",   ( 62,  48, 104)),
    ("assassin",   (228, 228, 236), (232, 194, 160), "hood",  ( 40,  42,  58)),
    ("android",    (234, 240, 244), (214, 222, 232), "visor", (150, 162, 180), (110, 214, 226)),
    ("superhero",  (232, 238, 250), (238, 202, 172), "visor", (198,  52,  60), (250, 216,  96)),
    ("villain",    (236, 232, 240), (188, 202, 170), "hood",  ( 62,  44,  86)),
    # name          bg                 skin             gear     gear colour       accent
]]


FLOWERS = [rose, sunflower, daisy, tulip, lotus, blossom]
ANIMALS = [panda, fox, frog, owl, cat, penguin, bear, koala, tiger, alien,
           pig, lion, rabbit, robot, monkey, dog, wolf, bee, whale, shark, octopus, turtle, dino, unicorn, deer,
           hedgehog, crab]
PERSONAS = [ninja, agent, samurai, pirate, astronaut, wizard, knight, viking,
            detective, dragon, skull, chef, dj, cyborg,
            cowboy, pilot, doctor, scientist, boxer, racer, sailor, yeti,
            vampire, mummy, demon, angel, gladiator, monk, jester, punk,
            pharaoh, zombie]

AVATARS = (FLOWERS + MORE_FLOWERS
           + ANIMALS + MORE_ANIMALS
           + PERSONAS + MORE_PERSONAS
           + FOOD + LEGENDARY)


# ── Banners ──────────────────────────────────────────────────────────────────

BW, BH = 720, 320


def banner(name, bg, painter):
    im = Image.new("RGB", (BW, BH), bg)
    painter(ImageDraw.Draw(im))
    im.save(os.path.join(BN_DIR, f"{name}.png"), optimize=True)
    print(" banner", name)


def dots(color, r=9, step=44, offset=True):
    def paint(d):
        for j, y in enumerate(range(-r, BH + step, step)):
            xs = range(-r + (step // 2 if offset and j % 2 else 0), BW + step, step)
            for x in xs:
                d.ellipse([x - r, y - r, x + r, y + r], fill=color)
    return paint


def stripes(color, w=34, gap=54):
    def paint(d):
        for x in range(-BH, BW + BH, w + gap):
            d.polygon([(x, BH), (x + BH, 0), (x + BH + w, 0), (x + w, BH)], fill=color)
    return paint


def triangles(color, size=34, step=86):
    def paint(d):
        for j, y in enumerate(range(10, BH, step)):
            for x in range(20 + (step // 2 if j % 2 else 0), BW, step):
                d.polygon([(x, y + size), (x + size / 2, y), (x + size, y + size)], fill=color)
    return paint


def rings(color, step=68):
    def paint(d):
        for y in range(-20, BH + 40, step):
            for x in range(-20, BW + 40, step * 2):
                xx = x + (step if (y // step) % 2 else 0)
                d.ellipse([xx - 22, y - 22, xx + 22, y + 22], outline=color, width=7)
    return paint


def peaks(color, base=None):
    def paint(d):
        b = base or BH
        for i, (w, h) in enumerate(((280, 210), (240, 260), (300, 180), (260, 235))):
            x = -60 + i * 190
            d.polygon([(x, b), (x + w / 2, b - h), (x + w, b)], fill=color)
    return paint


def chevrons(color, size=46, step=92):
    def paint(d):
        for j, y in enumerate(range(-size, BH + step, step)):
            for x in range(-size + (step // 2 if j % 2 else 0), BW + step, step):
                d.polygon([(x, y + size), (x + size / 2, y), (x + size, y + size),
                           (x + size, y + size - 12), (x + size / 2, y + 12), (x, y + size - 12)],
                          fill=color)
    return paint


def grid(color, step=56, w=6):
    def paint(d):
        for x in range(0, BW + step, step):
            d.rectangle([x, 0, x + w, BH], fill=color)
        for y in range(0, BH + step, step):
            d.rectangle([0, y, BW, y + w], fill=color)
    return paint


def waves(color, amp=18, step=54, w=7):
    def paint(d):
        for y in range(-amp, BH + step, step):
            pts = [(x, y + amp * math.sin(x / 46.0)) for x in range(0, BW + 8, 8)]
            d.line(pts, fill=color, width=w, joint="curve")
    return paint


def diamonds(color, size=30, step=78):
    def paint(d):
        for j, y in enumerate(range(0, BH + step, step)):
            for x in range(0 + (step // 2 if j % 2 else 0), BW + step, step):
                d.polygon([(x, y - size), (x + size, y), (x, y + size), (x - size, y)], fill=color)
    return paint


def confetti(color, r=7):
    """Deterministic scatter — a seeded shuffle, so a rerun is byte-identical."""
    def paint(d):
        seed = 1
        for i in range(150):
            seed = (seed * 1103515245 + 12345) % 2147483648
            x = seed % BW
            seed = (seed * 1103515245 + 12345) % 2147483648
            y = seed % BH
            seed = (seed * 1103515245 + 12345) % 2147483648
            a = seed % 90
            p = Image.new("RGBA", (r * 3, r * 3), (0, 0, 0, 0))
            ImageDraw.Draw(p).rectangle([0, r, r * 3, r * 2], fill=color)
            p = p.rotate(a, expand=True, resample=Image.BICUBIC)
            d._image.paste(p, (x, y), p)
    return paint


def bars(color, w=26, gap=44):
    def paint(d):
        for x in range(0, BW + w + gap, w + gap):
            d.rectangle([x, 0, x + w, BH], fill=color)
    return paint


def arcs(color, step=90, w=8):
    def paint(d):
        for y in range(-40, BH + step, step):
            for x in range(-40, BW + step, step):
                d.arc([x, y, x + step, y + step], 180, 360, fill=color, width=w)
    return paint


def scales(color, r=42, step=64):
    def paint(d):
        for j, y in enumerate(range(-r, BH + step, step // 2)):
            for x in range(-r + (step // 2 if j % 2 else 0), BW + step, step):
                d.arc([x, y, x + r * 2, y + r * 2], 180, 360, fill=color, width=6)
    return paint


# ── The fifty ────────────────────────────────────────────────────────────────
#
# Eight were drawn by hand; the rest are the same eight constructions in other
# colours, plus five more patterns. A banner is a field and a texture, so the
# only thing that has to be designed per banner is the pair of tones — and the
# pattern tone is always derived from the field rather than picked, which is
# what keeps all fifty in the same register instead of a few shouting.

def tonal(bg, f=0.86):
    return shade(bg, f)


_FIELDS = [
    ("indigo",   ( 72,  74, 158)), ("plum",     (108,  60, 132)),
    ("wine",     (124,  40,  62)), ("rust",     (176,  78,  44)),
    ("amber",    (222, 152,  40)), ("olive",    (108, 122,  54)),
    ("moss",     ( 62, 116,  76)), ("pine",     ( 34,  86,  74)),
    ("lagoon",   ( 30, 122, 138)), ("steel",    ( 74,  96, 122)),
    ("slate",    ( 66,  72,  92)), ("ink",      ( 34,  38,  56)),
    ("cocoa",    ( 92,  66,  54)), ("sand",     (206, 176, 126)),
    ("rose",     (214, 106, 128)), ("coral",    (232, 118,  92)),
    ("mint",     ( 92, 176, 148)), ("sky",      ( 96, 152, 206)),
    ("orchid",   (166, 106, 186)), ("ember",    (198,  70,  62)),
    ("jade",     ( 46, 140, 112)),
]

_PATTERNS = [
    ("dots", lambda c: dots(c)), ("stripes", lambda c: stripes(c)),
    ("tri", lambda c: triangles(c)), ("rings", lambda c: rings(c)),
    ("peaks", lambda c: peaks(c)), ("chevrons", lambda c: chevrons(c)),
    ("grid", lambda c: grid(c)), ("waves", lambda c: waves(c)),
    ("diamonds", lambda c: diamonds(c)), ("confetti", lambda c: confetti(c)),
    ("bars", lambda c: bars(c)), ("arcs", lambda c: arcs(c)),
    ("scales", lambda c: scales(c)),
]

BANNERS = [
    ("grape-dots", (93, 74, 140), dots((82, 64, 126))),
    ("night-dots", (30, 27, 41), dots((41, 37, 56))),
    ("coral-stripes", (240, 112, 90), stripes((232, 98, 76))),
    ("teal-tri", (18, 140, 140), triangles((14, 122, 122))),
    ("gold-tri", (232, 168, 56), triangles((214, 148, 40))),
    ("forest-rings", (28, 106, 74), rings((22, 90, 62))),
    ("berry-stripes", (172, 62, 118), stripes((156, 50, 104))),
    ("midnight-peaks", (28, 32, 54), peaks((38, 44, 72))),
]

# Field i takes pattern i, walking both lists at different rates so no two
# neighbours share either. Light fields get a darker texture and dark fields a
# lighter one, so the pattern is always legible without ever being loud.
for _i, (_fname, _bg) in enumerate(_FIELDS):
    for _k in range(2):
        _pname, _make = _PATTERNS[(_i * 2 + _k) % len(_PATTERNS)]
        _light = sum(_bg) / 3 > 128
        BANNERS.append((f"{_fname}-{_pname}", _bg, _make(tonal(_bg, 0.84 if _light else 1.28))))

BANNERS = BANNERS[:43]
# ── Premium banners ──────────────────────────────────────────────────────────
#
# Seven, one per legendary avatar family that needs a field to sit on. They get
# what the other forty-three do not: a vertical gradient under the pattern and a
# vignette over it, so a legendary banner is reads as richer before the
# pattern is even identified.

def grad(im, top, bottom):
    d = ImageDraw.Draw(im)
    for y in range(BH):
        f = y / (BH - 1)
        d.line([(0, y), (BW, y)],
               fill=tuple(int(top[i] + (bottom[i] - top[i]) * f) for i in range(3)))


def vignette(im, strength=90):
    v = Image.new("L", (BW, BH), 0)
    dv = ImageDraw.Draw(v)
    for i in range(24):
        a = int(strength * (1 - i / 24))
        dv.rectangle([i * 3, i * 2, BW - i * 3, BH - i * 2], outline=a, width=3)
    im.paste(Image.new("RGB", (BW, BH), (0, 0, 0)), (0, 0), v)


def premium_banner(name, top, bottom, painter):
    im = Image.new("RGB", (BW, BH), top)
    grad(im, top, bottom)
    painter(im, ImageDraw.Draw(im))
    vignette(im)
    im.save(os.path.join(BN_DIR, f"{name}.png"), optimize=True)
    print(" banner", name, "(premium)")


def _b_neon(im, d):
    for x in range(0, BW + 60, 60):
        d.line([(x, 0), (x - 120, BH)], fill=(58, 226, 226), width=3)
    for y in range(40, BH, 52):
        d.line([(0, y), (BW, y)], fill=(232, 52, 158), width=3)


def _b_cosmic(im, d):
    seed = 7
    for _ in range(120):
        seed = (seed * 1103515245 + 12345) % 2147483648; x = seed % BW
        seed = (seed * 1103515245 + 12345) % 2147483648; y = seed % BH
        seed = (seed * 1103515245 + 12345) % 2147483648; r = 1 + seed % 3
        d.ellipse([x - r, y - r, x + r, y + r], fill=(250, 250, 255))
    for cx, cy, r, c in ((180, 150, 96, (108, 62, 186)), (540, 110, 74, (62, 96, 196))):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c)


def _b_void(im, d):
    for r in range(40, 420, 46):
        d.ellipse([360 - r, 160 - r, 360 + r, 160 + r], outline=(122, 74, 200), width=5)


def _b_scale(im, d):
    for j, y in enumerate(range(-30, BH + 60, 34)):
        for x in range(-40 + (j % 2) * 40, BW + 80, 80):
            d.chord([x, y, x + 76, y + 68], 180, 360, fill=(46, 108, 84))
            d.arc([x, y, x + 76, y + 68], 180, 360, fill=(212, 174, 74), width=4)


def _b_phoenix(im, d):
    for i, x in enumerate(range(-40, BW + 120, 118)):
        h = 190 + (i % 3) * 46
        d.polygon([(x, BH), (x + 58, BH - h), (x + 116, BH)], fill=(238, 122, 40))
        d.polygon([(x + 28, BH), (x + 58, BH - h * 0.6), (x + 88, BH)], fill=(250, 194, 74))


def _b_royal(im, d):
    for j, y in enumerate(range(-20, BH + 60, 62)):
        for x in range(-20 + (j % 2) * 46, BW + 80, 92):
            d.polygon([(x, y + 30), (x + 30, y), (x + 60, y + 30), (x + 30, y + 60)],
                      fill=(196, 154, 56))
            d.polygon([(x + 12, y + 30), (x + 30, y + 12), (x + 48, y + 30), (x + 30, y + 48)],
                      fill=(150, 34, 52))


def _b_brass(im, d):
    for cx, cy, r in ((120, 96, 78), (400, 220, 96), (630, 90, 66)):
        for i in range(12):
            a = math.radians(i * 30)
            d.line([(cx + (r - 22) * math.cos(a), cy + (r - 22) * math.sin(a)),
                    (cx + r * math.cos(a), cy + r * math.sin(a))],
                   fill=(184, 138, 62), width=13)
        d.ellipse([cx - r + 20, cy - r + 20, cx + r - 20, cy + r - 20],
                  outline=(184, 138, 62), width=11)


PREMIUM_BANNERS = [
    ("neon-grid",   ( 34,  18,  58), ( 12,  10,  28), _b_neon),
    ("cosmic-veil", ( 26,  26,  64), (  8,  10,  30), _b_cosmic),
    ("void-rift",   ( 24,  14,  40), (  6,   4,  16), _b_void),
    ("dragon-hide", ( 30,  70,  56), ( 12,  34,  30), _b_scale),
    ("phoenix-fire",(126,  36,  18), ( 42,  14,  10), _b_phoenix),
    ("royal-crest", (108,  22,  40), ( 44,  10,  22), _b_royal),
    ("brass-works", ( 74,  50,  30), ( 30,  20,  14), _b_brass),
]




if __name__ == "__main__":
    os.makedirs(AV_DIR, exist_ok=True)
    os.makedirs(BN_DIR, exist_ok=True)
    for fn in AVATARS:
        fn()
    for name, bg, painter in BANNERS:
        banner(name, bg, painter)
    for name, top, bottom, painter in PREMIUM_BANNERS:
        premium_banner(name, top, bottom, painter)

    # contact sheet for a quick look
    rows = (len(AVATARS) + 4) // 5
    sheet = Image.new("RGB", (S * 5, S * rows + BH * 2), (245, 245, 250))
    for i, fn in enumerate(AVATARS):
        im = Image.open(os.path.join(AV_DIR, f"{fn.__name__}.png"))
        sheet.paste(im, ((i % 5) * S, (i // 5) * S), im)
    off = S * rows
    for i, (name, _, _) in enumerate(BANNERS[:4]):
        im = Image.open(os.path.join(BN_DIR, f"{name}.png")).resize((S * 5 // 4, int(BH * (S * 5 / 4) / BW)))
        sheet.paste(im, (i * (S * 5 // 4), off))
    for i, (name, _, _) in enumerate(BANNERS[4:]):
        im = Image.open(os.path.join(BN_DIR, f"{name}.png")).resize((S * 5 // 4, int(BH * (S * 5 / 4) / BW)))
        sheet.paste(im, (i * (S * 5 // 4), off + BH))
    sheet.save(os.environ.get("ART_SHEET", "/tmp/mimo_art_sheet.png"))
    print("done")

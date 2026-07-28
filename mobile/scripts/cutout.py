"""
Key a white studio background out of the onboarding artwork.

The illustrations arrive as opaque RGBA on white. The app is night, so a white
background is not a background — it is a white rectangle sitting on the card.

Why a flood fill from the border rather than "make near-white transparent":
the girl wears a cream cardigan, white socks and white flowers on a red skirt,
and the boy wears white-soled shoes. A global threshold erases all of them and
leaves the subjects full of holes. The background is the region CONNECTED to
the edge of the frame, so that is what gets removed — anything white enclosed
by the subject is kept by construction.

The fill runs twice. The first pass is strict — near-white only — and finds the
studio ground. The second pass starts from what the first found and walks
outward through greys, because these were rendered with a soft contact shadow
under the subjects that is nowhere near white and therefore survives a strict
key. On white nobody sees it; on night it is a grey smear under their shoes.

The second pass does not cut hard. It sets alpha from luminance, so the shadow
FADES rather than ending on an outline — a hard cut around a soft shadow is more
obviously wrong than the shadow was. It also cannot run away into the subject:
it accepts only low-chroma pixels above a luminance floor, and their clothes are
either saturated (red, cream) or far darker than the floor.

Two more things that matter at the edge:

  * **Feather.** A hard 0/255 alpha leaves a stair-stepped outline that is
    obvious at any size. The mask is grown one ring outward and the boundary
    is set to a mid alpha so the cut has a single soft pixel.
  * **Fringe.** Anti-aliased pixels on the original are the subject blended
    toward white; left alone they read as a pale halo on a dark ground. Every
    partially-transparent pixel is pushed away from white in proportion to how
    transparent it is, which is un-compositing it off the background it was
    matted onto.

Usage:  python3 scripts/cutout.py SRC DEST [MAX_WIDTH]
"""

import sys
from collections import deque
from PIL import Image, ImageFilter

# How close to white a pixel has to be to count as background, and how grey it
# is allowed to be. The studio ground is not perfectly 255 — there is a faint
# cool cast in the corners of one of these — so this cannot be an equality test.
NEAR_WHITE = 232
MAX_CHROMA = 14

# Pass two: the soft contact shadow. Anything this light and this close to grey,
# reached from the ground, is studio floor rather than subject.
SHADOW_FLOOR = 176
SHADOW_CHROMA = 20


def is_background(px):
    r, g, b = px[0], px[1], px[2]
    return min(r, g, b) >= NEAR_WHITE and (max(r, g, b) - min(r, g, b)) <= MAX_CHROMA


def is_shadow(px):
    r, g, b = px[0], px[1], px[2]
    return min(r, g, b) >= SHADOW_FLOOR and (max(r, g, b) - min(r, g, b)) <= SHADOW_CHROMA


def cut(src, dest, max_width=820):
    im = Image.open(src).convert('RGBA')
    w, h = im.size
    px = im.load()

    # ── Flood fill the background from every border pixel.
    bg = bytearray(w * h)
    q = deque()

    def push(x, y):
        i = y * w + x
        if not bg[i] and is_background(px[x, y]):
            bg[i] = 1
            q.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)

    while q:
        x, y = q.popleft()
        if x > 0:
            push(x - 1, y)
        if x < w - 1:
            push(x + 1, y)
        if y > 0:
            push(x, y - 1)
        if y < h - 1:
            push(x, y + 1)

    # ── Pass two: walk out of the ground through the contact shadow, setting
    #    alpha from luminance so it fades instead of ending on an edge.
    soft = {}
    q = deque(i for i, v in enumerate(bg) if v)

    while q:
        i = q.popleft()
        x, y = i % w, i // w
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if not (0 <= nx < w and 0 <= ny < h):
                continue
            j = ny * w + nx
            if bg[j] or j in soft:
                continue
            p = px[nx, ny]
            if not is_shadow(p):
                continue
            lum = (p[0] + p[1] + p[2]) / 3
            # 255 → gone, SHADOW_FLOOR → untouched.
            soft[j] = max(0, min(255, round(255 * (255 - lum) / (255 - SHADOW_FLOOR))))
            q.append(j)

    # ── Alpha from both passes, then one blur to feather the cut.
    a = bytearray(255 if not v else 0 for v in bg)
    for i, v in soft.items():
        a[i] = v
    alpha = Image.frombytes('L', (w, h), bytes(a))
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.7))
    im.putalpha(alpha)

    # ── Un-composite the anti-aliased rim off the white it was matted onto.
    #    c_true = (c_observed - (1 - a) * 255) / a, clamped.
    out = im.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = out[x, y]
            if 0 < a < 250:
                f = a / 255.0
                out[x, y] = (
                    max(0, min(255, int((r - (1 - f) * 255) / f))),
                    max(0, min(255, int((g - (1 - f) * 255) / f))),
                    max(0, min(255, int((b - (1 - f) * 255) / f))),
                    a,
                )

    box = im.split()[3].point(lambda v: 255 if v > 16 else 0).getbbox()
    im = im.crop(box)

    if im.width > max_width:
        ratio = max_width / im.width
        im = im.resize((max_width, round(im.height * ratio)), Image.LANCZOS)

    # WebP, not PNG. These are photographic-looking renders with fabric texture
    # in every garment, and PNG has nothing to offer that: the three of them
    # came to 1.9 MB, loading on the first screen of the app, before a new
    # player has seen anything. Lossy WebP with alpha holds the cut-out edge and
    # costs about a fifth of that. Metro carries `.webp` in `assetExts` by
    # default and `expo-image` decodes it on both platforms.
    if dest.endswith('.webp'):
        im.save(dest, 'WEBP', quality=86, method=6)
    else:
        im.save(dest, optimize=True)
    return im.size


if __name__ == '__main__':
    size = cut(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 820)
    import os as _os
    print(f'{sys.argv[2]}  {size[0]}x{size[1]}  {_os.path.getsize(sys.argv[2]) // 1024} KB')

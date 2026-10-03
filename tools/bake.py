"""Bake everything the rail needs at runtime so the page does no image analysis.

For every garment in assets/products/hi/<file>.png this writes to assets/baked/:
  <file>.webp    trimmed colour (<=1000 px long side), colour bled outward so edges never halo
  <file>.m.webp  same at <=640 px (phones)
  <file>.n.webp  tangent-space fabric detail normal (luminance high-pass), <=768 px
  <file>.b.webp  blurred back of the garment (<=256 px), alpha = outline with thin gaps closed
  <file>.s.png   soft silhouette for the fake drop shadow (<=128 px, 8-bit)
  <file>.sa.png  the same as black + alpha, for the DOM detail view
  <file>.mesh    uint16 inflation height field on the vertex grid + uint8 kept-cell flags
and manifest.json with sizes. Needs numpy, Pillow and opencv-python.

Run:  python tools/bake.py [name ...]
"""
import json
import sys
import zlib
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets' / 'products' / 'hi'
OUT = ROOT / 'assets' / 'baked'
OUT.mkdir(parents=True, exist_ok=True)

MAXS = 1000          # colour texture long side
MIDS = 640           # phone colour texture
NORM_S = 768         # detail normal long side
BACK_S = 256
SHADOW_S = 128
GRID = 144           # mesh cells along the long side (even: the back shell uses every 2nd vertex)
MESH_ONLY = '--mesh' in sys.argv
PAD = 6


def fit(img, longest, interp=cv2.INTER_AREA):
    h, w = img.shape[:2]
    s = longest / max(w, h)
    if s >= 1:
        return img
    return cv2.resize(img, (max(1, round(w * s)), max(1, round(h * s))), interpolation=interp)


def bleed(rgb, a):
    """Replace colour of every not-fully-opaque pixel with colour pulled from the opaque interior."""
    valid = cv2.erode((a > 0.97).astype(np.float32), np.ones((3, 3), np.uint8))
    out = rgb.copy()
    need = valid == 0
    src = rgb * valid[..., None]
    for s in (1, 2, 4, 8, 16, 32, 64, 128):
        num = cv2.GaussianBlur(src, (0, 0), s)
        den = cv2.GaussianBlur(valid, (0, 0), s)
        ok = need & (den > 0.02)
        out[ok] = num[ok] / den[ok][:, None]
        need &= ~ok
    return out


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def bake(path):
    name = path.stem
    im = np.asarray(Image.open(path).convert('RGBA'))
    a0 = im[..., 3]
    ys, xs = np.nonzero(a0 > 24)
    y0, y1 = max(0, ys.min() - PAD), min(im.shape[0], ys.max() + 1 + PAD)
    x0, x1 = max(0, xs.min() - PAD), min(im.shape[1], xs.max() + 1 + PAD)
    im = im[y0:y1, x0:x1]
    # one resize of the straight-alpha picture (premultiplied resize avoids dark fringes)
    f = im.astype(np.float32) / 255.0
    pm = np.dstack([f[..., :3] * f[..., 3:4], f[..., 3:4]])
    pm = fit(pm, MAXS)
    a = pm[..., 3]
    rgb = np.where(a[..., None] > 1e-4, pm[..., :3] / np.maximum(a[..., None], 1e-4), 0).clip(0, 1)
    rgb = bleed(rgb, a)
    H, W = a.shape

    def save_rgba(arr_rgb, arr_a, p, q):
        out = np.dstack([arr_rgb, arr_a])
        Image.fromarray((out * 255 + 0.5).astype(np.uint8), 'RGBA').save(p, 'WEBP', quality=q, alpha_quality=100, method=6, exact=True)

    if not MESH_ONLY:
        save_rgba(rgb, a, OUT / f'{name}.webp', 92)
    mid = fit(np.dstack([rgb * a[..., None], a]), MIDS)
    ma = mid[..., 3]
    if not MESH_ONLY:
        mrgb = bleed(np.where(ma[..., None] > 1e-4, mid[..., :3] / np.maximum(ma[..., None], 1e-4), 0).clip(0, 1), ma)
        save_rgba(mrgb, ma, OUT / f'{name}.m.webp', 90)

    # ---- inflation height field ------------------------------------------------------
    closed = (a > 0.4).astype(np.uint8)
    ks = 7 if name.startswith(('jeans', 'pants')) else 31      # bottoms: keep the gap between the legs open
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ks, ks))
    closed = cv2.morphologyEx(closed, cv2.MORPH_CLOSE, k)
    # Silhouette edges come in two kinds. Side edges (flanks, sleeve ends) round off like a pillow seam. Open ends
    # (hems, waistbands, shoulder lines: edges that run nearly horizontal) keep most of the body thickness right up to
    # the edge, so a hem stays a crisp straight cut and the hanger can sit between the shells at the shoulders.
    sm = cv2.GaussianBlur(closed.astype(np.float32), (0, 0), 2.5)
    gxm = cv2.Sobel(sm, cv2.CV_32F, 1, 0, ksize=3)
    gym = cv2.Sobel(sm, cv2.CV_32F, 0, 1, ksize=3)
    edge = (closed > 0) & (cv2.erode(closed, np.ones((3, 3), np.uint8)) == 0)
    openend = edge & (np.abs(gym) > 3.0 * np.abs(gxm))
    sideedge = edge & ~openend
    src = np.ones(closed.shape, np.uint8)
    src[sideedge] = 0
    dist = cv2.distanceTransform(src, cv2.DIST_L2, 5) * closed
    loc = cv2.dilate(dist, np.ones((101, 101), np.uint8))
    loc = cv2.GaussianBlur(loc, (0, 0), 24)
    t = np.clip(dist / np.maximum(0.82 * loc, 6.0), 0, 1)
    prof = np.sqrt(1 - (1 - t) ** 2)                      # rounded, vertical tangent at the seam
    thick = np.clip((loc / max(loc.max(), 1)) ** 0.55, 0.3, 1.0)
    # open ends: never thinner than 62 % of the body, rounding only within a few pixels of the edge
    src2 = np.ones(closed.shape, np.uint8)
    src2[openend] = 0
    dv = cv2.distanceTransform(src2, cv2.DIST_L2, 5)
    rv = 0.012 * max(W, H)
    tv = np.clip(dv / rv, 0, 1)
    fv = 0.62 + 0.38 * np.sqrt(1 - (1 - tv) ** 2)
    h = prof * fv * thick * closed
    h = cv2.GaussianBlur(h, (0, 0), 1.6)
    hmax = float(h.max()) or 1.0
    h = h / hmax

    ev = lambda v: max(8, int(round(v / 2.0)) * 2)
    if W >= H:
        nx, ny = GRID, ev(GRID * H / W)
    else:
        nx, ny = ev(GRID * W / H), GRID
    gx = np.linspace(0, W - 1, nx + 1, dtype=np.float32)
    gy = np.linspace(0, H - 1, ny + 1, dtype=np.float32)
    mx, my = np.meshgrid(gx, gy)
    hg = cv2.remap(h, mx, my, cv2.INTER_LINEAR)
    hq = np.clip(hg * 65535 + 0.5, 0, 65535).astype('<u2')
    # kept cells: any vertex whose neighbourhood touches the outline, grown by one cell
    cov = cv2.resize(np.maximum(a > 0.02, closed > 0).astype(np.float32), (nx + 1, ny + 1), interpolation=cv2.INTER_AREA) > 0
    cov = cv2.dilate(cov.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    cells = (cov[:-1, :-1] | cov[1:, :-1] | cov[:-1, 1:] | cov[1:, 1:]).astype(np.uint8)
    (OUT / f'{name}.mesh').write_bytes(hq.tobytes() + cells.tobytes())

    if MESH_ONLY:
        prev = json.loads((OUT / 'manifest.json').read_text())[name]
        prev.update(nx=nx, ny=ny)
        return prev

    # ---- fabric detail normal --------------------------------------------------------
    lum = (rgb @ np.array([0.299, 0.587, 0.114], np.float32)).astype(np.float32)
    rng = np.random.default_rng(zlib.crc32(name.encode()))
    grain = cv2.GaussianBlur(rng.standard_normal(lum.shape).astype(np.float32), (0, 0), 0.7)
    base = cv2.GaussianBlur(lum, (0, 0), 9)
    hp = (lum - base) / (base + 0.18) + 0.045 * grain
    hp = cv2.GaussianBlur(hp, (0, 0), 0.8)
    gxi = cv2.Sobel(hp, cv2.CV_32F, 1, 0, ksize=3) / 8
    gyi = cv2.Sobel(hp, cv2.CV_32F, 0, 1, ksize=3) / 8
    inner = cv2.GaussianBlur(cv2.erode((a > 0.9).astype(np.float32), np.ones((5, 5), np.uint8)), (0, 0), 3)
    s = 2.2
    n = np.dstack([-gxi * s * inner, gyi * s * inner, np.ones_like(gxi)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    n = fit(n * 0.5 + 0.5, NORM_S)
    Image.fromarray((n * 255 + 0.5).astype(np.uint8), 'RGB').save(OUT / f'{name}.n.webp', 'WEBP', quality=82, method=6)

    # ---- back of the garment: blurred colour, outline with small gaps closed -----------
    br = fit(rgb, BACK_S)
    br = cv2.GaussianBlur(br, (0, 0), 2.2)
    bm = fit(closed.astype(np.float32), BACK_S)
    bm = np.clip((bm - 0.35) * 3.0, 0, 1)
    save_rgba(br, bm, OUT / f'{name}.b.webp', 85)

    # ---- fake shadow silhouette --------------------------------------------------------
    sh = fit(closed.astype(np.float32), SHADOW_S)
    sh = cv2.GaussianBlur(cv2.copyMakeBorder(sh, 16, 16, 16, 16, cv2.BORDER_CONSTANT, value=0), (0, 0), 4.5)
    sh8 = (np.clip(sh, 0, 1) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(sh8, 'L').save(OUT / f'{name}.s.png', optimize=True)                 # WebGL alphaMap (green channel)
    Image.fromarray(np.dstack([np.zeros_like(sh8)] * 3 + [sh8]), 'RGBA').save(OUT / f'{name}.sa.png', optimize=True)   # DOM: black + alpha

    return {'W': int(W), 'H': int(H), 'nx': nx, 'ny': ny, 'hmax': 1.0, 'mid': int(mid.shape[1]), 'midH': int(mid.shape[0]), 'sw': int(sh.shape[1]) - 32, 'sh': int(sh.shape[0]) - 32}


def main():
    names = [a for a in sys.argv[1:] if not a.startswith('--')]
    files = sorted(SRC.glob('*.png'))
    if names:
        files = [f for f in files if f.stem in names]
    mf_path = OUT / 'manifest.json'
    mf = json.loads(mf_path.read_text()) if mf_path.exists() else {}
    for p in files:
        mf[p.stem] = bake(p)
        print(p.stem, mf[p.stem])
    mf_path.write_text(json.dumps(mf, indent=1))


if __name__ == '__main__':
    main()

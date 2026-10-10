"""Asset pipeline. Reads brand/ and reference/, writes src/tokens.css, src/assets/*, src/favicon.svg.
Run: python -I tools/assets.py   (needs Pillow, numpy, scikit-learn)
Every colour in tokens.css is a real pixel: k-means centroid snapped to the nearest actual pixel."""
import json, os
import numpy as np
from PIL import Image
from sklearn.cluster import KMeans

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGO = os.path.join(ROOT, 'brand', 'LOGO MUONOCOIN PNG...png')       # RGBA, alpha 0 regions are pure black
BANNER = os.path.join(ROOT, 'reference', 'SAMPUL MUONOCOIN JPG.jpg.jpeg')
OUT = os.path.join(ROOT, 'src')
os.makedirs(os.path.join(OUT, 'assets'), exist_ok=True)

def kmeans_snap(arr, mask, k, seed=7):
    ys, xs = np.nonzero(mask)
    px = arr[ys, xs][:, :3].astype(float)
    rng = np.random.RandomState(seed)
    idx = rng.choice(len(px), min(200000, len(px)), replace=False)
    km = KMeans(k, n_init=4, random_state=seed).fit(px[idx])
    lab = km.predict(px)
    res = []
    for c in range(k):
        sel = np.nonzero(lab == c)[0]
        j = sel[((px[sel] - km.cluster_centers_[c]) ** 2).sum(1).argmin()]
        rgb = tuple(int(v) for v in px[j])
        res.append(dict(share=len(sel) / len(px), hex='#%02x%02x%02x' % rgb, xy=(int(xs[j]), int(ys[j]))))
    return sorted(res, key=lambda r: -r['share'])

logo = np.array(Image.open(LOGO).convert('RGBA'))
banner = np.array(Image.open(BANNER).convert('RGBA'))
L = kmeans_snap(logo, logo[..., 3] == 255, 7)
B = kmeans_snap(banner, banner[..., 3] == 255, 8)

def lum(h):
    r, g, b = (int(h[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
def pick(rows, fn):
    return fn(rows)

# roles, chosen by measurable rule (lightness / hue) not by taste
surface = max(B, key=lambda r: lum(r['hex']))                              # lightest banner cluster
surface2 = sorted(B, key=lambda r: -lum(r['hex']))[1]                      # second lightest
ink = min(B, key=lambda r: lum(r['hex']))                                  # darkest banner cluster
def hue_blueish(r): 
    h = r['hex']; return int(h[5:7], 16) > int(h[1:3], 16) + 80
blue = max([r for r in B if hue_blueish(r) and lum(r['hex']) < 140], key=lambda r: r['share'])   # banner chip blue
deep = min(L, key=lambda r: lum(r['hex']))
indigo = sorted([r for r in L if lum(r['hex']) < 80], key=lambda r: lum(r['hex']))[1]
cyan = max(L, key=lambda r: int(r['hex'][3:5], 16) + int(r['hex'][5:7], 16) - int(r['hex'][1:3], 16))
magenta = max(L, key=lambda r: int(r['hex'][1:3], 16) - int(r['hex'][3:5], 16) + (int(r['hex'][5:7], 16) > 150) * 40 if lum(r['hex']) < 150 else -999)
violet = [r for r in L if r['hex'] not in (deep['hex'], indigo['hex'], cyan['hex'], magenta['hex']) and lum(r['hex']) < 120 and int(r['hex'][1:3], 16) > 100][0]
lilac = max(L, key=lambda r: lum(r['hex']))

tok = [
 ('surface',  surface,  'banner', 'page ground'),
 ('surface-2', surface2, 'banner', 'tinted ground'),
 ('ink',      ink,      'banner', 'body text'),
 ('blue',     blue,     'banner', 'links, primary action'),
 ('deep',     deep,     'logo',   'darkest logo field'),
 ('indigo',   indigo,   'logo',   'headings'),
 ('cyan',     cyan,     'logo',   'accent'),
 ('violet',   violet,   'logo',   'accent'),
 ('magenta',  magenta,  'logo',   'accent'),
 ('lilac',    lilac,    'logo',   'highlight'),
]
lines = ['/* The only file allowed to hold colour literals (gate: palette).',
 '   Provenance: k-means (k=7 logo, k=8 banner, seed 7, 200k-pixel sample) on opaque pixels, each centroid',
 '   snapped to the nearest real pixel; x,y below is that pixel in the source file.',
 '   logo   = brand/LOGO MUONOCOIN PNG...png (2000x2000, RGBA colortype 6)',
 '   banner = reference/SAMPUL MUONOCOIN JPG.jpg.jpeg (1500x500) */', ':root {']
prov = {}
for name, r, src, role in tok:
    lines.append('  --%s: %s; /* %s px (%d,%d), cluster share %.1f%% - %s */' % (name, r['hex'], src, r['xy'][0], r['xy'][1], r['share'] * 100, role))
    prov[name] = dict(hex=r['hex'], source=src, pixel=r['xy'], share=round(r['share'], 4))
lines.append('}')
open(os.path.join(OUT, 'tokens.css'), 'w', newline='\n').write('\n'.join(lines) + '\n')
json.dump(prov, open(os.path.join(ROOT, 'tools', 'palette.json'), 'w'), indent=1)

# ---- premultiplied resize (transparent regions are pure black RGB; naive resize would bleed black into edges)
def premul_resize(im, size):
    a = np.array(im.convert('RGBA')).astype(np.float64)
    al = a[..., 3:4] / 255.0
    pm = np.concatenate([a[..., :3] * al, a[..., 3:4]], axis=2)
    chans = [Image.fromarray(pm[..., i].astype(np.float32), 'F').resize((size, size), Image.LANCZOS) for i in range(4)]
    r = np.stack([np.array(c) for c in chans], axis=2)
    alpha = np.clip(r[..., 3], 0, 255)
    rgb = np.where(alpha[..., None] > 0, r[..., :3] / np.maximum(alpha[..., None] / 255.0, 1e-6), 0)
    out = np.concatenate([np.clip(rgb, 0, 255), alpha[..., None]], axis=2).round().astype(np.uint8)
    return Image.fromarray(out, 'RGBA')

src = Image.open(LOGO).convert('RGBA')
bbox = src.getchannel('A').point(lambda v: 255 if v > 0 else 0).getbbox()
print('logo alpha bbox', bbox)
crop = src.crop(bbox)
side = max(crop.size)
sq = Image.new('RGBA', (side, side), (0, 0, 0, 0)); sq.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))
for s in (64, 180, 320):
    premul_resize(sq, s).save(os.path.join(OUT, 'assets', 'logo-%d.png' % s), optimize=True)
# social card: the supplied banner, as-is, re-encoded
Image.open(BANNER).convert('RGB').save(os.path.join(OUT, 'assets', 'og.jpg'), quality=88, optimize=True)

# ---- favicon: 32x32 trace of the real pixel grid (premultiplied downsample), run-length merged rects
fav = np.array(premul_resize(sq, 32))
rects = []
for y in range(32):
    x = 0
    while x < 32:
        r, g, b, a = (int(v) for v in fav[y, x])
        if a < 8: x += 1; continue
        x2 = x + 1
        while x2 < 32 and tuple(int(v) for v in fav[y, x2]) == (r, g, b, a): x2 += 1
        op = '' if a == 255 else ' fill-opacity="%.2f"' % (a / 255)
        rects.append('<rect x="%d" y="%d" width="%d" height="1" fill="#%02x%02x%02x"%s/>' % (x, y, x2 - x, r, g, b, op))
        x = x2
svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges">' + ''.join(rects) + '</svg>\n'
assert '--' not in svg
open(os.path.join(OUT, 'favicon.svg'), 'w', newline='\n').write(svg)
print('favicon rects', len(rects), 'bytes', len(svg))
for n, r, s, _ in tok: print(n, r['hex'], s, r['xy'])

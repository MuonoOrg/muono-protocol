"""Gate helper: each token in tokens.css must equal the real pixel at its recorded coordinate in its source image."""
import json, os, re, sys
from PIL import Image
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = {'logo': os.path.join(root, 'brand', 'LOGO MUONOCOIN PNG...png'), 'banner': os.path.join(root, 'reference', 'SAMPUL MUONOCOIN JPG.jpg.jpeg')}
ims = {k: Image.open(v).convert('RGBA') for k, v in src.items()}
css = open(os.path.join(root, 'src', 'tokens.css'), encoding='utf8').read()
rows = re.findall(r'--([\w-]+):\s*(#[0-9a-f]{6});\s*/\*\s*(banner|logo) px \((\d+),(\d+)\)', css)
bad = []
for name, hx, s, x, y in rows:
    r, g, b, a = ims[s].getpixel((int(x), int(y)))
    got = '#%02x%02x%02x' % (r, g, b)
    if got != hx or a != 255: bad.append('%s: tokens.css %s but %s pixel (%s,%s) is %s alpha %d' % (name, hx, s, x, y, got, a))
if len(rows) < 8: bad.append('only %d tokens carry provenance' % len(rows))
print('\n'.join(bad)) if bad else print('verified %d tokens' % len(rows))
sys.exit(1 if bad else 0)

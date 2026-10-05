"""Builds a labelled contact sheet of downloaded art so crops can be chosen.
Usage: python3 scripts/art/contact.py <srcDir> <out.jpg> <prefix-filter|all> [thumbHeight]
"""
import os
import sys

from PIL import Image, ImageDraw

src, out, flt = sys.argv[1], sys.argv[2], sys.argv[3]
th = int(sys.argv[4]) if len(sys.argv) > 4 else 220
names = sorted(f for f in os.listdir(src) if f.endswith('.img'))
if flt == 'heroes':
    names = [n for n in names if not n.startswith('s_')]
elif flt == 'scenes':
    names = [n for n in names if n.startswith('s_')]
thumbs = []
for n in names:
    im = Image.open(os.path.join(src, n)).convert('RGB')
    w = int(im.width * th / im.height)
    thumbs.append((n[:-4], im.resize((w, th))))
maxw = 1400
rows, row, x = [], [], 0
for t in thumbs:
    if x + t[1].width > maxw and row:
        rows.append(row)
        row, x = [], 0
    row.append(t)
    x += t[1].width + 6
rows.append(row)
sheet = Image.new('RGB', (maxw, len(rows) * (th + 18)), 'white')
d = ImageDraw.Draw(sheet)
y = 0
for r in rows:
    x = 0
    for name, im in r:
        sheet.paste(im, (x, y + 16))
        d.text((x + 2, y + 2), name, fill='black')
        x += im.width + 6
    y += th + 18
sheet.save(out, quality=55)
print(out, sheet.size, os.path.getsize(out))

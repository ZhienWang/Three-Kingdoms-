"""Crops downloaded public-domain art into hero portraits and card illustrations.

Crop windows are chosen automatically by edge energy (where the linework and
figures are densest), with an optional bias toward the top of the frame for
figure portraits. Small sources are upscaled with Lanczos + light sharpening.

Usage: python3 scripts/art/process.py <srcDir> <publicDir>
"""
import json
import os
import sys

from PIL import Image, ImageFilter, ImageOps

src, pub = sys.argv[1], sys.argv[2]
meta = json.load(open(os.path.join(src, 'meta.json')))

# hero key -> (source key, vertical bias 0..1 where 0 prefers top)
HEROES = {
    'liubei': ('liubei', 0.35), 'guanyu': ('guanyu', 0.35), 'zhangfei': ('zhangfei', 0.35),
    'zhugeliang': ('zhugeliang', 0.25), 'zhaoyun': ('zhaoyun', 0.4), 'machao': ('machao', 0.4),
    'caocao': ('caocao', 0.4), 'simayi': ('simayi', 0.3), 'xiahoudun': ('xiahoudun', 0.3),
    'zhangliao': ('zhangliao', 0.2), 'sunquan': ('sunquan', 0.25), 'zhouyu': ('zhouyu', 0.2),
    'huanggai': ('huanggai', 0.2), 'lubu': ('lubu', 0.4), 'diaochan': ('diaochan', 0.4),
    'huatuo': ('huatuo', 0.25),
}

# card art key -> (source key, nth-best window, bias)
CARDS = {
    'attack': ('s_hulao', 0, 0.5), 'dodge': ('s_tan', 0, 0.5), 'peach': ('s_rtk2', 0, 0.5),
    'duel': ('s_river', 0, 0.5), 'dismantle': ('s_flood', 0, 0.5), 'steal': ('s_lubu_dongzhuo', 0, 0.5),
    'barbarians': ('s_rtk3', 0, 0.5), 'arrows': ('s_rtk4', 0, 0.5), 'peachgarden': ('s_chron1', 0, 0.5),
    'drawtwo': ('s_zhuge_wind', 0, 0.5), 'negate': ('s_bridge', 0, 0.5), 'indulgence': ('s_chron2', 0, 0.5),
    'lightning': ('s_rtk5', 0, 0.5), 'crossbow': ('s_rtk6', 0, 0.5), 'bluesteel': ('s_fivepass', 0, 0.5),
    'greendragon': ('s_hokusai_guanyu', 0, 0.4), 'serpentspear': ('s_guanyu_steps', 0, 0.5),
    'rockaxe': ('s_rtk2', 1, 0.5), 'halberd': ('s_hulao', 1, 0.5), 'kirinbow': ('s_chron2', 1, 0.5),
    'eighttrigrams': ('s_zhuge_wind', 1, 0.5), 'renwang': ('s_rtk3', 1, 0.5),
    'horseplus': ('s_tan', 1, 0.5), 'horseminus': ('s_rtk6', 1, 0.5),
}


def energy_map(im):
    small = ImageOps.grayscale(im)
    scale = 256 / max(small.size)
    small = small.resize((max(1, int(small.width * scale)), max(1, int(small.height * scale))))
    edges = small.filter(ImageFilter.FIND_EDGES)
    return edges, scale


def best_windows(im, aspect, bias, zoom=1.0):
    """Return candidate crop boxes (in source coords) ranked by edge energy."""
    edges, scale = energy_map(im)
    W, H = edges.size
    px = edges.load()
    # integral image
    integ = [[0] * (W + 1) for _ in range(H + 1)]
    for y in range(H):
        row = 0
        for x in range(W):
            row += px[x, y]
            integ[y + 1][x + 1] = integ[y][x + 1] + row
    if W / H > aspect:
        ch, cw = H, int(H * aspect)
    else:
        cw, ch = W, int(W / aspect)
    cw, ch = max(1, int(cw * zoom)), max(1, int(ch * zoom))
    cands = []
    stepx = max(1, (W - cw) // 24) if W > cw else 1
    stepy = max(1, (H - ch) // 24) if H > ch else 1
    for y in range(0, H - ch + 1, stepy):
        for x in range(0, W - cw + 1, stepx):
            s = integ[y + ch][x + cw] - integ[y][x + cw] - integ[y + ch][x] + integ[y][x]
            # vertical bias: penalise distance from preferred position
            if H > ch:
                pos = y / (H - ch)
                s *= 1.0 - 0.35 * abs(pos - bias)
            cands.append((s, x, y))
    cands.sort(reverse=True)
    picked = []
    for s, x, y in cands:
        # keep windows that differ meaningfully
        if all(abs(x - px_) > cw * 0.35 or abs(y - py_) > ch * 0.35 for _, px_, py_ in picked):
            picked.append((s, x, y))
        if len(picked) >= 3:
            break
    if not picked:
        picked = [cands[0]]
    return [(int(x / scale), int(y / scale), int((x + cw) / scale), int((y + ch) / scale)) for _, x, y in picked]


def render(src_key, out_path, size, nth, bias):
    im = Image.open(os.path.join(src, src_key + '.img')).convert('RGB')
    aspect = size[0] / size[1]
    # variant 0 = best full-height window; variant 1 = a closer detail crop
    boxes = best_windows(im, aspect, bias, 1.0 if nth == 0 else 0.6)
    box = boxes[0]
    crop = im.crop(box)
    upscale = crop.width < size[0]
    crop = crop.resize(size, Image.LANCZOS)
    if upscale:
        crop = crop.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    crop.save(out_path, 'WEBP', quality=82, method=6)
    return box, upscale


credits = {}
for key, (sk, bias) in HEROES.items():
    box, up = render(sk, os.path.join(pub, 'art/heroes', key + '.webp'), (900, 1200), 0, bias)
    credits['hero:' + key] = {**meta[sk], 'upscaled': up}
    print('hero', key, box, 'upscaled' if up else '')
for key, (sk, nth, bias) in CARDS.items():
    box, up = render(sk, os.path.join(pub, 'art/cards', key + '.webp'), (600, 840), nth, bias)
    credits['card:' + key] = {**meta[sk], 'upscaled': up}
    print('card', key, box)
for v in credits.values():
    v.pop('url', None)
json.dump(credits, open(os.path.join(pub, 'art/credits.json'), 'w'), ensure_ascii=False, indent=1)
print('done')

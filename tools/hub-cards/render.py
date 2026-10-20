"""Render UnderWeb hub creator cards from the hub-cards feed.

Usage:
    python render.py FEED.json OUT_DIR [--world hub] [--now 2026-10-20T00:00:00Z]

Reads the JSON from the `hub-cards` edge function and writes, under OUT_DIR/w/<world>/:
    CREATOR_MARKET_01..08/1.jpg   Creator Market cards        (1024x1280)
    CREATOR_FEATURED_01/1.jpg     Featured creator of the week (1920x1080)
    STAGE_DJS/1..12.jpg           Resident DJ cards, rotating  (1920x1080)
    CREATOR_WALL/1..12.jpg        Members' photos & art        (1920x1080)
    manifest.json                 which gallery positions are active (read by the hub world), plus per slot
                                  `ids` + `likes` (which card is at each position, its ♥ count - the hub's like
                                  buttons use them) and a top-level `names` list (the Creator Room's name wall)

Everything drawn here is public (it hangs in a public world). The feed only contains
staff-approved, opted-in cards. Images are only fetched from UnderWeb's own storage.
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import math
import os
import random
import subprocess
import sys
import urllib.request
from urllib.parse import urlparse

from fontTools.ttLib import TTFont
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, 'fonts')
STORAGE_PREFIX = 'https://pxipclkptxpqukefwexh.supabase.co/storage/v1/object/public/'
MARKET_SLOTS = 8
MAX_GALLERY = 12
Image.MAX_IMAGE_PIXELS = 100_000_000

G = (56, 255, 114)
BG = (1, 3, 2)
TXT = (242, 255, 246)
MUTED = (185, 205, 192)
DIM = (120, 148, 133)
LINE = (29, 90, 51)
PANEL = (6, 18, 10)

# ---------- fonts with per-character fallback ----------

_cmaps: dict[str, set[int]] = {}


def _cmap(path: str) -> set[int]:
    if path not in _cmaps:
        _cmaps[path] = set(TTFont(path).getBestCmap().keys())
    return _cmaps[path]


# Cyrillic letters that look identical to Latin ones (e.g. the "а" in "Dаrko"). On a picture
# only the shape matters, so they're drawn with the matching Latin glyph of the same font.
HOMOGLYPHS = str.maketrans('АВЕКМНОРСТХаеорсхуіјѕԁԛԝ', 'ABEKMHOPCTXaeopcxyijsdqw')


class Face:
    """A font plus a fallback for characters it can't draw (e.g. Anton has no Cyrillic)."""

    def __init__(self, file: str, size: int, wght: int | None = None, fallback: 'Face | None' = None):
        self.path = os.path.join(FONTS, file)
        self.font = ImageFont.truetype(self.path, size)
        if wght is not None:
            try:
                axes = self.font.get_variation_axes()
                vals = []
                for a in axes:
                    name = a.get('name', b'')
                    name = name.decode() if isinstance(name, bytes) else str(name)
                    vals.append(wght if 'eight' in name.lower() or name.lower() == 'wght' else max(a['minimum'], min(a['maximum'], size)))
                self.font.set_variation_by_axes(vals)
            except Exception:
                pass
        self.cmap = _cmap(self.path)
        self.fallback = fallback

    def runs(self, text: str):
        """Split text into (font, chunk) runs. Characters no font has (emoji) are dropped."""
        out: list[tuple[ImageFont.FreeTypeFont, str]] = []
        for ch in text:
            if ord(ch) not in self.cmap and ord(ch.translate(HOMOGLYPHS)) in self.cmap:
                ch = ch.translate(HOMOGLYPHS)
            if ord(ch) in self.cmap or ch == ' ':
                f = self.font
            elif self.fallback and ord(ch) in self.fallback.cmap:
                f = self.fallback.font
            else:
                continue
            if out and out[-1][0] is f:
                out[-1] = (f, out[-1][1] + ch)
            else:
                out.append((f, ch))
        return out


def text_width(d: ImageDraw.ImageDraw, text: str, face: Face) -> float:
    return sum(d.textlength(chunk, font=f) for f, chunk in face.runs(text))


def draw_text(d: ImageDraw.ImageDraw, xy, text: str, face: Face, fill) -> float:
    x, y = xy
    for f, chunk in face.runs(text):
        d.text((x, y), chunk, font=f, fill=fill)
        x += d.textlength(chunk, font=f)
    return x


def fit_face(d, text, maker, start: int, max_w: int, min_size: int = 24) -> Face:
    size = start
    while size > min_size:
        face = maker(size)
        if text_width(d, text, face) <= max_w:
            return face
        size -= 4
    return maker(min_size)


def ellipsize(d, text: str, face: Face, max_w: int) -> str:
    if text_width(d, text, face) <= max_w:
        return text
    while text and text_width(d, text + '…', face) > max_w:
        text = text[:-1]
    return text.rstrip() + '…'


inter = lambda s, w=500: Face('Inter-Variable.ttf', s, w)
mono = lambda s, w=700: Face('JetBrainsMono-Variable.ttf', s, w, fallback=inter(s, 600))
anton = lambda s: Face('Anton-Regular.ttf', s, None, fallback=inter(s, 800))

# ---------- helpers ----------


def clean(text) -> str:
    return ' '.join(str(text or '').split())


def fetch_image(url: str | None) -> Image.Image | None:
    if not url or not url.startswith(STORAGE_PREFIX):
        return None
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'UnderWeb-hub-cards/1'})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read(40 * 1024 * 1024 + 1)
        if len(data) > 40 * 1024 * 1024:
            return None
        im = Image.open(io.BytesIO(data))
        im = ImageOps.exif_transpose(im)
        im.load()
        return im
    except Exception as e:  # a bad image skips that card, never the whole run
        print(f'  ! could not load {url}: {e}', file=sys.stderr)
        return None


def qr_rows(text: str) -> list[str]:
    out = subprocess.run(['node', os.path.join(HERE, 'qr.js'), text], check=True, capture_output=True, text=True).stdout
    return [r for r in out.split('\n') if r]


def qr_image(text: str, size: int) -> Image.Image:
    rows = qr_rows(text)
    n, qz = len(rows), 4
    cell = max(1, size // (n + qz * 2))
    q = Image.new('RGB', (cell * (n + qz * 2),) * 2, (255, 255, 255))
    qd = ImageDraw.Draw(q)
    for r, row in enumerate(rows):
        for c, v in enumerate(row):
            if v == '1':
                x0, y0 = (c + qz) * cell, (r + qz) * cell
                qd.rectangle((x0, y0, x0 + cell - 1, y0 + cell - 1), fill=(0, 0, 0))
    return q


def paste_qr(img: Image.Image, d: ImageDraw.ImageDraw, text: str, x: int, y: int, size: int) -> int:
    q = qr_image(text, size)
    d.rounded_rectangle((x - 12, y - 12, x + q.width + 12, y + q.height + 12), radius=20, fill=(255, 255, 255))
    img.paste(q, (x, y))
    return q.width


def short_link(url: str) -> str:
    p = urlparse(url)
    s = (p.netloc.removeprefix('www.') + p.path).rstrip('/')
    return s


def cover(im: Image.Image, w: int, h: int, focus_y: float = 0.3) -> Image.Image:
    im = im.convert('RGB')
    scale = max(w / im.width, h / im.height)
    nw, nh = math.ceil(im.width * scale), math.ceil(im.height * scale)
    im = im.resize((nw, nh), Image.LANCZOS)
    left = (nw - w) // 2
    top = int((nh - h) * focus_y)
    return im.crop((left, top, left + w, top + h))


def is_logo(im: Image.Image) -> bool:
    """Transparent art (a logo) gets a glow cut-out instead of a photo frame."""
    if im.mode not in ('RGBA', 'LA', 'P'):
        return False
    a = im.convert('RGBA').split()[3]
    lo, _ = a.getextrema()
    return lo < 16


def frame(d, w, h):
    d.rounded_rectangle((3, 3, w - 4, h - 4), radius=28, outline=LINE, width=5)


def pill(d, x, y, text, face, fg=G, bg=PANEL, border=LINE, dot=None):
    tw = text_width(d, text, face)
    pad = 18
    extra = 34 if dot else 0
    h = face.font.size + 22
    d.rounded_rectangle((x, y, x + tw + pad * 2 + extra, y + h), radius=h // 2, fill=bg, outline=border, width=3)
    if dot:
        d.ellipse((x + pad, y + h // 2 - 10, x + pad + 20, y + h // 2 + 10), fill=dot)
    draw_text(d, (x + pad + extra, y + 9), text, face, fg)
    return h

# ---------- card types ----------


def market_card(card: dict, art: Image.Image) -> Image.Image:
    W, H = 1024, 1280
    img = Image.new('RGB', (W, H), BG)
    ART_H = 760
    img.paste(cover(art, W, ART_H, 0.15), (0, 0))
    fade = Image.new('L', (W, ART_H), 0)
    fd = ImageDraw.Draw(fade)
    for y in range(ART_H - 260, ART_H):
        t = (y - (ART_H - 260)) / 260
        fd.line([(0, y), (W, y)], fill=int(255 * (t ** 1.6)))
    img.paste(Image.new('RGB', (W, ART_H), BG), (0, 0), fade)
    d = ImageDraw.Draw(img)
    pad = 64
    pill(d, pad - 14, pad - 12, 'CREATOR MARKET', mono(24), bg=(3, 8, 5))

    name = clean(card['name']).upper()
    nf = fit_face(d, name, anton, 104, W - pad * 2, 56)
    draw_text(d, (pad, 700 + (104 - nf.font.size)), name, nf, TXT)
    y = 832
    headline = clean(card.get('headline'))
    if headline:
        hf = inter(36, 500)
        draw_text(d, (pad, y), ellipsize(d, headline, hf, W - pad * 2), hf, MUTED)
    y += 62
    if card.get('link_url'):
        label = clean(card.get('link_label')).upper() or 'SHOP'
        pill(d, pad, y, ellipsize(d, label, mono(24), W - pad * 2 - 60), mono(24), bg=(13, 36, 22))

    has_shop = bool(card.get('link_url'))
    target = card.get('link_url') or card['profile_url']
    qsize = 248
    qx, qy = W - pad - qsize, H - pad - qsize
    paste_qr(img, d, target, qx, qy, qsize)
    by = qy + 18
    draw_text(d, (pad, by), 'Scan for the shop' if has_shop else 'Scan to see their work', inter(40, 700), TXT)
    lf = mono(25, 600)
    draw_text(d, (pad, by + 60), ellipsize(d, short_link(target), lf, qx - pad - 30) if has_shop else 'underweb.cloud', lf, G)
    if has_shop:
        draw_text(d, (pad, by + 108), 'or find them on underweb.cloud', inter(26, 400), DIM)
    d.line((pad, H - pad - 6, pad + 120, H - pad - 6), fill=LINE, width=3)
    draw_text(d, (pad, H - pad - 44), 'UNDERWEB', anton(30), G)
    frame(d, W, H)
    return img


def _eq_bars(d, W, H, seed, max_h=90, bottom=50):
    rnd = random.Random(seed)
    bw, gap, x = 18, 12, 80
    i = 0
    while x + bw <= W - 80:
        h = 18 + int(abs(math.sin(i * 0.45)) * max_h * 0.75 + rnd.randint(0, int(max_h * 0.45)))
        shade = tuple(int(c * (0.35 + 0.65 * min(1, h / (max_h + 30)))) for c in G)
        d.rounded_rectangle((x, H - bottom - h, x + bw, H - bottom), radius=4, fill=shade)
        x += bw + gap
        i += 1


def _hero(img: Image.Image, art: Image.Image, box):
    """Logo art gets a glowing cut-out; photos get a rounded frame."""
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    if is_logo(art):
        logo = art.convert('RGBA')
        bb = logo.getbbox()
        if bb:
            logo = logo.crop(bb)
        s = min(bw / logo.width, bh / logo.height)
        logo = logo.resize((max(1, int(logo.width * s)), max(1, int(logo.height * s))), Image.LANCZOS)
        lx, ly = x0, y0 + (bh - logo.height) // 2
        alpha = logo.split()[3]
        halo = Image.new('RGBA', logo.size, G + (0,))
        halo.putalpha(alpha.filter(ImageFilter.GaussianBlur(18)).point(lambda v: int(v * 0.55)))
        img.paste(halo, (lx, ly), halo)
        img.paste(logo, (lx, ly), logo)
        return ly + logo.height
    photo = cover(art, bw, bh, 0.3)
    mask = Image.new('L', (bw, bh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, bw - 1, bh - 1), radius=28, fill=255)
    img.paste(photo, (x0, y0), mask)
    ImageDraw.Draw(img).rounded_rectangle((x0, y0, x1, y1), radius=28, outline=LINE, width=4)
    return y1


def _glow_bg(W, H, box):
    bg = Image.new('RGB', (W, H), BG)
    g = Image.new('RGB', (W, H), BG)
    ImageDraw.Draw(g).ellipse(box, fill=(14, 70, 32))
    return Image.blend(bg, g.filter(ImageFilter.GaussianBlur(160)), 1.0)


def dj_card(card: dict, art: Image.Image) -> Image.Image:
    W, H = 1920, 1080
    img = _glow_bg(W, H, (180, 120, 1180, 900))
    d = ImageDraw.Draw(img)
    _eq_bars(d, W, H, card['id'])
    pill(d, 90, 80, 'RESIDENT DJ', mono(34))
    draw_text(d, (W - 140 - text_width(d, 'UNDERWEB  STAGE', anton(40)), 84), 'UNDERWEB  STAGE', anton(40), G)

    bottom = _hero(img, art, (120, 220, 1120, 560))
    d = ImageDraw.Draw(img)
    name = clean(card['name']).upper()
    nf = fit_face(d, name, anton, 96, 1000, 48)
    y = bottom + 30
    draw_text(d, (130, y), name, nf, TXT)
    y += nf.font.size + 26
    headline = clean(card.get('headline'))
    if headline:
        hf = mono(34)
        draw_text(d, (130, y), ellipsize(d, headline.upper(), hf, 1000), hf, MUTED)

    target = card.get('link_url') or card['profile_url']
    qsize = 380
    qx, qy = W - 140 - qsize, 210
    qw = paste_qr(img, d, target, qx, qy, qsize)
    cx = qx + qw // 2

    def center(text, face, yy, fill):
        text = ellipsize(d, text, face, 520)
        draw_text(d, (cx - text_width(d, text, face) / 2, yy), text, face, fill)
    center('Follow their music' if card.get('link_url') else 'See their profile', inter(46, 700), qy + qw + 40, TXT)
    center(short_link(target) if card.get('link_url') else 'underweb.cloud', mono(30, 600), qy + qw + 104, G)
    if card.get('extra_link_url'):
        center(short_link(card['extra_link_url']), mono(28, 500), qy + qw + 148, MUTED)
    frame(d, W, H)
    return img


def featured_card(card: dict, art: Image.Image, week_start: dt.date) -> Image.Image:
    W, H = 1920, 1080
    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)
    if is_logo(art):
        panel = _glow_bg(960, H, (80, 180, 880, 900))
        img.paste(panel, (0, 0))
        _hero(img, art, (90, 260, 870, 820))
    else:
        img.paste(cover(art, 960, H, 0.2), (0, 0))
        fade = Image.new('L', (260, H), 0)
        fd = ImageDraw.Draw(fade)
        for x in range(260):
            fd.line([(x, 0), (x, H)], fill=int(255 * (x / 259) ** 1.4))
        img.paste(Image.new('RGB', (260, H), BG), (700, 0), fade)
    d = ImageDraw.Draw(img)
    x = 1010
    pill(d, x, 120, 'FEATURED CREATOR', mono(32))
    draw_text(d, (x, 196), f'WEEK OF {week_start.strftime("%b %d").upper()}', mono(28, 500), DIM)
    name = clean(card['name']).upper()
    nf = fit_face(d, name, anton, 150, W - x - 90, 64)
    draw_text(d, (x, 260), name, nf, TXT)
    y = 260 + nf.font.size + 40
    headline = clean(card.get('headline'))
    if headline:
        hf = inter(44, 500)
        draw_text(d, (x, y), ellipsize(d, headline, hf, W - x - 90), hf, MUTED)
    qsize = 300
    qy = H - 120 - qsize
    paste_qr(img, d, card['profile_url'], x + 12, qy, qsize)
    tx = x + 12 + qsize + 50
    draw_text(d, (tx, qy + 60), 'See their work', inter(46, 700), TXT)
    draw_text(d, (tx, qy + 124), 'on underweb.cloud', mono(30, 600), G)
    draw_text(d, (tx, qy + 230), 'UNDERWEB', anton(40), G)
    frame(d, W, H)
    return img


def wall_card(item: dict, art: Image.Image) -> Image.Image:
    W, H = 1920, 1080
    base = cover(art, W, H, 0.5).filter(ImageFilter.GaussianBlur(40))
    base = Image.blend(base, Image.new('RGB', (W, H), BG), 0.55)
    im = art.convert('RGB')
    s = min((W - 120) / im.width, (H - 220) / im.height)
    im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)
    base.paste(im, ((W - im.width) // 2, 50 + (H - 220 - im.height) // 2))
    d = ImageDraw.Draw(base)
    d.rectangle((0, H - 130, W, H), fill=BG)
    title = clean(item['title'])
    tf = inter(44, 700)
    x = draw_text(d, (80, H - 100), ellipsize(d, title, tf, 1100), tf, TXT)
    by = f'  ·  by {clean(item["by"])}'
    draw_text(d, (x, H - 100), ellipsize(d, by, inter(44, 400), W - x - 400), inter(44, 400), MUTED)
    draw_text(d, (W - 80 - text_width(d, 'UNDERWEB GALLERY', anton(40)), H - 98), 'UNDERWEB GALLERY', anton(40), G)
    frame(d, W, H)
    return base

# ---------- main ----------


def save(img: Image.Image, path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, 'JPEG', quality=88, optimize=True, progressive=False)


def creator_names(feed: dict) -> list[str]:
    """Everyone with approved work in the hub, for the Creator Room's name wall (A-Z, no repeats)."""
    seen: dict[str, str] = {}
    people = [c.get('name') for c in feed.get('market', []) + feed.get('dj', [])] + [w.get('by') for w in feed.get('wall', [])]
    for n in people:
        n = clean(n)[:40]
        if n and n not in ('UnderWeb creator', 'UnderWeb member'):
            seen.setdefault(n.casefold(), n)
    return sorted(seen.values(), key=str.casefold)[:300]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('feed')
    ap.add_argument('out')
    ap.add_argument('--world', default='hub')
    ap.add_argument('--now', default=None, help='ISO time, for testing the weekly rotation')
    args = ap.parse_args(argv)

    feed = json.load(open(args.feed, encoding='utf-8'))
    now = dt.datetime.fromisoformat(args.now.replace('Z', '+00:00')) if args.now else dt.datetime.now(dt.timezone.utc)
    week = now.isocalendar()[1] + now.isocalendar()[0] * 53
    week_start = (now - dt.timedelta(days=now.weekday())).date()
    root = os.path.join(args.out, 'w', args.world)
    manifest: dict[str, dict] = {}
    art_cache: dict[str, Image.Image | None] = {}

    def art(url):
        if url not in art_cache:
            art_cache[url] = fetch_image(url)
        return art_cache[url]

    # Creator Market: up to 8 at a time; if there are more, the set rotates weekly.
    market = [c for c in feed.get('market', []) if art(c.get('image_url'))]
    if len(market) > MARKET_SLOTS:
        off = (week * MARKET_SLOTS) % len(market)
        market = (market[off:] + market[:off])[:MARKET_SLOTS]
    for i in range(MARKET_SLOTS):
        slot = f'CREATOR_MARKET_{i + 1:02d}'
        if i < len(market):
            save(market_card(market[i], art(market[i]['image_url'])), os.path.join(root, slot, '1.jpg'))
            manifest[slot] = {'active': [1], 'ids': [market[i]['id']], 'likes': [int(market[i].get('likes') or 0)]}
            print(f'{slot}: {market[i]["name"]}')
        else:
            manifest[slot] = {'active': []}  # empty -> the world shows its "your work here" fallback

    # Resident DJs: rotating gallery on the stage screen.
    djs = [c for c in feed.get('dj', []) if art(c.get('image_url'))][:MAX_GALLERY]
    for i, c in enumerate(djs):
        save(dj_card(c, art(c['image_url'])), os.path.join(root, 'STAGE_DJS', f'{i + 1}.jpg'))
    manifest['STAGE_DJS'] = {'active': list(range(1, len(djs) + 1)), 'rotate': 15,
                             'ids': [c['id'] for c in djs], 'likes': [int(c.get('likes') or 0) for c in djs]}
    print(f'STAGE_DJS: {len(djs)} card(s)')

    # Featured creator of the week: everyone with an approved card takes turns.
    everyone = sorted(
        [c for c in feed.get('market', []) + feed.get('dj', []) if art(c.get('image_url'))],
        key=lambda c: (c.get('approved_at') or '', c['id']),
    )
    if everyone:
        pick = everyone[week % len(everyone)]
        save(featured_card(pick, art(pick['image_url']), week_start), os.path.join(root, 'CREATOR_FEATURED_01', '1.jpg'))
        manifest['CREATOR_FEATURED_01'] = {'active': [1], 'ids': [pick['id']], 'likes': [int(pick.get('likes') or 0)]}
        print(f'CREATOR_FEATURED_01: {pick["name"]}')
    else:
        manifest['CREATOR_FEATURED_01'] = {'active': []}

    # Art & photo wall.
    wall = [w for w in feed.get('wall', []) if art(w.get('image_url'))][:MAX_GALLERY]
    for i, w in enumerate(wall):
        save(wall_card(w, art(w['image_url'])), os.path.join(root, 'CREATOR_WALL', f'{i + 1}.jpg'))
    manifest['CREATOR_WALL'] = {'active': list(range(1, len(wall) + 1)), 'rotate': 12,
                                'ids': [w['id'] for w in wall], 'likes': [int(w.get('likes') or 0) for w in wall]}
    print(f'CREATOR_WALL: {len(wall)} image(s)')

    os.makedirs(root, exist_ok=True)
    with open(os.path.join(root, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump({'v': 1, 'generated_at': now.isoformat(), 'slots': manifest, 'names': creator_names(feed)}, f, separators=(',', ':'))


if __name__ == '__main__':
    main()

"""Fetch the real product details for every garment in js/data.js from bruler.ru.

Run:  python tools/scrape_details.py            (writes js/details.json, downloads size charts to assets/sizes/)
      python tools/scrape_details.py --cache DIR (keeps the raw html pages in DIR for inspection)
      python tools/scrape_details.py --cache DIR --offline (re-parses the cached pages without any request)

What a bruler.ru product page really contains (verified 2026-10):
  * the size buttons (`selectVariant(...)`); sold-out sizes carry the class `disableds`
  * the description text, inside a Livewire snapshot (`"description":"..."`): a free-text block that also holds the
    composition lines ("... 100% нейлон"), design notes, styling tips and the model block ("Рост: 175 ... размер S")
  * an accordion "Уход и технологии" with the care instructions
  * a product that was removed from the shop answers 404 and is recorded as {"gone": true}
  * the size chart, which is a PICTURE (`/storage/products/<id>.png`, 5688 px, transparent), not a table; it is
    downloaded, cropped to the table block, flattened onto the paper colour and saved as a ~1400 px WebP in
    assets/sizes/ (needs Pillow + numpy; otherwise the original PNG is kept)
Nothing is invented: a field that a page does not contain is simply left out of the JSON.
Polite: one request at a time, a pause between requests, a descriptive User-Agent.
"""
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = 'https://bruler.ru'
UA = {'User-Agent': 'Mozilla/5.0 (compatible; bruler-pack showcase scraper; one request at a time)'}
DELAY = 1.2

SNAP = re.compile(r'wire:snapshot="([^"]*)"')
SIZE_BTN = re.compile(r'<button[^>]*?class="([^"]*)"[^>]*?wire:click="(?:selectVariant|\$dispatch\(\'open-notify\')[^"]*"[^>]*>\s*([A-Za-z0-9/\-. ]{1,8}?)\s*</button>', re.S)
CARE = re.compile(r'Уход и технологии</div>.*?x-collapse\s+class="pt-3">(?:\s|<!--.*?-->)*<div>(.*?)</div>', re.S)
CHART = re.compile(r'Размерная сетка</div>.*?<img[^>]*?src="([^"]+)"', re.S)
PCT = re.compile(r'\d+\s*%|^\d{1,3}\s+(?:хлопок|нейлон|полиэстер|эластан|вискоз|шерсть|акрил|лён|лен)', re.I)


def get(url, binary=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        data = r.read()
    return data if binary else data.decode('utf-8', 'ignore')


def to_lines(frag):
    """HTML fragment -> list of text lines (<br> = newline, tags dropped, entities decoded)."""
    t = re.sub(r'\s*[\r\n]+\s*', ' ', frag)       # source newlines are only formatting; <br> is the real break
    t = re.sub(r'<br\s*/?>', '\n', t)
    t = re.sub(r'</(p|div|li)>', '\n', t)
    t = re.sub(r'<[^>]+>', '', t)
    t = html.unescape(t).replace('\xa0', ' ')
    return [re.sub(r'[ \t]+', ' ', ln).strip() for ln in t.split('\n')]


def paragraphs(lines):
    out, cur = [], []
    for ln in lines:
        if ln:
            cur.append(ln)
        elif cur:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def parse_description(raw):
    blocks = paragraphs(to_lines(raw))
    res = {}
    models, rest = [], []
    for b in blocks:
        if b[0].lower().startswith('модель'):
            m = {'name': b[0].split(':', 1)[-1].strip()}
            for ln in b[1:]:
                k, _, v = ln.partition(':')
                k = k.strip().lower()
                if k == 'рост':
                    m['height'] = int(re.sub(r'\D', '', v) or 0) or None
                elif k == 'вес':
                    m['weight'] = int(re.sub(r'\D', '', v) or 0) or None
                else:
                    sm = re.search(r'размер\s+([A-Za-z0-9]+)', ln)
                    if sm:
                        m['size'] = sm.group(1)
            models.append({k: v for k, v in m.items() if v})
        else:
            rest.append(b)
    if models:
        res['models'] = models
    comp = [ln for b in rest for ln in b if PCT.search(ln)]
    if comp:
        res['composition'] = [re.sub(r'^Состав:?\s*', '', ln) for ln in comp]
    desc, details, wear = [], [], []
    for i, b in enumerate(rest):
        head = b[0].rstrip(':').lower()
        body = b[1:] if b[0].endswith(':') else b
        if i == 0 and not b[0].endswith(':'):
            desc.append(' '.join(ln for ln in b if ln not in comp))
        elif head.startswith('дизайн'):
            details += [ln for ln in body if ln not in comp]
        elif head.startswith('как носить'):
            wear += body
        elif not b[0].endswith(':'):
            # an untitled block: several short lines are a list of details, one line is a sentence of prose
            rest_lines = [ln for ln in b if ln not in comp]
            if len(b) > 1:
                details += rest_lines
            elif rest_lines:
                desc.append(rest_lines[0])
        else:
            details += [b[0]] + [ln for ln in body if ln not in comp]
    if desc:
        res['description'] = desc
    details = [ln for ln in details if not ln.endswith(':')]   # a bare heading whose lines moved to the composition
    if details:
        res['details'] = details
    if wear:
        res['wear'] = wear
    return res


def parse_page(s):
    out = {}
    # description lives in the Livewire snapshot that also holds the gallery
    for m in SNAP.finditer(s):
        try:
            d = json.loads(html.unescape(m.group(1)))
        except ValueError:
            continue
        raw = d.get('data', {}).get('description')
        if raw:
            out.update(parse_description(raw))
            break
    care = CARE.search(s)
    if care:
        lines = [ln for ln in to_lines(care.group(1)) if ln]
        if lines:
            out['care'] = lines
    sizes = []
    seen = set()
    for m in SIZE_BTN.finditer(s):
        cls, name = m.group(1), m.group(2).strip()
        if name in seen or 'btn-outlined' not in cls:
            continue
        seen.add(name)
        sizes.append({'name': name, 'available': 'disableds' not in cls})
    if sizes:
        out['sizes'] = sizes
    ch = CHART.search(s)
    if ch:
        out['chartSrc'] = SITE + ch.group(1).replace('\\', '/') if ch.group(1).startswith('\\') else ch.group(1)
    return out


def process_chart(png):
    """The shop's size charts are huge transparent PNGs (5688 px, garment sketch + table). Crop to the table block,
    flatten onto the paper colour and save a ~1400 px WebP. Needs Pillow + numpy; returns None without them."""
    try:
        import io
        import numpy as np
        from PIL import Image
    except ImportError:
        return None
    im = Image.open(io.BytesIO(png)).convert('RGBA')
    a = np.asarray(im)
    W, H = im.size
    # table rows are banded with one light blue-grey fill; its horizontal extent = the table block
    fill = (np.abs(a[..., :3].astype(int) - np.array([239, 243, 246])).max(axis=2) < 8) & (a[..., 3] > 200)
    colmask = fill.sum(axis=0) > H * 0.10
    # the table is the widest run of banded columns (gaps = the thin vertical rules are bridged)
    runs, start, last = [], None, None
    gap = int(W * 0.012)
    for x in np.where(colmask)[0]:
        if start is None:
            start = last = int(x)
        elif x - last <= gap:
            last = int(x)
        else:
            runs.append((start, last))
            start = last = int(x)
    if start is not None:
        runs.append((start, last))
    ys = np.where(a[..., 3] > 40)[0]
    ink = np.where(((a[..., :3].max(axis=2) < 110) & (a[..., 3] > 200)).sum(axis=0) > 0)[0]
    if runs:
        x0, x1 = max(runs, key=lambda r: r[1] - r[0])
        left = max(0, x0 - int(W * 0.01))
        right = min(W, max(x1, int(ink.max()) if ink.size else x1) + int(W * 0.012))
    else:
        left, right = 0, W
    top = max(0, int(ys.min()) - int(H * 0.02)) if ys.size else 0
    bottom = min(H, int(ys.max()) + int(H * 0.02)) if ys.size else H
    im = im.crop((left, top, right, bottom))
    bg = Image.new('RGBA', im.size, (241, 240, 236, 255))
    bg.alpha_composite(im)
    bg = bg.convert('RGB')
    if bg.width > 1400:
        bg = bg.resize((1400, round(bg.height * 1400 / bg.width)), Image.LANCZOS)
    out = io.BytesIO()
    bg.save(out, 'WEBP', quality=90, method=6)
    return out.getvalue()


def load_products():
    src = (ROOT / 'js' / 'data.js').read_text(encoding='utf-8')
    pat = re.compile(r"\{ id: '([^']+)'.*?url: '([^']+)'")
    return pat.findall(src)


def main():
    cache = None
    if '--cache' in sys.argv:
        cache = Path(sys.argv[sys.argv.index('--cache') + 1])
        cache.mkdir(parents=True, exist_ok=True)
    offline = '--offline' in sys.argv and cache is not None   # re-parse the cached pages, no requests
    (ROOT / 'assets' / 'sizes').mkdir(parents=True, exist_ok=True)
    result, charts = {}, {}
    prods = load_products()
    for n, (pid, url) in enumerate(prods):
        try:
            if offline and (cache / f'{pid}.html').exists():
                s = (cache / f'{pid}.html').read_text(encoding='utf-8')
            else:
                s = get(SITE + url)
        except urllib.error.HTTPError as e:
            print('FAIL', pid, e, file=sys.stderr)
            if e.code == 404:
                result[pid] = {'gone': True}   # the product page no longer exists on bruler.ru
            time.sleep(DELAY)
            continue
        except Exception as e:  # noqa: BLE001
            print('FAIL', pid, e, file=sys.stderr)
            continue
        if cache and not offline:
            (cache / f'{pid}.html').write_text(s, encoding='utf-8')
        d = parse_page(s)
        src = d.pop('chartSrc', None)
        if src:
            name = charts.get(src.rsplit('/', 1)[-1]) or src.rsplit('/', 1)[-1]
            if src.rsplit('/', 1)[-1] not in charts:
                time.sleep(DELAY)
                try:
                    raw = get(src, binary=True)
                    webp = process_chart(raw)
                    if webp:
                        name = name.rsplit('.', 1)[0] + '.webp'
                        (ROOT / 'assets' / 'sizes' / name).write_bytes(webp)
                    else:
                        (ROOT / 'assets' / 'sizes' / name).write_bytes(raw)
                    charts[src.rsplit('/', 1)[-1]] = name
                except Exception as e:  # noqa: BLE001
                    print('chart FAIL', pid, src, e, file=sys.stderr)
                    name = None
            if name:
                d['chart'] = f'assets/sizes/{name}'
        result[pid] = d
        print(f'[{n + 1}/{len(prods)}] {pid}: ' + ', '.join(sorted(d)))
        time.sleep(0 if offline else DELAY)
    out = ROOT / 'js' / 'details.json'
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('wrote', out)


if __name__ == '__main__':
    main()

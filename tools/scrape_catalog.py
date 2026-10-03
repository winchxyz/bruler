"""List every product card on bruler.ru category pages (href, name, price, cutout png id).

Run:  python tools/scrape_catalog.py > the-scratch.json
Used once to choose which extra garments to add to js/data.js.
"""
import html
import json
import re
import sys
import urllib.request

SITE = 'https://bruler.ru'
UA = {'User-Agent': 'Mozilla/5.0'}
CARD = re.compile(
    r'<a href="(https://bruler\.ru/[^"]+)">\s*<!--\[if BLOCK\]><!\[endif\]-->\s*<img[^>]*?src="https://bruler\.ru/storage/cache/\d+x\d+_\d+/products/([0-9A-Z]{26})\.(png|jpg)"[^>]*?alt="([^"]*)"',
    re.S,
)
PRICE = re.compile(r'([\d ]+)\s*₽')


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
        return r.read().decode('utf-8', 'ignore')


def main():
    seen = {}
    for cat in range(1, 17):
        for page in range(1, 6):
            url = f'{SITE}/collection/filter?category%5B0%5D={cat}&page={page}'
            try:
                s = get(url)
            except Exception as e:  # noqa: BLE001
                print('fail', url, e, file=sys.stderr)
                break
            n0 = len(seen)
            for m in CARD.finditer(s):
                href, pid, ext, alt = m.groups()
                if href in seen:
                    continue
                tail = s[m.end(): m.end() + 2500]
                pm = PRICE.search(tail)
                seen[href] = {
                    'url': href.replace(SITE, ''), 'png': pid, 'ext': ext, 'name': html.unescape(alt),
                    'price': int(pm.group(1).replace(' ', '').replace('\xa0', '')) if pm else None, 'cat': cat,
                }
            if len(seen) == n0:
                break
    json.dump(list(seen.values()), sys.stdout, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()

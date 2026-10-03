"""Download the 1000 px originals of every garment in js/data.js into assets/products/hi/.

bruler.ru category pages expose each product's cutout id (first gallery image); the original lives at
https://bruler.ru/storage/products/<id>.png. Output file name = the product's `file` field.

Run:  python tools/fetch_hi.py
"""
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scrape_catalog  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'products' / 'hi'
OUT.mkdir(parents=True, exist_ok=True)


def products():
    src = (ROOT / 'js' / 'data.js').read_text(encoding='utf-8')
    return [m.groups() for m in re.finditer(r"file: '([^']+)'.*?url: '([^']+)'", src)]


def main():
    import io, json
    cards = {c['url']: c for c in json.load(io.StringIO(sys_catalog()))}
    for file, url in products():
        out = OUT / f'{file}.png'
        c = cards.get(url)
        if not c or c['ext'] != 'png':
            print('!! no png cutout for', file, url)
            continue
        if out.exists():
            continue
        req = urllib.request.Request(f"https://bruler.ru/storage/products/{c['png']}.png", headers=scrape_catalog.UA)
        out.write_bytes(urllib.request.urlopen(req, timeout=60).read())
        print('ok', file, c['png'])


def sys_catalog():
    import contextlib, io, json
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        scrape_catalog.main()
    return buf.getvalue()


if __name__ == '__main__':
    main()

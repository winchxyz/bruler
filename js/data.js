// Catalogue for the wardrobe rail. Prices and links mirror bruler.ru (2026-10-02).
// `file` is the base name of the baked assets in assets/baked/ (see tools/bake.py);
// `group` is the tab the garment hangs under.
export const SITE = 'https://bruler.ru';

export const SIZES = ['XS', 'S', 'M', 'L', 'XL'];

// Tabs above the rail, in order. "Все" shows everything.
export const GROUPS = ['Верхняя одежда', 'Худи и зипы', 'Футболки', 'Джинсы и брюки', 'Свитера'];

export const PRODUCTS = [
  { id: 'bomber-beurre', file: 'bomber-beurre-graphite', name: 'Bomber “Beurré”', color: 'graphite gray', colorRu: 'графит', group: 'Верхняя одежда', price: 22490, url: '/verxniaia-odezda/bomberbeurregraphitegray', isNew: true },
  { id: 'bomber-beurre-black', file: 'bomber-beurre-black', name: 'Bomber “Beurré”', color: 'black', colorRu: 'чёрный', group: 'Верхняя одежда', price: 22490, url: '/verxniaia-odezda/bomberbeurreblack' },
  { id: 'wb-fragments-graphite', file: 'windbreaker-fragments-graphite', name: 'Windbreaker “Fragments d’étoiles”', color: 'graphite', colorRu: 'графит', group: 'Верхняя одежда', price: 19990, url: '/windbreakers/windbreakerfragmentsdetoilesgraphite', isNew: true },
  { id: 'wb-fragments-brown', file: 'windbreaker-fragments-brown', name: 'Windbreaker “Fragments d’étoiles”', color: 'brown', colorRu: 'коричневый', group: 'Верхняя одежда', price: 19990, url: '/windbreakers/windbreakerfragmentsdetoilesbrown', isNew: true },
  { id: 'wb-reve', file: 'windbreaker-reve-black', name: 'Windbreaker “Le Rêve”', color: 'black', colorRu: 'чёрный', group: 'Верхняя одежда', price: 14990, url: '/windbreakers/windbreakerlereveblack' },

  { id: 'hoodie-logo01', file: 'hoodie-logo01-black', name: 'Hoodie “Logo de base 01”', color: 'black', colorRu: 'чёрный', group: 'Худи и зипы', price: 9990, url: '/hoodies/hoodiebaseblack' },
  { id: 'zip-chateau', file: 'zip-chateau-black', name: 'Zip hoodie “Château de nuit”', color: 'black', colorRu: 'чёрный', group: 'Худи и зипы', price: 16990, url: '/zip-hoodies/ziphoodiechateaudenuitblack', isNew: true },
  { id: 'hoodie-pegase', file: 'hoodie-pegase-black', name: 'Hoodie “Pégase”', color: 'black', colorRu: 'чёрный', group: 'Худи и зипы', price: 9999, url: '/hoodies/hoodiepegaseblack' },
  { id: 'zip-blesser', file: 'zip-blesser-black', name: 'Zip hoodie “Blesser”', color: 'black garment washing', colorRu: 'чёрный варёный', group: 'Худи и зипы', price: 11999, url: '/zip-hoodies/ziphoodieblesserblackgarmentwashing' },
  { id: 'hoodie-violet', file: 'hoodie-violet-paradise', name: 'Hoodie “Violet Paradise”', color: 'purple', colorRu: 'фиолетовый', group: 'Худи и зипы', price: 10999, url: '/hoodies/violetparadisepurple' },

  { id: 'tee-autographe', file: 'tee-autographe-white', name: 'T-shirt “Autographe”', color: 'white', colorRu: 'белый', group: 'Футболки', price: 7890, url: '/t-shirts/tshirtautographewhite', isNew: true },
  { id: 'tee-u', file: 'tee-u-white', name: 'T-shirt “Û”', color: 'white', colorRu: 'белый', group: 'Футболки', price: 7890, url: '/t-shirts/tshirtuwhite', isNew: true },
  { id: 'tee-moscou', file: 'tee-moscou-white', name: 'T-shirt “+495 Moscou”', color: 'white', colorRu: 'белый', group: 'Футболки', price: 7890, url: '/t-shirts/tshirtmoscouwhite' },
  { id: 'tee-chateau', file: 'tee-chateau-black', name: 'T-shirt “Château”', color: 'black', colorRu: 'чёрный', group: 'Футболки', price: 7890, url: '/t-shirts/tshirtchateaublack' },

  { id: 'jeans-logo01', file: 'jeans-logo01-black', name: 'Jeans “Logo de base 01”', color: 'black', colorRu: 'чёрный', group: 'Джинсы и брюки', price: 12990, url: '/jeans/jeanslogodebaseblack', isNew: true },
  { id: 'jeans-logo02', file: 'jeans-logo02-blue', name: 'Jeans “Logo de base 02”', color: 'blue', colorRu: 'синий', group: 'Джинсы и брюки', price: 12990, url: '/jeans/jeanslogodebaseblue', isNew: true },
  { id: 'jeans-attache', file: 'jeans-attache-black', name: 'Jeans “Attache”', color: 'black', colorRu: 'чёрный', group: 'Джинсы и брюки', price: 14990, url: '/jeans/jeansattacheblack' },
  { id: 'pants-logo02', file: 'pants-logo02-grey', name: 'Pants “Logo de base 02”', color: 'grey melange', colorRu: 'серый меланж', group: 'Джинсы и брюки', price: 7990, url: '/briuki/pantslogodebasegreymelange', isNew: true },
  { id: 'pants-cargo', file: 'pants-cargo-gray', name: 'Cargo pants “Base”', color: 'gray', colorRu: 'серый', group: 'Джинсы и брюки', price: 11500, url: '/briuki/cargopantsgray' },

  { id: 'cardigan-travail', file: 'cardigan-travail-black', name: 'Cardigan “Travail tard”', color: 'black', colorRu: 'чёрный', group: 'Свитера', price: 11590, url: '/sweaters/cardigantravailtardblack' },
  { id: 'halfzip-logo01', file: 'halfzip-logo01-black', name: 'Half-zip “Logo de base 01”', color: 'black', colorRu: 'чёрный', group: 'Свитера', price: 10990, url: '/half-zips/halfzipbaseblack' },
  { id: 'halfzip-logo03', file: 'halfzip-logo03-grey', name: 'Half-zip “Logo de base 03”', color: 'grey melange', colorRu: 'серый меланж', group: 'Свитера', price: 10990, url: '/half-zips/halfzipbasegrey' },
  { id: 'sweatshirt-croquis', file: 'sweatshirt-croquis-darkblue', name: 'Sweatshirt “Croquis frais”', color: 'dark blue', colorRu: 'тёмно-синий', group: 'Свитера', price: 12499, url: '/hoodies/sweatshirtcroquisfraisdarkblue' },
];

// ---- shop facts (all real, from bruler.ru) -------------------------------------------------------------------
export const FREE_SHIP = 20000;            // free delivery from 20 000 ₽
export const PROMO = 'WELCOME10';          // first-order promo code
export const SUPPORT_EMAIL = 'support@bruler.ru';

// ---- real product details scraped from bruler.ru by tools/scrape_details.py ----------------------------------
// Shape per product id: { sizes: [{name, available}], composition[], care[], description[], details[], wear[],
// models: [{name, height, weight, size}], chart: 'assets/sizes/….webp' } or { gone: true } when the page is 404.
// Loaded once; a section that is missing in the data is simply not rendered.
export const DETAILS = {};
export const detailsReady = fetch(new URL('./details.json', import.meta.url))
  .then((r) => (r.ok ? r.json() : {}))
  .then((d) => { Object.assign(DETAILS, d); return DETAILS; })
  .catch(() => DETAILS);

// can this garment be bought from bruler.ru right now? (known sizes, at least one in stock)
export function stockOf(p) {
  const d = DETAILS[p.id];
  if (!d || d.gone) return { known: false, buyable: false, gone: !!(d && d.gone), sizes: [] };
  const sizes = d.sizes || [];
  return { known: sizes.length > 0, buyable: sizes.some((s) => s.available), gone: false, sizes };
}

// ---- «Собрать образ»: rule-based pairing --------------------------------------------------------------------
// top -> bottom + outerwear; bottom -> top + outerwear; outerwear -> top + bottom.
const ROLE_OF = { 'Верхняя одежда': 'outer', 'Худи и зипы': 'top', 'Футболки': 'top', 'Свитера': 'top', 'Джинсы и брюки': 'bottom' };
export const roleOf = (p) => ROLE_OF[p.group] || 'top';
const toneOf = (p) => (/white|grey|gray|melange|серый|бел/i.test(`${p.color} ${p.colorRu}`) ? 'light'
  : /black|graphite|dark|чёрн|графит|тёмн/i.test(`${p.color} ${p.colorRu}`) ? 'dark' : 'accent');
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0); };

export function outfitFor(p) {
  const role = roleOf(p), want = { top: ['bottom', 'outer'], bottom: ['top', 'outer'], outer: ['top', 'bottom'] }[role];
  const tone = toneOf(p);
  const picked = [];
  for (const r of want) {
    const pool = PRODUCTS.filter((c) => c.id !== p.id && roleOf(c) === r && !picked.includes(c) && !(DETAILS[c.id] && (DETAILS[c.id].gone || (DETAILS[c.id].sizes && !stockOf(c).buyable))));
    if (!pool.length) continue;
    // contrast in tone reads as an outfit; a stable hash keeps the choice varied but never random per visit
    const score = (c) => (toneOf(c) !== tone ? 8 : 0) + (toneOf(c) === 'accent' && tone === 'accent' ? -6 : 0) + (hash(p.id + '|' + c.id) % 8);
    pool.sort((a, b) => score(b) - score(a));
    picked.push(pool[0]);
  }
  return picked;
}

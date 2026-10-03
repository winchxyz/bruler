// Detail view: the rail fades behind a blur, the chosen garment flies out of its slot to the
// middle of the screen on a CSS-drawn hanger, with arrows to flip through the collection.
import { PRODUCTS, DETAILS, detailsReady, stockOf, outfitFor, SITE } from './data.js';
import { fmt, siteUrl, addToCart, reducedMotion, esc, lockScroll, unlockScroll, pushLayer, popLayer, hasLayer, trapTab } from './ui.js';
import { BAKED, HEIGHT } from './cloakroom.js';
import { hangerGeometry } from './cloth.js';
import { cart } from './cart.js';      // self-initialising: top-bar button, drawer, shop.css

const T = {
  title: 'Карточка товара',
  close: 'Закрыть',
  prev: 'Предыдущая вещь',
  next: 'Следующая вещь',
  size: 'Размер',
  pickSize: 'Выберите размер',
  add: 'В корзину',
  added: 'Добавлено',
  soldOut: 'Нет в наличии',
  avail: 'Открыть на bruler.ru',
  chart: 'Таблица размеров',
  chartTitle: 'Таблица размеров',
  onModel: 'На модели',
  scrollHint: 'Таблицу можно листать в стороны',
  care: 'Состав и уход',
  desc: 'Описание',
  composition: 'Состав',
  careLbl: 'Уход',
  details: 'Детали',
  wear: 'Как носить',
  look: 'Собрать образ',
  isNew: 'Новинка',
  none: 'Этой модели уже нет на bruler.ru',
  allGone: 'Все размеры раскуплены',
  unavailable: 'Нет в наличии',
};
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const pad = (n) => String(n).padStart(2, '0');

const ARROW = {
  prev: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

// The hanger is the rail's hanger: its arms sit INSIDE the garment (behind the front, under the shoulder line, so only
// the chrome neck and hook show at the collar, and at most the arm tips at the shoulder seams); trousers hang from a
// bar with two clips pinching the waistband. Its position comes from the garment's own silhouette (the same
// hangerGeometry the 3D rail uses), so it is straight and centred on the collar for every product. The back part is
// drawn behind the garment image, the clip plates in front of it.
const HOOK_TOP = 0.125;     // m above the garment's top edge that the hook reaches
const isBottomP = (p) => /^(jeans|pants)/.test(p.id);
const f4 = (v) => (+v).toFixed(4);
function hangerSpec(p, img) {
  const h = HEIGHT[p.group] || 0.8, w = (h * img.naturalWidth) / img.naturalHeight;
  const NX = 144, cw = NX * 2, ch = Math.max(2, Math.round((cw * img.naturalHeight) / img.naturalWidth));
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, cw, ch);
  const a = g.getImageData(0, 0, cw, ch).data;
  const op = (i, j) => a[(j * cw + i) * 4 + 3] > 128;
  const topRaw = new Float32Array(NX).fill(NaN);
  for (let ci = 0; ci < NX; ci++) for (let j = 0; j < ch; j++) if (op(ci * 2, j) || op(ci * 2 + 1, j)) { topRaw[ci] = -(j / ch) * h; break; }
  const cellAt = (x, y) => { const i = Math.floor((x / w + 0.5) * cw), j = Math.floor((-y / h) * ch); return i >= 0 && j >= 0 && i < cw && j < ch && op(i, j) ? 1 : 0; };
  const hw = Math.min(0.31, Math.max(0.19, w * 0.31));
  return { w, h, bottom: isBottomP(p), tee: /^tee/.test(p.id), ...hangerGeometry({ nx: NX, w, h, hw, topRaw, cellAt, tipMargin: 0.055 }) };
}
// Catmull-Rom through points -> smooth cubic path
function smoothPath(pts) {
  let d = `M${f4(pts[0][0])} ${f4(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += ` C${f4(p1[0] + (p2[0] - p0[0]) / 6)} ${f4(p1[1] + (p2[1] - p0[1]) / 6)} ${f4(p2[0] - (p3[0] - p1[0]) / 6)} ${f4(p2[1] - (p3[1] - p1[1]) / 6)} ${f4(p2[0])} ${f4(p2[1])}`;
  }
  return d;
}
const chromeStroke = (d, w) => `<path d="${d}" fill="none" stroke="#69707a" stroke-width="${f4(w)}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#eef0f3" stroke-width="${f4(w * 0.38)}" stroke-linecap="round" stroke-linejoin="round" transform="translate(${f4(-w * 0.16)} ${f4(-w * 0.12)})"/>`;
const woodStroke = (d, w) => `<path d="${d}" fill="none" stroke="#4a2218" stroke-width="${f4(w)}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#a9604a" stroke-width="${f4(w * 0.5)}" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 ${f4(-w * 0.18)})"/>`;
const clipPlate = (cx, withTop) => `<rect x="${f4(cx - 0.015)}" y="-0.014" width="0.03" height="0.056" rx="0.004" fill="url(#dchr)" stroke="#69707a" stroke-width="0.0012"/>${withTop ? `<rect x="${f4(cx - 0.015)}" y="-0.0155" width="0.03" height="0.01" rx="0.003" fill="url(#dchr)" stroke="#69707a" stroke-width="0.0012"/>` : ''}`;
function hangerSVG(sp, front) {
  const { w, h } = sp;
  const open = `<svg class="detail__hang${front ? ' detail__hang--front' : ''}" aria-hidden="true" viewBox="${f4(-w / 2)} ${f4(-HOOK_TOP)} ${f4(w)} ${f4(h + HOOK_TOP)}" style="top:${((-HOOK_TOP / h) * 100).toFixed(3)}%;height:${(((h + HOOK_TOP) / h) * 100).toFixed(3)}%" preserveAspectRatio="none">`
    + '<defs><linearGradient id="dchr" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#737a84"/><stop offset="0.45" stop-color="#f1f3f5"/><stop offset="1" stop-color="#868d97"/></linearGradient></defs>';
  if (front) return sp.bottom ? `${open}${sp.clipX.map((cx) => clipPlate(cx, false)).join('')}</svg>` : '';
  let body = '';
  const hook = `M0 -0.066 L0 -0.088 C0 -0.116 0.038 -0.116 0.038 -0.09 C0.038 -0.078 0.034 -0.07 0.03 -0.066`;
  if (sp.bottom) {
    const [c0, c1] = sp.clipX, half = (c1 - c0) / 2 + 0.06, mid = (c0 + c1) / 2;
    body += woodStroke(`M${f4(mid - half + 0.009)} -0.006 L${f4(mid + half - 0.009)} -0.006`, 0.018);
    body += chromeStroke('M0 -0.05 L0 -0.008', 0.011);
    body += sp.clipX.map((cx) => clipPlate(cx, true)).join('');
  } else {
    const r = sp.tee ? 0.0085 : 0.0105;
    body += woodStroke(smoothPath(sp.arm.map(([x, y]) => [x, -y])), r * 2);
    body += chromeStroke(`M0 -0.05 L0 ${f4(-sp.apexY)}`, 0.011);
  }
  body += `<rect x="-0.0105" y="-0.067" width="0.021" height="0.019" rx="0.004" fill="url(#dchr)" stroke="#69707a" stroke-width="0.0012"/>`;
  body += chromeStroke(hook, 0.0144);
  return `${open}${body}</svg>`;
}

// ---- artwork: the baked, alpha-trimmed 1000 px cutout + its baked soft shadow -----------
// Both are decoded off the main thread before anything animates, so opening never stalls.
const artCache = new Map();
function loadImg(src, cls) {
  const im = new Image();
  im.decoding = 'async';
  im.className = cls;
  im.alt = '';
  im.src = src;
  return im.decode().then(() => im);
}
function getArt(pi) {
  if (artCache.has(pi)) return artCache.get(pi);
  const f = PRODUCTS[pi].file;
  const prom = Promise.all([loadImg(`${BAKED}${f}.webp`, 'detail__img'), loadImg(`${BAKED}${f}.sa.png`, 'detail__shadow')])
    .then(([img, shadow]) => {
      img.setAttribute('role', 'img');
      const sp = hangerSpec(PRODUCTS[pi], img);
      return { img, shadow, back: hangerSVG(sp, false), front: hangerSVG(sp, true) };
    });
  artCache.set(pi, prom);
  return prom;
}

// ---- small renderers for the real product details ---------------------------------------------------------------
const lis = (arr, cls = '') => `<ul class="acc__list${cls}">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
const ps = (arr) => arr.map((x) => `<p>${esc(x)}</p>`).join('');
const sec = (label, html) => `<div class="acc__sec"><p class="acc__lbl">${label}</p>${html}</div>`;

function accordions(d) {
  const out = [];
  const comp = d.composition || [], care = d.care || [];
  if (comp.length || care.length) {
    out.push({ id: 'care', title: T.care, html: (comp.length ? sec(T.composition, lis(comp)) : '') + (care.length ? sec(T.careLbl, lis(care)) : '') });
  }
  const desc = d.description || [], det = d.details || [], wear = d.wear || [];
  if (desc.length || det.length || wear.length) {
    out.push({ id: 'desc', title: T.desc, html: (desc.length ? `<div class="acc__prose">${ps(desc)}</div>` : '') + (det.length ? sec(T.details, lis(det)) : '') + (wear.length ? sec(T.wear, lis(wear)) : '') });
  }
  return out;
}

const modelLine = (m) => [m.name, m.height && `рост ${m.height} см`, m.weight && `вес ${m.weight} кг`, m.size && `размер ${m.size}`].filter(Boolean);

// getCloak: () => cloakroom controller ({ slotRect(pi), setModal(bool) }).
export function initDetail({ getCloak }) {
  const N = PRODUCTS.length;
  const root = document.createElement('div');
  root.className = 'detail';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', T.title);
  root.tabIndex = -1;
  root.innerHTML = `
    <div class="detail__scroll">
      <div class="detail__main">
        <button class="detail__arrow detail__arrow--prev" type="button" aria-label="${T.prev}">${ARROW.prev}</button>
        <div class="detail__item"><div class="detail__art"></div></div>
        <button class="detail__arrow detail__arrow--next" type="button" aria-label="${T.next}">${ARROW.next}</button>
      </div>
      <div class="detail__info">
        <p class="detail__count"></p>
        <h2 class="detail__name"></h2>
        <p class="detail__meta"></p>
        <div class="detail__sizes" role="radiogroup" aria-label="${T.size}"></div>
        <button class="detail__sizelink" type="button" data-chart hidden>${T.chart}</button>
        <p class="detail__note" hidden></p>
        <p class="detail__err" role="alert"></p>
        <div class="detail__actions">
          <button class="pill pill--solid" type="button" data-add>${T.add}</button>
          <a class="pill" href="#" target="_blank" rel="noopener" data-view>${T.avail}</a>
        </div>
        <div class="acc" hidden></div>
        <section class="look" hidden aria-label="${T.look}">
          <p class="look__t">${T.look}</p>
          <div class="look__row"></div>
        </section>
      </div>
    </div>`;
  document.body.append(root);

  // size chart sheet: slides in from the right, over the detail view
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `
    <div class="sheet__veil" data-sheet-close></div>
    <aside class="sheet__panel" role="dialog" aria-modal="true" aria-label="${T.chartTitle}" tabindex="-1">
      <header class="sheet__head"><h2 class="sheet__title">${T.chartTitle}</h2>
        <button class="sheet__x" type="button" aria-label="${T.close}" data-sheet-close><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header>
      <div class="sheet__body"></div>
    </aside>`;
  document.body.append(sheet);
  const sheetPanel = sheet.querySelector('.sheet__panel'), sheetBody = sheet.querySelector('.sheet__body');

  // "Закрыть" lives in the top bar and replaces its links while the detail is open
  const topRight = document.querySelector('.topbar__side--right');
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'topbar__close';
  closeBtn.textContent = T.close;
  topRight && topRight.append(closeBtn);

  const $ = (s) => root.querySelector(s);
  const mainEl = $('.detail__main'), itemEl = $('.detail__item'), artEl = $('.detail__art'), infoEl = $('.detail__info');
  const arrows = [...root.querySelectorAll('.detail__arrow')];
  const countEl = $('.detail__count'), nameEl = $('.detail__name'), metaEl = $('.detail__meta');
  const sizesEl = $('.detail__sizes'), errEl = $('.detail__err'), noteEl = $('.detail__note'), chartBtn = $('[data-chart]');
  const addBtn = $('[data-add]'), viewBtn = $('[data-view]');
  const accEl = $('.acc'), lookEl = $('.look'), lookRow = $('.look__row');

  let idx = 0, isOpen = false, closing = false, busy = false, picked = null, lastFocus = null;
  let addTimer = 0, canBuy = false;

  const isBottom = (p) => /^(jeans|pants)/.test(p.id);

  // ---- accordions: grid-rows height animation, one open at a time is not enforced ---------------------------------
  function buildAcc(d) {
    const list = d ? accordions(d) : [];
    accEl.hidden = !list.length;
    accEl.innerHTML = list.map((a) => `
      <div class="acc__item">
        <button class="acc__btn" type="button" aria-expanded="false" aria-controls="acc-${a.id}" id="acc-b-${a.id}"><span>${a.title}</span><i aria-hidden="true"></i></button>
        <div class="acc__panel" id="acc-${a.id}" role="region" aria-labelledby="acc-b-${a.id}"><div class="acc__in">${a.html}</div></div>
      </div>`).join('');
  }
  accEl.addEventListener('click', (e) => {
    const b = e.target.closest('.acc__btn');
    if (!b) return;
    const on = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(on));
    b.parentElement.classList.toggle('is-open', on);
  });

  // ---- «Собрать образ» -----------------------------------------------------------------------------------------------
  function buildLook(p) {
    const pieces = outfitFor(p);
    lookEl.hidden = pieces.length < 1;
    lookRow.innerHTML = pieces.map((c) => `
      <button class="look__card" type="button" data-to="${PRODUCTS.indexOf(c)}" aria-label="${esc(c.name)}, ${esc(c.colorRu || c.color)}, ${fmt(c.price)}">
        <span class="look__img"><img src="${BAKED}${c.file}.m.webp" alt="" loading="lazy" decoding="async"></span>
        <span class="look__name">${esc(c.name)}</span>
        <span class="look__price">${fmt(c.price)}</span>
      </button>`).join('');
  }
  lookRow.addEventListener('click', (e) => {
    const c = e.target.closest('.look__card');
    if (c) goTo(+c.dataset.to);
  });

  async function render(pi) {
    const p = PRODUCTS[pi];
    const [{ img: art, shadow, back, front }] = await Promise.all([getArt(pi), detailsReady]);
    idx = pi;
    picked = null;
    const d = DETAILS[p.id] || null;
    const st = stockOf(p);
    canBuy = st.buyable;
    art.setAttribute('aria-label', `${p.name}, ${p.colorRu || p.color}`);
    artEl.innerHTML = '';
    artEl.append(shadow);
    artEl.insertAdjacentHTML('beforeend', back);     // the hanger behind the garment
    artEl.append(art);
    if (front) artEl.insertAdjacentHTML('beforeend', front);   // clip plates in front of the waistband
    mainEl.style.setProperty('--asp', (art.naturalWidth / art.naturalHeight).toFixed(4));
    artEl.classList.toggle('is-bottom', isBottom(p));
    countEl.innerHTML = `${pad(pi + 1)} / ${pad(N)}${p.isNew ? `<span class="detail__new">${T.isNew}</span>` : ''}`;
    nameEl.textContent = p.name;
    metaEl.innerHTML = `<span>${esc(p.colorRu || p.color)}</span><span class="detail__price">${fmt(p.price)}</span>`;

    // sizes: only what bruler.ru really lists; sold-out ones are struck through and disabled
    sizesEl.hidden = !st.known;
    sizesEl.innerHTML = st.sizes.map((s) => `<button class="detail__size" type="button" role="radio" aria-checked="false" data-size="${esc(s.name)}"${s.available ? '' : ` disabled title="${T.unavailable}" aria-label="${esc(s.name)}, ${T.unavailable}"`}>${esc(s.name)}</button>`).join('');
    chartBtn.hidden = !(d && d.chart);
    const note = st.gone ? T.none : st.known && !st.buyable ? T.allGone : '';
    noteEl.hidden = !note;
    noteEl.textContent = note;
    errEl.textContent = '';
    sizesEl.classList.remove('is-err');
    addBtn.disabled = !canBuy;
    addBtn.classList.toggle('is-off', !canBuy);
    viewBtn.href = st.gone ? `${SITE}/collection` : siteUrl(p.url);
    clearTimeout(addTimer);
    addBtn.textContent = canBuy ? T.add : T.soldOut;
    buildAcc(d);
    buildLook(p);
    sheetBody.innerHTML = '';
    hideLoupe();
  }

  const anim = (el, frames, opts) => (reducedMotion ? null : el.animate(frames, opts));
  const done = (a) => (a ? a.finished.catch(() => {}) : Promise.resolve());

  // Transform that maps the cropped garment's final rect onto a rect (the rail slot).
  function flightTo(rect) {
    const t = artEl.getBoundingClientRect();
    const ir = itemEl.getBoundingClientRect();
    const tcx = t.left + t.width / 2, tcy = t.top + t.height / 2;
    const dx = rect.left + rect.width / 2 - tcx, dy = rect.top + rect.height / 2 - tcy;
    const s = t.width ? rect.width / t.width : 1;
    itemEl.style.transformOrigin = `${tcx - ir.left}px ${tcy - ir.top}px`;
    return `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${s.toFixed(4)})`;
  }

  async function open(pi) {
    if (isOpen) return;
    isOpen = true;
    lastFocus = document.activeElement;
    const cloak = getCloak();
    const slot = cloak ? cloak.slotRect(pi) : null;
    await render(pi);
    cloak && cloak.setModal(true);          // freezes the rail into a blurred snapshot first
    root.classList.add('is-open');
    root.scrollTop = 0;
    lockScroll();
    document.body.classList.add('is-detail');
    root.focus({ preventScroll: true });
    getArt((pi + 1) % N); getArt((pi + N - 1) % N);   // neighbours decode while the view is open

    if (slot) {
      const from = flightTo(slot);
      anim(itemEl, [
        { transform: from, opacity: 0 },
        { transform: from, opacity: 1, offset: 0.18 },
        { transform: 'none', opacity: 1 },
      ], { duration: 640, easing: EASE, fill: 'backwards' });
    }
    anim(infoEl, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 220, easing: EASE, fill: 'backwards' });
    for (const a of arrows) anim(a, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 320, fill: 'backwards' });
  }

  async function close() {
    if (!isOpen || closing) return;
    closing = true;
    closeSheet(true);
    hideLoupe();
    document.body.classList.remove('is-detail');
    const cloak = getCloak();
    cloak && cloak.setModal(false);         // the rail wakes up behind the flight
    const rect = cloak ? cloak.slotRect(idx) : null;
    const runs = [];
    if (rect && root.scrollTop > 4) { root.scrollTo({ top: 0 }); }
    if (rect) {
      const to = flightTo(rect);
      runs.push(anim(itemEl, [
        { transform: 'none', opacity: 1 },
        { transform: 'none', opacity: 1, offset: 0.15 },
        { transform: to, opacity: 0 },
      ], { duration: 560, easing: 'cubic-bezier(0.55, 0, 0.25, 1)', fill: 'forwards' }));
    }
    runs.push(anim(infoEl, [{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' }));
    for (const a of arrows) runs.push(anim(a, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }));
    await Promise.all(runs.map(done));
    root.classList.remove('is-open');
    for (const el of [itemEl, infoEl, ...arrows]) el.getAnimations().forEach((a) => a.cancel());
    itemEl.style.transformOrigin = '';
    unlockScroll();
    isOpen = false;
    closing = false;
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  }

  // go(dir): the arrows; goTo(i): an outfit card. Both slide the garment out, swap, and slide the next one in.
  async function goTo(next, dir = next > idx ? 1 : -1) {
    if (!isOpen || closing || busy || next === idx) return;
    busy = true;
    hideLoupe();
    if (root.scrollTop > 4) root.scrollTo({ top: 0, behavior: 'smooth' });
    const pre = getArt(next);
    const out = [
      anim(itemEl, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-48 * dir}px)` }], { duration: 220, easing: 'ease-in', fill: 'forwards' }),
      anim(infoEl, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }),
    ];
    await Promise.all([...out.map(done), pre]);
    await render(next);
    const ins = [
      anim(itemEl, [{ opacity: 0, transform: `translateX(${48 * dir}px)` }, { opacity: 1, transform: 'none' }], { duration: 460, easing: EASE }),
      anim(infoEl, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 400, easing: EASE }),
    ];
    for (const a of out) a && a.cancel();
    await Promise.all(ins.map(done));
    busy = false;
  }
  const go = (dir) => goTo((idx + dir + N) % N, dir);

  // ---- size sheet ---------------------------------------------------------------------------------------------------
  let sheetOn = false, sheetFocus = null;
  function openSheet() {
    const p = PRODUCTS[idx], d = DETAILS[p.id];
    if (!d || !d.chart || sheetOn) return;
    sheetFocus = document.activeElement;
    const models = (d.models || []).map(modelLine).filter((m) => m.length > 1);
    sheetBody.innerHTML = `
      <p class="sheet__name">${esc(p.name)}<span>${esc(p.colorRu || p.color)}</span></p>
      <div class="sheet__chart"><img src="${d.chart}" alt="${T.chartTitle}: ${esc(p.name)}" decoding="async"></div>
      <p class="sheet__hint">${T.scrollHint}</p>
      ${models.length ? `<div class="sheet__models"><p class="acc__lbl">${T.onModel}</p><ul>${models.map((m) => `<li><b>${esc(m[0])}</b>${m.slice(1).map((x) => `<span>${esc(x)}</span>`).join('')}</li>`).join('')}</ul></div>` : ''}`;
    sheetBody.scrollTop = 0;
    sheetOn = true;
    sheet.classList.add('is-on');
    void sheet.offsetWidth;
    sheet.classList.add('is-in');
    pushLayer('sheet');
    hideLoupe();
    sheetPanel.focus({ preventScroll: true });
  }
  function closeSheet(quick) {
    if (!sheetOn) return;
    sheetOn = false;
    popLayer('sheet');
    sheet.classList.remove('is-in');
    setTimeout(() => { if (!sheetOn) sheet.classList.remove('is-on'); }, quick ? 0 : 520);
    if (!quick && sheetFocus && sheetFocus.focus && document.contains(sheetFocus)) sheetFocus.focus({ preventScroll: true });
  }
  chartBtn.addEventListener('click', openSheet);
  sheet.addEventListener('click', (e) => { if (e.target.closest('[data-sheet-close]')) closeSheet(); });
  // registered before the detail view's own key handler so it can claim Escape / Tab first
  document.addEventListener('keydown', (e) => {
    if (!sheetOn) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeSheet(); return; }
    if (trapTab(e, sheetPanel)) e.stopImmediatePropagation();
    else if (e.key.startsWith('Arrow')) e.stopImmediatePropagation();
  });

  // ---- add to cart: the garment flies to the counter on an arc, the counter pops, the drawer peeks -------------------
  const FLY_MS = 620;
  function flyToCart() {
    const img = artEl.querySelector('.detail__img');
    const target = document.querySelector('.topbar__cart');
    if (!img || !target || reducedMotion) { setTimeout(() => cart.peek(), 120); return; }
    const r = img.getBoundingClientRect();
    const tr = (document.querySelector('[data-count="cart"]') || target).getBoundingClientRect();
    const dx = tr.left + tr.width / 2 - (r.left + r.width / 2), dy = tr.top + tr.height / 2 - (r.top + r.height / 2);
    const s = Math.max(0.03, Math.min(0.2, 22 / r.height));
    const ghost = document.createElement('div');
    ghost.className = 'fly';
    ghost.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    const inner = document.createElement('div');
    inner.className = 'fly__in';
    const im = new Image();
    im.src = img.currentSrc || img.src;
    im.alt = '';
    inner.append(im);
    ghost.append(inner);
    document.body.append(ghost);
    // x eases out and y eases in: together they bow the path into an arc
    const ax = ghost.animate([{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${dx.toFixed(1)}px,0,0)` }], { duration: FLY_MS, easing: 'cubic-bezier(0.3, 0.55, 0.45, 1)', fill: 'forwards' });
    inner.animate([
      { transform: 'translate3d(0,0,0) scale(1)', opacity: 1 },
      { transform: `translate3d(0,${(dy * 0.55).toFixed(1)}px,0) scale(${(0.22 + s * 0.3).toFixed(3)})`, opacity: 1, offset: 0.62 },
      { transform: `translate3d(0,${dy.toFixed(1)}px,0) scale(${s.toFixed(3)})`, opacity: 0.35 },
    ], { duration: FLY_MS, easing: 'cubic-bezier(0.5, 0, 0.75, 0.4)', fill: 'forwards' });
    ax.finished.catch(() => {}).then(() => { ghost.remove(); setTimeout(() => cart.peek(), 380); });   // after the counter pop
  }

  // ---- fabric loupe: 160 px circle, the 1000 px picture at 2.2x under the pointer ---------------------------------
  const LOUPE = 160, ZOOM = 2.2;
  const loupe = document.createElement('div');
  loupe.className = 'loupe';
  loupe.setAttribute('aria-hidden', 'true');
  document.body.append(loupe);
  let loupeOn = false, loupeSrc = '';
  const alphaMasks = new WeakMap();
  function opaqueAt(img, u, v) {
    let m = alphaMasks.get(img);
    if (!m) {
      const w = 96, h = Math.max(2, Math.round((w * img.naturalHeight) / img.naturalWidth));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, w, h);
      m = { w, h, a: g.getImageData(0, 0, w, h).data };
      alphaMasks.set(img, m);
    }
    const x = Math.min(m.w - 1, Math.max(0, Math.floor(u * m.w))), y = Math.min(m.h - 1, Math.max(0, Math.floor(v * m.h)));
    return m.a[(y * m.w + x) * 4 + 3] > 40;
  }
  function hideLoupe() {
    if (!loupeOn) return;
    loupeOn = false;
    loupe.classList.remove('is-on');
  }
  function moveLoupe(x, y, lift) {
    const img = artEl.querySelector('.detail__img');
    if (!isOpen || closing || busy || hasLayer() || !img || !img.naturalWidth) { hideLoupe(); return; }
    const r = img.getBoundingClientRect();
    const u = (x - r.left) / r.width, v = (y - r.top) / r.height;
    if (u < 0 || u > 1 || v < 0 || v > 1 || !opaqueAt(img, u, v)) { hideLoupe(); return; }
    const src = img.currentSrc || img.src;
    if (src !== loupeSrc) { loupeSrc = src; loupe.style.backgroundImage = `url("${src}")`; }
    loupe.style.backgroundSize = `${(r.width * ZOOM).toFixed(1)}px ${(r.height * ZOOM).toFixed(1)}px`;
    loupe.style.backgroundPosition = `${(LOUPE / 2 - u * r.width * ZOOM).toFixed(1)}px ${(LOUPE / 2 - v * r.height * ZOOM).toFixed(1)}px`;
    loupe.style.transform = `translate3d(${(x - LOUPE / 2).toFixed(1)}px, ${(y - LOUPE / 2 - lift).toFixed(1)}px, 0)`;
    if (!loupeOn) { loupeOn = true; loupe.classList.add('is-on'); }
  }
  const FINE = matchMedia('(hover: hover) and (pointer: fine)');
  mainEl.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && FINE.matches) moveLoupe(e.clientX, e.clientY, 0);
    else if (e.pointerType !== 'mouse' && touchLoupe) { moveLoupe(e.clientX, e.clientY, 96); }
  });
  mainEl.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideLoupe(); });
  // touch: a long press shows it, dragging moves it, lifting hides it
  let touchLoupe = false, pressTimer = 0, px = 0, py = 0;
  const endPress = () => { clearTimeout(pressTimer); if (touchLoupe) { touchLoupe = false; hideLoupe(); } };
  mainEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    px = e.clientX; py = e.clientY;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      if (!isOpen || busy) return;
      touchLoupe = true; sid = -1;
      moveLoupe(px, py, 96);
      if (!loupeOn) touchLoupe = false;
    }, 380);
  });
  mainEl.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') return;
    px = e.clientX; py = e.clientY;
    if (!touchLoupe && Math.hypot(e.clientX - sx, e.clientY - sy) > 9) clearTimeout(pressTimer);
  });
  mainEl.addEventListener('touchmove', (e) => { if (touchLoupe) e.preventDefault(); }, { passive: false });
  mainEl.addEventListener('contextmenu', (e) => { if (touchLoupe || pressTimer) e.preventDefault(); });
  for (const t of ['pointerup', 'pointercancel']) mainEl.addEventListener(t, (e) => { if (e.pointerType === 'touch') endPress(); });

  // ---- events -------------------------------------------------------------
  closeBtn.addEventListener('click', close);
  document.addEventListener('cart:collection', () => { if (isOpen) close(); });
  arrows[0].addEventListener('click', () => go(-1));
  arrows[1].addEventListener('click', () => go(1));

  sizesEl.addEventListener('click', (e) => {
    const b = e.target.closest('.detail__size');
    if (!b || b.disabled) return;
    picked = b.dataset.size;
    sizesEl.querySelectorAll('.detail__size').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    sizesEl.classList.remove('is-err');
    errEl.textContent = '';
  });

  addBtn.addEventListener('click', () => {
    if (!canBuy) return;
    if (!picked) {
      errEl.textContent = T.pickSize;
      sizesEl.classList.remove('is-err');
      void sizesEl.offsetWidth;
      sizesEl.classList.add('is-err');
      return;
    }
    addToCart(PRODUCTS[idx], picked, { countDelay: reducedMotion ? 0 : FLY_MS });
    flyToCart();
    addBtn.textContent = T.added;
    clearTimeout(addTimer);
    addTimer = setTimeout(() => { addBtn.textContent = T.add; }, 1600);
  });

  document.addEventListener('keydown', (e) => {
    if (!isOpen || hasLayer()) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'Tab') {
      const f = [closeBtn, ...root.querySelectorAll('button:not([disabled]), a[href]')].filter((n) => n.offsetParent !== null);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
    }
  });

  // swipe left / right on the garment
  let sx = 0, sy = 0, sid = -1;
  mainEl.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { sx = e.clientX; sy = e.clientY; sid = e.pointerId; } });
  mainEl.addEventListener('pointerup', (e) => {
    if (e.pointerId !== sid) return;
    sid = -1;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  });

  // ---- «Новинка» next to the rail's caption --------------------------------------------------------------------
  // The rail owns .cloak__caption and rewrites its text on hover; a tiny observer re-adds the tag after each rewrite.
  const nameToProduct = new Map(PRODUCTS.map((p) => [`${p.name} — ${p.colorRu || p.color}`, p]));
  function watchCaption(cap) {
    let busyTag = false;
    const tag = () => {
      if (busyTag) return;
      busyTag = true;
      const p = nameToProduct.get(cap.textContent.replace(T.isNew, '').trim());
      const has = cap.querySelector('.cloak__new');
      if (p && p.isNew && !has) cap.insertAdjacentHTML('beforeend', `<i class="cloak__new">${T.isNew}</i>`);
      else if ((!p || !p.isNew) && has) has.remove();
      busyTag = false;
    };
    new MutationObserver(tag).observe(cap, { childList: true, characterData: true, subtree: true });
    tag();
  }
  const capNow = document.querySelector('.cloak__caption');
  if (capNow) watchCaption(capNow);
  else {
    const host = document.getElementById('cloakroom') || document.body;
    const wait = new MutationObserver(() => { const c = document.querySelector('.cloak__caption'); if (c) { wait.disconnect(); watchCaption(c); } });
    wait.observe(host, { childList: true, subtree: true });
  }

  return { open, close, isOpen: () => isOpen };
}

// Cart: state in localStorage, the top-bar counter, and a right-hand drawer.
// This site cannot take payment: «Оформить» opens a step that sends each item to its page on bruler.ru.
// Importing this module is enough: it injects css/shop.css, binds .topbar__cart and registers itself with ui.js.
import { PRODUCTS, FREE_SHIP, PROMO, SUPPORT_EMAIL, DETAILS, SITE } from './data.js';
import { fmt, esc, bump, toast, lockScroll, unlockScroll, pushLayer, popLayer, trapTab, setCartAdder, store } from './ui.js';

const KEY = 'bruler-cart-v1';
const THUMB = (p) => `assets/baked/${p.file}.m.webp`;
const byId = new Map(PRODUCTS.map((p) => [p.id, p]));
const MAX_QTY = 9;
const T = {
  added: 'Добавлено в корзину', title: 'Корзина', close: 'Закрыть корзину', empty: 'В корзине пока пусто', emptySub: 'Вещи, которые вы выберете, появятся здесь.',
  back: 'Вернуться к коллекции', go: 'Оформить на bruler.ru', total: 'Итого', untilFree: 'До бесплатной доставки:', free: 'Доставка бесплатно',
  promoPre: 'Промокод', promoPost: 'на первый заказ', copy: 'Скопировано', note: 'Доставка и промокод учитываются при оформлении на bruler.ru.',
  ckBack: 'Назад в корзину', ckTitle: 'Покупка оформляется на bruler.ru',
  ckLead: 'Это сайт-витрина, оплатить здесь нельзя. Откройте каждую вещь на bruler.ru, выберите размер и оформите заказ.',
  open: 'Открыть на bruler.ru', openShop: 'Открыть каталог на bruler.ru', gone: 'Этой модели уже нет в каталоге', help: 'Вопросы по заказу',
  remove: 'Удалить', removed: 'Удалено', undo: 'Вернуть', minus: 'Меньше', plus: 'Больше',
};
const ICON_X = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ICON_ARROW = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const ICON_BACK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
const ICON_OUT = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg>';

// ---- state -----------------------------------------------------------------------------------------------------
let items = [];   // [{ id, size, qty }]
const keyOf = (it) => `${it.id}|${it.size}`;
function load() {
  try {
    const raw = JSON.parse(store.get(KEY) || '[]');
    items = Array.isArray(raw) ? raw.filter((r) => r && byId.has(r.id) && typeof r.size === 'string' && r.qty > 0).map((r) => ({ id: r.id, size: r.size, qty: Math.min(MAX_QTY, r.qty | 0) })) : [];
  } catch (e) { items = []; }
}
const save = () => store.set(KEY, JSON.stringify(items));
const count = () => items.reduce((n, it) => n + it.qty, 0);
const subtotal = () => items.reduce((s, it) => s + byId.get(it.id).price * it.qty, 0);

// ---- DOM -------------------------------------------------------------------------------------------------------
if (!document.querySelector('link[data-shop-css]')) {
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'css/shop.css'; l.dataset.shopCss = '';
  document.head.append(l);
}
const root = document.createElement('div');
root.className = 'cart';
root.innerHTML = `
  <div class="cart__veil" data-close></div>
  <aside class="cart__panel" role="dialog" aria-modal="true" aria-label="${T.title}" tabindex="-1">
    <header class="cart__head">
      <h2 class="cart__title">${T.title}<span class="cart__n" aria-hidden="true"></span></h2>
      <button class="cart__x" type="button" aria-label="${T.close}" data-close>${ICON_X}</button>
    </header>
    <div class="cart__views">
      <section class="cart__view cart__view--cart" data-view="cart">
        <div class="cart__body"></div>
        <footer class="cart__foot"></footer>
      </section>
      <section class="cart__view cart__view--ck" data-view="ck" aria-hidden="true" inert></section>
    </div>
    <div class="cart__undo" role="status" aria-live="polite"><span></span><button type="button">${T.undo}</button></div>
  </aside>`;
document.body.append(root);

const $ = (s) => root.querySelector(s);
const panel = $('.cart__panel'), bodyEl = $('.cart__body'), footEl = $('.cart__foot'), ckEl = $('[data-view="ck"]'), cartView = $('[data-view="cart"]');
const nEl = $('.cart__n'), undoEl = $('.cart__undo'), undoMsg = undoEl.querySelector('span'), undoBtn = undoEl.querySelector('button');

let isOpen = false, mode = 'closed';   // 'closed' | 'peek' | 'open'
let lastFocus = null, peekTimer = 0, undoTimer = 0, undoData = null, hideTimer = 0;
let newKey = null;

// ---- rendering -------------------------------------------------------------------------------------------------
function lineHTML(it) {
  const p = byId.get(it.id);
  return `<li class="line${keyOf(it) === newKey ? ' is-new' : ''}" data-key="${esc(keyOf(it))}">
    <a class="line__img" href="${SITE + p.url}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true"><img src="${THUMB(p)}" alt="" width="64" height="64" loading="lazy" decoding="async"></a>
    <div class="line__main">
      <p class="line__name">${esc(p.name)}</p>
      <p class="line__meta">${esc(p.colorRu || p.color)} · ${esc(it.size)}</p>
      <div class="line__qty" role="group" aria-label="Количество">
        <button type="button" data-act="dec" aria-label="${T.minus}"${it.qty <= 1 ? ' disabled' : ''}><svg viewBox="0 0 12 12" width="10" height="10"><path d="M2 6h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></button>
        <span class="line__q" aria-live="polite">${it.qty}</span>
        <button type="button" data-act="inc" aria-label="${T.plus}"${it.qty >= MAX_QTY ? ' disabled' : ''}><svg viewBox="0 0 12 12" width="10" height="10"><path d="M2 6h8M6 2v8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></button>
      </div>
    </div>
    <div class="line__side">
      <p class="line__price">${fmt(p.price * it.qty)}</p>
      <button class="line__rm" type="button" data-act="rm" aria-label="${T.remove}: ${esc(p.name)}, ${esc(it.size)}">${ICON_X}</button>
    </div>
  </li>`;
}

function footHTML() {
  const sub = subtotal(), left = Math.max(0, FREE_SHIP - sub), pr = Math.min(1, sub / FREE_SHIP);
  return `
    <div class="ship">
      <p class="ship__txt">${left > 0 ? `${T.untilFree} <b>${fmt(left)}</b>` : `<b>${T.free}</b>`}</p>
      <div class="ship__bar" role="progressbar" aria-valuemin="0" aria-valuemax="${FREE_SHIP}" aria-valuenow="${Math.min(sub, FREE_SHIP)}"><i style="transform:scaleX(${pr.toFixed(4)})"></i></div>
    </div>
    <p class="promo">${T.promoPre} <button class="promo__code" type="button" data-act="copy" aria-label="Скопировать промокод ${PROMO}">${PROMO}</button> ${T.promoPost}</p>
    <div class="sum"><span>${T.total}</span><b>${fmt(sub)}</b></div>
    <p class="cart__note">${T.note}</p>
    <button class="pill pill--solid cart__go" type="button" data-act="go">${T.go}</button>`;
}

function emptyHTML() {
  return `<div class="empty">
    <p class="empty__t">${T.empty}</p>
    <p class="empty__s">${T.emptySub}</p>
    <button class="pill" type="button" data-act="collection">${T.back}</button>
  </div>`;
}

function ckHTML() {
  const rows = items.map((it) => {
    const p = byId.get(it.id), d = DETAILS[p.id], gone = d && d.gone;
    return `<li class="ck__row">
      <img src="${THUMB(p)}" alt="" width="52" height="52" decoding="async">
      <div class="ck__txt"><p class="line__name">${esc(p.name)}</p><p class="line__meta">${esc(p.colorRu || p.color)} · ${esc(it.size)}${it.qty > 1 ? ` · ${it.qty} шт.` : ''}</p>${gone ? `<p class="ck__gone">${T.gone}</p>` : ''}</div>
      <a class="ck__open" href="${gone ? SITE + '/collection' : SITE + p.url}" target="_blank" rel="noopener">${gone ? T.openShop : T.open}${ICON_OUT}</a>
    </li>`;
  }).join('');
  return `
    <div class="ck__scroll">
      <button class="ck__back" type="button" data-act="back">${ICON_BACK}<span>${T.ckBack}</span></button>
      <h3 class="ck__title">${T.ckTitle}</h3>
      <p class="ck__lead">${T.ckLead}</p>
      <ul class="ck__list">${rows}</ul>
      <p class="promo promo--ck">${T.promoPre} <button class="promo__code" type="button" data-act="copy" aria-label="Скопировать промокод ${PROMO}">${PROMO}</button> ${T.promoPost}</p>
    </div>
    <footer class="ck__foot"><span>${T.help}</span><a class="ul" href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></footer>`;
}

function renderCount(pop) {
  const n = count();
  const el = document.querySelector('[data-count="cart"]');
  if (el) { el.textContent = n; if (pop) bump('[data-count="cart"]', n); }
  const b = document.querySelector('.topbar__cart');
  if (b) b.setAttribute('aria-label', `${T.title}${n ? ', ' + n : ''}`);
  nEl.textContent = n ? ` ${n}` : '';
}

function render() {
  const has = items.length > 0;
  root.classList.toggle('is-empty', !has);
  bodyEl.innerHTML = has ? `<ul class="lines">${items.map(lineHTML).join('')}</ul>` : emptyHTML();
  footEl.innerHTML = has ? footHTML() : '';
  newKey = null;
  if (ckEl.dataset.on) ckEl.innerHTML = ckHTML();
}

function refreshTotals() {
  footEl.innerHTML = footHTML();
  renderCount(false);
}

// ---- open / close ----------------------------------------------------------------------------------------------
function show() {
  clearTimeout(hideTimer);
  root.classList.add('is-on');
  void root.offsetWidth;
  root.classList.add('is-in');
}
function hide() {
  root.classList.remove('is-in');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (mode === 'closed') root.classList.remove('is-on'); }, 520);
}

function open() {
  clearTimeout(peekTimer);
  if (mode === 'open') return;
  const fromPeek = mode === 'peek';
  mode = 'open';
  root.classList.remove('is-peek');
  if (!fromPeek) lastFocus = document.activeElement;
  setView('cart');
  render();
  show();
  lockScroll(); pushLayer('cart');
  panel.setAttribute('aria-modal', 'true');
  panel.focus({ preventScroll: true });
}

function close() {
  clearTimeout(peekTimer);
  if (mode === 'closed') return;
  const wasOpen = mode === 'open';
  mode = 'closed';
  hide();
  if (wasOpen) {
    unlockScroll(); popLayer('cart');
    const f = lastFocus;
    if (f && f.focus && document.contains(f)) f.focus({ preventScroll: true });
  }
  root.classList.remove('is-peek');
  clearTimeout(undoTimer);
  undoEl.classList.remove('is-on');
  undoData = null;
}

// A peek: the drawer slides in for a moment without dimming, locking or taking focus; it leaves on its own
// unless the pointer is on it, and any click inside turns it into the real drawer.
let hovering = false;
function peek(ms = 2400) {
  if (mode === 'open') return;
  // on a phone the drawer would cover the whole screen: a toast with the counter pop says the same thing
  if (matchMedia('(max-width: 699px)').matches) { toast(T.added); return; }
  clearTimeout(peekTimer);
  if (mode === 'closed') {
    mode = 'peek';
    root.classList.add('is-peek');
    setView('cart');
    render();
    show();
    panel.setAttribute('aria-modal', 'false');
  }
  peekTimer = setTimeout(function end() {
    if (mode !== 'peek') return;
    if (hovering || panel.contains(document.activeElement)) { peekTimer = setTimeout(end, 900); return; }
    close();
  }, ms);
}
panel.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hovering = true; });
panel.addEventListener('pointerleave', () => { hovering = false; });
panel.addEventListener('pointerdown', () => { if (mode === 'peek') open(); });

// ---- checkout step -----------------------------------------------------------------------------------------------
function setView(v) {
  const ck = v === 'ck';
  if (ck) { ckEl.innerHTML = ckHTML(); ckEl.dataset.on = '1'; } else { delete ckEl.dataset.on; }
  panel.classList.toggle('is-ck', ck);
  cartView.inert = ck; cartView.setAttribute('aria-hidden', String(ck));
  ckEl.inert = !ck; ckEl.setAttribute('aria-hidden', String(!ck));
  if (ck) setTimeout(() => ckEl.querySelector('.ck__back') && ckEl.querySelector('.ck__back').focus({ preventScroll: true }), 60);
}

// ---- actions ---------------------------------------------------------------------------------------------------
function add(product, size, opts = {}) {
  const k = `${product.id}|${size}`;
  const it = items.find((x) => keyOf(x) === k);
  if (it) it.qty = Math.min(MAX_QTY, it.qty + 1); else items.push({ id: product.id, size, qty: 1 });
  newKey = it ? null : k;
  save();
  const apply = () => { renderCount(true); };
  if (opts.countDelay) setTimeout(apply, opts.countDelay); else apply();
  if (mode !== 'closed') { render(); }
}

function removeLine(key) {
  const idx = items.findIndex((x) => keyOf(x) === key);
  if (idx < 0) return;
  const li = bodyEl.querySelector(`.line[data-key="${CSS.escape(key)}"]`);
  const gone = items[idx];
  const finish = () => {
    items.splice(idx, 1);
    save(); render(); renderCount(false);
    undoData = { item: gone, idx };
    const p = byId.get(gone.id);
    undoMsg.textContent = `${T.removed}: ${p.name}, ${gone.size}`;
    undoEl.classList.add('is-on');
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => { undoEl.classList.remove('is-on'); undoData = null; }, 6000);
    if (items.length) { const f = bodyEl.querySelector('.line__rm'); f && f.focus({ preventScroll: true }); } else { const b = bodyEl.querySelector('button'); b && b.focus({ preventScroll: true }); }
  };
  if (li) { li.classList.add('is-out'); setTimeout(finish, 240); } else finish();
}

undoBtn.addEventListener('click', () => {
  if (!undoData) return;
  const { item, idx } = undoData;
  undoData = null;
  const ex = items.find((x) => keyOf(x) === keyOf(item));
  if (ex) ex.qty = Math.min(MAX_QTY, ex.qty + item.qty); else items.splice(Math.min(idx, items.length), 0, item);
  save(); newKey = keyOf(item); render(); renderCount(false);
  undoEl.classList.remove('is-on');
  clearTimeout(undoTimer);
});

function changeQty(key, d) {
  const it = items.find((x) => keyOf(x) === key);
  if (!it) return;
  it.qty = Math.max(1, Math.min(MAX_QTY, it.qty + d));
  save();
  const li = bodyEl.querySelector(`.line[data-key="${CSS.escape(key)}"]`);
  if (li) {
    const p = byId.get(it.id);
    li.querySelector('.line__q').textContent = it.qty;
    li.querySelector('.line__price').textContent = fmt(p.price * it.qty);
    li.querySelector('[data-act="dec"]').disabled = it.qty <= 1;
    li.querySelector('[data-act="inc"]').disabled = it.qty >= MAX_QTY;
  }
  refreshTotals();
}

async function copyPromo(btn) {
  try { await navigator.clipboard.writeText(PROMO); } catch (e) { /* clipboard blocked: the code is on screen anyway */ }
  const was = btn.textContent;
  btn.textContent = T.copy;
  btn.classList.add('is-done');
  setTimeout(() => { btn.textContent = was; btn.classList.remove('is-done'); }, 1500);
}

panel.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const key = b.closest('.line') && b.closest('.line').dataset.key;
  switch (b.dataset.act) {
    case 'inc': changeQty(key, 1); break;
    case 'dec': changeQty(key, -1); break;
    case 'rm': removeLine(key); break;
    case 'go': setView('ck'); break;
    case 'back': setView('cart'); { const g = footEl.querySelector('.cart__go'); g && g.focus({ preventScroll: true }); } break;
    case 'copy': copyPromo(b); break;
    case 'collection':
      close();
      document.dispatchEvent(new CustomEvent('cart:collection'));
      scrollTo({ top: 0, behavior: 'smooth' });
      { const c = document.querySelector('#cloakroom canvas'); c && c.focus({ preventScroll: true }); }
      break;
    default:
  }
});
root.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });

// keyboard: registered at import time, so it runs before the detail view's own handler
document.addEventListener('keydown', (e) => {
  if (mode !== 'open') return;
  if (e.key === 'Escape') {
    e.preventDefault(); e.stopImmediatePropagation();
    if (panel.classList.contains('is-ck')) { setView('cart'); const g = footEl.querySelector('.cart__go'); g && g.focus({ preventScroll: true }); } else close();
    return;
  }
  if (trapTab(e, panel)) e.stopImmediatePropagation();
  else if (e.key.startsWith('Arrow')) e.stopImmediatePropagation();
});

// ---- boot ------------------------------------------------------------------------------------------------------
load();
renderCount(false);
const cartBtn = document.querySelector('.topbar__cart');
cartBtn && cartBtn.addEventListener('click', () => (mode === 'open' ? close() : open()));
addEventListener('storage', (e) => { if (e.key === KEY) { load(); renderCount(false); if (mode !== 'closed') render(); } });
setCartAdder((p, size, opts) => add(p, size, opts));

export const cart = { add, open, close, peek, count, isOpen: () => mode === 'open' };

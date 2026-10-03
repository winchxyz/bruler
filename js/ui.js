// Shared UI helpers: price format, cart hook, toast, scroll lock, overlay layers, focus trap.
import { SITE } from './data.js';

export const fmt = (n) => n.toLocaleString('ru-RU').replace(/[   ]/g, ' ') + ' ₽';
export const siteUrl = (path) => SITE + path;
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// The rail's motion is the product, so the OS "reduce motion" flag (on whenever Windows
// animation effects are off) is ignored; add ?still to the URL to get the static version.
export const reducedMotion = new URLSearchParams(location.search).has('still');

// ---- cart hook: cart.js registers the real implementation; until then (or without it) a plain counter ------------
let adder = null;
export const setCartAdder = (fn) => { adder = fn; };
let legacy = 0;
export function addToCart(item, size, opts) {
  if (adder) return adder(item, size, opts);
  legacy += 1;
  bump('[data-count="cart"]', legacy);
  toast(`${item.name}${size ? ' · ' + size : ''} — добавлено в корзину`);
}

export function bump(sel, n) {
  const el = document.querySelector(sel);
  if (!el) return;
  el.textContent = n;
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

let toastTimer;
export function toast(text) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ---- scroll lock: reference-counted, so the detail view, the size sheet and the cart can overlap ----------------
let locks = 0;
export function lockScroll() {
  if (locks++ === 0) document.documentElement.classList.add('is-locked');
}
export function unlockScroll() {
  if (locks > 0 && --locks === 0) document.documentElement.classList.remove('is-locked');
}

// ---- overlay layers: while a sheet or the cart is open, the detail view ignores the keyboard -------------------
const layers = new Set();
export const pushLayer = (n) => layers.add(n);
export const popLayer = (n) => layers.delete(n);
export const hasLayer = () => layers.size > 0;
export const hasLayerOtherThan = (n) => [...layers].some((x) => x !== n);

// ---- focus trap ------------------------------------------------------------------------------------------------
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
export function trapTab(e, container) {
  if (e.key !== 'Tab') return false;
  const f = [...container.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
  if (!f.length) { e.preventDefault(); container.focus(); return true; }
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); return true; }
  if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); return true; }
  return false;
}

// try/catch storage
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
};

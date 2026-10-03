import { initCloakroom } from './cloakroom.js';
import { initDetail } from './detail.js';
import { initCursor } from './cursor.js';
import { reducedMotion as still } from './ui.js';

// ---------- Top bar: solid paper + hairline once the first screen is behind us ----------
const topbar = document.querySelector('.topbar');
const onScroll = () => topbar.classList.toggle('is-solid', scrollY > innerHeight * 0.5);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// ---------- Rail + detail (untouched wiring) ----------
const cloakEl = document.getElementById('cloakroom');
let cloak = null;
const detail = initDetail({ getCloak: () => cloak });
cloak = initCloakroom(cloakEl, { onOpen: (pi) => detail.open(pi) });

// "Смотреть наличие": the garment under the pointer, else the one nearest the middle of the rail
document.getElementById('cta').addEventListener('click', () => cloak && detail.open(cloak.current()));

// "Коллекция" / "Наверх": back to the rail, focused for the arrow keys
document.querySelectorAll('[data-nav="collection"]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  scrollTo({ top: 0, behavior: 'smooth' });
  cloakEl.querySelector('canvas')?.focus({ preventScroll: true });
}));

// ---------- Category tabs above the rail ----------
const tabsEl = document.getElementById('tabs');
if (cloak && cloak.groups) {
  tabsEl.innerHTML = cloak.groups.map((g, i) => `<button class="tabs__tab" type="button" role="tab" aria-selected="${i === 0}" data-group="${g}">${g}</button>`).join('')
    + '<i class="tabs__ink" aria-hidden="true"></i>';
  const ink = tabsEl.querySelector('.tabs__ink');
  if (still) ink.classList.add('is-still');

  // one ink line slides under the selected tab (transform only)
  const moveInk = () => {
    const on = tabsEl.querySelector('.tabs__tab[aria-selected="true"]');
    if (!on) return;
    const x = on.offsetLeft + 2, w = Math.max(1, on.offsetWidth - 4);
    ink.style.transform = `translateX(${x}px) scaleX(${w})`;
    ink.classList.add('is-ready');
  };
  const mark = (g) => {
    tabsEl.querySelectorAll('.tabs__tab').forEach((b) => {
      const on = b.dataset.group === g;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    moveInk();
  };
  mark(cloak.group);
  // tab widths settle once the webfont is in, and again on resize
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
    ink.classList.add('is-still'); moveInk(); void ink.offsetWidth; if (!still) ink.classList.remove('is-still');
  });
  new ResizeObserver(() => {
    ink.classList.add('is-still'); moveInk(); void ink.offsetWidth; if (!still) ink.classList.remove('is-still');
  }).observe(tabsEl);

  tabsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.tabs__tab');
    if (!b) return;
    cloak.setGroup(b.dataset.group);
    mark(b.dataset.group);
  });
  // roving focus: arrows move between tabs
  tabsEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = [...tabsEl.querySelectorAll('.tabs__tab')];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    n.focus();
    n.click();
  });
}

// ---------- Magnetic pills: a pull of at most 6 px toward the pointer ----------
if (!still && matchMedia('(hover: hover) and (pointer: fine)').matches) {
  const MAX = 6;
  let cur = null;
  const release = (p) => { if (!p) return; p.style.removeProperty('--mx'); p.style.removeProperty('--my'); p.classList.remove('is-magnet'); };
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const p = e.target instanceof Element ? e.target.closest('.pill') : null;
    if (p !== cur) { release(cur); cur = p; }
    if (!p) return;
    const r = p.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const k = (v) => Math.max(-1, Math.min(1, v)) * MAX;
    p.classList.add('is-magnet');
    p.style.setProperty('--mx', k(dx).toFixed(2) + 'px');
    p.style.setProperty('--my', (k(dy) * 0.7).toFixed(2) + 'px');
  }, { passive: true });
  document.addEventListener('pointerout', (e) => { if (!e.relatedTarget) { release(cur); cur = null; } });
}

// ---------- Scroll reveals (transform/opacity, once) ----------
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
document.querySelectorAll('.reveal, [data-lines]').forEach((el) => {
  // stagger siblings inside one block
  const sibs = el.parentElement ? [...el.parentElement.children].filter((c) => c.classList.contains('reveal')) : [];
  const i = Math.max(0, sibs.indexOf(el));
  el.style.setProperty('--d', Math.min(i, 4) * 90 + 'ms');
  io.observe(el);
});

// ---------- Showroom: open/closed badge in Moscow time ----------
const OPEN_H = 12, CLOSE_H = 22;
const mskFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', hour: 'numeric', minute: 'numeric', hour12: false });
function renderStatus() {
  const box = document.getElementById('status');
  if (!box) return;
  const parts = mskFmt.formatToParts(new Date());
  const h = +parts.find((p) => p.type === 'hour').value % 24;
  const open = h >= OPEN_H && h < CLOSE_H;
  box.dataset.state = open ? 'open' : 'closed';
  const [main, sub] = open ? ['Сейчас открыто', 'до 22:00'] : ['Сейчас закрыто', `откроемся в ${OPEN_H}:00`];
  const [m, s2] = box.querySelector('.status__text').children;
  m.textContent = main; s2.textContent = sub;
}
renderStatus();
setInterval(renderStatus, 60000);

// ---------- Footer year, cursor ----------
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();
initCursor();

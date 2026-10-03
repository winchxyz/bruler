// Custom cursor: an ink dot (exact) and a thin ring (lerped). Fine pointers only.
//  - links / buttons: the ring grows
//  - over a garment: the ring turns into a «Смотреть» label; while dragging the rail: «Тянуть»
// Garment hover is read from the rail's own caption element (.cloak__caption.is-on), so cloakroom.js
// stays untouched. The rAF loop runs only while the ring is still catching up with the pointer.

import { reducedMotion as still } from './ui.js';

const FINE = '(hover: hover) and (pointer: fine)';
const INTERACTIVE = 'a[href], button, [role="button"], [role="tab"], [role="radio"], summary, label, [data-cursor="link"]';
const LERP = 0.2;
const DRAG_SLOP = 5;

export function initCursor() {
  if (still || !matchMedia(FINE).matches) return;

  const root = document.documentElement;
  const el = document.createElement('div');
  el.className = 'cur';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="cur__ring"></div><div class="cur__dot"></div><div class="cur__label"><span></span></div>';
  document.body.appendChild(el);
  const dot = el.querySelector('.cur__dot');
  const ring = el.querySelector('.cur__ring');
  const labelWrap = el.querySelector('.cur__label');
  const labelText = labelWrap.firstElementChild;

  let tx = 0, ty = 0, rx = 0, ry = 0;   // pointer target, ring position
  let seen = false, raf = 0;
  let overCanvas = false, overLink = false, overLight = false, garment = false;
  let down = false, dragging = false, downX = 0, downY = 0;
  let caption = null;
  let labelNow = '';

  const place = (node, x, y) => { node.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`; };

  function tick() {
    raf = 0;
    rx += (tx - rx) * LERP;
    ry += (ty - ry) * LERP;
    if (Math.abs(tx - rx) < 0.1 && Math.abs(ty - ry) < 0.1) { rx = tx; ry = ty; }
    place(ring, rx, ry);
    place(labelWrap, rx, ry);
    if (rx !== tx || ry !== ty) raf = requestAnimationFrame(tick);
  }
  const wake = () => { if (!raf) raf = requestAnimationFrame(tick); };

  function render() {
    const detail = document.body.classList.contains('is-detail');
    let label = '';
    if (overCanvas && !detail) {
      if (dragging) label = 'Тянуть';
      else if (garment) label = 'Смотреть';
    }
    if (label && label !== labelNow) labelText.textContent = label;
    labelNow = label;
    el.classList.toggle('is-label', !!label);
    el.classList.toggle('is-link', overLink && !label);
    el.classList.toggle('is-light', overLight);
    el.classList.toggle('is-down', down && !label);
  }

  function onMove(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    tx = e.clientX; ty = e.clientY;
    place(dot, tx, ty);
    if (!seen) {
      seen = true;
      rx = tx; ry = ty;
      place(ring, rx, ry); place(labelWrap, rx, ry);
      root.classList.add('has-cursor');
    }
    el.classList.add('is-on');
    const t = e.target instanceof Element ? e.target : null;
    overCanvas = !!t && t.classList.contains('cloak__canvas');
    overLink = !!t && !!t.closest(INTERACTIVE);
    overLight = !!t && !!t.closest('.marquee, [data-cursor-light]');
    if (down && !dragging && overCanvas && Math.hypot(e.clientX - downX, e.clientY - downY) > DRAG_SLOP) dragging = true;
    render();
    wake();
  }

  addEventListener('pointermove', onMove, { passive: true });
  addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    down = true; dragging = false; downX = e.clientX; downY = e.clientY;
    render();
  }, { passive: true });
  const release = () => { if (down) { down = false; dragging = false; render(); } };
  addEventListener('pointerup', release, { passive: true });
  addEventListener('pointercancel', release, { passive: true });
  addEventListener('blur', () => { release(); el.classList.remove('is-on'); });
  document.documentElement.addEventListener('mouseleave', () => el.classList.remove('is-on'));
  document.documentElement.addEventListener('mouseenter', () => { if (seen) el.classList.add('is-on'); });
  document.addEventListener('visibilitychange', release);

  // The rail builds its caption lazily: wait for it, then follow its is-on class
  const mo = new MutationObserver(() => { garment = !!caption && caption.classList.contains('is-on'); render(); });
  function bind() {
    const found = document.querySelector('.cloak__caption');
    if (!found) return false;
    caption = found;
    mo.observe(caption, { attributes: true, attributeFilter: ['class'] });
    return true;
  }
  if (!bind()) {
    const host = document.getElementById('cloakroom') || document.body;
    const wait = new MutationObserver(() => { if (bind()) wait.disconnect(); });
    wait.observe(host, { childList: true, subtree: true });
  }

  // opening/closing the product view changes what the cursor means
  new MutationObserver(render).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

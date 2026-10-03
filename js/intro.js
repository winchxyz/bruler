// First-visit intro (~1.4 s): wordmark wipes in, an ink line draws under it, then the wordmark glides
// into its slot in the top bar (FLIP) while the paper veil lifts off the rail.
// Transform/opacity only, driven by the Web Animations API so the compositor does the work even while
// the rail is busy booting. Intentionally ignores prefers-reduced-motion (the whole site does; see ui.js).

const root = document.documentElement;

function finish(intro) {
  try { sessionStorage.setItem('bruler:intro', '1'); } catch (e) { /* storage blocked: intro just replays */ }
  root.classList.remove('intro-on');
  intro.remove();
}

function run() {
  const intro = document.getElementById('intro');
  if (!intro) return;
  if (!root.classList.contains('intro-on')) { intro.remove(); return; }
  try { sessionStorage.setItem('bruler:intro', '1'); } catch (e) { /* ignore */ }

  const mark = intro.querySelector('.intro__mark');
  const clip = intro.querySelector('.intro__clip');
  const logo = intro.querySelector('.intro__logo');
  const line = intro.querySelector('.intro__line');
  const veil = intro.querySelector('.intro__veil');
  const target = document.querySelector('.topbar__logo img');
  if (!mark || !target || !mark.animate) return finish(intro);

  const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const GLIDE = 'cubic-bezier(0.76, 0, 0.24, 1)';
  const opt = (o) => ({ fill: 'both', ...o });

  // FLIP: where the wordmark sits now, where it has to land
  const a = mark.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  const s = b.width / a.width;
  const end = `translate(${(b.left - a.left).toFixed(2)}px, ${(b.top - a.top).toFixed(2)}px) scale(${s.toFixed(4)})`;

  const anims = [
    // the window slides across while the wordmark counter-slides: a clean mask wipe
    clip.animate([{ transform: 'translateX(-101%)' }, { transform: 'translateX(0)' }], opt({ duration: 640, easing: EASE })),
    logo.animate([{ transform: 'translateX(101%)' }, { transform: 'translateX(0)' }], opt({ duration: 640, easing: EASE })),
    line.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], opt({ duration: 520, delay: 300, easing: EASE })),
    line.animate([{ opacity: 1 }, { opacity: 0 }], opt({ duration: 240, delay: 760, easing: 'linear' })),
    mark.animate([{ transform: 'none' }, { transform: end }], opt({ duration: 640, delay: 760, easing: GLIDE })),
    veil.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-100%)' }], opt({ duration: 600, delay: 800, easing: GLIDE })),
  ];

  let done = false;
  const complete = () => { if (done) return; done = true; removeEventListener('keydown', skip); finish(intro); };
  Promise.all(anims.map((x) => x.finished)).then(complete, complete);

  // any click, scroll, touch or key: run the rest at speed
  const skip = () => {
    if (done) return;
    anims.forEach((x) => x.updatePlaybackRate(7));
  };
  intro.addEventListener('pointerdown', skip, { once: true });
  intro.addEventListener('wheel', skip, { once: true, passive: true });
  intro.addEventListener('touchstart', skip, { once: true, passive: true });
  addEventListener('keydown', skip, { once: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
else run();

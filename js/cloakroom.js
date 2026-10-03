// Cloakroom: the collection as a 3D clothing rail on a flat paper page.
//
// Every garment is a solid hanging on a swivel hanger: a front shell (the photo) and a back shell (the same
// photo, blurred) around one mid-surface, with the hanger sitting between them (arms inside the shoulders, the hook's
// neck through the neckline; trousers hang from two clips). The rest shape comes from js/cloth.js (built once, from the
// baked silhouette and inflation height); the fabric is not simulated (no particles). The only secondary motion is two
// small underdamped springs per garment, driven by the turn and by sideways acceleration: the hem trails the turn (a
// twist about the vertical axis that grows toward the hem, applied in the vertex shader) and the whole garment tilts a
// few degrees about the hook. Both settle in well under a second and then everything is perfectly still.
//
// Motion is time-based tweens only: hovering turns a garment about the hanger's vertical axis in 0.5 s with a cubic
// ease-in-out (a re-target starts from the current angle and speed), and the neighbours slide aside on the same
// curve. Dragging slides the hanger along the rail with a critically damped follow and a tiny, critically damped tilt.
// Nothing moves at rest: the render loop runs only while something is moving and stops when everything is still.
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { PRODUCTS, GROUPS } from './data.js';
import { reducedMotion } from './ui.js';
import { createCloth } from './cloth.js';

// ---------- constants -------------------------------------------------------
export const BAKED = 'assets/baked/';
const RAIL_Y = 1.75;
const RAIL_R = 0.02;
const WALL_Z = -0.6;
const HOOK_H = 0.16;           // rail centre -> swivel pivot
const NECK = 0.045;            // pivot -> hanger apex
const ZS = RAIL_R + 0.006;     // hook stem offset in front of the rail centre
const REST_YAW = THREE.MathUtils.degToRad(70);
const FOV = 20;                // narrow lens: almost no perspective, the rail reads as an elevation
const LIFT_H = 0.035;          // hanger lift off the rail on pick
const SLIDE_Z = 0.22;          // hanger slide toward the camera on pick
const DWELL_MS = 150;          // time over a slot before hover picks it: a cursor passing over the rail turns nothing
const LEAVE_MS = 250;          // grace before hover clears
const TURN_S = 0.5;            // hover turn and neighbour spread: cubic ease-in-out, seconds
const ENTER_S = 1.0, SHIFT_S = 0.8;   // entrance and tab-switch slides
// secondary motion (all underdamped springs that settle in about 0.6-0.7 s, then stop the loop)
const TWIST_W = 14, TWIST_Z = 0.55;      // hem yaw lag: rad/s, damping ratio
const TWIST_GAIN = 1.0, TWIST_MAX = 0.22;   // share of the lag shown at the hem; ~14 degrees at most
const TILT_W = 12, TILT_Z = 0.5;         // pendulum tilt about the hook
const TILT_MAX = 0.055;                  // rad (about 3 degrees)
const TILT_KA = 0.02, TILT_KY = 0.0025;   // static lean per m/s^2 of sideways acceleration / per rad/s^2 of turn acceleration
const CLICK_PX = 6, CLICK_MS = 250;
const ALL = 'Все';

// Garment height in world units per group, and half shell thickness as a share of width.
export const HEIGHT = { 'Верхняя одежда': 0.8, 'Худи и зипы': 0.82, 'Футболки': 0.74, 'Джинсы и брюки': 0.8, 'Свитера': 0.82 };
const THICK = { 'Верхняя одежда': 0.06, 'Худи и зипы': 0.058, 'Футболки': 0.044, 'Джинсы и брюки': 0.07, 'Свитера': 0.055 };

const T = {
  canvas: 'Рейл с одеждой. Стрелками выбирайте вещь, Enter открывает карточку.',
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const nowS = () => performance.now() / 1000;

// Critically damped follow with an exact step: no overshoot, same result at any frame rate.
function cdamp(o, key, vkey, target, w, dt) {
  if (reducedMotion) { o[key] = target; o[vkey] = 0; return; }
  const x = o[key] - target, v = o[vkey];
  const e = Math.exp(-w * dt), b = v + w * x;
  o[key] = target + (x + b * dt) * e;
  o[vkey] = (v - w * b * dt) * e;
}

// Time-based tween: a cubic Hermite from the current value and speed to the target at rest. From rest it is the
// plain cubic ease-in-out (3s^2 - 2s^3); re-targeted mid-flight it continues from where it is, at the speed it has.
const mkTw = (v) => ({ f: v, to: v, v0: 0, t0: 0, d: 0, delay: 0 });
function twEval(tw, t, out) {
  const d = tw.d;
  let s = d > 0 ? (t - tw.t0) / d : 1;
  if (s < 0 && tw.delay === 0) s = 0;
  if (s < 0) { out[0] = tw.f; out[1] = 0; return tw.f; }
  if (s >= 1) { out[0] = tw.to; out[1] = 0; return tw.to; }
  const s2 = s * s, s3 = s2 * s;
  out[0] = (2 * s3 - 3 * s2 + 1) * tw.f + (s3 - 2 * s2 + s) * d * tw.v0 + (-2 * s3 + 3 * s2) * tw.to;
  out[1] = ((6 * s2 - 6 * s) * tw.f + (3 * s2 - 4 * s + 1) * d * tw.v0 + (-6 * s2 + 6 * s) * tw.to) / d;
  return out[0];
}
const _tw = [0, 0];
function twTo(tw, to, t, dur, delay = 0) {
  twEval(tw, t, _tw);
  tw.f = _tw[0]; tw.v0 = delay > 0 ? 0 : _tw[1]; tw.to = to; tw.t0 = t + delay; tw.d = reducedMotion ? 0 : dur; tw.delay = delay;
}
function twSet(tw, v) { tw.f = tw.to = v; tw.v0 = 0; tw.t0 = 0; tw.d = 0; tw.delay = 0; }
const twDone = (tw, t) => t >= tw.t0 + tw.d;

async function loadBitmap(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url);
  return createImageBitmap(await r.blob(), { premultiplyAlpha: 'none' });
}

// ---------- shell shading ------------------------------------------------------------------------------
// edge: the soft anti-aliased fringe pass (alpha blended, no depth write); core: the opaque body (alpha >= CORE).
// Every shell gets a soft darkening toward its seam (aAO: 0 on the seam, 1 in the body) and toward its silhouette as
// seen from the camera (grazing view), which is what gives a side-on garment its rounded, shaded profile. The back
// shell is the same cloth: its colour is a blurred lookup of the front texture and its alpha is the front's own, so
// both shells always have exactly the same silhouette.
const CORE = 0.9;
const TWIST_GLSL = `
uniform float uTwist;
float cloakPhi(vec2 q) {
  float v = clamp(q.y, 0.0, 1.0), u = abs(q.x - 0.5) * 2.0;
  return uTwist * pow(v, 1.6) * (1.0 + 0.3 * smoothstep(0.6, 0.9, u));
}
vec3 cloakRot(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c); }`;
function patchCloth(uni, edge, back) {
  return (sh) => {
    sh.uniforms.uTwist = uni.uTwist;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAO; varying float vAO;' + TWIST_GLSL)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = cloakRot(objectNormal, cloakPhi(uv));')
      .replace('#include <begin_vertex>', 'vAO = aAO;\nvec3 transformed = cloakRot(position, cloakPhi(uv));');
    // after the alpha decision, so discarded fragments cost nothing
    const after = (edge ? `\n if (diffuseColor.a >= ${CORE.toFixed(2)} || diffuseColor.a < 0.004) discard;` : '')
      + (back ? '\n diffuseColor.rgb = diffuse * textureLod(map, vMapUv, 5.0 * smoothstep(0.0, 0.45, vAO)).rgb;\n if (!gl_FrontFacing) diffuseColor.rgb *= 0.6;' : '')
      + '\n diffuseColor.rgb *= mix(0.7, 1.0, smoothstep(0.0, 0.7, vAO));';
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAO;')
      .replace('#include <emissivemap_fragment>', back ? '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.42;' : '#include <emissivemap_fragment>')
      .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>' + after)
      .replace('#include <opaque_fragment>', 'outgoingLight *= mix(0.56, 1.0, smoothstep(0.05, 0.62, abs(dot(normalize(normal), normalize(vViewPosition)))));\n#include <opaque_fragment>');
  };
}

// ---------- geometry helpers --------------------------------------------------
function mergeGeos(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo;
    else for (let i = 0; i < c; i++) idx[io++] = vo + i;
    vo += c;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
const placed = (g, x = 0, y = 0, z = 0) => g.translate(x, y, z);

// ---------- procedural textures ------------------------------------------------
function woodTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#8a4a36'; g.fillRect(0, 0, 256, 64);
  for (let y = 0; y < 64; y++) {
    const v = Math.random();
    g.fillStyle = `rgba(${v > 0.5 ? '255,214,180' : '40,14,8'},${(0.04 + Math.abs(v - 0.5) * 0.16).toFixed(3)})`;
    g.fillRect(0, y, 256, 1 + Math.floor(Math.random() * 2));
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function railShadowTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, '#000'); gr.addColorStop(0.3, '#fff'); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

// ---------- module ----------------------------------------------------------
// opts.onOpen(productIndex): the visitor picked a garment (click / tap / Enter).
// Returns a small controller used by the detail view. The heavy part (GL context, environment,
// geometry) starts after the first paint, so the page shows up before any of it runs; until then
// the controller is a harmless stub that forwards to the real one once it exists.
export function initCloakroom(el, opts = {}) {
  if (!el) return null;
  let inner = null, pendingGroup = null;
  const stub = {
    groups: [ALL, ...GROUPS], group: ALL, items: [], slots: [], view: {}, current: () => 0,
    slotRect: () => { const r = el.getBoundingClientRect(); return { left: r.left + r.width / 2 - 60, top: r.top + r.height * 0.3, width: 120, height: 150 }; },
    setModal: () => {}, setGroup: (g) => { pendingGroup = g; },
  };
  // after first paint; the timeout covers tabs where rAF is throttled (background, hidden window)
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    inner = startCloak(el, opts);
    if (pendingGroup && inner.setGroup) inner.setGroup(pendingGroup);
  };
  requestAnimationFrame(() => setTimeout(start, 0));
  setTimeout(start, 250);
  return new Proxy(stub, { get: (t, k) => (inner && k in inner ? inner[k] : t[k]) });
}

function startCloak(el, opts) {
  el.classList.add('cloakroom');
  el.innerHTML = `
    <canvas class="cloak__canvas" tabindex="0" role="application" aria-label="${T.canvas}"></canvas>
    <canvas class="cloak__snap" aria-hidden="true"></canvas>
    <div class="cloak__caption" aria-hidden="true"></div>
    <ul class="cloak__sr"></ul>`;
  const canvas = el.querySelector('.cloak__canvas');
  const snap = el.querySelector('.cloak__snap');
  const captionEl = el.querySelector('.cloak__caption');
  const srList = el.querySelector('.cloak__sr');
  const open = (pi) => opts.onOpen && opts.onOpen(pi);
  const captionOf = (p) => `${p.name} — ${p.colorRu || p.color}`;
  const qs = new URLSearchParams(location.search);

  performance.mark('cloak:init');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance', stencil: false });
  } catch (err) {
    return fallback();
  }
  performance.mark('cloak:ctx');
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;     // keeps the photographed colours honest
  renderer.toneMappingExposure = 1.0;
  const DPR_CAP = Math.min(window.devicePixelRatio || 1, +qs.get('dprcap') || 2);
  const fixDpr = qs.has('fixdpr');
  let dpr = +qs.get('dpr') || DPR_CAP;
  renderer.setPixelRatio(dpr);
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  // image-based light is generated in the boot sequence below, after the first assets arrive
  scene.environmentIntensity = 0.85;
  const camera = new THREE.PerspectiveCamera(FOV, 2, 0.1, 80);

  // Key from the upper left, soft fill from the right; the environment does the rest.
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(-3.5, 5.5, 5);
  const fill = new THREE.DirectionalLight(0xfff3ea, 0.55);
  fill.position.set(5.4, 3.2, 4.5);
  scene.add(key, fill);

  // ---- rail + wall brackets (the page is the backdrop) ----
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 1, roughness: 0.16, envMapIntensity: 1.25 });
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(RAIL_R, RAIL_R, 1, 64, 1, true).rotateZ(Math.PI / 2), chrome);
  rail.position.set(0, RAIL_Y, 0);
  rail.frustumCulled = false;
  scene.add(rail);
  const brackets = [], caps = [];
  for (const sgn of [-1, 1]) {
    const parts = [];
    parts.push(placed(new THREE.BoxGeometry(0.1, 0.16, 0.014), 0, RAIL_Y, WALL_Z + 0.007));
    parts.push(placed(new THREE.CylinderGeometry(0.0125, 0.0125, -WALL_Z, 28).rotateX(Math.PI / 2), 0, RAIL_Y, WALL_Z / 2));
    parts.push(placed(new THREE.TorusGeometry(RAIL_R + 0.007, 0.0065, 16, 48).rotateY(Math.PI / 2), 0, RAIL_Y, 0));
    for (const sy of [-1, 1]) parts.push(placed(new THREE.CylinderGeometry(0.0085, 0.0085, 0.012, 14).rotateX(Math.PI / 2), 0, RAIL_Y + sy * 0.058, WALL_Z + 0.018));
    const m = new THREE.Mesh(mergeGeos(parts), chrome);
    m.frustumCulled = false;
    scene.add(m);
    brackets.push({ m, sgn });
    const cap = new THREE.Mesh(new THREE.SphereGeometry(RAIL_R * 1.15, 32, 20), chrome);
    cap.position.set(0, RAIL_Y, 0);
    scene.add(cap);
    caps.push({ cap, sgn });
  }
  // soft shadow of the rail on the invisible wall
  const railShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x1b1814, alphaMap: railShadowTexture(), transparent: true, opacity: 0.09, depthWrite: false, toneMapped: false }));
  railShadow.position.set(0, RAIL_Y - 0.045, WALL_Z + 0.2);
  railShadow.renderOrder = -2;
  railShadow.frustumCulled = false;
  scene.add(railShadow);

  // hanger materials: chrome hooks, lacquered wood with a faint grain
  const woodMap = woodTexture();
  const wood = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: woodMap, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.28 });
  const woodDark = new THREE.MeshPhysicalMaterial({ color: 0x8e6a60, map: woodMap, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.28 });

  const hookGeo = () => {
    const pts = [new THREE.Vector3(0, -HOOK_H, ZS), new THREE.Vector3(0, -HOOK_H * 0.5, ZS)];
    for (let i = 0; i <= 18; i++) { const a = (i / 18) * Math.PI; pts.push(new THREE.Vector3(0, ZS * Math.sin(a), ZS * Math.cos(a))); }
    pts.push(new THREE.Vector3(0, -0.02, -ZS));
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 72, 0.0072, 12, false);
  };

  // ---- state ---------------------------------------------------------------
  const items = [];
  let slots = [];                       // items shown in the current tab, in rail order
  let group = ALL;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hitBuf = [];
  const pointer = { x: 0, y: 0, nx: 0, ny: 0, inside: false, type: 'mouse', dirty: false, lastPickT: 0 };
  const view = { W: 1, H: 1, mobile: false, s: 0.27, R: 2.4, Rc: 2.4, halfW: 2.6, Hv: 1.3, D: 8, ppu: 250, cy: 1.2, panMax: 0, left: 0, top: 0, railV: 0 };
  const cam = { pan: 0, panVel: 0, fling: 0, panTarget: 0 };
  let hoverIdx = -1, focusIdx = -1, active = -1, lastHover = -1;   // slot indices
  let candIdx = -1, candSince = 0, leaveSince = 0;
  let modalOpen = false, frozen = false, paused = false;
  let ready = false, visible = false, entered = false, laidOut = false;
  let running = false, raf = 0, last = 0, time = 0, calmFrames = 0, idle = false;
  let capX = -1, capY = -1;
  let dragItem = null, press = null, pan = null;   // dragItem: the garment whose hanger is held
  const drag = { gx: 0, wx: 0 };
  const tmpV = new THREE.Vector3();
  const perf = { n: 0, sum: 0, max: 0, samples: [], on: false, long: 0 };
  const rolling = []; let lastDprT = 0;
  const frameStats = { frames: 0, idleFrames: 0 };

  // ---- garments ------------------------------------------------------------
  function buildItem(p, i, mf, assets) {
    const h = HEIGHT[p.group] || 0.8;
    const w = h * mf.W / mf.H;
    const T0 = (THICK[p.group] || 0.06) * w;
    const phase = i * 1.7 + 0.6;
    const isBottom = p.group === 'Джинсы и брюки';
    const isTee = p.group === 'Футболки';
    const hw = clamp(w * 0.31, 0.19, 0.31);                 // half span of the hanger's arms
    const bw = Math.min(w * 0.94, 0.7);
    const nv = (mf.nx + 1) * (mf.ny + 1);
    const cl = createCloth({
      nx: mf.nx, ny: mf.ny, hq: new Uint16Array(assets.mesh, 0, nv), cells: new Uint8Array(assets.mesh, nv * 2, mf.nx * mf.ny),
      w, h, T0, bottom: isBottom, hw, bw,
    });
    const mkGeo = (pos, nor, back) => {
      const g = new THREE.BufferGeometry();
      const pa = new THREE.BufferAttribute(pos, 3), na = new THREE.BufferAttribute(nor, 3);
      g.setAttribute('position', pa); g.setAttribute('normal', na);
      g.setAttribute('uv', new THREE.BufferAttribute(cl.uv, 2));
      g.setAttribute('aAO', new THREE.BufferAttribute(cl.ao, 1));
      let idx = cl.index;
      if (back) { idx = new Uint16Array(cl.index.length); for (let k = 0; k < idx.length; k += 3) { idx[k] = cl.index[k]; idx[k + 1] = cl.index[k + 2]; idx[k + 2] = cl.index[k + 1]; } }
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -h / 2, 0), Math.hypot(w, h) * 0.6 + 0.5);
      return g;
    };
    const geoF = mkGeo(cl.posF, cl.norF, false), geoB = mkGeo(cl.posB, cl.norB, true);

    const mkTex = (bmp, srgb) => {
      const t = new THREE.Texture(bmp);
      t.flipY = false;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = maxAniso;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.needsUpdate = true;
      return t;
    };
    const tex = mkTex(assets.color, true);
    const nrm = mkTex(assets.normal, false);
    const shTex = new THREE.Texture(assets.shadow);
    shTex.flipY = false; shTex.needsUpdate = true;

    const uni = { uTwist: { value: 0 } };
    const common = { roughness: 0.88, metalness: 0, specularIntensity: 0.0, sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color(0.1, 0.1, 0.1), normalMap: nrm };
    const mk = (extra, edge) => {
      const m = new THREE.MeshPhysicalMaterial({ ...common, ...extra, ...(edge ? { transparent: true, depthWrite: false } : { alphaTest: CORE }) });
      m.onBeforeCompile = patchCloth(uni, edge, false);
      m.customProgramCacheKey = () => 'cloak-v6' + (edge ? 'e' : 'c');
      return m;
    };
    const frontX = { map: tex, normalScale: new THREE.Vector2(0.75, -0.75) };
    // core: opaque body of the garment; edge: soft anti-aliased fringe, blended, drawn after it
    const front = new THREE.Mesh(geoF, mk(frontX, false));
    const frontEdge = new THREE.Mesh(geoF, mk(frontX, true));
    frontEdge.renderOrder = 2;
    // the back shell is blurred and mostly hidden: a cheap material, same two-pass soft edge
    const mkBack = (edge) => {
      const m = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, color: new THREE.Color().setScalar(1.12), ...(edge ? { transparent: true, depthWrite: false } : { alphaTest: CORE }) });
      m.onBeforeCompile = patchCloth(uni, edge, true);
      m.customProgramCacheKey = () => 'cloak-v6b' + (edge ? 'e' : 'c');
      return m;
    };
    const back = new THREE.Mesh(geoB, mkBack(false));
    const backEdge = new THREE.Mesh(geoB, mkBack(true));
    backEdge.renderOrder = 1;
    const shells = [front, frontEdge, back, backEdge];
    for (const m of shells) m.frustumCulled = false;

    const root = new THREE.Group();
    root.position.set(0, RAIL_Y, 0);
    root.visible = false;

    // chrome parts: hook, swivel, neck (+ clips for bottoms) as one mesh
    const chromeParts = [hookGeo()];
    const bodyY = -HOOK_H;
    const topY = -NECK - 0.012;                              // garment space -> hanger body space (y offset)
    const bodyParts = [];
    bodyParts.push(placed(new THREE.CylinderGeometry(0.0105, 0.0105, 0.018, 24), 0, -0.002, 0));
    const woodBody = [];
    if (isBottom) {
      // trouser hanger: a straight bar with two chrome clips that pinch the waistband (the pinned particles)
      bodyParts.push(placed(new THREE.CylinderGeometry(0.0055, 0.0055, NECK, 14), 0, -NECK / 2 - 0.006, 0));
      const [c0, c1] = cl.clipX;
      const half = (c1 - c0) / 2 + 0.06, mid = (c0 + c1) / 2;
      woodBody.push(placed(new THREE.CapsuleGeometry(0.009, half * 2 - 0.018, 6, 16).rotateZ(Math.PI / 2), mid, -NECK - 0.006, 0));
      const zc = cl.waistT + 0.0045;
      for (const cx of cl.clipX) {
        for (const sz of [-1, 1]) bodyParts.push(placed(new THREE.BoxGeometry(0.03, 0.056, 0.006), cx, -NECK - 0.026, sz * zc));
        bodyParts.push(placed(new THREE.BoxGeometry(0.03, 0.01, zc * 2 + 0.006), cx, -NECK - 0.0015, 0));
      }
    } else {
      // top hanger: the arms run inside the shoulders, following the garment's own shoulder line; the hook's neck
      // comes out through the neckline
      const pts = cl.arm.map(([x, yg]) => new THREE.Vector3(x, yg + topY, 0));
      const r = isTee ? 0.0085 : 0.0105;
      woodBody.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 64, r, 20, false));
      for (const q of [pts[0], pts[pts.length - 1]]) woodBody.push(placed(new THREE.SphereGeometry(r * 1.05, 18, 12), q.x, q.y, 0));
      const apex = pts[3].y;
      const nl = Math.max(0.014, -0.006 - apex);
      bodyParts.push(placed(new THREE.CylinderGeometry(0.0055, 0.0055, nl, 14), 0, -0.006 - nl / 2, 0));
      if (isTee) woodBody.push(placed(new THREE.CylinderGeometry(r, r, cl.hwe * 2, 20).rotateZ(Math.PI / 2), 0, (pts[0].y + pts[pts.length - 1].y) / 2, 0));
    }
    const hookMesh = new THREE.Mesh(mergeGeos(chromeParts), chrome);
    const body = new THREE.Group();
    body.position.set(0, bodyY, ZS);
    const bodyChrome = new THREE.Mesh(mergeGeos(bodyParts), chrome);
    const bodyWood = new THREE.Mesh(mergeGeos(woodBody), p.id.includes('brown') || p.id.includes('chateau') || p.id.includes('blesser') ? woodDark : wood);
    for (const m of shells) { m.position.y = topY; m.matrixAutoUpdate = false; m.updateMatrix(); }
    body.add(bodyChrome, bodyWood, ...shells);
    root.add(hookMesh, body);
    for (const o of [hookMesh, bodyChrome, bodyWood]) { o.matrixAutoUpdate = false; o.updateMatrix(); o.frustumCulled = false; }
    scene.add(root);

    // fake soft shadow on the invisible wall behind
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x1b1814, alphaMap: shTex, transparent: true, opacity: 0.13, depthWrite: false, toneMapped: false }));
    shadow.renderOrder = -1;
    shadow.frustumCulled = false;
    shadow.visible = false;
    scene.add(shadow);

    const proxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false }));

    return {
      i, p, pi: PRODUCTS.indexOf(p), w, h, T0, mf, root, body, shells, shadow, proxy, topY, phase, cl, hw, uni,
      textures: [tex, nrm, shTex], warmed: false,
      state: 'hidden', slot: -1, baseX: 0, tgt: 0, side: 1,
      x: 0, v: 0, tx: mkTw(0), hv: mkTw(0), hvV: 0, yaw: REST_YAW, th: 0, om: 0, fz: 0, fzv: 0,
      hy: REST_YAW, hyv: 0, vPrev: 0, yPrev: REST_YAW, yvPrev: 0, m0: false,
      on: false, dragged: false, resume: false,
      jitter: (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.04,
    };
  }

  // ---- layout --------------------------------------------------------------
  function spacingFor(n) {
    if (view.mobile) return 0.31;
    return n <= 5 ? 0.46 : n <= 7 ? 0.40 : n <= 9 ? 0.34 : n <= 11 ? 0.29 : 0.27;
  }
  function layout() {
    const W = el.clientWidth || 1, H = el.clientHeight || 1;
    const r = canvas.getBoundingClientRect();
    view.left = r.left; view.top = r.top;
    view.W = W; view.H = H;
    view.mobile = W < 700;
    const n = Math.max(1, slots.length);
    view.s = spacingFor(n);
    view.R = ((n - 1) * view.s) / 2 + 0.42;
    const hang = 1.35;   // rail to hem, world units
    const Rref = (10 * 0.27) / 2 + 0.42;
    view.ppu = view.mobile
      ? Math.min(W / 1.75, (0.5 * H) / hang)
      : Math.min((0.7 * W) / (2 * Rref), (0.41 * H) / hang);
    const fy = view.mobile ? 0.37 : 0.33;      // rail sits this far down the canvas
    view.Hv = H / 2 / view.ppu;
    view.halfW = W / 2 / view.ppu;
    view.D = view.Hv / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    view.cy = RAIL_Y - (0.5 - fy) * 2 * view.Hv;
    view.panMax = Math.max(0, view.R + 0.15 - view.halfW);
    el.classList.toggle('is-pan', view.panMax > 0);
    slots.forEach((it, i) => { it.slot = i; it.baseX = (i - (n - 1) / 2) * view.s; });
    if (!laidOut) view.Rc = view.R;

    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    if (!laidOut) { cam.panTarget = cam.pan = view.mobile && view.panMax > 0 ? -view.panMax : 0; laidOut = true; }
    cam.panTarget = clamp(cam.panTarget, -view.panMax, view.panMax);
    updateProxies();
  }

  // Row layout: how far slot j is pushed aside when the pick sits at slot ac.
  function rowShift(j, ac, S) {
    const dj = j - ac;
    const ad = Math.abs(dj);
    const g = ad <= 1 ? 1 : Math.exp(-((ad - 1) * (ad - 1)) / (2 * 1.35 * 1.35));
    return S * Math.tanh(2.2 * dj) * g;
  }
  const partSize = (it) => Math.max(0, it.w * 0.49 + 0.26 - view.s);
  const shiftOf = (it) => (active >= 0 && !dragItem && slots[active] ? rowShift(it.slot, active, partSize(slots[active])) : 0);

  // ---- hit proxies: fixed to the layout the row is heading for, never to moving meshes ----
  const activeProxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false }));
  let proxies = [];
  function updateProxies() {
    const n = slots.length;
    proxies = [];
    if (!n) return;
    const S = active >= 0 && slots[active] ? partSize(slots[active]) : 0;
    const tx = slots.map((it) => it.baseX + (active >= 0 && !dragItem ? rowShift(it.slot, active, S) : 0));
    for (let j = 0; j < n; j++) {
      const it = slots[j];
      const gl = j > 0 ? tx[j] - tx[j - 1] : 0.4;
      const gr = j < n - 1 ? tx[j + 1] - tx[j] : 0.4;
      const eL = Math.min(0.5 * gl, 0.17), eR = Math.min(0.5 * gr, 0.17);
      const top = RAIL_Y + 0.07;
      const bot = RAIL_Y - HOOK_H - NECK - it.h - 0.05;
      const px = it.proxy;
      px.position.set(tx[j] + (eR - eL) / 2, (top + bot) / 2, 0.05);
      px.scale.set(eL + eR, top - bot, 1.2);
      px.userData.i = j;
      px.updateMatrixWorld(true);
      proxies.push(px);
    }
    if (active >= 0 && slots[active]) {
      const it = slots[active];
      const top = RAIL_Y + 0.07;
      const bot = RAIL_Y - HOOK_H - NECK - it.h - 0.06;
      activeProxy.position.set(it.baseX, (top + bot) / 2, 0.2);
      activeProxy.scale.set(it.w + 0.1, top - bot, 0.8);
      activeProxy.updateMatrixWorld(true);
    }
  }

  function pointerRay() {
    ndc.set((pointer.x / view.W) * 2 - 1, -(pointer.y / view.H) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }
  // Slot under the pointer (active's expanded box wins), or -1. No dwell: used for taps and grabs.
  function pickNow() {
    pointerRay();
    if (active >= 0) {
      hitBuf.length = 0;
      raycaster.intersectObject(activeProxy, false, hitBuf);
      if (hitBuf.length) return active;
    }
    const hits = raycaster.intersectObjects(proxies, false);
    return hits.length ? hits[0].object.userData.i : -1;
  }
  // Pointer on the garment plane (z = 0), in world units.
  function pointerWorld(out) {
    pointerRay();
    const r = raycaster.ray;
    const t = -r.origin.z / r.direction.z;
    return out.set(r.origin.x + r.direction.x * t, r.origin.y + r.direction.y * t, 0);
  }

  // Hover with hysteresis: a new slot must hold the pointer for DWELL_MS, and hover only clears
  // after LEAVE_MS outside every box, so sweeping the mouse never flickers.
  function pickStep(nowMs) {
    if (modalOpen || dragItem || pan || pointer.type !== 'mouse' || !pointer.inside) return;
    if (!pointer.dirty && nowMs - pointer.lastPickT < 80) return;
    pointer.dirty = false;
    pointer.lastPickT = nowMs;
    const c = pickNow();
    if (c >= 0) {
      leaveSince = 0;
      if (c === hoverIdx) { candIdx = -1; return; }
      if (c !== candIdx) { candIdx = c; candSince = nowMs; }
      if (nowMs - candSince >= DWELL_MS) { hoverIdx = c; focusIdx = -1; candIdx = -1; }
    } else {
      candIdx = -1;
      if (hoverIdx >= 0 && !leaveSince) leaveSince = nowMs;
    }
  }

  function nearestToCenter() {
    let best = 0, bd = 1e9;
    slots.forEach((it, i) => { const d = Math.abs(it.baseX - cam.panTarget); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function focusItem(i) {
    i = clamp(i, 0, slots.length - 1);
    focusIdx = i;
    hoverIdx = -1;
    cam.panTarget = clamp(slots[i].baseX, -view.panMax, view.panMax);
    wake();
  }
  function step(dir) {
    const cur = active >= 0 ? active : (dir > 0 ? nearestToCenter() - 1 : nearestToCenter() + 1);
    focusItem(cur + dir);
  }

  function setActive(a) {
    if (a === active) return;
    active = a;
    const t = nowS();
    for (const it of slots) {
      const on = it.slot === a;
      if (on !== it.on) { it.on = on; twTo(it.hv, on ? 1 : 0, t, TURN_S); }
    }
    if (a >= 0 && slots[a]) { captionEl.textContent = captionOf(slots[a].p); lastHover = a; }
    updateProxies();
    wake();
  }

  // The garment a "see availability" button should open: hovered, else the one nearest the middle.
  function current() {
    if (active >= 0 && slots[active]) return slots[active].pi;
    if (pointer.type === 'mouse' && lastHover >= 0 && slots[lastHover]) return slots[lastHover].pi;
    return slots[nearestToCenter()].pi;
  }
  const itemOf = (pi) => items.find((it) => it.pi === pi);

  // On-screen rectangle of a garment as if it faced the camera (target of the open/close flight).
  function slotRect(pi) {
    const it = itemOf(pi);
    const r = canvas.getBoundingClientRect();
    if (!it || it.state === 'hidden') return { left: r.left + r.width / 2 - 60, top: r.top + r.height * 0.3, width: 120, height: 150 };
    tmpV.set(it.x, RAIL_Y - HOOK_H - NECK, 0).project(camera);
    const cx = r.left + (tmpV.x * 0.5 + 0.5) * view.W;
    const top = r.top + (-tmpV.y * 0.5 + 0.5) * view.H;
    const w = it.w * view.ppu, h = it.h * view.ppu;
    return { left: cx - w / 2, top, width: w, height: h };
  }

  // ---- frozen snapshot while the detail view is open ------------------------------------
  function takeSnapshot() {
    drawScene();
    const sw = Math.max(2, Math.round(canvas.width / 5)), sh = Math.max(2, Math.round(canvas.height / 5));
    snap.width = sw; snap.height = sh;
    const g = snap.getContext('2d');
    g.filter = 'blur(2px)';
    g.drawImage(canvas, 0, 0, sw, sh);
    g.filter = 'none';
  }
  function setModal(v) {
    if (v === modalOpen) return;
    modalOpen = v;
    if (v) {
      takeSnapshot();
      snap.style.transition = 'none'; snap.style.opacity = '1';
      void snap.offsetWidth;
      frozen = true;
      stopLoop();
      requestAnimationFrame(() => {
        if (!frozen) return;
        canvas.style.visibility = 'hidden';
        snap.style.transition = ''; snap.style.opacity = '';
      });
      hoverIdx = -1; focusIdx = -1; candIdx = -1; leaveSince = 0; if (press) clearTimeout(press.timer); press = null; pan = null; releaseDrag();
    } else {
      frozen = false;
      canvas.style.visibility = '';
      snap.style.opacity = '';
      wake();
    }
  }

  // ---- pointer input -------------------------------------------------------
  function localPointer(e) {
    pointer.x = e.clientX - view.left; pointer.y = e.clientY - view.top;
    pointer.nx = (pointer.x / view.W) * 2 - 1;
    pointer.ny = (pointer.y / view.H) * 2 - 1;
    pointer.type = e.pointerType || 'mouse';
  }
  // Dragging a garment slides its hanger along the rail.
  function beginDrag(idx) {
    const it = slots[idx];
    if (!it) return;
    hoverIdx = idx; focusIdx = -1; candIdx = -1; leaveSince = 0;
    dragItem = it; it.dragged = true;
    pointerWorld(tmpV);
    drag.gx = tmpV.x - it.x; drag.wx = tmpV.x;
    setActive(idx);
    updateProxies();
    wake();
  }
  function releaseDrag() {
    if (!dragItem) return;
    dragItem.dragged = false; dragItem.resume = true;
    dragItem = null;
    updateProxies();
    wake();
  }
  function onPointerMove(e) {
    localPointer(e);
    pointer.inside = true;
    pointer.dirty = true;
    if (press && e.pointerId === press.id && !dragItem) {
      if (Math.hypot(e.clientX - press.x0, e.clientY - press.y0) > CLICK_PX) {
        if (press.kind === 'pan') { pan = { id: press.id, x0: press.x0, pan0: cam.panTarget, lastX: press.x0, lastT: performance.now(), v: 0, moved: false }; clearTimeout(press.timer); press = null; }
        else { beginDrag(press.idx); press.dragging = true; }
      }
    }
    if (pan && e.pointerId === pan.id) {
      const dx = e.clientX - pan.x0;
      if (!pan.moved && Math.abs(dx) > CLICK_PX) pan.moved = true;
      if (pan.moved) {
        const upp = 1 / view.ppu;
        cam.panTarget = clamp(pan.pan0 - dx * upp, -view.panMax, view.panMax);
        cam.pan = cam.panTarget; cam.panVel = 0; cam.fling = 0;
        const now = performance.now();
        const dt = Math.max(1, now - pan.lastT);
        pan.v = lerp(pan.v, (-(e.clientX - pan.lastX) * upp) / (dt / 1000), 0.4);
        pan.lastX = e.clientX; pan.lastT = now;
      }
    }
    wake();
  }
  function onPointerDown(e) {
    if (modalOpen || e.button > 0) return;
    localPointer(e);
    pointer.inside = true;
    const idx = pickNow();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
    if (idx >= 0) {
      // a garment is dragged by its hanger; on touch with a pannable rail a swipe pans instead, so it always has somewhere to start
      const kind = e.pointerType !== 'mouse' && view.panMax > 0 ? 'pan' : 'hanger';
      const pr = { id: e.pointerId, idx, kind, x0: e.clientX, y0: e.clientY, t0: performance.now(), dragging: false, timer: 0 };
      pr.timer = setTimeout(() => { if (press === pr && !dragItem && pr.kind !== 'pan') beginDrag(pr.idx); }, CLICK_MS);   // a long press is a grab
      press = pr;
    } else if (view.panMax > 0) {
      pan = { id: e.pointerId, x0: e.clientX, pan0: cam.panTarget, lastX: e.clientX, lastT: performance.now(), v: 0, moved: false };
    }
    wake();
  }
  function onPointerUp(e) {
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
    if (press && e.pointerId === press.id) {
      const p = press; press = null; clearTimeout(p.timer);
      if (dragItem) { releaseDrag(); return; }
      const quick = performance.now() - p.t0 < CLICK_MS;
      if (quick && e.type !== 'pointercancel' && !modalOpen) { localPointer(e); const idx = pickNow(); open(slots[idx >= 0 ? idx : p.idx].pi); }
      return;
    }
    if (pan && e.pointerId === pan.id) {
      const p = pan; pan = null;
      if (p.moved && view.panMax > 0) cam.fling = clamp(p.v, -6, 6);
      wake();
    }
  }
  function onPointerLeave() {
    if (dragItem || pan) return;
    pointer.inside = false;
    pointer.nx = 0; pointer.ny = 0;
    candIdx = -1;
    if (pointer.type === 'mouse' && hoverIdx >= 0 && !leaveSince) leaveSince = performance.now();
    wake();
  }
  function onWheel(e) {
    if (view.panMax <= 0 || modalOpen) return;
    if (!(e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) return;
    e.preventDefault();
    cam.panTarget = clamp(cam.panTarget + (e.deltaX || e.deltaY) / view.ppu, -view.panMax, view.panMax);
    wake();
  }
  function onKey(e) {
    if (modalOpen) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if ((e.key === 'Enter' || e.key === ' ') && active >= 0) { e.preventDefault(); open(slots[active].pi); }
    else if (e.key === 'Escape') { focusIdx = -1; wake(); }
  }
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);

  // ---- tabs ------------------------------------------------------------------
  function setGroup(g) {
    if (g === group || !items.length || (g !== ALL && !GROUPS.includes(g))) return;
    group = g;
    const t = nowS();
    const next = items.filter((it) => g === ALL || it.p.group === g);
    const nextSet = new Set(next);
    const prev = slots;
    const camX = cam.pan;
    const edge = view.halfW + 0.9;
    const arrived = (it) => it.state === 'rest' || (it.state === 'in' && t >= it.tx.t0 && Math.abs(it.x - camX) < view.halfW + 0.3);
    // garments still waiting off-screen for their entrance simply never show up
    for (const it of prev) {
      if (!nextSet.has(it) && !arrived(it)) { it.state = 'hidden'; it.root.visible = false; it.shadow.visible = false; it.slot = -1; }
    }
    const kept = prev.filter((it) => nextSet.has(it));
    const keptOn = kept.filter(arrived);
    const keptMid = keptOn.length ? keptOn.reduce((sum, it) => sum + it.x, 0) / keptOn.length : null;

    // outgoing: slide off along the rail on the side they are already on
    const gone = prev.filter((it) => !nextSet.has(it) && it.state !== 'hidden');
    const left = gone.filter((it) => keptMid === null || it.x <= keptMid).sort((a, b) => b.x - a.x);
    const right = gone.filter((it) => keptMid !== null && it.x > keptMid).sort((a, b) => a.x - b.x);
    left.forEach((it, k) => { it.state = 'out'; it.side = -1; it.slot = -1; twTo(it.tx, camX - edge - k * 0.34, t, SHIFT_S, k * 0.045); });
    right.forEach((it, k) => { it.state = 'out'; it.side = 1; it.slot = -1; twTo(it.tx, camX + edge + k * 0.34, t, SHIFT_S, k * 0.045); });
    for (const it of prev) { it.on = false; twTo(it.hv, 0, t, TURN_S); }

    slots = next;
    hoverIdx = -1; focusIdx = -1; active = -1; candIdx = -1; leaveSince = 0;
    layout();
    cam.panTarget = view.mobile && view.panMax > 0 ? -view.panMax : 0;

    // incoming: from the right (or from the side their slot lies on, relative to what stays)
    const kIn = [0, 0];
    const fromLeftN = next.filter((it) => !kept.includes(it) && it.state !== 'out' && keptMid !== null && it.baseX < keptMid).length;
    let seenLeft = 0;
    next.forEach((it) => {
      if (kept.includes(it)) { twTo(it.tx, it.baseX, t, SHIFT_S); return; }
      if (it.state === 'out') { it.state = 'in'; twTo(it.tx, it.baseX, t, SHIFT_S); return; }   // changed its mind mid-exit
      const fromLeft = keptMid !== null && it.baseX < keptMid;
      const s = fromLeft ? -1 : 1;
      // queue order must match rail order: the slot nearest the rest of the rail waits nearest the screen edge
      const rank = fromLeft ? fromLeftN - 1 - seenLeft++ : kIn[1]++;
      it.state = 'in'; it.side = s;
      it.x = camX + s * (edge + rank * 0.34 + 0.2); it.v = 0;
      twSet(it.tx, it.x); twTo(it.tx, it.baseX, t, ENTER_S, rank * 0.045 + 0.12);
      twSet(it.hv, 0); it.hvV = 0; it.yaw = it.hy = REST_YAW; it.hyv = 0; it.th = it.om = 0; it.m0 = false;
      it.root.visible = true; it.shadow.visible = true;
    });
    updateProxies();
    syncSr();
    wake();
    el.dispatchEvent(new CustomEvent('cloak:group', { detail: { group } }));
  }

  // ---- motion --------------------------------------------------------------
  // Every value is a function of time (tweens) or an exact critically damped follow, so a frame at any display
  // rate lands on the right pose; there is no fixed step and nothing to interpolate.
  const _tv = [0, 0];
  const frontYaw = (it) => Math.atan2(cam.pan - it.x, view.D) * 0.85;
  // Minimum spacing between two hangers at their current turn: nested slabs need only their thickness, a front-facing
  // garment next to a side-on one needs the sum of half-widths.
  const half = (it) => 0.5 * (it.w * Math.abs(Math.cos(it.yaw)) + 2 * it.T0 * Math.abs(Math.sin(it.yaw)));
  function gapFor(a, b) {
    const s = Math.min(1, Math.abs(Math.abs(Math.cos(a.yaw)) - Math.abs(Math.cos(b.yaw))) * 2.5);
    const par = (a.T0 + b.T0) / Math.max(0.5, Math.abs(Math.sin((a.yaw + b.yaw) * 0.5))) + 0.01;
    return par + (half(a) + half(b) - par) * s;
  }
  // While a hanger is dragged along the rail it pushes its neighbours ahead of it.
  function pushTargets() {
    const di = dragItem.slot;
    for (let j = di - 1; j >= 0; j--) {
      const a = slots[j], b = slots[j + 1];
      a.tgt = Math.min(a.tgt, (j + 1 === di ? b.x : b.tgt) - gapFor(a, b));
    }
    for (let j = di + 1; j < slots.length; j++) {
      const a = slots[j - 1], b = slots[j];
      b.tgt = Math.max(b.tgt, (j - 1 === di ? a.x : a.tgt) + gapFor(a, b));
    }
  }
  // Secondary motion. The hem is a spring that follows the garment's yaw, so it trails a turn (lag = yaw - hem yaw) and
  // overshoots once as the turn ends; the whole garment is a pendulum about the hook whose equilibrium is leaned by the
  // sideways acceleration and by the turn's start/end. Both are underdamped and settle in well under a second.
  function secondary(it, dt) {
    if (!it.m0) { it.m0 = true; it.hy = it.yaw; it.hyv = 0; it.vPrev = it.v; it.yPrev = it.yaw; it.yvPrev = 0; return; }
    if (reducedMotion) { it.hy = it.yaw; it.hyv = 0; it.th = it.om = 0; return; }
    if (dt < 1e-4) return;
    const yv = (it.yaw - it.yPrev) / dt, ya = clamp((yv - it.yvPrev) / dt, -60, 60), ax = clamp((it.v - it.vPrev) / dt, -12, 12);
    it.yPrev = it.yaw; it.yvPrev = yv; it.vPrev = it.v;
    const u = clamp(-TILT_KA * ax + TILT_KY * ya, -TILT_MAX, TILT_MAX);
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    const w2 = TWIST_W * TWIST_W, zw = 2 * TWIST_Z * TWIST_W, tw2 = TILT_W * TILT_W, tzw = 2 * TILT_Z * TILT_W;
    for (let k = 0; k < n; k++) {
      it.hyv += (w2 * (it.yaw - it.hy) - zw * it.hyv) * h; it.hy += it.hyv * h;
      it.om += (tw2 * (u - it.th) - tzw * it.om) * h; it.th += it.om * h;
    }
    it.th = clamp(it.th, -TILT_MAX * 1.4, TILT_MAX * 1.4);
  }
  function motion(now, dt) {
    const t = now / 1000;
    // camera: inertia after a swipe, then a critically damped follow of the pan target
    if (!pan) {
      if (Math.abs(cam.fling) > 0.02 && !reducedMotion) {
        cam.panTarget = clamp(cam.panTarget + cam.fling * dt, -view.panMax, view.panMax);
        cam.fling *= Math.exp(-dt * 3.2);
      } else cam.fling = 0;
    }
    if (dragItem && view.panMax > 0) {
      const e = pointer.nx;
      if (Math.abs(e) > 0.82) cam.panTarget = clamp(cam.panTarget + Math.sign(e) * (Math.abs(e) - 0.82) * 14 * dt, -view.panMax, view.panMax);
    }
    cdamp(cam, 'pan', 'panVel', cam.panTarget, 8, dt);
    cdamp(view, 'Rc', 'railV', view.R, 4.7, dt);
    if (dragItem) { pointerWorld(tmpV); drag.wx = tmpV.x; }

    for (const it of slots) it.tgt = it.baseX + shiftOf(it);
    if (dragItem) pushTargets();
    const minX = -view.Rc + 0.3, maxX = view.Rc - 0.3;
    for (const it of items) {
      if (it.state === 'hidden') continue;
      if (it.dragged) {
        cdamp(it, 'x', 'v', clamp(drag.wx - drag.gx, minX, maxX), 8, dt);
      } else {
        if (it.resume) { it.resume = false; it.tx.f = it.x; it.tx.v0 = it.v; it.tx.to = it.x; it.tx.t0 = t; it.tx.d = 0.001; it.tx.delay = 0; }
        if (it.state !== 'out' && it.slot >= 0) {
          const tg = it.state === 'rest' ? clamp(it.tgt, minX, maxX) : it.tgt;
          if (Math.abs(tg - it.tx.to) > 1e-4) twTo(it.tx, tg, t, TURN_S);
        }
        it.x = twEval(it.tx, t, _tv); it.v = _tv[1];
      }
      const hvv = twEval(it.hv, t, _tv);
      it.hvV = hvv;
      it.yaw = lerp(REST_YAW + it.jitter, frontYaw(it), hvv);
      secondary(it, dt);
      cdamp(it, 'fz', 'fzv', it.dragged ? 1 : 0, 8, dt);

      if (it.state === 'in' && twDone(it.tx, t)) it.state = 'rest';
      if (it.state === 'out' && twDone(it.tx, t) && Math.abs(it.x - cam.pan) > view.halfW + it.w * 0.5 + 0.35) { it.state = 'hidden'; it.root.visible = false; it.shadow.visible = false; it.v = 0; }
    }
  }

  // Quiet: no tween running, no follower moving, nobody interacting.
  function settled(why) {
    const no = (r) => (why ? r : false);
    const t = nowS();
    if (dragItem || press || pan || candIdx >= 0 || leaveSince || pointer.dirty) return no('input');
    if (Math.abs(cam.pan - cam.panTarget) > 0.0005 || Math.abs(cam.panVel) > 0.003 || Math.abs(cam.fling) > 0.02) return no('pan');
    if (Math.abs(view.Rc - view.R) > 0.0005 || Math.abs(view.railV) > 0.003) return no('rail');
    for (const it of items) {
      if (it.state === 'hidden') continue;
      if (it.state !== 'rest') return no('state');
      if (!twDone(it.tx, t) || !twDone(it.hv, t)) return no('tween');
      if (Math.abs(it.x - it.tgt) > 0.0004) return no('x');
      if (Math.abs(it.th) > 0.0008 || Math.abs(it.om) > 0.004 || Math.abs(it.fz) > 0.001 || Math.abs(it.fzv) > 0.004) return no('tilt');
      if (Math.abs(it.yaw - it.hy) > 0.0008 || Math.abs(it.hyv) > 0.006) return no('twist');
    }
    return true;
  }

  // ---- drawing -------------------------------------------------------------
  function apply() {
    const camX = cam.pan;
    const edge = view.halfW + 0.7;
    for (const it of items) {
      if (it.state === 'hidden') continue;
      const onScreen = Math.abs(it.x - camX) < edge + it.w * 0.5;
      it.root.visible = onScreen; it.shadow.visible = onScreen;
      if (!onScreen) continue;
      if (!it.warmed) warm(it);
      const hv = it.hvV;
      it.root.position.set(it.x, RAIL_Y + LIFT_H * hv, SLIDE_Z * hv + 0.1 * it.fz);
      it.root.rotation.set(-0.05 * hv, 0, it.th);
      it.body.rotation.y = it.yaw;
      it.uni.uTwist.value = reducedMotion ? 0 : clamp(-TWIST_GAIN * (it.yaw - it.hy), -TWIST_MAX, TWIST_MAX);
      // soft shadow on the wall: narrows as the garment turns side-on, softens and drifts when lifted
      const face = 0.1 + 0.9 * Math.abs(Math.cos(it.yaw));
      const pad = 1 + 32 / Math.max(1, it.mf.sw);
      const sm = it.shadow;
      sm.scale.set(it.w * face * pad * 1.05, it.h * pad * 1.05, 1);
      sm.position.set(it.x + 0.045 + 0.04 * hv + Math.sin(it.th) * 0.1, RAIL_Y - HOOK_H - NECK - it.h * 0.5 - 0.035 - 0.015 * hv, WALL_Z + 0.25);
      sm.material.opacity = 0.13 - 0.03 * hv;
    }
    camera.position.set(camX, view.cy, view.D);
    camera.lookAt(camX, view.cy, 0);
    camera.updateMatrixWorld();
    const R = view.Rc;
    rail.scale.x = R * 2;
    railShadow.scale.set(R * 2 + 0.5, 0.2, 1);
    for (const b of brackets) b.m.position.x = b.sgn * (R - 0.22);
    for (const c of caps) c.cap.position.x = c.sgn * R;
  }

  // Draw the current state once: boot, snapshots, resizes.
  function drawScene() {
    time = nowS();
    motion(performance.now(), 0);
    apply();
    updateCaption();
    renderer.render(scene, camera);
  }

  // Grey "Name — colour" line under the hovered garment (fades over 200 ms in CSS).
  function updateCaption() {
    const it = active >= 0 ? slots[active] : null;
    const on = !!it && !modalOpen && !dragItem;
    if (captionEl.classList.contains('is-on') !== on) captionEl.classList.toggle('is-on', on);
    if (!it) return;
    tmpV.set(it.root.position.x, RAIL_Y - HOOK_H - NECK - it.h - 0.02, it.root.position.z);
    tmpV.project(camera);
    let x = (tmpV.x * 0.5 + 0.5) * view.W;
    let y = (-tmpV.y * 0.5 + 0.5) * view.H + 18;
    const lw = captionEl.offsetWidth || 220;
    x = clamp(x, lw / 2 + 12, view.W - lw / 2 - 12);
    y = clamp(y, 12, view.H - 120);
    if (Math.abs(x - capX) > 0.1 || Math.abs(y - capY) > 0.1) {
      capX = x; capY = y;
      captionEl.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, 0)`;
    }
  }

  // Texture upload is the expensive part of a first draw: spread it over frames.
  const warmQueue = [];
  function warm(it) {
    if (it.warmed) return;
    it.warmed = true;
    for (const t of it.textures) warmQueue.push(t);
  }
  function warmOne() {
    const t = warmQueue.shift();
    if (t) renderer.initTexture(t);
    return warmQueue.length;
  }

  // The loop runs only while something moves (a tween, a follower, a drag, a pending hover) and stops when
  // everything is still; any input or resize wakes it again.
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dtReal = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    const c0 = performance.now();
    time = now / 1000;

    pickStep(now);
    if (hoverIdx >= 0 && leaveSince && now - leaveSince > LEAVE_MS) { hoverIdx = -1; leaveSince = 0; }
    if (modalOpen) leaveSince = 0;
    setActive(hoverIdx >= 0 ? hoverIdx : focusIdx);

    motion(now, dtReal);
    warmOne();
    apply();
    updateCaption();
    canvas.style.cursor = dragItem || (pan && pan.moved) ? 'grabbing' : (hoverIdx >= 0 || view.panMax > 0 ? 'grab' : 'default');
    renderer.render(scene, camera);
    const c1 = performance.now();
    frameStats.frames++;
    if (perf.on) { const ms = c1 - c0; perf.n++; perf.sum += ms; perf.max = Math.max(perf.max, ms); perf.samples.push(ms); }
    if (!fixDpr) adaptDpr(now, dtReal, c1 - c0);

    // everything still for a few frames (and no texture waiting for upload) -> stop drawing
    if (settled() && !warmQueue.length) {
      if (++calmFrames >= 3) { idle = true; stopLoop(); }
    } else calmFrames = 0;
  }

  // Resolution: full device pixel ratio (cap 2). It drops only after a sustained slow stretch (2 s of frames
  // well over the display's own period, or heavy CPU time), never below 1.25 on a high-DPI screen, and comes back when calm.
  const dtWin = [], cpuWin = [];
  let dprFrames = 0;
  function adaptDpr(now, dtReal, cpuMs) {
    dtWin.push(dtReal * 1000); cpuWin.push(cpuMs);
    if (dtWin.length > 120) { dtWin.shift(); cpuWin.shift(); }
    if (++dprFrames % 30 || dtWin.length < 110 || now - lastDprT < 2000) return;
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const aDt = avg(dtWin), aCpu = avg(cpuWin);
    const p10 = [...dtWin].sort((x, y) => x - y)[Math.floor(dtWin.length * 0.1)];
    const floor = Math.min(DPR_CAP, 1.25);
    if ((aCpu > 14 || (aDt > p10 * 1.5 && aDt > 22)) && dpr > floor + 0.01) { dpr = Math.max(floor, dpr * 0.85); applyDpr(); lastDprT = now; dtWin.length = cpuWin.length = 0; }
    else if (aCpu < 7 && aDt < p10 * 1.25 && dpr < DPR_CAP - 0.01 && now - lastDprT > 6000) { dpr = Math.min(DPR_CAP, dpr * 1.2); applyDpr(); lastDprT = now; dtWin.length = cpuWin.length = 0; }
  }
  function applyDpr() { renderer.setPixelRatio(dpr); renderer.setSize(view.W, view.H, false); }

  function startLoop() {
    if (running || frozen || paused) return;
    if (!(ready && visible && !document.hidden)) return;
    running = true; last = performance.now(); calmFrames = 0; idle = false;
    raf = requestAnimationFrame(frame);
  }
  function stopLoop() { running = false; cancelAnimationFrame(raf); }
  function wake() { calmFrames = 0; idle = false; startLoop(); }
  function sync() { if (ready && visible && !document.hidden && !frozen && !paused) { startLoop(); if (!running) drawScene(); } else stopLoop(); }

  function makeEnv() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    scene.environment = pmrem.fromScene(roomEnv, 0.035, 0.1, 100, { size: 128 }).texture;
    pmrem.dispose();
    performance.mark('cloak:env');
  }

  // ---- boot ----------------------------------------------------------------
  new ResizeObserver(() => { if (slots.length || items.length) { layout(); if (!running && !frozen) { drawScene(); } wake(); } }).observe(el);
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; sync(); }, { threshold: 0.2 }).observe(el);
  document.addEventListener('visibilitychange', sync);
  addEventListener('scroll', () => { const r = canvas.getBoundingClientRect(); view.left = r.left; view.top = r.top; }, { passive: true });

  function syncSr() {
    srList.textContent = '';
    for (const it of slots) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = captionOf(it.p);
      b.addEventListener('click', () => open(it.pi));
      li.append(b);
      srList.append(li);
    }
  }

  (async () => {
    let mf;
    try { mf = await (await fetch(BAKED + 'manifest.json')).json(); } catch (_) { return; }
    const mid = view.mobile || el.clientWidth < 700;
    const results = await Promise.allSettled(PRODUCTS.map(async (p) => {
      const m = mf[p.file];
      if (!m) throw new Error(p.file);
      const [color, normal, shadow, mesh] = await Promise.all([
        loadBitmap(BAKED + p.file + (mid ? '.m.webp' : '.webp')), loadBitmap(BAKED + p.file + '.n.webp'),
        loadBitmap(BAKED + p.file + '.s.png'),
        fetch(BAKED + p.file + '.mesh').then((r) => r.arrayBuffer()),
      ]);
      return { p, m, assets: { color, normal, shadow, mesh } };
    }));
    performance.mark('cloak:loaded');
    await new Promise((res) => setTimeout(res, 0));
    makeEnv();
    await new Promise((res) => setTimeout(res, 0));
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      items.push(buildItem(r.value.p, items.length, r.value.m, r.value.assets));
      if (items.length % 2 === 0) await new Promise((res) => setTimeout(res, 0));   // keep each task short
    }
    performance.mark('cloak:built');
    if (!items.length) return;
    slots = items.slice();
    layout();
    // the whole rail enters from the right, staggered (the slides start once everything is ready, below)
    slots.forEach((it, k) => {
      it.state = 'in'; it.side = 1;
      it.x = cam.pan + view.halfW + 1.2 + k * 0.34; it.v = 0;
      twSet(it.tx, it.x);
      it.root.visible = true; it.shadow.visible = true;
    });
    syncSr();
    // upload what the first screen needs (two textures per frame) while the shaders compile in parallel
    const firstScreen = slots.filter((it) => Math.abs(it.baseX - cam.pan) < view.halfW + it.w);
    firstScreen.forEach(warm);
    const compile = Promise.race([renderer.compileAsync(scene, camera).catch(() => {}), new Promise((r) => setTimeout(r, 2500))]);
    // rAF can be throttled (background tab): never wait on it alone
    const tick = () => new Promise((r) => { let done = false; const f = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(f); setTimeout(f, 60); });
    while (warmQueue.length) { warmOne(); warmOne(); await tick(); }
    performance.mark('cloak:warmed');
    await compile;
    performance.mark('cloak:compiled');
    for (const it of items) { it.root.visible = false; it.shadow.visible = false; }
    { const t0 = nowS(); slots.forEach((it, k) => twTo(it.tx, it.baseX, t0, ENTER_S, 0.35 + k * 0.05)); }
    ready = true;
    el.classList.add('is-ready');
    drawScene();      // one frame right away, even if rAF is throttled
    el.dispatchEvent(new CustomEvent('cloak:ready'));
    sync();
  })();

  // Test hooks: where a garment's fabric is on screen / in the world, and a per-frame record of one particle.
  function nodeAt(it, u, v) {
    const cl = it.cl;
    let best = 0, bd = 1e9;
    for (let k = 0; k < cl.n; k++) {
      const d = (cl.uvN[k * 2] - u) ** 2 + (cl.uvN[k * 2 + 1] - v) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }
  function nodeWorldRendered(it, k, out) {
    const e = it.shells[0].matrixWorld.elements, G = it.cl.G;
    const x = G[k * 3], y = G[k * 3 + 1], z = G[k * 3 + 2];
    return out.set(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
  }
  function nodeScreen(slot, u, v) {
    const it = slots[slot];
    const k = nodeAt(it, u, v);
    nodeWorldRendered(it, k, tmpV).project(camera);
    return { x: view.left + (tmpV.x * 0.5 + 0.5) * view.W, y: view.top + (-tmpV.y * 0.5 + 0.5) * view.H };
  }
  function warmAll() { for (const it of items) warm(it); while (warmOne()); }

  const api = {
    get items() { return items; }, get slots() { return slots; }, view, cam, current, slotRect, setModal, setGroup,
    get group() { return group; }, focus: (i) => focusItem(i), getActive: () => active, groups: [ALL, ...GROUPS],
    drawNow: drawScene, warmAll, pause(v) { paused = v; if (v) stopLoop(); else wake(); }, settled: (w) => settled(w), stats: frameStats, perf, renderer,
    get running() { return running; }, get idle() { return idle; },
    get dpr() { return dpr; }, setDpr(v) { dpr = v; applyDpr(); },
    get drag() { return dragItem; },
    nodeScreen, TURN_S, DWELL_MS, LEAVE_MS,
  };
  el.__cloak = api;
  return api;

  // No WebGL: a plain row of the cutouts, still opening the detail view.
  function fallback() {
    el.classList.add('cloak--fallback', 'is-ready');
    const flat = document.createElement('div');
    flat.className = 'cloak__flat';
    PRODUCTS.forEach((p, pi) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', captionOf(p));
      b.innerHTML = `<img src="${BAKED}${p.file}.m.webp" alt="" loading="lazy">`;
      b.addEventListener('click', () => open(pi));
      flat.append(b);
    });
    el.append(flat);
    const btns = () => [...flat.children];
    const fb = {
      items: [], slots: [], view: {}, current: () => 0, groups: [ALL, ...GROUPS], group: ALL, setGroup: () => {},
      slotRect: (pi) => { const r = btns()[pi]?.getBoundingClientRect() || el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; },
      setModal: () => {},
    };
    el.__cloak = fb;
    return fb;
  }
}

// Cloth: position-based dynamics for one garment.
//
// The garment is a sheet of particles on a regular grid, cut to the baked silhouette (plus a one-cell
// margin). The sheet is the garment's mid-surface; the renderer offsets it along its own simulated normal
// by +/- the baked inflation height to get the front and back shells, so the garment keeps its volume
// while it bends. The simulation runs in world space; the particles under the hanger are pinned to the
// hanger's frame. A sleeping garment is stored in its own frame (garment space) and rides the hanger rigidly.
//
// Garment space: x to the right, y up with the top edge at y = 0 and the hem at y = -h, z toward the viewer.

export const CLOTH = {
  maxCells: 22,        // simulation grid cells along the longer side
  refine: 2,           // render mesh cells per simulation cell (keeps the pillow rim steep at the silhouette)
  sub: 6, iter: 1,     // substeps per fixed step, solver passes per substep: many small steps keep a hanging sheet from stretching
  front: 1.18, back: 0.72,   // the front of a garment bulges a little, the back is flatter (side-on profile)
  sleeveBack: 0.034,   // sleeves sit this far behind the torso plane (m)
  kStruct: 1.0, kShear: 0.1, kHem: 0.35,   // kHem: bending stiffness of the bottom two rows, so hems stay straight
  damp: 2.6,           // air damping, 1/s: fabric settles in about two seconds
  aero: 5,             // extra damping of velocity along the surface normal, 1/s
  gravity: 9.8,
  vmax: 2.2,           // m/s, hard speed cap
  shape: 2.6,          // 1/s, soft pull of every particle back to the garment's own hanging shape: wrinkles flatten, swings settle
  grabW: 10,           // 1/s, how hard the pointer pulls its particles (a heavy, soft spring)
};

const TILT = (25 * Math.PI) / 180;   // fabric above the hanger's arms (hood, collar stand) leans back over the hook

// Where the hanger sits in a garment, from the silhouette alone (shared by the rail and the detail view).
// Garment space: y up, top edge at 0. topRaw[ci]: y of the topmost opaque point of baked column ci (NaN: empty column);
// cellAt(x, y): is there cloth at that point. Tops: the arms run inside the shoulders a little under the shoulder line and
// meet at the neck (the collar region is bridged because a neckline is a hole); trousers hang from two clips pinching
// the waistband.
export function hangerGeometry({ nx, w, h, hw, topRaw, cellAt, tipMargin }) {
  const cw = w / nx;
  const topS = new Float32Array(nx).fill(NaN);
  for (let ci = 0; ci < nx; ci++) {
    let sum = 0, cnt = 0;
    for (let d = -3; d <= 3; d++) { const v = topRaw[ci + d]; if (v === v) { sum += v; cnt++; } }
    if (cnt) topS[ci] = sum / cnt;
  }
  const topAt = (x) => {
    let ci = Math.round((x / w + 0.5) * nx - 0.5);
    ci = Math.max(0, Math.min(nx - 1, ci));
    for (let d = 0; d < nx; d++) { const v = topS[ci + d]; if (v === v) return v; const u = topS[ci - d]; if (u === u) return u; }
    return 0;
  };
  let xl = 1e9, xr = -1e9;
  for (let ci = 0; ci < nx; ci++) if (topS[ci] === topS[ci]) { const x = (ci + 0.5) * cw - w / 2; xl = Math.min(xl, x); xr = Math.max(xr, x); }
  const xc = 0.32 * hw;
  const bridge = (x) => (Math.abs(x) >= xc ? topAt(x) : topAt(-xc) + (topAt(xc) - topAt(-xc)) * ((x + xc) / (2 * xc)));
  // Shoulder line: a least-squares line through the outer shoulder, extended toward the middle, so a hood or a collar
  // stand does not pull the arms up; where the silhouette itself is lower (a neckline) the silhouette wins.
  let sx = 0, sy = 0, sxx = 0, sxy = 0, cnt = 0;
  for (let k = 0; k <= 12; k++) {
    const u = (0.78 + (0.27 * k) / 12) * hw;
    for (const sg of [-1, 1]) { const y = topAt(sg * u); sx += u; sy += y; sxx += u * u; sxy += u * y; cnt++; }
  }
  let slope = (cnt * sxy - sx * sy) / Math.max(1e-9, cnt * sxx - sx * sx);
  const clamped = Math.min(-0.12, Math.max(-0.6, slope));
  const icpt = clamped === slope ? (sy - slope * sx) / cnt : (sy - clamped * sx) / cnt;
  slope = clamped;
  const refY = (x) => Math.min(icpt + slope * Math.abs(x), bridge(x));
  const apexY = refY(0) - 0.024;
  const armY = (x) => Math.min(refY(x) - 0.024, apexY - 0.16 * Math.abs(x));
  // the arm tips must stay inside the fabric: shorten the arms until there is cloth a little beyond each tip
  let hwe = hw;
  while (hwe > 0.1 && !(cellAt(hwe + tipMargin, armY(hwe)) && cellAt(-hwe - tipMargin, armY(-hwe)))) hwe -= 0.01;
  const arm = [-1, -0.62, -0.28, 0, 0.28, 0.62, 1].map((u) => [u * hwe, armY(u * hwe)]);
  const span = xr - xl;
  const clipX = [xl + 0.24 * span, xr - 0.24 * span];
  return { topAt, refY, armY, apexY, hwe, arm, clipX, xl, xr };
}

// ---------- build -------------------------------------------------------------------------------------
// o: { nx, ny, hq(Uint16 height field on (nx+1)*(ny+1)), cells(Uint8 nx*ny), w, h, T0, bottom, hw, bw }
export function createCloth(o) {
  const { nx, ny, hq, cells, w, h, T0, bottom, hw, bw } = o;
  const S = nx + 1;
  const sp = Math.max(w, h) / (o.maxCells || CLOTH.maxCells);
  const cols = Math.max(8, Math.round(w / sp)), rows = Math.max(8, Math.round(h / sp));
  const dx = w / cols, dy = h / rows;
  const C1 = cols + 1;
  const rx = nx / cols, ry = ny / rows;

  // particles: grid nodes near the silhouette
  const idxOf = new Int32Array(C1 * (rows + 1)).fill(-1);
  const list = [];
  const R = 1.5;
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const fi = i * rx, fj = j * ry;
      const x0 = Math.max(0, Math.floor(fi - rx * R)), x1 = Math.min(nx - 1, Math.ceil(fi + rx * R));
      const y0 = Math.max(0, Math.floor(fj - ry * R)), y1 = Math.min(ny - 1, Math.ceil(fj + ry * R));
      let on = false;
      for (let cy = y0; cy <= y1 && !on; cy++) for (let cx = x0; cx <= x1; cx++) if (cells[cy * nx + cx]) { on = true; break; }
      if (on) { idxOf[j * C1 + i] = list.length; list.push(j * C1 + i); }
    }
  }
  const n = list.length;
  const gx = new Float32Array(n), gy = new Float32Array(n), gz = new Float32Array(n), uvN = new Float32Array(n * 2), thick = new Float32Array(n);
  const kT = T0 / 65535;
  const hAt = (fx, fy) => {
    fx = Math.min(nx, Math.max(0, fx)); fy = Math.min(ny, Math.max(0, fy));
    const x0 = Math.min(nx - 1, Math.floor(fx)), y0 = Math.min(ny - 1, Math.floor(fy));
    const tx = fx - x0, ty = fy - y0;
    const a = hq[y0 * S + x0], b = hq[y0 * S + x0 + 1], c = hq[(y0 + 1) * S + x0], d = hq[(y0 + 1) * S + x0 + 1];
    return ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty) * kT;
  };
  for (let k = 0; k < n; k++) {
    const i = list[k] % C1, j = (list[k] / C1) | 0;
    gx[k] = (i / cols - 0.5) * w; gy[k] = -j * dy;
    uvN[k * 2] = i / cols; uvN[k * 2 + 1] = j / rows;
    thick[k] = hAt(i * rx, j * ry);
  }

  // Top edge of the silhouette per baked column (garment y of the topmost kept cell; the baked cells are grown by about two).
  const chh = h / ny;
  const topRaw = new Float32Array(nx).fill(NaN);
  for (let ci = 0; ci < nx; ci++) for (let cy = 0; cy < ny; cy++) if (cells[cy * nx + ci]) { topRaw[ci] = -(cy + 2) * chh; break; }
  const cellAt = (x, y) => {
    const ci = Math.floor((x / w + 0.5) * nx), cj = Math.floor((-y / h) * ny);
    return ci >= 0 && cj >= 0 && ci < nx && cj < ny && cells[cj * nx + ci] ? 1 : 0;
  };
  const { topAt, refY, armY, apexY, hwe, arm, clipX } = hangerGeometry({ nx, w, h, hw, topRaw, cellAt, tipMargin: 0.07 });

  // quads (render triangles + normals)
  const quads = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = idxOf[j * C1 + i], b = idxOf[j * C1 + i + 1], c = idxOf[(j + 1) * C1 + i], d = idxOf[(j + 1) * C1 + i + 1];
      if (a >= 0 && b >= 0 && c >= 0 && d >= 0) quads.push(a, b, c, d);
    }
  }
  const nq = quads.length / 4;
  const quad = Int32Array.from(quads);

  // render mesh: every simulation cell split RS x RS where the baked silhouette (grown by a cell) is
  const RS = o.refine || CLOTH.refine;
  const FC = cols * RS + 1;
  const fmap = new Int32Array(FC * (rows * RS + 1)).fill(-1);
  const fv = [];        // per vertex: fine i, fine j, parent cell i, parent cell j
  const fidx = [];
  const at0 = (i, j) => idxOf[j * C1 + i];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (at0(i, j) < 0 || at0(i + 1, j) < 0 || at0(i, j + 1) < 0 || at0(i + 1, j + 1) < 0) continue;
      for (let sj = 0; sj < RS; sj++) {
        for (let si = 0; si < RS; si++) {
          const x0 = Math.max(0, Math.floor((i + si / RS) * rx)), x1 = Math.min(nx - 1, Math.ceil((i + (si + 1) / RS) * rx) - 1);
          const y0 = Math.max(0, Math.floor((j + sj / RS) * ry)), y1 = Math.min(ny - 1, Math.ceil((j + (sj + 1) / RS) * ry) - 1);
          let on = false;
          for (let cy = y0; cy <= y1 && !on; cy++) for (let cx = x0; cx <= x1; cx++) if (cells[cy * nx + cx]) { on = true; break; }
          if (!on) continue;
          const ids = [];
          for (let q = 0; q < 4; q++) {
            const fi = i * RS + si + (q & 1), fj = j * RS + sj + (q >> 1), key = fj * FC + fi;
            let id = fmap[key];
            if (id < 0) { id = fv.length / 4; fmap[key] = id; fv.push(fi, fj, i, j); }
            ids.push(id);
          }
          fidx.push(ids[0], ids[2], ids[1], ids[1], ids[2], ids[3]);
        }
      }
    }
  }
  const nf = fv.length / 4;
  const index = Uint16Array.from(fidx);
  const par = new Int32Array(nf * 4), wgt = new Float32Array(nf * 4), uv = new Float32Array(nf * 2), thickF = new Float32Array(nf), infl = new Float32Array(nf * 3);
  const gs = Math.max(1, Math.round(rx / RS)), dxf = w / nx, dyf = h / ny;
  for (let v = 0; v < nf; v++) {
    const fi = fv[v * 4], fj = fv[v * 4 + 1], pi = fv[v * 4 + 2], pj = fv[v * 4 + 3];
    par[v * 4] = at0(pi, pj); par[v * 4 + 1] = at0(pi + 1, pj); par[v * 4 + 2] = at0(pi, pj + 1); par[v * 4 + 3] = at0(pi + 1, pj + 1);
    const fx = (fi - pi * RS) / RS, fy = (fj - pj * RS) / RS;
    wgt[v * 4] = (1 - fx) * (1 - fy); wgt[v * 4 + 1] = fx * (1 - fy); wgt[v * 4 + 2] = (1 - fx) * fy; wgt[v * 4 + 3] = fx * fy;
    uv[v * 2] = fi / (cols * RS); uv[v * 2 + 1] = fj / (rows * RS);
    const bx = uv[v * 2] * nx, by = uv[v * 2 + 1] * ny;
    thickF[v] = hAt(bx, by);
    const tX = (hAt(bx + gs, by) - hAt(bx - gs, by)) / (2 * gs * dxf);
    const tY = (hAt(bx, by + gs) - hAt(bx, by - gs)) / (2 * gs * dyf);   // per unit of going down
    const il = 1 / Math.hypot(tX, tY, 1);
    infl[v * 3] = -tX * il; infl[v * 3 + 1] = tY * il; infl[v * 3 + 2] = il;
  }

  // constraints, row-major so corrections travel from the pinned top downward
  const cA = [], cB = [], cL = [], cK = [];
  const add = (a, b, L, k) => { if (a >= 0 && b >= 0) { cA.push(a); cB.push(b); cL.push(L); cK.push(k); } };
  const at = (i, j) => (i < 0 || j < 0 || i > cols || j > rows ? -1 : idxOf[j * C1 + i]);
  const dg = Math.hypot(dx, dy);
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const a = at(i, j);
      if (a < 0) continue;
      add(a, at(i + 1, j), dx, 0); add(a, at(i, j + 1), dy, 0);
      add(a, at(i + 1, j + 1), dg, 1); add(a, at(i + 1, j - 1), dg, 1);
      if (at(i, j + 2) < 0) { add(a, at(i, j - 2), 2 * dy, 2); add(a, at(i + 2, j), 2 * dx, 2); }   // bottom two rows: stiff, hems stay straight
    }
  }
  const nc = cA.length;
  const kind = Uint8Array.from(cK);

  // pins. Tops: the particles on and just under the arms (they follow the arm curve), plus whatever stands above the
  // arms (hood, collar stand), which is carried leaning back over the hook. Trousers: the waistband at the two clips.
  let pins = [];
  const rest = (k, x, y, z) => { gx[k] = x; gy[k] = y; gz[k] = z; };
  for (let k = 0; k < n; k++) {
    const x = gx[k], y = gy[k];
    if (bottom) {
      for (const cx of clipX) if (Math.abs(x - cx) <= 0.04 && y >= topAt(x) - 0.06) { pins.push(k); break; }
    } else if (Math.abs(x) <= hwe * 1.06) {
      const xx = Math.min(hwe, Math.abs(x)) * Math.sign(x || 1);
      const ay = armY(xx), top = refY(xx) + 0.02;
      if (y <= top && y >= ay - 0.045) pins.push(k);
      else if (y > top) {
        const sv = y - top;
        rest(k, x, top + sv * Math.cos(TILT), -sv * Math.sin(TILT));
        pins.push(k);
      }
    }
  }
  if (pins.length < 6) {
    pins = [];
    for (let k = 0; k < n; k++) {
      const i = list[k] % C1, j = (list[k] / C1) | 0;
      if (bottom ? !(clipX.some((cx) => Math.abs(gx[k] - cx) <= 0.05)) : Math.abs(gx[k]) > hwe * 1.06) continue;
      let top = true;
      for (let jj = 0; jj < j; jj++) if (idxOf[jj * C1 + i] >= 0) { top = false; break; }
      if (top) pins.push(k);
    }
  }
  // anything the pins cannot reach through the structural links would drop off: carry it rigidly
  const reach = new Uint8Array(n);
  const adj = Array.from({ length: n }, () => []);
  for (let c = 0; c < nc; c++) if (kind[c] === 0) { adj[cA[c]].push(cB[c]); adj[cB[c]].push(cA[c]); }
  const stack = pins.slice();
  for (const p of stack) reach[p] = 1;
  while (stack.length) { const a = stack.pop(); for (const b of adj[a]) if (!reach[b]) { reach[b] = 1; stack.push(b); } }
  for (let k = 0; k < n; k++) if (!reach[k]) pins.push(k);
  const npin = pins.length;
  const pinIdx = Int32Array.from(pins);
  const pinL = new Float32Array(npin * 3);
  const inv = new Float32Array(n).fill(1);
  pins.forEach((k, m) => { pinL[m * 3] = gx[k]; pinL[m * 3 + 1] = gy[k]; pinL[m * 3 + 2] = gz[k]; inv[k] = 0; });

  // rest shape: the sleeve region sits a little behind the torso plane, like a garment on a hanger seen side-on
  if (!bottom) {
    for (let k = 0; k < n; k++) {
      const u = Math.min(1, Math.max(0, (Math.abs(gx[k]) - hwe * 0.92) / (hwe * 0.9)));
      gz[k] -= CLOTH.sleeveBack * u * u * (3 - 2 * u);
    }
  }

  // distance (in the sheet) from the top centre to every particle: the reach limit of a grab
  const hang = new Float32Array(n);
  for (let k = 0; k < n; k++) hang[k] = Math.hypot(gx[k], gy[k], gz[k]);

  let tmax = 1e-6; for (let v = 0; v < nf; v++) tmax = Math.max(tmax, thickF[v]);
  const ao = new Float32Array(nf);                // how deep inside the pillow a vertex is: 0 on the seam, 1 in the body
  for (let v = 0; v < nf; v++) ao[v] = Math.min(1, thickF[v] / (0.7 * tmax));
  // thickness of the waistband where the clips grip (pins' thickness)
  let waistT = 0; if (bottom) for (const k of pins) waistT = Math.max(waistT, thick[k]);
  const shapeW = new Float32Array(n);             // the hem is allowed to swing a little more than the shoulders
  for (let k = 0; k < n; k++) shapeW[k] = 1 - 0.45 * Math.min(1, Math.max(0, -gy[k] / h));
  const G = new Float32Array(n * 3);              // garment-space mid-surface (what the meshes show)
  const posF = new Float32Array(nf * 3), posB = new Float32Array(nf * 3), norF = new Float32Array(nf * 3), norB = new Float32Array(nf * 3);

  const cl = {
    n, nf, cols, rows, dx, dy, quad, nq, index, uv, uvN, par, wgt, thick, thickF, infl, gx, gy, gz, hang, w, h, T0, ao, arm, apexY, clipX, waistT, topAt, hwe, shapeW,
    cA: Int32Array.from(cA), cB: Int32Array.from(cB), cL: Float32Array.from(cL), cK: Float32Array.from(cK), kind, nc,
    pinIdx, pinL, npin, inv,
    P: new Float32Array(n * 3), Q: new Float32Array(n * 3), S: new Float32Array(n * 3), N: new Float32Array(n * 3),
    pinA: new Float32Array(npin * 3), pinB: new Float32Array(npin * 3),
    G, N2: new Float32Array(n * 3), T2: new Float32Array(n * 3), U2: new Float32Array(n * 3),
    posF, posB, norF, norB,
    bottom: !!bottom, awake: false, quality: 0, quiet: 0, speed: 0, brushT: 0, cn: new Int32Array(2),
    // grab: up to 24 weighted particles pulled toward a world target
    gN: 0, gIdx: new Int32Array(24), gW: new Float32Array(24), gOff: new Float32Array(72), gT: new Float32Array(3),
    nodeCount: n,
  };
  resetRender(cl);
  return cl;
}

export function applyStiffness(cl) {
  // trouser legs are tubes: they resist folding and collapsing much more than a flat sheet
  const m = cl.bottom ? 3 : 1;
  for (let c = 0; c < cl.nc; c++) cl.cK[c] = cl.kind[c] === 0 ? CLOTH.kStruct : cl.kind[c] === 1 ? Math.min(0.9, CLOTH.kShear * m) : CLOTH.kHem;
}

// Flat rest pose: shells as baked.
export function resetRender(cl) {
  const { n, G, gx, gy } = cl;
  for (let k = 0; k < n; k++) {
    const o = k * 3;
    G[o] = gx[k]; G[o + 1] = gy[k]; G[o + 2] = cl.gz[k];
  }
  frameFromG(cl);
  buildShells(cl);
}

// Front and back shells from the node frames: the mid-surface bilinearly refined onto the render mesh,
// pushed out and in along the normal by the baked inflation height, with the baked rim normal in the node frame.
function buildShells(cl) {
  const { nf, par, wgt, G, N2, T2, U2, thickF, infl, posF, posB, norF, norB } = cl;
  for (let v = 0; v < nf; v++) {
    const a = par[v * 4] * 3, b = par[v * 4 + 1] * 3, c = par[v * 4 + 2] * 3, d = par[v * 4 + 3] * 3;
    const w0 = wgt[v * 4], w1 = wgt[v * 4 + 1], w2 = wgt[v * 4 + 2], w3 = wgt[v * 4 + 3];
    const o = v * 3;
    const t = thickF[v];
    const nx = w0 * N2[a] + w1 * N2[b] + w2 * N2[c] + w3 * N2[d];
    const ny = w0 * N2[a + 1] + w1 * N2[b + 1] + w2 * N2[c + 1] + w3 * N2[d + 1];
    const nz = w0 * N2[a + 2] + w1 * N2[b + 2] + w2 * N2[c + 2] + w3 * N2[d + 2];
    const gx = w0 * G[a] + w1 * G[b] + w2 * G[c] + w3 * G[d];
    const gy = w0 * G[a + 1] + w1 * G[b + 1] + w2 * G[c + 1] + w3 * G[d + 1];
    const gz = w0 * G[a + 2] + w1 * G[b + 2] + w2 * G[c + 2] + w3 * G[d + 2];
    const tf = t * CLOTH.front, tb = t * CLOTH.back;
    posF[o] = gx + nx * tf; posF[o + 1] = gy + ny * tf; posF[o + 2] = gz + nz * tf;
    posB[o] = gx - nx * tb; posB[o + 1] = gy - ny * tb; posB[o + 2] = gz - nz * tb;
    const ia = infl[o], ib = infl[o + 1], ic = infl[o + 2];
    const tx = w0 * T2[a] + w1 * T2[b] + w2 * T2[c] + w3 * T2[d];
    const ty = w0 * T2[a + 1] + w1 * T2[b + 1] + w2 * T2[c + 1] + w3 * T2[d + 1];
    const tz = w0 * T2[a + 2] + w1 * T2[b + 2] + w2 * T2[c + 2] + w3 * T2[d + 2];
    const ux = w0 * U2[a] + w1 * U2[b] + w2 * U2[c] + w3 * U2[d];
    const uy = w0 * U2[a + 1] + w1 * U2[b + 1] + w2 * U2[c + 1] + w3 * U2[d + 1];
    const uz = w0 * U2[a + 2] + w1 * U2[b + 2] + w2 * U2[c + 2] + w3 * U2[d + 2];
    const sx = ia * tx + ib * ux, sy = ia * ty + ib * uy, sz = ia * tz + ib * uz;
    norF[o] = sx + ic * nx; norF[o + 1] = sy + ic * ny; norF[o + 2] = sz + ic * nz;
    norB[o] = sx - ic * nx; norB[o + 1] = sy - ic * ny; norB[o + 2] = sz - ic * nz;
  }
}

// ---------- normals -------------------------------------------------------------------------------------
// Accumulates per-particle surface normals (and the x tangent when tOut is given) from the quads.
export function accumNormals(cl, src, nOut, tOut) {
  const { quad, nq, n } = cl;
  nOut.fill(0, 0, n * 3);
  if (tOut) tOut.fill(0, 0, n * 3);
  for (let q = 0; q < nq; q++) {
    const a = quad[q * 4] * 3, b = quad[q * 4 + 1] * 3, c = quad[q * 4 + 2] * 3, d = quad[q * 4 + 3] * 3;
    // x direction: right; "up" direction: from the lower edge to the upper edge (a, b are the upper corners)
    const ex = ((src[b] - src[a]) + (src[d] - src[c])) * 0.5, ey = ((src[b + 1] - src[a + 1]) + (src[d + 1] - src[c + 1])) * 0.5, ez = ((src[b + 2] - src[a + 2]) + (src[d + 2] - src[c + 2])) * 0.5;
    const ux = ((src[a] - src[c]) + (src[b] - src[d])) * 0.5, uy = ((src[a + 1] - src[c + 1]) + (src[b + 1] - src[d + 1])) * 0.5, uz = ((src[a + 2] - src[c + 2]) + (src[b + 2] - src[d + 2])) * 0.5;
    const nx = ey * uz - ez * uy, ny = ez * ux - ex * uz, nz = ex * uy - ey * ux;
    for (let m = 0; m < 4; m++) {
      const o = quad[q * 4 + m] * 3;
      nOut[o] += nx; nOut[o + 1] += ny; nOut[o + 2] += nz;
      if (tOut) { tOut[o] += ex; tOut[o + 1] += ey; tOut[o + 2] += ez; }
    }
  }
  for (let k = 0; k < n; k++) {
    const o = k * 3;
    const l = Math.hypot(nOut[o], nOut[o + 1], nOut[o + 2]);
    if (l < 1e-12) { nOut[o] = 0; nOut[o + 1] = 0; nOut[o + 2] = 1; } else { nOut[o] /= l; nOut[o + 1] /= l; nOut[o + 2] /= l; }
  }
}

// ---------- waking / sleeping ---------------------------------------------------------------------------
// frame: 16-element column-major rigid matrix, garment space -> world.
export function wake(cl, e) {
  const { n, G, P, Q, S } = cl;
  for (let k = 0; k < n; k++) {
    const o = k * 3, x = G[o], y = G[o + 1], z = G[o + 2];
    P[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
    P[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    P[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  Q.set(P); S.set(P);
  accumNormals(cl, P, cl.N, null);
  cl.awake = true; cl.quiet = 0; cl.speed = 1;
}

// World positions of every particle: the live state when awake, the rigid frame otherwise. out: Float32Array(3n)
export function worldPositions(cl, e, out) {
  if (cl.awake) { out.set(cl.P); return out; }
  const { n, G } = cl;
  for (let k = 0; k < n; k++) {
    const o = k * 3, x = G[o], y = G[o + 1], z = G[o + 2];
    out[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  return out;
}

// Drag one particle's velocity toward (vx, vy, vz) m/s by the share k: a hand running through the fabric.
export function brushNode(cl, i, vx, vy, vz, k) {
  if (cl.inv[i] === 0) return;
  const hs = 1 / 60 / (cl.quality === 2 ? CLOTH.sub : cl.quality === 1 ? 4 : 3), o = i * 3, P = cl.P, Q = cl.Q;
  const cx = (P[o] - Q[o]) / hs, cy = (P[o + 1] - Q[o + 1]) / hs, cz = (P[o + 2] - Q[o + 2]) / hs;
  Q[o] -= (vx - cx) * k * hs; Q[o + 1] -= (vy - cy) * k * hs; Q[o + 2] -= (vz - cz) * k * hs;
}

// ---------- simulation ----------------------------------------------------------------------------------
// MA / MB: garment-space -> world frames (16-element arrays) at the start and end of this step.
// slabs: neighbours as flat slabs [{ e, w, h, side, m }], ns of them.
export function simStep(cl, MA, MB, H, slabs, ns) {
  const { n, P, Q, S, N, inv, pinIdx, pinL, pinA, pinB, npin } = cl;
  const SUB = cl.quality === 2 ? CLOTH.sub : cl.quality === 1 ? 4 : 3, ITER = CLOTH.iter, hs = H / SUB;
  S.set(P);
  for (let m = 0; m < npin; m++) {
    const x = pinL[m * 3], y = pinL[m * 3 + 1], z = pinL[m * 3 + 2], o = m * 3;
    pinA[o] = MA[0] * x + MA[4] * y + MA[8] * z + MA[12]; pinA[o + 1] = MA[1] * x + MA[5] * y + MA[9] * z + MA[13]; pinA[o + 2] = MA[2] * x + MA[6] * y + MA[10] * z + MA[14];
    pinB[o] = MB[0] * x + MB[4] * y + MB[8] * z + MB[12]; pinB[o + 1] = MB[1] * x + MB[5] * y + MB[9] * z + MB[13]; pinB[o + 2] = MB[2] * x + MB[6] * y + MB[10] * z + MB[14];
  }
  const dmp = Math.exp(-CLOTH.damp * hs), aero = 1 - Math.exp(-CLOTH.aero * hs), gdt = -CLOTH.gravity * hs * hs;
  const vmax = CLOTH.vmax * hs, vmax2 = vmax * vmax;
  const hasGrab = cl.gN > 0;
  const ceil = MB[13] + 0.06;
  const pull = 1 - Math.exp(-CLOTH.grabW * hs);

  for (let s = 0; s < SUB; s++) {
    const f0 = s / SUB, f1 = (s + 1) / SUB;
    for (let i = 0; i < n; i++) {
      if (inv[i] === 0) continue;
      const o = i * 3;
      let vx = (P[o] - Q[o]) * dmp, vy = (P[o + 1] - Q[o + 1]) * dmp, vz = (P[o + 2] - Q[o + 2]) * dmp;
      const nx = N[o], ny = N[o + 1], nz = N[o + 2];
      const vn = (vx * nx + vy * ny + vz * nz) * aero;
      vx -= nx * vn; vy -= ny * vn; vz -= nz * vn;
      const s2 = vx * vx + vy * vy + vz * vz;
      if (s2 > vmax2) { const k = vmax / Math.sqrt(s2); vx *= k; vy *= k; vz *= k; }
      Q[o] = P[o]; Q[o + 1] = P[o + 1]; Q[o + 2] = P[o + 2];
      P[o] += vx; P[o + 1] += vy + gdt; P[o + 2] += vz;
    }
    for (let m = 0; m < npin; m++) {
      const o = pinIdx[m] * 3, p = m * 3;
      Q[o] = pinA[p] + (pinB[p] - pinA[p]) * f0; Q[o + 1] = pinA[p + 1] + (pinB[p + 1] - pinA[p + 1]) * f0; Q[o + 2] = pinA[p + 2] + (pinB[p + 2] - pinA[p + 2]) * f0;
      P[o] = pinA[p] + (pinB[p] - pinA[p]) * f1; P[o + 1] = pinA[p + 1] + (pinB[p + 1] - pinA[p + 1]) * f1; P[o + 2] = pinA[p + 2] + (pinB[p + 2] - pinA[p + 2]) * f1;
    }
    // soft shape memory: pull toward the rigid hanging pose (frame interpolated across the step)
    {
      const f = f1, e0 = MA, e1 = MB, ks = 1 - Math.exp(-CLOTH.shape * hs);
      const m0 = e0[0] + (e1[0] - e0[0]) * f, m1 = e0[1] + (e1[1] - e0[1]) * f, m2 = e0[2] + (e1[2] - e0[2]) * f;
      const m4 = e0[4] + (e1[4] - e0[4]) * f, m5 = e0[5] + (e1[5] - e0[5]) * f, m6 = e0[6] + (e1[6] - e0[6]) * f;
      const m8 = e0[8] + (e1[8] - e0[8]) * f, m9 = e0[9] + (e1[9] - e0[9]) * f, m10 = e0[10] + (e1[10] - e0[10]) * f;
      const m12 = e0[12] + (e1[12] - e0[12]) * f, m13 = e0[13] + (e1[13] - e0[13]) * f, m14 = e0[14] + (e1[14] - e0[14]) * f;
      const gx = cl.gx, gy = cl.gy, gz = cl.gz, sw = cl.shapeW;
      for (let i = 0; i < n; i++) {
        if (inv[i] === 0) continue;
        const o = i * 3, x = gx[i], y = gy[i], z = gz[i], k = ks * sw[i];
        P[o] += (m0 * x + m4 * y + m8 * z + m12 - P[o]) * k;
        P[o + 1] += (m1 * x + m5 * y + m9 * z + m13 - P[o + 1]) * k;
        P[o + 2] += (m2 * x + m6 * y + m10 * z + m14 - P[o + 2]) * k;
      }
    }
    if (hasGrab) {
      const T = cl.gT;
      for (let g = 0; g < cl.gN; g++) {
        const o = cl.gIdx[g] * 3, k = pull * cl.gW[g];
        P[o] += (T[0] + cl.gOff[g * 3] - P[o]) * k;
        P[o + 1] += (T[1] + cl.gOff[g * 3 + 1] - P[o + 1]) * k;
        P[o + 2] += (T[2] + cl.gOff[g * 3 + 2] - P[o + 2]) * k;
      }
    }
    solveAll(cl, ITER);
    if (ns) collide(cl, slabs, ns);
    // fabric may be flicked sideways but does not flip up over its own hanger
    for (let i = 0; i < n; i++) {
      const o = i * 3 + 1;
      if (inv[i] !== 0 && P[o] > ceil) { P[o] = ceil; if (Q[o] > ceil) Q[o] = ceil; }
    }
  }
  accumNormals(cl, P, N, null);
  let md = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const a = P[o] - S[o], b = P[o + 1] - S[o + 1], c = P[o + 2] - S[o + 2];
    const d = a * a + b * b + c * c;
    if (d > md) md = d;
  }
  cl.speed = Math.sqrt(md) / H;
}

function solveAll(cl, iters) {
  const { cA, cB, cL, cK, kind, nc, inv, P } = cl;
  for (let it = 0; it < iters; it++) {
    const rev = it & 1;
    for (let q = 0; q < nc; q++) {
      const c = rev ? nc - 1 - q : q;
      if (it > 0 && kind[c] !== 0) continue;
      const a = cA[c] * 3, b = cB[c] * 3;
      const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 1e-14) continue;
      const wa = inv[cA[c]], wb = inv[cB[c]];
      const ws = wa + wb;
      if (ws === 0) continue;
      const d = Math.sqrt(d2);
      const s = (cK[c] * (d - cL[c])) / (d * ws);
      const sa = s * wa, sb = s * wb;
      P[a] += dx * sa; P[a + 1] += dy * sa; P[a + 2] += dz * sa;
      P[b] -= dx * sb; P[b + 1] -= dy * sb; P[b + 2] -= dz * sb;
    }
  }
}

// Neighbours as flat slabs: a particle may not sink into the slab on the side its own garment hangs on.
function collide(cl, slabs, ns) {
  const { n, P, Q, inv, thick } = cl;
  for (let k = 0; k < ns; k++) {
    const sl = slabs[k], e = sl.e, sd = sl.side;
    const wb2 = sl.w * 0.5 + 0.02, hb = sl.h + 0.02;
    for (let i = 0; i < n; i++) {
      if (inv[i] === 0) continue;
      const o = i * 3;
      const dx = P[o] - e[12], dy = P[o + 1] - e[13], dz = P[o + 2] - e[14];
      const ly = e[4] * dx + e[5] * dy + e[6] * dz;
      if (ly > 0.04 || ly < -hb) continue;
      const lx = e[0] * dx + e[1] * dy + e[2] * dz;
      if (lx > wb2 || lx < -wb2) continue;
      const lz = e[8] * dx + e[9] * dy + e[10] * dz;
      let pen = sl.m + thick[i] - sd * lz;
      if (pen <= 0) continue;
      cl.cn[k]++;
      const fx = Math.min(1, (wb2 - Math.abs(lx)) / 0.04), fy = Math.min(1, (hb + ly) / 0.04, (0.04 - ly) / 0.04);
      pen *= Math.max(0, Math.min(fx, fy));
      if (pen > 0.006) pen = 0.006;
      const px = e[8] * sd * pen, py = e[9] * sd * pen, pz = e[10] * sd * pen;
      P[o] += px; P[o + 1] += py; P[o + 2] += pz;
      // cancel the velocity component that points into the slab
      const vx = P[o] - Q[o], vy = P[o + 1] - Q[o + 1], vz = P[o + 2] - Q[o + 2];
      const vn = (vx * e[8] + vy * e[9] + vz * e[10]) * sd;
      if (vn < 0) { const kk = vn * sd; Q[o] += e[8] * kk; Q[o + 1] += e[9] * kk; Q[o + 2] += e[10] * kk; }
    }
  }
}

// ---------- render buffers ------------------------------------------------------------------------------
// Interpolates between the last two steps (alpha 0..1), moves the result into garment space through the
// rigid frame e (garment space -> world) and builds both shells with smooth normals.
export function writeRender(cl, e, alpha) {
  const { n, P, S, G, N2, T2, U2 } = cl;
  for (let k = 0; k < n; k++) {
    const o = k * 3;
    const wx = S[o] + (P[o] - S[o]) * alpha - e[12], wy = S[o + 1] + (P[o + 1] - S[o + 1]) * alpha - e[13], wz = S[o + 2] + (P[o + 2] - S[o + 2]) * alpha - e[14];
    G[o] = e[0] * wx + e[1] * wy + e[2] * wz;
    G[o + 1] = e[4] * wx + e[5] * wy + e[6] * wz;
    G[o + 2] = e[8] * wx + e[9] * wy + e[10] * wz;
  }
  frameFromG(cl);
  buildShells(cl);
}

// Orthonormal node frames (normal N2, tangent T2, up U2) from the garment-space mid-surface G.
function frameFromG(cl) {
  const { n, G, N2, T2, U2 } = cl;
  accumNormals(cl, G, N2, T2);
  for (let k = 0; k < n; k++) {
    const o = k * 3;
    const nx = N2[o], ny = N2[o + 1], nz = N2[o + 2];
    let tx = T2[o], ty = T2[o + 1], tz = T2[o + 2];
    const td = tx * nx + ty * ny + tz * nz;
    tx -= nx * td; ty -= ny * td; tz -= nz * td;
    const tl = 1 / (Math.hypot(tx, ty, tz) || 1);
    tx *= tl; ty *= tl; tz *= tl;
    T2[o] = tx; T2[o + 1] = ty; T2[o + 2] = tz;
    U2[o] = ny * tz - nz * ty; U2[o + 1] = nz * tx - nx * tz; U2[o + 2] = nx * ty - ny * tx;   // up = N x T
  }
}

// Freeze the live state into garment space (no interpolation), rebuild the shells and go to sleep.
export function sleep(cl, e) {
  writeRender(cl, e, 1);
  cl.awake = false; cl.quiet = 0;
}

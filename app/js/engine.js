'use strict';
/* Moteur de contour : calque → masque → carte de distances → marching squares → lissage.
   Unités : « proc px » = grille de calcul (px du visuel × procS) ; résultats en mm, repère du visuel. */
import { BIG, NAME_RE, canvas, bboxOf, area, fmt } from './util.js';

function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const dq = q - v[k]; d[q] = dq * dq + f[v[k]]; }
}
/** distance euclidienne (px) de chaque pixel au pixel « on » le plus proche (Felzenszwalb) */
function edt(mask, w, h, on) {
  const INF = 1e20, n = Math.max(w, h);
  const out = new Float32Array(w * h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < w * h; i++) out[i] = (mask[i] === on) ? 0 : INF;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = out[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) f[x] = out[o + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[o + x] = Math.sqrt(d[x]);
  }
  return out;
}
function fillHoles(m, w, h) {
  const seen = new Uint8Array(w * h), q = new Int32Array(w * h); let qh = 0, qt = 0;
  const push = (i) => { if (!seen[i] && !m[i]) { seen[i] = 1; q[qt++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (qh < qt) {
    const i = q[qh++], x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w);
  }
  for (let i = 0; i < w * h; i++) if (!seen[i]) m[i] = 1;
}
function removeSmall(m, w, h, minPx) {
  if (minPx <= 1) return;
  const lab = new Int32Array(w * h), q = new Int32Array(w * h); let cur = 0;
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || lab[s]) continue;
    cur++; let qh = 0, qt = 0; q[qt++] = s; lab[s] = cur;
    while (qh < qt) {
      const i = q[qh++], x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx; if (m[j] && !lab[j]) { lab[j] = cur; q[qt++] = j; }
      }
    }
    if (qt < minPx) for (let k = 0; k < qt; k++) m[q[k]] = 0;
  }
}

/** Champ signé (proc px, < 0 = intérieur de la coupe) d'un calque. Mis en cache par réglages. */
function computeField(it, ctx) {
  const { procS, pxmm } = ctx;
  const s = it.s;
  const key = JSON.stringify([procS, s.shape, s.offset, s.thr, s.closing, s.minArea, s.outerOnly, s.radius]);
  if (it.cache.key === key) return it.cache.field;
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const l of it.leaves) {
    bx0 = Math.min(bx0, l.left); by0 = Math.min(by0, l.top);
    bx1 = Math.max(bx1, l.left + l.canvas.width); by1 = Math.max(by1, l.top + l.canvas.height);
  }
  const closePx = s.shape === 'contour' ? Math.max(0, s.closing) * pxmm : 0;
  const mA = Math.ceil(closePx) + 3;
  const ax = Math.floor(bx0 * procS) - mA, ay = Math.floor(by0 * procS) - mA;
  const aw = Math.ceil(bx1 * procS) - ax + mA, ah = Math.ceil(by1 * procS) - ay + mA;
  if (aw * ah > 60e6) throw new Error('calque trop grand pour la précision choisie — passez en « Rapide »');
  const cv = canvas(aw, ah);
  const cx = cv.getContext('2d', { willReadFrequently: true });
  for (const l of it.leaves) cx.drawImage(l.canvas, l.left * procS - ax, l.top * procS - ay, l.canvas.width * procS, l.canvas.height * procS);
  const px = cx.getImageData(0, 0, aw, ah).data;
  const Mk = new Uint8Array(aw * ah); const th = s.thr / 100 * 255;
  for (let i = 0; i < aw * ah; i++) Mk[i] = px[i * 4 + 3] >= th ? 1 : 0;
  removeSmall(Mk, aw, ah, s.minArea * pxmm * pxmm);
  if (closePx > 0) { // fermeture morphologique : dilatation puis érosion
    const dOut = edt(Mk, aw, ah, 1);
    const D = new Uint8Array(aw * ah); for (let i = 0; i < D.length; i++) D[i] = dOut[i] <= closePx ? 1 : 0;
    const dIn = edt(D, aw, ah, 0);
    for (let i = 0; i < D.length; i++) Mk[i] = dIn[i] > closePx ? 1 : 0;
  }
  if (s.outerOnly || s.shape !== 'contour') fillHoles(Mk, aw, ah);
  let cx0 = Infinity, cy0 = Infinity, cx1 = -1, cy1 = -1, count = 0;
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) if (Mk[y * aw + x]) { count++; if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y; }
  if (!count) { it.cache = { key, field: null }; return null; }
  const off = s.offset * pxmm;
  const ccx = (cx0 + cx1 + 1) / 2, ccy = (cy0 + cy1 + 1) / 2;
  const hw = (cx1 + 1 - cx0) / 2, hh = (cy1 + 1 - cy0) / 2;
  let ext, fieldFn = null;
  if (s.shape === 'contour') {
    const e = Math.max(off, 0) + 3; ext = [cx0 - e, cy0 - e, cx1 + 1 + e, cy1 + 1 + e];
  } else if (s.shape === 'rect' || s.shape === 'rrect') {
    const A = hw + off, B = hh + off;
    if (A <= 1 || B <= 1) { it.cache = { key, field: null }; return null; }
    const r = s.shape === 'rrect' ? Math.min(s.radius * pxmm, A, B) : 0;
    ext = [ccx - A - 3, ccy - B - 3, ccx + A + 3, ccy + B + 3];
    fieldFn = (x, y) => { const qx = Math.abs(x - ccx) - A + r, qy = Math.abs(y - ccy) - B + r; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };
  } else { // cercle / ellipse englobants
    const ax2 = s.shape === 'circle' ? 1 : hw, ay2 = s.shape === 'circle' ? 1 : hh;
    let kmax = 0;
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
      const i = y * aw + x; if (!Mk[i]) continue;
      if (Mk[i - 1] && Mk[i + 1] && Mk[i - aw] && Mk[i + aw]) continue; // pixels de bord uniquement
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const k = Math.hypot((x + dx - ccx) / ax2, (y + dy - ccy) / ay2); if (k > kmax) kmax = k; }
    }
    const A = kmax * ax2 + off, B = kmax * ay2 + off;
    if (A <= 1 || B <= 1) { it.cache = { key, field: null }; return null; }
    ext = [ccx - A - 3, ccy - B - 3, ccx + A + 3, ccy + B + 3];
    fieldFn = (x, y) => { const u = (x - ccx) / A, v = (y - ccy) / B; return (Math.hypot(u, v) - 1) * Math.min(A, B); };
  }
  const gx0 = Math.floor(ext[0]), gy0 = Math.floor(ext[1]);
  const gw = Math.ceil(ext[2]) - gx0 + 1, gh = Math.ceil(ext[3]) - gy0 + 1;
  if (gw * gh > 60e6) throw new Error('zone trop grande pour la précision choisie — passez en « Rapide »');
  const F = new Float32Array(gw * gh);
  if (fieldFn) {
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) F[y * gw + x] = fieldFn(gx0 + x + 0.5, gy0 + y + 0.5);
  } else {
    const G2 = new Uint8Array(gw * gh);
    for (let y = 0; y < gh; y++) { const sy = gy0 + y; if (sy < 0 || sy >= ah) continue; for (let x = 0; x < gw; x++) { const sx = gx0 + x; if (sx >= 0 && sx < aw) G2[y * gw + x] = Mk[sy * aw + sx]; } }
    const dOut = edt(G2, gw, gh, 1), dIn = edt(G2, gw, gh, 0);
    for (let i = 0; i < F.length; i++) F[i] = (G2[i] ? 0.5 - dIn[i] : dOut[i] - 0.5) - off;
  }
  const field = { F, x: ax + gx0, y: ay + gy0, w: gw, h: gh };
  it.cache = { key, field };
  return field;
}

/** marching squares sur le champ, iso 0 → boucles fermées en proc px globaux */
function trace(field) {
  const { F, w, h, x: X0, y: Y0 } = field;
  const W = w + 2;
  const get = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? BIG : F[y * w + x];
  const pts = new Map(), adj = new Map(); const sa = [], sb = [];
  const H = (x, y) => ((y + 1) * W + (x + 1)) * 2, V = (x, y) => ((y + 1) * W + (x + 1)) * 2 + 1;
  const addPt = (k, px, py) => { if (!pts.has(k)) pts.set(k, [px, py]); };
  const seg = (k1, k2) => { const i = sa.length; sa.push(k1); sb.push(k2); (adj.get(k1) || adj.set(k1, []).get(k1)).push(i); (adj.get(k2) || adj.set(k2, []).get(k2)).push(i); };
  for (let y = -1; y < h; y++) for (let x = -1; x < w; x++) {
    const a = get(x, y), b = get(x + 1, y), c = get(x + 1, y + 1), d = get(x, y + 1);
    const idx = (a < 0 ? 8 : 0) | (b < 0 ? 4 : 0) | (c < 0 ? 2 : 0) | (d < 0 ? 1 : 0);
    if (idx === 0 || idx === 15) continue;
    const T = () => { const k = H(x, y); addPt(k, x + a / (a - b), y); return k; };
    const R = () => { const k = V(x + 1, y); addPt(k, x + 1, y + b / (b - c)); return k; };
    const B = () => { const k = H(x, y + 1); addPt(k, x + d / (d - c), y + 1); return k; };
    const L = () => { const k = V(x, y); addPt(k, x, y + a / (a - d)); return k; };
    switch (idx) {
      case 1: case 14: seg(L(), B()); break;
      case 2: case 13: seg(B(), R()); break;
      case 3: case 12: seg(L(), R()); break;
      case 4: case 11: seg(T(), R()); break;
      case 6: case 9: seg(T(), B()); break;
      case 7: case 8: seg(T(), L()); break;
      case 5: if ((a + b + c + d) / 4 < 0) { seg(T(), L()); seg(B(), R()); } else { seg(T(), R()); seg(L(), B()); } break;
      case 10: if ((a + b + c + d) / 4 < 0) { seg(T(), R()); seg(L(), B()); } else { seg(T(), L()); seg(B(), R()); } break;
    }
  }
  const used = new Uint8Array(sa.length), loops = [];
  for (let s = 0; s < sa.length; s++) {
    if (used[s]) continue; used[s] = 1;
    const start = sa[s]; let k = sb[s]; const loop = [pts.get(start)];
    let guard = 0;
    while (k !== start && guard++ < 5e6) {
      loop.push(pts.get(k));
      let nx = -1; for (const t of adj.get(k)) if (!used[t]) { nx = t; break; }
      if (nx < 0) break; used[nx] = 1; k = sa[nx] === k ? sb[nx] : sa[nx];
    }
    if (loop.length >= 3) loops.push(loop.map(([px, py]) => [X0 + px + 0.5, Y0 + py + 0.5]));
  }
  return loops;
}
function smoothLoop(p, n) {
  for (let k = 0; k < n; k++) {
    const len = p.length, q = new Array(len);
    for (let i = 0; i < len; i++) { const a = p[(i - 1 + len) % len], b = p[i], c = p[(i + 1) % len]; q[i] = [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4]; }
    p = q;
  }
  return p;
}
function rdp(pts, eps) {
  const n = pts.length; if (n < 3) return pts.slice();
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1; const st = [[0, n - 1]];
  while (st.length) {
    const [i, j] = st.pop(); const [x1, y1] = pts[i], [x2, y2] = pts[j];
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1e-9; let md = -1, mi = -1;
    for (let k = i + 1; k < j; k++) { const d = Math.abs(dy * pts[k][0] - dx * pts[k][1] + x2 * y1 - y2 * x1) / L; if (d > md) { md = d; mi = k; } }
    if (md > eps) { keep[mi] = 1; st.push([i, mi], [mi, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}
function simplifyClosed(p, eps) {
  if (p.length < 8) return p;
  let far = 0, fd = -1; for (let i = 1; i < p.length; i++) { const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]); if (d > fd) { fd = d; far = i; } }
  const a = rdp(p.slice(0, far + 1), eps), b = rdp(p.slice(far).concat([p[0]]), eps);
  return a.concat(b.slice(1, -1));
}
function fieldsOverlap(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (a.F[(y - a.y) * a.w + x - a.x] < 0 && b.F[(y - b.y) * b.w + x - b.x] < 0) return true;
  return false;
}

/** Fond perdu : étend les couleurs du bord du dessin jusqu'à `bleedMm` au-delà de la coupe. */
function buildBleed(art, fields, pxmm, procS, bleedMm) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of fields.values()) { x0 = Math.min(x0, f.x); y0 = Math.min(y0, f.y); x1 = Math.max(x1, f.x + f.w); y1 = Math.max(y1, f.y + f.h); }
  const w = x1 - x0, h = y1 - y0; if (w * h > 40e6) return null;
  const allow = new Uint8Array(w * h), lim = bleedMm * pxmm;
  for (const f of fields.values()) for (let y = 0; y < f.h; y++) { const o = (f.y - y0 + y) * w + (f.x - x0); for (let x = 0; x < f.w; x++) if (f.F[y * f.w + x] <= lim) allow[o + x] = 1; }
  const c = canvas(w, h);
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(art.composite, -x0, -y0, art.wPx * procS, art.hPx * procS);
  const img = cx.getImageData(0, 0, w, h), a = img.data;
  const q = new Int32Array(w * h), done = new Uint8Array(w * h); let qh = 0, qt = 0;
  for (let i = 0; i < w * h; i++) if (a[i * 4 + 3] >= 200) { done[i] = 1; q[qt++] = i; }
  while (qh < qt) {
    const i = q[qh++], x = i % w, y = (i / w) | 0;
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const j of nb) { if (j < 0 || done[j] || !allow[j]) continue; done[j] = 1; a[j * 4] = a[i * 4]; a[j * 4 + 1] = a[i * 4 + 1]; a[j * 4 + 2] = a[i * 4 + 2]; a[j * 4 + 3] = 255; q[qt++] = j; }
  }
  for (let i = 0; i < w * h; i++) if (!done[i]) a[i * 4 + 3] = 0;
  cx.putImageData(img, 0, 0);
  return { canvas: c, rect: [x0 / pxmm, y0 / pxmm, w / pxmm, h / pxmm] };
}

/**
 * Calcule les coupes d'un visuel dans son propre repère (mm, origine en haut à gauche).
 * Résultat : { cuts:[{name, loops, items, vector?}], pb (emprise = page ∪ coupes), warnings, pieces }
 */
export function computeArt(art, g) {
  const canvasPxMm = art.wPx / art.wMm;
  const procS = Math.min(1, g.prec / Math.max(art.wPx, art.hPx));
  const pxmm = canvasPxMm * procS;
  const ctx = { procS, pxmm };
  const active = art.items.filter((i) => i.s.cut && (i.leaves.length || i.vector));
  const raster = active.filter((i) => !i.vector);
  const fields = new Map();
  for (const it of raster) { const f = computeField(it, ctx); if (f) fields.set(it.id, f); }
  for (const it of art.items) it.stat = null;
  const byName = new Map();
  for (const it of raster) { if (!fields.has(it.id)) continue; (byName.get(it.s.name) || byName.set(it.s.name, []).get(it.s.name)).push(it); }
  const cuts = [], warnings = [];
  const toMm = (l) => l.map(([x, y]) => [x / pxmm, y / pxmm]);
  const eps = Math.max(0.3, 0.025 * pxmm);
  const finish = (loops, smooth) => loops.map((l) => simplifyClosed(smoothLoop(l, smooth), eps)).filter((l) => l.length >= 3).map(toMm).filter((l) => area(l) >= 0.5);
  for (const [name, its] of byName) {
    if (g.merge && its.length > 1) {
      // union des coupes de même nom = min des champs → pas de double passage de lame
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const it of its) { const f = fields.get(it.id); x0 = Math.min(x0, f.x); y0 = Math.min(y0, f.y); x1 = Math.max(x1, f.x + f.w); y1 = Math.max(y1, f.y + f.h); }
      const w = x1 - x0, h = y1 - y0;
      if (w * h > 80e6) throw new Error('visuel trop grand pour la précision choisie — passez en « Rapide »');
      const U = new Float32Array(w * h).fill(BIG);
      const owner = new Int16Array(w * h).fill(-1); const overlaps = new Set();
      its.forEach((it, idx) => {
        const f = fields.get(it.id);
        for (let y = 0; y < f.h; y++) {
          const o = (f.y - y0 + y) * w + (f.x - x0);
          for (let x = 0; x < f.w; x++) { const v = f.F[y * f.w + x]; const j = o + x; if (v < 0 && U[j] < 0 && owner[j] !== idx) overlaps.add(owner[j] + ':' + idx); if (v < U[j]) { U[j] = v; if (v < 0) owner[j] = idx; } }
        }
      });
      const smooth = Math.max(...its.map((i) => i.s.shape === 'contour' ? +i.s.smooth : 1));
      cuts.push({ name, loops: finish(trace({ F: U, x: x0, y: y0, w, h }), smooth), items: its.map((i) => i.id) });
      const pairs = [...overlaps].map((p) => p.split(':').map(Number)).filter(([a, b]) => a >= 0 && b >= 0);
      if (pairs.length) warnings.push({ t: 'info', m: `${pairs.length} chevauchement(s) fusionné(s) en une seule coupe ${name} : ${pairs.slice(0, 3).map(([a, b]) => `« ${its[a].name} » + « ${its[b].name} »`).join(', ')}${pairs.length > 3 ? '…' : ''}.` });
      for (const it of its) it.stat = { pieces: finish(trace(fields.get(it.id)), 0).length };
    } else {
      for (const it of its) {
        const loops = finish(trace(fields.get(it.id)), it.s.shape === 'contour' ? +it.s.smooth : 1);
        cuts.push({ name, loops, items: [it.id] });
        it.stat = { pieces: loops.length };
      }
      if (!g.merge && its.length > 1) {
        const ov = [];
        for (let a = 0; a < its.length; a++) for (let b = a + 1; b < its.length; b++) if (fieldsOverlap(fields.get(its[a].id), fields.get(its[b].id))) ov.push(`« ${its[a].name} » / « ${its[b].name} »`);
        if (ov.length) warnings.push({ t: 'warn', m: `Coupes qui se chevauchent : ${ov.slice(0, 3).join(', ')}. La lame passera deux fois. Activez « Fusionner les coupes qui se touchent ».` });
      }
    }
  }
  // tracés vectoriels repris tels quels (PDF/AI avec nuancier CutContour)
  const sx = art.wMm / art.wMm0, sy = art.hMm / art.hMm0;
  for (const it of active.filter((i) => i.vector)) {
    const loops = it.vector.loops.map((l) => { const o = l.map(([x, y]) => [x * sx, y * sy]); if (l.open) o.open = true; return o; });
    cuts.push({ name: it.s.name, loops, items: [it.id], vector: true });
    it.stat = { pieces: it.vector.loops.length };
  }
  const all = cuts.flatMap((c) => c.loops);
  art.bleed = g.bleed > 0 && fields.size ? buildBleed(art, fields, pxmm, procS, g.bleed) : null;
  // emprise = encre visible ∪ coupes ∪ fond perdu (sert à l'imbrication et au recadrage de l'image)
  const k = art.wMm / art.wPx, ink = art.inkBox;
  const boxes = [];
  if (ink) boxes.push([[ink[0] * k, ink[1] * k], [ink[2] * k, ink[3] * k]]);
  if (all.length) { const b = bboxOf(all); boxes.push([[b[0], b[1]], [b[2], b[3]]]); }
  if (art.bleed) { const [bx, by, bw, bh] = art.bleed.rect; boxes.push([[bx, by], [bx + bw, by + bh]]); }
  let pb = [0, 0, art.wMm, art.hMm];
  if (boxes.length) { const b = bboxOf(boxes); pb = [b[0] - 0.5, b[1] - 0.5, b[2] + 0.5, b[3] + 0.5]; }

  const tiny = all.filter((l) => !l.open).filter((l) => { const b = bboxOf([l]); return Math.min(b[2] - b[0], b[3] - b[1]) < 4; }).length;
  if (tiny) warnings.push({ t: 'warn', m: `${tiny} pièce(s) de moins de 4 mm : risque d'arrachement à l'échenillage. Augmentez « Ignorer les éléments < » ou « Rapprocher les éléments ».` });
  for (const it of raster) {
    if (!fields.has(it.id)) warnings.push({ t: 'warn', m: `« ${it.name} » : aucune forme détectée (calque vide ou seuil d'opacité trop haut).` });
    else if (it.s.shape === 'contour' && it.s.outerOnly && it.stat && it.stat.pieces > 12 && !it.s.closing) warnings.push({ t: 'info', m: `« ${it.name} » donne ${it.stat.pieces} pièces séparées. Pour un seul sticker, choisissez le mode « Un seul sticker ».` });
    if (it.s.offset < 0 && it.s.shape === 'contour') warnings.push({ t: 'info', m: `« ${it.name} » : décalage négatif, la coupe passe ${fmt(-it.s.offset)} mm à l'intérieur du dessin.` });
  }
  for (const c of cuts) if (!NAME_RE.test(c.name)) warnings.push({ t: 'err', m: `Nom « ${c.name} » non reconnu par RasterLink.` });
  const dpiEff = art.wPx / (art.wMm / 25.4);
  if (dpiEff < 120) warnings.push({ t: 'warn', m: `Résolution faible : ${Math.round(dpiEff)} dpi à la taille réelle. L'impression risque d'être floue.` });
  art.result = { cuts, pb, warnings, pieces: all.length };
  art.dirty = false;
  return art.result;
}

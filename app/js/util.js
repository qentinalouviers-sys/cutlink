'use strict';
/* Constantes machine, helpers DOM, formatage, matrices affines. */

// CJV150-75 : 800 mm d'impression/coupe, 810 mm de support maxi (fiche technique Mimaki)
export const MAX_PRINT_MM = 800;
export const MAX_MEDIA_MM = 810;
export const BIG = 1e9;
export const PRESET_NAMES = ['CutContour', 'CutContourHalf', 'CutContourFull'];
// RasterLink7 : préfixe « CutContour » + caractères ASCII alphanumériques uniquement
export const NAME_RE = /^CutContour[A-Za-z0-9]*$/;
const CUT_COLORS = { CutContour: '#ff2d92', CutContourHalf: '#0a9cff', CutContourFull: '#ff9f0a' };
const CUT_CMYK = { CutContour: [0, 1, 0, 0], CutContourHalf: [1, 0, 0, 0], CutContourFull: [0, 0.4, 1, 0] };

export const $ = (id) => document.getElementById(id);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('fr-FR');
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function colorOf(n) {
  if (CUT_COLORS[n]) return CUT_COLORS[n];
  const h = [...n].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 360;
  return `hsl(${h},85%,55%)`;
}
export const cmykOf = (n) => CUT_CMYK[n] || [0, 1, 0.3, 0];

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

/* Matrices [a,b,c,d,e,f] : x' = a·x + c·y + e ; y' = b·x + d·y + f (convention PDF/canvas). */
export const M = {
  id: () => [1, 0, 0, 1, 0, 0],
  /** A∘B : applique B puis A */
  mul: (A, B) => [
    A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5],
  ],
  apply: (A, x, y) => [A[0] * x + A[2] * y + A[4], A[1] * x + A[3] * y + A[5]],
  inv: (A) => {
    const det = A[0] * A[3] - A[1] * A[2];
    const a = A[3] / det, b = -A[1] / det, c = -A[2] / det, d = A[0] / det;
    return [a, b, c, d, -(a * A[4] + c * A[5]), -(b * A[4] + d * A[5])];
  },
};
/** transforme un tracé en conservant le drapeau « ouvert » */
export function xform(loop, A) {
  const out = loop.map(([x, y]) => M.apply(A, x, y));
  if (loop.open) out.open = true;
  return out;
}

export function bboxOf(loops) {
  const a = [Infinity, Infinity, -Infinity, -Infinity];
  for (const l of loops) for (const [x, y] of l) {
    if (x < a[0]) a[0] = x; if (y < a[1]) a[1] = y; if (x > a[2]) a[2] = x; if (y > a[3]) a[3] = y;
  }
  return a;
}
export const area = (p) => { let s = 0; for (let i = 0, n = p.length; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s / 2); };
export const perim = (p) => {
  let s = 0; const n = p.length, last = p.open ? n - 1 : n;
  for (let i = 0; i < last; i++) { const a = p[i], b = p[(i + 1) % n]; s += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return s;
};
export function pointInPoly(x, y, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

let toastTimer = null;
export function toast(msg, kind = '') {
  const el = $('toast');
  el.textContent = msg; el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast ' + kind; }, kind === 'err' ? 6000 : 3200);
}

export const store = {
  get(k, def) { try { const v = localStorage.getItem('cutlink.' + k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem('cutlink.' + k, JSON.stringify(v)); } catch { /* navigation privée */ } },
};

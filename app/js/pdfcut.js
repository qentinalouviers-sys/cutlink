'use strict';
/* Lecture des tracés CutContour d'un PDF / AI (Illustrator, CorelDRAW, Affinity, CutLink…).
   On interprète les flux de contenu (pages + formulaires XObject) : chemins, CTM, espaces
   colorimétriques Separation/DeviceN. Chaque tracé peint dans une couleur d'accompagnement
   « CutContour… » est récupéré, puis son opérateur de peinture est neutralisé dans le PDF
   pour que le rendu de l'impression ne contienne pas la ligne de coupe. */
import { M } from './util.js';

const { PDFName, PDFDict, PDFArray, PDFRawStream, PDFStream, PDFRef, decodePDFRawStream } = window.Lib.PDFLib;

const isWs = (c) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isDelim = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
const decodeName = (s) => s.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

/** Découpe un flux de contenu en jetons {k: 'n'|'name'|'op'|'x', v, s, e} (s/e = positions) */
function lex(b) {
  const out = []; const n = b.length; let i = 0;
  while (i < n) {
    const c = b[i];
    if (isWs(c)) { i++; continue; }
    if (c === 37) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; } // commentaire
    const s = i;
    if (c === 47) { // nom
      i++; while (i < n && !isWs(b[i]) && !isDelim(b[i])) i++;
      out.push({ k: 'name', v: decodeName(String.fromCharCode(...b.subarray(s + 1, i))), s, e: i }); continue;
    }
    if (c === 40) { // chaîne littérale (parenthèses imbriquées, échappements)
      let depth = 0;
      for (; i < n; i++) {
        if (b[i] === 92) { i++; continue; }
        if (b[i] === 40) depth++;
        else if (b[i] === 41 && --depth === 0) { i++; break; }
      }
      out.push({ k: 'x', s, e: i }); continue;
    }
    if (c === 60) {
      if (b[i + 1] === 60) { out.push({ k: 'x', v: '<<', s, e: i + 2 }); i += 2; continue; }
      while (i < n && b[i] !== 62) i++; i++;
      out.push({ k: 'x', s, e: i }); continue;
    }
    if (c === 62) { i += b[i + 1] === 62 ? 2 : 1; out.push({ k: 'x', v: '>>', s, e: i }); continue; }
    if (c === 91 || c === 93 || c === 123 || c === 125) { i++; out.push({ k: 'x', v: String.fromCharCode(c), s, e: i }); continue; }
    while (i < n && !isWs(b[i]) && !isDelim(b[i])) i++;
    if (i === s) { i++; continue; }
    const word = String.fromCharCode(...b.subarray(s, i));
    const num = Number(word);
    if (word !== '' && !Number.isNaN(num) && /^[+\-.\d]/.test(word)) { out.push({ k: 'n', v: num, s, e: i }); continue; }
    out.push({ k: 'op', v: word, s, e: i });
    if (word === 'ID') { // image en ligne : sauter les données binaires jusqu'à « EI »
      i++;
      while (i < n - 1 && !(b[i] === 69 && b[i + 1] === 73 && isWs(b[i - 1]) && (i + 2 >= n || isWs(b[i + 2]) || isDelim(b[i + 2])))) i++;
      i += 2; out.push({ k: 'op', v: 'EI', s: i - 2, e: i });
    }
  }
  return out;
}

function streamBytes(obj) {
  if (obj instanceof PDFRawStream) return decodePDFRawStream(obj).decode();
  if (obj && typeof obj.getUnencodedContents === 'function') return obj.getUnencodedContents();
  return new Uint8Array(0);
}
function concatBytes(parts) {
  const len = parts.reduce((s, p) => s + p.length + 1, 0); const out = new Uint8Array(len); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; out[o++] = 10; }
  return out;
}

/** Nom de la couleur d'accompagnement CutContour… d'un espace colorimétrique, ou null */
function cutNameOf(ctxPdf, resources, csName) {
  if (/^Device|^Pattern$/.test(csName)) return null;
  const dict = resources && resources.lookupMaybe(PDFName.of('ColorSpace'), PDFDict);
  if (!dict) return null;
  const cs = dict.lookupMaybe(PDFName.of(csName), PDFArray);
  if (!cs || cs.size() < 2) return null;
  const fam = ctxPdf.lookup(cs.get(0));
  const famName = fam && fam.asString ? decodeName(fam.asString().slice(1)) : '';
  const names = [];
  if (famName === 'Separation') { const nm = ctxPdf.lookup(cs.get(1)); if (nm && nm.asString) names.push(decodeName(nm.asString().slice(1))); }
  else if (famName === 'DeviceN') { const arr = ctxPdf.lookup(cs.get(1)); if (arr instanceof PDFArray) for (let i = 0; i < arr.size(); i++) { const nm = arr.lookup(i); if (nm && nm.asString) names.push(decodeName(nm.asString().slice(1))); } }
  return names.find((n) => /^CutContour/i.test(n)) || null;
}

/** aplatit une courbe de Bézier cubique (coordonnées déjà transformées, en pt) */
function bezier(out, p0, p1, p2, p3) {
  const ddx = Math.max(Math.abs(p0[0] - 2 * p1[0] + p2[0]), Math.abs(p1[0] - 2 * p2[0] + p3[0]));
  const ddy = Math.max(Math.abs(p0[1] - 2 * p1[1] + p2[1]), Math.abs(p1[1] - 2 * p2[1] + p3[1]));
  const n = Math.min(200, Math.max(1, Math.ceil(Math.sqrt(Math.hypot(ddx, ddy) * 0.75 / 0.05))));
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
}

const STROKE_REWRITE = { S: 'n', s: 'n', B: 'f', 'B*': 'f*', b: 'h f', 'b*': 'h f*' };
const PAINT = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n']);

/**
 * Interprète un flux. Retourne les modifications à appliquer au flux (pour retirer les coupes)
 * et empile les tracés trouvés dans `found` (coordonnées espace utilisateur de la page, en pt).
 */
function run(env, bytes, resources, ctm0, depth, onEdits) {
  const toks = lex(bytes);
  const edits = [];
  let gs = { ctm: ctm0.slice(), sCut: null, fCut: null };
  const stack = [];
  let ops = [];
  let path = [], sub = null, cp = [0, 0], start = [0, 0];
  const T = (x, y) => M.apply(gs.ctm, x, y);
  const moveTo = (x, y) => { sub = { pts: [T(x, y)], closed: false }; path.push(sub); cp = [x, y]; start = [x, y]; };
  const lineTo = (x, y) => { if (!sub) moveTo(x, y); else { sub.pts.push(T(x, y)); cp = [x, y]; } };
  const curve = (x1, y1, x2, y2, x3, y3) => {
    if (!sub) moveTo(cp[0], cp[1]);
    bezier(sub.pts, T(cp[0], cp[1]), T(x1, y1), T(x2, y2), T(x3, y3)); cp = [x3, y3];
  };
  const close = () => { if (sub) { sub.closed = true; cp = start.slice(); } };
  for (const t of toks) {
    if (t.k !== 'op') { ops.push(t); continue; }
    const op = t.v; const N = (i) => { const o = ops[ops.length - i]; return o && o.k === 'n' ? o.v : 0; };
    switch (op) {
      case 'q': stack.push({ ...gs, ctm: gs.ctm.slice() }); break;
      case 'Q': if (stack.length) gs = stack.pop(); break;
      case 'cm': gs.ctm = M.mul(gs.ctm, [N(6), N(5), N(4), N(3), N(2), N(1)]); break;
      case 'm': moveTo(N(2), N(1)); break;
      case 'l': lineTo(N(2), N(1)); break;
      case 'c': curve(N(6), N(5), N(4), N(3), N(2), N(1)); break;
      case 'v': curve(cp[0], cp[1], N(4), N(3), N(2), N(1)); break;
      case 'y': curve(N(4), N(3), N(2), N(1), N(2), N(1)); break;
      case 'h': close(); break;
      case 're': { const x = N(4), y = N(3), w = N(2), h = N(1); moveTo(x, y); lineTo(x + w, y); lineTo(x + w, y + h); lineTo(x, y + h); close(); break; }
      case 'CS': { const nm = ops[ops.length - 1]; gs.sCut = nm && nm.k === 'name' ? cutNameOf(env.ctx, resources, nm.v) : null; break; }
      case 'cs': { const nm = ops[ops.length - 1]; gs.fCut = nm && nm.k === 'name' ? cutNameOf(env.ctx, resources, nm.v) : null; break; }
      case 'G': case 'RG': case 'K': gs.sCut = null; break;
      case 'g': case 'rg': case 'k': gs.fCut = null; break;
      case 'Do': {
        const nm = ops[ops.length - 1];
        if (nm && nm.k === 'name' && depth < 12) runForm(env, resources, nm.v, gs.ctm, depth);
        break;
      }
      default:
        if (PAINT.has(op)) {
          const strokes = op !== 'n' && op[0] !== 'f' && op !== 'F';
          const fills = op !== 'n' && op !== 'S' && op !== 's';
          const closing = op === 's' || op === 'b' || op === 'b*';
          if (strokes && gs.sCut) {
            for (const p of path) {
              if (p.pts.length < 2) continue;
              const loop = p.pts.slice(); if (!(p.closed || closing)) loop.open = true;
              env.found.push({ name: gs.sCut, loop });
            }
          }
          let rep = null;
          if (strokes && gs.sCut) rep = (fills && gs.fCut) ? 'n' : STROKE_REWRITE[op];
          else if (fills && gs.fCut) { rep = strokes ? ({ B: 'S', 'B*': 'S', b: 's', 'b*': 's' })[op] : 'n'; env.fillCuts++; }
          if (rep && rep !== op) edits.push({ s: t.s, e: t.e, v: rep });
          path = []; sub = null;
        }
    }
    ops = [];
  }
  if (edits.length) onEdits(applyEdits(bytes, edits));
}

function applyEdits(bytes, edits) {
  const parts = []; let last = 0; const enc = new TextEncoder();
  for (const ed of edits) { parts.push(bytes.subarray(last, ed.s), enc.encode(ed.v)); last = ed.e; }
  parts.push(bytes.subarray(last));
  const len = parts.reduce((s, p) => s + p.length, 0); const out = new Uint8Array(len); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function runForm(env, resources, name, ctm, depth) {
  const xo = resources && resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
  if (!xo) return;
  const ref = xo.get(PDFName.of(name));
  const obj = ref instanceof PDFRef ? env.ctx.lookup(ref) : ref;
  if (!(obj instanceof PDFStream)) return;
  const st = obj.dict.lookupMaybe(PDFName.of('Subtype'), PDFName);
  if (!st || st.asString() !== '/Form') return;
  const mtx = obj.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray);
  const m = mtx ? [0, 1, 2, 3, 4, 5].map((i) => mtx.lookup(i).asNumber()) : [1, 0, 0, 1, 0, 0];
  const res = obj.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) || resources;
  const key = ref instanceof PDFRef ? ref.toString() : null;
  let bytes;
  try { bytes = (key && env.formBytes.get(key)) || streamBytes(obj); } catch { env.unreadable++; return; }
  if (key) env.formBytes.set(key, bytes);
  const rewrite = !key || !env.rewritten.has(key);
  run(env, bytes, res, M.mul(ctm, m), depth + 1, (nb) => {
    if (!rewrite || !key) return;
    env.rewritten.add(key);
    const d = obj.dict.clone(env.ctx);
    d.delete(PDFName.of('Filter')); d.delete(PDFName.of('DecodeParms')); d.delete(PDFName.of('Length'));
    env.ctx.assign(ref, env.ctx.flateStream(nb, Object.fromEntries(d.entries().map(([k, v]) => [k.asString().slice(1), v]))));
  });
}

/**
 * Extrait les coupes de chaque page et les retire du document (modifié en place).
 * Retour : [{ wMm, hMm, cuts: Map(name → loops en mm, repère haut-gauche), fillCuts, unreadable }]
 */
export function extractCuts(pdfDoc, maxPages = 12) {
  const ctx = pdfDoc.context; const pages = pdfDoc.getPages().slice(0, maxPages);
  const formBytes = new Map(), rewritten = new Set();
  return pages.map((page) => {
    const env = { ctx, found: [], formBytes, rewritten, fillCuts: 0, unreadable: 0 };
    const mb = page.getMediaBox(), cb0 = page.getCropBox();
    const x0 = Math.max(mb.x, cb0.x), y0 = Math.max(mb.y, cb0.y);
    const x1 = Math.min(mb.x + mb.width, cb0.x + cb0.width), y1 = Math.min(mb.y + mb.height, cb0.y + cb0.height);
    const K = 25.4 / 72, W = (x1 - x0) * K, H = (y1 - y0) * K;
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const contents = page.node.Contents();
    let bytes = new Uint8Array(0);
    try {
      const list = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r)) : contents ? [contents] : [];
      bytes = concatBytes(list.map(streamBytes));
    } catch { env.unreadable++; }
    run(env, bytes, page.node.Resources(), M.id(), 0, (nb) => {
      page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(nb)));
    });
    const map = (x, y) => {
      const X = (x - x0) * K, Y = (y1 - y) * K;
      if (rot === 90) return [H - Y, X];
      if (rot === 180) return [W - X, H - Y];
      if (rot === 270) return [Y, W - X];
      return [X, Y];
    };
    const cuts = new Map();
    for (const { name, loop } of env.found) {
      const l = loop.map(([x, y]) => map(x, y));
      // supprime les points en double consécutifs (fréquent après « h »)
      const clean = l.filter((p, i) => i === 0 || Math.hypot(p[0] - l[i - 1][0], p[1] - l[i - 1][1]) > 1e-4);
      if (!loop.open && clean.length > 2 && Math.hypot(clean[0][0] - clean.at(-1)[0], clean[0][1] - clean.at(-1)[1]) < 1e-4) clean.pop();
      if (clean.length < 2) continue;
      if (loop.open) clean.open = true;
      (cuts.get(name) || cuts.set(name, []).get(name)).push(clean);
    }
    const sw = rot === 90 || rot === 270;
    return { wMm: sw ? H : W, hMm: sw ? W : H, cuts, fillCuts: env.fillCuts, unreadable: env.unreadable };
  });
}

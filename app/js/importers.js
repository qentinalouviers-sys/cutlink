'use strict';
/* Import des visuels : PSD/PSB (calques, groupes, masques), PDF / AI (rendu pdf.js + tracés CutContour
   récupérés), SVG, PNG/JPG/WebP/GIF/BMP (détourage auto d'un fond uni). Chaque fichier → un ou
   plusieurs « visuels » (art) composés de calques de découpe (items). */
import { canvas } from './util.js';
import { extractCuts } from './pdfcut.js';

const { readPsd, PDFLib } = window.Lib;
const RENDER_DPI = 300;
const MAX_RENDER_PX = 60e6;

let ART_ID = 0, ITEM_ID = 0;
const defaults = () => ({ cut: true, shape: 'contour', offset: 2, thr: 50, smooth: 2, outerOnly: true, closing: 0, minArea: 2, radius: 3, name: 'CutContour' });
/** Lettrage : chaque lettre (et ses trous : O, A, R…) découpée séparément, marge fine */
export const LETTERING = { shape: 'contour', offset: 0.5, closing: 0, outerOnly: false, smooth: 0, minArea: 0.3 };
export const STICKER = { shape: 'contour', offset: 2, closing: 2, outerOnly: true, smooth: 2, minArea: 2 };

function newArt(o) {
  const art = { id: ++ART_ID, items: [], dirty: true, result: null, bleed: null, ...o };
  art.wMm0 = art.wMm; art.hMm0 = art.hMm;
  const k = Math.min(1, 2400 / Math.max(art.wPx, art.hPx));
  art.preview = canvas(art.wPx * k, art.hPx * k);
  art.preview.getContext('2d').drawImage(art.composite, 0, 0, art.preview.width, art.preview.height);
  art.thumb = thumbOf(art, [{ canvas: art.composite, left: 0, top: 0 }], 88);
  if (!art.inkBox) art.inkBox = alphaBox(art.composite);
  return art;
}
/** boîte (px) des pixels visibles, calculée sur une version réduite (marge d'un pixel réduit) */
function alphaBox(c) {
  const k = Math.min(1, 1200 / Math.max(c.width, c.height));
  const t = canvas(c.width * k, c.height * k), x = t.getContext('2d', { willReadFrequently: true });
  x.drawImage(c, 0, 0, t.width, t.height);
  const a = x.getImageData(0, 0, t.width, t.height).data;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < t.height; y++) for (let i = 0; i < t.width; i++) if (a[(y * t.width + i) * 4 + 3] > 8) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  return [Math.max(0, (x0 - 1) / k), Math.max(0, (y0 - 1) / k), Math.min(c.width, (x1 + 2) / k), Math.min(c.height, (y1 + 2) / k)];
}
function thumbOf(art, leaves, S = 76) {
  const c = canvas(S, S), x = c.getContext('2d');
  const k = Math.min(S / art.wPx, S / art.hPx);
  const ox = (S - art.wPx * k) / 2, oy = (S - art.hPx * k) / 2;
  for (const l of leaves) x.drawImage(l.canvas, ox + l.left * k, oy + l.top * k, l.canvas.width * k, l.canvas.height * k);
  return c;
}
function newItem(art, o) {
  const it = { id: ++ITEM_ID, artId: art.id, tags: [], cache: {}, leaves: [], s: defaults(), ...o };
  it.thumb = it.vector ? vectorThumb(art, it.vector.loops) : thumbOf(art, it.leaves);
  return it;
}
function vectorThumb(art, loops) {
  const S = 76, c = canvas(S, S), x = c.getContext('2d');
  const k = Math.min(S / art.wMm, S / art.hMm), ox = (S - art.wMm * k) / 2, oy = (S - art.hMm * k) / 2;
  x.strokeStyle = '#ff2d92'; x.lineWidth = 1.2;
  for (const l of loops) { x.beginPath(); l.forEach(([a, b], i) => (i ? x.lineTo : x.moveTo).call(x, ox + a * k, oy + b * k)); if (!l.open) x.closePath(); x.stroke(); }
  return c;
}

export async function importFile(file) {
  const buf = await file.arrayBuffer();
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const head = new Uint8Array(buf, 0, Math.min(1024, buf.byteLength));
  const isPdf = String.fromCharCode(...head).includes('%PDF');
  if (ext === 'psd' || ext === 'psb') return [loadPsd(buf, file.name)];
  if (ext === 'pdf' || ext === 'ai' || isPdf) {
    if (!isPdf) throw new Error(ext === 'ai'
      ? 'ce fichier .ai n\'a pas de contenu PDF. Dans Illustrator : Fichier › Enregistrer sous… › cochez « Créer un fichier compatible PDF », ou enregistrez une copie en PDF.'
      : 'PDF illisible.');
    return loadPdf(buf, file.name);
  }
  if (ext === 'eps' || ext === 'ps') throw new Error('les fichiers EPS ne sont pas lus. Dans Illustrator : Fichier › Enregistrer une copie… › Adobe PDF (les nuances CutContour sont conservées).');
  if (ext === 'svg' || file.type === 'image/svg+xml') return [await loadSvg(buf, file.name)];
  if (ext === 'tif' || ext === 'tiff') throw new Error('le TIFF n\'est pas lu par les navigateurs. Exportez en PSD, PNG ou PDF.');
  return [await loadImage(buf, file.name, file.type)];
}

/* ───────── PSD ───────── */
function loadPsd(buf, name) {
  const psd = readPsd(buf, { skipThumbnail: true, useImageData: false });
  let dpi = 300;
  const ri = psd.imageResources && psd.imageResources.resolutionInfo;
  if (ri && ri.horizontalResolution) {
    dpi = ri.horizontalResolution;
    if (/cm/i.test(ri.horizontalResolutionUnit || '')) dpi *= 2.54;
  }
  const base = { name, source: 'PSD', wPx: psd.width, hPx: psd.height, nativeDpi: dpi, wMm: psd.width / dpi * 25.4, hMm: psd.height / dpi * 25.4 };
  let composite = psd.canvas || null;
  if (!composite || isBlank(composite)) composite = composeOwn(psd, base);
  const art = newArt({ ...base, composite, psd });
  for (const node of (psd.children || []).slice().reverse()) { const it = psdItem(art, node); if (it) art.items.push(it); }
  return art;
}
function isBlank(c) { // composite absent ou vide (PSD enregistré sans « compatibilité maximale »)
  const k = Math.min(1, 160 / Math.max(c.width, c.height));
  const t = canvas(c.width * k, c.height * k), x = t.getContext('2d'); x.drawImage(c, 0, 0, t.width, t.height);
  const a = x.getImageData(0, 0, t.width, t.height).data;
  for (let i = 4; i < a.length; i += 4) if (a[i] !== a[0] || a[i + 1] !== a[1] || a[i + 2] !== a[2] || a[i + 3] !== a[3]) return false;
  return true;
}
function collectLeaves(node, out, parentHidden) {
  const hidden = parentHidden || !!node.hidden;
  if (node.children) { for (const c of node.children) collectLeaves(c, out, hidden); return; }
  if (!node.canvas || node.clipping || hidden) return; // calques écrêtés : ne changent pas la forme
  out.push({ canvas: shapeCanvas(node), left: node.left || 0, top: node.top || 0 });
}
function shapeCanvas(node) { // applique le masque de fusion du calque
  const m = node.mask;
  if (!m || m.disabled || !m.canvas) return node.canvas;
  const w = node.canvas.width, h = node.canvas.height;
  const mc = canvas(w, h), mx = mc.getContext('2d');
  const def = m.defaultColor || 0;
  mx.fillStyle = `rgb(${def},${def},${def})`; mx.fillRect(0, 0, w, h);
  mx.drawImage(m.canvas, (m.left || 0) - (node.left || 0), (m.top || 0) - (node.top || 0));
  const md = mx.getImageData(0, 0, w, h);
  for (let i = 0; i < md.data.length; i += 4) md.data[i + 3] = md.data[i];
  mx.putImageData(md, 0, 0);
  const c = canvas(w, h), cx = c.getContext('2d'); cx.drawImage(node.canvas, 0, 0);
  cx.globalCompositeOperation = 'destination-in'; cx.drawImage(mc, 0, 0);
  return c;
}
function composeOwn(psd, d) {
  const c = canvas(d.wPx, d.hPx), x = c.getContext('2d');
  const walk = (n, alpha) => {
    if (n.hidden) return;
    const a = alpha * (n.opacity == null ? 1 : n.opacity);
    if (n.children) { for (const k of n.children) walk(k, a); return; }
    if (!n.canvas) return;
    x.globalAlpha = a; x.drawImage(shapeCanvas(n), n.left || 0, n.top || 0);
  };
  for (const n of psd.children || []) walk(n, 1);
  x.globalAlpha = 1;
  return c;
}
export function psdItem(art, node) {
  const leaves = []; collectLeaves(node, leaves, false);
  const isGroup = !!node.children, isText = !!node.text;
  const it = newItem(art, { name: node.name || 'Calque', node, leaves, kind: isGroup ? 'groupe' : isText ? 'texte' : 'calque' });
  if (isText) { it.s.closing = 1.5; it.tags.push('texte'); }
  if (isGroup) it.tags.push('groupe');
  if (!leaves.length) { it.s.cut = false; it.tags.push(node.hidden ? 'masqué' : 'vide'); }
  else if (coverage(art, leaves) > 0.97) { it.s.cut = false; it.tags.push('fond'); }
  if (/^(arri[eè]re-plan|background|fond)/i.test(it.name)) { it.s.cut = false; if (!it.tags.includes('fond')) it.tags.push('fond'); }
  return it;
}
function coverage(art, leaves) {
  const k = Math.min(1, 200 / Math.max(art.wPx, art.hPx));
  const c = canvas(art.wPx * k, art.hPx * k), x = c.getContext('2d');
  for (const l of leaves) x.drawImage(l.canvas, l.left * k, l.top * k, l.canvas.width * k, l.canvas.height * k);
  const a = x.getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 3; i < a.length; i += 4) if (a[i] > 200) n++;
  return n / (c.width * c.height);
}

/* ───────── Images bitmap ───────── */
async function loadImage(buf, name, type) {
  const bmp = await createImageBitmap(new Blob([buf], { type: type || 'image/png' }));
  const c = canvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0);
  const dpi = readDpi(new Uint8Array(buf)) || 300;
  return rasterArt({ name, source: (name.split('.').pop() || 'IMG').toUpperCase(), composite: c, nativeDpi: dpi, wMm: c.width / dpi * 25.4, hMm: c.height / dpi * 25.4 });
}
/** Visuel à un calque ; fond uni opaque → détourage automatique par la couleur des coins */
function rasterArt(o, extraItems = [], cutDefault = true) {
  const c = o.composite;
  const art = newArt({ ...o, wPx: c.width, hPx: c.height });
  const img = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
  let shape = c, keyed = false;
  if (isOpaque(img)) { const bg = cornerColor(img); if (bg) { shape = keyCanvas(img, bg, 40); keyed = true; } }
  const it = newItem(art, { name: extraItems.length ? 'Visuel (contour auto)' : o.name.replace(/\.[^.]+$/, ''), leaves: [{ canvas: shape, left: 0, top: 0 }], kind: 'image' });
  if (keyed) { it.tags.push('fond détouré'); art.inkBox = alphaBox(shape); }
  // texte / lettrage détecté (beaucoup d'éléments séparés) → une coupe par lettre, au ras
  if (countBlobs(shape) >= 4) { it.tags.push('lettrage'); Object.assign(it.s, LETTERING); }
  it.s.cut = cutDefault;
  art.items = [...extraItems.map((f) => f(art)), it];
  return art;
}
function isOpaque(img) {
  // ignore 3 px de bord : un PDF dont la taille ne tombe pas sur un pixel entier
  // (Canva : 283,5 pt) a une dernière ligne semi-transparente
  const { width: w, height: h, data: a } = img, m = 3;
  if (w <= 2 * m || h <= 2 * m) return false;
  let n = 0;
  for (let y = m; y < h - m; y += 7) for (let x = m; x < w - m; x += 7) { if (a[(y * w + x) * 4 + 3] < 250) return false; n++; }
  return n > 0;
}
function cornerColor(img) {
  const { width: w, height: h, data: a } = img, m = Math.min(3, (w >> 2), (h >> 2));
  const pts = [[m, m], [w - 1 - m, m], [m, h - 1 - m], [w - 1 - m, h - 1 - m], [w >> 1, m], [m, h >> 1], [w >> 1, h - 1 - m], [w - 1 - m, h >> 1]];
  const cols = pts.map(([x, y]) => { const i = (y * w + x) * 4; return [a[i], a[i + 1], a[i + 2]]; });
  // couleur majoritaire des bords (tolère un élément qui touche un bord)
  let best = null, bestN = 0;
  for (const r of cols) {
    const n = cols.filter((c) => Math.abs(c[0] - r[0]) + Math.abs(c[1] - r[1]) + Math.abs(c[2] - r[2]) <= 45).length;
    if (n > bestN) { bestN = n; best = r; }
  }
  return bestN >= 6 ? best : null;
}
/** Nombre d'éléments séparés (lettres…) sur une version réduite du masque */
function countBlobs(c) {
  const k = Math.min(1, 900 / Math.max(c.width, c.height));
  const w = Math.max(1, Math.round(c.width * k)), h = Math.max(1, Math.round(c.height * k));
  const t = canvas(w, h), x = t.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0, w, h);
  const a = x.getImageData(0, 0, w, h).data, seen = new Uint8Array(w * h), q = new Int32Array(w * h);
  let n = 0;
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || a[s * 4 + 3] < 128) continue;
    let qh = 0, qt = 0, size = 0; q[qt++] = s; seen[s] = 1;
    while (qh < qt) {
      const i = q[qh++], px = i % w, py = (i / w) | 0; size++;
      for (const j of [px > 0 ? i - 1 : -1, px < w - 1 ? i + 1 : -1, py > 0 ? i - w : -1, py < h - 1 ? i + w : -1]) {
        if (j >= 0 && !seen[j] && a[j * 4 + 3] >= 128) { seen[j] = 1; q[qt++] = j; }
      }
    }
    if (size >= 4) n++;
  }
  return n;
}
function keyCanvas(img, bg, tol) {
  const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height); const a = out.data;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a[i] - bg[0]) + Math.abs(a[i + 1] - bg[1]) + Math.abs(a[i + 2] - bg[2]);
    a[i + 3] = d <= tol ? 0 : d >= tol * 2 ? 255 : Math.round((d - tol) / tol * 255);
  }
  const c = canvas(img.width, img.height); c.getContext('2d').putImageData(out, 0, 0); return c;
}
function readDpi(b) {
  try {
    if (b[0] === 0x89 && b[1] === 0x50) { // PNG pHYs
      let p = 8;
      while (p < b.length - 12) {
        const len = (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0;
        const t = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
        if (t === 'pHYs') { const ppm = (b[p + 8] << 24 | b[p + 9] << 16 | b[p + 10] << 8 | b[p + 11]) >>> 0; return b[p + 16] === 1 && ppm > 0 ? ppm * 0.0254 : 0; }
        if (t === 'IDAT') return 0;
        p += 12 + len;
      }
    } else if (b[0] === 0xFF && b[1] === 0xD8 && b[6] === 0x4A && b[7] === 0x46) { // JFIF
      const u = b[13], xd = b[14] << 8 | b[15];
      if (u === 1 && xd > 1) return xd; if (u === 2 && xd > 1) return xd * 2.54;
    }
  } catch { /* en-tête inattendu */ }
  return 0;
}

/* ───────── SVG ───────── */
const UNIT_MM = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };
function lenMm(v) {
  const m = /^\s*([\d.]+)\s*(mm|cm|in|pt|pc|px)?\s*$/.exec(v || '');
  return m ? +m[1] * UNIT_MM[m[2] || ''] : 0;
}
async function loadSvg(buf, name) {
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(buf), 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName !== 'svg') throw new Error('SVG invalide');
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  let wMm = lenMm(svg.getAttribute('width')), hMm = lenMm(svg.getAttribute('height'));
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    if (!wMm && !hMm) { wMm = vb[2] * UNIT_MM.px; hMm = vb[3] * UNIT_MM.px; }
    else if (!wMm) wMm = hMm * vb[2] / vb[3];
    else if (!hMm) hMm = wMm * vb[3] / vb[2];
  } else {
    if (!wMm || !hMm) throw new Error('SVG sans dimensions (ni width/height ni viewBox)');
    svg.setAttribute('viewBox', `0 0 ${wMm / UNIT_MM.px} ${hMm / UNIT_MM.px}`);
  }
  const dpi = Math.min(RENDER_DPI, Math.sqrt(MAX_RENDER_PX / (wMm * hMm / 645.16)));
  const wPx = Math.round(wMm / 25.4 * dpi), hPx = Math.round(hMm / 25.4 * dpi);
  svg.setAttribute('width', wPx); svg.setAttribute('height', hPx);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
  try {
    const img = new Image(); img.src = url; await img.decode();
    const c = canvas(wPx, hPx); c.getContext('2d').drawImage(img, 0, 0, wPx, hPx);
    return rasterArt({ name, source: 'SVG', composite: c, nativeDpi: dpi, wMm, hMm });
  } finally { URL.revokeObjectURL(url); }
}

/* ───────── PDF / AI ───────── */
let pdfjsP = null;
function pdfjs() {
  if (!pdfjsP) pdfjsP = import('../vendor/pdf.min.mjs').then((m) => { m.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href; return m; });
  return pdfjsP;
}
async function loadPdf(buf, name) {
  const src = await PDFLib.PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  if (src.isEncrypted) throw new Error('PDF protégé par mot de passe.');
  const info = extractCuts(src); // retire aussi les tracés de coupe du rendu
  const stripped = await src.save({ useObjectStreams: false });
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: stripped, isEvalSupported: false, disableFontFace: false }).promise;
  const arts = [];
  const base = name.replace(/\.[^.]+$/, '');
  for (let p = 0; p < info.length; p++) {
    const { wMm, hMm, cuts, fillCuts } = info[p];
    const page = await doc.getPage(p + 1);
    const dpi = Math.min(RENDER_DPI, Math.sqrt(MAX_RENDER_PX / (wMm * hMm / 645.16)));
    const vp = page.getViewport({ scale: dpi / 72 });
    const c = canvas(Math.ceil(vp.width), Math.ceil(vp.height));
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp, background: 'rgba(0,0,0,0)' }).promise;
    const vectors = [...cuts].map(([cutName, loops]) => (art) => {
      const it = newItem(art, { name: `Tracé ${cutName}`, kind: 'vecteur', vector: { loops, src: cutName } });
      it.tags.push('du fichier'); it.s.name = /^CutContour[A-Za-z0-9]*$/.test(cutName) ? cutName : 'CutContour';
      return it;
    });
    const art = rasterArt({ name: info.length > 1 ? `${base} — page ${p + 1}` : name, source: /\.ai$/i.test(name) ? 'AI' : 'PDF', composite: c, nativeDpi: dpi, wMm, hMm }, vectors, !vectors.length);
    art.fillCuts = fillCuts;
    art.pdfNote = vectors.length ? `${[...cuts.values()].reduce((s, l) => s + l.length, 0)} tracé(s) CutContour repris du fichier` : '';
    arts.push(art);
    page.cleanup();
  }
  await doc.destroy();
  if (src.getPageCount() > info.length) arts[0].pdfNote = (arts[0].pdfNote ? arts[0].pdfNote + ' · ' : '') + `seules les ${info.length} premières pages sont importées`;
  return arts;
}

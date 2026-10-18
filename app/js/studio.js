'use strict';
/* CutLink Studio — éditeur de stickers « façon Canva » : texte, images, formes, couleurs.
   Le résultat est rendu en PNG transparent haute définition et envoyé sur la planche comme un visuel. */
import { $, esc, clamp, toast, store, canvas } from './util.js';

const PX_MM = 300 / 25.4;   // résolution de rendu : 300 dpi
const MAX_EXPORT_PX = 7000; // côté maxi du rendu

/* ───────── Palette & modèles ───────── */
const PALETTE = ['#111111', '#ffffff', '#ff2d55', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#0a84ff', '#5856d6', '#af52de',
  '#ff6b9d', '#8e5a3c', '#0f5460', '#f4ecd9', '#c62828', '#1b5e20'];
const SHAPES = {
  rect: { label: 'Carré', path: (w, h, r) => roundRect(w, h, 0) },
  rrect: { label: 'Arrondi', path: (w, h) => roundRect(w, h, Math.min(w, h) * 0.18) },
  circle: { label: 'Rond', path: (w, h) => { const p = new Path2D(); p.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); return p; } },
  star: { label: 'Étoile', path: (w, h) => star(w, h, 5, 0.45) },
  burst: { label: 'Badge', path: (w, h) => star(w, h, 16, 0.82) },
  heart: { label: 'Cœur', path: (w, h) => heart(w, h) },
  bubble: { label: 'Bulle', path: (w, h) => bubble(w, h) },
  ribbon: { label: 'Bandeau', path: (w, h) => ribbon(w, h) },
};
function roundRect(w, h, r) { const p = new Path2D(); p.roundRect(0, 0, w, h, r); return p; }
function star(w, h, n, k) {
  const p = new Path2D();
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? k : 1;
    const x = w / 2 + Math.cos(a) * w / 2 * r, y = h / 2 + Math.sin(a) * h / 2 * r;
    i ? p.lineTo(x, y) : p.moveTo(x, y);
  }
  p.closePath(); return p;
}
function heart(w, h) {
  const p = new Path2D();
  p.moveTo(w / 2, h * 0.95);
  p.bezierCurveTo(w * -0.05, h * 0.6, w * 0.05, h * 0.02, w / 2, h * 0.25);
  p.bezierCurveTo(w * 0.95, h * 0.02, w * 1.05, h * 0.6, w / 2, h * 0.95);
  p.closePath(); return p;
}
function bubble(w, h) {
  const p = new Path2D(), bh = h * 0.8, r = Math.min(w, bh) * 0.22;
  p.roundRect(0, 0, w, bh, r);
  p.moveTo(w * 0.22, bh - 1); p.lineTo(w * 0.16, h); p.lineTo(w * 0.40, bh - 1); p.closePath();
  return p;
}
function ribbon(w, h) {
  const p = new Path2D(), n = h * 0.5;
  p.moveTo(0, 0); p.lineTo(w, 0); p.lineTo(w - n, h / 2); p.lineTo(w, h); p.lineTo(0, h); p.lineTo(n, h / 2); p.closePath();
  return p;
}

/** Modèles prêts à l'emploi (mm). Les textes sont modifiables, les couleurs aussi. */
const TEMPLATES = [
  { name: 'Ouvert', w: 120, h: 60, els: [
    { type: 'shape', shape: 'rrect', x: 0, y: 0, w: 120, h: 60, fill: '#34c759' },
    { type: 'text', text: 'OUVERT', font: 'Luckiest Guy', weight: 400, size: 26, fill: '#ffffff', x: 60, y: 30, align: 'center', stroke: '#1b5e20', strokeW: 1 }] },
  { name: 'Promo', w: 90, h: 90, els: [
    { type: 'shape', shape: 'burst', x: 0, y: 0, w: 90, h: 90, fill: '#ff2d55' },
    { type: 'text', text: '-20%', font: 'Anton', weight: 400, size: 26, fill: '#ffffff', x: 45, y: 42, align: 'center' },
    { type: 'text', text: 'PROMO', font: 'Bebas Neue', weight: 400, size: 11, fill: '#ffcc00', x: 45, y: 62, align: 'center', spacing: 2 }] },
  { name: 'Merci', w: 80, h: 80, els: [
    { type: 'shape', shape: 'circle', x: 0, y: 0, w: 80, h: 80, fill: '#0f5460' },
    { type: 'text', text: 'Merci !', font: 'Pacifico', weight: 400, size: 15, fill: '#f4ecd9', x: 40, y: 37, align: 'center' },
    { type: 'text', text: 'À BIENTÔT', font: 'Montserrat', weight: 800, size: 6, fill: '#f4ecd9', x: 40, y: 54, align: 'center', spacing: 1.5 }] },
  { name: 'Nouveau', w: 110, h: 40, els: [
    { type: 'shape', shape: 'ribbon', x: 0, y: 0, w: 110, h: 40, fill: '#ffcc00' },
    { type: 'text', text: 'NOUVEAU', font: 'Archivo Black', weight: 400, size: 15, fill: '#111111', x: 55, y: 20, align: 'center' }] },
  { name: 'Bulle', w: 100, h: 70, els: [
    { type: 'shape', shape: 'bubble', x: 0, y: 0, w: 100, h: 70, fill: '#ffffff', stroke: '#111111', strokeW: 1.6 },
    { type: 'text', text: 'Coucou !', font: 'Fredoka', weight: 700, size: 15, fill: '#111111', x: 50, y: 27, align: 'center' }] },
  { name: 'Logo rond', w: 80, h: 80, els: [
    { type: 'shape', shape: 'circle', x: 0, y: 0, w: 80, h: 80, fill: '#111111' },
    { type: 'shape', shape: 'circle', x: 5, y: 5, w: 70, h: 70, fill: '#111111', stroke: '#ffffff', strokeW: 0.8 },
    { type: 'text', text: 'VOTRE', font: 'Bebas Neue', weight: 400, size: 10, fill: '#ffffff', x: 40, y: 27, align: 'center', spacing: 3 },
    { type: 'text', text: 'MARQUE', font: 'Bebas Neue', weight: 400, size: 17, fill: '#ffcc00', x: 40, y: 42, align: 'center', spacing: 1 },
    { type: 'text', text: 'depuis 2026', font: 'Caveat', weight: 700, size: 8, fill: '#ffffff', x: 40, y: 57, align: 'center' }] },
  { name: 'Lettrage', w: 200, h: 40, els: [
    { type: 'text', text: 'Votre texte', font: 'Playfair Display', weight: 800, size: 22, fill: '#0f5460', x: 100, y: 20, align: 'center' }] },
  { name: 'Vierge', w: 80, h: 80, els: [] },
];
const SIZES = [[50, 50], [80, 80], [100, 100], [100, 50], [150, 100], [200, 60], [297, 210]];

/* ───────── État ───────── */
const D = {
  open: false, w: 80, h: 80, els: [], sel: null, onDone: null,
  view: { k: 4, ox: 0, oy: 0 }, fonts: [], undo: [], redo: [], drag: null, imgs: new Map(),
  bgModel: null, recents: store.get('studio.colors', []),
};
let ELID = 0;
const el = () => D.els.find((e) => e.id === D.sel) || null;

/* ───────── Ouverture ───────── */
export async function openStudio(onDone) {
  D.onDone = onDone;
  if (!D.fonts.length) D.fonts = await fetch('fonts/fonts.json').then((r) => r.json()).catch(() => []);
  build();
  $('studio').classList.remove('hidden'); D.open = true;
  if (!D.els.length) showTemplates(); else { fitView(); render(); }
}
function close() { $('studio').classList.add('hidden'); D.open = false; }

function snapshot() { D.undo.push(JSON.stringify({ w: D.w, h: D.h, els: D.els })); if (D.undo.length > 60) D.undo.shift(); D.redo = []; }
function restore(s) { const o = JSON.parse(s); D.w = o.w; D.h = o.h; D.els = o.els; D.sel = null; fitView(); render(); panel(); }
function undo() { if (!D.undo.length) return; D.redo.push(JSON.stringify({ w: D.w, h: D.h, els: D.els })); restore(D.undo.pop()); }
function redoFn() { if (!D.redo.length) return; D.undo.push(JSON.stringify({ w: D.w, h: D.h, els: D.els })); restore(D.redo.pop()); }

/* ───────── Construction de l'interface (une seule fois) ───────── */
let built = false;
function build() {
  if (built) return; built = true;
  const root = $('studio');
  root.innerHTML = `
  <div class="st-top">
    <button class="btn" id="stClose">✕ Fermer</button>
    <div class="st-title"><b>Studio</b><span>Créez un sticker en quelques clics</span></div>
    <div class="st-top-r">
      <button class="tb-btn" id="stUndo" title="Annuler (⌘Z)">↶</button>
      <button class="tb-btn" id="stRedo" title="Rétablir (⇧⌘Z)">↷</button>
      <button class="btn-primary" id="stDone">Ajouter à la planche ✓</button>
    </div>
  </div>
  <div class="st-body">
    <nav class="st-rail">
      <button data-p="tpl" class="on"><span>▦</span>Modèles</button>
      <button data-p="text"><span>T</span>Texte</button>
      <button data-p="img"><span>🖼</span>Images</button>
      <button data-p="shape"><span>◆</span>Formes</button>
      <button data-p="size"><span>⤢</span>Taille</button>
    </nav>
    <aside class="st-drawer" id="stDrawer"></aside>
    <main class="st-stage" id="stStage">
      <div class="st-ctx" id="stCtx"></div>
      <canvas id="stCanvas"></canvas>
      <div class="st-hint" id="stHint">Cliquez sur un élément pour le modifier · glissez pour déplacer · poignées pour redimensionner</div>
      <input type="file" id="stFile" accept="image/*" multiple hidden>
    </main>
  </div>`;
  $('stClose').onclick = close;
  $('stUndo').onclick = undo; $('stRedo').onclick = redoFn;
  $('stDone').onclick = finish;
  root.querySelectorAll('.st-rail button').forEach((b) => b.onclick = () => { root.querySelectorAll('.st-rail button').forEach((x) => x.classList.toggle('on', x === b)); drawer(b.dataset.p); });
  $('stFile').onchange = (e) => { addImages(e.target.files); e.target.value = ''; };
  bindCanvas();
  drawer('tpl');
  new ResizeObserver(() => { if (D.open) { fitView(); render(); } }).observe($('stStage'));
  document.addEventListener('keydown', onKey, true);
  // police chargée → re-rendu
  document.fonts.addEventListener('loadingdone', () => D.open && render());
}

/* ───────── Tiroir de gauche ───────── */
function drawer(p) {
  const d = $('stDrawer');
  if (p === 'tpl') {
    d.innerHTML = `<h3>Modèles</h3><p class="st-sub">Un point de départ, tout est modifiable.</p><div class="st-tpls">${TEMPLATES.map((t, i) => `<button data-t="${i}"><canvas width="160" height="110"></canvas><span>${t.name}</span></button>`).join('')}</div>`;
    d.querySelectorAll('[data-t]').forEach((b) => { const t = TEMPLATES[+b.dataset.t]; previewTpl(b.querySelector('canvas'), t); b.onclick = () => applyTpl(t); });
  } else if (p === 'text') {
    d.innerHTML = `<h3>Texte</h3>
      <button class="st-addtxt big" data-k="title">Ajouter un titre</button>
      <button class="st-addtxt mid" data-k="sub">Ajouter un sous-titre</button>
      <button class="st-addtxt small" data-k="body">Ajouter un petit texte</button>
      <h4>Styles de texte</h4>
      <div class="st-combos">${COMBOS.map((c, i) => `<button data-c="${i}" style="font-family:'${c.font}';font-weight:${c.weight};color:${c.fill};${c.stroke ? `-webkit-text-stroke:1px ${c.stroke};` : ''}">${esc(c.sample)}</button>`).join('')}</div>`;
    d.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => addText(b.dataset.k));
    d.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => addText('combo', COMBOS[+b.dataset.c]));
  } else if (p === 'img') {
    d.innerHTML = `<h3>Images</h3>
      <button class="btn-primary wide" id="stUp">Importer une image…</button>
      <p class="st-sub">PNG transparent, JPG, WebP. Vous pouvez aussi glisser-déposer dans le studio.</p>
      <div class="st-ai"><b>✨ Détourage IA</b><p>Sélectionnez une photo puis cliquez « Retirer le fond ». Le modèle (ormbg, 44 Mo) se télécharge une seule fois, puis tout se fait dans votre navigateur.</p></div>
      <div class="st-imgs" id="stImgs"></div>`;
    $('stUp').onclick = () => $('stFile').click();
    renderImgLib();
  } else if (p === 'shape') {
    d.innerHTML = `<h3>Formes</h3><p class="st-sub">Pour un fond de sticker ou une décoration.</p><div class="st-shapes">${Object.entries(SHAPES).map(([k, s]) => `<button data-s="${k}" title="${s.label}"><canvas width="64" height="64"></canvas><span>${s.label}</span></button>`).join('')}</div>`;
    d.querySelectorAll('[data-s]').forEach((b) => {
      const c = b.querySelector('canvas'), x = c.getContext('2d'); x.translate(8, 8); x.fillStyle = '#0a84ff'; x.fill(SHAPES[b.dataset.s].path(48, 48));
      b.onclick = () => addShape(b.dataset.s);
    });
  } else if (p === 'size') {
    d.innerHTML = `<h3>Taille du sticker</h3>
      <div class="st-row"><label>Largeur</label><input type="number" id="stW" min="10" max="780" value="${D.w}"><em>mm</em></div>
      <div class="st-row"><label>Hauteur</label><input type="number" id="stH" min="10" max="2000" value="${D.h}"><em>mm</em></div>
      <h4>Formats rapides</h4><div class="st-sizes">${SIZES.map(([w, h]) => `<button data-w="${w}" data-h="${h}">${w} × ${h}</button>`).join('')}</div>
      <label class="st-chk"><input type="checkbox" id="stScale" checked> Adapter le contenu à la nouvelle taille</label>
      <p class="st-sub">La découpe et la planche sont gérées ensuite par CutLink. La CJV150-75 imprime jusqu'à 800 mm de large.</p>`;
    const apply = (w, h) => { resize(w, h, $('stScale').checked); $('stW').value = D.w; $('stH').value = D.h; };
    $('stW').onchange = () => apply(clamp(+$('stW').value || D.w, 10, 780), D.h);
    $('stH').onchange = () => apply(D.w, clamp(+$('stH').value || D.h, 10, 2000));
    d.querySelectorAll('[data-w]').forEach((b) => b.onclick = () => apply(+b.dataset.w, +b.dataset.h));
  }
}
const COMBOS = [
  { sample: 'SUPER', font: 'Luckiest Guy', weight: 400, fill: '#ffcc00', stroke: '#111111', strokeW: 1, size: 18 },
  { sample: 'Élégant', font: 'Playfair Display', weight: 800, fill: '#111111', size: 16 },
  { sample: 'Bonjour', font: 'Pacifico', weight: 400, fill: '#ff2d55', size: 16 },
  { sample: 'IMPACT', font: 'Anton', weight: 400, fill: '#0a84ff', size: 18 },
  { sample: 'Marker', font: 'Permanent Marker', weight: 400, fill: '#111111', size: 14 },
  { sample: 'fun !', font: 'Fredoka', weight: 700, fill: '#af52de', size: 16 },
  { sample: 'RÉTRO', font: 'Bungee', weight: 400, fill: '#ff9500', stroke: '#111111', strokeW: 0.6, size: 14 },
  { sample: 'Signature', font: 'Dancing Script', weight: 700, fill: '#0f5460', size: 16 },
];

/* ───────── Ajouts ───────── */
function center() { return [D.w / 2, D.h / 2]; }
function push(e) { snapshot(); e.id = ++ELID; D.els.push(e); D.sel = e.id; render(); panel(); return e; }
function addText(kind, combo) {
  const [cx, cy] = center();
  const base = { type: 'text', x: cx, y: cy, align: 'center', fill: '#111111', weight: 700, font: 'Poppins', spacing: 0, curve: 0, stroke: '', strokeW: 0, rot: 0 };
  const sz = Math.max(4, Math.min(D.w, D.h) * 0.22);
  if (kind === 'title') push({ ...base, text: 'Votre titre', size: sz, font: 'Poppins', weight: 700 });
  else if (kind === 'sub') push({ ...base, text: 'Sous-titre', size: sz * 0.6, weight: 400 });
  else if (kind === 'body') push({ ...base, text: 'Un petit texte', size: sz * 0.4, weight: 400, font: 'Inter' });
  else push({ ...base, text: combo.sample, font: combo.font, weight: combo.weight, fill: combo.fill, stroke: combo.stroke || '', strokeW: combo.strokeW || 0, size: sz });
  ensureFont(el().font, el().weight);
}
function addShape(k) {
  const s = Math.min(D.w, D.h) * 0.6;
  push({ type: 'shape', shape: k, x: (D.w - s) / 2, y: (D.h - s) / 2, w: s, h: s, fill: '#0a84ff', stroke: '', strokeW: 0, rot: 0 });
}
async function addImages(files) {
  for (const f of files) {
    if (!/^image\//.test(f.type)) { toast(`« ${f.name} » n'est pas une image.`, 'err'); continue; }
    const bmp = await createImageBitmap(f);
    const c = canvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0);
    const key = 'i' + (++ELID);
    D.imgs.set(key, { canvas: c, name: f.name, url: c.toDataURL('image/png') });
    placeImage(key);
  }
  renderImgLib();
}
function placeImage(key) {
  const im = D.imgs.get(key), r = im.canvas.width / im.canvas.height;
  let w = D.w * 0.7, h = w / r; if (h > D.h * 0.7) { h = D.h * 0.7; w = h * r; }
  push({ type: 'image', key, x: (D.w - w) / 2, y: (D.h - h) / 2, w, h, rot: 0, outline: 0, outlineColor: '#ffffff', flip: false });
}
function renderImgLib() {
  const box = $('stImgs'); if (!box) return;
  box.innerHTML = [...D.imgs.entries()].map(([k, im]) => `<button data-k="${k}" title="${esc(im.name)}"><img src="${im.url}" alt=""></button>`).join('') || '<p class="st-sub">Aucune image importée.</p>';
  box.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => placeImage(b.dataset.k));
}

/* ───────── Modèles ───────── */
function applyTpl(t) {
  if (D.els.length && !confirm('Remplacer le sticker en cours par ce modèle ?')) return;
  snapshot();
  D.w = t.w; D.h = t.h;
  D.els = t.els.map((e) => ({ rot: 0, stroke: '', strokeW: 0, spacing: 0, curve: 0, ...JSON.parse(JSON.stringify(e)), id: ++ELID }));
  D.els.filter((e) => e.type === 'text').forEach((e) => ensureFont(e.font, e.weight));
  D.sel = null; fitView(); render(); panel();
  $('stHint').textContent = 'Double-cliquez sur un texte pour le modifier';
}
function previewTpl(c, t) {
  const x = c.getContext('2d'), k = Math.min((c.width - 16) / t.w, (c.height - 16) / t.h);
  const run = () => {
    x.clearRect(0, 0, c.width, c.height);
    x.save(); x.translate((c.width - t.w * k) / 2, (c.height - t.h * k) / 2); x.scale(k, k);
    if (!t.els.length) { x.strokeStyle = '#bbb'; x.setLineDash([3 / k, 3 / k]); x.lineWidth = 1 / k; x.strokeRect(0, 0, t.w, t.h); }
    for (const e of t.els) drawEl(x, { rot: 0, spacing: 0, curve: 0, ...e });
    x.restore();
  };
  t.els.filter((e) => e.type === 'text').forEach((e) => ensureFont(e.font, e.weight).then(run));
  run();
}
function resize(w, h, scaleContent) {
  snapshot();
  if (scaleContent && D.els.length) {
    const k = Math.min(w / D.w, h / D.h), dx = (w - D.w * k) / 2, dy = (h - D.h * k) / 2;
    for (const e of D.els) {
      e.x = e.x * k + dx; e.y = e.y * k + dy;
      if (e.type === 'text') { e.size *= k; e.strokeW *= k; } else { e.w *= k; e.h *= k; if (e.strokeW) e.strokeW *= k; if (e.outline) e.outline *= k; }
    }
  }
  D.w = w; D.h = h; fitView(); render();
}
function showTemplates() { fitView(); render(); panel(); }

/* ───────── Polices ───────── */
const loaded = new Set();
function ensureFont(f, w) {
  const k = `${w} ${f}`; if (loaded.has(k)) return Promise.resolve();
  return document.fonts.load(`${w} 40px '${f}'`, 'AÉàz€0').then(() => { loaded.add(k); if (D.open) render(); });
}
function nearestWeight(fam, w) {
  const f = D.fonts.find((x) => x.family === fam); if (!f) return w;
  return f.weights.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a), f.weights[0]);
}

/* ───────── Rendu d'un élément (unités mm) ───────── */
function textMetrics(x, e) {
  x.font = `${e.weight} ${e.size}px '${e.font}'`;
  const lines = String(e.text).split('\n');
  const lh = e.size * 1.15;
  const widths = lines.map((l) => measure(x, l, e));
  const w = Math.max(1, ...widths), h = lh * lines.length;
  return { lines, lh, widths, w, h };
}
function measure(x, s, e) { const base = x.measureText(s).width; return base + Math.max(0, s.length - 1) * (e.spacing || 0); }
/** boîte locale (avant rotation) : [x0,y0,w,h] en mm */
function boxOf(e) {
  if (e.type !== 'text') return [e.x, e.y, e.w, e.h];
  const m = textMetrics(mctx, e);
  if (e.curve) {
    // le texte courbé est dessiné sur une seule ligne, le long d'un arc de rayon R
    const W = measure(mctx, m.lines.join(' '), e), R = curveR(e, W), half = W / 2 / R;
    const chord = R * Math.sin(half), sag = R * (1 - Math.cos(half)), pad = m.lh / 2;
    const y0 = e.curve > 0 ? e.y - pad : e.y - sag - pad;
    return [e.x - chord - pad, y0, 2 * (chord + pad), sag + 2 * pad];
  }
  const x0 = e.align === 'left' ? e.x : e.align === 'right' ? e.x - m.w : e.x - m.w / 2;
  return [x0, e.y - m.h / 2, m.w, m.h];
}
const mctx = canvas(4, 4).getContext('2d');
const curveR = (e, w) => Math.max(w * 0.55, w * 3 / Math.max(0.05, Math.abs(e.curve) / 100 * 3));
function drawEl(x, e) {
  x.save();
  const b = boxOf(e), cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
  if (e.rot) { x.translate(cx, cy); x.rotate(e.rot * Math.PI / 180); x.translate(-cx, -cy); }
  if (e.type === 'shape') {
    x.translate(e.x, e.y);
    const p = SHAPES[e.shape].path(e.w, e.h);
    x.fillStyle = e.fill; x.fill(p);
    if (e.stroke && e.strokeW) { x.strokeStyle = e.stroke; x.lineWidth = e.strokeW; x.lineJoin = 'round'; x.stroke(p); }
  } else if (e.type === 'image') {
    const im = D.imgs.get(e.key); if (im) {
      const src = e.outline > 0 ? outlined(im, e) : im.canvas;
      const pad = e.outline > 0 ? e.outline : 0;
      x.translate(e.x + (e.flip ? e.w : 0), e.y); if (e.flip) x.scale(-1, 1);
      x.drawImage(src, -pad, -pad, e.w + 2 * pad, e.h + 2 * pad);
    }
  } else {
    const m = textMetrics(x, e);
    x.textBaseline = 'middle'; x.lineJoin = 'round';
    if (e.curve) drawCurved(x, e, m);
    else m.lines.forEach((l, i) => {
      const y = e.y - m.h / 2 + m.lh * (i + 0.5);
      const w = m.widths[i], x0 = e.align === 'left' ? e.x : e.align === 'right' ? e.x - w : e.x - w / 2;
      drawSpaced(x, l, x0, y, e);
    });
  }
  x.restore();
}
function drawSpaced(x, s, x0, y, e) {
  const paint = (ch, px) => { if (e.stroke && e.strokeW) { x.strokeStyle = e.stroke; x.lineWidth = e.strokeW * 2; x.strokeText(ch, px, y); } x.fillStyle = e.fill; x.fillText(ch, px, y); };
  x.textAlign = 'left';
  if (!e.spacing) { paint(s, x0); return; }
  let px = x0; for (const ch of s) { paint(ch, px); px += x.measureText(ch).width + e.spacing; }
}
function drawCurved(x, e, m) {
  const s = m.lines.join(' '), w = measure(x, s, e), R = curveR(e, w), dir = e.curve > 0 ? 1 : -1;
  const cy = e.y + dir * R; let a = -w / 2 / R;
  x.textAlign = 'center';
  for (const ch of s) {
    const cw = x.measureText(ch).width, mid = a + cw / 2 / R;
    x.save(); x.translate(e.x + Math.sin(mid) * R, cy - dir * Math.cos(mid) * R); x.rotate(mid * dir);
    if (e.stroke && e.strokeW) { x.strokeStyle = e.stroke; x.lineWidth = e.strokeW * 2; x.strokeText(ch, 0, 0); }
    x.fillStyle = e.fill; x.fillText(ch, 0, 0); x.restore();
    a += (cw + (e.spacing || 0)) / R;
  }
}
/** contour coloré autour d'une image détourée (effet « sticker ») — mis en cache par épaisseur */
function outlined(im, e) {
  const key = `${e.outline.toFixed(2)}|${e.outlineColor}|${e.w.toFixed(1)}`;
  if (im.ol && im.ol.key === key) return im.ol.c;
  const src = im.canvas, k = src.width / e.w, r = Math.max(1, Math.round(e.outline * k));
  // silhouette nette (alpha ≥ 50 %) : évite que des pixels presque transparents ressortent en blanc
  const sil = canvas(src.width, src.height), sx = sil.getContext('2d', { willReadFrequently: true });
  sx.drawImage(src, 0, 0);
  const id = sx.getImageData(0, 0, sil.width, sil.height), d = id.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 128 ? 255 : 0;
  sx.putImageData(id, 0, 0);
  const c = canvas(src.width + 2 * r, src.height + 2 * r), x = c.getContext('2d');
  const steps = Math.max(16, Math.round(r * 1.5));
  for (let i = 0; i < steps; i++) { const a = i / steps * Math.PI * 2; x.drawImage(sil, r + Math.cos(a) * r, r + Math.sin(a) * r); }
  for (let rr = r - 1; rr > 0; rr -= Math.max(1, r / 4)) for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; x.drawImage(sil, r + Math.cos(a) * rr, r + Math.sin(a) * rr); }
  x.globalCompositeOperation = 'source-in'; x.fillStyle = e.outlineColor; x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'source-over'; x.drawImage(src, r, r);
  im.ol = { key, c };
  return c;
}

/* ───────── Vue ───────── */
function fitView() {
  const st = $('stStage'); if (!st) return;
  const W = st.clientWidth, H = st.clientHeight - 60;
  const k = Math.min((W - 80) / D.w, (H - 80) / D.h);
  D.view = { k, ox: (W - D.w * k) / 2, oy: 60 + (H - D.h * k) / 2 };
}
function render() {
  const c = $('stCanvas'); if (!c) return;
  const st = $('stStage'), dpr = window.devicePixelRatio || 1, W = st.clientWidth, H = st.clientHeight;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
  const { k, ox, oy } = D.view;
  // support : damier = transparent (la découpe suivra le contour du dessin)
  x.save(); x.shadowColor = 'rgba(0,0,0,.18)'; x.shadowBlur = 24; x.shadowOffsetY = 4; x.fillStyle = '#fff'; x.fillRect(ox, oy, D.w * k, D.h * k); x.restore();
  x.save(); x.beginPath(); x.rect(ox, oy, D.w * k, D.h * k); x.clip();
  const cs = 10; for (let yy = 0; yy < D.h * k; yy += cs) for (let xx = 0; xx < D.w * k; xx += cs) if (((xx + yy) / cs) % 2 === 0) { x.fillStyle = '#f0f0f3'; x.fillRect(ox + xx, oy + yy, cs, cs); }
  x.translate(ox, oy); x.scale(k, k);
  for (const e of D.els) drawEl(x, e);
  x.restore();
  // repères de centre pendant le glisser
  if (D.drag && D.drag.snap) {
    x.strokeStyle = '#ff2d92'; x.lineWidth = 1; x.setLineDash([4, 3]);
    if (D.drag.snap.x) { x.beginPath(); x.moveTo(ox + D.w * k / 2, oy); x.lineTo(ox + D.w * k / 2, oy + D.h * k); x.stroke(); }
    if (D.drag.snap.y) { x.beginPath(); x.moveTo(ox, oy + D.h * k / 2); x.lineTo(ox + D.w * k, oy + D.h * k / 2); x.stroke(); }
    x.setLineDash([]);
  }
  // sélection
  const e = el();
  if (e) {
    const b = boxOf(e), cx = ox + (b[0] + b[2] / 2) * k, cy = oy + (b[1] + b[3] / 2) * k;
    x.save(); x.translate(cx, cy); x.rotate((e.rot || 0) * Math.PI / 180);
    const hw = b[2] * k / 2, hh = b[3] * k / 2;
    x.strokeStyle = '#8b3dff'; x.lineWidth = 1.5; x.strokeRect(-hw, -hh, hw * 2, hh * 2);
    x.fillStyle = '#fff';
    for (const [hx, hy] of handles(hw, hh, e)) { x.beginPath(); x.arc(hx, hy, 6, 0, Math.PI * 2); x.fill(); x.stroke(); }
    x.beginPath(); x.moveTo(0, -hh); x.lineTo(0, -hh - 22); x.stroke();
    x.beginPath(); x.arc(0, -hh - 28, 7, 0, Math.PI * 2); x.fill(); x.stroke();
    x.fillStyle = '#8b3dff'; x.font = '11px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('↻', 0, -hh - 28);
    x.restore();
  }
  // cotes
  x.fillStyle = '#86868b'; x.font = '12px -apple-system,system-ui'; x.textAlign = 'center';
  x.fillText(`${Math.round(D.w)} × ${Math.round(D.h)} mm`, ox + D.w * k / 2, oy + D.h * k + 22);
  ctxBar();
}
const handles = (hw, hh, e) => (e.type === 'text' ? [[hw, hh], [-hw, hh], [hw, -hh], [-hw, -hh]] : [[hw, hh], [-hw, hh], [hw, -hh], [-hw, -hh], [hw, 0], [-hw, 0], [0, hh], [0, -hh]]);

/* ───────── Interaction ───────── */
function toDoc(ev) { const r = $('stCanvas').getBoundingClientRect(); return [(ev.clientX - r.left - D.view.ox) / D.view.k, (ev.clientY - r.top - D.view.oy) / D.view.k]; }
function local(e, mx, my) { const b = boxOf(e), cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2, a = -(e.rot || 0) * Math.PI / 180; const dx = mx - cx, dy = my - cy; return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)]; }
function hitEl(mx, my) {
  for (let i = D.els.length - 1; i >= 0; i--) { const e = D.els[i], [lx, ly] = local(e, mx, my), b = boxOf(e); if (lx >= b[0] && lx <= b[0] + b[2] && ly >= b[1] && ly <= b[1] + b[3]) return e; }
  return null;
}
function hitHandle(e, ev) {
  const r = $('stCanvas').getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
  const b = boxOf(e), k = D.view.k, cx = D.view.ox + (b[0] + b[2] / 2) * k, cy = D.view.oy + (b[1] + b[3] / 2) * k;
  const a = -(e.rot || 0) * Math.PI / 180, dx = px - cx, dy = py - cy, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
  const hw = b[2] * k / 2, hh = b[3] * k / 2;
  if (Math.hypot(lx, ly + hh + 28) < 11) return { kind: 'rot', cx, cy };
  for (const [hx, hy] of handles(hw, hh, e)) if (Math.hypot(lx - hx, ly - hy) < 10) return { kind: 'size', hx: Math.sign(hx), hy: Math.sign(hy) };
  return null;
}
function bindCanvas() {
  const c = $('stCanvas'), st = $('stStage');
  c.addEventListener('pointerdown', (ev) => {
    c.setPointerCapture(ev.pointerId);
    const [mx, my] = toDoc(ev), cur = el();
    const h = cur && hitHandle(cur, ev);
    if (h) { snapshot(); D.drag = { mode: h.kind, h, e: cur, start: JSON.parse(JSON.stringify(cur)), mx, my, ev0: [ev.clientX, ev.clientY] }; return; }
    const e = hitEl(mx, my);
    D.sel = e ? e.id : null; panel(); render();
    if (e) { snapshot(); D.drag = { mode: 'move', e, start: JSON.parse(JSON.stringify(e)), mx, my, moved: false }; }
  });
  c.addEventListener('pointermove', (ev) => {
    const d = D.drag; if (!d) { const [mx, my] = toDoc(ev); const cur = el(); c.style.cursor = cur && hitHandle(cur, ev) ? 'nwse-resize' : hitEl(mx, my) ? 'move' : 'default'; return; }
    const [mx, my] = toDoc(ev), e = d.e, s = d.start;
    if (d.mode === 'move') {
      let nx = s.x + mx - d.mx, ny = s.y + my - d.my;
      const b0 = boxOf(s), offX = b0[0] + b0[2] / 2 - s.x, offY = b0[1] + b0[3] / 2 - s.y;
      const tol = 6 / D.view.k; d.snap = {};
      if (Math.abs(nx + offX - D.w / 2) < tol) { nx = D.w / 2 - offX; d.snap.x = 1; }
      if (Math.abs(ny + offY - D.h / 2) < tol) { ny = D.h / 2 - offY; d.snap.y = 1; }
      e.x = nx; e.y = ny; d.moved = true;
    } else if (d.mode === 'rot') {
      const r = c.getBoundingClientRect(); let a = Math.atan2(ev.clientY - r.top - d.h.cy, ev.clientX - r.left - d.h.cx) * 180 / Math.PI + 90;
      if (!ev.shiftKey) for (const t of [0, 90, 180, 270, 360, -90]) if (Math.abs(a - t) < 5) a = t;
      e.rot = Math.round(a);
    } else if (d.mode === 'size') {
      const b0 = boxOf(s), a = (s.rot || 0) * Math.PI / 180;
      const dx = mx - d.mx, dy = my - d.my, lx = dx * Math.cos(-a) - dy * Math.sin(-a), ly = dx * Math.sin(-a) + dy * Math.cos(-a);
      if (e.type === 'text') {
        const f = Math.max(0.1, 1 + (d.h.hx * lx / b0[2] + d.h.hy * ly / b0[3]));
        e.size = Math.max(1, s.size * f); e.strokeW = s.strokeW * f; e.spacing = s.spacing * f;
      } else {
        let w = s.w + d.h.hx * lx, h = s.h + d.h.hy * ly;
        const corner = d.h.hx && d.h.hy;
        if (corner && (e.type === 'image' || !ev.shiftKey)) { const f = Math.max(w / s.w, h / s.h); w = s.w * f; h = s.h * f; }
        w = Math.max(2, w); h = Math.max(2, h);
        e.w = w; e.h = h;
        e.x = d.h.hx < 0 ? s.x + s.w - w : d.h.hx > 0 ? s.x : s.x + (s.w - w) / 2;
        e.y = d.h.hy < 0 ? s.y + s.h - h : d.h.hy > 0 ? s.y : s.y + (s.h - h) / 2;
      }
    }
    render();
  });
  c.addEventListener('pointerup', () => { if (D.drag && D.drag.mode === 'move' && !D.drag.moved) D.undo.pop(); D.drag = null; render(); panel(); });
  c.addEventListener('dblclick', (ev) => { const [mx, my] = toDoc(ev); const e = hitEl(mx, my); if (e && e.type === 'text') editText(e); });
  st.addEventListener('dragover', (ev) => ev.preventDefault());
  st.addEventListener('drop', (ev) => { ev.preventDefault(); ev.stopPropagation(); if (ev.dataTransfer.files.length) addImages(ev.dataTransfer.files); });
}
function editText(e) {
  const t = $('stTextArea'); if (t) { t.focus(); t.select(); }
}
function onKey(ev) {
  if (!D.open) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
  const mod = ev.metaKey || ev.ctrlKey, k = ev.key.toLowerCase();
  if (k === 'escape') { if (D.sel) { D.sel = null; render(); panel(); } ev.stopPropagation(); return; }
  if (typing) { ev.stopPropagation(); return; }
  if (mod && k === 'z') { ev.preventDefault(); ev.shiftKey ? redoFn() : undo(); }
  else if (mod && k === 'd') { ev.preventDefault(); dup(); }
  else if ((k === 'delete' || k === 'backspace') && el()) { ev.preventDefault(); del(); }
  else if (k.startsWith('arrow') && el()) {
    ev.preventDefault(); const s = ev.shiftKey ? 5 : 0.5, e = el();
    if (k === 'arrowleft') e.x -= s; if (k === 'arrowright') e.x += s; if (k === 'arrowup') e.y -= s; if (k === 'arrowdown') e.y += s; render();
  }
  ev.stopPropagation();
}
function dup() { const e = el(); if (!e) return; const c = JSON.parse(JSON.stringify(e)); c.x += 3; c.y += 3; push(c); }
function del() { const e = el(); if (!e) return; snapshot(); D.els = D.els.filter((x) => x !== e); D.sel = null; render(); panel(); }
function order(dir) { const e = el(); if (!e) return; snapshot(); const i = D.els.indexOf(e); D.els.splice(i, 1); D.els.splice(dir > 0 ? D.els.length : 0, 0, e); render(); }
function align(where) {
  const e = el(); if (!e) return; snapshot(); const b = boxOf(e);
  if (where === 'h') e.x += D.w / 2 - (b[0] + b[2] / 2);
  if (where === 'v') e.y += D.h / 2 - (b[1] + b[3] / 2);
  render();
}

/* ───────── Barre contextuelle (au-dessus du sticker) ───────── */
function ctxBar() {
  const bar = $('stCtx'), e = el();
  if (!e) { bar.innerHTML = `<span class="st-ctx-empty">Sélectionnez un élément, ou ajoutez du texte, une image ou une forme à gauche.</span>`; bar.dataset.for = ''; return; }
  if (bar.dataset.for === String(e.id) + ':' + e.type) { syncCtx(e); return; }
  bar.dataset.for = String(e.id) + ':' + e.type;
  const colorBtn = (k, label) => `<button class="st-color" data-ck="${k}" title="${label}"><i style="background:${e[k] || 'transparent'}"></i></button>`;
  let h = '';
  if (e.type === 'text') {
    h += `<select id="stFont" title="Police">${fontOptions(e.font)}</select>
      <div class="st-num"><button data-n="size" data-d="-1">−</button><input id="stSize" type="number" value="${e.size.toFixed(1)}" step="0.5" title="Taille (mm)"><button data-n="size" data-d="1">+</button></div>
      ${colorBtn('fill', 'Couleur du texte')}
      <button class="st-tg ${e.weight >= 700 ? 'on' : ''}" id="stBold" title="Gras"><b>B</b></button>
      <div class="st-seg">${['left', 'center', 'right'].map((a) => `<button data-al="${a}" class="${e.align === a ? 'on' : ''}" title="Aligner">${{ left: '⇤', center: '≡', right: '⇥' }[a]}</button>`).join('')}</div>
      <button class="st-tg" data-pop="fx" title="Effets : contour, espacement, courbe">Effets</button>`;
  } else if (e.type === 'shape') {
    h += `${colorBtn('fill', 'Remplissage')}<button class="st-tg" data-pop="fx" title="Bordure">Bordure</button>`;
  } else {
    h += `<button class="st-tg ai" id="stRmbg" title="Retire le fond de la photo avec l'IA">✨ Retirer le fond</button>
      <button class="st-tg" data-pop="fx" title="Contour blanc type sticker">Contour sticker</button>
      <button class="st-tg" id="stFlip" title="Miroir">⇋ Miroir</button>`;
  }
  h += `<span class="st-sp"></span>
    <button class="st-ic" id="stAlignH" title="Centrer horizontalement">↔ Centrer</button>
    <button class="st-ic" id="stAlignV" title="Centrer verticalement">↕ Centrer</button>
    <button class="st-ic" id="stFront" title="Passer devant les autres éléments">Devant</button>
    <button class="st-ic" id="stBack" title="Passer derrière les autres éléments">Derrière</button>
    <button class="st-ic" id="stDup" title="Dupliquer (⌘D)">⧉ Dupliquer</button>
    <button class="st-ic danger" id="stDel" title="Supprimer (⌫)">Supprimer</button>
    <div class="st-pop hidden" id="stPop"></div>`;
  bar.innerHTML = h;
  const up = (fn, snap = true) => { if (snap) snapshot(); fn(); render(); };
  if (e.type === 'text') {
    $('stFont').onchange = (ev) => up(() => { e.font = ev.target.value; e.weight = nearestWeight(e.font, e.weight); ensureFont(e.font, e.weight); });
    $('stSize').onchange = (ev) => up(() => { e.size = clamp(+ev.target.value || e.size, 1, 500); });
    bar.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => up(() => { e.size = clamp(e.size * (+b.dataset.d > 0 ? 1.1 : 0.9), 1, 500); }));
    $('stBold').onclick = () => up(() => { e.weight = nearestWeight(e.font, e.weight >= 700 ? 400 : 800); ensureFont(e.font, e.weight); bar.dataset.for = ''; });
    bar.querySelectorAll('[data-al]').forEach((b) => b.onclick = () => up(() => {
      const bx = boxOf(e); e.align = b.dataset.al; e.x = e.align === 'left' ? bx[0] : e.align === 'right' ? bx[0] + bx[2] : bx[0] + bx[2] / 2; bar.dataset.for = '';
    }));
  }
  if (e.type === 'image') {
    $('stRmbg').onclick = () => removeBg(e);
    $('stFlip').onclick = () => up(() => { e.flip = !e.flip; });
  }
  bar.querySelectorAll('[data-ck]').forEach((b) => b.onclick = () => colorPop(b, e, b.dataset.ck));
  bar.querySelectorAll('[data-pop="fx"]').forEach((b) => b.onclick = () => fxPop(b, e));
  $('stAlignH').onclick = () => align('h'); $('stAlignV').onclick = () => align('v');
  $('stFront').onclick = () => order(1); $('stBack').onclick = () => order(-1);
  $('stDup').onclick = dup; $('stDel').onclick = del;
}
function syncCtx(e) { const s = $('stSize'); if (s && document.activeElement !== s) s.value = e.size.toFixed(1); }
function fontOptions(cur) {
  const cats = [...new Set(D.fonts.map((f) => f.cat))];
  return cats.map((c) => `<optgroup label="${c}">${D.fonts.filter((f) => f.cat === c).map((f) => `<option value="${esc(f.family)}" ${f.family === cur ? 'selected' : ''} style="font-family:'${f.family}'">${esc(f.family)}</option>`).join('')}</optgroup>`).join('');
}
function closePop() { const p = $('stPop'); if (p) p.classList.add('hidden'); }
function placePop(p, anchor) { const r = anchor.getBoundingClientRect(), br = $('stCtx').getBoundingClientRect(); p.style.left = Math.max(0, r.left - br.left) + 'px'; p.classList.remove('hidden'); }
function colorPop(anchor, e, key) {
  const p = $('stPop');
  const rec = D.recents.filter((c) => !PALETTE.includes(c)).slice(0, 8);
  p.innerHTML = `<div class="st-pal">${PALETTE.map((c) => `<button data-c="${c}" style="background:${c}" class="${e[key] === c ? 'on' : ''}"></button>`).join('')}</div>
    ${rec.length ? `<div class="st-sub">Récentes</div><div class="st-pal">${rec.map((c) => `<button data-c="${c}" style="background:${c}"></button>`).join('')}</div>` : ''}
    <label class="st-custom">Autre couleur <input type="color" value="${/^#[0-9a-f]{6}$/i.test(e[key]) ? e[key] : '#000000'}"></label>
    ${key !== 'fill' ? '<button class="link" data-c="">Aucune</button>' : ''}`;
  placePop(p, anchor);
  const set = (c, keep) => { snapshot(); e[key] = c; if (key === 'stroke' && c && !e.strokeW) e.strokeW = e.type === 'text' ? Math.max(0.3, e.size * 0.05) : 1; if (key === 'outlineColor') { const im = D.imgs.get(e.key); if (im) im.ol = null; }
    if (c && !PALETTE.includes(c)) { D.recents = [c, ...D.recents.filter((x) => x !== c)].slice(0, 10); store.set('studio.colors', D.recents); }
    render(); anchor.querySelector('i') && (anchor.querySelector('i').style.background = c || 'transparent'); if (!keep) closePop(); };
  p.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => set(b.dataset.c));
  p.querySelector('input[type=color]').oninput = (ev) => { e[key] = ev.target.value; render(); };
  p.querySelector('input[type=color]').onchange = (ev) => set(ev.target.value, true);
}
function fxPop(anchor, e) {
  const p = $('stPop');
  const slider = (k, label, min, max, step, v, unit) => `<div class="st-sl"><label>${label}<b id="v_${k}">${(+v).toFixed(step < 1 ? 1 : 0)}${unit}</b></label><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}"></div>`;
  if (e.type === 'text') {
    p.innerHTML = `${slider('strokeW', 'Contour', 0, Math.max(3, e.size * 0.25), 0.1, e.strokeW || 0, ' mm')}
      <div class="st-row2"><span>Couleur du contour</span><button class="st-color" data-ck="stroke"><i style="background:${e.stroke || 'transparent'}"></i></button></div>
      ${slider('spacing', 'Espacement', -1, Math.max(4, e.size * 0.4), 0.1, e.spacing || 0, ' mm')}
      ${slider('curve', 'Courbe', -100, 100, 1, e.curve || 0, '')}
      <div class="st-sub">Astuce : pour un lettrage vitrine, gardez du texte assez épais (≥ 10 mm de haut) pour l'échenillage.</div>`;
  } else if (e.type === 'shape') {
    p.innerHTML = `${slider('strokeW', 'Bordure', 0, 6, 0.1, e.strokeW || 0, ' mm')}
      <div class="st-row2"><span>Couleur de bordure</span><button class="st-color" data-ck="stroke"><i style="background:${e.stroke || 'transparent'}"></i></button></div>`;
  } else {
    p.innerHTML = `${slider('outline', 'Contour sticker', 0, 6, 0.1, e.outline || 0, ' mm')}
      <div class="st-row2"><span>Couleur</span><button class="st-color" data-ck="outlineColor"><i style="background:${e.outlineColor}"></i></button></div>
      <div class="st-sub">Ajoute une bordure autour du dessin détouré, comme un vrai sticker.</div>`;
  }
  placePop(p, anchor);
  let snapped = false;
  p.querySelectorAll('input[type=range]').forEach((r) => {
    r.oninput = () => { if (!snapped) { snapshot(); snapped = true; } const k = r.dataset.k; e[k] = +r.value; if (k === 'strokeW' && e[k] && !e.stroke) e.stroke = '#ffffff'; $('v_' + k).textContent = (+r.value).toFixed(+r.step < 1 ? 1 : 0) + (k === 'curve' ? '' : ' mm'); render(); };
  });
  p.querySelectorAll('[data-ck]').forEach((b) => b.onclick = (ev) => { ev.stopPropagation(); colorPop(b, e, b.dataset.ck); });
}
document.addEventListener('pointerdown', (ev) => { if (D.open && !ev.target.closest('#stPop') && !ev.target.closest('[data-pop],[data-ck]')) closePop(); }, true);

/* ───────── Panneau texte (zone d'édition) ───────── */
function panel() {
  const d = $('stDrawer'), e = el(); if (!d) return;
  let box = $('stTextBox');
  if (e && e.type === 'text') {
    if (!box) { box = document.createElement('div'); box.id = 'stTextBox'; box.className = 'st-textbox'; d.prepend(box); }
    if (box.dataset.for !== String(e.id)) {
      box.dataset.for = String(e.id);
      box.innerHTML = `<h4>Texte sélectionné</h4><textarea id="stTextArea" rows="3" spellcheck="true">${esc(e.text)}</textarea><div class="st-sub">Entrée = nouvelle ligne.</div>`;
      let snapped = false;
      $('stTextArea').oninput = (ev) => { if (!snapped) { snapshot(); snapped = true; } e.text = ev.target.value || ' '; render(); };
    }
  } else if (box) box.remove();
}

/* ───────── IA : retrait du fond ───────── */
async function removeBg(e) {
  const im = D.imgs.get(e.key); if (!im) return;
  const btn = $('stRmbg'); btn.disabled = true;
  const label = (t) => { btn.textContent = t; };
  try {
    if (!D.bgModel) {
      label('Chargement du modèle IA…');
      const T = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js');
      const prog = {};
      D.bgModel = await T.pipeline('background-removal', 'onnx-community/ormbg-ONNX', {
        dtype: 'q8',
        progress_callback: (p) => { if (p.status === 'progress' && p.total) { prog[p.file] = [p.loaded, p.total]; const [l, t] = Object.values(prog).reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]); label(`Téléchargement IA ${Math.round(l / t * 100)} %`); } },
      });
      D.bgLib = T;
    }
    label('Détourage en cours…');
    const blob = await new Promise((r) => im.canvas.toBlob(r, 'image/png'));
    const url = URL.createObjectURL(blob);
    let out; try { out = await D.bgModel(url); } finally { URL.revokeObjectURL(url); }
    const raw = Array.isArray(out) ? out[0] : out;
    const res = raw.toCanvas();
    // masque IA appliqué à l'image d'origine (pleine résolution)
    const c = canvas(im.canvas.width, im.canvas.height), x = c.getContext('2d');
    x.drawImage(res, 0, 0, c.width, c.height);
    // nettoie le masque : supprime les résidus quasi transparents, durcit les bords
    const md = x.getImageData(0, 0, c.width, c.height), a = md.data;
    for (let i = 3; i < a.length; i += 4) a[i] = a[i] < 60 ? 0 : a[i] > 190 ? 255 : Math.round((a[i] - 60) / 130 * 255);
    x.putImageData(md, 0, 0);
    x.globalCompositeOperation = 'source-in'; x.drawImage(im.canvas, 0, 0);
    // recadrage sur le sujet
    const box = alphaBounds(c);
    if (!box) throw new Error('aucun sujet détecté');
    const cut = canvas(box[2], box[3]); cut.getContext('2d').drawImage(c, box[0], box[1], box[2], box[3], 0, 0, box[2], box[3]);
    snapshot();
    const key = e.key + 'n';
    D.imgs.set(key, { canvas: cut, name: im.name + ' (détouré)', url: cut.toDataURL('image/png') });
    const sx = e.w / im.canvas.width, sy = e.h / im.canvas.height;
    e.key = key; e.x += box[0] * sx; e.y += box[1] * sy; e.w = box[2] * sx; e.h = box[3] * sy;
    if (!e.outline) { e.outline = Math.max(1, Math.min(e.w, e.h) * 0.03); e.outlineColor = '#ffffff'; }
    renderImgLib(); render(); $('stCtx').dataset.for = ''; render();
    toast('Fond retiré ✓ Un contour blanc « sticker » a été ajouté (réglable dans « Contour sticker »).');
  } catch (err) {
    console.error(err); toast('Détourage impossible : ' + err.message, 'err');
    btn.disabled = false; label('✨ Retirer le fond');
  }
}
function alphaBounds(c) {
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

/* ───────── Export vers la planche ───────── */
async function finish() {
  if (!D.els.length) { toast('Ajoutez au moins un élément.', 'err'); return; }
  await Promise.all(D.els.filter((e) => e.type === 'text').map((e) => ensureFont(e.font, e.weight)));
  await document.fonts.ready;
  const k = Math.min(PX_MM, MAX_EXPORT_PX / Math.max(D.w, D.h));
  const c = canvas(D.w * k, D.h * k), x = c.getContext('2d');
  x.scale(k, k); for (const e of D.els) drawEl(x, e);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const dpi = k * 25.4;
  const name = (D.els.find((e) => e.type === 'text') || {}).text || 'Sticker';
  const file = new File([await withDpi(blob, dpi)], `Studio — ${name.split('\n')[0].slice(0, 24)}.png`, { type: 'image/png' });
  close();
  D.onDone && D.onDone(file, { wMm: D.w, hMm: D.h, onlyText: D.els.every((e) => e.type === 'text') });
}
/** inscrit la résolution dans le PNG (bloc pHYs) pour que CutLink retrouve la taille en mm */
async function withDpi(blob, dpi) {
  const b = new Uint8Array(await blob.arrayBuffer());
  const ppm = Math.round(dpi / 0.0254);
  const data = new Uint8Array(9); const dv = new DataView(data.buffer); dv.setUint32(0, ppm); dv.setUint32(4, ppm); data[8] = 1;
  const type = new TextEncoder().encode('pHYs');
  const crc = crc32(new Uint8Array([...type, ...data]));
  const chunk = new Uint8Array(21); const cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9); chunk.set(type, 4); chunk.set(data, 8); cv.setUint32(17, crc);
  const at = 33; // après la signature (8) + IHDR (25)
  return new Blob([b.slice(0, at), chunk, b.slice(at)], { type: 'image/png' });
}
let CRC_T = null;
function crc32(u) {
  if (!CRC_T) { CRC_T = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } }
  let c = 0xffffffff; for (const v of u) c = CRC_T[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
}

export const Studio = { D, applyTpl, TEMPLATES, addText, addShape, finish, render };

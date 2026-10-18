'use strict';
/* CutLink — traits de coupe pour Mimaki CJV150-75 / RasterLink7
   Tout tourne côté navigateur. Unités internes : mm pour la géométrie finale,
   "proc px" = grille de calcul (canvas px × procScale). */
const { readPsd, PDFLib } = window.Lib;
const MAX_CUT_MM = 800;     // CJV150-75 : largeur max impression/coupe
const MAX_MEDIA_MM = 810;   // largeur max support
const BIG = 1e9;
const CUT_COLORS = { CutContour: '#ff00a8', CutContourHalf: '#00c8ff', CutContourFull: '#ffb000' };
const CUT_CMYK = { CutContour: [0, 1, 0, 0], CutContourHalf: [1, 0, 0, 0], CutContourFull: [0, 0.4, 1, 0] };
const PRESET_NAMES = ['CutContour', 'CutContourHalf', 'CutContourFull'];
const NAME_RE = /^CutContour[A-Za-z0-9]*$/;
const $ = (id) => document.getElementById(id);

const S = {
  doc: null,       // {name, wPx, hPx, wMm, hMm, nativeDpi, composite(canvas|null), source}
  items: [],       // calques de découpe
  sel: null,
  result: null,
  view: { scale: 1, ox: 0, oy: 0, fitted: false },
  preview: null,   // canvas réduit du visuel
  bleedCanvas: null, bleedRect: null,
  customNames: [],
};
const G = () => ({
  prec: +$('gPrec').value, merge: $('gMerge').checked, bleed: Math.max(0, +$('gBleed').value || 0),
  frame: $('gFrame').checked, frameM: +$('gFrameM').value || 0, frameName: $('gFrameName').value,
  stroke: Math.max(0.05, +$('gStroke').value || 0.25), img: $('gImg').value,
});

/* ───────────── Chargement ───────────── */
async function loadFile(file) {
  setBusy(true);
  try {
    const buf = await file.arrayBuffer();
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'psd' || ext === 'psb') await loadPsd(buf, file.name);
    else await loadImage(buf, file.name, file.type);
    afterLoad();
  } catch (e) {
    console.error(e);
    alert('Impossible de lire ce fichier : ' + e.message);
  } finally { setBusy(false); }
}

async function loadPsd(buf, name) {
  const psd = readPsd(buf, { skipThumbnail: true, useImageData: false });
  let dpi = 300;
  const ri = psd.imageResources && psd.imageResources.resolutionInfo;
  if (ri && ri.horizontalResolution) {
    dpi = ri.horizontalResolution;
    if (/cm/i.test(ri.horizontalResolutionUnit || '')) dpi *= 2.54;
  }
  S.doc = { name, wPx: psd.width, hPx: psd.height, nativeDpi: dpi,
    wMm: psd.width / dpi * 25.4, hMm: psd.height / dpi * 25.4,
    composite: psd.canvas || null, source: 'psd' };
  S.items = [];
  const kids = (psd.children || []).slice().reverse(); // haut → bas
  for (const node of kids) { const it = buildItem(node); if (it) S.items.push(it); }
  if (!S.doc.composite || isBlank(S.doc.composite)) S.doc.composite = composeOwn(psd);
}
function isBlank(c) {
  // composite absent ou vide (PSD enregistré sans « compatibilité maximale »)
  const k = Math.min(1, 160 / Math.max(c.width, c.height));
  const t = document.createElement('canvas'); t.width = Math.max(1, c.width * k | 0); t.height = Math.max(1, c.height * k | 0);
  const x = t.getContext('2d'); x.drawImage(c, 0, 0, t.width, t.height);
  const a = x.getImageData(0, 0, t.width, t.height).data;
  for (let i = 4; i < a.length; i += 4) if (a[i] !== a[0] || a[i + 1] !== a[1] || a[i + 2] !== a[2] || a[i + 3] !== a[3]) return false;
  return true;
}

function collectLeaves(node, out, parentHidden) {
  const hidden = parentHidden || !!node.hidden;
  if (node.children) { for (const c of node.children) collectLeaves(c, out, hidden); return; }
  if (!node.canvas || node.clipping) return; // calques écrêtés : ne changent pas la forme
  if (hidden) return;
  out.push({ canvas: shapeCanvas(node), left: node.left || 0, top: node.top || 0, opacity: node.opacity == null ? 1 : node.opacity, raw: node.canvas });
}

function shapeCanvas(node) {
  // applique le masque de fusion du calque si présent
  const m = node.mask;
  if (!m || m.disabled || !m.canvas) return node.canvas;
  const w = node.canvas.width, h = node.canvas.height;
  const mc = document.createElement('canvas'); mc.width = w; mc.height = h;
  const mx = mc.getContext('2d');
  const def = m.defaultColor || 0;
  mx.fillStyle = `rgb(${def},${def},${def})`; mx.fillRect(0, 0, w, h);
  mx.drawImage(m.canvas, (m.left || 0) - (node.left || 0), (m.top || 0) - (node.top || 0));
  const md = mx.getImageData(0, 0, w, h);
  for (let i = 0; i < md.data.length; i += 4) { md.data[i + 3] = md.data[i]; }
  mx.putImageData(md, 0, 0);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const cx = c.getContext('2d'); cx.drawImage(node.canvas, 0, 0);
  cx.globalCompositeOperation = 'destination-in'; cx.drawImage(mc, 0, 0);
  return c;
}

let ITEM_ID = 0;
function buildItem(node) {
  const leaves = []; collectLeaves(node, leaves, false);
  const isGroup = !!node.children;
  const isText = !!node.text;
  const it = {
    id: ++ITEM_ID, name: node.name || 'Calque', node, leaves,
    kind: isGroup ? 'groupe' : isText ? 'texte' : 'calque',
    hidden: !!node.hidden, tags: [], cache: {}, open: false,
    s: { cut: true, shape: 'contour', offset: 2, thr: 50, smooth: 2, outerOnly: true, closing: 0, minArea: 2, radius: 3, name: 'CutContour' },
  };
  if (isText) { it.s.closing = 1.5; it.tags.push('texte'); }
  if (isGroup) it.tags.push('groupe');
  if (!leaves.length) { it.s.cut = false; it.tags.push(it.hidden ? 'masqué' : 'vide'); }
  // détection fond plein (≥ 97 % du document, opaque)
  else if (coverage(it) > 0.97) { it.s.cut = false; it.tags.push('fond'); }
  if (/^(arri[eè]re-plan|background|fond)/i.test(it.name)) { it.s.cut = false; if (!it.tags.includes('fond')) it.tags.push('fond'); }
  it.thumb = makeThumb(it);
  return it;
}

function coverage(it) {
  const d = S.doc, k = Math.min(1, 200 / Math.max(d.wPx, d.hPx));
  const w = Math.max(1, Math.round(d.wPx * k)), h = Math.max(1, Math.round(d.hPx * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  for (const l of it.leaves) x.drawImage(l.canvas, l.left * k, l.top * k, l.canvas.width * k, l.canvas.height * k);
  const a = x.getImageData(0, 0, w, h).data; let n = 0;
  for (let i = 3; i < a.length; i += 4) if (a[i] > 200) n++;
  return n / (w * h);
}

function makeThumb(it) {
  const c = document.createElement('canvas'); c.width = 76; c.height = 76;
  const x = c.getContext('2d');
  const d = S.doc, k = Math.min(76 / d.wPx, 76 / d.hPx);
  const ox = (76 - d.wPx * k) / 2, oy = (76 - d.hPx * k) / 2;
  for (const l of it.leaves) x.drawImage(l.canvas, ox + l.left * k, oy + l.top * k, l.canvas.width * k, l.canvas.height * k);
  return c;
}

function composeOwn(psd) {
  const d = S.doc; const c = document.createElement('canvas'); c.width = d.wPx; c.height = d.hPx;
  const x = c.getContext('2d');
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

async function loadImage(buf, name, type) {
  const blob = new Blob([buf], { type: type || 'image/png' });
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
  const dpi = readDpi(new Uint8Array(buf)) || 300;
  S.doc = { name, wPx: c.width, hPx: c.height, nativeDpi: dpi, wMm: c.width / dpi * 25.4, hMm: c.height / dpi * 25.4, composite: c, source: 'image' };
  // fond uni opaque ? → détourage automatique par la couleur des coins
  const img = x.getImageData(0, 0, c.width, c.height);
  let shape = c, keyed = false;
  if (isOpaque(img)) {
    const bg = cornerColor(img);
    if (bg) { shape = keyCanvas(img, bg, 40); keyed = true; }
  }
  const it = {
    id: ++ITEM_ID, name: name.replace(/\.[^.]+$/, ''), leaves: [{ canvas: shape, left: 0, top: 0, opacity: 1, raw: c }],
    kind: 'image', tags: keyed ? ['fond détouré'] : [], cache: {}, open: true,
    s: { cut: true, shape: 'contour', offset: 2, thr: 50, smooth: 2, outerOnly: true, closing: 0, minArea: 2, radius: 3, name: 'CutContour' },
  };
  it.thumb = makeThumb(it);
  S.items = [it];
}
function isOpaque(img) { const a = img.data; for (let i = 3; i < a.length; i += 4 * 97) if (a[i] < 250) return false; return true; }
function cornerColor(img) {
  const { width: w, height: h, data: a } = img;
  const pts = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [w >> 1, 0], [0, h >> 1]];
  const cols = pts.map(([x, y]) => { const i = (y * w + x) * 4; return [a[i], a[i + 1], a[i + 2]]; });
  const ref = cols[0];
  for (const c of cols) if (Math.abs(c[0] - ref[0]) + Math.abs(c[1] - ref[1]) + Math.abs(c[2] - ref[2]) > 45) return null;
  return ref;
}
function keyCanvas(img, bg, tol) {
  const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height); const a = out.data;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a[i] - bg[0]) + Math.abs(a[i + 1] - bg[1]) + Math.abs(a[i + 2] - bg[2]);
    a[i + 3] = d <= tol ? 0 : d >= tol * 2 ? 255 : Math.round((d - tol) / tol * 255);
  }
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(out, 0, 0); return c;
}
function readDpi(b) {
  try {
    if (b[0] === 0x89 && b[1] === 0x50) { // PNG pHYs
      let p = 8;
      while (p < b.length - 12) {
        const len = (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0;
        const t = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
        if (t === 'pHYs') { const ppm = (b[p + 8] << 24 | b[p + 9] << 16 | b[p + 10] << 8 | b[p + 11]) >>> 0; if (b[p + 16] === 1 && ppm > 0) return ppm * 0.0254; return 0; }
        if (t === 'IDAT') return 0;
        p += 12 + len;
      }
    } else if (b[0] === 0xFF && b[1] === 0xD8 && b[6] === 0x4A && b[7] === 0x46) { // JFIF
      const u = b[13], xd = b[14] << 8 | b[15];
      if (u === 1 && xd > 1) return xd; if (u === 2 && xd > 1) return xd * 2.54;
    }
  } catch (e) { }
  return 0;
}

function afterLoad() {
  const d = S.doc;
  const k = Math.min(1, 2400 / Math.max(d.wPx, d.hPx));
  const p = document.createElement('canvas'); p.width = Math.round(d.wPx * k); p.height = Math.round(d.hPx * k);
  p.getContext('2d').drawImage(d.composite, 0, 0, p.width, p.height);
  S.preview = p;
  S.sel = (S.items.find(i => i.s.cut) || S.items[0] || {}).id;
  $('dropHint').classList.add('hidden');
  $('docPanel').classList.remove('hidden'); $('layersPanel').classList.remove('hidden');
  $('docW').value = d.wMm.toFixed(1); $('docH').value = d.hMm.toFixed(1);
  updateDocInfo();
  S.view.fitted = false;
  renderLayers(); schedule(0);
}
function updateDocInfo() {
  const d = S.doc;
  const dpiEff = d.wPx / (d.wMm / 25.4);
  $('docInfo').innerHTML = `<b>${esc(d.name)}</b><br>${d.wPx} × ${d.hPx} px · ${Math.round(dpiEff)} dpi effectifs · ${S.items.length} calque(s)`;
}

/* ───────────── UI calques ───────────── */
function allNames() { return [...PRESET_NAMES, ...S.customNames]; }
function nameOptions(cur) {
  return allNames().map(n => `<option ${n === cur ? 'selected' : ''}>${n}</option>`).join('') + `<option value="__new">+ Autre nom…</option>`;
}
function renderLayers() {
  const ul = $('layerList'); ul.innerHTML = '';
  for (const it of S.items) {
    const li = document.createElement('li');
    li.className = 'layer' + (it.id === S.sel ? ' sel' : '') + (it.s.cut ? '' : ' off');
    const st = it.stat ? `${it.stat.pieces} pièce(s)` : '';
    li.innerHTML = `
      <div class="lhead">
        <span class="dot" style="background:${it.s.cut ? colorOf(it.s.name) : '#444'}"></span>
        <span class="th"></span>
        <div class="lname">${esc(it.name)}${it.tags.map(t => `<span class="tag">${t}</span>`).join('')}<small>${it.s.cut ? shapeLabel(it.s.shape) + ' · ' + fmt(it.s.offset) + ' mm · ' + it.s.name + (st ? ' · ' + st : '') : 'non découpé'}</small></div>
        <label class="switch" title="Découper ce calque"><input type="checkbox" data-k="cut" ${it.s.cut ? 'checked' : ''} ${it.leaves.length ? '' : 'disabled'}><span></span></label>
      </div>
      <div class="lbody ${it.open ? '' : 'hidden'}">
        <div class="row"><label>Forme</label><select data-k="shape">
          ${[['contour', 'Contour du dessin'], ['rect', 'Rectangle'], ['rrect', 'Rectangle arrondi'], ['circle', 'Cercle'], ['ellipse', 'Ellipse']].map(([v, l]) => `<option value="${v}" ${v === it.s.shape ? 'selected' : ''}>${l}</option>`).join('')}
        </select></div>
        <div class="row"><label>Décalage (mm)</label><input type="number" data-k="offset" step="0.5" value="${it.s.offset}"></div>
        <input type="range" data-k="offset" min="-5" max="15" step="0.5" value="${it.s.offset}">
        ${it.s.shape === 'rrect' ? `<div class="row"><label>Rayon des coins (mm)</label><input type="number" data-k="radius" step="0.5" min="0" value="${it.s.radius}"></div>` : ''}
        <div class="row"><label>Nom de coupe</label><select data-k="name" class="cutname">${nameOptions(it.s.name)}</select></div>
        ${it.s.shape === 'contour' ? `
        <div class="row"><label>Rapprocher les éléments (mm)</label><input type="number" data-k="closing" step="0.5" min="0" value="${it.s.closing}"></div>
        <div class="row"><label>Lissage</label><select data-k="smooth">${[[0, 'Aucun'], [2, 'Léger'], [5, 'Moyen'], [12, 'Fort']].map(([v, l]) => `<option value="${v}" ${+v === +it.s.smooth ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="row chk"><label><input type="checkbox" data-k="outerOnly" ${it.s.outerOnly ? 'checked' : ''}> Contour extérieur seul (ignorer les trous)</label></div>` : ''}
        <div class="row"><label>Seuil d'opacité (%)</label><input type="number" data-k="thr" min="1" max="99" value="${it.s.thr}"></div>
        <div class="row"><label>Ignorer les éléments &lt; (mm²)</label><input type="number" data-k="minArea" min="0" step="1" value="${it.s.minArea}"></div>
        ${it.kind === 'groupe' && it.node && it.node.children && it.node.children.length > 1 ? `<button class="mini" data-act="ungroup">Séparer le groupe en calques</button>` : ''}
      </div>`;
    li.querySelector('.th').replaceWith(it.thumb);
    li.querySelector('.lhead').addEventListener('click', (e) => {
      if (e.target.closest('.switch')) return;
      it.open = !it.open; S.sel = it.id; renderLayers(); draw();
    });
    li.querySelectorAll('[data-k]').forEach(el => el.addEventListener('change', () => onSetting(it, el)));
    li.querySelectorAll('input[type=range]').forEach(el => el.addEventListener('input', () => {
      li.querySelector('input[type=number][data-k=offset]').value = el.value; it.s.offset = +el.value; schedule();
    }));
    const ug = li.querySelector('[data-act=ungroup]');
    if (ug) ug.addEventListener('click', () => ungroup(it));
    ul.appendChild(li);
  }
}
function onSetting(it, el) {
  const k = el.dataset.k;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (k === 'name' && v === '__new') {
    const n = prompt('Nom de coupe (doit commencer par CutContour, lettres/chiffres sans accent) :', 'CutContourKiss');
    if (!n) { renderLayers(); return; }
    if (!NAME_RE.test(n)) { alert('Nom refusé : il doit commencer par « CutContour » suivi uniquement de lettres et chiffres non accentués (exigence RasterLink).'); renderLayers(); return; }
    if (!allNames().includes(n)) S.customNames.push(n);
    v = n; fillFrameNames();
  }
  if (['offset', 'thr', 'smooth', 'closing', 'minArea', 'radius'].includes(k)) v = +v || 0;
  it.s[k] = v; S.sel = it.id;
  renderLayers(); schedule();
}
function ungroup(it) {
  const idx = S.items.indexOf(it);
  const kids = it.node.children.slice().reverse().map(buildItem).filter(Boolean);
  kids.forEach(k => { k.s.offset = it.s.offset; k.s.name = it.s.name; });
  S.items.splice(idx, 1, ...kids);
  updateDocInfo(); renderLayers(); schedule();
}
function shapeLabel(s) { return { contour: 'Contour', rect: 'Rectangle', rrect: 'Rect. arrondi', circle: 'Cercle', ellipse: 'Ellipse' }[s]; }
function colorOf(n) { if (CUT_COLORS[n]) return CUT_COLORS[n]; const h = [...n].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 360; return `hsl(${h},90%,60%)`; }
function cmykOf(n) { return CUT_CMYK[n] || [0, 1, 0.3, 0]; }
function fillFrameNames() { const cur = $('gFrameName').value || 'CutContourFull'; $('gFrameName').innerHTML = allNames().map(n => `<option ${n === cur ? 'selected' : ''}>${n}</option>`).join(''); }

/* ───────────── Géométrie ───────────── */
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
/** distance euclidienne (px) de chaque pixel au pixel "on" le plus proche */
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

/** Calcule le "champ" signé (px de la grille de calcul, <0 = intérieur de la coupe) d'un calque */
function computeField(it, ctx) {
  const { procS, pxmm } = ctx; // procS : canvas px → proc px ; pxmm : proc px par mm
  const s = it.s;
  const key = JSON.stringify([procS, s.shape, s.offset, s.thr, s.closing, s.minArea, s.outerOnly, s.radius]);
  if (it.cache.key === key) return it.cache.field;
  // Phase A : masque binaire
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const l of it.leaves) {
    bx0 = Math.min(bx0, l.left); by0 = Math.min(by0, l.top);
    bx1 = Math.max(bx1, l.left + l.canvas.width); by1 = Math.max(by1, l.top + l.canvas.height);
  }
  const closePx = s.shape === 'contour' ? Math.max(0, s.closing) * pxmm : 0;
  const mA = Math.ceil(closePx) + 3;
  const ax = Math.floor(bx0 * procS) - mA, ay = Math.floor(by0 * procS) - mA;
  const aw = Math.ceil(bx1 * procS) - ax + mA, ah = Math.ceil(by1 * procS) - ay + mA;
  const cv = document.createElement('canvas'); cv.width = aw; cv.height = ah;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  for (const l of it.leaves) cx.drawImage(l.canvas, l.left * procS - ax, l.top * procS - ay, l.canvas.width * procS, l.canvas.height * procS);
  const px = cx.getImageData(0, 0, aw, ah).data;
  let M = new Uint8Array(aw * ah); const th = s.thr / 100 * 255;
  for (let i = 0; i < aw * ah; i++) M[i] = px[i * 4 + 3] >= th ? 1 : 0;
  removeSmall(M, aw, ah, s.minArea * pxmm * pxmm);
  if (closePx > 0) {
    const dOut = edt(M, aw, ah, 1);
    const D = new Uint8Array(aw * ah); for (let i = 0; i < D.length; i++) D[i] = dOut[i] <= closePx ? 1 : 0;
    const dIn = edt(D, aw, ah, 0);
    for (let i = 0; i < D.length; i++) M[i] = dIn[i] > closePx ? 1 : 0;
  }
  if (s.outerOnly || s.shape !== 'contour') fillHoles(M, aw, ah);
  // boîte du contenu
  let cx0 = Infinity, cy0 = Infinity, cx1 = -1, cy1 = -1, count = 0;
  for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) if (M[y * aw + x]) { count++; if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y; }
  if (!count) { it.cache = { key, field: null }; return null; }
  const off = s.offset * pxmm;
  // Phase B : champ selon la forme
  const ccx = (cx0 + cx1 + 1) / 2, ccy = (cy0 + cy1 + 1) / 2;   // centre (coords crop A, bord de pixel)
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
  } else {
    // cercle / ellipse englobants
    const ax2 = s.shape === 'circle' ? 1 : hw, ay2 = s.shape === 'circle' ? 1 : hh;
    let kmax = 0;
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
      const i = y * aw + x; if (!M[i]) continue;
      // seulement les pixels de bord
      if (M[i - 1] && M[i + 1] && M[i - aw] && M[i + aw]) continue;
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
    for (let y = 0; y < gh; y++) { const sy = gy0 + y; if (sy < 0 || sy >= ah) continue; for (let x = 0; x < gw; x++) { const sx = gx0 + x; if (sx >= 0 && sx < aw) G2[y * gw + x] = M[sy * aw + sx]; } }
    const dOut = edt(G2, gw, gh, 1), dIn = edt(G2, gw, gh, 0);
    for (let i = 0; i < F.length; i++) F[i] = (G2[i] ? 0.5 - dIn[i] : dOut[i] - 0.5) - off;
  }
  const field = { F, x: ax + gx0, y: ay + gy0, w: gw, h: gh }; // x,y en proc px globaux
  it.cache = { key, field };
  return field;
}

/** marching squares sur champ, iso 0 → boucles en proc px globaux */
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
function smoothLoop(p, it) {
  for (let k = 0; k < it; k++) {
    const n = p.length, q = new Array(n);
    for (let i = 0; i < n; i++) { const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n]; q[i] = [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4]; }
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
const area = (p) => { let s = 0; for (let i = 0, n = p.length; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s / 2); };
const perim = (p) => { let s = 0; for (let i = 0, n = p.length; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; s += Math.hypot(b[0] - a[0], b[1] - a[1]); } return s; };
function bboxOf(loops) { let a = [Infinity, Infinity, -Infinity, -Infinity]; for (const l of loops) for (const [x, y] of l) { if (x < a[0]) a[0] = x; if (y < a[1]) a[1] = y; if (x > a[2]) a[2] = x; if (y > a[3]) a[3] = y; } return a; }

/* ───────────── Calcul global ───────────── */
let timer = null, running = false, again = false;
function schedule(ms = 250) { clearTimeout(timer); timer = setTimeout(run, ms); }
async function run() {
  if (!S.doc) return;
  if (running) { again = true; return; }
  running = true; setBusy(true);
  await new Promise(r => setTimeout(r, 20));
  try { compute(); } catch (e) { console.error(e); S.result = { error: e.message, cuts: [], warnings: [{ t: 'err', m: e.message }] }; }
  setBusy(false); running = false;
  renderLayers(); renderReport(); draw();
  if (again) { again = false; schedule(0); }
}

function compute() {
  const d = S.doc, g = G();
  const canvasPxMm = d.wPx / d.wMm;
  const procS = Math.min(1, g.prec / Math.max(d.wPx, d.hPx));
  const pxmm = canvasPxMm * procS;
  const ctx = { procS, pxmm };
  const active = S.items.filter(i => i.s.cut && i.leaves.length);
  const fields = new Map();
  for (const it of active) { const f = computeField(it, ctx); if (f) fields.set(it.id, f); }
  for (const it of S.items) it.stat = null;
  // regroupement par nom de coupe
  const byName = new Map();
  for (const it of active) { if (!fields.has(it.id)) continue; (byName.get(it.s.name) || byName.set(it.s.name, []).get(it.s.name)).push(it); }
  const cuts = []; // {name, loops(mm), items:[ids]}
  const warnings = [];
  const toMm = (l) => l.map(([x, y]) => [x / pxmm, y / pxmm]);
  const eps = Math.max(0.3, 0.025 * pxmm);
  const finish = (loops, smooth) => loops.map(l => simplifyClosed(smoothLoop(l, smooth), eps)).filter(l => l.length >= 3).map(toMm).filter(l => area(l) >= 0.5);
  for (const [name, its] of byName) {
    if (g.merge && its.length > 1) {
      // union = min des champs
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const it of its) { const f = fields.get(it.id); x0 = Math.min(x0, f.x); y0 = Math.min(y0, f.y); x1 = Math.max(x1, f.x + f.w); y1 = Math.max(y1, f.y + f.h); }
      const w = x1 - x0, h = y1 - y0;
      if (w * h > 80e6) throw new Error('planche trop grande pour la précision choisie — passez en « Rapide »');
      const U = new Float32Array(w * h).fill(BIG);
      const owner = new Int16Array(w * h).fill(-1); let overlaps = new Set();
      its.forEach((it, idx) => {
        const f = fields.get(it.id);
        for (let y = 0; y < f.h; y++) { const o = (f.y - y0 + y) * w + (f.x - x0); for (let x = 0; x < f.w; x++) { const v = f.F[y * f.w + x]; const j = o + x; if (v < 0 && U[j] < 0 && owner[j] !== idx) overlaps.add(owner[j] + ':' + idx); if (v < U[j]) { U[j] = v; if (v < 0) owner[j] = idx; } } }
      });
      const smooth = Math.max(...its.map(i => i.s.shape === 'contour' ? +i.s.smooth : 1));
      const loops = finish(trace({ F: U, x: x0, y: y0, w, h }), smooth);
      cuts.push({ name, loops, items: its.map(i => i.id) });
      if (overlaps.size) {
        const pairs = [...overlaps].map(p => p.split(':').map(Number)).filter(([a, b]) => a >= 0 && b >= 0);
        if (pairs.length) warnings.push({ t: 'info', m: `${pairs.length} chevauchement(s) fusionné(s) en une seule coupe (${name}) : ${pairs.slice(0, 3).map(([a, b]) => `« ${its[a].name} » + « ${its[b].name} »`).join(', ')}${pairs.length > 3 ? '…' : ''}.` });
      }
      for (const it of its) it.stat = { pieces: '—' };
      // nombre de pièces par calque : approx via ses propres boucles
      for (const it of its) it.stat = { pieces: finish(trace(fields.get(it.id)), 0).length };
    } else {
      for (const it of its) {
        const loops = finish(trace(fields.get(it.id)), it.s.shape === 'contour' ? +it.s.smooth : 1);
        cuts.push({ name, loops, items: [it.id] });
        it.stat = { pieces: loops.length };
      }
      if (!g.merge && its.length > 1) {
        // détection de chevauchements → double passage de lame
        const ov = [];
        for (let a = 0; a < its.length; a++) for (let b = a + 1; b < its.length; b++) if (fieldsOverlap(fields.get(its[a].id), fields.get(its[b].id))) ov.push(`« ${its[a].name} » / « ${its[b].name} »`);
        if (ov.length) warnings.push({ t: 'warn', m: `Coupes qui se chevauchent : ${ov.slice(0, 3).join(', ')}. La lame passera deux fois. Cochez « Fusionner les coupes qui se touchent ».` });
      }
    }
  }
  // cadre de planche
  if (g.frame) {
    const m = g.frameM; const W = d.wMm, H = d.hMm;
    cuts.push({ name: g.frameName, loops: [[[m, m], [W - m, m], [W - m, H - m], [m, H - m]]], items: [], frame: true });
  }
  // bornes de page : document ∪ coupes (+1 mm)
  const all = cuts.flatMap(c => c.loops);
  let pb = [0, 0, d.wMm, d.hMm];
  if (all.length) {
    const bb = bboxOf(all);
    if (bb[0] < 0 || bb[1] < 0 || bb[2] > d.wMm || bb[3] > d.hMm) {
      pb = [Math.min(0, bb[0] - 1), Math.min(0, bb[1] - 1), Math.max(d.wMm, bb[2] + 1), Math.max(d.hMm, bb[3] + 1)];
      warnings.push({ t: 'info', m: `Des coupes dépassent du document : la page du PDF est agrandie à ${fmt(pb[2] - pb[0])} × ${fmt(pb[3] - pb[1])} mm pour les inclure.` });
    }
  }
  // fond perdu
  S.bleedCanvas = null;
  if (g.bleed > 0 && fields.size) buildBleed(fields, pxmm, procS, g.bleed);

  // contrôles CJV150-75
  const pw = pb[2] - pb[0], ph = pb[3] - pb[1];
  if (!all.length) warnings.push({ t: 'err', m: 'Aucune ligne de coupe. Activez au moins un calque.' });
  if (Math.min(pw, ph) > MAX_CUT_MM) warnings.push({ t: 'err', m: `Travail de ${fmt(pw)} × ${fmt(ph)} mm : trop large pour la CJV150-75 dans les deux sens (${MAX_CUT_MM} mm d'impression et de coupe au maximum). Divisez le travail.` });
  else if (pw > MAX_CUT_MM) warnings.push({ t: 'warn', m: `Largeur ${fmt(pw)} mm > ${MAX_CUT_MM} mm : faites pivoter le travail de 90° dans RasterLink (la hauteur ${fmt(ph)} mm passe dans la laize).` });
  else if (pw > MAX_CUT_MM - 30) warnings.push({ t: 'warn', m: `Largeur ${fmt(pw)} mm : très proche de la laize max (${MAX_CUT_MM} mm, support ${MAX_MEDIA_MM} mm). Gardez de la place pour les repères que RasterLink ajoute.` });
  const tiny = all.filter(l => { const b = bboxOf([l]); return Math.min(b[2] - b[0], b[3] - b[1]) < 4; }).length;
  if (tiny) warnings.push({ t: 'warn', m: `${tiny} pièce(s) de moins de 4 mm : risque d'arrachement au pelliculage. Augmentez « Ignorer les éléments < » ou « Rapprocher les éléments ».` });
  for (const it of active) {
    if (!fields.has(it.id)) warnings.push({ t: 'warn', m: `« ${it.name} » : aucune forme détectée (calque vide ou seuil d'opacité trop haut).` });
    else if (it.s.shape === 'contour' && it.stat && it.stat.pieces > 12 && !it.s.closing) warnings.push({ t: 'info', m: `« ${it.name} » donne ${it.stat.pieces} pièces séparées. Pour un seul sticker, mettez « Rapprocher les éléments » à 2-3 mm.` });
    if (it.s.offset < 0 && it.s.shape === 'contour') warnings.push({ t: 'info', m: `« ${it.name} » : décalage négatif, la coupe passe ${fmt(-it.s.offset)} mm à l'intérieur du dessin.` });
  }
  for (const c of cuts) if (!NAME_RE.test(c.name)) warnings.push({ t: 'err', m: `Nom « ${c.name} » non reconnu par RasterLink.` });
  const dpiEff = d.wPx / (d.wMm / 25.4);
  if (dpiEff < 120) warnings.push({ t: 'warn', m: `Résolution faible : ${Math.round(dpiEff)} dpi à la taille réelle. L'impression risque d'être floue.` });
  const nodes = all.reduce((s, l) => s + l.length, 0), len = all.reduce((s, l) => s + perim(l), 0);
  if (all.length && !warnings.some(w => w.t === 'err' || w.t === 'warn')) warnings.unshift({ t: 'ok', m: 'Prêt pour RasterLink7 : aucune anomalie.' });
  S.result = { cuts, pb, warnings, stats: { pieces: all.length, nodes, len, names: [...new Set(cuts.map(c => c.name))], pw, ph }, pxmm };
}
function fieldsOverlap(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (a.F[(y - a.y) * a.w + x - a.x] < 0 && b.F[(y - b.y) * b.w + x - b.x] < 0) return true;
  return false;
}
function buildBleed(fields, pxmm, procS, bleedMm) {
  // grille = union des champs, à la résolution de calcul
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of fields.values()) { x0 = Math.min(x0, f.x); y0 = Math.min(y0, f.y); x1 = Math.max(x1, f.x + f.w); y1 = Math.max(y1, f.y + f.h); }
  const w = x1 - x0, h = y1 - y0; if (w * h > 40e6) return;
  const allow = new Uint8Array(w * h), lim = bleedMm * pxmm;
  for (const f of fields.values()) for (let y = 0; y < f.h; y++) { const o = (f.y - y0 + y) * w + (f.x - x0); for (let x = 0; x < f.w; x++) if (f.F[y * f.w + x] <= lim) allow[o + x] = 1; }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(S.doc.composite, -x0, -y0, S.doc.wPx * procS, S.doc.hPx * procS);
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
  S.bleedCanvas = c; S.bleedRect = [x0 / pxmm, y0 / pxmm, w / pxmm, h / pxmm]; // mm
}

/* ───────────── Rapport ───────────── */
function renderReport() {
  const r = S.result; if (!r) return;
  const st = r.stats || {};
  $('stats').innerHTML = r.error ? '' : `<b>${st.pieces}</b> tracé(s) de coupe · <b>${(st.len / 1000).toFixed(2)} m</b> de coupe · ${st.nodes} points<br>Page : <b>${fmt(st.pw)} × ${fmt(st.ph)} mm</b><br>Noms : ${st.names.map(n => `<code style="color:${colorOf(n)}">${n}</code>`).join(' ') || '—'}`;
  $('warnings').innerHTML = r.warnings.map(w => `<li class="${w.t}">${esc(w.m)}</li>`).join('');
  const can = !r.error && st.pieces > 0;
  $('btnExport').disabled = !can; $('btnExportCut').disabled = !can;
}

/* ───────────── Aperçu ───────────── */
const view = $('view');
function draw() {
  const dpr = window.devicePixelRatio || 1;
  const W = view.clientWidth, H = view.clientHeight;
  if (view.width !== W * dpr || view.height !== H * dpr) { view.width = W * dpr; view.height = H * dpr; }
  const x = view.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
  if (!S.doc) return;
  const d = S.doc, r = S.result, pb = r && r.pb ? r.pb : [0, 0, d.wMm, d.hMm];
  if (!S.view.fitted) fit(pb);
  const { scale: k, ox, oy } = S.view;
  const T = (mx, my) => [ox + mx * k, oy + my * k];
  // page
  const [p0x, p0y] = T(pb[0], pb[1]);
  x.fillStyle = '#fff'; x.fillRect(p0x, p0y, (pb[2] - pb[0]) * k, (pb[3] - pb[1]) * k);
  if ($('vPrint').checked) {
    x.imageSmoothingQuality = 'high';
    if (S.bleedCanvas) { const [bx, by, bw, bh] = S.bleedRect; const [tx, ty] = T(bx, by); x.drawImage(S.bleedCanvas, tx, ty, bw * k, bh * k); }
    const [tx, ty] = T(0, 0); x.drawImage(S.preview, tx, ty, d.wMm * k, d.hMm * k);
  }
  x.strokeStyle = '#888'; x.setLineDash([4, 4]); x.lineWidth = 1;
  const [dx0, dy0] = T(0, 0); x.strokeRect(dx0, dy0, d.wMm * k, d.hMm * k); x.setLineDash([]);
  if (r && r.cuts && $('vCut').checked) {
    for (const c of r.cuts) {
      const selected = c.items.includes(S.sel);
      x.strokeStyle = colorOf(c.name); x.lineWidth = selected ? 2.4 : 1.5;
      x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 2;
      for (const l of c.loops) {
        x.beginPath(); l.forEach(([mx, my], i) => { const [px, py] = T(mx, my); i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.closePath(); x.stroke();
      }
      x.shadowBlur = 0;
      if ($('vNodes').checked) { x.fillStyle = colorOf(c.name); for (const l of c.loops) for (const [mx, my] of l) { const [px, py] = T(mx, my); x.fillRect(px - 1.5, py - 1.5, 3, 3); } }
    }
  }
  // règle d'échelle
  x.fillStyle = '#ddd'; x.font = '11px system-ui';
  const step = niceStep(80 / k); const bar = step * k;
  x.fillRect(12, H - 18, bar, 3); x.fillText(`${step} mm`, 12, H - 24);
}
function niceStep(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p; return 10 * p; }
function fit(pb) {
  const W = view.clientWidth, H = view.clientHeight, pw = pb[2] - pb[0], ph = pb[3] - pb[1];
  const k = Math.min((W - 40) / pw, (H - 40) / ph);
  S.view = { scale: k, ox: (W - pw * k) / 2 - pb[0] * k, oy: (H - ph * k) / 2 - pb[1] * k, fitted: true };
}
let drag = null;
view.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, ox: S.view.ox, oy: S.view.oy }; view.classList.add('panning'); });
window.addEventListener('mouseup', () => { drag = null; view.classList.remove('panning'); });
window.addEventListener('mousemove', e => {
  if (drag) { S.view.ox = drag.ox + e.clientX - drag.x; S.view.oy = drag.oy + e.clientY - drag.y; draw(); }
  if (S.doc && e.target === view) { const r = view.getBoundingClientRect(); const mx = (e.clientX - r.left - S.view.ox) / S.view.scale, my = (e.clientY - r.top - S.view.oy) / S.view.scale; $('cursorPos').textContent = `x ${fmt(mx)} · y ${fmt(my)} mm`; }
});
view.addEventListener('wheel', e => {
  e.preventDefault(); const r = view.getBoundingClientRect(); const cx = e.clientX - r.left, cy = e.clientY - r.top;
  const f = Math.exp(-e.deltaY * 0.0015); const k2 = Math.min(200, Math.max(0.02, S.view.scale * f)); const ff = k2 / S.view.scale;
  S.view.ox = cx - (cx - S.view.ox) * ff; S.view.oy = cy - (cy - S.view.oy) * ff; S.view.scale = k2; draw();
}, { passive: false });
view.addEventListener('dblclick', () => { S.view.fitted = false; draw(); });
window.addEventListener('resize', () => draw());

/* ───────────── Export PDF ───────────── */
async function exportPdf(withPrint) {
  const r = S.result, d = S.doc, g = G();
  if (!r || !r.cuts.length) return;
  setBusy(true); await new Promise(res => setTimeout(res, 30));
  try {
    const bytes = await buildPdf(withPrint, r, d, g);
    const base = d.name.replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_');
    download(bytes, `${base}_${withPrint ? 'print-cut' : 'cut'}_RasterLink.pdf`);
  } catch (e) { console.error(e); alert('Erreur export : ' + e.message); }
  setBusy(false);
}
async function buildPdf(withPrint, r, d, g) {
  const { PDFDocument, PDFName, PDFString } = PDFLib;
  const pb = r.pb; const K = 72 / 25.4;
  const pwMm = pb[2] - pb[0], phMm = pb[3] - pb[1];
  const pdf = await PDFDocument.create();
  pdf.setTitle(d.name + ' — Print & Cut'); pdf.setCreator('CutLink (Mimaki CJV150 / RasterLink7)'); pdf.setProducer('CutLink');
  const page = pdf.addPage([pwMm * K, phMm * K]);
  const C = pdf.context;
  const res = { ColorSpace: {}, ExtGState: { GSop: C.obj({ Type: 'ExtGState', OP: true, op: true, OPM: 1 }) }, Properties: {}, XObject: {} };
  const ocgs = []; let content = '';
  const names = [...new Set(r.cuts.map(c => c.name))];
  // calques de coupe (au-dessus)
  const cutOcg = {};
  names.forEach((n, i) => {
    const ref = C.register(C.obj({ Type: 'OCG', Name: PDFString.of(n) }));
    cutOcg[n] = 'OC' + (i + 1); res.Properties['OC' + (i + 1)] = ref; ocgs.push(ref);
    res.ColorSpace['CS' + (i + 1)] = C.obj(['Separation', n, 'DeviceCMYK', C.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: cmykOf(n), N: 1 })]);
  });
  if (withPrint) {
    const ocgP = C.register(C.obj({ Type: 'OCG', Name: PDFString.of('Impression') }));
    res.Properties.OC0 = ocgP; ocgs.push(ocgP);
    const img = await rasterForPdf(r, d, g);
    const emb = g.img === 'png' ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes);
    res.XObject.Im0 = emb.ref;
    content += `/OC /OC0 BDC\nq ${n3(pwMm * K)} 0 0 ${n3(phMm * K)} 0 0 cm /Im0 Do Q\nEMC\n`;
  }
  const X = (mx) => n3((mx - pb[0]) * K), Y = (my) => n3((pb[3] - my) * K);
  names.forEach((n, i) => {
    content += `/OC /${cutOcg[n]} BDC\nq /GSop gs /CS${i + 1} CS 1 SCN ${n3(g.stroke)} w 1 J 1 j\n`;
    for (const c of r.cuts) if (c.name === n) for (const l of c.loops) {
      content += l.map(([mx, my], j) => `${X(mx)} ${Y(my)} ${j ? 'l' : 'm'}`).join('\n') + '\nh S\n';
    }
    content += 'Q\nEMC\n';
  });
  page.node.set(PDFName.of('Resources'), C.obj(res));
  page.node.set(PDFName.of('Contents'), C.register(C.flateStream(content)));
  const order = ocgs.slice(); // ordre d'affichage : coupes d'abord (dessus)
  pdf.catalog.set(PDFName.of('OCProperties'), C.obj({ OCGs: ocgs, D: { Name: PDFString.of('Calques'), Order: order, ON: ocgs, OFF: [] } }));
  return await pdf.save({ useObjectStreams: false });
}
async function rasterForPdf(r, d, g) {
  const pb = r.pb; const native = d.wPx / d.wMm; // px/mm
  const pw = pb[2] - pb[0], ph = pb[3] - pb[1];
  let ppm = native;
  ppm = Math.min(ppm, 16000 / pw, 16000 / ph, Math.sqrt(120e6 / (pw * ph)));
  const w = Math.round(pw * ppm), h = Math.round(ph * ppm);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.imageSmoothingQuality = 'high';
  if (S.bleedCanvas) { const [bx, by, bw, bh] = S.bleedRect; x.drawImage(S.bleedCanvas, (bx - pb[0]) * ppm, (by - pb[1]) * ppm, bw * ppm, bh * ppm); }
  x.drawImage(d.composite, -pb[0] * ppm, -pb[1] * ppm, d.wMm * ppm, d.hMm * ppm);
  const blob = await new Promise(res => c.toBlob(res, g.img === 'png' ? 'image/png' : 'image/jpeg', 0.95));
  if (!blob) throw new Error('image trop grande pour le navigateur');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
}
const n3 = (v) => (Math.round(v * 1000) / 1000).toString();
function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ───────────── Divers ───────────── */
function setBusy(b) { $('busy').classList.toggle('hidden', !b); }
function fmt(v) { return (Math.round(v * 10) / 10).toLocaleString('fr-FR'); }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

$('fileInput').addEventListener('change', e => { const f = e.target.files[0]; if (f) loadFile(f); e.target.value = ''; });
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); document.body.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement) document.body.classList.remove('dragging'); }));
document.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
$('btnHelp').onclick = () => $('helpModal').classList.remove('hidden');
$('helpModal').addEventListener('click', e => { if (e.target.dataset.close !== undefined || e.target.id === 'helpModal') $('helpModal').classList.add('hidden'); });
$('btnDemo').onclick = async () => { setBusy(true); const r = await fetch('demo.psd'); const b = await r.blob(); await loadFile(new File([b], 'exemple-stickers.psd')); };
$('btnExport').onclick = () => exportPdf(true);
$('btnExportCut').onclick = () => exportPdf(false);
['gPrec', 'gMerge', 'gBleed', 'gFrameM', 'gFrameName', 'gStroke', 'gImg'].forEach(id => $(id).addEventListener('change', () => schedule()));
$('gFrame').addEventListener('change', () => { $('frameOpts').classList.toggle('hidden', !$('gFrame').checked); schedule(); });
['vPrint', 'vCut', 'vNodes'].forEach(id => $(id).addEventListener('change', draw));
$('zFit').onclick = () => { S.view.fitted = false; draw(); };
$('z100').onclick = () => { // 1:1 approximatif (96 px/pouce)
  const W = view.clientWidth, H = view.clientHeight, k = 96 / 25.4; const c = [(W / 2 - S.view.ox) / S.view.scale, (H / 2 - S.view.oy) / S.view.scale];
  S.view.scale = k; S.view.ox = W / 2 - c[0] * k; S.view.oy = H / 2 - c[1] * k; draw();
};
function setSize(wMm, hMm) {
  const d = S.doc; if (!d) return;
  d.wMm = wMm; d.hMm = hMm; $('docW').value = wMm.toFixed(1); $('docH').value = hMm.toFixed(1);
  S.items.forEach(i => i.cache = {}); S.view.fitted = false; updateDocInfo(); schedule();
}
$('docW').addEventListener('change', () => { const w = +$('docW').value; if (w > 0) setSize(w, w * S.doc.hPx / S.doc.wPx); });
$('docH').addEventListener('change', () => { const h = +$('docH').value; if (h > 0) setSize(h * S.doc.wPx / S.doc.hPx, h); });
$('allOn').onclick = () => { S.items.forEach(i => { if (i.leaves.length && !i.tags.includes('fond')) i.s.cut = true; }); renderLayers(); schedule(); };
$('allOff').onclick = () => { S.items.forEach(i => i.s.cut = false); renderLayers(); schedule(); };
fillFrameNames();
window.CutLink = { S, buildPdf, G }; // pour les tests
if (/[?&]demo/.test(location.search)) $('btnDemo').click();
draw();

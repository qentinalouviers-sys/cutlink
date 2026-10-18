'use strict';
/* CutLink — application : état, planche (imbrication sur la laize), interface, rendu, export. */
import { $, MAX_PRINT_MM, PRESET_NAMES, NAME_RE, M, fmt, esc, clamp, colorOf, sleep, toast, store, bboxOf, perim, pointInPoly } from './util.js';
import { computeArt } from './engine.js';
import { importFile, psdItem, LETTERING, STICKER } from './importers.js';
import { buildPdf } from './pdfout.js';
import { extractCuts } from './pdfcut.js';
import { openStudio } from './studio.js';

/* ───────────── Icônes (style SF Symbols) ───────────── */
const ICONS = {
  cursor: '<path d="M6 3.5 18.5 11l-5.6 1.4L10 18.5z"/>',
  hand: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V5.5a1.5 1.5 0 0 1 3 0V14c0 3.9-2.6 7-6.2 7-2.6 0-4.3-1.4-5.6-3.6L3.4 13a1.5 1.5 0 0 1 2.5-1.6L8 14"/>',
  minus: '<path d="M6 12h12"/>', plus: '<path d="M12 6v12M6 12h12"/>',
  rotate: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4v4.5H15"/>',
  dup: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.2"/><path d="M15.5 8.5V6.7A2.2 2.2 0 0 0 13.3 4.5H6.7A2.2 2.2 0 0 0 4.5 6.7v6.6a2.2 2.2 0 0 0 2.2 2.2h1.8"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6"/><path d="M12 16.8v.2"/>',
  'plus-square': '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/>',
  share: '<path d="M12 14.5V4M8.5 7.5 12 4l3.5 3.5"/><path d="M7.5 10.5H7a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.5a2 2 0 0 0-2-2h-.5"/>',
  trash: '<path d="M5 7h14M10 11v6M14 11v6M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7M9.5 7V4.5h5V7"/>',
  x: '<path d="M7 7l10 10M17 7 7 17"/>',
  contour: '<path d="M8 4.5c2.6 0 3.6 2.6 6.2 2.6s4.8 1.7 4.8 4.4-1.7 3.4-1.7 5.2-2 2.8-4.6 2.8-3.4-1.9-5.4-1.9S4.5 15.2 4.5 12.4 5.4 4.5 8 4.5z"/>',
  rect: '<rect x="4.5" y="6.5" width="15" height="11"/>', rrect: '<rect x="4.5" y="6.5" width="15" height="11" rx="3.5"/>',
  circle: '<circle cx="12" cy="12" r="7.5"/>', ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="5.5"/>',
  pen: '<path d="M12 20.5 20 12.5l-2.5-2.5L9.5 18z"/><path d="M17.5 10 16 4 4 3.5l.5 12 6 1.5"/><path d="M4 3.5l6.3 6.3"/><circle cx="11.3" cy="10.8" r="1.6"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
};
function icons(root = document) {
  root.querySelectorAll('i[data-i]').forEach((el) => { if (!el.firstChild) el.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[el.dataset.i] || ''}</svg>`; });
}
/** vignette réutilisable : une même <canvas> ne peut pas être à deux endroits du DOM */
const thumb = (c) => { const img = new Image(); img.className = 'th'; img.alt = ''; img.src = c._url || (c._url = c.toDataURL()); return img; };
const ico = (n) => `<i data-i="${n}"><svg viewBox="0 0 24 24">${ICONS[n]}</svg></i>`;

/* ───────────── État ───────────── */
const S = {
  arts: [], places: [],
  selArt: null, selItem: null, selPlaces: new Set(),
  view: { scale: 1, ox: 0, oy: 0, fitted: false },
  tool: 'select', tab: 'cut', space: false, cursor: null, hover: null,
  sheet: { roll: 810, reserve: 15, gap: 4, rot: true, ...store.get('sheet', {}), auto: true },
  out: { prec: 4000, merge: true, bleed: 0, stroke: 0.25, img: 'jpeg', speed: 20, price: 0, frame: false, frameM: 5, frameName: 'CutContourFull', ...store.get('out', {}) },
  customNames: store.get('names', []).filter((n) => NAME_RE.test(n)),
  job: null,
};
let PLACE_ID = 0;
const printW = () => Math.min(MAX_PRINT_MM, Math.max(50, S.sheet.roll - 10));
const artOf = (p) => S.arts.find((a) => a.id === p.artId);
const curArt = () => S.arts.find((a) => a.id === S.selArt) || null;
const curItem = () => { const a = curArt(); return a ? a.items.find((i) => i.id === S.selItem) || null : null; };
const allNames = () => [...PRESET_NAMES, ...S.customNames];
const save = () => { store.set('sheet', { ...S.sheet, auto: undefined }); store.set('out', S.out); store.set('names', S.customNames); };

/* ───────────── Géométrie de planche ───────────── */
const fp = (art) => (art.result ? art.result.pb : [0, 0, art.wMm, art.hMm]);
function dims(p, art) { const b = fp(art), w = b[2] - b[0], h = b[3] - b[1]; return p.rot % 180 ? [h, w] : [w, h]; }
function rectOf(p, art) { const [w, h] = dims(p, art); return [p.x, p.y, p.x + w, p.y + h]; }
/** matrice repère du visuel (mm) → planche (mm), rotation horaire par pas de 90° */
function placeM(p, art) {
  const [x0, y0, x1, y1] = fp(art), fw = x1 - x0, fh = y1 - y0;
  switch (p.rot) {
    case 90: return [0, 1, -1, 0, fh + y0 + p.x, -x0 + p.y];
    case 180: return [-1, 0, 0, -1, fw + x0 + p.x, fh + y0 + p.y];
    case 270: return [0, -1, 1, 0, -y0 + p.x, fw + x0 + p.y];
    default: return [1, 0, 0, 1, p.x - x0, p.y - y0];
  }
}

/** Imbrication en étagères sur la laize utile, du plus haut au plus bas, rotation 90° optionnelle. */
function arrange() {
  const R = S.sheet.reserve + (S.out.frame ? S.out.frameM + 0.5 : 0), gap = S.sheet.gap, xEnd = printW() - R, usable = xEnd - R, eps = 1e-6;
  const list = S.places.map((p) => {
    const art = artOf(p); const b = fp(art), w = b[2] - b[0], h = b[3] - b[1];
    const opts = S.sheet.rot ? [{ rot: 0, w, h }, { rot: 90, w: h, h: w }]
      : [{ rot: p.rot, w: p.rot % 180 ? h : w, h: p.rot % 180 ? w : h }];
    const fit = opts.filter((o) => o.w <= usable + eps);
    const pref = (fit.length ? fit : opts).reduce((a, o) => (o.h < a.h - eps ? o : a));
    return { p, opts, pref };
  });
  list.sort((a, b) => b.pref.h - a.pref.h || a.p.artId - b.p.artId);
  let x = R, y = R, shelf = 0;
  for (const it of list) {
    let c = null;
    if (x > R) {
      if (x + it.pref.w <= xEnd + eps) c = it.pref;
      else c = it.opts.find((o) => o !== it.pref && x + o.w <= xEnd + eps && o.h <= shelf + eps) || null;
      if (!c) { y += shelf + gap; x = R; shelf = 0; }
    }
    c = c || it.pref;
    it.p.rot = c.rot; it.p.x = x; it.p.y = y;
    x += c.w + gap; shelf = Math.max(shelf, c.h);
  }
}
function addPlace(art, near) {
  const p = { id: ++PLACE_ID, artId: art.id, x: S.sheet.reserve, y: S.sheet.reserve, rot: near ? near.rot : 0 };
  if (!S.sheet.auto) {
    const [w] = dims(p, art);
    if (near) {
      const r = rectOf(near, art);
      if (r[2] + S.sheet.gap + w <= printW() - S.sheet.reserve) { p.x = r[2] + S.sheet.gap; p.y = r[1]; } else { p.x = S.sheet.reserve; p.y = jobBottom() + S.sheet.gap; }
    } else if (S.places.length) p.y = jobBottom() + S.sheet.gap;
  }
  S.places.push(p);
  return p;
}
function jobBottom() {
  let b = S.sheet.reserve;
  for (const p of S.places) { const a = artOf(p); if (a) b = Math.max(b, rectOf(p, a)[3]); }
  return b;
}

/* ───────────── Calcul ───────────── */
let timer = null, running = false, again = false;
function schedule(ms = 200) { clearTimeout(timer); timer = setTimeout(run, ms); }
async function run() {
  if (running) { again = true; return; }
  running = true; busy(true);
  await sleep(16);
  try {
    for (const a of S.arts) {
      if (!a.dirty && a.result) continue;
      try { computeArt(a, S.out); } catch (e) {
        console.error(e);
        a.result = { cuts: [], pb: [0, 0, a.wMm, a.hMm], warnings: [{ t: 'err', m: e.message }], pieces: 0 }; a.dirty = false;
      }
      a.result.len = a.result.cuts.reduce((s, c) => s + c.loops.reduce((t, l) => t + perim(l), 0), 0);
      a.result.nodes = a.result.cuts.reduce((s, c) => s + c.loops.reduce((t, l) => t + l.length, 0), 0);
    }
    if (S.sheet.auto) arrange();
    computeJob();
  } finally { running = false; busy(false); }
  renderArts(); renderLayers(); renderReport(); draw();
  if (again) { again = false; schedule(0); }
}
function markAll() { for (const a of S.arts) a.dirty = true; }

function computeJob() {
  const places = S.places.map((p) => ({ p, art: artOf(p) })).filter((o) => o.art && o.art.result);
  const warnings = [], R = S.sheet.reserve, pw = printW();
  if (!places.length) {
    S.job = { places: [], warnings: S.arts.length ? [{ t: 'info', m: 'Aucun visuel sur la planche. Réglez le nombre d\'exemplaires dans l\'onglet Coupe.' }] : [], stats: null };
    return;
  }
  const rects = places.map((o) => rectOf(o.p, o.art));
  let bbox = bboxOf([rects.flatMap((r) => [[r[0], r[1]], [r[2], r[3]]])]);
  let frame = null;
  if (S.out.frame) {
    const m = S.out.frameM, f = [bbox[0] - m, bbox[1] - m, bbox[2] + m, bbox[3] + m];
    frame = { name: S.out.frameName, loop: [[f[0], f[1]], [f[2], f[1]], [f[2], f[3]], [f[0], f[3]]] };
    bbox = [f[0] - 0.5, f[1] - 0.5, f[2] + 0.5, f[3] + 0.5];
  }
  const jobW = bbox[2] - bbox[0], jobH = bbox[3] - bbox[1];
  let pieces = 0, len = 0, nodes = 0; const names = new Set();
  for (const o of places) { pieces += o.art.result.pieces; len += o.art.result.len; nodes += o.art.result.nodes; o.art.result.cuts.forEach((c) => c.loops.length && names.add(c.name)); }
  if (frame) { pieces++; len += 2 * (jobW + jobH - 2); names.add(frame.name); }

  if (!pieces) warnings.push({ t: 'err', m: 'Aucune ligne de coupe. Activez au moins un calque.' });
  const big = places.map((o) => o.art).filter((a, i, l) => l.indexOf(a) === i).sort((a, b) => b.wMm - a.wMm)[0];
  const fitW = big ? Math.floor((pw - 2 * R) * big.wMm / (fp(big)[2] - fp(big)[0])) : 0;
  if (jobW > pw) warnings.push({ t: 'err', m: `Travail de ${fmt(jobW)} mm de large : la CJV150-75 imprime et coupe ${pw} mm au maximum sur ce rouleau.`, fix: [
    ...(S.sheet.rot ? [] : [{ id: 'rotOn', label: 'Autoriser la rotation' }]),
    { id: 'arrange', label: 'Réorganiser' },
    ...(big && fitW > 10 ? [{ id: 'fitWidth', label: `Réduire « ${big.name.slice(0, 18)} » à ${fitW} mm`, art: big.id, w: fitW }] : []),
  ] });
  else if (jobW > pw - 2 * R) warnings.push({ t: 'warn', m: `Travail de ${fmt(jobW)} mm : il empiète sur la réserve des repères (${R} mm de chaque côté, zone utile ${fmt(pw - 2 * R)} mm).`, fix: [
    { id: 'arrange', label: 'Réorganiser' },
    ...(R > 10 ? [{ id: 'reserve10', label: 'Réserve à 10 mm' }] : []),
  ] });
  const out = rects.filter((r) => r[0] < -0.01 || r[2] > pw + 0.01).length;
  const inRes = bbox[0] < R - 0.01 || bbox[2] > pw - R + 0.01 || bbox[1] < R - 0.01;
  if (out) warnings.push({ t: 'err', m: `${out} exemplaire(s) hors de la laize imprimable.`, fix: [{ id: 'arrange', label: 'Réorganiser' }] });
  else if (inRes && jobW <= pw - 2 * R) warnings.push({ t: 'warn', m: `Le travail${frame ? ' (cadre compris)' : ''} déborde dans la zone des repères.`, fix: [{ id: 'arrange', label: 'Réorganiser' }] });
  let ov = 0;
  if (rects.length <= 600) for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    if (a[0] < b[2] - 0.05 && b[0] < a[2] - 0.05 && a[1] < b[3] - 0.05 && b[1] < a[3] - 0.05) ov++;
  }
  if (ov) warnings.push({ t: 'err', m: `${ov} chevauchement(s) entre exemplaires : impression superposée et double passage de lame.`, fix: [{ id: 'arrange', label: 'Réorganiser' }] });
  if (jobH > 1000) warnings.push({ t: 'info', m: `Planche de ${fmt(jobH / 1000, 2)} m : l'écart entre repères ne doit pas dépasser 1000 mm (manuel CJV150). Vérifiez que RasterLink ajoute des repères intermédiaires, sinon scindez la planche.`, fix: S.sheet.rot ? [] : [{ id: 'rotOn', label: 'Autoriser la rotation' }] });
  if (frame && !NAME_RE.test(frame.name)) warnings.push({ t: 'err', m: `Nom du cadre « ${frame.name} » non reconnu par RasterLink.` });
  const multi = S.arts.length > 1;
  for (const art of S.arts) {
    const n = S.places.filter((p) => p.artId === art.id).length;
    if (!n) { warnings.push({ t: 'info', m: `« ${art.name} » n'est pas sur la planche (0 exemplaire).`, fix: [{ id: 'addCopy', label: 'Ajouter 1 exemplaire', art: art.id }] }); continue; }
    for (const w of art.result ? art.result.warnings : []) warnings.push({ ...w, m: multi ? `${art.name} — ${w.m}` : w.m });
    if (art.fillCuts) warnings.push({ t: 'info', m: `${art.name} — ${art.fillCuts} forme(s) remplie(s) en CutContour ignorée(s) : RasterLink ne coupe que les contours (trait sans fond).` });
  }
  // conseil vitrine : lettrage sans fond perdu → liseré blanc
  const lettering = S.arts.some((a) => a.items.some((i) => i.s.cut && i.s.shape === 'contour' && !i.s.outerOnly && i.s.offset > 0));
  if (lettering && !S.out.bleed) warnings.push({ t: 'tip', m: 'Lettrage : une marge de coupe laisse un fin liseré blanc autour des lettres.', fix: [{ id: 'flush', label: 'Coupe au ras + fond perdu 1 mm' }] });
  const hasIssue = warnings.some((w) => w.t === 'err' || w.t === 'warn');
  if (pieces && !hasIssue) warnings.unshift({ t: 'ok', m: 'Prêt pour RasterLink7 : aucune anomalie.' });
  const mediaLen = jobH + 2 * R;
  const m2 = mediaLen / 1000 * S.sheet.roll / 1000;
  S.job = {
    bbox, frame, warnings,
    places: places.map((o) => ({ art: o.art, M: placeM(o.p, o.art), p: o.p })),
    stats: { pieces, len, nodes, names: [...names], jobW, jobH, copies: places.length, mediaLen, m2, cost: m2 * S.out.price, time: len / (S.out.speed * 10) * 1.3 },
  };
}

/* ───────────── Import ───────────── */
async function importFiles(files) {
  files = [...files]; if (!files.length) return;
  busy(true);
  let added = [];
  for (const f of files) {
    try {
      const arts = await importFile(f);
      for (const a of arts) { S.arts.push(a); addPlace(a); added.push(a); }
    } catch (e) { console.error(e); toast(`« ${f.name} » : ${e.message}`, 'err'); }
  }
  busy(false);
  if (!added.length) return;
  selectArt(added[0].id);
  const notes = added.map((a) => a.pdfNote).filter(Boolean);
  toast(notes.length ? notes.join(' · ') : `${added.length} visuel(s) importé(s)`);
  S.view.fitted = false;
  $('empty').classList.add('hidden'); $('hud').classList.remove('hidden');
  schedule(0);
}
function removeArt(id) {
  S.arts = S.arts.filter((a) => a.id !== id);
  S.places = S.places.filter((p) => p.artId !== id);
  S.selPlaces = new Set([...S.selPlaces].filter((pid) => S.places.some((p) => p.id === pid)));
  if (S.selArt === id) { S.selArt = S.arts[0] ? S.arts[0].id : null; S.selItem = null; autoItem(); }
  if (!S.arts.length) { $('empty').classList.remove('hidden'); $('hud').classList.add('hidden'); }
  renderInspector(); schedule(0);
}

/* ───────────── Sélection ───────────── */
function autoItem() { const a = curArt(); if (a && !curItem()) S.selItem = (a.items.find((i) => i.s.cut) || a.items[0] || {}).id || null; }
function selectArt(id, itemId) {
  if (S.selArt !== id) { S.selArt = id; S.selItem = null; }
  if (itemId) S.selItem = itemId;
  autoItem(); renderArts(); renderLayers(); renderInspector(); updateSelUi(); draw();
}
function updateSelUi() {
  const n = S.selPlaces.size;
  ['bRotate', 'bDup'].forEach((id) => { $(id).disabled = !n; });
  $('selActions').hidden = !n;
  if (n) $('selInfo').textContent = n === 1 ? (() => { const p = S.places.find((q) => S.selPlaces.has(q.id)); const a = artOf(p); const [w, h] = dims(p, a); return `${a.name} · ${fmt(w)} × ${fmt(h)} mm · ${p.rot}° · x ${fmt(p.x)} y ${fmt(p.y)}`; })() : `${n} exemplaires sélectionnés`;
}
const selected = () => S.places.filter((p) => S.selPlaces.has(p.id));
function manual() { if (S.sheet.auto) { S.sheet.auto = false; $('sAuto').checked = false; save(); toast('Disposition automatique désactivée : vous placez vous-même.'); } }
function rotateSel() {
  const sel = selected(); if (!sel.length) return;
  manual();
  for (const p of sel) {
    const a = artOf(p), [w0, h0] = dims(p, a), cx = p.x + w0 / 2, cy = p.y + h0 / 2;
    p.rot = (p.rot + 90) % 360; const [w, h] = dims(p, a);
    p.x = Math.round((cx - w / 2) * 2) / 2; p.y = Math.round((cy - h / 2) * 2) / 2;
  }
  afterMove();
}
function duplicateSel() {
  const sel = selected(); if (!sel.length) return;
  const fresh = sel.map((p) => addPlace(artOf(p), p));
  S.selPlaces = new Set(fresh.map((p) => p.id));
  renderInspector(); schedule(0);
}
function deleteSel() {
  if (!S.selPlaces.size) return;
  S.places = S.places.filter((p) => !S.selPlaces.has(p.id));
  S.selPlaces.clear(); updateSelUi(); renderInspector(); schedule(0);
}
function nudge(dx, dy) {
  const sel = selected(); if (!sel.length) return;
  manual(); for (const p of sel) { p.x += dx; p.y += dy; }
  afterMove();
}
function afterMove() { computeJob(); renderReport(); updateSelUi(); draw(); }
function setCopies(art, n) {
  n = clamp(Math.round(n), 0, 500);
  const mine = S.places.filter((p) => p.artId === art.id);
  if (n > mine.length) for (let i = mine.length; i < n; i++) addPlace(art, mine.length ? S.places.filter((p) => p.artId === art.id).at(-1) : null);
  else { const drop = new Set(mine.slice(n).map((p) => p.id)); S.places = S.places.filter((p) => !drop.has(p.id)); drop.forEach((id) => S.selPlaces.delete(id)); }
  const el = $('copiesVal'); if (el) el.textContent = n;
  updateSelUi(); schedule(0);
}

/* ───────────── Barre latérale ───────────── */
function renderArts() {
  const ul = $('artList'); ul.innerHTML = '';
  $('artEmpty').hidden = !!S.arts.length;
  for (const a of S.arts) {
    const n = S.places.filter((p) => p.artId === a.id).length;
    const li = document.createElement('li');
    li.className = 'row art' + (a.id === S.selArt ? ' sel' : '') + (n ? '' : ' off');
    li.innerHTML = `<span class="th"></span><div class="meta"><b title="${esc(a.name)}">${esc(a.name)}</b><small>${fmt(a.wMm)} × ${fmt(a.hMm)} mm · ${a.source}</small></div><span class="count" title="Exemplaires sur la planche">×${n}</span>`;
    li.querySelector('.th').replaceWith(thumb(a.thumb));
    li.onclick = () => { S.selPlaces = new Set(S.places.filter((p) => p.artId === a.id).map((p) => p.id)); selectArt(a.id); };
    ul.appendChild(li);
  }
  $('docTitle').textContent = S.arts.length ? (S.arts.length === 1 ? S.arts[0].name : `${S.arts.length} visuels`) + (S.job && S.job.stats ? ` · ${S.job.stats.copies} ex. · ${fmt(S.job.stats.jobW)} × ${fmt(S.job.stats.jobH)} mm` : '') : 'Print & Cut · CJV150-75';
}
const SHAPES = [['contour', 'Contour du dessin'], ['rect', 'Rectangle'], ['rrect', 'Rectangle arrondi'], ['circle', 'Cercle'], ['ellipse', 'Ellipse']];
const shapeLabel = (s) => ({ contour: 'Contour', rect: 'Rectangle', rrect: 'Rect. arrondi', circle: 'Cercle', ellipse: 'Ellipse', vector: 'Tracé du fichier' }[s]);
function renderLayers() {
  const a = curArt(); const ul = $('layerList');
  $('layerSection').hidden = !a;
  if (!a) return;
  $('layerHead').textContent = `Calques — ${a.name}`;
  ul.innerHTML = '';
  for (const it of a.items) {
    const li = document.createElement('li');
    li.className = 'row' + (it.id === S.selItem ? ' sel' : '') + (it.s.cut ? '' : ' off');
    const st = it.stat ? ` · ${it.stat.pieces} pièce(s)` : '';
    const sum = it.s.cut ? `${it.vector ? 'Tracé du fichier' : shapeLabel(it.s.shape) + ' · ' + fmt(it.s.offset) + ' mm'} · ${it.s.name}${st}` : 'Non découpé';
    li.innerHTML = `<span class="dot" style="background:${it.s.cut ? colorOf(it.s.name) : 'var(--txt-3)'}"></span><span class="th"></span>
      <div class="meta"><b>${esc(it.name)}${it.tags.map((t) => `<span class="tag">${t}</span>`).join('')}</b><small>${esc(sum)}</small></div>
      <label class="switch" title="Découper ce calque"><input type="checkbox" ${it.s.cut ? 'checked' : ''} ${it.leaves.length || it.vector ? '' : 'disabled'}><i></i></label>`;
    li.querySelector('.th').replaceWith(thumb(it.thumb));
    li.onclick = (e) => { if (e.target.closest('.switch')) return; S.selItem = it.id; if (S.tab !== 'cut') setTab('cut'); renderLayers(); renderInspector(); draw(); };
    li.querySelector('input').onchange = (e) => { it.s.cut = e.target.checked; a.dirty = true; S.selItem = it.id; renderInspector(); schedule(); };
    ul.appendChild(li);
  }
}

/* ───────────── Inspecteur : Coupe ───────────── */
function numField(label, k, v, step, unit, min, max) {
  return `<div class="field"><label class="scrub" data-for="f_${k}" data-step="${step}">${label}</label><div class="inp"><input type="number" id="f_${k}" data-k="${k}" value="${v}" step="${step}" ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''}><em>${unit}</em></div></div>`;
}
function nameSelect(cur, k = 'name') {
  const opts = allNames().includes(cur) ? allNames() : [...allNames(), cur];
  return `<select data-k="${k}" class="cutname">${opts.map((n) => `<option ${n === cur ? 'selected' : ''}>${n}</option>`).join('')}<option value="__new">Nouveau nom…</option></select>`;
}
function renderInspector() {
  const a = curArt(), it = curItem(), body = $('cutBody');
  $('cutEmpty').hidden = !!a; body.hidden = !a;
  if (!a) { body.innerHTML = ''; return; }
  const n = S.places.filter((p) => p.artId === a.id).length;
  const dpi = a.wPx / (a.wMm / 25.4);
  let h = `<div class="insp-head"><span class="th"></span><div class="meta"><b title="${esc(a.name)}">${esc(a.name)}</b><small>${a.source} · ${a.wPx} × ${a.hPx} px · ${Math.round(dpi)} dpi</small></div></div>
  <div class="group"><h4>Visuel</h4>
    ${numField('Largeur', 'artW', a.wMm.toFixed(1), 1, 'mm', 1)}
    ${numField('Hauteur', 'artH', a.hMm.toFixed(1), 1, 'mm', 1)}
    <div class="field"><label>Exemplaires</label><div class="stepper"><button id="cMinus" title="Un de moins">${ico('minus')}</button><span id="copiesVal">${n}</span><button id="cPlus" title="Un de plus">${ico('plus')}</button></div></div>
    <div class="field"><label></label><button class="link" id="fillRow">Remplir la laize</button><button class="link" id="artRemove" style="color:var(--red)">Retirer le visuel</button></div>
    ${a.pdfNote ? `<div class="note">${esc(a.pdfNote)}</div>` : ''}
  </div>`;
  if (it) {
    const s = it.s;
    h += `<div class="group"><h4>Calque · ${esc(it.name)}</h4>
      <div class="switch-row"><span>Découper ce calque</span><label class="switch"><input type="checkbox" data-k="cut" ${s.cut ? 'checked' : ''} ${it.leaves.length || it.vector ? '' : 'disabled'}><i></i></label></div>`;
    if (it.vector) {
      h += `<div class="vec-info">${ico('pen')}<div>Tracé vectoriel repris du fichier (${it.vector.loops.length} tracé${it.vector.loops.length > 1 ? 's' : ''}, nuance d'origine <code>${esc(it.vector.src)}</code>). Il est coupé tel quel, sans décalage.</div></div>
        <div class="field"><label>Nom de coupe</label>${nameSelect(s.name)}</div>`;
    } else {
      const isLet = s.shape === 'contour' && !s.outerOnly && !s.closing && s.offset <= 1;
      const isStk = s.shape === 'contour' && s.outerOnly && s.closing >= 1;
      h += `<div class="field" style="margin-bottom:4px"><label>Mode de découpe</label></div>
        <div class="seg wide" id="presetSeg">
          <button data-p="let" class="${isLet ? 'on' : ''}" title="Chaque lettre ou détail découpé séparément, trous compris (O, A, R…) — lettrage vitrine">Chaque lettre</button>
          <button data-p="stk" class="${isStk ? 'on' : ''}" title="Un seul contour qui englobe tout le dessin — sticker">Un seul sticker</button>
        </div>
        <div class="note">${isLet ? 'Lettrage : chaque lettre a sa propre coupe, intérieurs compris.' : isStk ? 'Sticker : un contour unique autour de l\'ensemble.' : 'Réglage personnalisé.'}</div>
        ${S.arts.length > 1 ? '<button class="link" id="presetAll">Appliquer ce mode à tous les visuels</button>' : ''}
        <div style="height:6px"></div>
        <div class="field" style="margin-bottom:4px"><label>Forme</label></div>
        <div class="seg icons" data-seg="shape">${SHAPES.map(([v, l]) => `<button data-v="${v}" class="${v === s.shape ? 'on' : ''}" title="${l}">${ico(v)}</button>`).join('')}</div>
        <div style="height:8px"></div>
        ${numField('Décalage', 'offset', s.offset, 0.5, 'mm')}
        <input type="range" data-k="offset" min="-5" max="15" step="0.5" value="${s.offset}" aria-label="Décalage">
        <div class="note">Positif = marge blanche autour du dessin. Négatif = coupe à l'intérieur.</div>
        ${s.shape === 'rrect' ? numField('Rayon des coins', 'radius', s.radius, 0.5, 'mm', 0) : ''}
        <div class="field"><label>Nom de coupe</label>${nameSelect(s.name)}</div>
        <details class="adv" ${S.advOpen ? 'open' : ''}><summary>Options avancées</summary>
          ${s.shape === 'contour' ? `
          ${numField('Rapprocher les éléments', 'closing', s.closing, 0.5, 'mm', 0)}
          <div class="field"><label>Lissage</label><div class="seg small" data-seg="smooth">${[[0, 'Aucun'], [2, 'Léger'], [5, 'Moyen'], [12, 'Fort']].map(([v, l]) => `<button data-v="${v}" class="${+v === +s.smooth ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          <div class="switch-row"><span>Ignorer les trous intérieurs</span><label class="switch"><input type="checkbox" data-k="outerOnly" ${s.outerOnly ? 'checked' : ''}><i></i></label></div>` : ''}
          ${numField('Seuil d\'opacité', 'thr', s.thr, 1, '%', 1, 99)}
          ${numField('Ignorer les éléments <', 'minArea', s.minArea, 1, 'mm²', 0)}
          ${it.kind === 'groupe' && it.node && it.node.children && it.node.children.length > 1 ? '<button class="btn wide" id="ungroup" style="margin-top:6px">Séparer le groupe en calques</button>' : ''}
        </details>`;
    }
    h += '</div>';
  }
  body.innerHTML = h;
  body.querySelector('.insp-head .th').replaceWith(thumb(a.thumb));
  bindScrub(body);
  const det = body.querySelector('details.adv'); if (det) det.ontoggle = () => { S.advOpen = det.open; };
  $('cMinus').onclick = () => setCopies(a, S.places.filter((p) => p.artId === a.id).length - 1);
  $('cPlus').onclick = () => setCopies(a, S.places.filter((p) => p.artId === a.id).length + 1);
  $('artRemove').onclick = () => removeArt(a.id);
  $('fillRow').onclick = () => fillRow(a);
  const ug = $('ungroup'); if (ug) ug.onclick = () => ungroup(a, it);
  const setSize = (w) => {
    if (!(w > 0)) return;
    a.wMm = w; a.hMm = w * a.hPx / a.wPx;
    a.items.forEach((i) => { i.cache = {}; }); a.dirty = true; schedule(350);
  };
  $('f_artW').oninput = (e) => { setSize(+e.target.value); $('f_artH').value = a.hMm.toFixed(1); };
  $('f_artH').oninput = (e) => { const hh = +e.target.value; if (hh > 0) { setSize(hh * a.wPx / a.hPx); $('f_artW').value = a.wMm.toFixed(1); } };
  if (!it) return;
  const PRESETS = { let: LETTERING, stk: STICKER };
  const applyPreset = (item, p) => { Object.assign(item.s, PRESETS[p]); item.cache = {}; };
  const ps = $('presetSeg');
  if (ps) ps.querySelectorAll('button').forEach((b) => b.onclick = () => {
    applyPreset(it, b.dataset.p); S.lastPreset = b.dataset.p;
    a.dirty = true; renderInspector(); renderLayers(); schedule();
  });
  const pa = $('presetAll');
  if (pa) pa.onclick = () => {
    const p = (it.s.outerOnly && it.s.closing >= 1) ? 'stk' : 'let';
    let n = 0;
    for (const art of S.arts) for (const item of art.items) if (!item.vector && item.leaves.length && item.s.cut) { applyPreset(item, p); art.dirty = true; n++; }
    toast(`Mode « ${p === 'let' ? 'Chaque lettre' : 'Un seul sticker'} » appliqué à ${n} calque(s)`);
    renderInspector(); renderLayers(); schedule();
  };
  body.querySelectorAll('[data-k]').forEach((el) => {
    if (el.dataset.k.startsWith('art')) return;
    const ev = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(ev, () => onSetting(a, it, el));
  });
  body.querySelectorAll('[data-seg]').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.onclick = () => {
    const k = seg.dataset.seg; it.s[k] = k === 'smooth' ? +b.dataset.v : b.dataset.v;
    a.dirty = true; renderInspector(); renderLayers(); schedule();
  }));
}
function onSetting(a, it, el) {
  const k = el.dataset.k;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (k === 'name' && v === '__new') {
    askName((n) => { it.s.name = n; a.dirty = true; renderInspector(); renderLayers(); schedule(); }, () => renderInspector());
    return;
  }
  if (['offset', 'thr', 'closing', 'minArea', 'radius'].includes(k)) {
    if (el.value === '' || Number.isNaN(+el.value)) return;
    v = +v;
    if (k === 'offset') body2('offset', v, el);
  }
  it.s[k] = v; a.dirty = true;
  if (k === 'cut') renderInspector();
  renderLayers(); schedule();
}
function body2(k, v, src) { // synchronise curseur ↔ champ du décalage
  $('cutBody').querySelectorAll(`[data-k="${k}"]`).forEach((el) => { if (el !== src) el.value = v; });
}
function ungroup(a, it) {
  const idx = a.items.indexOf(it);
  const kids = it.node.children.slice().reverse().map((n) => psdItem(a, n)).filter(Boolean);
  kids.forEach((k) => { k.s.offset = it.s.offset; k.s.name = it.s.name; });
  a.items.splice(idx, 1, ...kids);
  S.selItem = kids[0] ? kids[0].id : null; a.dirty = true;
  renderLayers(); renderInspector(); schedule();
}
function fillRow(a) {
  const b = fp(a), w = b[2] - b[0], h = b[3] - b[1], usable = printW() - 2 * S.sheet.reserve, g = S.sheet.gap;
  const per = (ww) => Math.max(1, Math.floor((usable + g) / (ww + g)));
  const n = S.sheet.rot ? Math.max(per(w), per(h)) : per(w);
  const cur = S.places.filter((p) => p.artId === a.id).length;
  setCopies(a, Math.ceil(Math.max(cur, 1) / n) * n);
  toast(`${n} exemplaire(s) par rangée sur ${fmt(usable)} mm de laize utile.`);
}

/* nom de coupe personnalisé (fenêtre modale) */
function askName(ok, cancel) {
  const m = $('sheetModal'), inp = $('newName'), err = $('newNameErr');
  m.classList.remove('hidden'); err.textContent = ''; inp.focus(); inp.select();
  const close = (fn) => { m.classList.add('hidden'); m.onclick = null; $('newNameOk').onclick = null; inp.onkeydown = null; fn && fn(); };
  const submit = () => {
    const n = inp.value.trim();
    if (!NAME_RE.test(n)) { err.textContent = 'Nom refusé : « CutContour » suivi de lettres et chiffres ASCII uniquement.'; return; }
    if (!allNames().includes(n)) S.customNames.push(n);
    save(); fillFrameNames(); close(() => ok(n));
  };
  $('newNameOk').onclick = submit;
  inp.onkeydown = (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(cancel); e.stopPropagation(); };
  m.onclick = (e) => { if (e.target === m || e.target.dataset.close !== undefined) close(cancel); };
}
function fillFrameNames() {
  const cur = S.out.frameName;
  $('gFrameName').innerHTML = [...new Set([...allNames(), cur])].map((n) => `<option ${n === cur ? 'selected' : ''}>${n}</option>`).join('') + '<option value="__new">Nouveau nom…</option>';
}

/* champs numériques « glissables » (comme les libellés Photoshop/Illustrator) */
function bindScrub(root) {
  root.querySelectorAll('.scrub[data-for]').forEach((lab) => {
    lab.onpointerdown = (e) => {
      const inp = $(lab.dataset.for); if (!inp) return;
      e.preventDefault(); lab.setPointerCapture(e.pointerId);
      const x0 = e.clientX, v0 = +inp.value || 0, step = +lab.dataset.step || 1;
      const min = inp.min !== '' ? +inp.min : -Infinity, max = inp.max !== '' ? +inp.max : Infinity;
      const dec = (String(step).split('.')[1] || '').length;
      lab.onpointermove = (ev) => {
        const v = clamp(v0 + Math.round((ev.clientX - x0) / (ev.shiftKey ? 1 : 4)) * step, min, max);
        const s = v.toFixed(dec); if (inp.value !== s) { inp.value = s; inp.dispatchEvent(new Event('input', { bubbles: true })); }
      };
      lab.onpointerup = () => { lab.onpointermove = null; inp.dispatchEvent(new Event('change', { bubbles: true })); };
    };
  });
}

/* ───────────── Inspecteur : Planche & Export ───────────── */
function setTab(t) {
  S.tab = t;
  $('tabSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('#inspector .tab').forEach((s) => { s.hidden = s.dataset.tab !== t; });
}
function syncControls() {
  const sh = S.sheet, o = S.out;
  $('sRoll').value = sh.roll; $('sReserve').value = sh.reserve; $('sGap').value = sh.gap;
  $('sAuto').checked = sh.auto; $('sRot').checked = sh.rot;
  $('rollPresets').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.v === +sh.roll));
  $('printableNote').textContent = `Laize imprimable ${printW()} mm · zone utile ${fmt(printW() - 2 * sh.reserve)} mm`;
  $('gFrame').checked = o.frame; $('frameOpts').hidden = !o.frame; $('gFrameM').value = o.frameM;
  $('gMerge').checked = o.merge; $('gBleed').value = o.bleed; $('gStroke').value = o.stroke; $('gImg').value = o.img;
  $('gSpeed').value = o.speed; $('gPrice').value = o.price;
  $('precSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.v === +o.prec));
  fillFrameNames();
}
function bindControls() {
  const num = (id, obj, k, recompute) => $(id).addEventListener('input', (e) => {
    const v = +e.target.value; if (e.target.value === '' || Number.isNaN(v)) return;
    obj[k] = v; save();
    if (recompute === 'art') markAll();
    if (obj === S.sheet) $('printableNote').textContent = `Laize imprimable ${printW()} mm · zone utile ${fmt(printW() - 2 * S.sheet.reserve)} mm`;
    if (id === 'sRoll') $('rollPresets').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.v === v));
    if (recompute === 'report') { computeJob(); renderReport(); } else schedule(300);
  });
  num('sRoll', S.sheet, 'roll'); num('sReserve', S.sheet, 'reserve'); num('sGap', S.sheet, 'gap');
  num('gFrameM', S.out, 'frameM'); num('gBleed', S.out, 'bleed', 'art');
  num('gStroke', S.out, 'stroke', 'report'); num('gSpeed', S.out, 'speed', 'report'); num('gPrice', S.out, 'price', 'report');
  $('rollPresets').querySelectorAll('button').forEach((b) => b.onclick = () => { $('sRoll').value = b.dataset.v; $('sRoll').dispatchEvent(new Event('input')); });
  $('sAuto').onchange = (e) => { S.sheet.auto = e.target.checked; save(); schedule(0); };
  $('sRot').onchange = (e) => { S.sheet.rot = e.target.checked; save(); schedule(0); };
  $('gFrame').onchange = (e) => { S.out.frame = e.target.checked; $('frameOpts').hidden = !S.out.frame; save(); schedule(0); };
  $('gFrameName').onchange = (e) => {
    if (e.target.value === '__new') { askName((n) => { S.out.frameName = n; save(); fillFrameNames(); schedule(0); }, fillFrameNames); return; }
    S.out.frameName = e.target.value; save(); schedule(0);
  };
  $('gMerge').onchange = (e) => { S.out.merge = e.target.checked; markAll(); save(); schedule(0); };
  $('gImg').onchange = (e) => { S.out.img = e.target.value; save(); };
  $('precSeg').querySelectorAll('button').forEach((b) => b.onclick = () => {
    S.out.prec = +b.dataset.v; markAll(); save(); syncControls(); schedule(0);
  });
  $('tabSeg').querySelectorAll('button').forEach((b) => b.onclick = () => setTab(b.dataset.tab));
  bindScrub(document.getElementById('inspector'));
}

function renderReport() {
  const j = S.job, st = j && j.stats;
  $('warnings').innerHTML = j ? j.warnings.map((w, i) => `<li class="${w.t}"><span>${esc(w.m)}</span>${fixButtons(w, i)}</li>`).join('') : '';
  bindFixes($('warnings'));
  const fm = (s) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')}`);
  $('stats').innerHTML = st ? `
    <span>Exemplaires</span><b>${st.copies}</b>
    <span>Tracés de coupe</span><b>${st.pieces}</b>
    <span>Longueur de coupe</span><b>${fmt(st.len / 1000, 2)} m</b>
    <span>Temps de coupe estimé</span><b>≈ ${fm(st.time)}</b>
    <span>Points</span><b>${st.nodes.toLocaleString('fr-FR')}</b>
    <span>Page PDF</span><b>${fmt(st.jobW)} × ${fmt(st.jobH)} mm</b>
    <span>Noms</span><div class="names">${st.names.map((n) => `<code style="color:${colorOf(n)}">${n}</code>`).join('') || '—'}</div>` : '<span>Aucun visuel sur la planche.</span><b></b>';
  $('sheetStats').innerHTML = st ? `
    <span>Travail</span><b>${fmt(st.jobW)} × ${fmt(st.jobH)} mm</b>
    <span>Support consommé</span><b>${fmt(st.mediaLen / 1000, 2)} m · ${fmt(st.m2, 2)} m²</b>
    ${S.out.price ? `<span>Coût support</span><b>${fmt(st.cost, 2)} €</b>` : ''}
    <span>Remplissage laize</span><b>${Math.round(st.jobW / (printW() - 2 * S.sheet.reserve) * 100)} %</b>` : '<span>—</span><b></b>';
  const can = !!(st && st.pieces);
  $('btnExport').disabled = $('btnExportPC').disabled = $('btnExportCut').disabled = !can;
  const pill = $('statusPill');
  if (!j || !S.arts.length) { pill.classList.add('hidden'); return; }
  const ne = j.warnings.filter((w) => w.t === 'err').length, nw = j.warnings.filter((w) => w.t === 'warn').length;
  pill.className = 'pill ' + (ne ? 'err' : nw ? 'warn' : 'ok');
  pill.textContent = ne ? `${ne} erreur${ne > 1 ? 's' : ''}` : nw ? `${nw} alerte${nw > 1 ? 's' : ''}` : 'Prêt';
  renderArts();
}

/* ───────────── Rendu de la planche ───────────── */
/* ───────────── Corrections en un clic ───────────── */
function fixButtons(w, i) {
  if (!w.fix || !w.fix.length) return '';
  return `<div class="fixes">${w.fix.map((f, k) => `<button class="fix${k ? '' : ' main'}" data-w="${i}" data-f="${k}">${esc(f.label)}</button>`).join('')}</div>`;
}
function bindFixes(root) {
  root.querySelectorAll('button.fix').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const w = S.job && S.job.warnings[+b.dataset.w]; const f = w && w.fix && w.fix[+b.dataset.f];
    if (f) applyFix(f);
  });
}
/** applique une correction proposée par une alerte, puis recalcule */
function applyFix(f) {
  const art = f.art ? S.arts.find((a) => a.id === f.art) : null;
  const item = art && f.item ? art.items.find((i) => i.id === f.item) : null;
  const rasterItems = art ? art.items.filter((i) => !i.vector && i.leaves.length && i.s.cut) : [];
  const setArt = (fn) => { (item ? [item] : rasterItems).forEach((i) => { fn(i); i.cache = {}; }); if (art) art.dirty = true; };
  const resize = (w) => { art.hMm = w * art.hMm / art.wMm; art.wMm = w; art.items.forEach((i) => { i.cache = {}; }); art.dirty = true; };
  let msg = '';
  switch (f.id) {
    case 'arrange': S.sheet.auto = true; $('sAuto').checked = true; arrange(); msg = 'Planche réorganisée'; break;
    case 'rotOn': S.sheet.rot = true; $('sRot').checked = true; S.sheet.auto = true; $('sAuto').checked = true; msg = 'Rotation autorisée'; break;
    case 'reserve10': S.sheet.reserve = 10; syncControls(); msg = 'Réserve des repères : 10 mm'; break;
    case 'fitWidth': resize(f.w); msg = `« ${art.name} » réduit à ${f.w} mm`; break;
    case 'size150': resize(f.w); msg = `Taille ajustée à ${fmt(f.w, 0)} mm (150 dpi)`; break;
    case 'scaleUp': resize(art.wMm * 1.5); msg = `Visuel agrandi à ${fmt(art.wMm, 0)} mm`; break;
    case 'mergeOn': S.out.merge = true; markAll(); syncControls(); msg = 'Coupes fusionnées'; break;
    case 'mergeOff': S.out.merge = false; markAll(); syncControls(); msg = 'Fusion désactivée'; break;
    case 'dropTiny': setArt((i) => { i.s.minArea = Math.max(i.s.minArea, 12); }); msg = 'Petits éléments (< 12 mm²) ignorés'; break;
    case 'closeTiny': setArt((i) => { i.s.closing = Math.max(i.s.closing, 2); }); msg = 'Petits éléments rattachés (2 mm)'; break;
    case 'lowThr': setArt((i) => { i.s.thr = 10; }); msg = 'Seuil d\'opacité : 10 %'; break;
    case 'skip': setArt((i) => { i.s.cut = false; }); msg = 'Calque non découpé'; break;
    case 'sticker': setArt((i) => Object.assign(i.s, STICKER)); msg = 'Mode « Un seul sticker »'; break;
    case 'letters': setArt((i) => Object.assign(i.s, LETTERING)); msg = 'Mode « Chaque lettre »'; break;
    case 'offset0': setArt((i) => { i.s.offset = 0; }); msg = 'Coupe au ras'; break;
    case 'addCopy': setCopies(art, 1); msg = '1 exemplaire ajouté'; break;
    case 'flush':
      for (const a of S.arts) for (const i of a.items) if (i.s.cut && i.s.shape === 'contour' && !i.s.outerOnly) { i.s.offset = 0; i.cache = {}; a.dirty = true; }
      S.out.bleed = 1; markAll(); syncControls(); msg = 'Coupe au ras + fond perdu 1 mm'; break;
    default: return;
  }
  save(); hideNotice(); renderInspector(); schedule(0);
  toast(`✓ ${msg}`);
}
/* notification persistante (après export) avec boutons de correction */
function showNotice(title, list) {
  const n = $('notice'); if (!list.length) { hideNotice(); return; }
  n.innerHTML = `<div class="nt-head"><b>${esc(title)}</b><button class="icon-btn" id="ntClose" title="Fermer">${ico('x')}</button></div>
    <ul>${list.map((w) => `<li class="${w.t}"><span>${esc(w.m)}</span>${fixButtons(w, S.job.warnings.indexOf(w))}</li>`).join('')}</ul>`;
  n.classList.remove('hidden');
  $('ntClose').onclick = hideNotice;
  bindFixes(n);
}
function hideNotice() { $('notice').classList.add('hidden'); }

const view = $('view'), stage = $('stage');
const RULER = 20;
let theme = {};
function readTheme() {
  const cs = getComputedStyle(document.documentElement), v = (n) => cs.getPropertyValue(n).trim();
  const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
  theme = { canvas: v('--canvas'), accent: v('--accent'), txt2: v('--txt-2'), txt3: v('--txt-3'), ruler: dark ? '#2a2a2c' : '#f7f7f9', rulerLine: dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.12)', paper: '#ffffff', dark };
}
function rollBox() {
  const pw = printW(), side = (S.sheet.roll - pw) / 2, R = S.sheet.reserve;
  const len = Math.max(jobBottom() + R + (S.out.frame ? S.out.frameM : 0), 250);
  return [-side, 0, pw + side, len];
}
function fit() {
  const W = view.clientWidth - RULER, H = view.clientHeight - RULER - 56;
  const [x0, y0, x1, y1] = rollBox(), pad = 24;
  const k = Math.max(0.05, Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (y1 - y0)));
  S.view = { scale: k, ox: RULER + (W - (x1 - x0) * k) / 2 - x0 * k, oy: RULER + pad - y0 * k, fitted: true };
}
function zoomAt(f, cx, cy) {
  const k2 = clamp(S.view.scale * f, 0.03, 120), ff = k2 / S.view.scale;
  S.view.ox = cx - (cx - S.view.ox) * ff; S.view.oy = cy - (cy - S.view.oy) * ff; S.view.scale = k2; draw();
}
const ACTUAL = 96 / 25.4; // 1:1 écran (CSS px par mm)
function niceStep(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p; return 10 * p; }
function hatch(x) {
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const g = c.getContext('2d'); g.strokeStyle = theme.dark ? 'rgba(255,45,146,.22)' : 'rgba(255,45,146,.18)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(0, 8); g.lineTo(8, 0); g.stroke();
  return x.createPattern(c, 'repeat');
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const W = view.clientWidth, H = view.clientHeight;
  if (view.width !== Math.round(W * dpr) || view.height !== Math.round(H * dpr)) { view.width = Math.round(W * dpr); view.height = Math.round(H * dpr); }
  const x = view.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
  $('zVal').textContent = `${Math.round(S.view.scale / ACTUAL * 100)} %`;
  if (!S.arts.length) return;
  if (!S.view.fitted) fit();
  const { scale: k, ox, oy } = S.view;
  const V = [k, 0, 0, k, ox, oy];
  const T = (mx, my) => [ox + mx * k, oy + my * k];
  const pw = printW(), R = S.sheet.reserve;
  const rb = rollBox();
  // rouleau
  const [rx0, ry0] = T(rb[0], rb[1] - 30), [rx1, ry1] = T(rb[2], rb[3] + 40);
  x.save(); x.shadowColor = 'rgba(0,0,0,.18)'; x.shadowBlur = 18; x.shadowOffsetY = 2;
  x.fillStyle = theme.paper; x.fillRect(rx0, ry0, rx1 - rx0, ry1 - ry0); x.restore();
  // marges non imprimables + réserve des repères
  x.fillStyle = 'rgba(120,120,128,.12)';
  const [ax0] = T(0, 0), [ax1] = T(pw, 0);
  x.fillRect(rx0, ry0, ax0 - rx0, ry1 - ry0); x.fillRect(ax1, ry0, rx1 - ax1, ry1 - ry0);
  if ($('vMarks').checked && R > 0) {
    x.fillStyle = hatch(x);
    const bottom = S.job && S.job.bbox ? S.job.bbox[3] : R;
    const zones = [[0, 0, R, bottom + R], [pw - R, 0, pw, bottom + R], [R, 0, pw - R, R], [R, bottom, pw - R, bottom + R]];
    for (const [a, b, c, d] of zones) { const [p, q] = T(a, b), [r, s] = T(c, d); x.fillRect(p, q, r - p, s - q); }
  }
  x.strokeStyle = 'rgba(120,120,128,.45)'; x.setLineDash([5, 4]); x.lineWidth = 1;
  x.beginPath(); x.moveTo(ax0 + 0.5, ry0); x.lineTo(ax0 + 0.5, ry1); x.moveTo(ax1 - 0.5, ry0); x.lineTo(ax1 - 0.5, ry1); x.stroke(); x.setLineDash([]);
  x.fillStyle = theme.txt2; x.font = '600 10px -apple-system, system-ui, sans-serif'; x.textAlign = 'center';
  if (k * 40 > 60) x.fillText('↓ sens d\'avance', (ax0 + ax1) / 2, ry0 + 13);

  // visuels
  const showPrint = $('vPrint').checked, showCut = $('vCut').checked, showNodes = $('vNodes').checked;
  for (const p of S.places) {
    const a = artOf(p); if (!a) continue;
    const A = M.mul(V, placeM(p, a)), b = fp(a);
    x.save(); x.setTransform(dpr * A[0], dpr * A[1], dpr * A[2], dpr * A[3], dpr * A[4], dpr * A[5]);
    x.beginPath(); x.rect(b[0], b[1], b[2] - b[0], b[3] - b[1]); x.clip();
    if (showPrint) {
      x.imageSmoothingQuality = 'high';
      if (a.bleed) { const [bx, by, bw, bh] = a.bleed.rect; x.drawImage(a.bleed.canvas, bx, by, bw, bh); }
      x.drawImage(a.preview, 0, 0, a.wMm, a.hMm);
    }
    x.restore();
  }
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  const path = (l, A) => { x.beginPath(); l.forEach(([mx, my], i) => { const [px, py] = M.apply(A, mx, my); i ? x.lineTo(px, py) : x.moveTo(px, py); }); if (!l.open) x.closePath(); };
  if (showCut) {
    for (const p of S.places) {
      const a = artOf(p); if (!a || !a.result) continue;
      const A = M.mul(V, placeM(p, a));
      for (const c of a.result.cuts) {
        const hl = a.id === S.selArt && c.items.includes(S.selItem);
        x.strokeStyle = colorOf(c.name); x.lineWidth = hl ? 2.2 : 1.3;
        for (const l of c.loops) { path(l, A); x.stroke(); }
        if (showNodes) { x.fillStyle = colorOf(c.name); for (const l of c.loops) for (const [mx, my] of l) { const [px, py] = M.apply(A, mx, my); x.fillRect(px - 1.5, py - 1.5, 3, 3); } }
      }
    }
    if (S.job && S.job.frame) { x.strokeStyle = colorOf(S.job.frame.name); x.lineWidth = 1.3; x.setLineDash([]); path(S.job.frame.loop, V); x.stroke(); }
  }
  // sélection / survol
  for (const p of S.places) {
    const sel = S.selPlaces.has(p.id), hov = S.hover === p.id;
    if (!sel && !hov) continue;
    const a = artOf(p); const r = rectOf(p, a); const [p0, q0] = T(r[0], r[1]), [p1, q1] = T(r[2], r[3]);
    x.strokeStyle = theme.accent; x.lineWidth = sel ? 1.5 : 1; x.globalAlpha = sel ? 1 : 0.55;
    x.strokeRect(Math.round(p0) - 0.5, Math.round(q0) - 0.5, Math.round(p1 - p0) + 1, Math.round(q1 - q0) + 1);
    x.globalAlpha = 1;
    if (sel) { x.fillStyle = '#fff'; for (const [hx, hy] of [[p0, q0], [p1, q0], [p0, q1], [p1, q1]]) { x.fillRect(hx - 3, hy - 3, 6, 6); x.strokeRect(hx - 3, hy - 3, 6, 6); } }
  }
  drawRulers(x, W, H);
}
function drawRulers(x, W, H) {
  const { scale: k, ox, oy } = S.view;
  const step = niceStep(70 / k), minor = step / (String(step)[0] === '2' ? 4 : 5);
  x.fillStyle = theme.ruler; x.fillRect(0, 0, W, RULER); x.fillRect(0, 0, RULER, H);
  x.strokeStyle = theme.rulerLine; x.lineWidth = 1;
  x.beginPath(); x.moveTo(0, RULER - 0.5); x.lineTo(W, RULER - 0.5); x.moveTo(RULER - 0.5, 0); x.lineTo(RULER - 0.5, H); x.stroke();
  x.fillStyle = theme.txt2; x.font = '9.5px -apple-system, system-ui, sans-serif'; x.textAlign = 'left'; x.textBaseline = 'top';
  x.strokeStyle = theme.txt3; x.beginPath();
  const xa = Math.floor((RULER - ox) / k / minor) * minor, xb = (W - ox) / k;
  for (let v = xa; v <= xb; v += minor) {
    const px = Math.round(ox + v * k) + 0.5; if (px < RULER) continue;
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    x.moveTo(px, major ? 4 : RULER - 5); x.lineTo(px, RULER);
    if (major) x.fillText(String(Math.round(v * 100) / 100), px + 3, 3);
  }
  const ya = Math.floor((RULER - oy) / k / minor) * minor, yb = (H - oy) / k;
  for (let v = ya; v <= yb; v += minor) {
    const py = Math.round(oy + v * k) + 0.5; if (py < RULER) continue;
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    x.moveTo(major ? 4 : RULER - 5, py); x.lineTo(RULER, py);
    if (major) { x.save(); x.translate(3, py + 3); x.rotate(Math.PI / 2); x.textBaseline = 'bottom'; x.fillText(String(Math.round(v * 100) / 100), 0, 0); x.restore(); }
  }
  x.stroke();
  if (S.cursor) {
    const [cx, cy] = S.cursor; x.strokeStyle = theme.accent; x.beginPath();
    x.moveTo(cx + 0.5, 0); x.lineTo(cx + 0.5, RULER); x.moveTo(0, cy + 0.5); x.lineTo(RULER, cy + 0.5); x.stroke();
  }
  x.fillStyle = theme.ruler; x.fillRect(0, 0, RULER - 1, RULER - 1);
  x.fillStyle = theme.txt3; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('mm', RULER / 2, RULER / 2);
}

/* ───────────── Interaction canevas ───────────── */
const toSheet = (e) => { const r = view.getBoundingClientRect(); return [(e.clientX - r.left - S.view.ox) / S.view.scale, (e.clientY - r.top - S.view.oy) / S.view.scale]; };
function placeAt(mx, my) {
  for (let i = S.places.length - 1; i >= 0; i--) {
    const p = S.places[i], a = artOf(p); if (!a) continue;
    const r = rectOf(p, a); if (mx >= r[0] && mx <= r[2] && my >= r[1] && my <= r[3]) return p;
  }
  return null;
}
/** calque sous le pointeur (tracé vectoriel puis pixel opaque du calque, du haut vers le bas) */
function itemAt(p, mx, my) {
  const a = artOf(p); const [lx, ly] = M.apply(M.inv(placeM(p, a)), mx, my);
  for (const it of a.items) {
    if (it.vector) {
      const sx = a.wMm / a.wMm0, sy = a.hMm / a.hMm0;
      if (it.vector.loops.some((l) => !l.open && pointInPoly(lx / sx, ly / sy, l))) return it;
      continue;
    }
    const px = lx * a.wPx / a.wMm, py = ly * a.hPx / a.hMm;
    for (const l of it.leaves) {
      const u = Math.floor(px - l.left), v = Math.floor(py - l.top);
      if (u < 0 || v < 0 || u >= l.canvas.width || v >= l.canvas.height) continue;
      l.ctx = l.ctx || l.canvas.getContext('2d', { willReadFrequently: true });
      if (l.ctx.getImageData(u, v, 1, 1).data[3] > 24) return it;
    }
  }
  return null;
}
let drag = null;
view.addEventListener('pointerdown', (e) => {
  if (!S.arts.length) return;
  view.setPointerCapture(e.pointerId);
  const [mx, my] = toSheet(e);
  const pan = e.button === 1 || S.tool === 'hand' || S.space;
  const hit = pan ? null : placeAt(mx, my);
  if (!hit) {
    if (!pan && !e.shiftKey && S.selPlaces.size) { S.selPlaces.clear(); updateSelUi(); draw(); }
    drag = { mode: 'pan', x: e.clientX, y: e.clientY, ox: S.view.ox, oy: S.view.oy };
    stage.classList.add('panning'); return;
  }
  if (e.shiftKey) { S.selPlaces.has(hit.id) ? S.selPlaces.delete(hit.id) : S.selPlaces.add(hit.id); }
  else if (!S.selPlaces.has(hit.id)) S.selPlaces = new Set([hit.id]);
  const it = itemAt(hit, mx, my);
  selectArt(hit.artId, it ? it.id : null);
  drag = { mode: 'move', x: e.clientX, y: e.clientY, moved: false, start: selected().map((p) => [p, p.x, p.y]) };
});
view.addEventListener('pointermove', (e) => {
  const r = view.getBoundingClientRect();
  S.cursor = [e.clientX - r.left, e.clientY - r.top];
  const [mx, my] = toSheet(e);
  if (S.arts.length) $('cursorPos').textContent = `x ${fmt(mx)}  y ${fmt(my)} mm`;
  if (drag && drag.mode === 'pan') { S.view.ox = drag.ox + e.clientX - drag.x; S.view.oy = drag.oy + e.clientY - drag.y; draw(); return; }
  if (drag && drag.mode === 'move') {
    const dx = (e.clientX - drag.x) / S.view.scale, dy = (e.clientY - drag.y) / S.view.scale;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3) return;
    if (!drag.moved) { drag.moved = true; manual(); }
    const snap = (v) => Math.round(v * 2) / 2;
    for (const [p, x0, y0] of drag.start) { p.x = snap(x0 + dx); p.y = snap(y0 + dy); }
    // aimantation sur la réserve des repères
    const R = S.sheet.reserve, tol = 6 / S.view.scale;
    const lead = drag.start[0][0], a = artOf(lead), rr = rectOf(lead, a);
    let sx = 0, sy = 0;
    if (Math.abs(rr[0] - R) < tol) sx = R - rr[0]; else if (Math.abs(rr[2] - (printW() - R)) < tol) sx = printW() - R - rr[2];
    if (Math.abs(rr[1] - R) < tol) sy = R - rr[1];
    if (sx || sy) for (const [p] of drag.start) { p.x += sx; p.y += sy; }
    computeJob(); updateSelUi(); draw(); return;
  }
  const h = S.tool === 'select' && !S.space ? placeAt(mx, my) : null;
  const hid = h ? h.id : null;
  stage.classList.toggle('over-item', !!h);
  if (hid !== S.hover) S.hover = hid;
  draw();
});
view.addEventListener('pointerup', () => {
  if (drag && drag.mode === 'move' && drag.moved) { computeJob(); renderReport(); }
  drag = null; stage.classList.remove('panning');
});
view.addEventListener('pointerleave', () => { S.cursor = null; S.hover = null; $('cursorPos').textContent = '—'; draw(); });
view.addEventListener('wheel', (e) => {
  e.preventDefault(); if (!S.arts.length) return;
  const r = view.getBoundingClientRect();
  if (e.ctrlKey || e.metaKey || e.altKey) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.0025)), e.clientX - r.left, e.clientY - r.top);
  else { S.view.ox -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX; S.view.oy -= e.shiftKey && !e.deltaX ? 0 : e.deltaY; draw(); }
}, { passive: false });
view.addEventListener('dblclick', (e) => { if (!placeAt(...toSheet(e))) { S.view.fitted = false; draw(); } });
new ResizeObserver(() => draw()).observe(stage);

function setTool(t) {
  S.tool = t; stage.classList.toggle('tool-hand', t === 'hand');
  $('toolSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
}
const zoomCenter = (f) => zoomAt(f, (view.clientWidth + RULER) / 2, (view.clientHeight + RULER) / 2);
function actualSize() {
  const W = view.clientWidth, H = view.clientHeight, c = [(W / 2 - S.view.ox) / S.view.scale, (H / 2 - S.view.oy) / S.view.scale];
  S.view.scale = ACTUAL; S.view.ox = W / 2 - c[0] * ACTUAL; S.view.oy = H / 2 - c[1] * ACTUAL; draw();
}

/* ───────────── Export ───────────── */
async function exportPdf(withPrint) {
  const j = S.job; if (!j || !j.stats || !j.stats.pieces) return;
  busy(true); await sleep(30);
  try {
    const title = S.arts.length === 1 ? S.arts[0].name.replace(/\.[^.]+$/, '') : 'planche';
    const bytes = await buildPdf(j, withPrint, S.out, title);
    S.lastPdf = bytes;
    const file = `${title.replace(/[^\w\-]+/g, '_')}_${withPrint ? 'print-cut' : 'cut'}_RasterLink.pdf`;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const el = document.createElement('a'); el.href = url; el.download = file; document.body.appendChild(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    const ne = j.warnings.filter((w) => w.t === 'err').length;
    toast(ne ? `${file} exporté, mais ${ne} erreur(s) restent à corriger.` : `${file} exporté (${fmt(bytes.length / 1048576, 1)} Mo).`, ne ? 'err' : '');
    // après la sauvegarde : rappel des alertes et conseils, avec leurs boutons d'action
    const todo = j.warnings.filter((w) => w.fix && w.fix.length && w.t !== 'ok');
    if (todo.length) showNotice(ne ? 'PDF exporté — à corriger avant d\'imprimer' : 'PDF exporté — conseils', todo);
  } catch (e) { console.error(e); toast('Erreur export : ' + e.message, 'err'); }
  busy(false);
}

/* ───────────── Clavier ───────────── */
const typing = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'checkbox';
document.addEventListener('keydown', (e) => {
  if (!$('studio').classList.contains('hidden')) return; // le studio gère ses propres raccourcis
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (e.key === 'Escape') { document.querySelectorAll('.modal:not(.hidden)').forEach((m) => m.classList.add('hidden')); if (!typing(e)) { S.selPlaces.clear(); updateSelUi(); draw(); } return; }
  if (mod && k === 'o') { e.preventDefault(); $('fileInput').click(); return; }
  if (mod && k === 'e') { e.preventDefault(); exportPdf(!e.shiftKey); return; }
  if (typing(e)) return;
  if (mod && (k === '0')) { e.preventDefault(); S.view.fitted = false; draw(); return; }
  if (mod && k === '1') { e.preventDefault(); actualSize(); return; }
  if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomCenter(1.25); return; }
  if (mod && (k === '-' || k === '_')) { e.preventDefault(); zoomCenter(0.8); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicateSel(); return; }
  if (mod && k === 'a') { e.preventDefault(); S.selPlaces = new Set(S.places.map((p) => p.id)); updateSelUi(); draw(); return; }
  if (mod) return;
  if (e.key === ' ') { e.preventDefault(); if (!S.space) { S.space = true; stage.classList.add('space'); } return; }
  if (k === 'v') setTool('select');
  else if (k === 'h') setTool('hand');
  else if (k === 'r') rotateSel();
  else if (k === 'a') { arrange(); afterMove(); toast('Planche réorganisée.'); }
  else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteSel(); }
  else if (e.key === '?') $('helpModal').classList.remove('hidden');
  else if (e.key.startsWith('Arrow')) {
    e.preventDefault(); const d = e.shiftKey ? 10 : 1;
    nudge(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
  }
});
document.addEventListener('keyup', (e) => { if (e.key === ' ') { S.space = false; stage.classList.remove('space'); } });

/* ───────────── Branchements ───────────── */
function busy(b) { $('busy').classList.toggle('hidden', !b); }
['fileInput', 'fileInput2', 'fileInput3'].forEach((id) => $(id).addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; }));
let dragDepth = 0;
document.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); } });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
document.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); if ($('studio').classList.contains('hidden') && e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });
$('btnHelp').onclick = () => $('helpModal').classList.remove('hidden');
$('helpModal').addEventListener('click', (e) => { if (e.target.id === 'helpModal' || e.target.closest('[data-close]')) $('helpModal').classList.add('hidden'); });
$('btnDemo').onclick = async () => { busy(true); const r = await fetch('demo.psd'); const b = await r.blob(); await importFiles([new File([b], 'exemple-stickers.psd')]); };
$('btnExport').onclick = () => exportPdf(true);
$('btnExportPC').onclick = () => exportPdf(true);
$('btnExportCut').onclick = () => exportPdf(false);
$('statusPill').onclick = () => setTab('export');
const studioDone = async (file, info) => {
  await importFiles([file]);
  const a = S.arts.at(-1);
  if (a && a.name.startsWith('Studio')) {
    a.source = 'Studio';
    // texte seul = lettrage (chaque lettre) ; sinon un seul contour sticker autour du dessin
    for (const i of a.items) { Object.assign(i.s, info.onlyText ? LETTERING : { ...STICKER, offset: 1.5 }); i.cache = {}; }
    a.dirty = true; renderInspector(); schedule(0);
    toast(`Sticker ajouté à la planche (${fmt(info.wMm, 0)} × ${fmt(info.hMm, 0)} mm) — la découpe est calculée automatiquement.`);
  }
};
$('btnStudio').onclick = () => openStudio(studioDone);
$('btnStudio2').onclick = () => openStudio(studioDone);
$('toolSeg').querySelectorAll('button').forEach((b) => b.onclick = () => setTool(b.dataset.tool));
$('zIn').onclick = () => zoomCenter(1.25); $('zOut').onclick = () => zoomCenter(0.8);
$('zVal').onclick = () => { S.view.fitted = false; draw(); };
$('bRotate').onclick = $('bRotate2').onclick = rotateSel;
$('bDup').onclick = $('bDup2').onclick = duplicateSel;
$('bDel').onclick = deleteSel;
$('bArrange').onclick = $('bArrange2').onclick = () => { arrange(); afterMove(); toast('Planche réorganisée.'); };
$('allOn').onclick = () => { const a = curArt(); if (!a) return; a.items.forEach((i) => { if ((i.leaves.length || i.vector) && !i.tags.includes('fond')) i.s.cut = true; }); a.dirty = true; renderInspector(); schedule(); };
$('allOff').onclick = () => { const a = curArt(); if (!a) return; a.items.forEach((i) => { i.s.cut = false; }); a.dirty = true; renderInspector(); schedule(); };
['vPrint', 'vCut', 'vNodes', 'vMarks'].forEach((id) => $(id).addEventListener('change', draw));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readTheme(); draw(); });

icons(); readTheme(); syncControls(); bindControls(); renderArts(); renderInspector(); updateSelUi(); draw();
window.CutLink = { S, run, computeJob, arrange, exportPdf, importFiles, extractCuts, schedule };
if (/[?&]demo/.test(location.search)) $('btnDemo').click();

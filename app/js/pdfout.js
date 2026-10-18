'use strict';
/* Export PDF Print & Cut pour RasterLink7 :
   - calque PDF (OCG) « Impression » : un JPEG/PNG opaque par visuel, aplati sur blanc (pas de transparence) ;
   - un calque OCG par nom de coupe, au-dessus, tracés en couleur d'accompagnement Separation
     « CutContour… », trait seul, surimpression activée. */
import { M, cmykOf, canvas, xform } from './util.js';

const n3 = (v) => (Math.round(v * 1000) / 1000).toString();
const K = 72 / 25.4;

/**
 * job = { bbox:[x0,y0,x1,y1] mm planche, places:[{art, M}], frame:{loop,name}|null }
 * M : matrice repère visuel (mm) → planche (mm)
 */
export async function buildPdf(job, withPrint, g, title) {
  const { PDFDocument, PDFName, PDFString } = window.Lib.PDFLib;
  const [x0, y0, x1, y1] = job.bbox;
  const pdf = await PDFDocument.create();
  pdf.setTitle(title + ' — Print & Cut'); pdf.setCreator('CutLink (Mimaki CJV150 / RasterLink7)'); pdf.setProducer('CutLink');
  const page = pdf.addPage([(x1 - x0) * K, (y1 - y0) * K]);
  const C = pdf.context;
  const N = [K, 0, 0, -K, -K * x0, K * y1]; // planche mm (y vers le bas) → PDF pt (y vers le haut)
  const res = { ColorSpace: {}, ExtGState: { GSop: C.obj({ Type: 'ExtGState', OP: true, op: true, OPM: 1 }) }, Properties: {}, XObject: {} };
  const ocgs = []; let content = '';

  // regroupe les tracés par nom de coupe, en coordonnées PDF
  const byName = new Map();
  const add = (name, loop) => (byName.get(name) || byName.set(name, []).get(name)).push(loop);
  for (const p of job.places) {
    const T = M.mul(N, p.M);
    for (const c of p.art.result.cuts) for (const l of c.loops) add(c.name, xform(l, T));
  }
  if (job.frame) add(job.frame.name, xform(job.frame.loop, N));
  const names = [...byName.keys()];

  if (withPrint) {
    const ocgP = C.register(C.obj({ Type: 'OCG', Name: PDFString.of('Impression') }));
    res.Properties.OC0 = ocgP; ocgs.push(ocgP);
    content += '/OC /OC0 BDC\n';
    const emb = new Map();
    for (const p of job.places) {
      const art = p.art;
      if (!emb.has(art.id)) {
        const img = await rasterForArt(art, g);
        const e = g.img === 'png' ? await pdf.embedPng(img) : await pdf.embedJpg(img);
        res.XObject['Im' + art.id] = e.ref; emb.set(art.id, true);
      }
      const [px0, , px1, py1] = art.result.pb, py0 = art.result.pb[1];
      const I = [px1 - px0, 0, 0, -(py1 - py0), px0, py1]; // carré unité de l'image → repère visuel
      const T = M.mul(M.mul(N, p.M), I);
      content += `q ${T.map(n3).join(' ')} cm /Im${art.id} Do Q\n`;
    }
    content += 'EMC\n';
  }
  names.forEach((n, i) => {
    const ref = C.register(C.obj({ Type: 'OCG', Name: PDFString.of(n) }));
    res.Properties['OC' + (i + 1)] = ref; ocgs.push(ref);
    res.ColorSpace['CS' + (i + 1)] = C.obj(['Separation', n, 'DeviceCMYK', C.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: cmykOf(n), N: 1 })]);
    content += `/OC /OC${i + 1} BDC\nq /GSop gs /CS${i + 1} CS 1 SCN ${n3(g.stroke)} w 1 J 1 j\n`;
    for (const l of byName.get(n)) content += l.map(([x, y], j) => `${n3(x)} ${n3(y)} ${j ? 'l' : 'm'}`).join('\n') + (l.open ? '\nS\n' : '\nh S\n');
    content += 'Q\nEMC\n';
  });
  page.node.set(PDFName.of('Resources'), C.obj(res));
  page.node.set(PDFName.of('Contents'), C.register(C.flateStream(content)));
  pdf.catalog.set(PDFName.of('OCProperties'), C.obj({ OCGs: ocgs, D: { Name: PDFString.of('Calques'), Order: ocgs.slice().reverse(), ON: ocgs, OFF: [] } }));
  return pdf.save({ useObjectStreams: false });
}

/** Image opaque de l'emprise du visuel : blanc + fond perdu + visuel. */
async function rasterForArt(art, g) {
  const pb = art.result.pb; const native = art.wPx / art.wMm;
  const pw = pb[2] - pb[0], ph = pb[3] - pb[1];
  const ppm = Math.min(native, 16000 / pw, 16000 / ph, Math.sqrt(120e6 / (pw * ph)));
  const c = canvas(pw * ppm, ph * ppm), x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingQuality = 'high';
  if (art.bleed) { const [bx, by, bw, bh] = art.bleed.rect; x.drawImage(art.bleed.canvas, (bx - pb[0]) * ppm, (by - pb[1]) * ppm, bw * ppm, bh * ppm); }
  x.drawImage(art.composite, -pb[0] * ppm, -pb[1] * ppm, art.wMm * ppm, art.hMm * ppm);
  const blob = await new Promise((r) => c.toBlob(r, g.img === 'png' ? 'image/png' : 'image/jpeg', 0.95));
  if (!blob) throw new Error('image trop grande pour le navigateur');
  return new Uint8Array(await blob.arrayBuffer());
}

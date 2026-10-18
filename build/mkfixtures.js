// Fichiers de test pour e2e.py : PDF « façon Illustrator » (nuances CutContour) + SVG en mm.
// Usage : node mkfixtures.js <dossier de sortie>
const { PDFDocument, PDFName } = require('pdf-lib');
const fs = require('fs'); const path = require('path');
const out = process.argv[2] || '.';
fs.mkdirSync(out, { recursive: true });
const K = 72 / 25.4;
(async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([100 * K, 80 * K]); // 100 × 80 mm
  const C = pdf.context;
  const sep = (n, cmyk) => C.obj(['Separation', n, 'DeviceCMYK', C.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: cmykOf(cmyk), N: 1 })]);
  function cmykOf(v) { return v; }
  // cercle de Bézier (r = 25 mm) centré en (50, 40) mm, dans un formulaire avec une matrice de translation
  const r = 25 * K, c = 0.5523 * r;
  const circle = `${r} 0 m ${r} ${c} ${c} ${r} 0 ${r} c ${-c} ${r} ${-r} ${c} ${-r} 0 c ${-r} ${-c} ${-c} ${-r} 0 ${-r} c ${c} ${-r} ${r} ${-c} ${r} 0 c h`;
  const form = C.flateStream(`/CS0 CS 1 SCN 0.5 w ${circle} S`, {
    Type: 'XObject', Subtype: 'Form', BBox: [-100, -100, 100, 100], Matrix: [1, 0, 0, 1, 50 * K, 40 * K],
    Resources: { ColorSpace: { CS0: sep('CutContour', [0, 1, 0, 0]) } },
  });
  const formRef = C.register(form);
  const r2 = 20 * K, c2 = 0.5523 * r2;
  const disk = `${r2} 0 m ${r2} ${c2} ${c2} ${r2} 0 ${r2} c ${-c2} ${r2} ${-r2} ${c2} ${-r2} 0 c ${-r2} ${-c2} ${-c2} ${-r2} 0 ${-r2} c ${c2} ${-r2} ${r2} ${-c2} ${r2} 0 c h`;
  const content = [
    'q 0.9 0.1 0.1 rg', `1 0 0 1 ${50 * K} ${40 * K} cm`, disk, 'f Q',          // disque rouge imprimé
    '/Fm0 Do',                                                                    // coupe dans un formulaire
    `q /CS1 CS 1 SCN 0.25 w ${5 * K} ${5 * K} m ${95 * K} ${5 * K} l S Q`,        // tracé ouvert CutContourHalf
    `q /CS0 cs 1 scn ${2 * K} ${70 * K} ${6 * K} ${6 * K} re f Q`,                // remplissage CutContour (ignoré)
  ].join('\n');
  page.node.set(PDFName.of('Resources'), C.obj({ XObject: { Fm0: formRef }, ColorSpace: { CS0: sep('CutContour', [0, 1, 0, 0]), CS1: sep('CutContourHalf', [1, 0, 0, 0]) } }));
  page.node.set(PDFName.of('Contents'), C.register(C.flateStream(content)));
  fs.writeFileSync(path.join(out, 'illustrator-like.pdf'), await pdf.save({ useObjectStreams: false }));
  fs.writeFileSync(path.join(out, 'badge.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40"><rect x="5" y="5" width="50" height="30" rx="6" fill="#0a84ff"/><text x="30" y="24" font-size="9" text-anchor="middle" fill="#fff" font-family="sans-serif">QENTINA</text></svg>`);
  console.log('ok', out);
})();

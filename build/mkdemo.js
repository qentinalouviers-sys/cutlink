const { writePsdBuffer } = require('ag-psd');
const fs = require('fs');
const W = 1772, H = 1181; // 150x100 mm @300dpi
function layer(name, fn, color, x0, y0, w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = fn(x - w / 2, y - h / 2, x, y); if (!a) continue;
    const i = (y * w + x) * 4; const c = typeof color === 'function' ? color(x, y) : color;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255 * a;
  }
  return { name, left: x0, top: y0, right: x0 + w, bottom: y0 + h, imageData: { width: w, height: h, data: d } };
}
const star = (x, y) => { const r = Math.hypot(x, y), t = Math.atan2(y, x) + Math.PI / 2; const k = 0.5 + 0.5 * Math.cos(5 * t); return r < 110 + 120 * Math.pow(Math.abs(Math.cos(2.5 * t)), 3) ? 1 : 0; };
const children = [
  layer('Fond', () => 1, (x, y) => [250, 240 - y / 20, 220], 0, 0, W, H),
  layer('Logo rond', (x, y) => Math.hypot(x, y) < 200 ? 1 : 0, (x, y) => [15, 84, 96], 120, 140, 420, 420),
  layer('Etoile', star, [229, 0, 126], 680, 110, 480, 480),
  { name: 'Texte PIZZA (groupe)', children: [
      layer('P', (x, y) => (Math.abs(x) < 25 && Math.abs(y) < 110) || (Math.hypot(x - 30, y + 55) < 60 && Math.hypot(x - 30, y + 55) > 25 && x > 0) ? 1 : 0, [20, 20, 20], 1250, 160, 200, 240),
      layer('O', (x, y) => { const r = Math.hypot(x / 0.8, y); return r < 110 && r > 65 ? 1 : 0; }, [20, 20, 20], 1440, 160, 200, 240),
    ] },
  layer('Anneau', (x, y) => { const r = Math.hypot(x, y); return r < 180 && r > 110 ? 1 : 0; }, [0, 160, 224], 160, 650, 400, 400),
  layer('Pastilles', (x, y) => [[-120, 0], [0, 30], [120, 0]].some(([cx, cy]) => Math.hypot(x - cx, y - cy) < 55) ? 1 : 0, [250, 165, 36], 700, 720, 400, 260),
  layer('Badge carré', (x, y) => Math.abs(x) < 170 && Math.abs(y) < 120 ? 1 : 0, (x, y) => [60 + x / 4, 180, 120], 1220, 640, 380, 280),
];
const psd = { width: W, height: H, children, imageResources: { resolutionInfo: { horizontalResolution: 300, horizontalResolutionUnit: 'PPI', widthUnit: 'Millimeters', verticalResolution: 300, verticalResolutionUnit: 'PPI', heightUnit: 'Millimeters' } } };
fs.writeFileSync('../app/demo.psd', Buffer.from(writePsdBuffer(psd, { generateThumbnail: false, noBackground: true })));
console.log('ok', fs.statSync('../app/demo.psd').size);

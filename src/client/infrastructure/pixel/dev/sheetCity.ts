// node --import tsx src/client/infrastructure/pixel/dev/sheetCity.ts <outDir>
// Writes city-day.png and city-night.png, plus zoomed crops of the road and a shop column (zoom-*.png), and prints timings.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { City } from '../city.ts';
import { PixelBuffer, TILE, rgba, shade } from '../types.ts';
import { savePng } from './png.ts';

const outDir = process.argv[2] ?? '.';
mkdirSync(outDir, { recursive: true });
const options = { width: 26, depth: 18, name: 'Gen AI Space', seed: Number(process.argv[3] ?? 41) };
let t0 = performance.now();
const city = new City(options);
console.log(`construct ${(performance.now() - t0).toFixed(1)} ms`);
for (let i = 0; i < 40; i++) city.update(.1);
const bounds = city.bounds();
t0 = performance.now();
for (let i = 0; i < 200; i++) city.frame(true, i % 2 === 0);
console.log(`frame ${((performance.now() - t0) / 200).toFixed(3)} ms`);
const crop = (src: PixelBuffer, x: number, y: number, w: number, h: number) => { const o = new PixelBuffer(w, h); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) o.data[j * w + i] = src.get(x + i, y + j); return o; };
for (const dark of [false, true]) {
  const frame = city.frame(dark, false), out = new PixelBuffer(bounds.w, bounds.h);
  out.rect(0, 0, out.w, out.h, rgba('#33303d'));
  out.rect(-bounds.x, -bounds.y, 26 * TILE, 18 * TILE, rgba('#bdb0a0'));
  for (let y = 0; y < 18 * TILE; y += TILE) for (let x = 0; x < 26 * TILE; x += TILE) out.rect(x - bounds.x, y - bounds.y, TILE - 1, TILE - 1, rgba('#cec2b0'));
  const ground = frame.drawables.filter(d => d.layer === 'ground');
  const objects = frame.drawables.filter(d => d.layer === 'object').sort((a, b) => a.sortY - b.sortY);
  for (const d of [...ground, ...objects]) out.blit(d.sprite.buf, Math.round(d.x - d.sprite.ax - bounds.x), Math.round(d.y - d.sprite.ay - bounds.y));
  // Node has no Thai font renderer. Only outline the text's extent, as requested.
  for (const s of frame.signs) {
    const count = [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(s.text)].length;
    const w = Math.round(s.vertical ? s.size : Math.min(26 * TILE - 40, count * s.size * .6));
    const h = Math.round(s.vertical ? Math.min(70, count * s.size) : s.size);
    const x = Math.round(s.x - w / 2 - bounds.x), y = Math.round(s.y - h / 2 - bounds.y), c = rgba(s.color);
    out.rect(x, y, w, 1, c); out.rect(x, y + h - 1, w, 1, c); out.rect(x, y, 1, h, c); out.rect(x + w - 1, y, 1, h, c);
  }
  if (dark) {
    for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
      let brightness = .45;
      for (const l of frame.lights) { const distance = Math.hypot(x + bounds.x - l.x, y + bounds.y - l.y); if (distance < l.radius) brightness += (1 - distance / l.radius) * l.strength * .65; }
      out.data[y * out.w + x] = shade(out.get(x, y), Math.min(1.35, brightness));
    }
  }
  const mode = dark ? 'night' : 'day', path = join(outDir, `city-${mode}.png`);
  savePng(path, out, 3); console.log(path);
  savePng(join(outDir, `zoom-road-${mode}.png`), crop(out, 0, -bounds.y + 18 * TILE + 20, 360, 150), 5);
  savePng(join(outDir, `zoom-shops-${mode}.png`), crop(out, 0, 20, 220, 190), 5);
  savePng(join(outDir, `zoom-top-${mode}.png`), crop(out, 0, 0, 360, 150), 5);
}

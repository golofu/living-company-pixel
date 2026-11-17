// Dev only: writes contact sheets of the pixel people so they can be looked at.
//   node --import tsx src/client/infrastructure/pixel/dev/sheetPeople.ts <outDir>
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { looks } from '../../../domain/looks.ts';
import { PERSON_FRAMES, PixelBuffer, type Dir, type PersonAction } from '../types.ts';
import { drawPerson } from '../people.ts';
import { savePng } from './png.ts';

const outDir = process.argv[2] ?? '.';
mkdirSync(outDir, { recursive: true });
const SCALE = 6;
const BG = 0x4a4660ff;

/** Fixed-size cell holding a person with its feet on the same line. */
function cell(look: Parameters<typeof drawPerson>[0], action: PersonAction, dir: Dir, frame: number, umbrella = false, w = 26, h = 40): PixelBuffer {
  const s = drawPerson(look, { action, dir, frame, umbrella });
  const c = new PixelBuffer(w, h);
  c.blit(s.buf, Math.round(w / 2) - s.ax, h - 3 - s.ay);
  return c;
}

function grid(cells: PixelBuffer[], columns: number, gap = 2): PixelBuffer {
  const cw = cells[0]!.w, ch = cells[0]!.h, rows = Math.ceil(cells.length / columns);
  const out = new PixelBuffer(columns * (cw + gap) + gap, rows * (ch + gap) + gap);
  cells.forEach((b, i) => out.blit(b, gap + (i % columns) * (cw + gap), gap + Math.floor(i / columns) * (ch + gap)));
  return out;
}

const names = Object.keys(looks);
savePng(join(outDir, 'people-all.png'), grid(names.map(n => cell(looks[n]!, 'stand', 'down', 0)), 12), SCALE, BG);

const ACTIONS = Object.keys(PERSON_FRAMES) as PersonAction[];
const DIRS: Dir[] = ['down', 'up', 'left', 'right'];
const picks = ['ดาวเรือง', 'ใบเตย', 'ภูผา'];
for (const [i, name] of picks.entries()) {
  const look = looks[name]!;
  // one row per action, each row = dir x frame
  const cells: PixelBuffer[] = [];
  const cols = 16;
  for (const a of ACTIONS) {
    const row: PixelBuffer[] = [];
    for (const d of DIRS) for (let f = 0; f < PERSON_FRAMES[a]; f++) row.push(cell(look, a, d, f));
    while (row.length < cols) row.push(new PixelBuffer(26, 40));
    cells.push(...row);
  }
  savePng(join(outDir, `people-actions-${i + 1}.png`), grid(cells, cols), SCALE, BG);
}
// umbrella + a hair/outfit variety strip in all directions
const strip: PixelBuffer[] = [];
for (const n of ['ดาวเรือง', 'ใบเตย', 'ข้าวหอม', 'น้ำผึ้ง', 'ลมหนาว', 'ภูผา', 'มะลิ']) for (const d of DIRS) strip.push(cell(looks[n]!, 'stand', d, 0, n === 'ภูผา'));
savePng(join(outDir, 'people-dirs.png'), grid(strip, 8), SCALE, BG);
console.log('saved', outDir);

// Close-up of a few poses at a bigger scale, for judging the drawing itself.
{
  const rows: PixelBuffer[] = [];
  const want: [string, PersonAction, number][] = [['ดาวเรือง', 'stand', 0], ['ลมหนาว', 'walk', 0], ['ภูผา', 'stand', 0], ['ฟ้าคราม', 'stand', 0], ['ภูผา', 'run', 0], ['ฟ้าคราม', 'walk', 2], ['ใบเตย', 'sit', 0], ['ข้าวหอม', 'stand', 0]];
  for (const [n, a, f] of want) for (const d of DIRS) rows.push(cell(looks[n]!, a, d, f));
  savePng(join(outDir, 'people-close.png'), grid(rows, 8), 10, BG);
}

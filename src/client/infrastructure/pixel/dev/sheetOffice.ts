// Dev contact sheets for furniture.ts. Run:
//   node --import tsx src/client/infrastructure/pixel/dev/sheetOffice.ts <outDir>
// Writes items.png (every type, four rotations), office-12.png, office-30.png, office-30-dark.png, all at scale 4.
// Seated people are the real sprites from people.ts, placed at the real seats (desk, team seat, CEO chair, sofa and bed
// spots, the same geometry as the 3D world), so the sheets show how chairs, backs and blankets cover a sitter.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG, center, footprint, frontPoint, frontVec, type ItemType, type OfficeItem } from '../../../../shared/catalog.ts';
import { planOffice, type PlanAgent } from '../../../../shared/layout.ts';
import { looks } from '../../../domain/looks.ts';
import { PixelBuffer, TILE, dirOf, type Drawable, type ItemOptions, type PersonAction } from '../types.ts';
import { P } from '../palette.ts';
import { drawFloor, drawItem, drawWalls } from '../furniture.ts';
import { drawPerson } from '../people.ts';
import { sortDrawables } from '../projection.ts';
import { savePng } from './png.ts';

const FLOOR = '#d9dde3', WALL = '#cfd8e6';

interface Opts { dark: boolean; frame: number; walls: boolean; people: boolean; activeAll?: boolean }
interface Seat { id: string; x: number; z: number; face: number; action: PersonAction }

/** Every place somebody can sit at an item, in cells (same spots as the 3D world: desk front, team seats, CEO chair, one per sofa seat, one per bed). */
function seatsOf(item: OfficeItem): Seat[] {
  if (item.type === 'desk' || item.type === 'ceodesk') { const p = frontPoint(item, 0.45); return [{ id: 'chair', x: p.x, z: p.z, face: p.face, action: 'type' }]; }
  if (item.type === 'teamdesk') return (item.seats ?? []).map(s => ({ id: s.id, x: item.x + s.dx, z: item.z + s.dz, face: s.face, action: 'type' as const }));
  if (CATALOG[item.type].sit) {
    const f = frontVec(item.rot), c = center(item), { w, d } = footprint(item);
    const n = Math.max(1, Math.floor(f.x ? d : w));
    return Array.from({ length: n }, (_, i) => {
      const lat = i - (n - 1) / 2;
      return { id: `spot${i}`, x: c.x + f.x * 0.12 + f.z * lat, z: c.z + f.z * 0.12 + f.x * lat, face: Math.atan2(f.x, f.z), action: 'sit' as const };
    });
  }
  return [];
}

const names = Object.keys(looks);
let nextLook = 0;

/** Floor, ground layer, then objects by sortY (people after furniture on ties), then walls: how the real view composes it. */
export function compose(items: OfficeItem[], W: number, D: number, o: Opts): PixelBuffer {
  const mx = 10, top = 36, bottom = 22;
  const out = new PixelBuffer(W * TILE + mx * 2, D * TILE + top + bottom);
  out.rect(0, 0, out.w, out.h, o.dark ? P.night : P.asphalt);
  const ox = mx, oy = top;
  // sprites are blitted at whole pixels
  const blitD = (d: Drawable) => out.blit(d.sprite.buf, ox + Math.round(d.x) - d.sprite.ax, oy + Math.round(d.y) - d.sprite.ay);
  blitD(drawFloor(W, D, FLOOR, o.dark));
  const all: (Drawable & { person?: boolean })[] = [];
  items.forEach((it, k) => {
    const seats = seatsOf(it);
    // who works: a desk by the hash bit, a team desk seat by seat, sofas and beds are taken in turns
    const working = (_s: Seat, i: number) => o.activeAll || (it.type === 'teamdesk' ? (hashBit(it) + i) % 2 === 0 : it.type === 'ceodesk' || (it.type === 'desk' ? hashBit(it) === 1 : (k + i) % 3 !== 0));
    const busy = seats.filter((s, i) => working(s, i));
    const opt: ItemOptions = { dark: o.dark, frame: o.frame, active: it.type === 'teamdesk' ? false : o.activeAll || it.type === 'ceodesk' || (it.type === 'desk' && hashBit(it) === 1), activeSeats: it.type === 'teamdesk' ? busy.map(s => s.id) : [] };
    all.push(...drawItem(it, opt));
    if (o.people) for (const s of busy) {
      const look = looks[names[nextLook++ % names.length]!]!;
      const sprite = drawPerson(look, { action: s.action, dir: dirOf(s.face), frame: 0 });
      all.push({ sprite, x: Math.round(s.x * TILE), y: Math.round(s.z * TILE), sortY: s.z * TILE, layer: 'object', person: true });
    }
  });
  if (o.walls) all.push(...drawWalls(W, D, WALL, 2, o.dark));
  for (const d of all.filter(d => d.layer === 'ground')) blitD(d);
  for (const d of sortDrawables(all.filter(d => d.layer === 'object'))) blitD(d);
  return out;
}
const hashBit = (it: OfficeItem) => ((it.x * 7 + it.z * 13) % 5) < 3 ? 1 : 0;

function agents(n: number, teams: string[]): PlanAgent[] {
  return Array.from({ length: n }, (_, i) => ({ id: `a${i}`, team: teams[i % teams.length] ?? '', hiredAt: i }));
}

/** Left to right, wrapping at `width` scene px; every cell keeps its own size. */
function flow(cells: PixelBuffer[], width: number, gap = 4): PixelBuffer {
  const pos: [number, number][] = [];
  let x = gap, y = gap, rowH = 0;
  for (const c of cells) {
    if (x + c.w > width && x > gap) { x = gap; y += rowH + gap; rowH = 0; }
    pos.push([x, y]); x += c.w + gap; rowH = Math.max(rowH, c.h);
  }
  const out = new PixelBuffer(width, y + rowH + gap);
  cells.forEach((c, i) => out.blit(c, pos[i]![0], pos[i]![1]));
  return out;
}

function itemsSheets(): { main: PixelBuffer; side: PixelBuffer } {
  const cells: PixelBuffer[] = [];
  const types = Object.keys(CATALOG) as ItemType[];
  const mk = (item: OfficeItem, o: Partial<Opts> = {}) => {
    const fp = footprint(item);
    const W = fp.w + 3, D = fp.d + 4;
    return compose([{ ...item, x: 1, z: 3 }], W, D, { dark: false, frame: 0, walls: false, people: false, ...o });
  };
  const seats = [0, 1, 2, 3].map(i => ({ id: 's' + i, dx: 0.75 + i * 1.5, dz: i % 2 ? 2.45 : -0.45, face: i % 2 ? Math.PI : 0 }));
  const base = (t: ItemType): OfficeItem => t === 'zone' ? { type: t, x: 0, z: 0, w: 4, d: 3, tint: '#e8f0ff' }
    : t === 'parking' ? { type: t, x: 0, z: 0, w: 3, d: 2 }
    : t === 'teamdesk' ? { type: t, x: 0, z: 0, w: 6, d: 2, seats }
    : t === 'wall' ? { type: t, x: 0, z: 0, links: 'es' } : { type: t, x: 0, z: 0 };
  const side: PixelBuffer[] = [];
  for (const t of types) for (const rot of [0, 180]) cells.push(mk({ ...base(t), rot }));
  for (const t of types) for (const rot of [90, 270]) side.push(mk({ ...base(t), rot }));
  for (const t of ['desk', 'ceodesk', 'teamdesk', 'arcade'] as ItemType[]) {
    cells.push(mk({ ...base(t), rot: 0 }, { activeAll: true }), mk({ ...base(t), rot: 0 }, { activeAll: true, frame: 1 }), mk({ ...base(t), rot: 0 }, { activeAll: true, dark: true }), mk({ ...base(t), rot: 180 }, { activeAll: true }));
  }
  for (const t of ['lamp', 'coffee', 'sofa', 'bed'] as ItemType[]) cells.push(mk({ ...base(t), rot: 0 }, { dark: true }), mk({ ...base(t), rot: 0 }, { frame: 1 }), mk({ ...base(t), rot: 180 }, { dark: true }), mk({ ...base(t), rot: 0 }));
  // walls as they join: a little room with a door
  const roomWalls: OfficeItem[] = [];
  for (let x = 0; x < 6; x++) { roomWalls.push({ type: 'wall', x, z: 0, links: x === 0 ? 'es' : x === 5 ? 'ws' : 'ew' }); if (x !== 2 && x !== 3) roomWalls.push({ type: 'wall', x, z: 3, links: x === 0 ? 'en' : x === 5 ? 'wn' : 'ew' }); }
  for (const z of [1, 2]) roomWalls.push({ type: 'wall', x: 0, z, links: 'ns' }, { type: 'wall', x: 5, z, links: 'ns' });
  cells.push(compose([{ type: 'zone', x: 1, z: 1, w: 4, d: 2, tint: '#e9f8ef' }, ...roomWalls.map(w => ({ ...w, x: w.x, z: w.z })), { type: 'desk', x: 2, z: 1, rot: 0 }], 6, 5, { dark: false, frame: 0, walls: false, people: false }));
  return { main: flow(cells, 560), side: flow(side, 560) };
}

function office(n: number, teams: string[], dark: boolean): PixelBuffer {
  const plan = planOffice(agents(n, teams));
  return compose(plan.items, plan.width, plan.depth, { dark, frame: 0, walls: true, people: true });
}

if (/sheetOffice\.ts$/.test(process.argv[1] ?? '')) main();

function main() {
  const out = process.argv[2];
  if (!out) throw new Error('usage: sheetOffice.ts <outDir>');
  mkdirSync(out, { recursive: true });
  const it = itemsSheets();
  savePng(join(out, 'items.png'), it.main, 4);
  savePng(join(out, 'items-90-270.png'), it.side, 4);
  savePng(join(out, 'office-12.png'), office(12, ['Alpha', 'Beta', ''], false), 4);
  savePng(join(out, 'office-30.png'), office(30, ['Alpha', 'Beta', 'Gamma', '', ''], false), 4);
  savePng(join(out, 'office-30-dark.png'), office(30, ['Alpha', 'Beta', 'Gamma', '', ''], true), 4);
  console.log('written to', out);
}

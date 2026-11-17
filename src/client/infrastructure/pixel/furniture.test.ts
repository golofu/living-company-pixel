import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, center, footprint, frontPoint, frontVec, type ItemType, type OfficeItem } from '../../../shared/catalog.ts';
import { planOffice } from '../../../shared/layout.ts';
import { looks } from '../../domain/looks.ts';
import { TILE, WALL_H, dirOf, type Drawable, type ItemOptions, type PersonAction, type Sprite } from './types.ts';
import { drawPerson } from './people.ts';
import { sortDrawables } from './projection.ts';
import { CACHE_LIMITS, cacheStats, drawFloor, drawItem, drawWalls, orderDiagnostics } from './furniture.ts';

const LIGHT: ItemOptions = { dark: false, frame: 0 };
const types = Object.keys(CATALOG) as ItemType[];
const SEATS = [0, 1, 2, 3].map(i => ({ id: 's' + i, dx: 0.75 + i * 1.5, dz: i % 2 ? 2.45 : -0.45, face: i % 2 ? Math.PI : 0 }));

function sample(type: ItemType, rot = 0): OfficeItem {
  const base: OfficeItem = { type, x: 4, z: 5, rot };
  if (type === 'zone') return { ...base, w: 4, d: 3, tint: '#e8f0ff', label: 'Z' };
  if (type === 'parking') return { ...base, w: 5, d: 2 };
  if (type === 'teamdesk') return { ...base, w: 6, d: 2, seats: SEATS };
  if (type === 'wall') return { ...base, links: 'es' };
  return base;
}
const GROUND: ItemType[] = ['zone', 'rug', 'parking'];
const main = (ds: Drawable[]) => ds.find(d => d.layer === 'object') ?? ds[0]!;
const px = (d: Drawable) => d.sprite.buf.data;
const same = (a: Drawable, b: Drawable) => a.sprite.buf.w === b.sprite.buf.w && a.sprite.buf.h === b.sprite.buf.h && px(a).every((v, i) => v === px(b)[i]);

test('every catalog type draws pixels in at least four colours, not a flat block', () => {
  for (const t of types) for (const rot of [0, 90, 180, 270]) {
    const ds = drawItem(sample(t, rot), LIGHT);
    assert.ok(ds.length >= 1, t);
    const count = new Map<number, number>();
    for (const c of px(main(ds))) if ((c & 255) >= 200) count.set(c, (count.get(c) ?? 0) + 1);
    const solid = [...count.values()].reduce((a, b) => a + b, 0);
    assert.ok(count.size >= 4, `${t} rot ${rot} uses only ${count.size} opaque colours`);
    assert.ok(Math.max(...count.values()) < solid * 0.9, `${t} rot ${rot}: one colour fills ${(100 * Math.max(...count.values()) / solid).toFixed(0)}% of it`);
    for (const d of ds) assert.ok(d.sprite.buf.filled() > 0, `${t} has an empty part`);
  }
});

/** Opaque (alpha >= 200, so no soft shadow) bounding box of the sprites that share the main sprite's frame, in scene pixels. */
function solidBox(ds: Drawable[]) {
  const m = main(ds);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const d of ds) {
    if (d.x !== m.x || d.y !== m.y || d.sprite.buf.w !== m.sprite.buf.w || d.sprite.buf.h !== m.sprite.buf.h) continue;
    const b = d.sprite.buf;
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if ((b.data[y * b.w + x]! & 255) >= 200) {
      x0 = Math.min(x0, d.x - d.sprite.ax + x); x1 = Math.max(x1, d.x - d.sprite.ax + x + 1);
      y0 = Math.min(y0, d.y - d.sprite.ay + y); y1 = Math.max(y1, d.y - d.sprite.ay + y + 1);
    }
  }
  return { x0, y0, x1, y1 };
}

test('the opaque pixels of every sprite sit over the footprint, also after a quarter turn', () => {
  for (const t of types) for (const rot of [0, 90, 180, 270]) {
    // a team desk keeps its own seats and ignores rot (the world never turns one)
    if (t === 'teamdesk' && rot % 180) continue;
    const item = sample(t, rot), fp = footprint(item), b = solidBox(drawItem(item, LIGHT));
    const fx0 = item.x * TILE, fy0 = item.z * TILE, fx1 = fx0 + fp.w * TILE, fy1 = fy0 + fp.d * TILE;
    const tag = `${t} rot ${rot}: opaque box x ${b.x0 - fx0}..${b.x1 - fx1} y ${b.y0 - fy0}..${b.y1 - fy1} (relative to the ${fp.w}x${fp.d} footprint)`;
    assert.ok(b.x0 >= fx0 - 1 && b.x1 <= fx1 + 1, tag);
    assert.ok(b.x1 - b.x0 >= (fx1 - fx0) * 0.45, `${tag}: too narrow, the sprite did not follow the footprint`);
    assert.ok(b.y1 <= fy1 + 2 && b.y1 >= fy1 - 14, tag);
    if (!GROUND.includes(t)) assert.ok(b.y0 < fy1, `${t} rises over its footprint`);
    else for (const [got, want] of [[b.x0, fx0], [b.y0, fy0], [b.x1, fx1], [b.y1, fy1]] as const) assert.ok(Math.abs(got - want) <= 1, `${t} rot ${rot} covers its footprint (rug fringe aside): ${got} vs ${want}`);
  }
});

test('items that rise show a face: standing things are taller than their footprint', () => {
  for (const t of ['desk', 'bookshelf', 'fridge', 'arcade', 'plant', 'lamp', 'gclass', 'wall', 'cooler'] as ItemType[]) {
    const item = sample(t), d = main(drawItem(item, LIGHT));
    assert.ok(d.sprite.ay > 8, `${t} ay=${d.sprite.ay}`);
  }
});

test('rot 90 swaps the buffer shape of non-square items; every item that has a front looks different in all four rotations', () => {
  for (const t of types) {
    const fp = footprint(sample(t));
    if (fp.w === fp.d || t === 'teamdesk') continue;
    const a = main(drawItem(sample(t, 0), LIGHT)), b = main(drawItem(sample(t, 90), LIGHT));
    assert.ok(a.sprite.buf.w !== b.sprite.buf.w || a.sprite.buf.h !== b.sprite.buf.h, `${t} size should change at rot 90`);
  }
  const SYMMETRIC: ItemType[] = ['wall', 'rug', 'teamdesk', 'parking', 'zone']; // drawn the same whatever the rot
  const look = (t: ItemType, rot: number) => drawItem(sample(t, rot), LIGHT).map(d => `${d.sprite.buf.w}x${d.sprite.buf.h}:${px(d).join(',')}`).join('|');
  for (const t of types) {
    const looks4 = new Set([0, 90, 180, 270].map(r => look(t, r)));
    if (SYMMETRIC.includes(t)) assert.equal(look(t, 0), look(t, 180), `${t} is the same at rot 0 and 180`);
    else assert.equal(looks4.size, 4, `${t} should look different at rot 0, 90, 180 and 270 (${looks4.size} distinct)`);
  }
});

test('layers and sortY', () => {
  for (const t of types) {
    const item = sample(t), fp = footprint(item), top = item.z * TILE, base = (item.z + fp.d) * TILE;
    const ds = drawItem(item, LIGHT);
    if (GROUND.includes(t)) { assert.ok(ds.every(d => d.layer === 'ground'), t); continue; }
    assert.equal(main(ds).layer, 'object', t);
    if (t === 'meeting' || t === 'dining') {
      assert.equal(main(ds).sortY, top + fp.d * TILE / 2, `${t}: the table sorts at its middle line, between the chairs on both sides`);
      assert.ok(ds.every(d => d.sortY >= top - 4 && d.sortY <= base + 4), `${t}: chairs sort around the footprint`);
    } else if (t === 'sofa' || t === 'bed') {
      // sliced behind and in front of the sitter: the last slice sorts at the bottom edge, the first one behind the sitter
      const sy = ds.map(d => d.sortY);
      assert.ok(ds.length >= 2, `${t} is sliced`);
      assert.equal(Math.max(...sy), base, `${t}: the front slice sorts at the bottom edge`);
      assert.ok(Math.min(...sy) >= top && Math.min(...sy) < base - 4, `${t}: the back slice sorts inside the footprint, above the front slice`);
    } else assert.equal(main(ds).sortY, base, `${t} sortY should be the bottom edge`);
  }
});

test('chairs overlap the sitter by sortY rule, for every desk in every rotation and every team seat', () => {
  // `seat` = where the sitter's feet are (scene px) and which way they look; the chair parts under that point are the ones to check
  const check = (tag: string, ds: Drawable[], seat: { x: number; z: number; face: number }) => {
    const sy = seat.z * TILE, dir = dirOf(seat.face);
    const parts = ds.slice(1).filter(d => Math.abs(d.sortY - sy) <= 5.5);
    assert.ok(parts.length >= 1, `${tag}: no chair under the sitter at y ${sy}`);
    if (dir === 'up') {
      assert.ok(parts.some(d => d.sortY > sy), `${tag}: person looks north, the chair back is drawn over them`);
      assert.ok(parts.some(d => d.sortY < sy), `${tag}: they sit on the seat, which is drawn under them`);
    } else assert.ok(parts.every(d => d.sortY < sy), `${tag}: person looks ${dir}, the chair is drawn under them`);
    if (dir === 'up') assert.ok(main(ds).sortY < sy, `${tag}: a sitter south of the desk is drawn over it`);
    if (dir === 'down') assert.ok(main(ds).sortY > sy, `${tag}: a sitter north of the desk is hidden by it to the waist`);
  };
  for (const type of ['desk', 'ceodesk'] as const) for (const rot of [0, 90, 180, 270]) {
    const item: OfficeItem = { type, x: 6, z: 7, rot };
    check(`${type} r${rot}`, drawItem(item, LIGHT), frontPoint(item, 0.45));
  }
  const td = { ...sample('teamdesk'), id: 'td' };
  const tds = drawItem(td, LIGHT);
  for (const s of SEATS) check(`teamdesk seat ${s.id}`, tds, { x: td.x + s.dx, z: td.z + s.dz, face: s.face });
  // and the original two cases, spelled out
  const d0 = drawItem({ type: 'desk', x: 4, z: 5, rot: 0 }, LIGHT), d180 = drawItem({ type: 'desk', x: 4, z: 5, rot: 180 }, LIGHT);
  const seatSouth = (5 + 1 + 0.45) * TILE, seatNorth = (5 - 0.45) * TILE;
  assert.equal(d0.length, 3, 'desk, then the chair seat and the chair back as two sprites');
  assert.equal(d180.length, 2);
  assert.ok(d0[2]!.sortY > seatSouth && d0[1]!.sortY < seatSouth);
  assert.ok(d180[1]!.sortY < seatNorth, 'person looks south: chair drawn under them');
});

test('active desk differs from idle; dark differs from light; frames animate; cache returns the same object', () => {
  for (const t of ['desk', 'teamdesk', 'ceodesk'] as ItemType[]) {
    const idle = main(drawItem(sample(t), LIGHT)), on = main(drawItem(sample(t), { ...LIGHT, active: true }));
    assert.ok(!same(idle, on), `${t} screen on`);
    assert.ok(!same(on, main(drawItem(sample(t), { ...LIGHT, active: true, frame: 1 }))), `${t} animates`);
  }
  for (const t of types) assert.ok(!same(main(drawItem(sample(t), LIGHT)), main(drawItem(sample(t), { ...LIGHT, dark: true }))), `${t} dark`);
  const a = drawItem(sample('desk'), LIGHT), b = drawItem({ ...sample('desk'), x: 9 }, LIGHT);
  assert.equal(a[0]!.sprite, b[0]!.sprite);
  assert.equal(drawItem(sample('desk'), { ...LIGHT, frame: 2 })[0]!.sprite, a[0]!.sprite, 'frames 0 and 2 are the same picture');
  assert.equal(drawFloor(10, 8, '#d9dde3', false), drawFloor(10, 8, '#d9dde3', false));
});

test('tint recolours zones; zones have a border and fill', () => {
  const a = drawItem({ ...sample('zone'), tint: '#e8f0ff' }, LIGHT)[0]!, b = drawItem({ ...sample('zone'), tint: '#fdeef3' }, LIGHT)[0]!;
  assert.equal(a.sprite.buf.w, 4 * TILE); assert.equal(a.sprite.buf.h, 3 * TILE);
  assert.equal(a.sprite.buf.filled(), a.sprite.buf.w * a.sprite.buf.h);
  assert.ok(!same(a, b));
  assert.notEqual(a.sprite.buf.get(0, 20), a.sprite.buf.get(20, 20), 'border differs from the middle');
});

test('teamdesk has one lit screen per seat', () => {
  const off = main(drawItem(sample('teamdesk'), LIGHT)), on = main(drawItem(sample('teamdesk'), { ...LIGHT, active: true }));
  const diff = (a: Drawable, b: Drawable) => px(a).reduce((n, v, i) => n + (v !== px(b)[i] ? 1 : 0), 0);
  assert.ok(diff(off, on) > 50, 'the lit screens facing the viewer change');
  assert.equal(drawItem(sample('teamdesk'), LIGHT).length, 1 + SEATS.length + SEATS.filter(s => s.dz > 1).length, 'a chair per seat, in two sprites where the sitter looks north');
});

test('full layouts for 5, 12 and 30 agents draw every item', () => {
  for (const n of [5, 12, 30]) {
    const agents = Array.from({ length: n }, (_, i) => ({ id: 'a' + i, team: ['A', 'B', 'C', '', ''][i % 5]!, hiredAt: i }));
    const plan = planOffice(agents);
    const seen = new Set<string>();
    for (const dark of [false, true]) for (const it of plan.items) {
      const ds = drawItem(it, { dark, frame: n % 3, active: it.type === 'desk' && n % 2 === 0 });
      assert.ok(ds.length >= 1, it.type);
      for (const d of ds) { assert.ok(Number.isFinite(d.x + d.y + d.sortY)); seen.add(it.type); }
    }
    for (const t of ['zone', 'wall', 'desk', 'teamdesk', 'gclass', 'parking', 'sofa', 'plant'] as ItemType[]) if (n === 30) assert.ok(seen.has(t), `layout of ${n} has ${t}`);
    assert.ok(drawFloor(plan.width, plan.depth, '#d9dde3', false));
    assert.ok(drawWalls(plan.width, plan.depth, '#cfd8e6', 2, false).length >= 4);
  }
});

test('floor covers the whole office; darker at night', () => {
  const f = drawFloor(12, 9, '#d9dde3', false), n = drawFloor(12, 9, '#d9dde3', true);
  assert.equal(f.layer, 'ground');
  assert.equal(f.sprite.buf.w, 12 * TILE); assert.equal(f.sprite.buf.h, 9 * TILE);
  assert.equal(f.sprite.buf.filled(), 12 * TILE * 9 * TILE);
  const lum = (c: number) => (c >>> 24) + ((c >>> 16) & 255) + ((c >>> 8) & 255);
  assert.ok(lum(n.sprite.buf.get(40, 40)) < lum(f.sprite.buf.get(40, 40)));
  const distinct = new Set(Array.from(f.sprite.buf.data).slice(0, 4000));
  assert.ok(distinct.size > 6, 'the floor has gentle variation');
});

test('walls: north face is WALL_H tall, south wall leaves the door gap empty and sorts over people inside', () => {
  const W = 20, D = 14, door = 2;
  const ds = drawWalls(W, D, '#cfd8e6', door, false);
  const north = ds.find(d => d.y < 0 && d.sprite.buf.w > W * TILE)!;
  assert.ok(north, 'north wall');
  assert.ok(north.sprite.buf.h - north.sprite.ay >= WALL_H - 2 || north.sprite.ay >= WALL_H, 'north wall shows a full face');
  assert.ok(north.x <= 0 && north.x + north.sprite.buf.w - north.sprite.ax >= W * TILE);
  assert.ok(north.sortY <= 0);
  const south = ds.filter(d => d.layer === 'object' && d.y >= D * TILE);
  assert.equal(south.length, 2, 'two pieces left and right of the entrance');
  const g0 = W * TILE / 2 - door * TILE / 2, g1 = g0 + door * TILE;
  for (const d of south) {
    assert.ok(d.sortY >= D * TILE, 'drawn over people standing just inside');
    const left = d.x - d.sprite.ax;
    for (let y = 0; y < d.sprite.buf.h; y++) for (let x = 0; x < d.sprite.buf.w; x++) {
      const sx = left + x;
      if (sx >= g0 && sx < g1) assert.equal(d.sprite.buf.get(x, y) & 255, 0, `filled pixel in the door gap at ${sx}`);
    }
  }
  assert.ok(south.some(d => d.x - d.sprite.ax + d.sprite.buf.w <= g0 + 8) && south.some(d => d.x - d.sprite.ax >= g1 - 8));
  assert.ok(ds.some(d => d.layer === 'ground'), 'door mat');
  assert.ok(ds.filter(d => d.layer === 'object').length >= 5, 'north, west, east and two south pieces');
  assert.ok(!drawWalls(W, D, '#cfd8e6', door, false).every((d, i) => drawWalls(W, D, '#cfd8e6', door, true)[i]!.sprite === d.sprite), 'night walls differ');
});

test('wall cells join their neighbours', () => {
  const a = main(drawItem({ type: 'wall', x: 1, z: 1, links: 'ew' }, LIGHT)), b = main(drawItem({ type: 'wall', x: 1, z: 1, links: 'ns' }, LIGHT));
  assert.ok(!same(a, b));
  assert.equal(a.sprite.buf.w, TILE);
  // a straight run leaves no gap at the cell edges
  const row = a.sprite.ay + 8 - 4;
  assert.ok(a.sprite.buf.get(0, row) & 255 && a.sprite.buf.get(TILE - 1, row) & 255);
});

test('teamdesk lights only the screens of the seats that are working', () => {
  const item = { id: 'team', type: 'teamdesk' as const, x: 2, z: 2, w: 4, d: 2, seats: [
    { id: 'seat-a', dx: 1, dz: 2, face: Math.PI }, { id: 'seat-b', dx: 3, dz: 2, face: Math.PI }, { id: 'seat-c', dx: 1, dz: 0, face: 0 },
  ] };
  const pixels = (activeSeats: string[]) => drawItem(item, { dark: false, frame: 0, activeSeats }).flatMap(d => [...d.sprite.buf.data]).join(',');
  const none = pixels([]), a = pixels(['seat-a']), b = pixels(['seat-b']), all = pixels(['seat-a', 'seat-b', 'seat-c']);
  assert.notEqual(a, none, 'one working seat changes the picture');
  assert.notEqual(a, b, 'which seat works matters');
  assert.notEqual(a, all, 'one working seat is not the whole desk lit');
});

test('draw order has no cycles for any item, rotation or seat layout', () => {
  const before = orderDiagnostics.cycles;
  const bad: string[] = [];
  const seatLayouts = [SEATS, SEATS.slice(0, 2), [0, 1, 2, 3, 4, 5].map(i => ({ id: 'q' + i, dx: 0.75 + (i >> 1) * 1.5, dz: i % 2 ? 2.45 : -0.45, face: i % 2 ? Math.PI : 0 }))];
  for (const t of types) for (const rot of [0, 90, 180, 270]) for (const dark of [false, true]) for (const frame of [0, 1]) {
    const lists = t === 'teamdesk' ? seatLayouts : [undefined];
    for (const seats of lists) {
      const item = seats ? { ...sample(t, rot), seats, w: Math.max(2, Math.ceil(seats.length / 2)) * 2 } : sample(t, rot);
      const at = orderDiagnostics.cycles;
      drawItem(item, { dark, frame, active: true, activeSeats: (seats ?? []).map(s => s.id) });
      drawItem(item, { dark, frame, activeSeats: [] });
      if (orderDiagnostics.cycles !== at) bad.push(`${t} r${rot}${seats ? ' seats' + seats.length : ''}`);
    }
  }
  assert.equal(orderDiagnostics.cycles, before, `cycle guard fired for: ${[...new Set(bad)].join(', ')}`);
});

test('every seat of a team desk, north or south, lights its own laptop', () => {
  const diff = (id: string) => {
    const on = drawItem({ ...sample('teamdesk'), id: 'td' }, { ...LIGHT, activeSeats: [id] }), off = drawItem({ ...sample('teamdesk'), id: 'td' }, { ...LIGHT, activeSeats: [] });
    return on.reduce((n, d, k) => n + px(d).reduce((m, v, i) => m + (v !== px(off[k]!)[i] ? 1 : 0), 0), 0);
  };
  for (const s of SEATS) assert.ok(diff(s.id) >= 3, `seat ${s.id} (dz ${s.dz}) changes ${diff(s.id)} px`);
});

// ---------------------------------------------------------------------------------------------- seated people stay readable

interface Seated { tag: string; kind: string; sprite: Sprite; x: number; y: number; item: OfficeItem }
const lookNames = Object.keys(looks);

/** Where people sit at one item: the desk seat, each team seat, the CEO chair, each sofa or bed spot (same geometry as the 3D world's spotsOf). */
function seatsAt(item: OfficeItem, action: PersonAction, n: { k: number }): Seated[] {
  const spots: { x: number; z: number; face: number; kind: string }[] = [];
  const rot = ((item.rot || 0) % 360 + 360) % 360;
  if (item.type === 'desk' || item.type === 'ceodesk') { const p = frontPoint(item, 0.45); spots.push({ ...p, kind: `${item.type} r${rot}` }); }
  else if (item.type === 'teamdesk') for (const s of item.seats ?? []) spots.push({ x: item.x + s.dx, z: item.z + s.dz, face: s.face, kind: `teamdesk ${s.dz < 1 ? 'north' : 'south'} seat` });
  else if (CATALOG[item.type].sit) {
    const f = frontVec(item.rot), c = center(item), { w, d } = footprint(item);
    const count = Math.max(1, Math.floor((f.x ? d : w) / 1));
    for (let i = 0; i < count; i++) { const lat = (i - (count - 1) / 2) * 1; spots.push({ x: c.x + f.x * 0.12 + f.z * lat, z: c.z + f.z * 0.12 + f.x * lat, face: Math.atan2(f.x, f.z), kind: `${item.type} r${rot} spot ${i}/${count}` }); }
  }
  return spots.map(s => {
    const look = looks[lookNames[n.k++ % lookNames.length]!]!;
    return { tag: `${s.kind} at ${item.x},${item.z} ${action}`, kind: s.kind, item, sprite: drawPerson(look, { action, dir: dirOf(s.face), frame: 0 }), x: Math.round(s.x * TILE), y: Math.round(s.z * TILE) };
  });
}

type Sorted = Drawable & { person?: true; seated?: Seated; owner?: OfficeItem };

/** Draws everything in the view's sort order and says how much of each seated person is still visible (opaque pixels not covered by a later drawable). */
function seatedVisibility(plan: { width: number; depth: number; items: OfficeItem[] }, deskAction: PersonAction, dark = false) {
  const n = { k: 0 };
  const list: Sorted[] = [];
  for (const it of plan.items) {
    for (const d of drawItem(it, { dark, frame: 0, active: true, activeSeats: (it.seats ?? []).map(s => s.id) })) if (d.layer === 'object') list.push({ ...d, owner: it });
    for (const s of seatsAt(it, CATALOG[it.type].sit ? 'sit' : deskAction, n)) list.push({ sprite: s.sprite, x: s.x, y: s.y, sortY: s.y, layer: 'object', person: true, seated: s });
  }
  for (const d of drawWalls(plan.width, plan.depth, '#cfd8e6', 2, dark)) if (d.layer === 'object') list.push(d);
  const sorted = sortDrawables(list);
  const origin = (d: Drawable) => [Math.round(d.x) - d.sprite.ax, Math.round(d.y) - d.sprite.ay] as const;
  const out: { tag: string; kind: string; visible: number; headHidden: number; headHiddenByOwn: number }[] = [];
  sorted.forEach((p, mine) => {
    if (!p.seated) return;
    const [ox, oy] = origin(p), b = p.sprite.buf;
    const later = sorted.slice(mine + 1).filter(d => { const [lx, ly] = origin(d); return lx < ox + b.w && lx + d.sprite.buf.w > ox && ly < oy + b.h && ly + d.sprite.buf.h > oy; });
    let total = 0, hidden = 0, topRow = -1, headHidden = 0, headHiddenByOwn = 0;
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      if ((b.data[y * b.w + x]! & 255) < 200) continue;
      if (topRow < 0) topRow = y;
      total++;
      let covered = false, own = false;
      for (const d of later) {
        const [lx, ly] = origin(d), dx = ox + x - lx, dy = oy + y - ly;
        if (dx >= 0 && dy >= 0 && dx < d.sprite.buf.w && dy < d.sprite.buf.h && (d.sprite.buf.data[dy * d.sprite.buf.w + dx]! & 255) >= 200) { covered = true; own = d.owner === p.seated.item; if (own) break; }
      }
      if (covered) { hidden++; if (y < topRow + 10) { headHidden++; if (own) headHiddenByOwn++; } }
    }
    out.push({ tag: p.seated.tag, kind: p.seated.kind, visible: 1 - hidden / total, headHidden, headHiddenByOwn });
  });
  return out;
}

test('seated people stay readable at every desk, team seat, CEO chair, sofa and bed (5, 12 and 30 agents)', () => {
  const kinds = new Set<string>(), worst = new Map<string, string>();
  for (const count of [5, 12, 30]) {
    const plan = planOffice(Array.from({ length: count }, (_, i) => ({ id: 'a' + i, team: ['A', 'B', 'C', '', ''][i % 5]!, hiredAt: i })));
    for (const action of ['type', 'sit'] as const) for (const v of seatedVisibility(plan, action)) {
      kinds.add(v.kind);
      // the seat's own furniture may not touch the head; a neighbour's edge may clip a nose tip (the CEO sofa sits right beside the CEO desk)
      if (v.visible < 0.45 || v.headHiddenByOwn > 0 || v.headHidden > 12) worst.set(v.kind, `${v.tag}: ${(v.visible * 100).toFixed(0)}% visible, ${v.headHidden} head px hidden (${v.headHiddenByOwn} by its own item)`);
    }
  }
  assert.deepEqual([...worst.values()], [], 'seated people too hidden');
  for (const k of ['desk r0', 'desk r180', 'ceodesk r180', 'teamdesk north seat', 'teamdesk south seat', 'sofa r180 spot 0/2', 'sofa r270 spot 0/2', 'sofa r270 spot 1/2', 'bed r0 spot 0/1']) assert.ok(kinds.has(k), `the layouts never seat anyone at ${k}`);
});

test('a sitter on a sofa or bed is readable in every rotation and at night', () => {
  const bad: string[] = [];
  for (const type of ['sofa', 'bed'] as const) for (const rot of [0, 90, 180, 270]) for (const dark of [false, true]) {
    const vis = seatedVisibility({ width: 8, depth: 8, items: [{ type, x: 3, z: 3, rot, id: 'x' }] }, 'sit', dark);
    assert.ok(vis.length >= 1, `${type} r${rot} has a spot`);
    for (const v of vis) if (v.visible < 0.45 || v.headHidden > 0) bad.push(`${v.tag}${dark ? ' dark' : ''}: ${(v.visible * 100).toFixed(0)}% visible, ${v.headHidden} head px hidden`);
  }
  assert.deepEqual(bad, []);
});

test('a big office draws its floor, walls and zones fast enough for the first frame', () => {
  // generous limits (about 4x what a slow machine needs); the old per-pixel shading took 250-300 ms for the floor alone
  const time = (f: () => void) => { const t = performance.now(); f(); return performance.now() - t; };
  const floor = time(() => drawFloor(45, 36, '#d1d9e0', false));
  assert.ok(floor < 150, `drawFloor(45, 36) cold took ${floor.toFixed(0)} ms`);
  const walls = time(() => drawWalls(45, 36, '#cfd8e5', 2, false));
  assert.ok(walls < 60, `drawWalls(45, 36) cold took ${walls.toFixed(0)} ms`);
  const zones = time(() => { for (let i = 0; i < 11; i++) drawItem({ type: 'zone', x: i, z: 0, w: 12, d: 9, tint: i % 2 ? '#e8f0ff' : '#fdeef3', id: 'z' + i }, LIGHT); });
  assert.ok(zones < 120, `11 zones of 12x9 cells took ${zones.toFixed(0)} ms`);
});

test('an odd rotation is drawn the way the catalog footprint reads it', () => {
  // footprint() only turns the item for exactly 90 or 270, so the picture must agree: 45 is not a quarter turn
  for (const t of ['desk', 'sofa', 'bed', 'ceodesk', 'bookshelf', 'pingpong'] as ItemType[]) {
    for (const [odd, canonical] of [[45, 0], [89, 0], [91, 0], [135, 0], [225, 0], [315, 0], [179.5, 0], [360, 0], [450, 90], [-90, 270], [540, 180], [-270, 90]] as const) {
      const a = drawItem({ ...sample(t), rot: odd }, LIGHT), b = drawItem({ ...sample(t), rot: canonical }, LIGHT);
      assert.equal(a[0]!.sprite, b[0]!.sprite, `${t} rot ${odd} should look like rot ${canonical}`);
      const fp = footprint({ ...sample(t), rot: odd }), d = a[0]!;
      assert.ok(d.sprite.buf.w >= fp.w * TILE - 2 && d.sprite.buf.h >= fp.d * TILE - 2, `${t} rot ${odd}: sprite ${d.sprite.buf.w}x${d.sprite.buf.h} does not cover the ${fp.w}x${fp.d} footprint`);
    }
  }
});

test('idle screens do not animate: frame only matters while a screen is on', () => {
  const td = { ...sample('teamdesk'), id: 'td' };
  for (const t of ['desk', 'ceodesk', 'teamdesk'] as ItemType[]) {
    const item = t === 'teamdesk' ? td : sample(t);
    assert.equal(drawItem(item, { dark: false, frame: 0 })[0]!.sprite, drawItem(item, { dark: false, frame: 1 })[0]!.sprite, `${t} idle: frames 0 and 1 are one picture (one cache entry)`);
  }
  assert.notEqual(drawItem(td, { dark: false, frame: 0, activeSeats: ['s1'] })[0]!.sprite, drawItem(td, { dark: false, frame: 1, activeSeats: ['s1'] })[0]!.sprite, 'a working seat animates');
  for (const t of ['arcade', 'coffee'] as ItemType[]) assert.notEqual(drawItem(sample(t), { dark: false, frame: 0 })[0]!.sprite, drawItem(sample(t), { dark: false, frame: 1 })[0]!.sprite, `${t} always animates`);
});

test('caches are bounded and an evicted picture is redrawn identically', () => {
  const seats = Array.from({ length: 10 }, (_, i) => ({ id: 'k' + i, dx: 0.75 + (i >> 1) * 1.5, dz: i % 2 ? 2.45 : -0.45, face: i % 2 ? Math.PI : 0 }));
  const desk = { type: 'teamdesk' as const, id: 'big', x: 2, z: 3, w: 10, d: 2, seats };
  const snapshot = (ids: string[]) => drawItem(desk, { dark: false, frame: 1, activeSeats: ids }).map(d => Array.from(d.sprite.buf.data));
  const first = snapshot(['k0', 'k3', 'k8']);
  for (let mask = 1; mask < 640; mask++) drawItem(desk, { dark: false, frame: mask & 1, activeSeats: seats.filter((_, i) => mask & (1 << i)).map(s => s.id) });
  for (let i = 0; i < 400; i++) drawItem({ type: 'zone', x: 0, z: 0, w: 2, d: 2, tint: '#' + (0x102030 + i * 977).toString(16).padStart(6, '0') }, LIGHT);
  const stats = cacheStats();
  assert.ok(stats.items <= CACHE_LIMITS.items, `item cache holds ${stats.items} pictures, cap ${CACHE_LIMITS.items}`);
  const evicted = snapshot(['k0', 'k3', 'k8']);
  assert.deepEqual(evicted, first, 'redrawing an evicted key gives the same pixels');
  for (let i = 0; i < 12; i++) { drawFloor(6 + i, 5, '#d9dde' + (i % 10), false); drawWalls(6 + i, 5, '#cfd8e6', 2, i % 2 === 0); }
  assert.ok(cacheStats().floors <= CACHE_LIMITS.floors && cacheStats().walls <= CACHE_LIMITS.walls, `floors ${cacheStats().floors}, walls ${cacheStats().walls}`);
  const a = drawFloor(7, 5, '#d9dde1', false);
  for (let i = 0; i < 6; i++) drawFloor(20 + i, 5, '#d9dde3', false);
  const b = drawFloor(7, 5, '#d9dde1', false);
  assert.deepEqual(Array.from(b.sprite.buf.data), Array.from(a.sprite.buf.data), 'an evicted floor is redrawn the same');
});

test('the entrance is exactly doorCells wide, as the opaque pixels of the two south pieces show', () => {
  for (const [W, D, door] of [[20, 14, 2], [30, 20, 3], [13, 9, 1]] as const) for (const dark of [false, true]) {
    const south = drawWalls(W, D, '#cfd8e6', door, dark).filter(d => d.layer === 'object' && d.y >= D * TILE).sort((a, b) => a.x - b.x);
    assert.equal(south.length, 2);
    const span = (d: Drawable) => { let lo = Infinity, hi = -Infinity; const b = d.sprite.buf; for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (b.get(x, y) & 255) { lo = Math.min(lo, x); hi = Math.max(hi, x); } return [d.x - d.sprite.ax + lo, d.x - d.sprite.ax + hi] as const; };
    const [, leftEnd] = span(south[0]!), [rightStart] = span(south[1]!);
    assert.equal(rightStart - leftEnd - 1, door * TILE, `W=${W} door=${door}: the opening between the pieces is ${rightStart - leftEnd - 1} px`);
    assert.equal(leftEnd + 1, (W * TILE - door * TILE) / 2, 'the opening is centred');
  }
});

test('a team desk drawn again after its cache entry is gone has the same pixels, wherever it stands', () => {
  const seats = [0, 1, 2, 3, 4, 5].map(i => ({ id: 'k' + i, dx: 0.75 + Math.floor(i / 2) * 1.5, dz: i % 2 ? 2.45 : -0.45, face: i % 2 ? Math.PI : 0 }));
  const pixels = (x: number) => drawItem({ id: 'team', type: 'teamdesk', x, z: 3, w: 6, d: 2, seats }, { dark: false, frame: 0 }).flatMap(d => [...d.sprite.buf.data]).join(',');
  for (let x = 0; x < 8; x++) {
    const first = pixels(x);
    // push the entry out of the cache, then ask again
    for (let i = 0; i < 320; i++) drawItem({ id: 'filler', type: 'plant', x: 0, z: 0, tint: '#' + (0x100000 + i * 7 + x * 4099).toString(16) }, { dark: false, frame: 0 });
    assert.equal(pixels(x), first, `team desk at x=${x} changed after eviction`);
  }
});

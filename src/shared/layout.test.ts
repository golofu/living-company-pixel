// Automatic office layout tests: `npm test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planOffice, tierFor, teamColors } from './layout.ts';
import { CATALOG, cellsOf, frontPoint, seatPoint, solidGrid, zoneAt, type OfficeItem } from './catalog.ts';
import { findPath } from '../client/infrastructure/three/pathfinding.ts';
import { createT } from './i18n/index.ts';

const agents = (n: number, teamOf: (i: number) => string = () => '') => Array.from({ length: n }, (_, i) => ({ id: 'a' + i, hiredAt: i, team: teamOf(i) }));

// Different sizes and team distributions
const CASES: [string, ReturnType<typeof agents>][] = [];
for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 12, 15, 20, 24, 25, 31, 40]) {
  CASES.push([`${n} people, no teams`, agents(n)]);
  CASES.push([`${n} people, 3 teams`, agents(n, i => ['Frontend', 'Backend', ''][i % 3])]);
}
CASES.push(['single 14-person team (two tables)', agents(18, i => (i < 14 ? 'Büyük' : ''))]);
CASES.push(['one-person teams get no room', agents(4, i => 'T' + i)]);

// Free cells reachable from the entrance (bottom edge center) with a 4-neighbor BFS
function reachable(grid: Uint8Array, W: number, D: number) {
  const start: [number, number] = [Math.floor(W / 2), D - 1];
  assert.equal(grid[start[1] * W + start[0]], 0, 'entrance cell must be free');
  const seen = new Uint8Array(W * D);
  const q = [start];
  seen[start[1] * W + start[0]] = 1;
  while (q.length) {
    const [x, z] = q.pop()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, nz = z + dz, k = nz * W + nx;
      if (nx < 0 || nz < 0 || nx >= W || nz >= D || seen[k] || grid[k]) continue;
      seen[k] = 1;
      q.push([nx, nz]);
    }
  }
  return (x: number, z: number) => !!seen[Math.floor(z) * W + Math.floor(x)];
}

for (const [name, list] of CASES) {
  test(name, () => {
    const p = planOffice(list);
    const { width: W, depth: D, items } = p;

    const ids = new Set<string | undefined>();
    for (const it of items) {
      assert.ok(CATALOG[it.type], `unknown type ${it.type}`);
      assert.ok(!ids.has(it.id), `duplicate id ${it.id}`);
      ids.add(it.id);
    }

    const taken = new Map<string, string | undefined>();
    for (const it of items) {
      for (const [x, z] of cellsOf(it)) {
        assert.ok(x >= 0 && z >= 0 && x < W && z < D, `${it.id} overflows the office`);
        if (!CATALOG[it.type].solid) continue;
        const k = x + ',' + z;
        assert.ok(!taken.has(k), `${it.id} overlaps ${taken.get(k)}`);
        taken.set(k, it.id);
      }
    }

    const grid = solidGrid(items, W, D);
    const ok = reachable(grid, W, D);
    for (const a of list) {
      const seat = seatPoint(items, p.desks[a.id]!);
      assert.ok(seat, `no seat for ${a.id}`);
      assert.ok(ok(seat!.x, seat!.z), `${a.id} cannot walk to their seat`);
    }
    // Beds and sofas are approached from the nearest free cell; the front of the other spots must be reachable
    for (const it of items.filter(i => CATALOG[i.type].poi)) {
      const f = frontPoint(it, 0.5);
      assert.ok(ok(f.x, f.z), `front of ${it.id} is unreachable`);
    }
  });
}

test('tiers', () => {
  assert.deepEqual([1, 3, 4, 5, 6, 7, 8, 10, 11, 21, 25, 26].map(tierFor), [3, 3, 5, 5, 7, 7, 10, 10, 15, 25, 25, 30]);
});

test('zones by tier', () => {
  const types = (n: number) => new Set(planOffice(agents(n)).items.map(i => i.type));
  const labels = (n: number) => new Set(planOffice(agents(n)).items.filter(i => i.type === 'zone').map(i => i.label));
  assert.ok(labels(3).has('Toplantı köşesi') && !labels(3).has('Toplantı odası'), 'open meeting corner at 3 people');
  assert.ok(labels(5).has('Toplantı odası'), 'walled meeting room at 5 people');
  assert.ok(!types(5).has('dining') && types(7).has('dining') && types(7).has('pingpong'));
  assert.ok(!types(7).has('bed') && types(10).has('bed') && types(10).has('arcade'));
});

test('team room and single shared table', () => {
  const list = agents(7, i => (i < 4 ? 'Backend' : ''));
  const p = planOffice(list);
  const tables = p.items.filter(i => i.type === 'teamdesk' && !i.seats?.some(s => s.id.startsWith('hq-')));
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0]!.seats!.map(s => s.id).sort(), list.slice(0, 4).map(a => p.desks[a.id]!).sort());
  assert.ok(p.items.some(i => i.type === 'zone' && i.label === 'Backend'));
});

test('layout and colors are stable', () => {
  const list = agents(9, i => ['Ön', 'Arka', ''][i % 3]);
  assert.deepEqual(planOffice(list), planOffice([...list].reverse()));
  const c = teamColors(list);
  const room = planOffice(list).items.find(i => i.type === 'zone' && i.label === 'Arka');
  assert.equal(room?.tint, c.get('Arka')?.tint);
});

test('CEO room and the car behind it', () => {
  for (const n of [0, 3, 10, 25]) {
    const { items, width: W, depth: D } = planOffice(agents(n, i => (i % 2 ? 'Ekip' : '')));
    const room = items.find(i => i.type === 'zone' && i.label === 'CEO odası');
    const [desk, car] = ['ceodesk', 'gclass'].map(t => items.filter(i => i.type === t)) as [OfficeItem[], OfficeItem[]];
    assert.ok(room?.z !== undefined && room.x !== undefined && room.w !== undefined, 'CEO room exists at every tier');
    assert.equal(desk.length, 1);
    assert.equal(car.length, 1);
    // The car is right behind the room's back (top) wall, within the room width
    const c = cellsOf(car[0]!);
    const carBottom = Math.max(...c.map(([, z]) => z));
    assert.ok(carBottom < room.z && room.z - carBottom <= 2, 'car is not adjacent to the back wall');
    assert.ok(c.every(([x]) => x >= room.x! && x < room.x! + room.w!), 'car is outside the room width');
    // The CEO seat must be reachable; CEO items are closed to agents
    const ok = reachable(solidGrid(items, W, D), W, D);
    const seat = frontPoint(desk[0]!, 0.45);
    assert.ok(ok(seat.x, seat.z), 'CEO seat is unreachable');
    assert.ok(items.filter(i => ['ceodesk', 'gclass', 'parking'].includes(i.type)).every(i => i.private));
  }
});

test('every zone says what kind of room it is, and zoneAt finds the room a point is in', () => {
  const agents = Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, team: i < 4 ? 'Dev' : '', hiredAt: i }));
  const { items } = planOffice(agents);
  const zones = items.filter(i => i.type === 'zone');
  assert.ok(zones.every(z => z.room), 'all zones have a room kind');
  for (const room of ['ceo', 'team', 'workspace', 'coffee', 'meeting'] as const) assert.ok(zones.some(z => z.room === room), room);
  const ceo = zones.find(z => z.room === 'ceo')!;
  assert.equal(zoneAt(items, ceo.x + 2.5, ceo.z + 2.5)?.id, ceo.id);
  assert.equal(zoneAt(items, -5, -5), null);
});

for (const [n, roster] of [[5, 'research'], [8, 'vibecode'], [12, 'film'], [29, 'gas'], [30, 'gas'], [54, 'gas']] as const) {
  test(`HQ grid: ${n} agents with ${roster} roster teams`, () => {
    const source = JSON.parse(readFileSync(new URL(`../../kit-3d/rosters/${roster}.json`, import.meta.url), 'utf8')).agents as { team: string }[];
    const list = agents(n, i => source[i % source.length]!.team);
    const p = planOffice(list, createT('en'));
    const { items, width: W, depth: D } = p;
    const zones = items.filter(i => i.type === 'zone');
    const ceo = zones.find(z => z.room === 'ceo')!, hq = zones.find(z => z.room === 'hq')!;
    assert.equal(ceo.x + ceo.w! / 2, W / 2);
    assert.equal(hq.x + hq.w! / 2, W / 2);
    assert.ok(ceo.z + ceo.d! < hq.z);
    assert.equal(hq.z, ceo.z + ceo.d! + 2, 'HQ directly below the CEO, with a corridor');
    assert.ok(zones.every(z => z.z >= 1), 'top corners may contain rooms alongside the CEO');
    assert.equal(hq.label, 'Main work room');
    const seats = items.flatMap(i => (i.seats ?? []).filter(s => s.id.startsWith('hq-')));
    assert.equal(seats.length, Math.min(24, Math.max(6, Math.ceil(n * 0.6))));
    assert.equal(new Set(seats.map(s => s.id)).size, seats.length);
    assert.equal(Object.keys(p.desks).length, n);
    for (let i = 0; i < zones.length; i++) for (const b of zones.slice(i + 1)) {
      const a = zones[i]!;
      assert.ok(a.x + a.w! <= b.x || b.x + b.w! <= a.x || a.z + a.d! <= b.z || b.z + b.d! <= a.z, `${a.label} overlaps ${b.label}`);
    }
    const grid = solidGrid(items, W, D), ok = reachable(grid, W, D);
    const door = (room: OfficeItem): [number, number] => [room.x + Math.floor((room.w! - 2) / 2), room.z + room.d! - 1];
    const [hx, hz] = door(hq);
    assert.equal(grid[hz * W + hx], 0, 'south-facing HQ door');
    for (let z = hz; z < D; z++) assert.equal(grid[z * W + Math.floor(W / 2)], 0, 'straight entrance corridor');
    assert.ok(findPath(grid, W, D, Math.floor(W / 2), D - 1, hx, hz));
    for (const room of zones.filter(z => z.room === 'team')) {
      const [x, z] = door(room);
      assert.equal(grid[z * W + x], 0);
      assert.ok(findPath(grid, W, D, x, z, hx, hz), `${room.label} cannot reach HQ`);
    }
    for (const id of [...Object.values(p.desks), ...seats.map(s => s.id)]) {
      const point = seatPoint(items, id)!;
      assert.ok(point && ok(point.x, point.z), `unreachable seat ${id}`);
    }
    const solids = new Set<string>();
    for (const item of items.filter(i => CATALOG[i.type].solid)) for (const [x, z] of cellsOf(item)) {
      assert.ok(x >= 0 && x < W && z >= 0 && z < D);
      assert.ok(!solids.has(`${x},${z}`), `solid overlap at ${x},${z}`);
      solids.add(`${x},${z}`);
    }
    assert.deepEqual(p, planOffice([...list].reverse(), createT('en')));
  });
}

// Baselines measured with windows-fixes:src/shared/layout.ts and these exact
// roster orders (no stash). Gas uses the owner's stricter 45x36 reference;
// windows-fixes with the JSON order actually produces 49x38 for that roster.
const OLD_SIZES = { gas: [45, 36], film: [33, 35], vibecode: [37, 28], research: [27, 21] } as const;

for (const roster of ['gas', 'film', 'vibecode', 'research'] as const) {
  test(`compact real roster: ${roster}`, () => {
    const source = JSON.parse(readFileSync(new URL(`../../kit-3d/rosters/${roster}.json`, import.meta.url), 'utf8')).agents as { team: string }[];
    const list = agents(source.length, i => source[i]!.team);
    const { items, width: W, depth: D } = planOffice(list, createT('en'));
    const [oldW, oldD] = OLD_SIZES[roster];
    assert.ok(W * D <= oldW * oldD * 1.25, `${W}x${D} exceeds 1.25 * ${oldW}x${oldD}`);
    const zones = items.filter(i => i.type === 'zone');
    const ceo = zones.find(z => z.room === 'ceo')!, hq = zones.find(z => z.room === 'hq')!;
    assert.ok(Math.abs(ceo.x + ceo.w! / 2 - W / 2) <= 1, 'CEO is centred');
    assert.equal(hq.x + hq.w! / 2, ceo.x + ceo.w! / 2);
    assert.equal(hq.z, ceo.z + ceo.d! + 2);

    const grid = solidGrid(items, W, D), ok = reachable(grid, W, D);
    const doorZ = hq.z + hq.d! - 1, mid = Math.floor(W / 2);
    // The two-cell HQ door opens onto a three-cell aisle below its wall.
    for (let z = doorZ + 1; z < D; z++) for (let x = mid - 1; x <= mid + 1; x++) {
      assert.equal(grid[z * W + x], 0, `blocked entrance aisle at ${x},${z}`);
      assert.ok(!zones.some(r => x >= r.x && x < r.x + r.w! && z >= r.z && z < r.z + r.d!), 'zone in entrance aisle');
    }
    for (const zone of zones.filter(r => ['ceo', 'hq', 'team', 'meeting', 'sleep'].includes(r.room!))) {
      const x = zone.x + Math.floor((zone.w! - 2) / 2), z = zone.z + zone.d! - 1;
      assert.ok(ok(x, z), `${zone.label} door/approach is unreachable`);
    }
    for (const item of items.filter(i => CATALOG[i.type].poi)) {
      const f = frontPoint(item, 0.5);
      assert.ok(ok(f.x, f.z), `${item.id} front is unreachable`);
    }
    for (const agent of list) {
      const point = seatPoint(items, `desk-${agent.id}`)!;
      assert.ok(point && ok(point.x, point.z), `${agent.id} seat is unreachable`);
    }

    // A department can be alongside HQ, immediately below it, or in a top
    // corner connected down its stack to the HQ band through GAP corridors.
    const band = (r: OfficeItem) => r.z < hq.z + hq.d! && r.z + r.d! > hq.z;
    const near = (a: OfficeItem, b: OfficeItem) => {
      const sharedX = a.x < b.x + b.w! && b.x < a.x + a.w!;
      const sharedZ = a.z < b.z + b.d! && b.z < a.z + a.d!;
      return sharedX && Math.max(a.z - b.z - b.d!, b.z - a.z - a.d!) <= 2 ||
        sharedZ && Math.max(a.x - b.x - b.w!, b.x - a.x - a.w!) <= 2;
    };
    const adjacent = new Set(zones.filter(band));
    let changed = true;
    while (changed) {
      changed = false;
      for (const room of zones) if (room !== ceo && !adjacent.has(room) && [...adjacent].some(r => near(room, r))) {
        adjacent.add(room); changed = true;
      }
    }
    for (const room of zones.filter(r => r.room === 'team')) assert.ok(adjacent.has(room), `${room.label} isolated from HQ stacks`);

    // Histogram scan of ALL rectangles outside zones, exempting only the
    // entrance aisle. A broad empty rectangle must fit within 10x10; long,
    // narrow GAP corridors are allowed. This catches the former 30x40 void.
    const heights = new Array<number>(W).fill(0);
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const occupied = z > doorZ && Math.abs(x - mid) <= 1 ||
          zones.some(r => x >= r.x && x < r.x + r.w! && z >= r.z && z < r.z + r.d!);
        heights[x] = occupied ? 0 : heights[x]! + 1;
      }
      for (let left = 0; left < W; left++) {
        let height = D;
        for (let right = left; right < W; right++) {
          height = Math.min(height, heights[right]!);
          const width = right - left + 1;
          if (width > 2 && height > 2) assert.ok(width * height <= 100,
            `${roster} empty rectangle ${width}x${height} at ${left},${z - height + 1}`);
        }
      }
    }
  });
}

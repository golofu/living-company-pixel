// Automatic office layout: builds the office from the headcount and teams.
// Pure module (no three): importable by both the server and the browser.
// Grid space is the same as catalog.ts: 1 cell = 1 unit, (x, z) top-left cell, front faces +z at rot 0.

import type { OfficeItem, RoomKind } from './catalog.ts';
import { DEFAULT_LOCALE, createT, type Translate } from './i18n/index.ts';

export interface PlanAgent { id: string; team?: string; hiredAt?: number }
interface Block { w: number; d: number; items: OfficeItem[] }
interface Zone extends Block {
  label: string;
  room: RoomKind;
  tint: string;
  x?: number;
  z?: number;
  area?: { dx: number; dz: number; w: number; d: number };
}

// Tiers: the office is built for the next number up (after 25, in steps of 10)
const TIERS = [3, 5, 7, 10, 15, 20, 25];
export const tierFor = (n: number) => TIERS.find(t => n <= t) || Math.ceil(n / 10) * 10;

const GAP = 2; // corridor between zones (the zone label is written on the lower corridor)
const MARGIN = 1;
const POD_COLS = 4; // at most 4 columns = 8 desks per desk pod
const TABLE_MAX = 10; // at most 10 people per team table; the rest go to a second table

// Team colors: tint is the room floor, dot is the team list. Team names are sorted alphabetically and take colors in order,
// so the room on the server and the list in the browser show the same color.
const TEAM_COLORS = [
  { tint: '#e8f0ff', dot: '#3b82f6' },
  { tint: '#e9f8ef', dot: '#22c55e' },
  { tint: '#fdeef3', dot: '#ec4899' },
  { tint: '#f3edff', dot: '#8b5cf6' },
  { tint: '#fff4e0', dot: '#f59e0b' },
  { tint: '#e6f7f8', dot: '#14b8a6' },
];
export function teamColors(agents: Pick<PlanAgent, 'team'>[]) {
  const names = [...new Set(agents.map(a => (a.team || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  return new Map(names.map((n, i) => [n, TEAM_COLORS[i % TEAM_COLORS.length]!] as const));
}

// ---------------------------------------------------------------- zone pieces

// Two rows of desks facing each other: the top row chair at z=0, the bottom row chair at z=3
function deskPod(ids: string[]): Block {
  const items: OfficeItem[] = ids.map((id, i) => {
    const col = i >> 1, back = i % 2 === 0;
    return { id, type: 'desk', x: col * 2, z: back ? 1 : 2, rot: back ? 180 : 0 };
  });
  return { w: Math.ceil(ids.length / 2) * 2, d: 4, items };
}

// Split desks into pods, lay pods out in rows of two
function deskBlock(ids: string[]): Block {
  const pods: Block[] = [];
  for (let i = 0; i < ids.length; i += POD_COLS * 2) pods.push(deskPod(ids.slice(i, i + POD_COLS * 2)));
  const items: OfficeItem[] = [];
  let w = 0, d = 0;
  pods.forEach((p, i) => {
    const col = i % 2, row = i >> 1;
    const x = col ? pods[i - 1]!.w + GAP : 0, z = row * (4 + 1);
    items.push(...shift(p.items, x, z));
    w = Math.max(w, x + p.w);
    d = Math.max(d, z + p.d);
  });
  return { w, d, items };
}

// A team's single shared table: seats face each other along the two long edges.
// Seats are relative to the table (dx, dz); the chair rows stay at z=0 and z=3.
const SEAT_GAP = 1.5;
function teamTable(ids: string[]): Block {
  const cols = Math.max(1, Math.ceil(ids.length / 2));
  const w = Math.ceil(cols * SEAT_GAP + 0.5);
  const pad = (w - cols * SEAT_GAP) / 2;
  const seats = ids.map((id, i) => {
    const top = i % 2 === 0;
    return { id, dx: pad + SEAT_GAP / 2 + (i >> 1) * SEAT_GAP, dz: top ? -0.45 : 2.45, face: top ? 0 : Math.PI };
  });
  return { w, d: 4, items: [{ type: 'teamdesk', x: 0, z: 1, w, d: 2, seats }] };
}

// Large team: stack tables vertically (with a corridor between them)
function teamTables(ids: string[]): Block {
  const tables: Block[] = [];
  for (let i = 0; i < ids.length; i += TABLE_MAX) tables.push(teamTable(ids.slice(i, i + TABLE_MAX)));
  const w = Math.max(...tables.map(t => t.w));
  const items = tables.flatMap((t, k) => shift(t.items, Math.floor((w - t.w) / 2), k * (t.d + 1)));
  return { w, d: tables.length * 5 - 1, items };
}

const shift = (items: OfficeItem[], dx: number, dz: number) => items.map(it => ({ ...it, x: it.x + dx, z: it.z + dz }));

// Draws a wall around it; the door is 2 cells in the middle of the bottom wall
function walled(zone: Zone): Zone {
  const W = zone.w + 2, D = zone.d + 2;
  const door = Math.floor((W - 2) / 2);
  const walls: OfficeItem[] = [];
  for (let x = 0; x < W; x++) {
    walls.push({ type: 'wall', x, z: 0 });
    if (x !== door && x !== door + 1) walls.push({ type: 'wall', x, z: D - 1 });
  }
  for (let z = 1; z < D - 1; z++) walls.push({ type: 'wall', x: 0, z }, { type: 'wall', x: W - 1, z });
  return { ...zone, w: W, d: D, items: [...walls, ...shift(zone.items, 1, 1)] };
}

// ---------------------------------------------------------------- zones

// CEO (player) room and the parking lot right outside its back wall. Items are private: agents do not come here in their free time.
const PARK_D = 2;
function ceoOffice(t: Translate): Zone {
  const room = walled({
    label: t('zone.ceo'), room: 'ceo', tint: '#f5eee2', w: 5, d: 5,
    items: [
      { type: 'bookshelf', x: 0, z: 0, rot: 0 },
      { type: 'plant', x: 4, z: 0 },
      { type: 'ceodesk', x: 1, z: 2, rot: 180 }, // The CEO turns their back to the rear wall and faces the door
      { type: 'sofa', x: 4, z: 2, rot: 270 },
      { type: 'plant', x: 4, z: 4 },
    ],
  });
  const carX = Math.floor((room.w - 3) / 2);
  return {
    ...room,
    d: room.d + PARK_D,
    area: { dx: 0, dz: PARK_D, w: room.w, d: room.d }, // floor color and label only on the room
    items: ([
      { type: 'parking', x: carX - 1, z: 0, w: 5, d: PARK_D },
      { type: 'gclass', x: carX, z: 0, rot: 90 },
      ...shift(room.items, 0, PARK_D),
    ] as OfficeItem[]).map((it): OfficeItem => ({ ...it, private: true })),
  };
}

function workspace(ids: string[], t: Translate): Zone {
  const b = deskBlock(ids);
  return { label: t('zone.workspace'), room: 'workspace', tint: '#eef1f5', ...b };
}

function teamRoom(name: string, ids: string[], tint: string, compact = false): Zone {
  const b = teamTables(ids);
  // Small offices keep the same seats and meeting table, with the meeting nook
  // below the shared desk instead of adding a mostly empty strip beside it.
  if (compact && ids.length >= 4 && ids.length <= TABLE_MAX) {
    const w = Math.max(6, b.w + 1); // one free column lets people pass the desk
    return walled({ label: name, room: 'team', tint, w, d: 8,
      items: [
        { type: 'whiteboard', x: 1, z: 0 }, { type: 'plant', x: 0, z: 0 },
        { type: 'plant', x: w - 1, z: 0 },
        ...shift(b.items, 0, 1), { type: 'meeting', x: 1, z: 5 },
      ],
    });
  }
  const items: OfficeItem[] = [
    { type: 'whiteboard', x: 1, z: 0, rot: 0 },
    { type: 'plant', x: 0, z: 0 },
    ...shift(b.items, 1, 1),
  ];
  let w = Math.max(b.w + 2, 5);
  if (ids.length >= 4) {
    items.push({ type: 'meeting', x: w, z: 1, rot: 0 });
    w += 3;
  }
  items.push({ type: 'plant', x: w - 1, z: 0 });
  return walled({ label: name, room: 'team', tint, w, d: b.d + 2, items });
}

function mainWorkRoom(agents: number, t: Translate): Zone {
  const capacity = Math.min(24, Math.max(6, Math.ceil(agents * 0.6)));
  const table = teamTable(Array.from({ length: capacity }, (_, i) => `hq-${i}`));
  // Odd widths keep the CEO, HQ and entrance on exactly the same centre line.
  let w = Math.max(agents <= 5 ? 7 : 9, table.w + (agents <= 5 ? 2 : 4));
  if (w % 2 === 0) w++;
  return walled({
    label: t('zone.hq'), room: 'hq', tint: '#e7f1f4', w, d: agents <= 5 ? 7 : 8,
    items: [
      { type: 'plant', x: 0, z: 0 },
      { type: 'whiteboard', x: 1, z: 0 },
      { type: 'whiteboard', x: w - 3, z: 0 },
      { type: 'plant', x: w - 1, z: 0 },
      ...shift(table.items, Math.floor((w - table.w) / 2), 2),
    ],
  });
}

function meetingRoom(cap: number, t: Translate): Zone {
  const tables = cap >= 10 ? 2 : 1;
  const items: OfficeItem[] = [{ type: 'whiteboard', x: 1, z: 0, rot: 0 }];
  for (let i = 0; i < tables; i++) items.push({ type: 'meeting', x: 1 + i * 2, z: 2, rot: 0 });
  const zone: Zone = { label: t('zone.meetingRoom'), room: 'meeting', tint: '#f1f3f7', w: tables * 2 + 2, d: 5, items };
  if (cap < 5) return { ...zone, label: t('zone.meetingCorner') };
  items.push({ type: 'plant', x: zone.w - 1, z: 0 });
  return walled(zone);
}

function coffeeCorner(t: Translate): Zone {
  return {
    label: t('zone.coffee'), room: 'coffee', tint: '#f7f1ea', w: 3, d: 2,
    items: [{ type: 'coffee', x: 0, z: 0, rot: 0 }, { type: 'cooler', x: 1, z: 0, rot: 0 }, { type: 'plant', x: 2, z: 0 }],
  };
}

function lounge(cap: number, t: Translate): Zone {
  const sofas = cap >= 10 ? 2 : 1;
  const w = sofas * 2 + 2;
  const items: OfficeItem[] = [{ type: 'rug', x: Math.floor((w - 3) / 2), z: 1, rot: 0 }, { type: 'lamp', x: w - 1, z: 0 }];
  for (let i = 0; i < sofas; i++) items.push({ type: 'sofa', x: 1 + i * 2, z: 3, rot: 180 });
  if (cap >= 5) items.push({ type: 'bookshelf', x: 0, z: 0, rot: 0 });
  else items.push({ type: 'plant', x: 0, z: 0 });
  return { label: t('zone.lounge'), room: 'lounge', tint: '#ecf7ee', w, d: 4, items };
}

function dining(cap: number, t: Translate): Zone {
  const tables = cap >= 15 ? 3 : cap >= 10 ? 2 : 1;
  const w = Math.max(5, tables * 4 - 1);
  const items: OfficeItem[] = [
    { type: 'fridge', x: 0, z: 0, rot: 0 },
    { type: 'kitchen', x: 1, z: 0, rot: 0 },
    { type: 'cooler', x: 3, z: 0, rot: 0 },
    { type: 'plant', x: w - 1, z: 0 },
  ];
  for (let i = 0; i < tables; i++) items.push({ type: 'dining', x: i * 4, z: 2, rot: 0 });
  return { label: t('zone.dining'), room: 'dining', tint: '#fbf3e6', w, d: 5, items };
}

function gameArea(cap: number, t: Translate): Zone {
  const tables = cap >= 15 ? 2 : 1;
  const arcades = cap >= 15 ? 4 : cap >= 10 ? 2 : 0;
  const items: OfficeItem[] = [];
  for (let i = 0; i < tables; i++) items.push({ type: 'pingpong', x: i * 4, z: 0, rot: 0 });
  const end = tables * 4;
  for (let i = 0; i < arcades; i++) items.push({ type: 'arcade', x: end + i, z: 0, rot: 0 });
  return { label: t('zone.games'), room: 'games', tint: '#eef0ff', w: arcades ? end + arcades : end - 1, d: 3, items };
}

function sleepRoom(cap: number, t: Translate): Zone {
  const beds = Math.ceil(cap / 3);
  const cols = Math.min(beds, 5);
  const items: OfficeItem[] = [{ type: 'lamp', x: 0, z: 0 }];
  for (let i = 0; i < beds; i++) items.push({ type: 'bed', x: 1 + (i % cols) * 2, z: Math.floor(i / cols) * 4, rot: 0 });
  return walled({ label: t('zone.sleep'), room: 'sleep', tint: '#eef2f7', w: cols * 2 + 1, d: Math.ceil(beds / cols) * 4 - 1, items });
}

// ---------------------------------------------------------------- placement

// Four stacks: L / CL / CR / R. Only the three-cell entrance aisle is reserved
// below HQ. Try fitting top-row rooms beside the CEO, then greedily place each
// remaining room on the shortest stack that fits (departments win outer ties).
function pack(zones: Zone[]) {
  const ceo = zones.find(z => z.room === 'ceo')!;
  const hq = zones.find(z => z.room === 'hq')!;
  const teams = zones.filter(z => z.room === 'team');
  const common = zones.filter(z => !['ceo', 'hq', 'team'].includes(z.room))
    .sort((a, b) => b.w - a.w || b.d - a.d);
  const pending = [...teams, ...common];
  const top = pending.filter(z => z.d <= ceo.d);
  const seeds = [undefined, ...top];
  const maxW = Math.max(...pending.map(z => z.w));
  const hqZ = MARGIN + ceo.d + GAP;
  type Position = { x: number; z: number };
  let best: { width: number; depth: number; positions: Map<Zone, Position> } | undefined;
  let fallback: typeof best;
  // Largest empty rectangle, excluding the entrance and two-cell cross aisles.
  // Evaluate only candidates that improve the footprint, not every trial.
  const hasVoid = (positions: Map<Zone, Position>, W: number, D: number) => {
    const used = new Uint8Array(W * D);
    for (const zone of zones) {
      const p = positions.get(zone)!, a = zone.area;
      for (let z = p.z + (a?.dz ?? 0); z < p.z + (a?.dz ?? 0) + (a?.d ?? zone.d); z++)
        for (let x = p.x; x < p.x + zone.w; x++) used[z * W + x] = 1;
    }
    const heights = new Array<number>(W).fill(0);
    for (let z = 0; z < D; z++) {
      const bars: { x: number; h: number }[] = [];
      for (let x = 0; x <= W; x++) {
        const aisle = z >= hqZ + hq.d && Math.abs(x - Math.floor(W / 2)) <= 1;
        const h = x === W ? 0 : (heights[x] = used[z * W + x] || aisle ? 0 : heights[x]! + 1);
        let start = x;
        while (bars.length && bars.at(-1)!.h > h) {
          const bar = bars.pop()!, w = x - bar.x;
          if (w > GAP && bar.h > GAP && w * bar.h > 100) return true;
          start = bar.x;
        }
        bars.push({ x: start, h });
      }
    }
    return false;
  };
  // Widths grow only when a room needs them. Trying both stack types also lets
  // wide departments use CL/CR instead of stretching both outside columns.
  for (let sideW = 3; sideW <= maxW; sideW++) {
    for (let innerW = Math.ceil((hq.w - 3) / 2); innerW <= maxW; innerW++) {
      const centreW = innerW * 2 + 3;
      const width = MARGIN * 2 + sideW * 2 + GAP * 2 + centreW;
      const cx = (width - ceo.w) / 2, hx = (width - hq.w) / 2;
      const topW = cx - GAP - MARGIN;
      for (const left of seeds) for (const right of seeds) {
        if (left && left === right || left && left.w > topW || right && right.w > topW) continue;
        const positions = new Map<Zone, Position>([[ceo, { x: cx, z: MARGIN }], [hq, { x: hx, z: hqZ }]]);
        const rows: Zone[][] = [left ? [left] : [], right ? [right] : []];
        const rowW = (row: Zone[]) => row.reduce((w, z) => w + z.w + GAP, -GAP);
        for (const zone of pending) {
          if (!top.includes(zone) || rows.some(r => r.includes(zone))) continue;
          const row = rows.find(r => rowW(r) + GAP + zone.w <= topW);
          if (row) row.push(zone);
        }
        const stacks = rows.map((row, i) => {
          let x = i ? width - MARGIN - rowW(row) : MARGIN;
          for (const zone of row) { positions.set(zone, { x, z: MARGIN }); x += zone.w + GAP; }
          return { x: i ? width - MARGIN - sideW : MARGIN, w: sideW,
            bottom: row.length ? MARGIN + Math.max(...row.map(z => z.d)) + GAP : MARGIN };
        });
        stacks.push(
          { x: MARGIN + sideW + GAP, w: innerW, bottom: hqZ + hq.d + GAP },
          { x: width / 2 + 1.5, w: innerW, bottom: hqZ + hq.d + GAP },
        );
        for (const zone of pending) {
          if (positions.has(zone)) continue;
          const stack = stacks.filter(s => zone.w <= s.w).sort((a, b) => a.bottom - b.bottom)[0];
          if (!stack) break;
          positions.set(zone, { x: stack.x, z: stack.bottom });
          stack.bottom += zone.d + GAP;
        }
        if (positions.size !== zones.length) continue;
        const depth = Math.max(...zones.map(z => positions.get(z)!.z + z.d)) + MARGIN;
        const candidate = { width, depth, positions };
        if (!fallback || width * depth < fallback.width * fallback.depth) fallback = candidate;
        if ((!best || width * depth < best.width * best.depth ||
            width * depth === best.width * best.depth && width < best.width) && !hasVoid(positions, width, depth)) best = candidate;
      }
    }
  }
  best ??= fallback;
  for (const zone of zones) Object.assign(zone, best!.positions.get(zone));
  return { width: best!.width, depth: best!.depth };
}

// Neighbor links of wall cells (so corners and ends join properly)
function linkWalls(items: OfficeItem[]) {
  const set = new Set(items.filter(i => i.type === 'wall').map(i => i.x + ',' + i.z));
  for (const it of items) {
    if (it.type !== 'wall') continue;
    it.links = ([['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['w', -1, 0]] as const)
      .filter(([, dx, dz]) => set.has(it.x + dx + ',' + (it.z + dz))).map(([k]) => k).join('');
  }
}

// agents: [{ id, team, hiredAt }] → { width, depth, tier, items, desks: { agentId: deskId } }
/** Zone labels come from `t` (Turkish by default). */
export function planOffice(agents: PlanAgent[], t: Translate = createT(DEFAULT_LOCALE)) {
  const sorted = [...agents].sort((a, b) => (a.hiredAt || 0) - (b.hiredAt || 0) || a.id.localeCompare(b.id));
  const teams = new Map<string, PlanAgent[]>();
  for (const a of sorted) {
    const t = (a.team || '').trim();
    if (t) teams.set(t, [...(teams.get(t) || []), a]);
  }
  // A one-person team gets no room; they sit in the open area
  const roomTeams = [...teams].filter(([, m]) => m.length >= 2).sort((a, b) => b[1].length - a[1].length);
  const inRoom = new Set(roomTeams.flatMap(([, m]) => m.map(a => a.id)));
  const open = sorted.filter(a => !inRoom.has(a.id));

  const colors = teamColors(sorted);
  const tier = tierFor(Math.max(sorted.length, 1));
  const desks: Record<string, string> = {};
  const deskId = (a: PlanAgent) => (desks[a.id] = 'desk-' + a.id);
  const openIds = open.map(deskId);
  for (let i = openIds.length; i < Math.max(tier - inRoom.size, 1); i++) openIds.push('desk-free-' + i);

  const zones = [
    ceoOffice(t),
    mainWorkRoom(sorted.length, t),
    ...roomTeams.map(([name, members]) => teamRoom(name, members.map(deskId), colors.get(name)!.tint, sorted.length <= 5)),
    workspace(openIds, t),
    coffeeCorner(t),
    meetingRoom(tier, t),
    lounge(tier, t),
  ];
  if (tier >= 7) zones.push(dining(tier, t), gameArea(tier, t));
  if (tier >= 10) zones.push(sleepRoom(tier, t));

  const { width, depth } = pack(zones);
  const items: OfficeItem[] = [];
  for (const zone of zones) {
    const a = zone.area || { dx: 0, dz: 0, w: zone.w, d: zone.d };
    items.push({ id: `zone-${zone.x}-${zone.z}`, type: 'zone', x: zone.x! + a.dx, z: zone.z! + a.dz, w: a.w, d: a.d, rot: 0, label: zone.label, room: zone.room, tint: zone.tint });
    for (const it of shift(zone.items, zone.x!, zone.z!)) items.push({ rot: 0, ...it, id: it.id || `${it.type}-${it.x}-${it.z}` });
  }
  for (const [x, z] of [[0, 0], [width - 1, 0], [0, depth - 1], [width - 1, depth - 1]]) items.push({ id: `plant-${x}-${z}`, type: 'plant', x, z, rot: 0 });
  linkWalls(items);
  return { width, depth, tier, items, desks };
}

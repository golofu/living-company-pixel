// Pixel art for the office: furniture (22 catalog types), floor and outer walls, all drawn by code into PixelBuffers.
// Pure module (no DOM, no three) so it runs in node tests.
//
// How it works
//  - Every item is a small "scene" of boxes, cylinders and spheres written for rot 0 (front faces south, +y).
//  - A tiny renderer turns a scene into a sprite in the 3/4 top-down view: a box shows its top surface (lifted by its
//    height) and its south face below it. 1 px of height = 1 px up the screen, like the people sprites.
//  - Rotating an item rotates the scene on the floor before projecting, so the monitor/chair/back side of desks, sofas,
//    beds, shelves, the car... really change with rot 0/90/180/270. Faces can carry textures (screens, drawers, books).
//  - A selective dark outline, a soft contact shadow and light edge shading are added to every sprite.
//
// Draw order (sortY) rules, all in scene pixels:
//  - Ordinary standing items: one Drawable, layer 'object', sortY = bottom edge of the footprint, (z + depth) * TILE.
//  - Ground things (zone, rug, parking, floor, door mat): layer 'ground'.
//  - Chairs are separate Drawables, centred on the seat point of the sitter (the person's feet), sortY depends on which
//    way the person looks, so the chair back overlaps or hides behind the seated person:
//      person looks north (back of chair is south of them, nearer the camera): two sprites: seat and base sortY = seat y - 1
//                                                                              (the sitter sits on them), back sortY = seat y + 4 (over their legs)
//      person looks south (back of chair is north of them, behind them):      sortY = seat y - 4  (drawn under them)
//      person looks east or west (back to the side):                          sortY = seat y - 1
//    Backs are low (13 px, seat 7) so a seated person keeps head and shoulders in view.
//  - Items people sit ON (sofa, bed) are cut into slices by footprint y at the sitters' feet (`Scene.bands`): the pixels
//    behind a sitter sort just behind them, the pixels in front of them (blanket, front of the cushion, sofa back when
//    it is south) sort at the next sitter's line or the bottom edge. Turned 90 or 270 degrees the sitters stand in a row
//    along y, so there is one cut per sofa seat. The meeting and dining tables are one sprite sorted at the middle line,
//    between the stools or chairs on the north side and on the south side.
//  - Parts of one item are ordered by `orderPrims` (painter's order by screen overlap); `orderDiagnostics.cycles`
//    counts the times that had no valid order, and the tests keep it at 0.
import { CATALOG, footprint, type ItemType, type OfficeItem } from '../../../shared/catalog.ts';
import { PixelBuffer, TILE, WALL_H, rgba, shade, type Drawable, type DrawFloor, type DrawItem, type DrawWalls, type ItemOptions, type Rgba, type Sprite } from './types.ts';
import { P } from './palette.ts';

// ------------------------------------------------------------------------------------------------ colour helpers

const rr = (c: Rgba) => c >>> 24, gg = (c: Rgba) => (c >>> 16) & 255, bb = (c: Rgba) => (c >>> 8) & 255;
const rgb = (r: number, g: number, b: number, a = 255): Rgba => ((((r | 0) & 255) << 24) | (((g | 0) & 255) << 16) | (((b | 0) & 255) << 8) | (a & 255)) >>> 0;
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const mixc = (a: Rgba, b: Rgba, t: number): Rgba => rgb(clamp(rr(a) + (rr(b) - rr(a)) * t), clamp(gg(a) + (gg(b) - gg(a)) * t), clamp(bb(a) + (bb(b) - bb(a)) * t));
/** Marks a colour as light-emitting: the night pass leaves it bright and adds a glow around it. */
const EM = (c: Rgba): Rgba => ((c & 0xffffff00) | 254) >>> 0;
/** Texture result meaning "draw nothing here" (cuts round shapes out of a box). 0 means "use the box colour". */
const CUT: Rgba = 1;
const hash = (x: number, y: number, s = 0) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const SHADOW = P.shadow;
const opaque = (c: Rgba) => (c & 255) === 255;
/** Edge shading helper: only plain opaque colours are shaded. */
const edge = (c: Rgba, k: number) => (k === 1 || !opaque(c) ? c : shade(c, k));

const dimObj = (c: Rgba): Rgba => rgb(rr(c) * 0.8, gg(c) * 0.82, bb(c) * 0.94);
const dimFloor = (c: Rgba): Rgba => rgb(rr(c) * 0.6, gg(c) * 0.64, bb(c) * 0.76);

// ------------------------------------------------------------------------------------------------ scenes

type Face = 'f' | 'b' | 'l' | 'r';
/** Texture of a face: (u, v, w, h) with u from the left as seen from outside, v from the top; 0 keeps the base colour. */
type Tex = (u: number, v: number, w: number, h: number) => Rgba;
interface Box { k: 'b'; x0: number; y0: number; x1: number; y1: number; z0: number; z1: number; top: Rgba; side: Rgba; topTex?: Tex; tex?: Partial<Record<Face, Tex>>; round?: boolean; flat?: boolean }
interface Cyl { k: 'c'; cx: number; cy: number; r: number; z0: number; z1: number; top: Rgba; side: Rgba }
interface Sph { k: 's'; cx: number; cy: number; cz: number; r: number; c: Rgba; noise?: boolean }
type Prim = Box | Cyl | Sph;
interface FloorRect { x0: number; y0: number; x1: number; y1: number; c: Rgba }
interface Scene {
  w: number; d: number; prims: Prim[];
  /** Flat paint on the floor under the item (dark kneehole, rugs under chairs). */
  floor?: FloorRect[];
  /** Split into a back and a front sprite along the middle line (see header). */
  split?: boolean;
  /**
   * Split into slices by footprint y instead (after rotating): every pixel above the first line, between two lines, or
   * below the last line goes to its own sprite. Used where people sit along the long side of the item (sofa, bed turned
   * 90 or 270 degrees): the lines are the sitters' feet, so each slice can be sorted between two sitters.
   */
  bands?: number[];
  padX?: number;
  /** No contact shadow (walls: the floor already carries it). */
  noShadow?: boolean;
  /** Outline edges that are not drawn, so neighbouring cells join without seams (walls). */
  noOutline?: ('n' | 's' | 'e' | 'w')[];
}

type BoxExtra = Partial<Pick<Box, 'topTex' | 'tex' | 'round' | 'flat'>>;
const box = (x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, top: Rgba, side: Rgba, extra: BoxExtra = {}): Box => ({ k: 'b', x0, y0, x1, y1, z0, z1, top, side, ...extra });
const cyl = (cx: number, cy: number, r: number, z0: number, z1: number, top: Rgba, side: Rgba): Cyl => ({ k: 'c', cx, cy, r, z0, z1, top, side });
const sph = (cx: number, cy: number, cz: number, r: number, c: Rgba, noise = false): Sph => ({ k: 's', cx, cy, cz, r, c, noise });

interface Xf { Wr: number; Dr: number; fwd: (x: number, y: number) => [number, number]; inv: (x: number, y: number) => [number, number] }
function makeXf(w: number, d: number, rot: number): Xf {
  const swap = rot === 90 || rot === 270;
  const Wr = swap ? d : w, Dr = swap ? w : d;
  const fwd = (x: number, y: number): [number, number] => {
    const dx = x - w / 2, dy = y - d / 2;
    switch (rot) {
      case 90: return [dy + Wr / 2, -dx + Dr / 2];
      case 180: return [-dx + Wr / 2, -dy + Dr / 2];
      case 270: return [-dy + Wr / 2, dx + Dr / 2];
      default: return [dx + Wr / 2, dy + Dr / 2];
    }
  };
  const inv = (x: number, y: number): [number, number] => {
    const dx = x - Wr / 2, dy = y - Dr / 2;
    switch (rot) {
      case 90: return [-dy + w / 2, dx + d / 2];
      case 180: return [-dx + w / 2, -dy + d / 2];
      case 270: return [dy + w / 2, -dx + d / 2];
      default: return [dx + w / 2, dy + d / 2];
    }
  };
  return { Wr, Dr, fwd, inv };
}
/** Which local face looks south after rotating by rot. */
const SOUTH_FACE: Record<number, Face> = { 0: 'f', 90: 'l', 180: 'b', 270: 'r' };

interface WP { p: Prim; x0: number; y0: number; x1: number; y1: number; z0: number; z1: number; grp: number; i: number }

/** Rows of the screen a prim can touch: from the top of its top face to the bottom of its south face (a sphere is round). */
const screenTop = (w: WP) => (w.p.k === 's' ? (w.y0 + w.y1) / 2 - (w.z0 + w.z1) / 2 - w.p.r : w.y0 - w.z1);
const screenBottom = (w: WP) => (w.p.k === 's' ? (w.y0 + w.y1) / 2 - (w.z0 + w.z1) / 2 + w.p.r : w.y1 - w.z0);

/** Test hook: how many times the draw order had a cycle it could not resolve. Must stay 0 for every catalog item. */
export const orderDiagnostics = { cycles: 0 };

function orderPrims(ws: WP[]): WP[] {
  const n = ws.length;
  const out: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = ws[i]!, b = ws[j]!;
    if (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) <= 0) continue;
    // Two prims that never share a screen pixel need no order. Without this test a lid, a crossbar and a desk top
    // (each pair ordered by a different axis) formed a cycle and the desk top was painted over the north laptops.
    if (Math.min(screenBottom(a), screenBottom(b)) - Math.max(screenTop(a), screenTop(b)) <= 0) continue;
    const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    let aFirst: boolean;
    if (oy > 0) aFirst = a.z0 !== b.z0 ? a.z0 < b.z0 : a.y1 !== b.y1 ? a.y1 < b.y1 : a.i < b.i;
    else aFirst = a.y1 <= b.y0;
    if (aFirst) { out[i]!.push(j); indeg[j]!++; } else { out[j]!.push(i); indeg[i]!++; }
  }
  const done = new Array<boolean>(n).fill(false), res: WP[] = [];
  const key = (i: number) => ws[i]!.y1 * 4096 + ws[i]!.z0 * 64 + ws[i]!.x0 + i * 0.001;
  for (let k = 0; k < n; k++) {
    let best = -1;
    for (let i = 0; i < n; i++) if (!done[i] && indeg[i] === 0 && (best < 0 || key(i) < key(best))) best = i;
    if (best < 0) { orderDiagnostics.cycles++; for (let i = 0; i < n; i++) if (!done[i] && (best < 0 || key(i) < key(best))) best = i; } // cycle guard
    done[best] = true; res.push(ws[best]!);
    for (const j of out[best]!) indeg[j]!--;
  }
  return res;
}

const LIGHT = (() => { const x = -0.5, y = -0.6, z = 0.62, l = Math.hypot(x, y, z); return [x / l, y / l, z / l] as const; })();

interface Rendered { a: Sprite; b: Sprite | null; /** one sprite per slice when the scene has `bands` (empty slices are null) */ bands?: (Sprite | null)[] }

function renderScene(sc: Scene, rot: number, dark: boolean): Rendered {
  const xf = makeXf(sc.w, sc.d, rot);
  const { Wr, Dr } = xf;
  const ws: WP[] = [];
  sc.prims.forEach((p, i) => {
    let x0: number, y0: number, x1: number, y1: number, z0: number, z1: number;
    if (p.k === 'b') {
      const [ax, ay] = xf.fwd(p.x0, p.y0), [bx, by] = xf.fwd(p.x1, p.y1);
      x0 = Math.min(ax, bx); x1 = Math.max(ax, bx); y0 = Math.min(ay, by); y1 = Math.max(ay, by); z0 = p.z0; z1 = p.z1;
    } else {
      const [cx, cy] = xf.fwd(p.cx, p.cy);
      x0 = cx - p.r; x1 = cx + p.r; y0 = cy - p.r; y1 = cy + p.r;
      if (p.k === 'c') { z0 = p.z0; z1 = p.z1; } else { z0 = p.cz - p.r; z1 = p.cz + p.r; }
    }
    const grp = sc.split && (y0 + y1) / 2 > Dr / 2 + 0.5 ? 1 : 0;
    ws.push({ p, x0, y0, x1, y1, z0, z1, grp, i });
  });

  // extents of everything that may be drawn, in footprint space
  const pad = dark ? 3 : 1, padX = sc.padX ?? pad;
  let minX = 0, minY = 0, maxX = Wr, maxY = Dr;
  for (const w of ws) {
    const shadow = w.z0 <= 0 && w.p.k !== 's' && !sc.noShadow ? 4 : 0;
    minX = Math.min(minX, w.x0); maxX = Math.max(maxX, w.x1 + shadow);
    minY = Math.min(minY, w.p.k === 's' ? w.y0 - w.z1 + w.p.r + 0 : w.y0 - w.z1 - (w.p.k === 'c' ? w.p.r : 0));
    maxY = Math.max(maxY, w.y1 + shadow);
  }
  for (const f of sc.floor ?? []) {
    const [ax, ay] = xf.fwd(f.x0, f.y0), [bx, by] = xf.fwd(f.x1, f.y1);
    minX = Math.min(minX, ax, bx); maxX = Math.max(maxX, ax, bx); minY = Math.min(minY, ay, by); maxY = Math.max(maxY, ay, by);
  }
  minX = Math.floor(minX) - padX; maxX = Math.ceil(maxX) + padX; minY = Math.floor(minY) - pad; maxY = Math.ceil(maxY) + pad;
  const bw = maxX - minX, bh = maxY - minY, ax = -minX, ay = -minY;
  const col = new Uint32Array(bw * bh), tag = new Uint8Array(bw * bh);
  let grp = 0;
  const cuts = sc.bands ?? [];
  /** `fy` is the footprint y the pixel belongs to (not the lifted screen y); only used to pick a slice. */
  const put = (x: number, y: number, c: Rgba, fy: number) => {
    if (c === CUT) return;
    const sx = Math.floor(x) + ax, sy = Math.floor(y) + ay;
    if (sx < 0 || sy < 0 || sx >= bw || sy >= bh) return;
    const i = sy * bw + sx;
    col[i] = c;
    if (cuts.length) { let k = 0; while (k < cuts.length && fy >= cuts[k]!) k++; tag[i] = k; } else tag[i] = grp;
  };
  const putShadow = (x: number, y: number) => {
    const sx = Math.floor(x) + ax, sy = Math.floor(y) + ay;
    if (sx < 0 || sy < 0 || sx >= bw || sy >= bh) return;
    const i = sy * bw + sx;
    if (col[i] === 0) { col[i] = SHADOW; tag[i] = 0; }
  };

  for (const f of sc.floor ?? []) {
    const [px, py] = xf.fwd(f.x0, f.y0), [qx, qy] = xf.fwd(f.x1, f.y1);
    for (let y = Math.min(py, qy); y < Math.max(py, qy); y++) for (let x = Math.min(px, qx); x < Math.max(px, qx); x++) {
      const sx = Math.floor(x) + ax, sy = Math.floor(y) + ay;
      if (sx < 0 || sy < 0 || sx >= bw || sy >= bh) continue;
      col[sy * bw + sx] = f.c; tag[sy * bw + sx] = 0;
    }
  }
  // contact shadows: light from the north west, shadow falls to the south east of everything that stands on the floor
  for (const w of ws) {
    if (w.z0 > 0 || w.p.k === 's' || w.z1 < 2 || sc.noShadow) continue;
    const sx = Math.min(4, 1 + Math.round(w.z1 / 9)), sy = Math.min(3, 1 + Math.round(w.z1 / 14));
    if (w.p.k === 'c') {
      const cx = (w.x0 + w.x1) / 2 + sx, cy = (w.y0 + w.y1) / 2 + sy, r = w.p.r;
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) putShadow(x, y);
    } else for (let y = Math.floor(w.y0 + sy); y < Math.ceil(w.y1 + sy); y++) for (let x = Math.floor(w.x0 + sx); x < Math.ceil(w.x1 + sx); x++) putShadow(x, y);
  }

  for (const w of orderPrims(ws)) {
    grp = w.grp;
    const p = w.p;
    if (p.k === 'b') drawBox(w, p);
    else if (p.k === 'c') drawCyl(w, p);
    else drawSph(w, p);
  }

  function drawBox(w: WP, b: Box) {
    const bwid = b.x1 - b.x0, bdep = b.y1 - b.y0, zt = b.z1, hgt = b.z1 - b.z0;
    const X0 = Math.round(w.x0), X1 = Math.round(w.x1), Y0 = Math.round(w.y0), Y1 = Math.round(w.y1);
    const wd = X1 - X0, hd = Y1 - Y0;
    for (let gy = Y0; gy < Y1; gy++) for (let gx = X0; gx < X1; gx++) {
      const rf = gy === Y0, rl = gy === Y1 - 1, cf = gx === X0, cl = gx === X1 - 1;
      if (b.round && wd >= 6 && hd >= 6 && (rf || rl) && (cf || cl)) continue;
      let c = b.top;
      if (b.topTex) { const [lx, ly] = rot === 0 ? [gx + 0.5, gy + 0.5] : xf.inv(gx + 0.5, gy + 0.5); const t = b.topTex(Math.floor(lx - b.x0), Math.floor(ly - b.y0), bwid, bdep); if (t) c = t; }
      if (!b.flat) c = edge(c, rf ? 1.14 : cf ? 1.07 : cl ? 0.9 : rl ? 0.97 : 1);
      put(gx, gy - zt, c, gy + 0.5);
    }
    if (hgt <= 0) return;
    const face = SOUTH_FACE[rot]!;
    const fw = face === 'f' || face === 'b' ? bwid : bdep;
    for (let v = 0; v < hgt; v++) for (let gx = X0; gx < X1; gx++) {
      if (b.round && wd >= 6 && v === hgt - 1 && (gx === X0 || gx === X1 - 1)) continue;
      const [lx, ly] = rot === 0 ? [gx + 0.5, Y1 - 0.5] : xf.inv(gx + 0.5, Y1 - 0.5);
      const u = Math.floor(face === 'f' ? lx - b.x0 : face === 'b' ? b.x1 - lx : face === 'l' ? ly - b.y0 : b.y1 - ly);
      let c = b.side;
      const tx = b.tex?.[face];
      if (tx) { const t = tx(u, v, fw, hgt); if (t) c = t; }
      if (!b.flat) c = edge(c, v === hgt - 1 ? 0.78 : gx === X0 ? 1.06 : gx === X1 - 1 ? 0.84 : 1);
      put(gx, Y1 - zt + v, c, Y1 - 0.5);
    }
  }
  function drawCyl(w: WP, c: Cyl) {
    const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2, r = c.r;
    for (let z = c.z0; z <= c.z1; z++) {
      const top = z === c.z1, base = top ? c.top : c.side, cyy = cy - z;
      for (let y = Math.floor(cyy - r); y <= Math.ceil(cyy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cyy, d2 = dx * dx + dy * dy;
        if (d2 > r * r) continue;
        let k = top ? (d2 > (r - 1) * (r - 1) && r >= 2 ? 0.86 : 1.04 - 0.08 * ((dx / r + 1) / 2)) : 1.16 - 0.44 * ((dx / r + 1) / 2);
        if (!top && z === c.z0) k *= 0.82;
        put(x, y, edge(base, k), y + z + 0.5);
      }
    }
  }
  function drawSph(w: WP, s: Sph) {
    const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2 - s.cz, r = s.r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = (x + 0.5 - cx) / r, dy = (y + 0.5 - cy) / r, d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2), l = dx * LIGHT[0] + dy * LIGHT[1] + nz * LIGHT[2];
      let k = 0.62 + 0.62 * Math.max(0, l);
      if (s.noise) { const h = hash(x, y, 7); k *= h > 0.86 ? 1.18 : h < 0.16 ? 0.82 : 1; }
      put(x, y, edge(s.c, k), y + s.cz + 0.5);
    }
  }

  // selective outline: dark ring around the silhouette in a darker shade of the colour it touches
  const outline: [number, Rgba, number][] = [];
  const skip = new Set<string>(sc.noOutline ?? []);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = y * bw + x, c0 = col[i]!;
    if (c0 !== 0 && c0 !== SHADOW) continue;
    // the first neighbour that is solid decides: below (the outline is on its north side), above, left, right
    let nb = -1, side = '';
    if (y + 1 < bh && (col[i + bw]! & 255) >= 254) { nb = i + bw; side = 'n'; }
    else if (y > 0 && (col[i - bw]! & 255) >= 254) { nb = i - bw; side = 's'; }
    else if (x > 0 && (col[i - 1]! & 255) >= 254) { nb = i - 1; side = 'e'; }
    else if (x + 1 < bw && (col[i + 1]! & 255) >= 254) { nb = i + 1; side = 'w'; }
    if (nb >= 0 && !skip.has(side)) outline.push([i, ((shade(col[nb]!, 0.46) & 0xffffff00) | 255) >>> 0, tag[nb]!]);
  }
  for (const [i, c, t] of outline) { col[i] = c; tag[i] = t; }

  // night: dim what does not shine, brighten what does, and bleed a little light into the neighbours
  const emit: number[] = [];
  for (let i = 0; i < col.length; i++) if ((col[i]! & 255) === 254) emit.push(i);
  if (dark) {
    const lit = new Map<number, Rgba>();
    for (const i of emit) {
      const x = i % bw, y = (i / bw) | 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const m = Math.abs(dx) + Math.abs(dy);
        if (m === 0 || m > 2) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const j = ny * bw + nx;
        if ((col[j]! & 255) === 254) continue;
        const strength = m === 1 ? 0.3 : 0.14;
        if (!lit.has(j) || lit.get(j)! < strength) lit.set(j, strength);
      }
    }
    for (let i = 0; i < col.length; i++) if ((col[i]! & 255) === 255) col[i] = dimObj(col[i]!);
    for (const [j, s] of lit) {
      // tint towards the colour of the nearest screen pixel
      const x = j % bw, y = (j / bw) | 0;
      let src = 0;
      for (let dy = -2; dy <= 2 && !src; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < bw && ny < bh && (col[ny * bw + nx]! & 255) === 254) { src = col[ny * bw + nx]!; break; } }
      if (!src) continue;
      const cur = col[j]!;
      col[j] = (cur & 255) === 0 ? ((src & 0xffffff00) | Math.round(s * 150)) >>> 0 : (cur & 255) === 255 ? (mixc(cur, src, s * 1.4) & 0xffffff00 | 255) >>> 0 : cur;
    }
    for (const i of emit) col[i] = (shade(col[i]!, 1.12) & 0xffffff00 | 255) >>> 0;
  } else for (const i of emit) col[i] = (col[i]! & 0xffffff00 | 255) >>> 0;

  const mk = (g: number | null): Sprite => {
    const buf = new PixelBuffer(bw, bh);
    for (let i = 0; i < col.length; i++) if (col[i] !== 0 && (g === null || tag[i] === g)) buf.data[i] = col[i]!;
    return { buf, ax, ay };
  };
  if (cuts.length) { const bands = Array.from({ length: cuts.length + 1 }, (_, g) => { const s = mk(g); return s.buf.filled() ? s : null; }); return { a: bands[0] ?? mk(null), b: bands[1] ?? null, bands }; }
  if (!sc.split) return { a: mk(null), b: null };
  const b = mk(1);
  return { a: mk(0), b: b.buf.filled() ? b : null };
}

// ------------------------------------------------------------------------------------------------ palette of things

const OAK_TOP = shade(P.wood1, 1.42), OAK_SIDE = shade(P.wood1, 1.02), OAK_DARK = shade(P.wood2, 0.95);
const WALNUT_TOP = shade(P.wood2, 1.2), WALNUT_SIDE = shade(P.wood3, 1.25);
const SOFA = shade(P.navy, 1.75), SOFA_LIGHT = shade(P.navy, 2.15);
const METAL = P.grey2, METAL_DARK = P.grey3;

const woodGrain = (top: Rgba, seed: number): Tex => (u, v) => { const h = hash(u >> 2, v, seed); return h > 0.8 ? shade(top, 0.93) : h < 0.08 ? shade(top, 1.07) : 0; };

/** One monitor/laptop screen. Texture w x h includes the bezel. */
function screenTex(on: boolean, fr: number, dark: boolean, big = false): Tex {
  return (u, v, w, h) => {
    const chin = big ? 2 : 2;
    if (u < 1 || u >= w - 1 || v < 1 || v >= h - chin) {
      if (v >= h - chin && u >= w - 3 && u < w - 1 && v === h - 1) return on ? P.mint : P.grey3; // power light
      return P.ink;
    }
    const iu = u - 1, iv = v - 1, iw = w - 2;
    if (!on) {
      const streak = (iu - iv * 1.4 + 20) % 9;
      return (streak > 6.2 && streak < 7.6) ? shade(P.steel, 1.35) : iv < 1 ? shade(P.steelDark, 1.2) : P.steelDark;
    }
    const bg = shade(P.screen, dark ? 0.8 : 0.88);
    if (iv === 0) return EM(iu === 1 ? P.redNeon : iu === 3 ? P.gold : iu === 5 ? P.mint : shade(P.screen, 0.66));
    if (iv % 2 === 1) {
      const indent = (iv + fr) % 4 === 1 ? 0 : (iv + fr) % 4 === 3 ? 3 : 1;
      const len = 2 + Math.floor(hash(iv, fr, 3) * (iw - 5));
      const gap = 1 + Math.floor(hash(iv, 9, fr) * 2);
      const first = Math.max(1, Math.min(len, iw - indent - 1));
      if (iu >= indent && iu < indent + first) return EM(iv % 3 === 0 ? P.screenHi : P.white);
      if (iu >= indent + first + gap && iu < indent + first + gap + Math.max(1, (len >> 1))) return EM(iv % 4 === 1 ? P.lampGlow : P.mint);
    }
    if (fr === 1 && iv === h - chin - 2 && iu === iw - 3) return EM(P.white);
    return EM(bg);
  };
}
/** Back of a monitor or lid. When the screen is on the logo shines (a plus sign), so a sitter facing away from the viewer still shows it works. */
const monitorBack = (logo: Rgba, on = false): Tex => (u, v, w, h) => (on && (Math.abs(u - Math.floor(w / 2)) + Math.abs(v - Math.floor(h / 2)) <= 1) ? EM(P.screenHi) : u === Math.floor(w / 2) && v === Math.floor(h / 2) ? logo : v === 1 && u > 2 && u < w - 3 && u % 2 === 0 ? shade(P.grey3, 0.8) : v > 0 && u > 0 && u < w - 1 ? 0 : P.steelDark);

// ------------------------------------------------------------------------------------------------ chairs

type Look = 'N' | 'E' | 'S' | 'W';
type ChairKind = 'office' | 'ceo' | 'visitor' | 'stool';
const CHAIR_COLORS = [P.grey4, shade(P.navy, 1.35), shade(P.teal, 0.55), shade(P.brick, 0.95)];
const LOOK_ROT: Record<Look, number> = { N: 0, W: 90, S: 180, E: 270 };

function chairScene(kind: ChairKind, variant: number): Scene {
  const c = kind === 'ceo' ? shade(P.wood3, 0.8) : kind === 'visitor' ? shade(P.grey2, 0.85) : CHAIR_COLORS[variant % CHAIR_COLORS.length]!;
  const seatTop = shade(c, 1.35);
  if (kind === 'stool') {
    return { w: 16, d: 16, prims: [cyl(8, 8, 3.5, 0, 1, METAL_DARK, METAL_DARK), cyl(8, 8, 1, 1, 3, METAL, METAL), cyl(8, 8, 4.5, 3, 5, shade(P.terracotta, 1.15), shade(P.terracotta, 0.85))] };
  }
  const back = box(3, 12, 13, 14, 7, kind === 'ceo' ? 26 : 13, c, c, {
    round: true,
    tex: { f: (u, v, w) => (u > 1 && u < w - 2 && v > 1 ? shade(c, 1.15) : 0), b: (u, v, w, h) => (u === 0 || u === w - 1 || v === 0 ? shade(c, 0.9) : v === Math.floor(h / 2) && u > 1 && u < w - 2 ? shade(c, 0.78) : shade(c, 1.35)) },
  });
  const prims: Prim[] = [
    box(2, 7, 14, 9, 0, 1, METAL_DARK, METAL_DARK, { flat: true }), box(7, 2, 9, 14, 0, 1, METAL_DARK, METAL_DARK, { flat: true }),
    cyl(8, 8, 1, 1, 5, METAL, METAL),
    box(3, 3, 13, 13, 5, 7, seatTop, c, { round: true, topTex: (u, v) => (hash(u, v, 5) > 0.93 ? shade(seatTop, 0.9) : 0) }),
    back,
  ];
  if (kind === 'ceo') prims.push(box(1, 4, 3, 12, 7, 11, shade(c, 1.3), c, { round: true }), box(13, 4, 15, 12, 7, 11, shade(c, 1.3), c, { round: true }));
  return { w: 16, d: 16, prims };
}
const chairCache = new Map<string, Rendered>();
/** A chair whose sitter looks north is two sprites: the seat and base (the sitter sits on them) and the back (nearer the camera, over the sitter). */
function chairSprite(kind: ChairKind, variant: number, look: Look, dark: boolean): Rendered {
  const key = `${kind}|${variant}|${look}|${dark}`;
  let s = chairCache.get(key);
  if (!s) { s = renderScene({ ...chairScene(kind, variant), split: look === 'N' && kind !== 'stool' }, LOOK_ROT[look], dark); chairCache.set(key, s); }
  return s;
}

interface ChairSpec { kind: ChairKind; variant: number; cx: number; cy: number; look: Look }

// ------------------------------------------------------------------------------------------------ item scenes

interface Ctx { item: OfficeItem; w: number; d: number; active: boolean; activeSeats: string[]; dark: boolean; fr: number; rot: number }
interface Built { scene: Scene; chairs?: ChairSpec[]; /** sortY of the main sprite relative to the footprint top; default = bottom edge */ sort?: 'mid' }

function deskScene(c: Ctx): Built {
  const W = c.w, D = c.d, on = c.active;
  const prims: Prim[] = [
    box(3, 4, 11, 15, 0, 8, OAK_DARK, OAK_SIDE, { tex: { f: (u, v, w, h) => (v === 3 || v === 6 ? shade(OAK_DARK, 0.7) : v === 0 ? shade(OAK_SIDE, 1.15) : (v === 1 || v === 4) && u >= w / 2 - 2 && u <= w / 2 + 1 ? shade(P.gold, 0.95) : (v === 4 || v === 7) && u >= w / 2 - 2 && u <= w / 2 + 1 && h > 0 ? shade(P.gold, 0.95) : 0) } }),
    box(28, 4, 30, 15, 0, 8, OAK_DARK, OAK_SIDE),
    box(11, 4, 28, 6, 2, 8, OAK_DARK, shade(OAK_DARK, 0.85)),
    box(1, 2, W - 1, 15, 8, 10, OAK_TOP, shade(OAK_SIDE, 1.1), { topTex: woodGrain(OAK_TOP, 1) }),
    // monitor
    box(14, 3, 18, 6, 10, 11, P.grey2, P.grey3), box(15, 4, 17, 5, 11, 13, P.grey2, P.grey3),
    box(9, 3, 23, 5, 13, 23, P.ink, P.ink, { tex: { f: (u, v, w, h) => (v === 2 && u === w - 3 ? P.yellow : screenTex(on, c.fr, c.dark)(u, v, w, h)), b: monitorBack(P.grey2, on) } }),
    // keyboard, mouse, mug, papers
    box(11, 8, 21, 12, 10, 11, P.grey1, P.grey2, { topTex: (u, v) => (u % 2 === 1 && v % 2 === 1 ? shade(P.grey1, 0.74) : 0) }),
    box(23, 9, 25, 12, 10, 11, P.white, P.grey1, { round: true }),
    cyl(5, 9, 2, 10, 13, shade(P.wood3, 1.0), P.white),
    box(26, 4, 30, 10, 10, 12, P.white, P.grey1, { topTex: (u, v) => (v % 2 === 1 && u > 0 && u < 3 ? P.grey1 : 0) }),
    box(26, 5, 29, 8, 12, 12.5, P.yellow, P.yellow, { flat: true }),
  ];
  const chairs: ChairSpec[] = [{ kind: 'office', variant: hashV(c.item), cx: W / 2, cy: D + 0.45 * TILE, look: 'N' }];
  return { scene: { w: W, d: D, prims, floor: [{ x0: 4, y0: 5, x1: W - 3, y1: D - 0, c: rgba('#000000', 85) }] }, chairs };
}
const hashV = (it: OfficeItem, k = 0) => Math.floor(hash(it.x, it.z, k) * 4);

function laptop(prims: Prim[], cx: number, y0: number, y1: number, south: boolean, on: boolean, fr: number, dark: boolean) {
  // base near the sitter's edge, lid at the far end of the base, screen turned to the sitter
  prims.push(box(cx - 6, y0, cx + 6, y1, 10, 11, P.grey1, P.grey2, { round: true, topTex: (u, v) => (v > 0 && v < 3 && u % 2 === 1 ? shade(P.grey1, 0.78) : v === 4 && u > 3 && u < 8 ? shade(P.grey1, 0.85) : 0) }));
  const scr = screenTex(on, fr, dark), back = monitorBack(P.grey1, on);
  const lid = south ? box(cx - 6, y0 - 2, cx + 6, y0, 11, 19, P.grey3, P.grey3, { tex: { f: scr, b: back } }) : box(cx - 6, y1, cx + 6, y1 + 2, 11, 19, P.grey3, P.grey3, { tex: { f: back, b: scr } });
  prims.push(lid);
}

function teamdeskScene(c: Ctx): Built {
  const W = c.w, D = c.d, seats = c.item.seats ?? [];
  const prims: Prim[] = [
    box(4, 6, 8, D - 3, 0, 8, P.grey1, P.grey2), box(W - 8, 6, W - 4, D - 3, 0, 8, P.grey1, P.grey2),
    box(12, D / 2 - 1, W - 12, D / 2 + 1, 2, 8, P.grey1, shade(P.grey2, 0.9)),
    box(2, 3, W - 2, D - 3, 8, 10, P.white, P.grey1, { topTex: (u, v, w) => (u === 1 || u === w - 2 ? 0 : hash(u >> 1, v, 11) > 0.93 ? shade(P.white, 0.95) : 0) }),
    box(9, D / 2 - 3, W - 9, D / 2 + 3, 10, 10, shade(P.glass, 1.0), shade(P.glass, 1.0), { flat: true, topTex: (u, v) => ((u + v) % 6 === 0 ? shade(P.glass, 0.88) : 0) }),
  ];
  const chairs: ChairSpec[] = [];
  seats.forEach((s, i) => {
    const cx = Math.round(s.dx * TILE), south = s.dz * TILE >= D / 2, on = c.active || c.activeSeats.includes(s.id);
    if (south) laptop(prims, cx, D - 11, D - 5, true, on, c.fr, c.dark); else laptop(prims, cx, 5, 11, false, on, c.fr, c.dark);
    const mx = cx + (i % 2 ? -10 : 10);
    prims.push(cyl(mx, south ? D - 8 : 8, 2, 10, 13, P.wood3, i % 3 === 0 ? P.white : i % 3 === 1 ? shade(P.pink, 1.1) : shade(P.glass, 1)));
    if (hash(i, hashV(c.item), 4) > 0.5) prims.push(box(cx + 9 * (i % 2 ? 1 : -1) - 3, south ? D - 12 : 4, cx + 9 * (i % 2 ? 1 : -1) + 3, south ? D - 5 : 11, 10, 11, P.yellow, shade(P.yellow, 0.8), { topTex: (u, v) => (v % 2 === 1 && u > 0 ? shade(P.yellow, 0.82) : 0) }));
    const lx = Math.sin(s.face), lz = Math.cos(s.face);
    const look: Look = Math.abs(lx) > Math.abs(lz) ? (lx > 0 ? 'E' : 'W') : lz > 0 ? 'S' : 'N';
    chairs.push({ kind: 'office', variant: (i + hashV(c.item)) % 4, cx: s.dx * TILE, cy: s.dz * TILE, look });
  });
  return { scene: { w: W, d: D, prims, floor: [{ x0: 5, y0: 7, x1: W - 4, y1: D - 1, c: rgba('#000000', 80) }] }, chairs };
}

function ceodeskScene(c: Ctx): Built {
  const W = c.w, D = c.d, on = c.active;
  const idle = (u: number, v: number, w: number, h: number): Rgba => {
    const t = screenTex(on, c.fr, c.dark, true)(u, v, w, h);
    if (on) return t;
    return u < 1 || u >= w - 1 || v < 1 || v >= h - 2 ? t : mixc(shade(P.navy, 0.55), shade(P.navy, 1.1), (v / h) * 0.9 + ((u + v) % 11 === 0 ? 0.12 : 0));
  };
  const prims: Prim[] = [
    box(3, 3, 15, 15, 0, 9, WALNUT_SIDE, shade(WALNUT_SIDE, 1.0), { tex: { f: (u, v, w) => (v === 2 || v === 5 ? shade(WALNUT_SIDE, 0.6) : (v === 1 || v === 4 || v === 7) && Math.abs(u - w / 2) < 2 ? P.gold : 0) } }),
    box(W - 15, 3, W - 3, 15, 0, 9, WALNUT_SIDE, shade(WALNUT_SIDE, 1.0), { tex: { f: (u, v, w) => (v === 2 || v === 5 ? shade(WALNUT_SIDE, 0.6) : (v === 1 || v === 4 || v === 7) && Math.abs(u - w / 2) < 2 ? P.gold : 0) } }),
    box(15, 4, W - 15, 6, 2, 9, WALNUT_SIDE, shade(WALNUT_SIDE, 0.85)),
    box(1, 2, W - 1, 15, 9, 11, WALNUT_TOP, shade(WALNUT_TOP, 0.9), { topTex: woodGrain(WALNUT_TOP, 2) }),
    box(W / 2 - 4, 3, W / 2 + 4, 6, 11, 12, P.grey2, P.grey3), box(W / 2 - 1, 4, W / 2 + 1, 5, 12, 14, P.grey2, P.grey3),
    box(W / 2 - 10, 3, W / 2 + 10, 5, 14, 27, P.ink, P.ink, { tex: { f: idle, b: monitorBack(P.gold) } }),
    box(W / 2 - 5, 8, W / 2 + 5, 12, 11, 12, P.grey1, P.grey2, { topTex: (u, v) => (u % 2 === 1 && v % 2 === 1 ? shade(P.grey1, 0.74) : 0) }),
    box(W - 12, 6, W - 6, 12, 11, 12.5, P.ink, P.night, { topTex: (u, v) => (u === 0 || v === 0 || u === 5 || v === 5 ? shade(P.ink, 1.8) : 0) }),
    cyl(6, 8, 2, 11, 14, shade(P.wood3, 0.9), P.white),
    cyl(W - 20, 6, 2, 11, 14, shade(P.gold, 0.5), P.gold),
    box(W / 2 + 6, 12, W / 2 + 14, 14, 11, 13, P.gold, shade(P.gold, 0.7)),
  ];
  const chairs: ChairSpec[] = [
    { kind: 'ceo', variant: 0, cx: W / 2, cy: D + 0.45 * TILE, look: 'N' },
    { kind: 'visitor', variant: 0, cx: W / 2 - 0.55 * TILE, cy: -0.65 * TILE, look: 'S' },
    { kind: 'visitor', variant: 0, cx: W / 2 + 0.55 * TILE, cy: -0.65 * TILE, look: 'S' },
  ];
  return { scene: { w: W, d: D, prims, floor: [{ x0: 5, y0: 6, x1: W - 4, y1: D, c: rgba('#000000', 85) }] }, chairs };
}

function meetingScene(c: Ctx): Built {
  const W = c.w, D = c.d;
  const prims: Prim[] = [
    box(W / 2 - 5, D / 2 - 4, W / 2 + 5, D / 2 + 4, 0, 9, P.grey2, P.grey2),
    box(3, 6, W - 3, D - 6, 9, 11, P.white, shade(P.grey1, 0.95), { round: true, topTex: (u, v, w, h) => (u === 1 || v === 1 || u === w - 2 || v === h - 2 ? shade(P.white, 0.94) : hash(u >> 1, v, 12) > 0.94 ? shade(P.white, 0.96) : 0) }),
    box(7, 9, 12, 14, 11, 11.5, P.paper, P.paper, { flat: true, topTex: (u, v) => (v % 2 === 1 && u > 0 && u < 4 ? P.grey2 : 0) }),
    box(20, 15, 25, 20, 11, 11.5, P.yellow, P.yellow, { flat: true }),
    cyl(15, 12, 2, 11, 14, P.wood3, shade(P.red, 1.1)),
    cyl(20, 12, 3, 11, 17, shade(P.glass, 1.05), shade(P.glass, 0.9)),
    box(11, 16, 17, 20, 11, 12, P.grey3, P.grey2, { topTex: (u, v) => (v < 3 && u > 0 && u < 5 ? shade(P.steelDark, 1.5) : 0) }),
  ];
  const q = 0.45 * TILE, n = 0.15 * TILE, s = 1.85 * TILE;
  const chairs: ChairSpec[] = [
    { kind: 'office', variant: 0, cx: W / 2 - q, cy: n, look: 'S' }, { kind: 'office', variant: 1, cx: W / 2 + q, cy: n, look: 'S' },
    { kind: 'office', variant: 2, cx: W / 2 - q, cy: s, look: 'N' }, { kind: 'office', variant: 3, cx: W / 2 + q, cy: s, look: 'N' },
  ];
  return { scene: { w: W, d: D, prims, floor: [{ x0: 6, y0: 9, x1: W - 5, y1: D - 3, c: rgba('#000000', 55) }] }, chairs, sort: 'mid' };
}

function whiteboardScene(c: Ctx): Built {
  const W = c.w;
  const note = (u: number, v: number, x: number, y: number, col: Rgba) => u >= x && u < x + 3 && v >= y && v < y + 3 ? col : 0;
  const prims: Prim[] = [
    box(3, 5, 7, 10, 0, 2, METAL, METAL_DARK), box(W - 7, 5, W - 3, 10, 0, 2, METAL, METAL_DARK),
    box(4, 7, 6, 8, 2, 28, METAL, METAL_DARK), box(W - 6, 7, W - 4, 8, 2, 28, METAL, METAL_DARK),
    box(4, 6, W - 4, 9, 6, 24, P.grey1, P.white, {
      tex: {
        f: (u, v, w, h) => {
          if (u === 0 || u === w - 1 || v === 0 || v === h - 1) return P.grey1;
          return note(u, v, 3, 2, P.yellow) || note(u, v, 8, 2, P.glass) || note(u, v, 3, 7, P.pink) || note(u, v, 8, 7, P.leaf1) ||
            (v === 3 && u > 13 && u < 23 ? P.grey4 : v === 6 && u > 13 && u < 20 ? P.grey4 : v === 9 && u > 13 && u < 22 ? P.cyan : v === 12 && u > 14 && u < 18 ? P.redNeon : (u === 20 && v > 10 && v < 14) ? P.redNeon : 0) || P.white;
        },
        b: (u, v, w, h) => (u === 0 || u === w - 1 || v === 0 || v === h - 1 || u % 6 === 3 ? P.grey2 : P.grey1),
      },
    }),
    box(8, 9, W - 8, 11, 6, 7.5, METAL, METAL_DARK, { topTex: (u, v) => (v === 1 && (u === 3 || u === 7 || u === 11) ? [P.redNeon, P.cyan, P.ink][(u - 3) / 4]! : 0) }),
  ];
  return { scene: { w: W, d: c.d, prims, floor: [{ x0: 3, y0: 8, x1: W - 2, y1: 12, c: rgba('#000000', 40) }] } };
}

/**
 * Slice lines at the feet of the people who sit on an item (sofa, bed), in the rotated frame, as the world's seat spots
 * put them: one line per cell of depth when the item is turned 90 or 270 degrees (the sitters stand in a row along y),
 * otherwise one line a little in front of the middle (everyone sits side by side).
 */
function seatBands(c: Ctx): number[] {
  if (c.rot === 90 || c.rot === 270) return Array.from({ length: Math.max(1, Math.floor(c.w / TILE)) }, (_, k) => (k + 0.5) * TILE);
  return [c.d / 2 + (c.rot === 180 ? -0.12 : 0.12) * TILE];
}

function sofaScene(c: Ctx): Built {
  const W = c.w, D = c.d;
  const seam: Tex = (u, v, w, h) => (u === w - 1 || v === h - 1 ? shade(SOFA, 0.75) : 0);
  const prims: Prim[] = [
    box(2, 13, 5, 15, 0, 1, P.ink, P.ink), box(W - 5, 13, W - 2, 15, 0, 1, P.ink, P.ink), box(2, 4, 5, 6, 0, 1, P.ink, P.ink), box(W - 5, 4, W - 2, 6, 0, 1, P.ink, P.ink),
    box(1, 4, W - 1, 15, 1, 5, SOFA, shade(SOFA, 0.78), { round: true }),
    box(5, 6, W / 2, 14, 5, 8, SOFA_LIGHT, SOFA, { round: true, tex: { f: seam }, topTex: (u, v, w) => ((u === 3 || u === w - 4) && v === 3 ? shade(SOFA_LIGHT, 0.7) : 0) }),
    box(W / 2, 6, W - 5, 14, 5, 8, SOFA_LIGHT, SOFA, { round: true, tex: { f: seam }, topTex: (u, v, w) => ((u === 3 || u === w - 4) && v === 3 ? shade(SOFA_LIGHT, 0.7) : 0) }),
    box(1, 3, W - 1, 7, 5, 10, SOFA, shade(SOFA, 0.82), { round: true, topTex: (u, v, w) => (u > 5 && u < w - 5 && v === 2 && u % 8 === 6 ? shade(SOFA, 0.65) : 0), tex: { b: (u, v, w, h) => (u > 5 && u < w - 5 && v > 1 && v < h - 1 ? shade(SOFA_LIGHT, 1.05) : 0) } }),
    box(1, 5, 5, 15, 5, 9, SOFA, shade(SOFA, 0.82), { round: true, topTex: (u) => (u === 1 || u === 2 ? shade(SOFA, 1.2) : 0) }),
    box(W - 5, 5, W - 1, 15, 5, 9, SOFA, shade(SOFA, 0.82), { round: true, topTex: (u) => (u === 1 || u === 2 ? shade(SOFA, 1.2) : 0) }),
    box(6, 7, 11, 10, 8, 10, shade(P.pink, 1.1), shade(P.pink, 0.8), { round: true, topTex: (u, v) => ((u + v) % 4 === 0 ? shade(P.pink, 1.3) : 0) }),
  ];
  const bands = seatBands(c);
  return { scene: { w: W, d: D, prims, bands }, sort: 'mid' };
}

function coffeeScene(c: Ctx): Built {
  const steam = c.fr & 1;
  const prims: Prim[] = [
    box(2, 4, 14, 15, 0, 9, P.white, shade(P.white, 0.92), { tex: { f: (u, v, w) => (u === Math.floor(w / 2) - 0 ? shade(P.grey1, 0.8) : (u === 4 || u === 7) && v > 1 && v < 4 ? P.grey2 : 0) } }),
    box(1, 3, 15, 15, 9, 10, P.grey1, P.grey2),
    box(3, 4, 11, 10, 10, 25, P.steel, P.steelDark, {
      tex: { f: (u, v, w, h) => (u === 0 || u === w - 1 ? shade(P.steelDark, 0.8) : v >= 2 && v <= 5 && u >= 2 && u <= w - 3 ? (v === 3 && u > 2 && u < 6 ? EM(P.cyan) : P.ink) : v === 8 && u === 2 ? P.redNeon : v === 8 && u === 4 ? P.mint : v === 8 && u === 6 ? P.gold : v >= h - 4 && v < h - 1 && u > 1 && u < w - 2 ? P.ink : 0) },
    }),
    box(3, 4, 11, 10, 25, 26, P.steelDark, P.steelDark),
    cyl(7, 8, 1.5, 10, 12, P.white, P.white),
    cyl(13, 8, 2, 10, 15, shade(P.wood3, 1.0), P.glass),
    cyl(5, 12, 1.5, 10, 12, P.white, P.white),
    box(12, 11, 14, 13, 10, 11, P.red, shade(P.red, 0.8)),
  ];
  prims.push(sph(7, 8, 14 + steam, 1, rgba('#ffffff', 255)));
  return { scene: { w: c.w, d: c.d, prims } };
}

function coolerScene(): Built {
  const prims: Prim[] = [
    box(4, 5, 12, 13, 0, 17, P.white, shade(P.grey1, 1.0), {
      tex: { f: (u, v, w) => (v >= 6 && v <= 7 && (u === 2 || u === w - 3) ? (u === 2 ? P.cyan : P.redNeon) : v >= 10 && v <= 11 && u > 1 && u < w - 2 ? P.grey2 : v === 3 && u > 2 && u < w - 3 ? P.grey1 : u === 0 ? shade(P.white, 0.92) : 0) },
    }),
    box(4, 5, 12, 13, 17, 18, P.grey1, P.grey2),
    cyl(8, 9, 3.5, 18, 27, P.glass, shade(P.glass, 0.95)),
    cyl(8, 9, 2, 28, 28, P.white, P.white),
    box(6, 6, 7, 8, 18, 27, shade(P.screenHi, 1.0), shade(P.screenHi, 1.0), { flat: true }),
  ];
  return { scene: { w: 16, d: 16, prims } };
}

function pingpongScene(c: Ctx): Built {
  const W = c.w, D = c.d, blue = shade(P.navy, 2.05);
  const prims: Prim[] = [
    box(5, 6, 8, 9, 0, 10, P.grey3, P.grey2), box(W - 8, 6, W - 5, 9, 0, 10, P.grey3, P.grey2),
    box(5, D - 8, 8, D - 5, 0, 10, P.grey3, P.grey2), box(W - 8, D - 8, W - 5, D - 5, 0, 10, P.grey3, P.grey2),
    box(3, 5, W - 3, D - 4, 10, 12, blue, shade(blue, 0.7), {
      topTex: (u, v, w, h) => (u === 1 || v === 1 || u === w - 2 || v === h - 2 ? P.white : v === Math.floor(h / 2) && u > 1 && u < w - 2 ? shade(P.white, 0.9) : u === Math.floor(w / 2) ? shade(P.white, 0.86) : hash(u, v, 13) > 0.95 ? shade(blue, 1.12) : 0),
    }),
    box(W / 2 - 1, 4, W / 2 + 1, D - 3, 12, 15, P.white, P.grey1, { topTex: (u, v) => ((u + v) % 2 === 0 ? P.grey1 : 0), tex: { f: (u, v) => ((u + v) % 2 === 0 ? P.grey1 : P.white) } }),
    box(W / 2 - 2, 3, W / 2 + 2, 5, 10, 16, P.grey2, P.grey3, { flat: true }), box(W / 2 - 2, D - 4, W / 2 + 2, D - 2, 10, 16, P.grey2, P.grey3, { flat: true }),
    cyl(W / 2 - 12, D / 2 + 3, 1, 12, 12, P.orange, P.orange),
    box(W / 2 + 9, D / 2 - 5, W / 2 + 13, D / 2 - 1, 12, 12.5, P.red, P.red, { flat: true, round: true }),
    box(W / 2 - 14, D / 2 + 5, W / 2 - 10, D / 2 + 9, 12, 12.5, P.wood1, P.wood1, { flat: true, round: true }),
  ];
  return { scene: { w: W, d: D, prims, floor: [{ x0: 5, y0: 8, x1: W - 4, y1: D - 3, c: rgba('#000000', 70) }] } };
}

function bookshelfScene(c: Ctx): Built {
  const W = c.w, wood = OAK_SIDE;
  const books = [P.red, P.teal, P.gold, shade(P.navy, 1.6), P.purple, P.leaf3, P.orange, shade(P.pink, 0.9), P.paper];
  const shelfRows = [0, 6, 12, 18];
  const front: Tex = (u, v, w, h) => {
    if (u < 1 || u >= w - 1) return shade(wood, 1.12);
    if (v >= h - 1) return shade(wood, 0.8);
    const row = shelfRows.findIndex(s => v >= s && v < s + 6);
    const rv = v - shelfRows[row]!;
    if (rv === 0) return row === 0 ? shade(wood, 1.2) : shade(wood, 1.1);
    const bgc = shade(OAK_DARK, 0.62);
    // a gap in one compartment holds a small frame or jar instead of books
    if (row === 2 && u > w - 10 && u < w - 4) return rv === 5 ? shade(wood, 0.9) : rv > 2 ? (u === w - 7 ? P.leaf1 : shade(P.terracotta, 1)) : bgc;
    let acc = 1;
    for (let k = 0; k < 40; k++) {
      const bw = 2 + Math.floor(hash(k, row, 31) * 2), bh = 3 + Math.floor(hash(k, row, 32) * 3);
      if (u >= acc && u < acc + bw) { const top = 6 - bh; return rv >= top ? (u === acc ? shade(books[(k * 3 + row) % books.length]!, 0.8) : books[(k * 3 + row) % books.length]!) : bgc; }
      acc += bw;
      if (acc >= w - 1) break;
    }
    return bgc;
  };
  const prims: Prim[] = [
    box(1, 4, W - 1, 14, 0, 24, OAK_TOP, wood, {
      tex: {
        f: front,
        b: (u, _v, w) => (u === 0 || u === w - 1 ? shade(wood, 0.9) : u % 8 === 4 ? shade(wood, 0.85) : shade(wood, 1.0) as Rgba),
        l: (_u, v) => (v === 0 ? shade(wood, 1.15) : v % 6 === 0 ? shade(wood, 0.85) : 0),
        r: (_u, v) => (v === 0 ? shade(wood, 1.15) : v % 6 === 0 ? shade(wood, 0.85) : 0),
      },
      topTex: woodGrain(OAK_TOP, 3),
    }),
    box(4, 7, 9, 11, 24, 26, P.red, shade(P.red, 0.8), { topTex: (_u, v) => (v === 1 ? P.paper : 0) }),
    box(5, 8, 10, 12, 26, 28, P.teal, shade(P.teal, 0.8)),
    cyl(W - 8, 9, 3, 24, 28, shade(P.terracotta, 1.1), shade(P.terracotta, 0.9)),
    sph(W - 8, 9, 31, 3, P.leaf2, true), sph(W - 10, 9, 29, 2, P.leaf1, true),
  ];
  return { scene: { w: W, d: c.d, prims } };
}

function plantScene(): Built {
  const prims: Prim[] = [
    cyl(8, 10, 4, 0, 6, shade(P.wood3, 1.0), shade(P.terracotta, 1.0)),
    box(4, 9, 12, 10, 5, 6, shade(P.terracotta, 1.25), shade(P.terracotta, 1.15), { flat: true, topTex: () => 0 }),
    sph(8, 10, 10, 3.2, P.leaf3, true), sph(5, 10, 12, 3.2, P.leaf2, true), sph(11, 10, 12, 3.2, P.leaf2, true),
    sph(8, 10, 15, 3.6, P.leaf1, true), sph(6, 10, 17, 2.8, P.leaf1, true), sph(10, 10, 18, 2.8, P.leaf2, true), sph(8, 10, 20, 2.2, P.leaf1, true),
  ];
  return { scene: { w: 16, d: 16, prims } };
}

function lampScene(c: Ctx): Built {
  const shadeC = c.dark ? P.lampGlow : shade(P.lampGlow, 0.9);
  const prims: Prim[] = [
    cyl(8, 11, 3, 0, 1, P.grey3, P.grey2), box(8, 10, 9, 11, 1, 20, P.grey1, P.grey2, { flat: true }),
    cyl(8.5, 10.5, 4.5, 19, 25, EM(shade(shadeC, 1.05)), EM(shadeC)),
  ];
  return { scene: { w: 16, d: 16, prims } };
}

function diningScene(c: Ctx): Built {
  const W = c.w, D = c.d, top = shade(P.paper, 0.96), leg = shade(P.wood2, 1.2);
  const prims: Prim[] = [
    box(5, D / 2 - 6, 8, D / 2 - 3, 0, 10, leg, shade(leg, 0.8)), box(W - 8, D / 2 - 6, W - 5, D / 2 - 3, 0, 10, leg, shade(leg, 0.8)),
    box(5, D / 2 + 3, 8, D / 2 + 6, 0, 10, leg, shade(leg, 0.8)), box(W - 8, D / 2 + 3, W - 5, D / 2 + 6, 0, 10, leg, shade(leg, 0.8)),
    box(3, D / 2 - 8, W - 3, D / 2 + 8, 10, 12, top, shade(top, 0.82), { round: true, topTex: (u, v, w) => (v === 1 || v === 14 || u === 1 || u === w - 2 ? shade(top, 0.92) : (u + v * 3) % 11 === 0 ? shade(top, 0.94) : 0) }),
    cyl(W / 2, D / 2, 2, 12, 15, P.leaf2, shade(P.terracotta, 1.1)), sph(W / 2, D / 2, 17, 2, P.leaf1, true),
  ];
  for (const px of [W / 2 - 14, W / 2, W / 2 + 14]) for (const py of [D / 2 - 4.5, D / 2 + 4.5]) {
    prims.push(cyl(px, py, 2.5, 12, 12, P.white, P.white));
    prims.push(box(px - 4, py - 0.5, px - 3, py + 0.5, 12, 12.5, P.grey2, P.grey2, { flat: true }));
  }
  const chairs: ChairSpec[] = [];
  for (const px of [W / 2 - 14.4, W / 2, W / 2 + 14.4]) { chairs.push({ kind: 'stool', variant: 0, cx: px, cy: D / 2 - 12, look: 'S' }, { kind: 'stool', variant: 0, cx: px, cy: D / 2 + 12, look: 'N' }); }
  return { scene: { w: W, d: D, prims, floor: [{ x0: 5, y0: D / 2 - 6, x1: W - 4, y1: D / 2 + 9, c: rgba('#000000', 55) }] }, chairs, sort: 'mid' };
}

function kitchenScene(c: Ctx): Built {
  const W = c.w;
  const door: Tex = (u, v, w, h) => (u === 0 ? shade(P.white, 0.88) : u === w - 1 ? shade(P.white, 0.8) : v === 0 ? shade(P.white, 1.0) : v === h - 1 ? P.grey3 : (u === 3 && v > 1 && v < 6) || (u === w - 4 && v > 1 && v < 6) ? P.grey2 : 0);
  const prims: Prim[] = [
    box(1, 4, W - 1, 15, 0, 9, P.white, P.white, { tex: { f: (u, v, w, h) => (v >= h - 2 ? P.grey4 : u === Math.floor(w / 2) || u === Math.floor(w / 2) - 1 ? shade(P.grey1, 0.75) : door(u % 15, v, 15, h)) } }),
    box(0, 3, W, 15, 9, 11, P.grey1, P.grey2, { topTex: (u, v) => (u > 4 && u < 13 && v > 3 && v < 10 ? shade(P.steel, 1.3) : u > 4 && u < 13 && v > 3 ? 0 : hash(u, v, 21) > 0.96 ? shade(P.grey1, 0.9) : 0) }),
    box(7, 5, 11, 9, 10, 10, shade(P.steel, 1.6), shade(P.steel, 1.6), { flat: true, topTex: (u, v) => (u === 1 && v === 1 ? P.ink : 0) }),
    box(8, 4, 9, 5, 10, 17, P.grey2, P.grey3, { flat: true }), box(8, 4, 12, 6, 17, 18, P.grey2, P.grey3),
    box(W - 16, 4, W - 3, 11, 11, 20, P.ink, P.night, {
      tex: { f: (u, v, _w, h) => (v === 0 || u === 0 ? shade(P.ink, 1.6) : u > 1 && u < 9 && v > 1 && v < h - 2 ? (u > 2 && u < 8 && v > 2 && v < h - 3 ? shade(P.steelDark, 1.4) : P.steelDark) : u > 9 && v === 3 ? EM(P.mint) : u > 9 && v > 4 && v < 8 && u % 2 === 0 ? P.grey2 : 0) },
    }),
    cyl(28, 12, 2, 11, 14, P.red, P.red),
  ];
  return { scene: { w: W, d: c.d, prims } };
}

function fridgeScene(): Built {
  const prims: Prim[] = [
    box(2, 3, 14, 14, 0, 27, P.white, P.white, {
      tex: {
        f: (u, v, w, h) => (u === 0 ? shade(P.white, 0.88) : u === w - 1 ? shade(P.grey1, 0.9) : v === 10 ? P.grey2 : v === h - 1 ? P.grey3 : u === w - 4 && ((v > 2 && v < 8) || (v > 12 && v < 19)) ? P.grey2 : u === 3 && v === 14 ? P.redNeon : u === 4 && v === 15 ? P.yellow : u === 6 && v >= 13 && v <= 16 ? P.paper : u === 7 && v === 14 ? P.cyan : 0),
        b: (u, v, w) => (u === 0 || u === w - 1 ? shade(P.grey1, 0.9) : v % 3 === 1 && u > 2 && u < w - 3 ? P.grey2 : P.grey1),
      },
    }),
    box(3, 4, 13, 5, 27, 28, shade(P.grey1, 1.05), P.grey1, { flat: true }),
  ];
  return { scene: { w: 16, d: 16, prims } };
}

function bedScene(c: Ctx): Built {
  const W = c.w, D = c.d, blue = shade(P.glass, 0.95);
  const prims: Prim[] = [
    box(1, 2, W - 1, D - 1, 0, 3, OAK_TOP, OAK_SIDE, { tex: { f: () => 0 } }),
    box(2, 4, W - 2, D - 3, 3, 7, P.white, shade(P.grey1, 1.04), { round: true }),
    box(1, 1, W - 1, 4, 0, 15, OAK_TOP, OAK_SIDE, { round: true, tex: { f: (u, v, w) => (u > 1 && u < w - 2 && v > 1 && v < 11 && u % 4 !== 0 ? shade(OAK_SIDE, 1.2) : 0), b: (u, v, w) => (u > 1 && u < w - 2 && v > 1 && v < 11 && u % 4 !== 0 ? shade(OAK_SIDE, 1.2) : 0) } }),
    box(1, D - 3, W - 1, D, 0, 7, OAK_TOP, OAK_SIDE, { round: true }),
    box(3, 5, W / 2 + 0, 11, 7, 10, P.white, shade(P.grey1, 1.04), { round: true, topTex: (u, v) => (u === 2 && v === 2 ? shade(P.grey1, 0.9) : 0) }),
    box(W / 2 + 1, 5, W - 3, 11, 7, 10, P.white, shade(P.grey1, 1.04), { round: true }),
    box(2, 20, W - 2, D - 3, 7, 9, blue, shade(blue, 0.82), {
      round: true, topTex: (u, v) => (v < 3 ? P.white : (u + v) % 6 < 2 ? shade(blue, 1.12) : 0),
      tex: { f: (u, v) => (v === 0 ? P.white : (u + v) % 6 < 2 ? shade(blue, 0.92) : 0), b: () => 0 },
    }),
    sph(W - 5, D - 6, 12, 2.2, shade(P.wood1, 1.0), true),
  ];
  const bands = seatBands(c);
  return { scene: { w: W, d: D, prims, bands }, sort: 'mid' };
}

function arcadeScene(c: Ctx): Built {
  const fr = c.fr & 1, body = P.purple, pink = P.pink;
  const screen: Tex = (u, v, w, h) => {
    if (u === 0 || u === w - 1 || v === 0 || v === h - 1) return P.night;
    const iu = u - 1, iv = v - 1;
    // attract mode: rows of invaders and a ship that moves between two states
    if (iv === 10 && Math.abs(iu - (3 + fr * 2)) <= 1) return EM(P.mint);
    if (iv === 9 && iu === 3 + fr * 2) return EM(P.mint);
    if ([1, 3].includes(iv) && iu >= 1 && iu <= 6 && (iu + fr) % 2 === 0) return EM(iv === 1 ? P.redNeon : P.yellow);
    if (iv === 6 && iu === 5 - fr * 2) return EM(P.white);
    return hash(iu, iv, 5) > 0.93 ? EM(P.screenHi) : EM(shade(P.navy, 0.75));
  };
  const prims: Prim[] = [
    box(3, 5, 13, 15, 0, 9, body, shade(body, 0.8), { tex: { f: (u, v, w) => (u === 0 || u === w - 1 ? shade(body, 0.7) : v === 2 && u > 2 && u < 7 ? P.ink : v === 2 && u === 4 ? P.yellow : v === 7 ? shade(body, 0.6) : (u + v) % 5 === 0 ? shade(body, 1.2) : 0) } }),
    box(3, 11, 13, 15, 9, 11, shade(body, 0.55), shade(body, 0.45), { topTex: (u, v) => ((u === 2 || u === 7) && v === 3 ? P.yellow : u === 5 && v === 3 ? P.redNeon : u === 8 && v === 3 ? P.mint : 0) }),
    cyl(5, 12, 1, 11, 14, P.grey2, P.grey3), cyl(5, 12, 1.4, 14, 14, P.redNeon, P.redNeon),
    box(3, 5, 13, 11, 11, 24, body, shade(body, 0.8), { tex: { f: screen, b: (u, _v, w) => (u === 0 || u === w - 1 ? shade(body, 0.7) : shade(body, 0.85)), l: () => 0, r: () => 0 } }),
    box(3, 4, 13, 12, 24, 28, shade(pink, 1.0), shade(pink, 0.75), { tex: { f: (u, v, w) => (v === 0 || v === 3 ? shade(P.gold, 1.0) : u > 1 && u < w - 2 && v === 1 ? EM(P.yellow) : u > 2 && u < w - 3 && v === 2 ? EM(P.white) : 0), b: () => shade(pink, 0.7) } }),
  ];
  return { scene: { w: 16, d: 16, prims } };
}

/** The CEO's car, a boxy SUV. Local front is +y (south); length 48, width 32. */
function carScene(c: Ctx): Built {
  const W = c.w, D = c.d;
  const body = shade(P.steel, 1.2), roof = shade(P.steel, 1.7), glass = shade(P.navy, 2.3);
  const bodySide = (arches: number[]): Tex => (u, v, w, h) => {
    const cu = (u: number) => u;
    for (const a of arches) { const dx = cu(u) - a, dy = v - h; if (dx * dx + dy * dy <= 38) return P.ink; }
    if (v >= h - 1) return P.ink;
    if (v === 0) return shade(body, 1.5);
    if ((u === 15 || u === 27) && v < h - 1) return shade(body, 0.62);
    if ((u === 13 || u === 14 || u === 25 || u === 26) && v === 2) return shade(P.grey1, 0.9);
    if (u > w - 4 && v > 1 && v < 4) return EM(P.orange);
    return 0;
  };
  const wheel = (face: 'l' | 'r'): Tex => (u, v) => {
    const uu = face === 'l' ? u : 11 - u, dx = uu - 5.5, dy = v - 4.5, d2 = dx * dx + dy * dy;
    return d2 > 25 ? CUT : d2 > 11 ? P.ink : d2 > 3 ? shade(P.grey1, 0.95) : P.grey2;
  };
  const wheelBox = (x0: number, y0: number) => box(x0, y0, x0 + 3, y0 + 12, 0, 10, shade(body, 1.2), P.ink, { flat: true, tex: { l: wheel('l'), r: wheel('r'), f: () => P.ink, b: () => P.ink } });
  const windows = (flip: boolean): Tex => (u, v, w, h) => {
    const uu = flip ? w - 1 - u : u;
    if (v === h - 1 || v === h - 2) return body;
    if (uu < 2 || uu >= w - 2 || v === 0 || uu === 11 || uu === 12) return body;
    return (uu + v * 1.6) % 9 < 1.6 ? shade(glass, 1.6) : glass;
  };
  const prims: Prim[] = [
    wheelBox(0, 6), wheelBox(W - 3, 6), wheelBox(0, 30), wheelBox(W - 3, 30),
    box(3, 2, W - 3, D - 2, 3, 13, shade(body, 1.18), body, {
      tex: {
        f: (u, v, w, h) => {
          if (v >= h - 1) return P.ink;
          const hl = (cx: number) => { const dx = u - cx, dy = v - 3.5, d2 = dx * dx + dy * dy; return d2 > 10 ? 0 : d2 > 5 ? P.grey1 : EM(P.white); };
          const a = hl(4.5) || hl(w - 5.5);
          if (a) return a;
          if (u >= 9 && u <= w - 10) { if (v === 3 && u >= w / 2 - 2 && u <= w / 2 + 1) return P.grey1; return v % 3 === 1 ? P.grey2 : P.ink; }
          if (v === 8 && (u < 4 || u > w - 5)) return EM(P.orange);
          return 0;
        },
        b: (u, v, w) => (v >= 8 ? P.ink : (u < 4 || u > w - 5) && v > 1 && v < 6 ? EM(P.redNeon) : v === 4 && u > w / 2 - 3 && u < w / 2 + 3 ? P.white : 0),
        l: bodySide([10, 34]),
        r: (u, v, w, h) => bodySide([10, 34])(w - 1 - u, v, w, h),
      },
      topTex: (u, v, w) => (v >= 33 ? (u === 6 || u === w - 7 ? shade(body, 0.75) : v >= 40 && Math.abs(u - w / 2) < 2 && Math.abs(v - 41) < 2 ? P.grey1 : (u + v) % 7 === 0 ? shade(body, 1.4) : shade(body, 1.3)) : 0),
    }),
    box(6, 12, W - 6, 36, 13, 22, glass, body, { tex: { f: (u, v, w, h) => (u < 1 || u >= w - 1 || v === 0 ? body : v === h - 1 ? body : u === Math.floor(w / 2) ? body : (u + v * 1.5) % 8 < 1.6 ? shade(glass, 1.7) : glass), b: (u, v, w) => (u < 2 || u >= w - 2 || v === 0 || v > 8 ? body : v % 3 === 1 ? shade(glass, 0.8) : glass), l: windows(false), r: windows(true) } }),
    box(6, 12, W - 6, 36, 22, 24, roof, shade(roof, 0.8), { topTex: (u, v) => (hash(u, v, 41) > 0.9 ? shade(roof, 1.15) : 0) }),
    box(8, 15, 10, 33, 24, 25, P.ink, P.ink, { flat: true }), box(W - 10, 15, W - 8, 33, 24, 25, P.ink, P.ink, { flat: true }),
    box(1, 28, 3, 31, 15, 18, P.ink, P.ink, { flat: true }), box(W - 3, 28, W - 1, 31, 15, 18, P.ink, P.ink, { flat: true }),
    box(2, D - 2, W - 2, D, 1, 6, P.ink, shade(P.ink, 1.6), { round: true }),
    box(2, 0, W - 2, 2, 1, 6, P.ink, shade(P.ink, 1.6), { round: true }),
    box(W / 2 - 6, 0, W / 2 + 6, 2, 6, 17, P.ink, P.ink, { flat: true, tex: { b: (u, v) => { const dx = u - 5.5, dy = v - 5.5, d2 = dx * dx + dy * dy; return d2 > 37 ? CUT : d2 > 16 ? P.ink : shade(body, 1.2); } } }),
  ];
  return { scene: { w: W, d: D, prims, floor: [] } };
}

// ------------------------------------------------------------------------------------------------ wall cell

function wallScene(item: OfficeItem): Scene {
  let links = item.links || '';
  if (links.length === 1) links += ({ n: 's', s: 'n', e: 'w', w: 'e' } as Record<string, string>)[links];
  const cap = P.white, face = shade(P.white, 0.9), glass = rgb(190, 228, 246, 74);
  const wains = mixc(P.white, P.teal, 0.34);
  const solid: Tex = (_u, v, _w, h) => (v >= h - 3 ? shade(P.teal, 0.62) : v >= 14 ? (v === 14 ? shade(wains, 1.15) : wains) : v < 2 ? shade(P.white, 1.04) : 0);
  const bar: Tex = (u, v, w, h) => {
    if (w < 16) return solid(u, v, w, h);
    if (v >= 2 && v < 13) {
      if (u === 0) return shade(P.grey1, 0.95);
      if (u === w - 1) return shade(P.grey1, 0.85);
      return (u + v * 2 + 6) % 11 < 2 ? rgb(255, 255, 255, 120) : glass;
    }
    return solid(u, v, w, h);
  };
  const prims: Prim[] = [];
  const hasH = links.includes('e') || links.includes('w');
  if (hasH) prims.push(box(links.includes('w') ? 0 : 5, 5, links.includes('e') ? 16 : 11, 11, 0, WALL_H, cap, face, { flat: true, tex: { f: bar } }));
  else prims.push(box(5, 5, 11, 11, 0, WALL_H, cap, face, { flat: true, tex: { f: solid, b: solid, l: solid, r: solid } }));
  if (links.includes('n')) prims.push(box(5, 0, 11, 5, 0, WALL_H, cap, face, { flat: true, tex: { f: solid, b: solid, l: solid, r: solid } }));
  if (links.includes('s')) prims.push(box(5, 11, 11, 16, 0, WALL_H, cap, face, { flat: true, tex: { f: solid, b: solid, l: solid, r: solid } }));
  const noOutline: ('n' | 's' | 'e' | 'w')[] = [];
  if (links.includes('n')) noOutline.push('n');
  return { w: 16, d: 16, prims, padX: 0, noOutline, noShadow: true };
}

// ------------------------------------------------------------------------------------------------ ground items

function noiseColor(base: Rgba, x: number, y: number, amount: number, seed: number) {
  const h = hash(x, y, seed);
  return h > 1 - amount ? shade(base, 1.04) : h < amount ? shade(base, 0.96) : base;
}

function zoneBuffer(w: number, d: number, tint: Rgba, dark: boolean): PixelBuffer {
  const W = w * TILE, D = d * TILE, buf = new PixelBuffer(W, D), data = buf.data;
  const out = (c: Rgba) => (dark ? dimFloor(c) : c);
  // the few colours a pixel can have, worked out once: [checker parity][noise: plain, lighter, darker][on a tile line]
  const table: Rgba[] = [];
  for (const parity of [0, 1]) {
    const b = parity === 0 ? tint : shade(tint, 0.985);
    for (const v of [b, shade(b, 1.04), shade(b, 0.96)]) table.push(out(v), out(shade(v, 0.965)));
  }
  const edge = out(shade(tint, 0.78)), inner = out(shade(tint, 1.04)), corner = out(shade(tint, 0.62));
  for (let y = 0; y < D; y++) {
    const ty = (y / TILE) | 0, rowLine = y % TILE === 0 ? 1 : 0, row = y * W;
    const yEdge = y === 0 || y === D - 1, yInner = y === 1 || y === D - 2;
    for (let x = 0; x < W; x++) {
      if (yEdge || x === 0 || x === W - 1) { data[row + x] = (x === 0 || x === W - 1) && yEdge ? corner : edge; continue; }
      if (yInner || x === 1 || x === W - 2) { data[row + x] = inner; continue; }
      const h = hash(x, y, 3), noise = h > 0.93 ? 1 : h < 0.07 ? 2 : 0;
      data[row + x] = table[((((x >> 4) + ty) & 1) * 3 + noise) * 2 + (rowLine || (x & 15) === 0 ? 1 : 0)]!;
    }
  }
  return buf;
}

function parkingBuffer(w: number, d: number, dark: boolean): PixelBuffer {
  const W = w * TILE, D = d * TILE, buf = new PixelBuffer(W, D), base = P.grey1;
  for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) buf.data[y * W + x] = noiseColor(base, x, y, 0.1, 4);
  const line = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) buf.data[y * W + x] = P.white; };
  line(3, 3, W - 3, 5); line(3, D - 5, W - 3, D - 3); line(3, 3, 5, D - 3); line(W - 5, 3, W - 3, D - 3);
  for (let x = 12; x < W - 12; x += 16) line(x, D / 2 - 1, x + 8, D / 2 + 1);
  // oil stain
  for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) if ((x - W / 2) ** 2 / 90 + (y - D / 2 - 2) ** 2 / 28 < 1 && hash(x, y, 9) > 0.55) buf.data[y * W + x] = shade(base, 0.88);
  // "CEO" in 3x5 letters, scale 2
  const glyph: Record<string, string[]> = { C: ['111', '100', '100', '100', '111'], E: ['111', '100', '110', '100', '111'], O: ['111', '101', '101', '101', '111'] };
  let gx = W - 5 - (3 * 7 - 1) - 1;
  for (const ch of 'CEO') {
    glyph[ch]!.forEach((row, ry) => [...row].forEach((bit, rx) => { if (bit === '1') line(gx + rx * 2, D - 7 - 10 + ry * 2, gx + rx * 2 + 2, D - 7 - 10 + ry * 2 + 2); }));
    gx += 8;
  }
  if (dark) for (let i = 0; i < buf.data.length; i++) buf.data[i] = dimFloor(buf.data[i]!);
  return buf;
}

function rugBuffer(w: number, d: number, dark: boolean): PixelBuffer {
  const W = w * TILE, D = d * TILE, buf = new PixelBuffer(W, D);
  const red = shade(P.terracotta, 0.95), cream = shade(P.paper, 1.0), navy = shade(P.navy, 1.5);
  for (let y = 1; y < D - 1; y++) for (let x = 1; x < W - 1; x++) {
    const e = Math.min(x, y, W - 1 - x, D - 1 - y);
    let c: Rgba;
    if (e < 2) c = shade(red, 0.8);
    else if (e < 5) c = (x + y) % 4 < 2 ? red : shade(red, 1.12);
    else if (e < 6) c = cream;
    else if (e < 7) c = navy;
    else {
      c = cream;
      const dx = ((x - 7) % 8) - 3.5, dy = ((y - 7) % 8) - 3.5;
      if (Math.abs(dx) + Math.abs(dy) < 2.6) c = Math.abs(dx) + Math.abs(dy) < 1.2 ? shade(red, 1.05) : shade(navy, 1.0);
      c = noiseColor(c, x, y, 0.05, 6);
    }
    buf.data[y * W + x] = dark ? dimFloor(c) : c;
  }
  // fringe on the short sides
  const fringe = shade(P.paper, 0.92);
  const horizontal = W >= D;
  for (let k = 0; k < (horizontal ? D : W); k += 2) {
    if (horizontal) { buf.set(0, k, dark ? dimFloor(fringe) : fringe); buf.set(W - 1, k, dark ? dimFloor(fringe) : fringe); }
    else { buf.set(k, 0, dark ? dimFloor(fringe) : fringe); buf.set(k, D - 1, dark ? dimFloor(fringe) : fringe); }
  }
  return buf;
}

// ------------------------------------------------------------------------------------------------ drawItem

interface Part { sprite: Sprite; dx: number; dy: number; /** sortY relative to the footprint top; null = ground layer */ sy: number | null }
/** How many pictures each cache keeps (the one unused for longest goes first). */
export const CACHE_LIMITS = { items: 300, floors: 4, walls: 4 };
/** Map that forgets its least recently used key once it holds more than `cap`. */
class Lru<V> {
  private m = new Map<string, V>();
  constructor(private cap: number) {}
  get size() { return this.m.size; }
  get(key: string): V | undefined {
    const v = this.m.get(key);
    if (v !== undefined) { this.m.delete(key); this.m.set(key, v); }
    return v;
  }
  set(key: string, v: V) {
    this.m.delete(key); this.m.set(key, v);
    while (this.m.size > this.cap) this.m.delete(this.m.keys().next().value as string);
  }
}
const itemCache = new Lru<Part[]>(CACHE_LIMITS.items);
export const cacheStats = () => ({ items: itemCache.size, floors: floorCache.size, walls: wallCache.size });

function chairParts(chairs: ChairSpec[], xf: Xf, dark: boolean, rot: number): Part[] {
  return chairs.flatMap((ch): Part[] => {
    const [cx, cy] = xf.fwd(ch.cx, ch.cy);
    // rotate the look vector with the item
    const v: Record<Look, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
    const [lx, ly] = v[ch.look];
    const [rx, ry] = rot === 90 ? [ly, -lx] : rot === 180 ? [-lx, -ly] : rot === 270 ? [-ly, lx] : [lx, ly];
    const look: Look = ry < 0 ? 'N' : ry > 0 ? 'S' : rx > 0 ? 'E' : 'W';
    const sortY = ch.kind === 'stool' ? cy : look === 'N' ? cy + 4 : look === 'S' ? cy - 4 : cy - 1;
    const r = chairSprite(ch.kind, ch.variant, look, dark), dx = Math.round(cx) - 8, dy = Math.round(cy) - 8;
    if (look === 'N' && r.b) return [{ sprite: r.a, dx, dy, sy: cy - 1 }, { sprite: r.b, dx, dy, sy: sortY }];
    return [{ sprite: r.a, dx, dy, sy: sortY }];
  });
}

function buildScene(type: ItemType, c: Ctx): Built | null {
  switch (type) {
    case 'desk': return deskScene(c);
    case 'teamdesk': return teamdeskScene(c);
    case 'ceodesk': return ceodeskScene(c);
    case 'meeting': return meetingScene(c);
    case 'whiteboard': return whiteboardScene(c);
    case 'sofa': return sofaScene(c);
    case 'coffee': return coffeeScene(c);
    case 'cooler': return coolerScene();
    case 'pingpong': return pingpongScene(c);
    case 'bookshelf': return bookshelfScene(c);
    case 'plant': return plantScene();
    case 'lamp': return lampScene(c);
    case 'dining': return diningScene(c);
    case 'kitchen': return kitchenScene(c);
    case 'fridge': return fridgeScene();
    case 'bed': return bedScene(c);
    case 'arcade': return arcadeScene(c);
    case 'gclass': return carScene(c);
    default: return null;
  }
}

/** Does the picture change with the frame counter? Screens only move while someone works at them; the arcade and the coffee machine always do. */
function animates(item: OfficeItem, o: ItemOptions): boolean {
  switch (item.type) {
    case 'arcade': case 'coffee': return true;
    case 'desk': case 'ceodesk': return !!o.active;
    case 'teamdesk': return !!o.active || (o.activeSeats?.length ?? 0) > 0;
    default: return false;
  }
}
/** Quarter turns as the catalog's footprint() reads them: only exactly 90 and 270 turn an item sideways; 180 is exact too; anything else is rot 0. */
function quarterTurn(rot: number | undefined): number {
  const r = (((rot || 0) % 360) + 360) % 360;
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

function buildParts(item: OfficeItem, o: ItemOptions, rot: number): Part[] {
  const fp = footprint(item);
  const base = CATALOG[item.type];
  const sized = item.w && item.d ? { w: item.w, d: item.d } : { w: base.w, d: base.d };
  const dark = o.dark, fr = animates(item, o) ? (o.frame ?? 0) & 1 : 0;
  const tint = item.tint ? rgba(item.tint) : item.type === 'zone' ? P.grey1 : P.white;
  if (item.type === 'zone') return [{ sprite: { buf: zoneBuffer(fp.w, fp.d, tint, dark), ax: 0, ay: 0 }, dx: 0, dy: 0, sy: null }];
  if (item.type === 'parking') return [{ sprite: { buf: parkingBuffer(fp.w, fp.d, dark), ax: 0, ay: 0 }, dx: 0, dy: 0, sy: null }];
  if (item.type === 'rug') return [{ sprite: { buf: rugBuffer(fp.w, fp.d, dark), ax: 0, ay: 0 }, dx: 0, dy: 0, sy: null }];
  const parts: Part[] = [];
  if (item.type === 'wall') {
    const r = renderScene(wallScene(item), 0, dark);
    parts.push({ sprite: r.a, dx: 0, dy: 0, sy: TILE });
    return parts;
  }
  // teamdesks are drawn for the footprint they have, seats are absolute, so they ignore rot
  const useRot = item.type === 'teamdesk' ? 0 : rot;
  const W = (item.type === 'teamdesk' ? fp.w : sized.w) * TILE, D = (item.type === 'teamdesk' ? fp.d : sized.d) * TILE;
  const ctx: Ctx = { item, w: W, d: D, active: !!o.active, activeSeats: o.activeSeats ?? [], dark, fr, rot: useRot };
  const built = buildScene(item.type, ctx);
  if (!built) throw new Error(`no pixel art for ${item.type}`);
  const r = renderScene(built.scene, useRot, dark);
  const xf = makeXf(W, D, useRot);
  const bottom = xf.Dr;
  if (r.bands && built.scene.bands) {
    // slices between the sitters: a slice sorts just behind the sitter below its last line and in front of the one above its first
    const cuts = built.scene.bands;
    r.bands.forEach((s, k) => { if (s) parts.push({ sprite: s, dx: 0, dy: 0, sy: k === 0 ? cuts[0]! - 1 : k === cuts.length ? bottom : (cuts[k - 1]! + cuts[k]!) / 2 }); });
  } else if (built.sort === 'mid') {
    if (item.type === 'meeting' || item.type === 'dining') parts.push({ sprite: r.a, dx: 0, dy: 0, sy: bottom / 2 });
    else { parts.push({ sprite: r.a, dx: 0, dy: 0, sy: bottom / 2 - 3 }); if (r.b) parts.push({ sprite: r.b, dx: 0, dy: 0, sy: bottom }); }
  } else parts.push({ sprite: r.a, dx: 0, dy: 0, sy: bottom });
  if (built.chairs) parts.push(...chairParts(built.chairs, xf, dark, useRot));
  // lamp: a warm pool of light on the floor at night
  if (item.type === 'lamp' && dark) parts.push({ sprite: lampHalo(), dx: -20, dy: -20 + 3, sy: null });
  return parts;
}

let halo: Sprite | null = null;
function lampHalo(): Sprite {
  if (halo) return halo;
  const S = 56, buf = new PixelBuffer(S, S), cx = S / 2, cy = S / 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.1) / 26;
    if (d >= 1) continue;
    const a = Math.round(52 * (1 - d) ** 1.6) - ((x + y) % 2 === 0 && d > 0.55 ? 6 : 0);
    if (a > 3) buf.set(x, y, ((P.lampGlow & 0xffffff00) | a) >>> 0);
  }
  return (halo = { buf, ax: 20, ay: 20 });
}

export const drawItem: DrawItem = (item, options) => {
  const rot = quarterTurn(item.rot);
  const fp = footprint(item);
  const key = [item.type, fp.w, fp.d, rot, item.tint ?? '', options.dark ? 1 : 0, animates(item, options) ? (options.frame ?? 0) & 1 : 0, options.active ? 1 : 0, item.type === 'teamdesk' ? [...(options.activeSeats ?? [])].sort().join('+') : '',
    item.type === 'wall' ? item.links ?? '' : '', item.type === 'teamdesk' ? (item.seats ?? []).map(s => `${s.id},${s.dx},${s.dz},${s.face.toFixed(2)}`).join(';') : '',
    item.type === 'desk' || item.type === 'teamdesk' ? `${hashV(item)}` : ''].join('|');
  let parts = itemCache.get(key);
  if (!parts) { parts = buildParts(item, options, rot); itemCache.set(key, parts); }
  const ox = item.x * TILE, oy = item.z * TILE;
  return parts.map((p): Drawable => ({ sprite: p.sprite, x: ox + p.dx, y: oy + p.dy, sortY: oy + (p.sy ?? 0), layer: p.sy === null ? 'ground' : 'object' }));
};

// ------------------------------------------------------------------------------------------------ floor

const floorCache = new Lru<Drawable>(CACHE_LIMITS.floors);
export const drawFloor: DrawFloor = (width, depth, floorColor, dark) => {
  const key = `${width}|${depth}|${floorColor}|${dark}`;
  let d = floorCache.get(key);
  if (d) return d;
  const W = width * TILE, D = depth * TILE, buf = new PixelBuffer(W, D), base = rgba(floorColor), data = buf.data;
  // Shading is worked out once per tile (a tile has four colours: plain, speckled, lit edge, dark edge), then rows are
  // filled straight into the buffer. Only the few pixels along the walls take the per-pixel shadow path.
  const colors = new Uint32Array(8);
  for (let ty = 0; ty < depth; ty++) for (let tx = 0; tx < width; tx++) {
    const plain = shade(base, 1 + (hash(tx, ty, 77) - 0.5) * 0.05 + ((tx + ty) % 2 === 0 ? 0.02 : -0.015));
    colors[0] = plain; colors[1] = shade(plain, 0.97); colors[2] = shade(plain, 1.05); colors[3] = shade(plain, 0.9);
    for (let k = 0; k < 4; k++) colors[4 + k] = dark ? dimFloor(colors[k]!) : colors[k]!;
    const x0 = tx * TILE, y0 = ty * TILE;
    for (let ly = 0; ly < TILE; ly++) {
      const y = y0 + ly, row = y * W + x0, rowKind = ly === TILE - 1 ? 3 : ly === 0 ? 2 : 0;
      for (let lx = 0; lx < TILE; lx++) {
        const x = x0 + lx;
        const kind = rowKind === 3 || lx === TILE - 1 ? 3 : rowKind === 2 || lx === 0 ? 2 : hash(x, y, 78) > 0.96 ? 1 : 0;
        if (y < 3 || x < 2 || x >= W - 2) {
          // soft contact shadows along the north wall and the side walls
          let c = colors[kind]!;
          if (y < 3) c = shade(c, [0.8, 0.88, 0.95][y]!);
          if (x < 2) c = shade(c, [0.88, 0.95][x]!);
          if (x >= W - 2) c = shade(c, [0.95, 0.88][x - (W - 2)]!);
          data[row + lx] = dark ? dimFloor(c) : c;
        } else data[row + lx] = colors[4 + kind]!;
      }
    }
  }
  d = { sprite: { buf, ax: 0, ay: 0 }, x: 0, y: 0, sortY: 0, layer: 'ground' };
  floorCache.set(key, d);
  return d;
};

// ------------------------------------------------------------------------------------------------ outer walls

const wallCache = new Lru<Drawable[]>(CACHE_LIMITS.walls);
export const drawWalls: DrawWalls = (width, depth, wallColor, doorCells, dark) => {
  const key = `${width}|${depth}|${wallColor}|${doorCells}|${dark}`;
  const hit = wallCache.get(key);
  if (hit) return hit;
  const W = width * TILE, D = depth * TILE, T = 6, base = rgba(wallColor);
  const out: Drawable[] = [];
  // north wall: full height face, windows, skirting; it spans the corners
  const nw = W + T * 2;
  const shLine0 = shade(base, 1.25), shLine1 = shade(base, 1.12), shRail = shade(base, 1.08), shRail2 = shade(base, 0.9), shWains = shade(base, 0.94), shSill = shade(base, 0.7);
  const skirtTop = shade(P.wood3, 1.4), skirt = shade(P.wood3, 1.0);
  const shPlainA = shade(base, 1.025), shPlainB = shade(base, 0.985), shFrame = dark ? shade(P.grey1, 0.8) : P.white;
  const windowAt = (u: number) => { const c = (u - T) % 48; return c >= 15 && c < 33 && u > T + 4 && u < nw - T - 4; };
  const north: Tex = (u, v, _w, h) => {
    const wu = u;
    if (windowAt(wu)) {
      const lu = (wu - T) % 48 - 15; // 0..17
      if (v >= 3 && v < 16) {
        const f = lu === 0 || lu === 17 || v === 3 || v === 15 || lu === 8 || lu === 9 || v === 9; // frame and mullions
        if (f) return shFrame;
        if (dark) return hash(lu, v, 5) > 0.95 ? P.screenHi : mixc(P.night, shade(P.navy, 0.9), (v - 3) / 12);
        const cloud = v === 6 && lu > 2 && lu < 7 || v === 5 && lu > 3 && lu < 6 || v === 12 && lu > 11 && lu < 16;
        return cloud ? P.white : mixc(shade(P.glass, 1.12), shade(P.glass, 0.85), (v - 3) / 12);
      }
      if (v === 16 || v === 17) return v === 16 ? shade(P.white, 1.0) : shSill;
    }
    if (v < 2) return v === 0 ? shLine0 : shLine1;
    if (v >= h - 4) return v === h - 4 ? skirtTop : skirt;
    if (v === 16 || (v === 17 && !windowAt(wu))) return v === 16 ? shRail : shRail2;
    if (v > 17) return shWains; // wainscot
    // decorations between the windows: a clock and a framed picture
    const mid = (wu - T) % 48;
    const alt = Math.floor((wu - T) / 48) % 2 === 1;
    if (!alt && mid >= 38 && mid < 46 && v >= 5 && v < 11) {
      const lu = mid - 38, lv = v - 5;
      if (lu === 0 || lu === 7 || lv === 0 || lv === 5) return P.wood2;
      return (lu + lv) % 3 === 0 ? P.orange : lv > 3 ? P.leaf2 : P.glass;
    }
    if (!alt && mid >= 3 && mid < 10 && v >= 6 && v < 13) {
      const dx = mid - 6.5, dy = v - 9.5, d2 = dx * dx + dy * dy;
      if (d2 <= 12.5) return d2 > 9 ? P.wood2 : (mid === 6 || v === 9) && d2 < 4 ? P.ink : P.white;
    }
    return (wu >> 1) % 2 === 0 ? shPlainA : shPlainB;
  };
  out.push(spriteDrawable(renderScene({ w: nw, d: T, prims: [box(0, 0, nw, T, 0, WALL_H, shade(base, 1.2), base, { flat: true, tex: { f: north } })], noShadow: true }, 0, dark).a, -T, -T, 0));
  // thin side walls: a lit cap and a darker end
  const sideH = D + T + 4;
  for (const [x, flip] of [[-T, false], [W, true]] as const) {
    const side = box(0, 0, T, sideH, 0, WALL_H, shade(base, 1.2), shade(base, 0.85), { flat: true, topTex: (u) => (u === (flip ? T - 1 : 0) ? shade(base, 1.38) : u === (flip ? 0 : T - 1) ? shade(base, 1.0) : 0) });
    out.push(spriteDrawable(renderScene({ w: T, d: sideH, prims: [side], padX: 1, noShadow: true }, 0, dark).a, x, -T, 0));
  }
  // south wall: low, with a gap for the entrance
  const gap = doorCells * TILE, g0 = Math.round(W / 2 - gap / 2), g1 = g0 + gap, H = 6, ST = 4;
  const frontTex: Tex = (u, v, _w, h) => (v === 0 ? shade(base, 1.1) : v >= h - 2 ? shade(P.wood3, 1.1) : (u % 16 === 0) ? shade(base, 0.85) : 0);
  const pieces: [number, number][] = [[-T, g0 - 1], [g1 + 1, W + T]];
  pieces.forEach(([a, b], k) => {
    const len = b - a;
    const prims: Prim[] = [box(0, 0, len, ST, 0, H, shade(base, 1.25), shade(base, 0.92), { flat: true, tex: { f: frontTex } })];
    const postX = k === 0 ? len - 5 : 1;
    prims.push(box(postX, 0, postX + 4, ST, 0, 15, shade(base, 1.15), shade(base, 0.7), { flat: false }));
    out.push(spriteDrawable(renderScene({ w: len, d: ST, prims, padX: 1, noShadow: true }, 0, dark).a, a, D, D + ST));
  });
  // door mat just inside the entrance
  const mw = gap, mh = 9, mat = new PixelBuffer(mw, mh), mc = shade(P.brick, 0.85);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const e = Math.min(x, y, mw - 1 - x, mh - 1 - y);
    let c = e === 0 ? shade(P.wood3, 0.9) : e === 1 ? shade(P.gold, 0.85) : y % 2 === 0 ? mc : shade(mc, 1.1);
    if (e > 2 && x % 4 === 1 && y === 4) c = P.paper;
    mat.data[y * mw + x] = dark ? dimFloor(c) : c;
  }
  out.push({ sprite: { buf: mat, ax: 0, ay: 0 }, x: g0, y: D - 6, sortY: D - 6, layer: 'ground' });
  wallCache.set(key, out);
  return out;
};

function spriteDrawable(sprite: Sprite, x: number, y: number, sortY: number): Drawable {
  // the sprite anchor is the footprint corner: place that corner at (x, y)
  return { sprite, x, y, sortY, layer: 'object' };
}

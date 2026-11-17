// Pixel people drawn by code: 16x24 chibi staff, 4 directions, 10 actions. Pure and deterministic (node safe, no DOM).
// Everything is built in "local" coordinates: x = 0 is the line between the two middle columns, y = 0 is the top outline row
// of the head, the feet end on row 22 and the bottom outline is row 23 (ground line = 24).
import { PERSON_FRAMES, PixelBuffer, rgba, shade, type Dir, type DrawPerson, type PersonAction, type PersonPose, type Rgba, type Sprite } from './types.ts';
import { P } from './palette.ts';
import type { Look } from '../../domain/looks.ts';

const BW = 24, BH = 40, OX = 12, OY = 14;

// ---------------------------------------------------------------- colours

const ch = (c: Rgba, shift: number) => (c >>> shift) & 255;
function mix(a: Rgba, b: Rgba, t: number): Rgba {
  const f = (s: number) => Math.round(ch(a, s) * (1 - t) + ch(b, s) * t);
  return (((f(24) << 24) | (f(16) << 16) | (f(8) << 8) | 255) >>> 0);
}
const lum = (c: Rgba) => ch(c, 24) * 0.3 + ch(c, 16) * 0.59 + ch(c, 8) * 0.11;
const WHITE = rgba('#ffffff'), COOL = rgba('#9aa4d0');
/** Lighter version that still reads on near-black colours. */
const light = (c: Rgba, k = 1) => (lum(c) < 80 ? mix(c, COOL, 0.3 * k) : mix(c, WHITE, 0.2 * k));
const dark = (c: Rgba) => shade(c, lum(c) < 80 ? 0.62 : 0.76);

interface Pal {
  skin: Rgba; skinD: Rgba; skinL: Rgba; blush: Rgba; mouth: Rgba;
  hair: Rgba; hairD: Rgba; hairL: Rgba;
  top: Rgba; topD: Rgba; topL: Rgba; collar: Rgba;
  inner: Rgba; innerD: Rgba; innerL: Rgba;
  bottom: Rgba; bottomD: Rgba; bottomL: Rgba;
  shoe: Rgba; shoeD: Rgba; shoeL: Rgba;
  frame: Rgba; lens: Rgba; tie: Rgba;
}

const palCache = new Map<string, Pal>();
function palFor(look: Look): Pal {
  const key = `${look.skin}|${look.hairColor}|${look.top}|${look.inner}|${look.bottom}|${look.shoes}`;
  let p = palCache.get(key);
  if (p) return p;
  const skin = rgba(look.skin), hair = rgba(look.hairColor), top = rgba(look.top), inner = rgba(look.inner), bottom = rgba(look.bottom), shoe = rgba(look.shoes);
  p = {
    skin, skinD: mix(shade(skin, 0.82), rgba('#a04a4a'), 0.12), skinL: mix(skin, WHITE, 0.25), blush: mix(skin, rgba('#ff5f7a'), 0.38), mouth: mix(skin, rgba('#8a2f3a'), 0.7),
    hair, hairD: lum(hair) < 80 ? shade(hair, 0.6) : shade(hair, 0.72), hairL: lum(hair) < 80 ? mix(hair, COOL, 0.42) : mix(hair, WHITE, 0.3),
    top, topD: dark(top), topL: light(top), collar: lum(top) < 90 ? mix(top, WHITE, 0.55) : mix(top, WHITE, 0.5),
    inner, innerD: dark(inner), innerL: light(inner),
    bottom, bottomD: dark(bottom), bottomL: light(bottom),
    shoe, shoeD: dark(shoe), shoeL: light(shoe, 1.3),
    frame: rgba('#7d7894'), lens: rgba('#cfe6f2'), tie: mix(top, WHITE, 0.35),
  };
  palCache.set(key, p);
  return p;
}

// ---------------------------------------------------------------- tiny drawing helpers

class Layer {
  readonly b = new PixelBuffer(BW, BH);
  put(x: number, y: number, c: Rgba) { this.b.set(OX + x, OY + y, c); }
  rect(x: number, y: number, w: number, h: number, c: Rgba) { this.b.rect(OX + x, OY + y, w, h, c); }
  /** Rows of characters; `.` and unknown characters are transparent. */
  art(rows: readonly string[], x: number, y: number, pal: Record<string, Rgba>) {
    rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const c = pal[row[i]!]; if (c !== undefined) this.put(x + i, y + j, c); } });
  }
}

/** Draws `src` over `dst`; with `edge` < 1 the pixels of `dst` touching `src` are darkened first (a contour between body parts). */
function stack(dst: PixelBuffer, src: PixelBuffer, edge = 0) {
  if (edge) {
    const hit: number[] = [];
    for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
      if ((src.get(x, y) & 255) || !(dst.get(x, y) & 255)) continue;
      if ((src.get(x - 1, y) & 255) || (src.get(x + 1, y) & 255) || (src.get(x, y - 1) & 255) || (src.get(x, y + 1) & 255)) hit.push(y * BW + x);
    }
    for (const i of hit) dst.data[i] = shade(dst.data[i]!, edge);
  }
  for (let i = 0; i < src.data.length; i++) if (src.data[i]! & 255) dst.data[i] = src.data[i]!;
}

function linePts(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const pts: [number, number][] = [];
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  for (let guard = 0; guard < 64; guard++) {
    pts.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = err * 2;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return pts;
}

// ---------------------------------------------------------------- pose parameters

interface Leg { dx: number; lift: number }
interface Rig {
  /** Whole upper body up (negative) or down; sitting is 4 down. */
  by: number;
  bx: number;
  hx: number; hy: number;
  sit: boolean;
  open: boolean;
  /** Hand end relative to the shoulder. Front and back: A is the left of the screen. Side: A is the far arm. */
  armA: [number, number];
  armB: [number, number];
  legA: Leg; legB: Leg;
}

const R = (o: Partial<Rig> = {}): Rig => ({ by: 0, bx: 0, hx: 0, hy: 0, sit: false, open: false, armA: [0, 5], armB: [0, 5], legA: { dx: 0, lift: 0 }, legB: { dx: 0, lift: 0 }, ...o });
const lg = (dx: number, lift: number): Leg => ({ dx, lift });

/** Front and back share one rig; left of the screen is A. */
function rigFB(action: PersonAction, f: number, back: boolean): Rig {
  switch (action) {
    case 'stand': return R({ hy: f ? 1 : 0 });
    case 'walk': return [R({ legB: lg(0, 1), armA: [0, 4] }), R({ by: -1 }), R({ legA: lg(0, 1), armB: [0, 4] }), R({ by: -1 })][f]!;
    case 'run': return [
      R({ by: -1, legB: lg(0, 3), armA: [1, 3], armB: [-1, 5] }), R({ by: -2, legA: lg(0, 1), armA: [0, 4], armB: [0, 4] }),
      R({ by: -1, legA: lg(0, 3), armA: [1, 5], armB: [-1, 3] }), R({ by: -2, legB: lg(0, 1), armA: [0, 4], armB: [0, 4] }),
    ][f]!;
    case 'sit': return R({ by: 4, sit: true, armA: [0, 4], armB: [0, 4] });
    case 'type': return back ? R({ by: 4, sit: true, armA: [-1, 4 - (f ? 1 : 0)], armB: [1, 4 - (f ? 0 : 1)] }) : R({ by: 4, sit: true, armA: [3, 4 - (f ? 1 : 0)], armB: [-3, 4 - (f ? 0 : 1)] });
    case 'kick': return [
      R({ bx: -1, legB: lg(1, 3), armA: [-2, 3], armB: [1, 4] }), R({ legB: lg(5, 4), armA: [-3, 1], armB: [2, 3] }), R({ legB: lg(4, 2), armA: [-3, 2], armB: [1, 4] }),
    ][f]!;
    case 'throw': return [
      R({ bx: -1, armB: [2, -8] }), R({ armB: [-1, 3], armA: [0, 4] }), R({ by: 1, armB: [-3, 5], armA: [0, 4] }),
    ][f]!;
    case 'wave': return R({ armB: f ? [4, -8] : [3, -7] });
    case 'dance': return [
      R({ bx: -1, armA: [-3, -6], armB: [1, 5], legB: lg(0, 1) }), R({ by: -1, armA: [-3, 1], armB: [3, 1] }),
      R({ bx: 1, armB: [3, -6], armA: [-1, 5], legA: lg(0, 1) }), R({ by: -1, armA: [-3, 1], armB: [3, 1] }),
    ][f]!;
    case 'flinch': return f ? R({ hy: -1, open: true, armA: [3, -4], armB: [-3, -4], legA: lg(0, 0) }) : R({ open: true, armA: [3, -3], armB: [-3, -3] });
  }
}

/** Side view facing right: A is the far arm and leg, B the near ones. dx > 0 goes forward. */
function rigSide(action: PersonAction, f: number): Rig {
  switch (action) {
    case 'stand': return R({ hy: f ? 1 : 0 });
    case 'walk': return [
      R({ legB: lg(2, 0), legA: lg(-2, 0), armB: [-2, 5], armA: [2, 5] }), R({ by: -1, legA: lg(1, 2), armA: [0, 5], armB: [0, 5] }),
      R({ legA: lg(2, 0), legB: lg(-2, 0), armA: [-2, 5], armB: [2, 5] }), R({ by: -1, legB: lg(1, 2), armA: [0, 5], armB: [0, 5] }),
    ][f]!;
    case 'run': return [
      R({ bx: 1, hx: 1, legB: lg(3, 0), legA: lg(-4, 3), armB: [-3, 3], armA: [4, 2] }), R({ by: -2, bx: 1, hx: 1, legA: lg(-1, 2), legB: lg(1, 0), armA: [1, 4], armB: [-1, 4] }),
      R({ bx: 1, hx: 1, legA: lg(3, 0), legB: lg(-4, 3), armA: [-3, 3], armB: [4, 2] }), R({ by: -2, bx: 1, hx: 1, legA: lg(1, 0), legB: lg(-1, 2), armA: [1, 4], armB: [-1, 4] }),
    ][f]!;
    case 'sit': return R({ by: 4, sit: true, armB: [1, 4], armA: [1, 4] });
    case 'type': return R({ by: 4, sit: true, armB: [4, 3 + (f ? 1 : 0)], armA: [3, 4 - (f ? 1 : 0)] });
    case 'kick': return [
      R({ bx: -1, legB: lg(-4, 3), armA: [2, 4], armB: [-2, 4] }), R({ legB: lg(6, 4), armA: [-2, 3], armB: [2, 4] }), R({ bx: -1, legB: lg(4, 2), armA: [-3, 3], armB: [3, 3] }),
    ][f]!;
    case 'throw': return [
      R({ bx: -1, armB: [-3, -4], armA: [2, 4] }), R({ armB: [4, -3], armA: [1, 4] }), R({ bx: 1, hx: 1, armB: [4, 3], armA: [-1, 4] }),
    ][f]!;
    case 'wave': return R({ armB: f ? [5, -8] : [3, -8] });
    case 'dance': return [
      R({ bx: -1, armB: [3, -5], armA: [-2, 2], legA: lg(-1, 0), legB: lg(1, 1) }), R({ by: -1, armB: [3, 1], armA: [3, 1] }),
      R({ bx: 1, armB: [-2, 2], armA: [3, -5], legA: lg(1, 1), legB: lg(-1, 0) }), R({ by: -1, armB: [3, 1], armA: [3, 1] }),
    ][f]!;
    case 'flinch': return f ? R({ bx: -2, hx: -2, hy: -1, open: true, armB: [4, -4], armA: [3, -3] }) : R({ bx: -1, hx: -1, open: true, armB: [3, -3], armA: [2, -2] });
  }
}

// ---------------------------------------------------------------- head

type HeadDir = 'down' | 'up' | 'right';
// 12 x 10 head. x = skin (shaded at the right and bottom edge), d = darker skin, h/g/l = hair base/shade/light.
const BLOB = [
  '..xxxxxxxx..',
  '.xxxxxxxxxx.',
  'xxxxxxxxxxxx',
  'xxxxxxxxxxxx',
  'xxxxxxxxxxxx',
  'xxxxxxxxxxxx',
  'xxxxxxxxxxxx',
  'xxxxxxxxxxxx',
  '.xxxxxxxxxx.',
  '..xxxxxxxx..',
];

const HAIR: Record<Look['hair'], Record<HeadDir, string[]>> = {
  short: {
    down: ['..hhhhhhhh..', '.hllhhhhhhg.', 'hhllhhhhhhgg', 'hhhhhhhhhhhg', 'hhhh.hh.hhhg', 'hh........hh', 'h..........h', '............', '............', '............'],
    up: ['..hhhhhhhh..', '.hllhhhhhhg.', 'hhllhhhhhhgg', 'hhhhhhhhhhhg', 'hhhhhhhhhhhg', '.hhhhhhhhhhg', '.hhhhhhhhhg.', 'hhhhhhhhhhgg', '.hhhhhhhhgg.', '...dddddd...'],
    right: ['..hhhhhhhh..', '.hllhhhhhhg.', 'hhllhhhhhhhg', 'hhhhhhhhhhhh', 'hhhhhhhhhhh.', 'hhhh........', 'hhhh........', 'hhh.........', '............', '............'],
  },
  bob: {
    down: ['..hhhhhhhh..', '.hllhhhhhhg.', 'hhllhhhhhhgg', 'hhhhhhhhhhhg', 'hhhhhhhhhhhg', 'hh........hg', 'hh........hg', 'hh........hg', '.hhh....hhg.', '............'],
    up: ['..hhhhhhhh..', '.hllhhhhhhg.', 'hhllhhhhhhgg', 'hhhhhhhhhhhg', 'hhhhhhhhhhhg', 'hhhhhhhhhhhg', 'hhhhhhhhhhgg', 'hhhhhhhhhhgg', '.hhhhhhhhgg.', '..gggggggg..'],
    right: ['..hhhhhhhh..', '.hllhhhhhhg.', 'hhllhhhhhhhg', 'hhhhhhhhhhhh', 'hhhhhhhhhhh.', 'hhhhhhhh....', 'hhhhhhhg....', 'hhhhhhg.....', '.hhhhhg.....', '..gggg......'],
  },
  long: {
    down: ['..hhhhhhhh..', '.hllhhhhhhg.', 'hhllhhhhhhgg', 'hhhhhhhhhhhg', 'hhhhhhhhhhhg', 'hh........hg', 'hh........hg', 'hh........hg', '.hh......hg.', '..hh....hg..'],
    up: ['..hhhhhhhh..', '.hllhhhhhhg.', 'hhllhhhhhhgg', 'hhhhhhhhhhhg', 'hhhhhhhhhhhg', 'hhhhhhhhhhhg', 'hhhhhhhhhhgg', 'hhhhhhhhhhgg', '.hhhhhhhhgg.', '..hhhhhhgg..'],
    right: ['..hhhhhhhh..', '.hllhhhhhhg.', 'hhllhhhhhhhg', 'hhhhhhhhhhhh', 'hhhhhhhhhhh.', 'hhhhhhhh....', 'hhhhhhhg....', 'hhhhhhg.....', '.hhhhhg.....', '..hhhg......'],
  },
  bun: {
    down: ['..hhhhhhhh..', '.hllhhhhhhg.', 'hhllhhhhhhgg', 'hhhhhhhhhhhg', 'hhhh.hh.hhhg', 'hh........hh', 'h..........h', '............', '............', '............'],
    up: ['..hhhhhhhh..', '.hllhhhhhhg.', 'hhllhhhhhhgg', 'hhhhhhhhhhhg', 'hhhhhhhhhhhg', '.hhhhhhhhhhg', '.hhhhhhhhhg.', 'hhhhhhhhhhgg', '.hhhhhhhhgg.', '...dddddd...'],
    right: ['..hhhhhhhh..', '.hllhhhhhhg.', 'hhllhhhhhhhg', 'hhhhhhhhhhhh', 'hhhhhhhhhhh.', 'hhhh........', 'hhhh........', 'hhh.........', '............', '............'],
  },
  ponytail: {
    down: ['..hhhhhhhh..', '.hllhhhhhhg.', 'hhllhhhhhhgg', 'hhhhhhhhhhhg', 'hhhh.hh.hhhg', 'hh........hh', 'h..........h', '............', '............', '............'],
    up: ['..hhhhhhhh..', '.hllhhhhhhg.', 'hhllhhhhhhgg', 'hhhhhhhhhhhg', 'hhhhhhhhhhhg', '.hhhhhhhhhhg', '.hhhhhhhhhg.', 'hhhhhhhhhhgg', '.hhhhhhhhgg.', '...dddddd...'],
    right: ['..hhhhhhhh..', '.hllhhhhhhg.', 'hhllhhhhhhhg', 'hhhhhhhhhhhh', 'hhhhhhhhhhh.', 'hhhh........', 'hhhh........', 'hhh.........', '............', '............'],
  },
};

// Wider highlight crescent and a few strand marks, so near-black hair keeps some form.
for (const style of Object.values(HAIR)) for (const [dir, rows] of Object.entries(style) as [HeadDir, string[]][]) {
  const paint = (r: number, from: number, to: number) => { rows[r] = [...rows[r]!].map((c, i) => (c === 'h' && i >= from && i <= to ? 'l' : c)).join(''); };
  paint(0, 4, 7); paint(1, 3, 5); paint(2, 2, 4); paint(3, 2, 2);
  if (dir === 'up') { rows[5] = rows[5]!.replace(/^(.{4})h/, '$1g'); rows[6] = rows[6]!.replace(/^(.{6})h/, '$1g'); rows[4] = rows[4]!.replace(/^(.{3})h/, '$1l'); }
}

/** The head of a person with its local origin at the head's top-left (x -6, y 1). Returns the layer pair [behind, front]. */
function drawHead(look: Look, p: Pal, dir: HeadDir, hx: number, hy: number, open: boolean): { head: Layer; behind: Layer; over: Layer } {
  const head = new Layer(), behind = new Layer(), over = new Layer();
  const X = -6 + hx, Y = 1 + hy;
  const cols: Record<string, Rgba> = { h: p.hair, g: p.hairD, l: p.hairL, d: p.skinD };
  // skin with a shaded right and bottom edge
  BLOB.forEach((row, j) => {
    for (let i = 0; i < 12; i++) {
      if (row[i] !== 'x') continue;
      const edge = BLOB[j]![i + 1] !== 'x' || (BLOB[j + 1]?.[i] ?? '.') !== 'x';
      head.put(X + i, Y + j, edge && j > 2 ? p.skinD : p.skin);
    }
  });
  const ink = P.ink;
  const px = (c: number, r: number, color: Rgba) => head.put(X + c, Y - 1 + r, color); // r is the local y row (1..10)
  if (dir === 'down') {
    px(3, 6, ink); px(3, 7, ink); px(8, 6, ink); px(8, 7, ink);
    if (!look.glasses) { px(2, 8, p.blush); px(9, 8, p.blush); }
    if (open) { px(5, 9, p.mouth); px(6, 9, p.mouth); px(5, 10, ink); px(6, 10, ink); } else { px(5, 9, p.mouth); px(6, 9, p.mouth); }
    px(3, 6, ink);
  } else if (dir === 'right') {
    px(9, 6, ink); px(9, 7, ink); px(8, 8, p.blush);
    if (open) { px(10, 9, ink); px(11, 9, ink); } else px(10, 9, p.mouth);
    head.put(X + 12, Y + 6, p.skin); // nose
    px(4, 6, p.skinD); px(5, 6, p.skinD); px(4, 7, p.skinD); px(5, 7, p.skinL);
  } else {
    px(0, 6, p.skinD); px(11, 6, p.skinD); px(0, 7, p.skinD); px(11, 7, p.skinD);
  }
  head.art(HAIR[look.hair][dir], X, Y, cols);
  if (dir === 'right') { // ear stays visible for short hair and bun, hidden under bob and long hair
    if (look.hair !== 'bob' && look.hair !== 'long') { px(4, 6, p.skinD); px(5, 6, p.skin); px(4, 7, p.skinD); px(5, 7, p.skinD); }
  }
  // extras: bun, tail, long hair mass
  const hc = { ...cols, t: p.tie };
  if (look.hair === 'bun') {
    head.art(['.hhhh.', 'hllhhg', 'hlhhhg', '.hgggg'.replace('.hgggg', '.hggg.')], X + (dir === 'right' ? 1 : 3), Y - 3, hc);
  }
  if (look.hair === 'ponytail') {
    if (dir === 'down') {
      behind.art(['.hh', 'hhg', 'hhg', 'hhg', '.hg', '.g.'], X + 11, Y + 2, hc);
      head.art(['tt'], X + 10, Y + 1, hc);
    } else if (dir === 'up') {
      over.art(['.tt.', 'hhhg', 'hhhg', 'hhhg', 'hhhg', '.hhg', '.hhg', '..gg', '..g.'], X + 4, Y + 1, hc);
    } else {
      behind.art(['.hh', 'hhg', 'hhg', 'hhg', '.hg', '.hg', '.g.'], X - 2, Y + 3, hc);
      head.art(['t'], X, Y + 2, hc);
    }
  }
  if (look.hair === 'long') {
    if (dir === 'down') {
      behind.art(['..hhhhhhhh..', '.hhhhhhhhhh.', '.hhhhhhhhhh.', '.hhhhhhhhhg.', '.hhhhhhhhgg.', '..hhhhhhgg..', '...hhhhgg...'], X, Y + 8, hc);
      over.art(['hh........gg', 'hl........gg', 'hh........gg', 'hh........gg', '.h........g.', '.g........g.'], X, Y + 10, hc);
    } else if (dir === 'up') {
      over.art(['..hhhhhhhh..', '..hhhhhhhh..', '..hhlhhhhg..', '..hhlhhhgg..', '..hhhhhggg..', '...hhhhggg..', '...hhhggg...', '....hhgg....'], X, Y + 10, hc);
    } else {
      behind.art(['hhhh', 'hhhh', 'hhhg', 'hhhg', 'hhgg', '.hgg', '.hgg', '..g.'], X, Y + 9, hc);
    }
  }
  if (look.hair === 'bob' && dir === 'up') over.art(['.hhhhhhhhhg.', '..gggggggg..'], X, Y + 9, hc);
  // glasses
  if (look.glasses) {
    const f = p.frame, l = p.lens;
    if (dir === 'down') {
      head.art(['fff', 'flf', 'f.f', 'fff'], X + 2, Y + 4, { f, l, '.': l });
      head.art(['fff', 'f.f', 'flf', 'fff'], X + 7, Y + 4, { f, l, '.': l });
      px(3, 6, ink); px(3, 7, ink); px(8, 6, ink); px(8, 7, ink);
      px(3, 6, ink);
      px(5, 6, f); px(6, 6, f);
    } else if (dir === 'right') {
      head.art(['fff', 'f.f', 'f.f', 'fff'], X + 8, Y + 4, { f });
      px(9, 6, ink); px(9, 7, ink);
      px(5, 6, f); px(6, 6, f); px(7, 6, f);
    }
  }
  return { head, behind, over };
}

// ---------------------------------------------------------------- body parts

function torsoRows(look: Look, side: boolean, back: boolean): string[] {
  const m = look.sex === 'm';
  let rows: string[];
  if (look.outfit === 'suit') {
    rows = side
      ? ['JJJJJi', 'JJJJJi', 'JJJJiJ', 'JJJJJj', 'JJJJJj', 'jjjjjj']
      : ['KiiiiJ', 'JKiiKj', 'JJjjJj', 'JJjjJj', 'JJJJJj', 'jjjjjj'];
  } else if (look.outfit === 'formal') {
    if (side) rows = m ? ['JJJJJC', 'JJJJJt', 'JJJJJt', 'JJJJJj', 'JJJJJj', 'jjjjjj'] : ['JJJJJC', 'JJJJJj', 'JJJJJj', 'JJJJJj', 'JJJJJj', 'jjjjjj'];
    else rows = m ? ['KCssCj', 'JJttJj', 'JJttJj', 'JJttJj', 'JJTTJj', 'jjjjjj'] : ['KCssCj', 'JJCCJj', 'JJjjJj', 'JJjjJj', 'JJJJJj', 'jjjjjj'];
  } else {
    rows = side
      ? ['JJJJJJ', 'JJJJJJ', 'JJJJJJ', 'JJJJJj', 'JJJJJj', 'jjjjjj']
      : ['KJssJJ', 'JJiiJj', 'JJJJJj', 'JJJJJj', 'JJJJJj', 'jjjjjj'];
  }
  if (back) rows = rows.map((r, i) => (look.outfit === 'formal' && i === 0 ? 'KCCCCj' : r.replace(/[iIsKtT]/g, 'J').replace(/C/g, 'J')));
  return rows;
}

function torsoPal(p: Pal): Record<string, Rgba> {
  return { J: p.top, j: p.topD, K: p.topL, C: p.collar, i: p.inner, I: p.innerD, s: p.skin, t: p.tie, T: shade(p.tie, 0.8) };
}

function drawTorso(L: Layer, look: Look, p: Pal, x: number, y: number, len: number, side: boolean, back: boolean) {
  let rows = torsoRows(look, side, back);
  if (len === 4) rows = [rows[0]!, rows[1]!, rows[4]!, rows[5]!];
  L.art(rows, x, y, torsoPal(p));
}

const skirted = (look: Look) => look.sex === 'f' && look.outfit !== 'casual';

function drawSkirt(L: Layer, p: Pal, y: number, rows: number, wide: 'front' | 'side', bx = 0) {
  for (let j = 0; j < rows; j++) {
    const x0 = wide === 'front' ? (j === 0 ? -4 : -4) : -4, w = wide === 'front' ? 8 : (j === 0 ? 7 : 8);
    for (let i = 0; i < w; i++) {
      const last = j === rows - 1, edge = i >= w - 2;
      const c = last ? p.bottomD : edge ? p.bottomD : (i === 1 || i === 4) && j > 0 ? p.bottomL : p.bottom;
      L.put(x0 + i + bx, y + j, last && i === 0 ? p.bottom : c);
    }
  }
}

function drawArm(L: Layer, look: Look, p: Pal, x0: number, y0: number, x1: number, y1: number, shadeRight: boolean, dim = 1) {
  const pts = linePts(x0, y0, x1, y1), n = pts.length;
  const short = look.outfit === 'casual';
  const sleeve = Math.max(1, n - (short ? 3 : 2));
  const c = (v: Rgba) => (dim === 1 ? v : shade(v, dim));
  const horizontalBrush = Math.abs(y1 - y0) >= Math.abs(x1 - x0);
  pts.forEach(([x, y], i) => {
    const isSleeve = i < sleeve;
    let base = isSleeve ? c(p.top) : c(p.skin), dk = isSleeve ? c(p.topD) : c(p.skinD);
    if (isSleeve && look.outfit === 'suit' && i === sleeve - 1 && sleeve > 2) { base = c(p.inner); dk = c(p.innerD); }
    if (isSleeve && i === 0) base = c(p.topL);
    if (horizontalBrush) { L.put(x, y, shadeRight ? base : dk); L.put(x + 1, y, shadeRight ? dk : base); }
    else { L.put(x, y, base); L.put(x, y + 1, dk); }
  });
}

/** One leg from the hip to the foot. `shoeX` is the left column of the 3 px shoe relative to the foot's left column. */
function drawLeg(L: Layer, p: Pal, look: Look, hipX: number, hipY: number, leg: Leg, shoeX: number, bare: boolean, dim = 1) {
  const ft = 21 - leg.lift, fx = hipX + leg.dx;
  const c = (v: Rgba) => (dim === 1 ? v : shade(v, dim));
  const base = bare ? c(p.skin) : c(p.bottom), dk = bare ? c(p.skinD) : c(p.bottomD);
  const pts = linePts(hipX, hipY, fx, Math.max(hipY, ft - 1));
  for (const [x, y] of pts) { L.put(x, y, base); L.put(x + 1, y, dk); }
  void look;
  const sx = fx + shoeX;
  for (let i = 0; i < 3; i++) {
    L.put(sx + i, ft, i === 0 ? c(p.shoeL) : c(p.shoe));
    L.put(sx + i, ft + 1, c(p.shoeD));
  }
}

// ---------------------------------------------------------------- the three views

function drawUmbrella(out: PixelBuffer, p: Pal, top: number) {
  void p;
  const L = new Layer();
  const a = rgba('#e5484d'), b = rgba('#f4f1ea'), s = rgba('#9c2b33');
  const rows = ['....aaaaaaaa....', '..aaabbbaaabbb..', '.aaabbbaaabbbaaa', 'aaabbbaaabbbaaab', 'sasasasasasasasa'];
  L.art(rows, -8, top, { a, b, s });
  // shade the right half of the canopy
  for (let j = 0; j < rows.length; j++) for (let i = 10; i < 16; i++) { const c = L.b.get(OX - 8 + i, OY + top + j); if (c & 255) L.b.data[(OY + top + j) * BW + OX - 8 + i] = shade(c, 0.82); }
  L.put(-1, top - 1, s); L.put(0, top - 1, s);
  L.rect(0, top + 5, 1, 3, rgba('#6b5a4a'));
  stack(out, L.b);
}

function bodyFront(out: PixelBuffer, look: Look, p: Pal, rig: Rig, back: boolean) {
  const { by } = rig;
  const sit = rig.sit;
  const bare = skirted(look);
  const torsoLen = sit ? 4 : 6;
  const ty = 11 + by + rig.hy * 0;
  const head = drawHead(look, p, back ? 'up' : 'down', rig.hx + rig.bx, by + rig.hy, rig.open);
  stack(out, head.behind.b);
  // legs
  const legs = new Layer();
  const hipY = sit ? 19 : 17 + by;
  if (sit) {
    for (const [x, s] of [[-3, -1], [0, 0]] as const) {
      const foot = x < 0 ? -1 : 1;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) legs.put(x + i, 19 + j, bare ? (j ? p.skinD : p.skin) : (i === 2 ? p.bottomD : p.bottom));
      for (let i = 0; i < 3; i++) { legs.put(x + foot + s * 0 + i, 21, i === 0 ? p.shoeL : p.shoe); legs.put(x + foot + i, 22, p.shoeD); }
    }
    if (back) legs.rect(-3, 19, 6, 4, p.bottom);
  } else {
    drawLeg(legs, p, look, -2, hipY, rig.legA, -1, bare && hipY < 19);
    drawLeg(legs, p, look, 0, hipY, rig.legB, 0, bare && hipY < 19);
  }
  stack(out, legs.b);
  const torso = new Layer();
  drawTorso(torso, look, p, -3 + rig.bx, ty, torsoLen, false, back);
  if (bare) drawSkirt(torso, p, ty + torsoLen, sit ? 2 : 2, 'front', rig.bx);
  if (sit && back) torso.rect(-3 + rig.bx, ty + torsoLen, 6, 7 - torsoLen + 1, p.bottom);
  stack(out, torso.b, 0.8);
  // arms: lowered ones before the head, raised ones after it
  const arms = (raised: boolean) => {
    const a = new Layer();
    const sy = ty;
    const defs: [number, [number, number], boolean][] = [[-5 + rig.bx, rig.armA, true], [3 + rig.bx, rig.armB, false]];
    let any = false;
    for (const [sx, [dx, dy], right] of defs) {
      const isRaised = sy + dy < sy + 1;
      if (isRaised !== raised) continue;
      any = true;
      drawArm(a, look, p, sx, sy, sx + dx, sy + dy, right);
    }
    if (any) stack(out, a.b, 0.78);
  };
  arms(false);
  stack(out, head.head.b, 0.6);
  stack(out, head.over.b, 0.7);
  arms(true);
}

function bodySide(out: PixelBuffer, look: Look, p: Pal, rig: Rig) {
  const { by } = rig;
  const sit = rig.sit, bare = skirted(look), torsoLen = sit ? 4 : 6, ty = 11 + by;
  const head = drawHead(look, p, 'right', rig.hx + rig.bx, by + rig.hy, rig.open);
  stack(out, head.behind.b);
  const hipY = sit ? 19 : 17 + by;
  // far arm and far leg first
  const far = new Layer();
  const armFar = (L2: Layer, dimv: number) => drawArm(L2, look, p, -1 + rig.bx, ty, -1 + rig.bx + rig.armA[0], ty + rig.armA[1], true, dimv);
  if (sit) {
    // seated: thighs forward, shins down
    for (let i = 0; i < 6; i++) { far.put(-2 + i, 19, shade(bare ? p.skin : p.bottom, 0.85)); far.put(-2 + i, 20, shade(bare ? p.skinD : p.bottomD, 0.9)); }
    for (let j = 0; j < 3; j++) { far.put(3, 19 + j, shade(bare ? p.skin : p.bottom, 0.8)); far.put(4, 19 + j, shade(bare ? p.skinD : p.bottomD, 0.8)); }
  } else drawLeg(far, p, look, -2, hipY, rig.legA, 0, bare && hipY < 19, 0.82);
  stack(out, far.b);
  const farArm = new Layer();
  armFar(farArm, 0.8);
  stack(out, farArm.b);
  const torso = new Layer();
  const near = new Layer();
  if (sit) {
    for (let i = 0; i < 7; i++) { near.put(-3 + i, 19, bare ? p.skin : p.bottom); near.put(-3 + i, 20, bare ? p.skinD : p.bottomD); }
    for (let j = 0; j < 3; j++) { near.put(3, 19 + j, bare ? p.skin : p.bottom); near.put(4, 19 + j, bare ? p.skinD : p.bottomD); }
    for (let i = 0; i < 3; i++) { near.put(3 + i, 21, i === 0 ? p.shoeL : p.shoe); near.put(3 + i, 22, p.shoeD); }
    for (let i = 0; i < 3; i++) { near.put(3 + i, 21, i === 0 ? p.shoeL : p.shoe); }
  } else drawLeg(near, p, look, 0, hipY, rig.legB, 0, bare && hipY < 19);
  stack(out, near.b, 0.8);
  drawTorso(torso, look, p, -3 + rig.bx, ty, torsoLen, true, false);
  if (bare) drawSkirt(torso, p, ty + torsoLen, 2, 'side', rig.bx);
  stack(out, torso.b, 0.8);
  const nearArm = new Layer();
  drawArm(nearArm, look, p, -1 + rig.bx, ty, -1 + rig.bx + rig.armB[0], ty + rig.armB[1], true);
  stack(out, nearArm.b, 0.78);
  stack(out, head.head.b, 0.6);
  stack(out, head.over.b, 0.7);
}

// ---------------------------------------------------------------- finishing

function outline(b: PixelBuffer) {
  const todo: [number, Rgba][] = [];
  for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
    if (b.get(x, y) & 255) continue;
    let best = 0, bl = 1e9;
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]] as const) {
      const c = b.get(x + dx, y + dy);
      if (!(c & 255)) continue;
      const l = lum(c);
      if (l < bl) { bl = l; best = c; }
    }
    if (best) todo.push([y * BW + x, shade(best, 0.45)]);
  }
  for (const [i, c] of todo) b.data[i] = c;
}

function finish(flat: PixelBuffer, flip: boolean): Sprite {
  const full = new PixelBuffer(BW, BH);
  // ground shadow: a soft ellipse under the feet
  for (const [y, x0, x1] of [[22, -5, 4], [23, -7, 6], [24, -5, 4]] as const) for (let x = x0; x <= x1; x++) full.set(OX + x, OY + y, P.shadow);
  full.blit(flat, 0, 0);
  const src = flip ? (() => { const f = new PixelBuffer(BW, BH); f.blit(full, 0, 0, true); return f; })() : full;
  let x0 = BW, y0 = BH, x1 = -1, y1 = -1;
  for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) if (src.get(x, y) & 255) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, out = new PixelBuffer(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.data[y * w + x] = src.data[(y + y0) * BW + x + x0]!;
  return { buf: out, ax: OX - x0, ay: OY + 24 - y0 };
}

function build(look: Look, pose: PersonPose, frame: number): Sprite {
  const p = palFor(look);
  const flat = new PixelBuffer(BW, BH);
  const flip = pose.dir === 'left';
  const dir: 'down' | 'up' | 'right' = pose.dir === 'left' ? 'right' : pose.dir;
  const rig = dir === 'right' ? rigSide(pose.action, frame) : rigFB(pose.action, frame, dir === 'up');
  if (pose.umbrella) drawUmbrella(flat, p, rig.by - 8 + (rig.sit ? 0 : 0) + rig.hy);
  if (dir === 'right') bodySide(flat, look, p, rig);
  else bodyFront(flat, look, p, rig, dir === 'up');
  outline(flat);
  return finish(flat, flip);
}

const cache = new Map<string, Sprite>();

const OUTFITS: readonly Look['outfit'][] = ['suit', 'formal', 'casual'];

export const drawPerson: DrawPerson = (given, pose) => {
  // Looks come from saved data: a hair style or outfit this file does not know draws as short hair / casual clothes.
  const look: Look = Object.hasOwn(HAIR, given.hair) && OUTFITS.includes(given.outfit) ? given
    : { ...given, hair: Object.hasOwn(HAIR, given.hair) ? given.hair : 'short', outfit: OUTFITS.includes(given.outfit) ? given.outfit : 'casual' };
  const n = PERSON_FRAMES[pose.action];
  // the view may hand over a fraction, a string or nothing: floor it, treat anything that is not a number as 0, wrap it into range
  const whole = Math.floor(Number(pose.frame));
  const frame = (((Number.isFinite(whole) ? whole : 0) % n) + n) % n;
  const key = [look.sex, look.outfit, look.hair, look.hairColor, look.skin, look.glasses ? 1 : 0, look.top, look.inner, look.bottom, look.shoes, pose.action, pose.dir, frame, pose.umbrella ? 1 : 0].join('|');
  let s = cache.get(key);
  if (!s) { s = build(look, pose, frame); cache.set(key, s); }
  return s;
};

export type { Dir };

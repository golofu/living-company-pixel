import type { Look } from '../../domain/looks.ts';
import { P, THEMES, type Theme } from './palette.ts';
import { drawPerson } from './people.ts';
import { PixelBuffer, TILE, rgba, shade, type CityOptions, type CityScene, type CityFrame, type Drawable, type Sprite, type Light, type SignText, type Dir, type Rgba } from './types.ts';

// Tags are useful to dev sheets/tests; the renderer only needs the Drawable contract.
type Kind = 'ground' | 'building' | 'prop' | 'cart' | 'walker' | 'vendor' | 'customer' | 'vehicle' | 'signal' | 'steam' | 'parked';
interface Drawing extends Drawable { kind: Kind; id: string }
interface Person { x: number; y: number; dir: Dir; speed: number; phase: number; pause: number; cooldown: number; crossing: boolean; sprites: Map<string, Sprite> }
interface Vehicle { x: number; y: number; dir: -1 | 1; speed: number; kind: number; sprites: Sprite[] }
interface StaticScene { drawables: Drawing[]; lights: Light[]; signs: SignText[] }
interface Glow { x: number; y: number; rx: number; ry: number; color: string; k: number }

// ---------------------------------------------------------------- names and looks of the street

export type Goods = 'cups' | 'pot' | 'grill' | 'bread' | 'books' | 'cross' | 'tools' | 'cloth' | 'flowers' | 'goods';
/** `short` is what a vertical blade or a round sign carries: it never contains the leading vowels เ แ โ ไ ใ, which cannot be stacked one cluster per line. */
export interface ShopName { full: string; short: string; goods: Goods }
const n = (full: string, short: string, goods: Goods): ShopName => ({ full, short, goods });
export const SHOP_POOL: readonly ShopName[] = [
  n('กาแฟตื่นเช้า', 'ชงสด', 'cups'), n('เส้นหอมซอยเก้า', 'บะหมี่', 'pot'), n('ยาดีใกล้บ้าน', 'ร้านยา', 'cross'), n('หนังสือใบไม้', 'หนังสือ', 'books'),
  n('ช่างข้างซอย', 'ช่างซ่อม', 'tools'), n('ขนมปังอุ่นใจ', 'ขนมปัง', 'bread'), n('ซักสะอาดดาว', 'ซักรีด', 'cloth'), n('ดอกไม้ริมทาง', 'ช่อดอก', 'flowers'),
  n('พิมพ์ฝัน', 'พิมพ์', 'books'), n('ของชำแสงจันทร์', 'ของชำ', 'goods'), n('ชาใบฝน', 'น้ำชา', 'cups'), n('ข้าวบ้านเรา', 'ข้าวมัน', 'pot'),
  n('ตัดผมลุงหนวด', 'ตัดผม', 'cloth'), n('ผลไม้ลูกรัก', 'ผักสด', 'goods'), n('หมูปิ้งป้านก', 'หมูปิ้ง', 'grill'), n('น้ำแข็งใสพายุ', 'หวานจัง', 'cups'),
  n('ร้านทองแสงดาว', 'ร้านทอง', 'goods'), n('ตัดเสื้อมาลี', 'ตัดชุด', 'cloth'), n('เครื่องเขียนพลิ้ว', 'ปากกา', 'books'), n('ซ่อมมือถือจิ๋ว', 'มือถือ', 'tools'),
  n('ของเล่นตาหวาน', 'ตุ๊กตา', 'goods'), n('อาหารสัตว์ใจดี', 'น้องหมา', 'goods'), n('ปลาย่างริมคลอง', 'ปลาย่าง', 'grill'), n('ส้มตำสามย่าน', 'ส้มตำ', 'pot'),
  n('โรงน้ำชาดอกหญ้า', 'ชานม', 'cups'), n('ลมยางลุงชัย', 'ลมยาง', 'tools'), n('ร้านเกมหมีขาว', 'หมีขาว', 'goods'), n('ขนมอบใต้ถุน', 'ขนมอบ', 'bread'),
  n('บัวลอยแม่อ้อย', 'บัวลอย', 'cups'), n('ซีดีเก่าเล่าเพลง', 'ซีดีหนัง', 'books'), n('ไอศกรีมปลายฝน', 'ครีม', 'cups'), n('ทอดกรอบนอกนุ่มใน', 'ของทอด', 'grill'),
  n('ช่างกลึงสมหมาย', 'ช่างกลึง', 'tools'), n('ถ่ายรูปยิ้มสวย', 'ถ่ายรูป', 'books'), n('ต้มหมูป้าแดง', 'ต้มหมู', 'pot'), n('ผ้าลายสีรุ้ง', 'ผ้าลาย', 'cloth'),
];
/** Four cart kinds (steaming pot, grill, drinks, sweets case); one name per kind is picked by the seed. */
export const CART_POOL: readonly (readonly string[])[] = [
  ['โจ๊กหม้อหอม', 'ซาลาเปาร้อน', 'ข้าวโพดต้ม', 'น้ำเต้าหู้อุ่น'],
  ['ปิ้งยิ้ม', 'ลูกชิ้นพลุ', 'ไส้กรอกอีสาน', 'ไก่ย่างลุงเอก'],
  ['น้ำผลไม้สด', 'ชาเย็นตะวัน', 'น้ำอ้อยสด', 'ปั่นสดป้ายิ้ม'],
  ['ขนมครกจันทร์', 'กล้วยทอดป้าแก้ว', 'ปาท่องโก๋สด', 'ขนมถ้วยหวาน'],
];
const NEONS = ['#ff3b3b', '#38d9ff', '#ffcf3a', '#3dff9a', '#ff5ec4', '#ff9b3d', '#b57bff', '#5aa0ff'] as const;
/** Three warm tints of a lit window at night. */
export const WARM = ['#ffe9a0', '#ffc46b', '#ffa97a'] as const;
interface AwningLook { a: string; b: string; pattern: 'block' | 'thin' | 'scallop' | 'check' | 'solid' | 'diag' | 'tile' }
export const AWNINGS: readonly AwningLook[] = [
  { a: '#d8262d', b: '#f4f1ea', pattern: 'block' }, { a: '#2fa5a5', b: '#f4f1ea', pattern: 'block' }, { a: '#f2d73a', b: '#1f3a5c', pattern: 'thin' },
  { a: '#3fa34d', b: '#f4f1ea', pattern: 'scallop' }, { a: '#ff5ec4', b: '#f4f1ea', pattern: 'check' }, { a: '#ff9b3d', b: '#8a4a1e', pattern: 'solid' },
  { a: '#1f3a5c', b: '#f0b429', pattern: 'diag' }, { a: '#5a2a6e', b: '#ff5ec4', pattern: 'thin' }, { a: '#a0522d', b: '#6b3a22', pattern: 'tile' }, { a: '#38d9ff', b: '#f4f1ea', pattern: 'scallop' },
];
const WALLS = ['#7a1f24', '#8a6446', '#1f3a5c', '#a0522d', '#4a5a6a', '#6b5a2f', '#3a5a4a', '#7a4a62'] as const;
const BACK = ['#3a3346', '#2f3a52', '#4a3a4a', '#2f4a4a', '#4a4036', '#3a2f3a', '#463a5a', '#35405a'] as const;
const HAIRS = ['#211918', '#2b2024', '#39313c', '#664331', '#7a4a2a', '#8a3a22', '#a8503a', '#9a9aa2', '#cfcfd6', '#d9b45a', '#d25a8a', '#4a7ad2', '#8a5ad2', '#2fb5a0'];
const TOPS = ['#ff6b6b', '#ffd24a', '#4ad2c4', '#6ab0ff', '#ff9a3d', '#9be36a', '#f5f0e6', '#d46bd9', '#ff5ec4', '#e8e8f0', '#ad4c61', '#35a79a', '#edbd50', '#a479ab'];
const BOTTOMS = ['#303442', '#69584d', '#424e68', '#7a6a52', '#2f5a6a', '#8a8a96', '#4a3a5a'];
const SKINS = ['#f1d0b4', '#ebc6a2', '#d8aa82', '#c18e68', '#ad7957', '#805539'];
const BAGS = ['#ff4a4a', '#ffc83a', '#3ad6c8', '#9a6cff', '#ffffff', '#ff8a3a'];
const VEHICLE_COLORS = ['#3fa34d', '#d8262d', '#1f3a5c', '#f4f1ea', '#a0522d', '#ff5ec4', '#2fa5a5', '#f0b429'];

// ---------------------------------------------------------------- small drawing helpers

const wrap = (v: number, lo: number, hi: number) => lo + ((v - lo) % (hi - lo) + hi - lo) % (hi - lo);
function random(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const pickFrom = <T,>(rnd: () => number, a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
function shuffled<T>(a: readonly T[], rnd: () => number): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}
function line(b: PixelBuffer, x0: number, y0: number, x1: number, y1: number, c: Rgba) {
  const len = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= len; i++) b.set(Math.round(x0 + (x1 - x0) * i / (len || 1)), Math.round(y0 + (y1 - y0) * i / (len || 1)), c);
}
function box(b: PixelBuffer, x: number, y: number, w: number, h: number, c: Rgba, edge = P.ink) {
  b.rect(x, y, w, h, edge); b.rect(x + 1, y + 1, w - 2, h - 2, c);
}
function disc(b: PixelBuffer, cx: number, cy: number, r: number, c: Rgba) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r * .6) b.set(cx + dx, cy + dy, c);
}
type Pt = readonly [number, number];
function poly(b: PixelBuffer, pts: readonly Pt[], c: Rgba) {
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  for (let y = Math.ceil(y0); y <= Math.floor(y1); y++) {
    const xs: number[] = [], yy = y + .5;
    for (let i = 0; i < pts.length; i++) { const a = pts[i]!, d = pts[(i + 1) % pts.length]!; if ((a[1] <= yy) !== (d[1] <= yy)) xs.push(a[0] + (yy - a[1]) / (d[1] - a[1]) * (d[0] - a[0])); }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]!); x < Math.round(xs[k + 1]!); x++) b.set(x, y, c);
  }
}
/** 1-pixel ink edge around everything opaque (only on transparent pixels). */
function outline(b: PixelBuffer, c: Rgba = P.ink) {
  const todo: number[] = [];
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    if (b.data[y * b.w + x]! & 255) continue;
    if ((b.get(x - 1, y) & 255) === 255 || (b.get(x + 1, y) & 255) === 255 || (b.get(x, y - 1) & 255) === 255 || (b.get(x, y + 1) & 255) === 255) todo.push(y * b.w + x);
  }
  for (const i of todo) b.data[i] = c;
}
/** Soft contact shadow, written only where nothing is drawn. */
function groundShadow(b: PixelBuffer, x: number, y: number, w: number, h: number) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const dx = (i + .5 - w / 2) / (w / 2), dy = (j + .5 - h / 2) / (h / 2);
    if (dx * dx + dy * dy <= 1 && !(b.get(x + i, y + j) & 255)) b.set(x + i, y + j, P.shadow);
  }
}
/** Warm / coloured light on the ground in the dark variant: blends towards `color` inside an ellipse. */
function tint(g: PixelBuffer, cx: number, cy: number, rx: number, ry: number, color: string, k: number) {
  const base = rgba(color) & ~255;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    if (!(g.get(x, y) & 255)) continue;
    const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
    if (d >= 1) continue;
    const a = Math.round(Math.pow(1 - d, 1.4) * k * 255);
    if (a > 0) g.set(x, y, (base | a) >>> 0);
  }
}
/** Five by seven cell of made-up lettering: signs the eye reads as writing without being words. */
function glyph(b: PixelBuffer, x: number, y: number, c: Rgba, rnd: () => number) {
  const parts = [rnd() < .8, rnd() < .6, rnd() < .7, rnd() < .5, rnd() < .6, rnd() < .4];
  if (parts.every(p => !p)) parts[0] = true;
  if (parts[0]) b.rect(x, y, 5, 1, c);
  if (parts[1]) b.rect(x, y + 5, 5, 1, c);
  if (parts[2]) b.rect(x, y, 1, 6, c);
  if (parts[3]) b.rect(x + 4, y, 1, 6, c);
  if (parts[4]) b.rect(x, y + 2, 5, 1, c);
  if (parts[5]) b.rect(x + 2, y, 1, 6, c);
}
function board(b: PixelBuffer, x: number, y: number, w: number, h: number, neon: Rgba, dark: boolean, rnd: () => number, vertical: boolean) {
  box(b, x, y, w, h, P.night, dark ? neon : shade(neon, .65));
  const c = dark ? neon : shade(neon, .85);
  if (vertical) for (let yy = y + 2; yy + 6 <= y + h - 2; yy += 8) glyph(b, x + Math.floor((w - 5) / 2), yy, c, rnd);
  else for (let xx = x + 2; xx + 5 <= x + w - 2; xx += 7) glyph(b, xx, y + Math.floor((h - 6) / 2), c, rnd);
}

// ---------------------------------------------------------------- people of the street

function lookOf(i: number, rnd: () => number): Look {
  const dark = rnd() < .45;
  return {
    sex: i % 2 ? 'f' : 'm', outfit: i % 6 === 0 ? 'formal' : 'casual', hair: pickFrom(rnd, ['long', 'bob', 'bun', 'ponytail', 'short'] as const),
    hairColor: dark ? pickFrom(rnd, HAIRS.slice(0, 3)) : pickFrom(rnd, HAIRS), skin: pickFrom(rnd, SKINS), glasses: i % 5 === 0, top: pickFrom(rnd, TOPS), inner: '#eee9df', bottom: pickFrom(rnd, BOTTOMS), shoes: '#24232c',
  };
}
function withBag(s: Sprite, dir: Dir, c: Rgba): Sprite {
  const b = new PixelBuffer(s.buf.w + 10, s.buf.h);
  b.blit(s.buf, 5, 0);
  const ax = s.ax + 5, hip = s.ay - 12;
  if (dir === 'left' || dir === 'right') { const x = ax + (dir === 'right' ? -6 : 3); box(b, x, hip, 4, 5, c); b.rect(x, hip - 1, 4, 1, P.ink); b.rect(x + 1, hip + 1, 2, 1, shade(c, 1.5)); }
  else if (dir === 'up') { box(b, ax - 4, hip - 6, 8, 8, c); b.rect(ax - 3, hip - 5, 6, 1, shade(c, 1.5)); }
  else { box(b, ax - 8, hip, 4, 5, c); b.rect(ax - 7, hip + 1, 2, 1, shade(c, 1.5)); line(b, ax - 6, hip - 1, ax + 1, hip - 9, P.ink); }
  return { buf: b, ax, ay: s.ay };
}
/** Only the directions and actions a role needs are drawn: walkers go sideways, crossers up and down, customers just stand. */
function personSprites(l: Look, bag: Rgba | null, dirs: readonly Dir[], actions: readonly ('stand' | 'walk')[]) {
  const out = new Map<string, Sprite>();
  for (const wet of [false, true]) for (const dir of dirs) for (const action of actions) for (let f = 0; f < (action === 'walk' ? 4 : 2); f++) {
    const s = drawPerson(l, { action, dir, frame: f, umbrella: wet });
    out.set(`${wet}/${dir}/${action}/${f}`, bag === null ? s : withBag(s, dir, bag));
  }
  return out;
}

// ---------------------------------------------------------------- vehicles

function wheel(b: PixelBuffer, cx: number, cy: number, r: number, f: number) {
  disc(b, cx, cy, r, P.ink); disc(b, cx, cy, r - 2, P.grey1); disc(b, cx, cy, Math.max(1, r - 4), P.grey3);
  const a = f * Math.PI / 4;
  for (let k = 0; k < 4; k++) { const t = a + k * Math.PI / 2; b.set(cx + Math.round(Math.cos(t) * (r - 2)), cy + Math.round(Math.sin(t) * (r - 2)), P.grey4); }
}
function window2(b: PixelBuffer, pts: readonly Pt[], hi: [number, number, number, number]) {
  poly(b, pts, P.glass); line(b, hi[0], hi[1], hi[2], hi[3], P.screenHi);
}
/** Passenger car, drawn heading right. `taxi` adds the two-tone body and the roof sign. */
function drawSedan(b: PixelBuffer, body: Rgba, f: number, taxi: Rgba | null) {
  const hi = shade(body, 1.35), lo = shade(body, .62), cab = taxi ?? body;
  disc(b, 14, 33, 6, P.ink); disc(b, 46, 33, 6, P.ink);
  poly(b, [[3, 35], [2, 29], [5, 25], [14, 23], [46, 23], [55, 25], [58, 29], [58, 35]], body);
  poly(b, [[14, 23], [19, 12], [40, 12], [48, 23]], cab);
  window2(b, [[17, 22], [21, 14], [29, 14], [29, 22]], [20, 20, 24, 15]);
  window2(b, [[31, 22], [31, 14], [39, 14], [45, 22]], [33, 20, 36, 15]);
  line(b, 20, 12, 39, 12, shade(cab, 1.4));
  b.rect(4, 27, 53, 1, hi); b.rect(4, 32, 53, 1, lo); b.rect(30, 24, 1, 8, lo); b.rect(23, 28, 3, 1, P.grey1); b.rect(34, 28, 3, 1, P.grey1);
  b.rect(55, 26, 3, 3, P.lampGlow); b.rect(2, 26, 3, 3, P.red); b.rect(57, 30, 2, 3, P.grey2); b.rect(2, 32, 4, 2, P.grey1); b.rect(54, 32, 5, 2, P.grey1);
  b.rect(41, 21, 3, 2, shade(body, .6));
  if (taxi) { b.rect(14, 28, 38, 2, body === P.yellow ? P.gold : P.yellow); box(b, 24, 6, 14, 6, P.gold); b.rect(26, 8, 10, 2, P.ink); b.rect(27, 8, 3, 2, P.red); b.rect(33, 8, 2, 2, P.mint); }
  wheel(b, 14, 33, 5, f); wheel(b, 46, 33, 5, f);
}
function drawVan(b: PixelBuffer, body: Rgba, stripe: Rgba, f: number) {
  const hi = shade(body, 1.3), lo = shade(body, .65);
  disc(b, 14, 33, 6, P.ink); disc(b, 46, 33, 6, P.ink);
  poly(b, [[3, 35], [3, 10], [8, 7], [38, 7], [44, 9], [51, 17], [58, 23], [58, 35]], body);
  window2(b, [[43, 12], [47, 12], [53, 22], [43, 22]], [45, 20, 48, 14]);
  b.rect(5, 8, 36, 1, hi); b.rect(4, 31, 54, 2, lo); b.rect(4, 25, 54, 2, stripe); b.rect(4, 28, 54, 1, shade(stripe, .7));
  b.rect(41, 11, 1, 20, lo); b.rect(20, 10, 1, 15, lo); b.rect(36, 18, 3, 1, P.grey2);
  disc(b, 12, 17, 4, stripe); b.rect(10, 16, 5, 1, body); b.rect(11, 18, 3, 1, body);
  line(b, 6, 6, 36, 6, P.grey3); b.rect(8, 6, 1, 2, P.grey3); b.rect(34, 6, 1, 2, P.grey3);
  b.rect(55, 25, 3, 3, P.lampGlow); b.rect(2, 22, 2, 4, P.red); b.rect(2, 32, 4, 2, P.grey1); b.rect(54, 32, 5, 2, P.grey1); b.rect(57, 29, 2, 3, P.grey2);
  wheel(b, 14, 33, 5, f); wheel(b, 46, 33, 5, f);
}
function drawTukTuk(b: PixelBuffer, body: Rgba, roof: Rgba, f: number, driver: Sprite) {
  disc(b, 15, 33, 6, P.ink);
  poly(b, [[7, 35], [7, 25], [11, 22], [34, 22], [43, 25], [51, 29], [53, 35]], body);
  b.rect(8, 27, 44, 1, shade(body, 1.35)); b.rect(8, 32, 44, 1, shade(body, .6));
  box(b, 12, 18, 20, 5, shade(body, .6)); b.rect(13, 19, 18, 1, shade(body, 1.2));
  b.blit(driver.buf, 36 - driver.ax, 28 - driver.ay);
  poly(b, [[9, 9], [36, 8], [43, 11], [44, 14], [9, 14]], roof); b.rect(9, 13, 35, 1, shade(roof, .6)); for (let x = 12; x < 40; x += 6) b.rect(x, 9, 3, 4, shade(roof, 1.35));
  line(b, 11, 14, 11, 22, P.grey3); line(b, 30, 14, 30, 22, P.grey3);
  poly(b, [[39, 13], [43, 14], [44, 22], [40, 22]], P.glass); line(b, 41, 14, 42, 18, P.screenHi);
  b.rect(44, 25, 7, 2, P.grey1); b.rect(50, 26, 3, 3, P.lampGlow); b.rect(5, 26, 2, 3, P.red);
  wheel(b, 15, 33, 5, f); wheel(b, 47, 33, 4, f);
}
/** Kick scooter with its rider sitting on the seat; `driver` is null for a parked one. Origin offset (ox, oy) moves it inside a smaller buffer. */
function drawScooter(b: PixelBuffer, body: Rgba, f: number, driver: Sprite | null, ox = 0, oy = 0) {
  const hi = shade(body, 1.4), lo = shade(body, .6);
  wheel(b, ox + 18, oy + 34, 4, f); wheel(b, ox + 41, oy + 34, 4, f);
  poly(b, [[ox + 12, oy + 33], [ox + 14, oy + 25], [ox + 27, oy + 24], [ox + 29, oy + 30], [ox + 24, oy + 33]], body);
  b.rect(ox + 14, oy + 25, 13, 1, hi); b.rect(ox + 13, oy + 32, 12, 1, lo);
  b.rect(ox + 25, oy + 30, 12, 2, P.steelDark); b.rect(ox + 25, oy + 30, 12, 1, P.grey2);
  poly(b, [[ox + 14, oy + 22], [ox + 28, oy + 22], [ox + 28, oy + 25], [ox + 14, oy + 25]], P.wood3); b.rect(ox + 15, oy + 22, 11, 1, P.wood1);
  if (driver) b.blit(driver.buf, ox + 28 - driver.ax, oy + 30 - driver.ay);
  poly(b, [[ox + 36, oy + 17], [ox + 40, oy + 17], [ox + 43, oy + 31], [ox + 37, oy + 32]], body); b.rect(ox + 37, oy + 17, 1, 14, hi);
  line(b, ox + 36, oy + 16, ox + 33, oy + 15, P.grey1); b.rect(ox + 38, oy + 13, 4, 3, body); b.rect(ox + 41, oy + 14, 2, 2, P.lampGlow);
  b.rect(ox + 10, oy + 27, 3, 2, P.red); b.rect(ox + 8, oy + 28, 5, 4, shade(body, .8)); b.rect(ox + 8, oy + 28, 5, 1, hi);
}
export function vehicleSprite(kind: number, color: Rgba, dir: number, f: number, driver: Sprite): Sprite {
  const b = new PixelBuffer(60, 42);
  if (kind === 0) drawSedan(b, color === P.taxiGreen ? P.yellow : color, f, P.taxiGreen);
  else if (kind === 1) drawSedan(b, color, f, null);
  else if (kind === 2) drawTukTuk(b, color, (color >>> 8) % 2 ? P.red : P.gold, f, driver);
  else if (kind === 3) drawScooter(b, color, f, driver);
  else drawVan(b, color === P.paper ? rgba('#f4f1ea') : color, rgba('#2fa5a5'), f);
  outline(b);
  groundShadow(b, 6, 37, 48, 4);
  if (dir < 0) { const flip = new PixelBuffer(b.w, b.h); flip.blit(b, 0, 0, true); return { buf: flip, ax: 30, ay: 38 }; }
  return { buf: b, ax: 30, ay: 38 };
}
function parkedScooter(color: Rgba, flip: boolean, helmet: boolean): Sprite {
  const b = new PixelBuffer(40, 24);
  drawScooter(b, color, 0, null, -6, -17);
  if (helmet) { disc(b, 15, 7, 2, rgba('#f5f0e6')); b.rect(13, 7, 5, 1, P.ink); }
  outline(b); groundShadow(b, 3, 19, 32, 4);
  if (flip) { const f = new PixelBuffer(b.w, b.h); f.blit(b, 0, 0, true); return { buf: f, ax: 20, ay: 21 }; }
  return { buf: b, ax: 20, ay: 21 };
}
function signalSprite(red: boolean): Sprite {
  const b = new PixelBuffer(11, 30);
  b.rect(4, 11, 3, 18, P.steel); b.rect(5, 11, 1, 18, P.grey2); b.rect(2, 28, 7, 2, P.shadow);
  box(b, 1, 0, 9, 13, P.steelDark);
  b.rect(3, 2, 5, 3, red ? P.redNeon : shade(P.red, .45)); b.rect(3, 8, 5, 3, red ? shade(P.mint, .35) : P.mint);
  b.rect(4, 5, 3, 2, P.ink);
  return { buf: b, ax: 5, ay: 29 };
}
function puffSprites(): Sprite[] {
  return [0, 1, 2, 3].map(i => {
    const r = 1 + i * .8, size = 9, b = new PixelBuffer(size, size), c = 4;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const d = Math.hypot(x - c, y - c); if (d <= r + .4) b.set(x, y, rgba('#f4f1ea', Math.round(150 - i * 34))); }
    return { buf: b, ax: c, ay: c };
  });
}

// ---------------------------------------------------------------- shop fronts

interface Win { x: number; y: number; w: number; h: number; /** -1 dark, otherwise index into WARM */ lit: number }
export interface ShopSpec {
  name: ShopName; wall: string; inset: number; awning: number; sign: 0 | 1 | 2 | 3; neon: string; roof: 0 | 1 | 2 | 3; texture: 0 | 1 | 2 | 3;
  windows: Win[]; ac: boolean; laundry: boolean; plants: boolean; crates: boolean; doorLeft: boolean; h: number; seed: number;
}
const SHOP_W = 116;
/** Sign shapes: 0 wide banner, 1 round sign, 2 vertical blade, 3 corner neon. */
function makeSpec(name: ShopName, index: number, h: number, awning: number, sign: 0 | 1 | 2 | 3, neon: string, rnd: () => number, seed: number): ShopSpec {
  const inset = pickFrom(rnd, [0, 0, 6, 12]), fw = SHOP_W - inset;
  const count = 2 + Math.floor(rnd() * 3);
  const xl = 6, xr = fw - 26, cw = (xr - xl) / count, ww = Math.max(12, Math.min(34, Math.floor(cw - 5)));
  const rows = Math.max(1, Math.floor((h - 52 - 15 - 3) / 21)), windows: Win[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < count; c++) windows.push({ x: Math.round(xl + c * cw + (cw - ww) / 2), y: 15 + r * 21, w: ww, h: 16, lit: rnd() < .58 ? Math.floor(rnd() * 3) : (rnd(), -1) });
  return { name, wall: pickFrom(rnd, WALLS), inset, awning, sign, neon, roof: Math.floor(rnd() * 4) as 0 | 1 | 2 | 3, texture: Math.floor(rnd() * 4) as 0 | 1 | 2 | 3, windows, ac: sign !== 2 && rnd() < .7, laundry: sign !== 1 && rnd() < .4, plants: rnd() < .6, crates: rnd() < .5, doorLeft: rnd() < .5, h, seed: seed + index * 131 };
}
function drawAwning(b: PixelBuffer, x: number, y: number, w: number, hh: number, k: AwningLook) {
  const A = rgba(k.a), B = rgba(k.b);
  for (let i = 0; i < w; i++) {
    const depth = k.pattern === 'scallop' ? Math.round(2.2 * Math.sqrt(Math.max(0, 1 - ((i % 6 - 2.5) / 3) ** 2))) : 0;
    for (let j = 0; j < hh - 3 + depth; j++) {
      let c: Rgba = A;
      switch (k.pattern) {
        case 'block': case 'scallop': c = Math.floor(i / 6) % 2 ? B : A; break;
        case 'thin': c = Math.floor(i / 3) % 2 ? B : A; break;
        case 'check': c = (Math.floor(i / 4) + Math.floor(j / 3)) % 2 ? B : A; break;
        case 'diag': c = Math.floor((i + j) / 4) % 2 ? B : A; break;
        case 'solid': c = j >= hh - 5 ? B : A; break;
        case 'tile': c = j % 3 === 2 || (i + (Math.floor(j / 3) % 2) * 3) % 6 === 0 ? B : A; break;
      }
      b.set(x + i, y + j, c);
    }
  }
  b.rect(x, y, w, 1, shade(A, 1.45)); b.rect(x - 1, y, 1, hh - 2, P.ink); b.rect(x + w, y, 1, hh - 2, P.ink); b.rect(x - 1, y - 1, w + 2, 1, P.ink);
  b.rect(x, y + hh - 2, w, 1, P.ink);
}
function drawGoods(b: PixelBuffer, kind: Goods, x: number, y: number, w: number, h: number, rnd: () => number) {
  const by = y + h;   // counter line
  switch (kind) {
    case 'cups':
      b.rect(x, by - 5, w, 1, P.wood1); for (let xx = x + 2; xx < x + w - 4; xx += 6) { b.rect(xx, by - 9, 3, 4, pickFrom(rnd, [P.paper, P.orange, P.pink, P.leaf2, P.screen])); b.rect(xx, by - 9, 3, 1, P.ink); }
      for (let xx = x + 4; xx < x + w - 6; xx += 14) { box(b, xx, by - 4, 8, 4, P.grey1); b.rect(xx + 2, by - 6, 4, 2, P.steel); } break;
    case 'pot':
      for (let xx = x + 3; xx < x + w - 12; xx += 20) { box(b, xx, by - 8, 13, 8, P.grey2); b.rect(xx, by - 9, 13, 2, P.steel); b.rect(xx + 4, by - 11, 5, 2, P.grey1); }
      for (let xx = x + 2; xx < x + w - 4; xx += 5) b.rect(xx, by - 4, 3, 3, pickFrom(rnd, [P.paper, P.orange, P.terracotta])); break;
    case 'grill':
      b.rect(x + 2, by - 4, w - 4, 3, P.brick); for (let xx = x + 3; xx < x + w - 4; xx += 4) { b.rect(xx, by - 5, 1, 1, P.orange); line(b, xx, by - 7, xx + 2, by - 5, P.wood1); }
      for (let xx = x + 6; xx < x + w - 6; xx += 12) { line(b, xx, y, xx, y + 3, P.ink); box(b, xx - 2, y + 3, 5, 5, P.terracotta); } break;
    case 'bread':
      for (let k = 0; k < 2; k++) { b.rect(x + 1, y + 4 + k * 5, w - 2, 1, P.wood1); for (let xx = x + 3; xx < x + w - 6; xx += 7) { box(b, xx, y + 1 + k * 5, 5, 3, k ? P.gold : P.orange); b.set(xx + 2, y + 1 + k * 5, P.paper); } }
      box(b, x + 3, by - 5, 9, 5, P.paper); b.rect(x + 4, by - 4, 7, 2, P.pink); break;
    case 'books':
      for (let k = 0; k < 2; k++) { b.rect(x + 1, y + 5 + k * 5, w - 2, 1, P.wood2); for (let xx = x + 2; xx < x + w - 3; xx += 3) { const bh = 3 + Math.floor(rnd() * 2); b.rect(xx, y + 5 + k * 5 - bh, 2, bh, pickFrom(rnd, [P.red, P.teal, P.gold, P.paper, P.navy, P.leaf2, P.magenta])); } } break;
    case 'cross':
      b.rect(x + 3, y + 1, 4, 10, P.mint); b.rect(x + 1, y + 4, 8, 4, P.mint); b.rect(x + 4, y + 2, 2, 8, P.paper); b.rect(x + 2, y + 5, 6, 2, P.paper);
      for (let xx = x + 14; xx < x + w - 3; xx += 5) { b.rect(xx, by - 7, 3, 6, pickFrom(rnd, [P.paper, P.screen, P.leaf1])); b.rect(xx, by - 8, 3, 1, P.grey2); } break;
    case 'tools':
      for (let xx = x + 3; xx < x + w - 8; xx += 11) { box(b, xx, by - 7, 8, 7, P.grey2); b.rect(xx + 2, by - 5, 4, 3, P.ink); line(b, xx + 2, y, xx + 2, y + 5, P.grey3); b.rect(xx + 1, y + 5, 3, 2, P.steel); } break;
    case 'cloth':
      for (let xx = x + 4; xx < x + w - 7; xx += 8) { line(b, xx + 2, y, xx + 2, y + 1, P.grey2); const c = pickFrom(rnd, [P.red, P.teal, P.gold, P.pink, P.paper, P.orange, P.navy]); b.rect(xx, y + 2, 5, 7, c); b.rect(xx, y + 2, 5, 1, shade(c, 1.4)); } break;
    case 'flowers':
      for (let xx = x + 2; xx < x + w - 6; xx += 8) { b.rect(xx, by - 3, 6, 3, P.terracotta); b.rect(xx + 2, by - 8, 1, 6, P.leaf2); for (let k = 0; k < 3; k++) b.rect(xx + k * 2 - 1 + (k === 1 ? 1 : 0), by - 11 + (k % 2) * 2, 3, 3, pickFrom(rnd, [P.pink, P.redNeon, P.yellow, P.orange, rgba('#b57bff')])); } break;
    default:
      for (let k = 0; k < 2; k++) { b.rect(x + 1, y + 5 + k * 5, w - 2, 1, P.wood2); for (let xx = x + 2; xx < x + w - 5; xx += 6) b.rect(xx, y + 1 + k * 5, 4, 4, pickFrom(rnd, [P.paper, P.orange, P.red, P.screen, P.leaf2, P.gold, P.pink])); }
  }
}
/** One shop front, with the neon sign shape, awning, windows and clutter chosen by its spec. */
function shopBuffer(s: ShopSpec, dark: boolean): { buf: PixelBuffer; signX: number; signY: number; signSize: number } {
  const h = s.h, rnd = random(s.seed), fw = SHOP_W - s.inset, f = new PixelBuffer(fw, h), c = rgba(s.wall);
  const neon = rgba(s.neon), emit = dark ? neon : shade(neon, .55), warm = rgba(WARM[0]);
  // wall
  f.rect(0, 0, fw, h, P.ink); f.rect(2, 2, fw - 4, h - 4, shade(c, 1.2)); f.rect(fw - 12, 15, 10, h - 20, shade(c, .65)); f.rect(3, 15, 3, h - 18, shade(c, 1.45));
  for (let yy = 15; yy < h - 5; yy += 7) for (let xx = s.texture === 1 ? 6 : yy % 2 ? 6 : 13; xx < fw - 12; xx += s.texture === 1 ? 14 : 17) {
    if (s.texture === 0 || s.texture === 1) { f.rect(xx, yy, 15, 1, shade(c, .87)); f.rect(xx, yy, 1, 6, shade(c, .9)); }
    else if (s.texture === 2) { f.set(xx + Math.floor(rnd() * 8), yy + Math.floor(rnd() * 5), shade(c, 1.05 + rnd() * .3)); f.rect(xx, yy, 4, 1, shade(c, 1.08)); }
    else { f.rect(xx, yy, 1, 7, shade(c, .9)); f.rect(xx + 8, yy, 1, 7, shade(c, 1.1)); }
  }
  // roof band
  f.rect(4, 4, fw - 8, 9, s.roof === 1 ? P.terracotta : P.steel);
  if (s.roof === 0) for (let xx = 6; xx < fw - 6; xx += 5) f.rect(xx, 4, 1, 9, P.grey3);
  else if (s.roof === 1) for (let yy = 4; yy < 13; yy += 3) for (let xx = 4 + (yy % 2) * 3; xx < fw - 4; xx += 6) f.rect(xx, yy, 5, 2, shade(P.terracotta, yy % 2 ? .8 : 1.15));
  else if (s.roof === 2) for (let xx = 6; xx < fw - 8; xx += 8) { f.rect(xx, 4, 1, 4, P.grey2); poly(f, [[xx + 1, 5], [xx + 6, 5], [xx + 3, 11]], rgba(pickFrom(rnd, NEONS))); }
  else for (let xx = 7; xx < fw - 8; xx += 9) { f.rect(xx, 8, 3, 3, dark ? P.lampGlow : P.grey1); f.rect(xx, 5, 3, 1, P.grey3); }
  f.rect(2, 2, fw - 4, 2, shade(c, 1.6));
  // side strip: pipe, AC
  f.rect(fw - 4, 12, 2, h - 14, P.steel); f.rect(fw - 4, 12, 1, h - 14, P.grey2);
  if (s.ac) { box(f, fw - 25, 16, 19, 12, P.grey2); for (let yy = 18; yy < 26; yy += 2) f.rect(fw - 23, yy, 14, 1, P.grey3); box(f, fw - 8, 18, 5, 8, P.grey3); line(f, fw - 6, 28, fw - 6, 34, P.ink); }
  else if (s.sign !== 2) board(f, fw - 21, 16, 9, 26, neon, dark, rnd, true);
  // windows
  for (const w of s.windows) {
    f.rect(w.x - 1, w.y - 1, w.w + 2, w.h + 2, P.ink);
    const glass = dark ? (w.lit >= 0 ? rgba(WARM[w.lit]!) : shade(P.navy, .75)) : (w.lit >= 0 ? P.glass : shade(P.glass, .82));
    f.rect(w.x, w.y, w.w, w.h, glass);
    if (w.lit >= 0 && dark) { f.rect(w.x, w.y, 2, w.h, shade(glass, .8)); f.rect(w.x + w.w - 2, w.y, 2, w.h, shade(glass, .8)); f.rect(w.x + 2, w.y, w.w - 4, 1, shade(glass, .8)); }
    else if (!dark) line(f, w.x + 2, w.y + w.h - 2, w.x + 5, w.y + 2, P.screenHi);
    else line(f, w.x + 2, w.y + w.h - 2, w.x + 5, w.y + 2, shade(P.navy, 1.5));
    f.rect(w.x + Math.floor(w.w / 2), w.y, 1, w.h, P.ink); f.rect(w.x, w.y + Math.floor(w.h / 2), w.w, 1, P.ink);
    f.rect(w.x - 2, w.y + w.h + 1, w.w + 4, 2, shade(c, 1.55)); f.rect(w.x - 2, w.y + w.h + 3, w.w + 4, 1, P.shadow);
    if (s.plants && rnd() < .6) { f.rect(w.x + 2, w.y + w.h - 2, 4, 3, P.terracotta); f.rect(w.x + 1, w.y + w.h - 6, 6, 4, P.leaf2); f.rect(w.x + 3, w.y + w.h - 7, 2, 2, P.leaf1); }
    else rnd();
  }
  if (s.laundry) {
    const ly = 14 + (s.windows.length ? 0 : 0) + 17; line(f, 5, ly, fw - 28, ly + 2, P.grey3);
    for (let xx = 9; xx < fw - 30; xx += 9) { const gc = pickFrom(rnd, [P.paper, P.red, P.teal, P.gold, P.pink, P.orange]); f.rect(xx, ly + 1, 5, 6, gc); f.rect(xx, ly + 1, 5, 1, shade(gc, 1.4)); }
  }
  // sign zone
  let signX = fw / 2, signY = h - 41, signSize = 7;
  if (s.sign === 0) { box(f, 8, h - 49, fw - 16 - 12, 16, P.night, emit); f.rect(10, h - 47, fw - 20 - 12, 1, shade(emit, .5)); signX = 8 + (fw - 28) / 2; }
  else if (s.sign === 1) {
    f.rect(6, h - 41, fw - 26, 1, shade(emit, .8)); const cx = s.doorLeft ? fw - 30 : 24;
    disc(f, cx, h - 41, 11, P.ink); disc(f, cx, h - 41, 10, emit); disc(f, cx, h - 41, 8, P.night); signX = cx; signY = h - 41; signSize = 6;
  } else if (s.sign === 2) {
    const bx = fw - 21; f.rect(bx + 5, h - 71, 2, 2, P.grey2); f.rect(bx - 6, h - 70, 12, 1, P.steel); box(f, bx, h - 69, 12, 42, P.night, emit); f.rect(bx + 2, h - 67, 8, 1, shade(emit, .5)); signX = bx + 6; signY = h - 48; signSize = 6;
    f.rect(6, h - 36, fw - 34, 1, shade(emit, .7));
  } else {
    box(f, 6, h - 49, 70, 16, P.night, emit); f.rect(0, 14, 4, h - 44, emit); f.rect(0, 14, 1, h - 44, shade(emit, 1.4)); f.rect(4, h - 33, 3, 1, emit); signX = 41; signSize = 7;
  }
  // awning
  const look = AWNINGS[s.awning]!;
  drawAwning(f, 4, h - 30, fw - 10, 11, look); f.rect(4, h - 19, fw - 10, 2, P.shadow);
  // counter and door
  const dw = 18, doorX = s.doorLeft ? 8 : fw - 32, dispX = s.doorLeft ? 8 + dw + 3 : 8, dispW = fw - 40 - 3, dy = h - 17;
  box(f, dispX, dy, dispW, 14, dark ? shade(warm, .75) : P.glass);
  drawGoods(f, s.name.goods, dispX + 1, dy + 1, dispW - 2, 12, rnd);
  f.rect(dispX, dy + 12, dispW, 2, P.wood2);
  box(f, doorX, h - 18, dw, 16, P.wood3); f.rect(doorX + 2, h - 16, dw - 4, 8, dark ? shade(warm, .6) : P.glass); f.rect(doorX + dw - 4, h - 10, 2, 2, P.gold);
  box(f, doorX + 3, h - 24, 12, 4, P.night, emit); f.rect(doorX + 5, h - 23, 8, 2, dark ? neon : shade(neon, .7));
  if (s.crates) { const cx = s.doorLeft ? fw - 28 : 4; for (let k = 0; k < 2; k++) { box(f, cx + k * 9, h - 11, 9, 8, P.wood1); f.rect(cx + k * 9 + 1, h - 8, 7, 1, P.wood3); } box(f, cx + 3, h - 18, 9, 8, P.wood1); b3(f, cx + 3, h - 20, rnd); }
  f.rect(6, h - 3, fw - 12, 3, P.steelDark);
  const b = new PixelBuffer(SHOP_W, h);
  // the gap beside a narrow front: an alley with a pipe and a drain
  b.rect(0, 0, s.inset, h, dark ? rgba('#0f0d18') : P.grey3);
  if (s.inset) { b.rect(2, 3, 1, h - 6, P.steel); b.rect(s.inset - 2, 20, 1, h - 26, P.grey2); b.rect(1, h - 12, Math.max(2, s.inset - 2), 9, shade(P.teal, dark ? .6 : .9)); }
  b.blit(f, s.inset, 0);
  return { buf: b, signX: signX + s.inset, signY, signSize };
}
/** A little heap of fruit on a crate. */
function b3(b: PixelBuffer, x: number, y: number, rnd: () => number) { for (let k = 0; k < 3; k++) b.rect(x + k * 3, y, 3, 2, pickFrom(rnd, [P.orange, P.red, P.leaf2, P.yellow])); }

// ---------------------------------------------------------------- back row of rooftops

/** A tall building behind the first shops: windows, rooftop clutter, a billboard frame or two. Every pixel is textured. */
function backBuilding(w: number, h: number, dark: boolean, seed: number, lights: Light[], ox: number, oy: number): PixelBuffer {
  const rnd = random(seed), b = new PixelBuffer(w, h), cl = 22, c = rgba(pickFrom(rnd, BACK)), wall = dark ? shade(c, .72) : shade(c, 1.15);
  b.rect(0, cl, w, h - cl, P.ink); b.rect(1, cl, w - 2, h - cl, wall);
  for (let y = cl + 4; y < h; y += 6) for (let x = 1; x < w - 1; x++) b.set(x, y, shade(wall, .9));
  for (let y = cl + 4; y < h; y += 6) for (let x = 1 + (y / 6 % 2) * 5; x < w - 1; x += 11) b.rect(x, y, 1, 6, shade(wall, .92));
  b.rect(0, cl, w, 1, P.ink); b.rect(1, cl + 1, w - 2, 2, shade(wall, 1.5)); b.rect(1, cl + 3, w - 2, 1, P.shadow);
  // windows
  for (let y = cl + 8; y + 9 < h - 4; y += 15) for (let x = 5; x + 7 < w - 3; x += 11) {
    const lit = rnd() < .5, t = Math.floor(rnd() * 3);
    box(b, x, y, 8, 10, dark ? (lit ? rgba(WARM[t]!) : shade(P.navy, .7)) : (lit ? P.glass : shade(P.glass, .8)), P.ink);
    b.rect(x + 3, y + 1, 1, 8, P.ink); b.rect(x, y + 4, 8, 1, P.ink); b.rect(x - 1, y + 10, 10, 1, shade(wall, 1.5));
    if (rnd() < .22) { box(b, x + 1, y + 11, 7, 3, P.grey2); b.rect(x + 2, y + 12, 5, 1, P.grey3); }
    if (dark && lit && rnd() < .3) lights.push({ x: ox + x + 4, y: oy - (h - y - 5), radius: 16, color: WARM[t]!, strength: .45 });
  }
  // rooftop clutter in the band above the roof line
  const clutter = (x: number) => {
    const kind = Math.floor(rnd() * 6);
    if (kind === 0) { for (const lx of [x + 1, x + 10]) b.rect(lx, cl - 5, 2, 5, P.grey3); box(b, x, cl - 17, 13, 12, shade(P.wood2, dark ? .8 : 1.1)); b.rect(x + 2, cl - 14, 9, 1, shade(P.wood1, .9)); b.rect(x + 2, cl - 10, 9, 1, P.wood3); poly(b, [[x - 1, cl - 17], [x + 14, cl - 17], [x + 6, cl - 21]], P.grey2); }
    else if (kind === 1) { b.rect(x + 4, cl - 20, 1, 20, P.grey2); b.rect(x + 1, cl - 17, 7, 1, P.grey2); b.rect(x + 2, cl - 12, 5, 1, P.grey2); b.rect(x + 4, cl - 21, 1, 1, P.redNeon); line(b, x + 4, cl - 20, x - 2, cl - 3, P.grey4); line(b, x + 4, cl - 20, x + 10, cl - 3, P.grey4); }
    else if (kind === 2) { for (let k = 0; k < 3; k++) { box(b, x + k * 9, cl - 8, 8, 8, P.grey2); disc(b, x + k * 9 + 4, cl - 4, 2, P.grey4); } b.rect(x, cl - 10, 26, 1, P.steel); }
    else if (kind === 3) {
      const bw = 30, bh = 15, nc = rgba(pickFrom(rnd, NEONS)); b.rect(x + 4, cl - 5, 2, 5, P.steel); b.rect(x + bw - 6, cl - 5, 2, 5, P.steel);
      box(b, x, cl - 5 - bh, bw, bh, P.night, dark ? nc : shade(nc, .6)); b.rect(x + 2, cl - 3 - bh, bw - 4, bh - 4, shade(nc, dark ? .4 : .55)); disc(b, x + 8, cl - 5 - bh / 2, 3, P.paper); for (let k = 0; k < 3; k++) glyph(b, x + 14 + k * 5, cl - 5 - bh / 2 - 3, dark ? P.white : P.paper, rnd);
      if (dark) lights.push({ x: ox + x + bw / 2, y: oy - (h - cl) - bh / 2 + 4, radius: 30, color: shade(nc, 1) >= 0 ? '#' + (nc >>> 8).toString(16).padStart(6, '0') : '#ffffff', strength: .5 });
    }
    else if (kind === 4) { box(b, x, cl - 10, 11, 10, shade(wall, 1.2)); b.rect(x + 3, cl - 7, 4, 7, P.wood3); line(b, x + 13, cl, x + 13, cl - 14, P.grey2); line(b, x + 13, cl - 14, x + 20, cl - 14, P.grey2); line(b, x + 20, cl - 14, x + 20, cl - 4, P.grey2); }
    else { line(b, x, cl - 3, x + 22, cl - 3, P.grey3); for (let k = 0; k < 4; k++) poly(b, [[x + k * 6 + 1, cl - 3], [x + k * 6 + 5, cl - 3], [x + k * 6 + 3, cl + 1]], rgba(pickFrom(rnd, NEONS))); disc(b, x + 30, cl - 7, 5, P.paper); b.rect(x + 25, cl - 7, 10, 1, P.grey2); line(b, x + 30, cl - 7, x + 30, cl, P.grey3); }
  };
  clutter(3 + Math.floor(rnd() * 6)); if (w > 52) clutter(w - 34 - Math.floor(rnd() * 5));
  // vertical neon boards hung on the facade
  for (const x of w > 40 ? [w - 12, 3] : [w - 12]) if (rnd() < .8) {
    const nc = rgba(pickFrom(rnd, NEONS)), bh = 20 + Math.floor(rnd() * 3) * 6, by = cl + 6 + Math.floor(rnd() * 12);
    if (by + bh < h - 4) { board(b, x, by, 9, bh, nc, dark, rnd, true); if (dark) lights.push({ x: ox + x + 4, y: oy - (h - by - bh / 2), radius: 20, color: '#' + (nc >>> 8).toString(16).padStart(6, '0'), strength: .5 }); }
  }
  return b;
}

/** The street, its shops and its people. Decorative only: nothing is placed on the office's [0,W] x [0,H] floor. */
export class City implements CityScene {
  private readonly W: number;
  private readonly H: number;
  private readonly rect: { x: number; y: number; w: number; h: number };
  private readonly theme: Theme;
  private readonly seed: number;
  private readonly step: number;
  /** The eight shop fronts, in the order left column top to bottom, then right column. */
  readonly shopSpecs: ShopSpec[] = [];
  readonly cartNames: string[] = [];
  private readonly glows: Glow[] = [];
  private readonly objects = new Map<boolean, StaticScene>();
  private readonly grounds = new Map<string, Drawing>();
  private readonly people: Person[] = [];
  private readonly vehicles: Vehicle[] = [];
  private readonly fixedPeople: { x: number; y: number; kind: 'vendor' | 'customer'; dir: Dir; phase: number; sprites: Map<string, Sprite> }[] = [];
  private readonly parked: { x: number; y: number; sprite: Sprite }[] = [];
  private readonly signals = [signalSprite(false), signalSprite(true)];
  private readonly puffs = puffSprites();
  private time = 0;
  private occupied = false;

  constructor(options: CityOptions) {
    if (!Number.isFinite(options.width) || !Number.isFinite(options.depth) || options.width < 1 || options.depth < 1) throw new RangeError('City needs a positive office size');
    this.W = Math.round(options.width * TILE); this.H = Math.round(options.depth * TILE);
    this.step = Math.max(50, Math.floor((this.H + 112) / 4));
    const top = Math.min(-208, -6 - (this.step - 7) - 70);
    this.rect = { x: -9 * TILE, y: top, w: this.W + 18 * TILE, h: this.H + 168 - top };
    this.seed = options.seed >>> 0;
    const rnd = random(this.seed);
    this.theme = THEMES[(options.seed >>> 0) % THEMES.length]!;
    // Shops: a different name, awning, sign shape and neon colour for each, all picked by the seed.
    const names = shuffled(SHOP_POOL, rnd), awnings = shuffled(AWNINGS.map((_, i) => i), rnd), neons = shuffled(NEONS, rnd), shapes = shuffled([0, 0, 1, 1, 2, 2, 3, 3] as const, rnd);
    const specRnd = random(this.seed ^ 0x5bd1e995);
    for (let i = 0; i < 8; i++) this.shopSpecs.push(makeSpec(names[i]!, i, this.step - 7, awnings[i]!, shapes[i]!, neons[i]!, specRnd, this.seed));
    CART_POOL.forEach(list => this.cartNames.push(pickFrom(rnd, list)));
    // People: one pool of looks (bright tops, odd hair colours, some with bags), shared by walkers, customers and riders.
    const both = ['stand', 'walk'] as const, bagFor = (i: number) => i % 5 < 2 ? rgba(pickFrom(rnd, BAGS)) : null;
    const walkerPool = Array.from({ length: 12 }, (_, i) => personSprites(lookOf(i, rnd), bagFor(i), ['left', 'right'], both));
    const crossPool = Array.from({ length: 6 }, (_, i) => personSprites(lookOf(i + 12, rnd), bagFor(i), ['up', 'down'], both));
    const standPool = Array.from({ length: 8 }, (_, i) => personSprites(lookOf(i + 18, rnd), bagFor(i + 1), ['up', 'down', 'left', 'right'], ['stand']));
    const poolLooks = Array.from({ length: 8 }, (_, i) => lookOf(i + 100, rnd));
    const lanes = [this.H + 27, this.H + 38, this.H + 150, this.H + 160], sizes = [3, 2, 3, 2, 3, 2, 3, 2];
    let id = 0;
    sizes.forEach((count, g) => {
      const lane = lanes[g % 4]!, dir: Dir = g % 2 ? 'left' : 'right', speed = 9 + rnd() * 12, start = this.rect.x + 16 + rnd() * (this.rect.w - 80), sprites = walkerPool[g % walkerPool.length]!;
      for (let k = 0; k < count; k++) this.people.push({ x: start - k * 10 * (dir === 'right' ? 1 : -1), y: lane + (k % 2), dir, speed: speed + k * .4, phase: rnd() * 4, pause: 0, cooldown: rnd() * 6, crossing: false, sprites: walkerPool[(g * 3 + k + id) % walkerPool.length] ?? sprites });
      id++;
    });
    // Two groups of five wait at the crossing, cross, wait on the far side and come back, passing each other.
    for (let gi = 0; gi < 2; gi++) for (let k = 0; k < 5; k++) {
      const off = (gi ? -7 : -17) + k * 6;
      this.people.push({ x: this.W / 2 + off, y: this.H + 45, dir: gi ? 'up' : 'down', speed: 11, phase: k * .2 + gi * 18, pause: 1, cooldown: 0, crossing: true, sprites: crossPool[(gi * 5 + k) % crossPool.length]! });
    }
    for (const [i, x] of this.cartXs().entries()) {
      this.fixedPeople.push({ x: x + 3, y: this.H + 25, kind: 'vendor', dir: 'down', phase: i, sprites: standPool[(i * 5 + 2) % standPool.length]! });
      for (let j = 0; j < 4; j++) this.fixedPeople.push({ x: x - 15 + j * 10.5, y: this.H + 44 + (j * 5 % 4), kind: 'customer', dir: j === 0 ? 'right' : j === 3 ? 'left' : 'up', phase: j * .7 + i, sprites: standPool[(i * 4 + j + 1) % standPool.length]! });
    }
    // Traffic keeps left: heading east (+x) the driver's left is north, so the upper lane carries +x and the lower lane -x.
    const kinds = [[0, 3, 1, 4, 3, 2, 1], [1, 3, 0, 2, 4, 3, 0]];
    const drivers = poolLooks.map(l => drawPerson(l, { action: 'sit', dir: 'right', frame: 0 }));
    const cache = new Map<string, Sprite>();
    for (let lane = 0; lane < 2; lane++) for (let k = 0; k < 7; k++) {
      const dir = lane === 0 ? 1 : -1, kind = kinds[lane]![k]!, color = rgba(VEHICLE_COLORS[(k * 3 + lane * 5 + (kind === 0 ? 0 : 1)) % VEHICLE_COLORS.length]!), driver = drivers[(k + lane * 3) % drivers.length]!;
      const sprites = [0, 1].map(f => { const key = `${kind}/${color}/${dir}/${f}/${(k + lane * 3) % drivers.length}`; let s = cache.get(key); if (!s) { s = vehicleSprite(kind, color, dir, f, driver); cache.set(key, s); } return s; });
      this.vehicles.push({ x: this.rect.x + 40 + (k + .4 + lane * .5) / 7 * (this.rect.w - 80), y: this.H + (dir > 0 ? 80 : 119), dir, speed: 26 + rnd() * 16 + (kind === 3 ? 8 : 0), kind, sprites });
    }
    // Parked scooters in a row along the kerb.
    const parkedXs = [108, 126, 144, 258, 276, 294, -48, -30];
    parkedXs.forEach((x, i) => this.parked.push({ x, y: this.H + 49, sprite: parkedScooter(rgba(VEHICLE_COLORS[(i * 3 + 1) % VEHICLE_COLORS.length]!), i % 3 === 0, i % 2 === 0) }));
    for (const dark of [false, true]) this.objects.set(dark, this.buildObjects(options.name, dark));
    for (const dark of [false, true]) for (const wet of [false, true]) this.grounds.set(`${dark}/${wet}`, this.buildGround(dark, wet));
  }

  /** Grown once to cover every sprite: a deep office pushes the neighbours' roofs above the fixed top margin. */
  private fitted = false;
  /** Vehicle kind per moving vehicle: 0 taxi, 1 sedan, 2 tuk-tuk, 3 scooter, 4 van. */
  vehicleKinds(): number[] { return this.vehicles.map(v => v.kind); }
  bounds() {
    if (!this.fitted) {
      this.fitted = true;
      let top = this.rect.y;
      for (const d of this.frame(false, false).drawables) top = Math.min(top, d.y - d.sprite.ay);
      if (top < this.rect.y) { this.rect.h += this.rect.y - top; this.rect.y = top; }
    }
    return { ...this.rect };
  }
  private cartXs() { return [-77, this.W * .22, this.W * .78, this.W + 76]; }
  update(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Small simulation steps avoid tunnelling through a crossing after a long frame.
    for (let remaining = dt; remaining > 1e-9;) {
      const step = Math.min(remaining, .05); remaining -= step; this.time += step;
      for (const p of this.people) {
        if (p.crossing) {
          const phase = (this.time + p.phase) % 36;
          // Wait on the pavements, cross in both directions, never approach the door row.
          p.y = this.H + (phase < 3 ? 45 : phase < 12 ? 45 + (phase - 3) / 9 * 113 : phase < 21 ? 158 : phase < 30 ? 158 - (phase - 21) / 9 * 113 : 45);
          // Waiting people face the crossing; the two groups start half a cycle apart and pass each other on the zebra.
          p.dir = phase >= 12 && phase < 30 ? 'up' : 'down'; p.pause = phase < 3 || phase >= 12 && phase < 21 || phase >= 30 ? 1 : 0;
        } else {
          p.cooldown -= step;
          if (p.pause > 0) { p.pause -= step; continue; }
          p.x = wrap(p.x + (p.dir === 'right' ? 1 : -1) * p.speed * step, this.rect.x + 12, this.rect.x + this.rect.w - 12);
          if (p.y < this.H + 60 && p.cooldown <= 0 && this.cartXs().some(x => Math.abs(x - p.x) < 7)) { p.pause = 1.3 + p.phase; p.cooldown = 12; }
        }
      }
      // Only people on the road itself stop the cars; those waiting on the pavements do not.
      const occupied = this.people.some(p => p.crossing && p.y > this.H + 52 && p.y < this.H + 142);
      this.occupied = occupied;
      const cx = this.W / 2;
      for (const v of this.vehicles) {
        const distance = (cx - v.x) * v.dir;
        const stop = 55;
        // Cars that have already passed the stop line clear the crossing.
        let speed = occupied && distance >= stop ? Math.min(v.speed, Math.max(0, (distance - stop) * 2)) : v.speed;
        const circuit = this.rect.w - 60;
        const gap = Math.min(...this.vehicles.filter(other => other !== v && other.dir === v.dir).map(other => wrap((other.x - v.x) * v.dir, 0, circuit)));
        speed = Math.min(speed, Math.max(0, (gap - 65) * 2));
        v.x = wrap(v.x + speed * v.dir * step, this.rect.x + 30, this.rect.x + this.rect.w - 30);
      }
    }
  }

  frame(dark: boolean, raining: boolean): CityFrame {
    const s = this.objects.get(dark)!;
    const drawables: Drawing[] = [this.grounds.get(`${dark}/${raining}`)!, ...s.drawables];
    this.people.forEach((p, i) => {
      const action = p.pause > 0 ? 'stand' : 'walk', f = Math.floor(this.time * p.speed / 5 + p.phase) % (action === 'walk' ? 4 : 2);
      drawables.push({ kind: 'walker', id: `walker-${i}`, sprite: p.sprites.get(`${raining}/${p.dir}/${action}/${f}`)!, x: p.x, y: p.y, sortY: p.y, layer: 'object' });
    });
    this.fixedPeople.forEach((p, i) => drawables.push({ kind: p.kind, id: `${p.kind}-${i}`, sprite: p.sprites.get(`${raining}/${p.dir}/stand/${Math.floor(this.time * .8 + p.phase) % 2}`)!, x: p.x, y: p.y, sortY: p.y, layer: 'object' }));
    this.parked.forEach((p, i) => drawables.push({ kind: 'parked', id: `parked-${i}`, sprite: p.sprite, x: p.x, y: p.y, sortY: p.y, layer: 'object' }));
    const lights = [...s.lights];
    this.vehicles.forEach((v, i) => {
      drawables.push({ kind: 'vehicle', id: `vehicle-${i}`, sprite: v.sprites[Math.floor(this.time * v.speed / 7) % 2]!, x: v.x, y: v.y, sortY: v.y, layer: 'object' });
      if (dark) lights.push({ x: v.x + v.dir * (v.kind === 3 ? 14 : 26), y: v.y - 8, radius: 28, color: '#ffe9a0', strength: .7 });
    });
    // Steam over the carts: three puffs each, rising and thinning.
    this.cartXs().forEach((x, ci) => {
      for (let j = 0; j < 3; j++) {
        const t = (this.time * .45 + j / 3 + ci * .21) % 1, k = Math.min(3, Math.floor(t * 4));
        drawables.push({ kind: 'steam', id: `steam-${ci}-${j}`, sprite: this.puffs[k]!, x: x - 6 + j * 8 + Math.sin(t * 6 + j) * 2, y: this.H + 12 - t * 16, sortY: this.H + 38, layer: 'object' });
      }
    });
    const cx = this.W / 2;
    for (const [sx, sy] of [[cx - 50, this.H + 51], [cx + 50, this.H + 146]] as const) {
      drawables.push({ kind: 'signal', id: `signal-${sx}`, sprite: this.signals[this.occupied ? 1 : 0]!, x: sx, y: sy, sortY: sy, layer: 'object' });
      if (dark) lights.push({ x: sx, y: sy - 24, radius: 16, color: this.occupied ? '#ff3b3b' : '#3dff9a', strength: .8 });
    }
    return { drawables, lights, signs: s.signs };
  }

  private buildGround(dark: boolean, wet: boolean): Drawing {
    const g = new PixelBuffer(this.rect.w, this.rect.h), tex = random(this.seed ^ 921), sk = random(this.seed ^ 77);
    const ox = -this.rect.x, oy = -this.rect.y, south = oy + this.H, crossX = ox + this.W / 2;
    // Backdrop sky behind the roofs, with a far skyline.
    const skies = dark ? ['#0d0b1c', '#15122a', '#1d1836', '#271f40'] : ['#8fb4c8', '#9fc0d0', '#b0cad6', '#c4d8de'];
    for (let i = 0; i < 4; i++) g.rect(0, Math.floor(i * (oy - 24) / 4), g.w, Math.ceil((oy - 24) / 4) + 1, rgba(skies[i]!));
    for (let x = 0; x < g.w;) { const w = 8 + Math.floor(sk() * 16), h = 12 + Math.floor(sk() * 40); g.rect(x, oy - 24 - h, w, h, dark ? rgba('#120f22') : rgba('#7aa0b6')); for (let k = 0; k < w * h / 40; k++) if (dark && sk() < .6) g.set(x + 1 + Math.floor(sk() * (w - 2)), oy - 24 - h + 2 + Math.floor(sk() * (h - 3)), rgba(WARM[Math.floor(sk() * 3)]!, 150)); x += w; }
    if (dark) for (let i = 0; i < 90; i++) g.set(Math.floor(sk() * g.w), Math.floor(sk() * (oy - 70)), rgba(i % 5 ? '#6a6a8a' : '#d8d8f0'));
    else for (let i = 0; i < 7; i++) { const cx = Math.floor(sk() * g.w), cy = 6 + Math.floor(sk() * (oy - 100)); for (const [dx, dy, r] of [[0, 0, 7], [9, 2, 5], [-9, 3, 5], [3, -3, 5]] as const) disc(g, cx + dx, cy + dy, r, rgba('#e8f0f4')); }
    // Paving everywhere below: the ledge above the office, the alleys and both pavements.
    const paveA = dark ? P.grey4 : P.grey2, paveB = dark ? P.grey3 : P.grey1;
    g.rect(0, oy - 24, g.w, 24 + this.H, dark ? P.grey4 : P.grey2);
    g.rect(0, south, g.w, 168, paveB);
    for (let y = oy - 24; y < g.h; y += 8) for (let x = 0; x < g.w; x += 16) { line(g, x, y, x + 15, y, paveA); line(g, x + (y % 16 ? 8 : 0), y, x + (y % 16 ? 8 : 0), y + 7, paveA); }
    for (let i = 0; i < 90; i++) { const x = Math.floor(tex() * g.w), y = oy - 24 + Math.floor(tex() * (g.h - oy + 24)); if (y < south + 51 || y > south + 131) g.rect(x, y, 3, 1, shade(paveB, .86)); }
    // Office floor stays transparent.
    for (let y = oy; y < south; y++) for (let x = ox; x < ox + this.W; x++) g.data[y * g.w + x] = 0;
    // Road.
    g.rect(0, south + 51, g.w, 5 * TILE, dark ? P.asphalt : shade(P.grey3, .9));
    g.rect(0, south + 48, g.w, 3, P.paper); g.rect(0, south + 51, g.w, 4, P.steelDark);
    g.rect(0, south + 131, g.w, 3, P.paper); g.rect(0, south + 134, g.w, 3, P.grey2);
    for (let x = 20; x < g.w; x += 112) {
      box(g, x, south + 43, 18, 5, P.steelDark);
      for (let xx = x + 2; xx < x + 17; xx += 3) g.rect(xx, south + 44, 1, 3, P.grey2);
      box(g, x + 30, south + 83, 12, 7, P.steelDark, P.grey3);
      g.rect(x + 32, south + 85, 8, 1, P.grey2); g.rect(x + 34, south + 87, 4, 1, P.grey3);
    }
    for (let x = 0; x < g.w; x += 32) { g.rect(x, south + 91, 18, 2, P.paper); g.rect(x, south + 49, 13, 2, P.terracotta); g.rect(x, south + 131, 13, 2, P.terracotta); }
    for (let y = 55; y < 129; y += 9) g.rect(crossX - 18, south + y, 36, 5, P.paper);
    g.rect(crossX - 47, south + 57, 2, 29, P.paper); g.rect(crossX + 45, south + 97, 2, 29, P.paper);
    // Traffic keeps left: the upper lane carries +x (arrows point right), the lower lane -x.
    for (const x of [70, g.w - 90]) for (const y of [77, 119]) { const d = y < 96 ? 1 : -1; line(g, x - 9, south + y, x + 9, south + y, P.paper); line(g, x + d * 9, south + y, x + d * 3, south + y - 5, P.paper); line(g, x + d * 9, south + y, x + d * 3, south + y + 5, P.paper); }
    // A seeded surface texture is identical across day/night/wet variants.
    for (let i = 0; i < g.w * 1.3; i++) { const x = Math.floor(tex() * g.w), y = south + 57 + Math.floor(tex() * 71); if (Math.abs(x - crossX) > 23) g.rect(x, y, 2, 1, shade(dark ? P.asphalt : P.grey3, .8)); }
    // Night: coloured light spread on the ground below every sign, lantern and cart.
    if (dark) for (const gl of this.glows) tint(g, gl.x - this.rect.x, gl.y - this.rect.y, gl.rx, gl.ry, gl.color, gl.k);
    if (wet) {
      const pr = random(this.seed ^ 1234);
      for (let i = 0; i < 46; i++) {
        const road = i < 30, x = Math.floor(pr() * (g.w - 25)), y = road ? south + 57 + Math.floor(pr() * 71) : south + (pr() < .6 ? 8 + Math.floor(pr() * 36) : 140 + Math.floor(pr() * 24));
        if (Math.abs(x - crossX) <= 30 || (y > south && y < south + 51 && x > ox && x < ox + this.W && false)) continue;
        // The nearest glow in x lends its colour to the reflection.
        let near: Glow | undefined; for (const gl of this.glows) if (!near || Math.abs(gl.x - this.rect.x - x) < Math.abs(near.x - this.rect.x - x)) near = gl;
        const rc = dark && near ? rgba(near.color) : P.glass;
        g.rect(x, y, 17, 2, P.steel); g.rect(x + 3, y, 9, 1, dark ? shade(rc, .8) : P.glass);
        if (dark) for (const sx of [x + 4, x + 8, x + 12]) { g.rect(sx, y - 2, 1, 4, (rc & ~255 | 150) >>> 0); }
      }
    }
    return { kind: 'ground', id: 'street-ground', sprite: { buf: g, ax: 0, ay: 0 }, x: this.rect.x, y: this.rect.y, sortY: this.rect.y, layer: 'ground' };
  }

  private buildObjects(name: string, dark: boolean): StaticScene {
    const drawables: Drawing[] = [], lights: Light[] = [], signs: SignText[] = [];
    const neon = rgba(this.theme.neon), accent = rgba(this.theme.accent), wall = rgba(this.theme.wall);
    const emit = dark ? neon : shade(neon, .55), window = dark ? P.lampGlow : P.glass;
    const add = (kind: Kind, id: string, b: PixelBuffer, x: number, y: number, ay = 0, layer: 'object' | 'ground' = 'object', sortY = y) => { drawables.push({ kind, id, sprite: { buf: b, ax: 0, ay }, x, y, sortY, layer }); };
    const light = (x: number, y: number, radius: number, color: string, strength = .8) => { if (dark) lights.push({ x, y, radius, color, strength }); };
    const sign = (text: string, x: number, y: number, size: number, color = this.theme.neon, vertical = false) => signs.push({ text, x, y, size, color: dark ? color : '#e9e2d0', ...(dark ? { glow: color } : {}), ...(vertical ? { vertical: true } : {}) });
    const glow = (x: number, y: number, rx: number, ry: number, color: string, k: number) => { if (dark && !this.glowsDone) this.glows.push({ x, y, rx, ry, color, k }); };
    // Back row: tall rooftops behind everything, so no flat slab is left above the first shops or the company front.
    const rows = 4, step = this.step, h = step - 7;
    const backRnd = random(this.seed ^ 0xb4c);
    // Beside the shops the roofs end behind the first shop; in the alleys they come down to the ledge above the office.
    const shopBottom = -6 - h + 14, segments: [number, number, number][] = [[this.rect.x, -24, shopBottom], [-24, 0, -22], [0, this.W, -150], [this.W, this.W + 24, -22], [this.W + 24, this.rect.x + this.rect.w, shopBottom]];
    let bi = 0;
    for (const [x0, x1, bottom] of segments) for (let x = x0; x < x1;) {
      let w = x1 - x0 <= 24 ? x1 - x0 : 28 + Math.floor(backRnd() * 30); if (x1 - x - w < 26) w = x1 - x;
      const roofLine = this.rect.y + 22 + Math.floor(backRnd() * 34), bh = bottom - roofLine + 22;
      const b = backBuilding(w, bh, dark, this.seed + bi * 977, lights, x, bottom);
      add('building', `back-${bi}`, b, x, bottom, bh, 'object', -300 + bi); bi++; x += w;
    }
    // Company facade above the north wall, never covering its floor.
    const front = new PixelBuffer(this.W, 136), wr = random(this.seed ^ 0xc0);
    front.rect(0, 0, this.W, 136, wall); front.rect(0, 0, this.W, 7, P.ink); front.rect(0, 7, this.W, 3, shade(wall, 1.5));
    for (let y = 12; y < 128; y += 8) for (let x = (y % 16 ? -8 : 0); x < this.W; x += 16) { front.rect(x, y, 15, 1, shade(wall, .82)); front.rect(x + 15, y, 1, 7, shade(wall, .82)); }
    front.rect(this.W - 5, 10, 3, 118, P.steel); front.rect(this.W - 4, 10, 1, 118, P.grey3);
    for (let x = 0; x < this.W; x += 32) {
      const lit = wr() < .55, tint2 = Math.floor(wr() * 3);
      front.rect(x, 12, 2, 123, shade(wall, .7)); box(front, x + 6, 18, 20, 27, dark ? (lit ? rgba(WARM[tint2]!) : P.navy) : (lit ? window : P.navy)); front.rect(x + 15, 19, 2, 25, P.steel); front.rect(x + 7, 30, 18, 2, P.steel); front.rect(x + 5, 45, 22, 3, P.ink);
      if (lit) light(x + 16, -119, 25, WARM[tint2]!, .5);
    }
    const fr = random(this.seed ^ 0xfb);
    for (let x = 52, k = 0; x < this.W - 20; x += 80, k++) { const col = k % 2 ? accent : neon; board(front, x, 52, 9, 28, col, dark, fr, true); light(x + 4, -24 - 136 + 66, 22, k % 2 ? this.theme.accent : this.theme.neon, .5); }
    for (let x = 14; x < this.W - 25; x += 80) { box(front, x, 55, 28, 16, P.grey2); for (let j = 0; j < 5; j++) front.rect(x + 3, 58 + j * 2, 14, 1, P.steel); box(front, x + 19, 58, 6, 9, P.grey3); line(front, x + 25, 71, x + 25, 78, P.ink); }
    for (let x = 0; x < this.W; x++) front.set(x, 78 + Math.round(Math.sin(x / this.W * Math.PI) * 5), P.ink);
    box(front, 18, 86, Math.max(8, this.W - 36), 37, emit); box(front, 21, 89, Math.max(4, this.W - 42), 31, P.night, accent);
    front.rect(0, 129, this.W, 7, P.steelDark); front.rect(0, 129, this.W, 2, P.grey3);
    add('building', 'company-front', front, 0, -24, 136);
    sign(name, this.W / 2, -55, 14); light(this.W / 2, -56, Math.min(130, this.W / 2), this.theme.neon);
    light(this.W * .25, -40, 70, this.theme.neon, .45); light(this.W * .75, -40, 70, this.theme.neon, .45);
    glow(this.W / 2, -12, this.W * .42, 15, this.theme.neon, .55);
    for (const [x, text] of [[-15, 'AI'], [this.W + 3, '24 ชม.']] as const) { const b = new PixelBuffer(13, 80); box(b, 0, 0, 13, 80, P.night, emit); add('building', `vertical-${x}`, b, x, -29, 80); sign(text, x + 6, -73, 8, this.theme.accent, true); light(x + 6, -73, 32, this.theme.accent); glow(x + 6, 58, 16, 22, this.theme.accent, .45); }
    // Eight different fronts: four on each flank.
    for (let side = 0; side < 2; side++) for (let i = 0; i < rows; i++) {
      const spec = this.shopSpecs[side * rows + i]!, x = side ? this.W + 24 : -140, base = -6 + i * step;
      const sb = shopBuffer(spec, dark), shopNeon = spec.neon;
      add('building', `shop-${side}-${i}`, sb.buf, x, base, h);
      const short = spec.sign === 1 || spec.sign === 2;
      sign(short ? spec.name.short : spec.name.full, x + sb.signX, base - h + sb.signY, sb.signSize, shopNeon, spec.sign === 2);
      const sx = x + sb.signX, sy = base - h + sb.signY;
      light(sx, sy, 34, shopNeon, .6); light(sx, sy + 18, 26, shopNeon, .4); light(x + 52, base - 10, 39, WARM[0], .6);
      spec.windows.forEach(w => { if (w.lit >= 0) light(x + spec.inset + w.x + w.w / 2, base - h + w.y + w.h / 2, 15, WARM[w.lit]!, .5); });
      if (i === rows - 1) glow(sx, base + 14, 52, 17, shopNeon, .5);
    }
    this.cartXs().forEach((x, i) => {
      const b = new PixelBuffer(43, 43), look = AWNINGS[(i * 3 + 1 + this.seed) % AWNINGS.length]!, c = rgba(look.a), sh = 6;
      b.rect(1, 38, 41, 4, P.shadow); box(b, 7, 20 + sh, 5, 13, P.ink); box(b, 31, 20 + sh, 5, 13, P.ink);
      box(b, 3, 15 + sh, 37, 15, shade(c, .8)); b.rect(5, 17 + sh, 33, 3, shade(c, 1.5)); box(b, 6, 21 + sh, 12, 7, P.wood2); box(b, 20, 21 + sh, 17, 7, P.wood3);
      b.rect(4, 4 + sh, 2, 17, P.steel); b.rect(37, 4 + sh, 2, 17, P.steel); drawAwning(b, 0, 1 + sh, 43, 8, look);
      if (i === 0) { box(b, 8, 10 + sh, 13, 7, P.grey1); b.rect(10, 9 + sh, 9, 2, P.steel); for (const xx of [12, 16]) line(b, xx, 7 + sh, xx + 1, 4 + sh, P.paper); }
      else if (i === 1) for (let xx = 9; xx < 34; xx += 6) { line(b, xx, 10 + sh, xx, 18 + sh, P.wood1); b.rect(xx - 1, 11 + sh, 4, 4, P.terracotta); }
      else if (i === 2) for (let xx = 8; xx < 34; xx += 7) { box(b, xx, 10 + sh, 5, 8, P.screen); b.rect(xx + 1, 10 + sh, 3, 3, P.orange); }
      else { box(b, 8, 10 + sh, 26, 8, P.glass); for (let xx = 10; xx < 32; xx += 6) b.rect(xx, 13 + sh, 4, 3, P.gold); }
      // The name sits on a dark plate above the awning, not on its stripes.
      box(b, 0, 0, 43, 8, P.night, emit); b.rect(2, 1, 39, 1, shade(emit, .5));
      add('cart', `cart-${i}`, b, Math.round(x - 21), this.H + 37, 41);
      light(x, this.H + 17, 34, '#ffe9a0', .9); light(x, this.H + 2, 28, this.theme.accent, .45);
      sign(this.cartNames[i]!, x, this.H + 37 - 41 + 4, 5, this.theme.accent);
      glow(x, this.H + 38, 36, 12, '#ffcf80', .5); glow(x, this.H + 60, 34, 14, this.theme.accent, .25);
    });
    // Props share real base coordinates with people, giving correct occlusion.
    const furniture: [number, 'lamp' | 'tree'][] = [[-122, 'lamp'], [-30, 'tree'], [36, 'lamp'], [128, 'tree'], [160, 'lamp'], [262, 'tree'], [282, 'lamp'], [372, 'tree'], [410, 'lamp'], [446, 'tree'], [536, 'lamp']];
    furniture.forEach(([x, type], i) => {
      if (Math.abs(x + 13 - this.W / 2) < 30) return;
      const b = new PixelBuffer(26, 49), y = this.H + 47;
      if (type === 'lamp') { b.rect(10, 44, 9, 3, P.shadow); box(b, 11, 13, 4, 33, P.steel); b.rect(12, 14, 1, 30, P.grey2); line(b, 12, 13, 22, 8, P.steel); box(b, 17, 7, 9, 4, dark ? P.lampGlow : P.grey1); light(x + 21, y - 39, 58, '#ffe9a0', .9); glow(x + 21, y - 2, 28, 12, '#ffe0a0', .4); }
      else {
        b.rect(3, 43, 22, 4, P.shadow); box(b, 7, 35, 13, 11, P.terracotta); b.rect(8, 36, 11, 2, P.orange); b.rect(12, 18, 3, 20, P.wood2);
        for (let yy = 9; yy <= 32; yy++) for (let xx = 1; xx < 25; xx++) {
          if (((xx - 12) / 11) ** 2 + ((yy - 21) / 12) ** 2 > 1) continue;
          const speck = (xx * 13 + yy * 7) % 17;
          b.set(xx, yy, xx > 15 || yy > 28 ? shade(P.leaf3, .8) : speck < 4 ? P.leaf1 : speck < 10 ? P.leaf2 : P.leaf3);
        }
        b.rect(8, 44, 11, 1, shade(P.terracotta, .6));
        if (dark) for (const [lx, ly] of [[6, 14], [17, 12], [10, 25], [19, 24], [13, 17]] as const) { b.set(lx, ly, P.lampGlow); b.set(lx + 1, ly, P.yellow); }
      }
      add('prop', `lamp-tree-${i}`, b, x - 13, y, 47);
    });
    for (const x of [this.W * .32, this.W + 38]) {
      const b = new PixelBuffer(35, 25); for (const yy of [3, 7, 11]) box(b, 2, yy, 31, 3, P.wood1); b.rect(2, 15, 31, 4, P.wood2); for (const xx of [5, 28]) b.rect(xx, 18, 3, 6, P.steel); add('prop', `bench-${x}`, b, Math.round(x), this.H + 22, 24);
    }
    // Crates, a parked cycle and chalkboards make small clusters rather than empty strips.
    for (const [i, x] of [-113, this.W * .37, this.W + 113].entries()) {
      const b = new PixelBuffer(25, 25);
      if (i === 1) {
        for (const cx of [5, 19]) for (let a = 0; a < 24; a++) { const angle = a / 24 * Math.PI * 2; b.set(Math.round(cx + Math.cos(angle) * 4), Math.round(19 + Math.sin(angle) * 4), P.steelDark); }
        line(b, 5, 19, 10, 12, P.teal); line(b, 10, 12, 15, 19, P.teal); line(b, 15, 19, 5, 19, P.teal); line(b, 19, 19, 16, 9, P.grey2); line(b, 10, 12, 17, 12, P.teal); b.rect(8, 9, 6, 2, P.ink); b.rect(14, 8, 6, 1, P.ink);
      } else {
        box(b, 1, 10, 13, 12, P.wood1); for (const yy of [13, 17]) b.rect(2, yy, 11, 1, P.wood3); line(b, 2, 11, 12, 21, P.wood2);
        for (const xx of [3, 7, 10]) { b.rect(xx, 7, 3, 3, i ? P.orange : P.leaf2); b.set(xx, 7, P.lampGlow); }
        box(b, 15, 14, 9, 9, P.terracotta); b.rect(18, 9, 2, 6, P.leaf3); b.rect(15, 10, 8, 2, P.leaf2);
      }
      add('prop', `cycle-crates-${i}`, b, Math.round(x), this.H + 25, 24);
    }
    for (const x of [this.W * .08, this.W * .87]) {
      const b = new PixelBuffer(13, 23); line(b, 2, 9, 0, 22, P.wood2); line(b, 9, 9, 12, 22, P.wood2); box(b, 1, 3, 11, 17, P.wood1); box(b, 3, 5, 7, 12, P.steelDark);
      for (const yy of [7, 10, 13]) b.rect(4, yy, yy === 10 ? 3 : 5, 1, P.paper);
      add('prop', `chalkboard-${x}`, b, Math.round(x), this.H + 29, 23);
    }
    // Narrow alleys beside the office: utility poles, meter boxes, flyers and bins.
    for (const x of [-21, this.W + 2]) for (let y = 58, i = 0; y < this.H - 20; y += 93, i++) {
      const b = new PixelBuffer(19, 58);
      b.rect(8, 3, 3, 51, P.wood3); b.rect(8, 3, 1, 51, P.wood1); b.rect(3, 8, 14, 2, P.steel); b.rect(4, 6, 2, 2, P.grey2); b.rect(14, 6, 2, 2, P.grey2);
      box(b, 6, 24, 7, 11, P.grey2); b.rect(8, 26, 3, 2, P.glass); b.rect(8, 40, 3, 7, P.paper); b.rect(8, 42, 2, 1, P.red);
      box(b, 0, 45, 6, 11, P.teal); b.rect(0, 45, 6, 2, P.grey2); b.rect(2, 49, 1, 5, shade(P.teal, 1.5));
      add('prop', `alley-${x}-${i}`, b, x, y, 57);
    }
    // Hanging lantern strings are high overhead; sort at their rear support line.
    for (const [left, right] of [[this.rect.x + 5, this.W / 2 - 33], [this.W / 2 + 33, this.rect.x + this.rect.w - 5]]) {
      const b = new PixelBuffer(Math.round(right! - left!), 22);
      for (let x = 0; x < b.w; x++) b.set(x, Math.round(2 + 5 * Math.sin(x / b.w * Math.PI)), P.ink);
      for (let x = 13; x < b.w - 8; x += 27) {
        const y = Math.round(2 + 5 * Math.sin(x / b.w * Math.PI)); b.rect(x, y, 1, 5, P.wood3); box(b, x - 4, y + 4, 9, 10, dark ? P.redNeon : P.red); b.rect(x - 1, y + 5, 2, 8, P.gold); b.rect(x - 2, y + 14, 5, 2, P.gold);
        light(left! + x, this.H + y + 9, 30, '#ff9b3d', .85); light(left! + x, this.H + y + 12, 14, '#ffd28a', .5); glow(left! + x, this.H + 36, 22, 9, '#ff9b3d', .3);
      }
      add('prop', `lanterns-${left}`, b, left!, this.H + 20, 20);
    }
    this.glowsDone = this.glowsDone || dark;
    return { drawables, lights, signs };
  }
  private glowsDone = false;
}

export const createCity = (options: CityOptions): CityScene => new City(options);

// Shared contract of the pixel view. Pure module: no DOM, no three, so everything here runs in node tests.
// Owner: the planner. Workers import from here and do not change it; ask for a change instead.
//
// World space of the pixel view, in "scene pixels":
//   scene x = floor x * TILE, scene y = floor z * TILE. The office floor is the rectangle (0,0)-(width*TILE, depth*TILE).
//   North (z = 0) is the top of the screen. The office entrance is at the bottom middle (x = width/2, z = depth).
//   The street (sidewalk, then road) lies below the office: scene y > depth*TILE.
//   Building fronts and the big neon sign of the company rise above the north wall: scene y < 0.
// Things are drawn back to front by `sortY` (the scene y of their feet/base), so a person behind a desk is hidden by it.
import type { OfficeItem } from '../../../shared/catalog.ts';
import type { Look } from '../../domain/looks.ts';

/** One floor cell is TILE x TILE scene pixels. */
export const TILE = 16;
/** A standing person fits a PERSON_W x PERSON_H box whose bottom middle is the feet. */
export const PERSON_W = 16;
export const PERSON_H = 24;
/** Height of a wall face in scene pixels. */
export const WALL_H = 24;

/** RGBA packed as 0xRRGGBBAA. 0 is fully transparent. */
export type Rgba = number;

const CSS_NAMES: Record<string, string> = {
  white: 'ffffff', black: '000000', red: 'ff0000', green: '008000', blue: '0000ff', yellow: 'ffff00', orange: 'ffa500', purple: '800080',
  pink: 'ffc0cb', brown: 'a52a2a', gray: '808080', grey: '808080', silver: 'c0c0c0', gold: 'ffd700', navy: '000080', teal: '008080',
  cyan: '00ffff', aqua: '00ffff', magenta: 'ff00ff', fuchsia: 'ff00ff', lime: '00ff00', maroon: '800000', olive: '808000', beige: 'f5f5dc',
  ivory: 'fffff0', tan: 'd2b48c', coral: 'ff7f50', salmon: 'fa8072', indigo: '4b0082', violet: 'ee82ee', turquoise: '40e0d0', transparent: '00000000',
};

/**
 * '#rgb', '#rrggbb' or '#rrggbbaa' (the '#' is optional), `rgb()` / `rgba()`, or a basic CSS colour name: the
 * office and agent colours come from the server as free text. `alpha` applies when the text carries none.
 * Text that is not a hex colour gives magenta: a wrong colour should be seen, not pass as black.
 */
export function rgba(hex: string, alpha = 255): Rgba {
  const text = hex.trim().toLowerCase(), named = CSS_NAMES[text];
  const fn = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)\s*[,\s]\s*(\d+(?:\.\d+)?)\s*(?:[,/]\s*(\d*\.?\d+)(%?)\s*)?\)$/.exec(text);
  if (fn) {
    const byte = (v: string) => Math.max(0, Math.min(255, Math.round(Number(v))));
    const a = fn[4] === undefined ? Math.max(0, Math.min(255, Math.round(alpha))) : Math.max(0, Math.min(255, Math.round((fn[5] ? Number(fn[4]) / 100 : Number(fn[4])) * 255)));
    return ((byte(fn[1]!) << 24) | (byte(fn[2]!) << 16) | (byte(fn[3]!) << 8) | a) >>> 0;
  }
  const h = (named ?? text).replace(/^#/, '');
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(h)) return 0xff00ffff;
  const full = h.length === 3 ? [...h].map(c => c + c).join('') : h;
  const a = full.length === 8 ? parseInt(full.slice(6), 16) : Math.max(0, Math.min(255, Math.round(alpha)));
  return ((parseInt(full.slice(0, 6), 16) << 8) | a) >>> 0;
}

/** Darker (k < 1) or lighter (k > 1) version of a colour, alpha kept. */
export function shade(color: Rgba, k: number): Rgba {
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return ((f(color >>> 24) << 24) | (f((color >>> 16) & 255) << 16) | (f((color >>> 8) & 255) << 8) | (color & 255)) >>> 0;
}

/** A small image made by code. All art is drawn into one of these, then turned into a canvas once by the view. */
export class PixelBuffer {
  readonly data: Uint32Array;
  constructor(readonly w: number, readonly h: number) { this.data = new Uint32Array(w * h); }

  /** Coordinates are snapped down to whole pixels, here and in `set`: seat positions are fractions of a tile. */
  get(x: number, y: number): Rgba { x = Math.floor(x); y = Math.floor(y); return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.data[y * this.w + x]!; }

  /** Opaque or transparent write; pixels outside the buffer are ignored. Alpha below 255 blends over what is there. */
  set(x: number, y: number, color: Rgba) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const a = color & 255;
    if (a === 0) return;
    const i = y * this.w + x;
    if (a === 255 || (this.data[i]! & 255) === 0) { this.data[i] = color; return; }
    // Source-over with straight alpha: what lies under counts only as much as it is opaque.
    const under = this.data[i]!, top = a / 255, below = (under & 255) / 255 * (1 - top), out = top + below;
    const mix = (shift: number) => Math.round((((color >>> shift) & 255) * top + ((under >>> shift) & 255) * below) / out);
    this.data[i] = ((mix(24) << 24) | (mix(16) << 16) | (mix(8) << 8) | Math.round(out * 255)) >>> 0;
  }

  rect(x: number, y: number, w: number, h: number, color: Rgba) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, color);
  }

  /** Copies `src` with its top-left at (dx, dy); `flipX` mirrors it. */
  blit(src: PixelBuffer, dx: number, dy: number, flipX = false) {
    for (let j = 0; j < src.h; j++) for (let i = 0; i < src.w; i++) this.set(dx + (flipX ? src.w - 1 - i : i), dy + j, src.data[j * src.w + i]!);
  }

  /** Bytes in canvas ImageData order (R, G, B, A). */
  toBytes(): Uint8ClampedArray {
    const out = new Uint8ClampedArray(this.w * this.h * 4);
    for (let i = 0; i < this.data.length; i++) {
      const c = this.data[i]!;
      out[i * 4] = c >>> 24; out[i * 4 + 1] = (c >>> 16) & 255; out[i * 4 + 2] = (c >>> 8) & 255; out[i * 4 + 3] = c & 255;
    }
    return out;
  }

  /** How many pixels are not transparent. */
  filled(): number { let n = 0; for (const c of this.data) if (c & 255) n++; return n; }
}

/** An image and the point in it that sits on the scene position (feet of a person, top-left floor corner of furniture). */
export interface Sprite { buf: PixelBuffer; ax: number; ay: number }

/** One thing to draw this frame. `x`,`y` is where the sprite's anchor goes in scene pixels. */
export interface Drawable {
  sprite: Sprite;
  x: number;
  y: number;
  /** Scene y used for back-to-front order. Ground things (rugs, zone floors, road paint) use layer 'ground' and are drawn first. */
  sortY: number;
  layer: 'ground' | 'object';
}

/** A soft light punched into the night layer and added on top. Scene pixels. */
export interface Light { x: number; y: number; radius: number; color: string; strength: number }

/** Text is drawn by the view at screen resolution (Thai marks are unreadable at 8 px), anchored at its centre. */
export interface SignText {
  text: string;
  x: number;
  y: number;
  /** Height of the letters in scene pixels. */
  size: number;
  color: string;
  glow?: string;
  /** One letter cluster per line, top to bottom (split with Intl.Segmenter, never by code unit). */
  vertical?: boolean;
  font?: 'thai' | 'mono';
  /** A rounded plate behind the text (CSS colour), for text that lies over busy pixels. */
  plate?: string;
}

// ---------- people (people.ts) ----------

export type Dir = 'down' | 'up' | 'left' | 'right';
export type PersonAction = 'stand' | 'walk' | 'run' | 'sit' | 'type' | 'kick' | 'throw' | 'wave' | 'dance' | 'flinch';

/** Frames each action has; the view picks `frame` in [0, PERSON_FRAMES[action]). */
export const PERSON_FRAMES: Record<PersonAction, number> = { stand: 2, walk: 4, run: 4, sit: 1, type: 2, kick: 3, throw: 3, wave: 2, dance: 4, flinch: 2 };

export interface PersonPose { action: PersonAction; dir: Dir; frame: number; umbrella?: boolean }

/** people.ts exports this. The same look and pose always give the same pixels; results are cached by the callee. */
export type DrawPerson = (look: Look, pose: PersonPose) => Sprite;

// ---------- office (furniture.ts) ----------

export interface ItemOptions {
  dark: boolean;
  /** Slow animation counter (blinking screens, steam); 0 when still. */
  frame: number;
  /** Someone works at this desk now: its screen is on. */
  active?: boolean;
  /** Team desk: ids of the seats whose owner works now; only their screens are on. */
  activeSeats?: string[];
}

/** furniture.ts exports these. An item's Drawable is placed at (item.x*TILE, item.z*TILE) by the callee. */
export type DrawItem = (item: OfficeItem, options: ItemOptions) => Drawable[];
/** Floor of the whole office as one ground image, anchored at scene (0,0). */
export type DrawFloor = (width: number, depth: number, floorColor: string, dark: boolean) => Drawable;
/** Outer walls with a door gap `doorCells` wide at the bottom middle. The north wall shows its face; side and south walls are thin. */
export type DrawWalls = (width: number, depth: number, wallColor: string, doorCells: number, dark: boolean) => Drawable[];

// ---------- street (city.ts) ----------

export interface CityOptions {
  /** Office size in cells; the street is laid out around it. */
  width: number;
  depth: number;
  /** Company name on the big sign. */
  name: string;
  /** Picks the colour theme and the shop names; the same seed always builds the same street. */
  seed: number;
}

export interface CityFrame { drawables: Drawable[]; lights: Light[]; signs: SignText[] }

/** city.ts exports a class with this shape. Walkers and cars are decoration: they never enter the office floor. */
export interface CityScene {
  /** Scene rectangle the street needs, including the office: the view uses it for camera limits. */
  bounds(): { x: number; y: number; w: number; h: number };
  update(dt: number): void;
  frame(dark: boolean, raining: boolean): CityFrame;
}

// ---------- what the view reads from the simulation (world.ts fills these) ----------

export interface ActorView {
  id: string;
  name: string;
  /** Floor position in cells. */
  x: number;
  z: number;
  /** Radians, 0 faces +z (down the screen), same as the 3D view. */
  facing: number;
  moving: boolean;
  running: boolean;
  /** 'sit' when seated and not moving. */
  pose: 'stand' | 'sit';
  /** Seated at their own desk or an HQ seat with a running task. */
  working: boolean;
  gesture: 'kick' | 'throw' | 'wave' | 'dance' | 'flinch' | null;
  /** performance.now() time the gesture ends; it moves when the same gesture is triggered again. */
  gestureEnd?: number;
  umbrella: boolean;
  selected: boolean;
  kind: 'agent' | 'player' | 'visitor';
  look: Look;
  /** The label element the avatar already owns (name, status, speech); the view positions it. */
  label: HTMLElement | null;
}

/** Facing angle to the nearest of the four sprite directions. */
export function dirOf(facing: number): Dir {
  const x = Math.sin(facing), z = Math.cos(facing);
  return Math.abs(x) > Math.abs(z) ? (x > 0 ? 'right' : 'left') : (z > 0 ? 'down' : 'up');
}

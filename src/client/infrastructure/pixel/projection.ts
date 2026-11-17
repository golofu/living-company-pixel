import { CATALOG, footprint, type OfficeItem } from '../../../shared/catalog.ts';
import { TILE, PERSON_W, PERSON_H, type ActorView, type Drawable } from './types.ts';

export interface Point { x: number; y: number }
/** Camera centre in scene pixels; viewport dimensions are CSS pixels. */
export interface Camera extends Point { zoom: number }
export interface Size { w: number; h: number }
export interface Rect extends Point, Size {}

export function sceneToScreen(p: Point, camera: Camera, viewport: Size): Point {
  return { x: (p.x - camera.x) * camera.zoom + viewport.w / 2, y: (p.y - camera.y) * camera.zoom + viewport.h / 2 };
}
export function screenToScene(p: Point, camera: Camera, viewport: Size): Point {
  return { x: (p.x - viewport.w / 2) / camera.zoom + camera.x, y: (p.y - viewport.h / 2) / camera.zoom + camera.y };
}
export function screenToFloor(p: Point, camera: Camera, viewport: Size) {
  const s = screenToScene(p, camera, viewport);
  return { x: s.x / TILE, z: s.y / TILE };
}
/** Stable ties retain furniture order, with people after furniture at the same base. */
export function sortDrawables<T extends Drawable & { person?: boolean }>(objects: T[]): T[] {
  return objects.sort((a, b) => a.sortY - b.sortY || Number(!!a.person) - Number(!!b.person));
}
export function hitTest(actors: readonly ActorView[], x: number, y: number): ActorView | null {
  let front: ActorView | null = null;
  for (const actor of actors) {
    const ax = actor.x * TILE, ay = actor.z * TILE;
    if (x >= ax - PERSON_W / 2 && x <= ax + PERSON_W / 2 && y >= ay - PERSON_H && y <= ay && (!front || actor.z >= front.z)) front = actor;
  }
  return front;
}
export function viewportRect(camera: Camera, viewport: Size): Rect {
  const w = viewport.w / camera.zoom, h = viewport.h / camera.zoom;
  return { x: camera.x - w / 2, y: camera.y - h / 2, w, h };
}
export function inViewport(d: Drawable, rect: Rect): boolean {
  const x = d.x - d.sprite.ax, y = d.y - d.sprite.ay;
  return x + d.sprite.buf.w >= rect.x && x <= rect.x + rect.w && y + d.sprite.buf.h >= rect.y && y <= rect.y + rect.h;
}
export function clampCamera(camera: Camera, viewport: Size, bounds: Rect): Camera {
  const clamp = (v: number, start: number, span: number, view: number) => span <= view ? start + span / 2 : Math.max(start + view / 2, Math.min(start + span - view / 2, v));
  return { ...camera, x: clamp(camera.x, bounds.x, bounds.w, viewport.w / camera.zoom), y: clamp(camera.y, bounds.y, bounds.h, viewport.h / camera.zoom) };
}

/**
 * The piece of furniture under a scene point, front-most first. A team desk answers with the id of its nearest seat,
 * because that is what an agent's `deskId` holds. Furniture rises above its footprint, so the box reaches a tile up.
 */
export function pickItem(items: OfficeItem[], sceneX: number, sceneY: number): { itemId: string } | null {
  const solid = items.filter(i => i.id && i.type !== 'zone' && i.type !== 'rug' && i.type !== 'wall' && i.type !== 'parking' && Object.hasOwn(CATALOG, i.type))
    .sort((a, b) => (b.z + footprint(b).d) - (a.z + footprint(a).d));
  for (const item of solid) {
    const { w, d } = footprint(item);
    if (sceneX < item.x * TILE || sceneX > (item.x + w) * TILE || sceneY < item.z * TILE - TILE || sceneY > (item.z + d) * TILE) continue;
    if (item.type !== 'teamdesk' || !item.seats?.length) return { itemId: item.id! };
    let best = item.seats[0]!, bestDistance = Infinity;
    for (const seat of item.seats) {
      const distance = Math.hypot((item.x + seat.dx) * TILE - sceneX, (item.z + seat.dz) * TILE - sceneY);
      if (distance < bestDistance) { best = seat; bestDistance = distance; }
    }
    return { itemId: best.id };
  }
  return null;
}

type SegmenterCtor = new (locale: string, options: { granularity: string }) => { segment(text: string): Iterable<{ segment: string }> };

/**
 * Splits a sign into letter clusters for vertical writing, so a Thai vowel or tone mark stays with its consonant.
 * `Segmenter` is injectable for tests (null = behave as if the browser had none); browsers without Intl.Segmenter get a Thai-aware fallback instead of a throw.
 */
export function letterClusters(text: string, Segmenter: SegmenterCtor | null | undefined = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter): string[] {
  const parts = Segmenter
    ? [...new Segmenter('th', { granularity: 'grapheme' }).segment(text)].map(part => part.segment)
    : [...text].reduce<string[]>((out, ch) => {
      if (/[\u0E31\u0E33-\u0E3A\u0E47-\u0E4E]/.test(ch) && out.length) out[out.length - 1] += ch; else out.push(ch);
      return out;
    }, []);
  return parts.filter(part => part.trim());
}

/** Largest whole zoom (1 to 4) at which the office floor is at most a third wider than the viewport: big pixels matter more than seeing every wall, and the camera follows the player. */
export function startZoom(viewportWidth: number, floorWidth: number): number {
  for (let zoom = 4; zoom > 1; zoom--) if (floorWidth * zoom <= viewportWidth * 1.35) return zoom;
  return 1;
}

/**
 * Name tags of people standing together would pile into one unreadable blob. Each tag is given as its bottom-centre
 * point and size (screen pixels); the answer is a y per tag, the lower tags keeping their place and the ones behind
 * moving up until they are clear. After `maxSteps` moves a tag stays where it got to.
 */
export function spreadLabels(tags: { x: number; y: number; w: number; h: number }[], gap = 2, maxSteps = 6): number[] {
  const order = tags.map((_, i) => i).sort((a, b) => tags[b]!.y - tags[a]!.y || a - b);
  const placed: { x: number; y: number; w: number; h: number }[] = [], out = tags.map(t => t.y);
  for (const i of order) {
    const tag = tags[i]!;
    let y = tag.y;
    for (let step = 0; step < maxSteps; step++) {
      const hit = placed.find(p => Math.abs(p.x - tag.x) < (p.w + tag.w) / 2 && y > p.y - p.h - gap && y - tag.h - gap < p.y);
      if (!hit) break;
      y = hit.y - hit.h - gap;
    }
    out[i] = y;
    placed.push({ ...tag, y });
  }
  return out;
}

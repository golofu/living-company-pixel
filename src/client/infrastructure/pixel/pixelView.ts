import type { Office } from '../../../shared/types.ts';
import { CATALOG, center, type OfficeItem } from '../../../shared/catalog.ts';
import type { Attention } from '../../domain/attention.ts';
import { drawPerson } from './people.ts';
import { drawItem, drawFloor, drawWalls } from './furniture.ts';
import { createCity } from './city.ts';
import { clampCamera, spreadLabels, startZoom, hitTest, inViewport, letterClusters, pickItem, sceneToScreen, screenToFloor, screenToScene, sortDrawables, viewportRect, type Camera, type Point, type Rect } from './projection.ts';
import { TILE, PERSON_FRAMES, dirOf, type ActorView, type CityOptions, type CityScene, type DrawPerson, type DrawItem, type DrawFloor, type DrawWalls, type Drawable, type Light, type PersonAction, type PixelBuffer, type SignText } from './types.ts';

export interface PixelArt {
  drawPerson: DrawPerson; drawItem: DrawItem; drawFloor: DrawFloor; drawWalls: DrawWalls;
  createCity?: (options: CityOptions) => CityScene;
}
/** The art the office is drawn with: people.ts, furniture.ts and city.ts in production, any stand-ins a test passes in. */
export function defaultArt(): PixelArt { return { drawPerson, drawItem, drawFloor, drawWalls, createCity }; }
interface Callbacks { onPan(): void; onError?(error: unknown): void }
interface FrameState {
  actors: ActorView[]; attention: Record<string, Attention>; activeDesks: Set<string>;
  dark: boolean; raining: boolean; alarm: boolean; follow: boolean; covered: boolean;
}
interface Flight { from: { x: number; z: number }; to: { x: number; z: number }; text: string; elapsed: number; done?: () => void }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string }
type ObjectDrawable = Drawable & { person?: boolean };
/** A room's name plaque hangs just under its south edge, clear of the furniture and glass inside. */
const ZONE_PLAQUE_Y = 2;
const TONES = { alert: '#ef4444', warn: '#f59e0b', info: '#3b82f6' };

/** Drawing and pointer projection only. World owns routing, keys and all simulation decisions. */
export class PixelView {
  readonly canvas = document.createElement('canvas');
  private readonly textCanvas = document.createElement('canvas');
  private readonly nightCanvas = document.createElement('canvas');
  private readonly overlay = document.createElement('div');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly text: CanvasRenderingContext2D;
  private readonly night: CanvasRenderingContext2D;
  private readonly images = new WeakMap<PixelBuffer, HTMLCanvasElement>();
  private readonly observer: ResizeObserver;
  private readonly events = new AbortController();
  private size = { w: 1, h: 1 };
  private camera: Camera = { x: 0, y: 0, zoom: 3 };
  private target: Point | null = null;
  private bounds: Rect = { x: -64, y: -64, w: 128, h: 128 };
  private office?: Office;
  private city?: CityScene;
  private cityKey = '';
  private readonly itemDraws = new WeakMap<OfficeItem, { key: string; list: Drawable[] }>();
  private readonly lightImages = new Map<string, HTMLCanvasElement>();
  private readonly clusters = new Map<string, string[]>();
  private floor?: Drawable;
  private walls: Drawable[] = [];
  private actors: ActorView[] = [];
  private readonly labels = new Set<HTMLElement>();
  private readonly gestures = new Map<string, { action: PersonAction; start: number; end: number }>();
  private readonly flights: Flight[] = [];
  private readonly particles: Particle[] = [];
  private time = 0;
  private spent = 0;
  private counted = 0;
  private frames = 0;
  private autoZoom = false;
  private readonly labelSizes = new WeakMap<HTMLElement, { w: number; h: number }>();
  private lastDark?: boolean;

  constructor(private readonly container: HTMLElement, private readonly art: PixelArt, callbacks: Callbacks) {
    const context = this.canvas.getContext('2d'), text = this.textCanvas.getContext('2d'), night = this.nightCanvas.getContext('2d');
    if (!context || !text || !night) throw new Error('Canvas 2D unavailable');
    this.ctx = context; this.text = text; this.night = night;
    this.canvas.className = 'pixel-scene'; this.textCanvas.className = 'pixel-text';
    this.camera.zoom = container.clientWidth < 900 ? 1 : container.clientWidth >= 2200 ? 3 : 2;
    Object.assign(this.canvas.style, { position: 'absolute', left: '0', top: '0', imageRendering: 'pixelated', touchAction: 'none' });
    Object.assign(this.textCanvas.style, { position: 'absolute', inset: '0', pointerEvents: 'none', width: '100%', height: '100%' });
    Object.assign(this.overlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
    this.overlay.className = 'labels pixel-labels';
    this.container.append(this.canvas, this.textCanvas, this.overlay);
    const signal = this.events.signal;
    let down: Point | null = null, last: Point | null = null, panned = false;
    this.canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      panned = false; down = last = { x: e.clientX, y: e.clientY }; this.canvas.setPointerCapture(e.pointerId);
    }, { signal });
    this.canvas.addEventListener('pointermove', e => {
      if (!down || !last || (!panned && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6)) return;
      panned = true;
      this.camera.x -= (e.clientX - last.x) / this.camera.zoom;
      this.camera.y -= (e.clientY - last.y) / this.camera.zoom;
      last = { x: e.clientX, y: e.clientY }; this.target = null; callbacks.onPan(); this.clamp();
    }, { signal });
    const release = (e: PointerEvent) => { if (panned) e.preventDefault(); down = last = null; panned = false; };
    this.canvas.addEventListener('pointerup', release, { signal });
    this.canvas.addEventListener('pointercancel', release, { signal });
    let wheelAt = 0;
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      // One step per gesture: a trackpad swipe sends dozens of events.
      if (e.timeStamp - wheelAt < 180) return;
      wheelAt = e.timeStamp;
      this.autoZoom = false;
      this.camera.zoom = Math.max(1, Math.min(4, this.camera.zoom + (e.deltaY < 0 ? 1 : -1)));
      this.resize();
    }, { passive: false, signal });
    this.observer = new ResizeObserver(() => {
      try { this.resize(); } catch (error) { if (callbacks.onError) callbacks.onError(error); else throw error; }
    });
    try { this.observer.observe(container); this.resize(); }
    catch (error) { this.dispose(); throw error; }
  }

  resize() {
    this.size = { w: Math.max(1, this.container.clientWidth), h: Math.max(1, this.container.clientHeight) };
    // The container may still be unsized when the office arrives: the start zoom waits for a real width.
    if (this.autoZoom && this.office && this.size.w > 1) { this.camera.zoom = startZoom(this.size.w, this.office.width * TILE); this.autoZoom = false; }
    this.canvas.width = Math.ceil(this.size.w / this.camera.zoom); this.canvas.height = Math.ceil(this.size.h / this.camera.zoom);
    this.canvas.style.width = `${this.canvas.width * this.camera.zoom}px`; this.canvas.style.height = `${this.canvas.height * this.camera.zoom}px`;
    const dpr = window.devicePixelRatio || 1;
    this.textCanvas.width = Math.ceil(this.size.w * dpr); this.textCanvas.height = Math.ceil(this.size.h * dpr);
    this.text.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.nightCanvas.width = this.canvas.width; this.nightCanvas.height = this.canvas.height;
    this.ctx.imageSmoothingEnabled = false; this.clamp();
  }
  private clamp() { this.camera = clampCamera(this.camera, this.size, this.bounds); }
  setOffice(office: Office) {
    const first = !this.office;
    this.office = office;
    const cityKey = `${office.name}|${office.width}|${office.depth}`;
    // Renaming a room or moving a desk must not restart the street's cars and walkers.
    if (cityKey !== this.cityKey) {
      this.cityKey = cityKey;
      this.city = this.art.createCity?.({ width: office.width, depth: office.depth, name: office.name, seed: [...office.name].reduce((s, c) => Math.imul(s, 31) + c.charCodeAt(0), 0) >>> 0 });
    }
    this.bounds = this.city?.bounds() ?? { x: -64, y: -64, w: office.width * TILE + 128, h: office.depth * TILE + 160 };
    if (first) {
      this.camera.x = office.width * TILE / 2; this.camera.y = office.depth * TILE / 2;
      // Start as close as still shows the office's whole width: a small office is not left tiny in a big window.
      this.autoZoom = true;
      this.resize();
    }
    this.lastDark = undefined; this.clamp();
  }
  focus(x: number, z: number) { this.target = { x: x * TILE, y: z * TILE }; }
  followPlayer() { this.target = null; }
  floorCell(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    return screenToFloor({ x: e.clientX - rect.left, y: e.clientY - rect.top }, this.camera, this.size);
  }
  pick(e: MouseEvent, group: 'actors' | 'items'): { agentId?: string; itemId?: string; zoneId?: string } | null {
    const rect = this.canvas.getBoundingClientRect();
    const p = screenToScene({ x: e.clientX - rect.left, y: e.clientY - rect.top }, this.camera, this.size);
    if (group === 'actors') { const actor = hitTest(this.actors, p.x, p.y); return actor ? { agentId: actor.id } : null; }
    // Zone labels sit above the floor; keep this hit box in step with the SignText anchor.
    for (const item of this.office?.items ?? []) if (item.type === 'zone' && item.label) {
      const c = center(item), halfWidth = Math.max(16, item.label.length * 3);
      if (Math.abs(p.x - c.x * TILE) < halfWidth && Math.abs(p.y - ((item.z + (item.d ?? 1)) * TILE + ZONE_PLAQUE_Y)) < 6) return { zoneId: item.id };
    }
    return pickItem(this.office?.items ?? [], p.x, p.y);
  }
  flight(from: { x: number; z: number }, to: { x: number; z: number }, text: string, done?: () => void) { this.flights.push({ from, to, text, done, elapsed: 0 }); }
  confetti(x: number, z: number) {
    const colors = ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'];
    for (let i = 0; i < 12; i++) this.particles.push({ x: x * TILE, y: z * TILE - 20, vx: (Math.random() - .5) * 55, vy: -25 - Math.random() * 30, life: 1.2 + Math.random(), color: colors[i % colors.length]! });
  }
  private image(buf: PixelBuffer) {
    let cv = this.images.get(buf);
    if (!cv) {
      cv = document.createElement('canvas'); cv.width = buf.w; cv.height = buf.h;
      cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(buf.toBytes()), buf.w, buf.h), 0, 0); this.images.set(buf, cv);
    }
    return cv;
  }
  private pose(actor: ActorView): { action: PersonAction; dir: ReturnType<typeof dirOf>; frame: number; umbrella: boolean } {
    const action = actor.gesture ?? (actor.moving ? actor.running ? 'run' : 'walk' : actor.pose === 'sit' ? actor.working ? 'type' : 'sit' : 'stand');
    let frame: number;
    if (actor.gesture) {
      let g = this.gestures.get(actor.id);
      // Triggering the same gesture again moves its end: the animation starts over instead of holding its last frame.
      const end = actor.gestureEnd ?? 0;
      if (!g || g.action !== action || end - g.end > 50) { g = { action, start: this.time, end }; this.gestures.set(actor.id, g); }
      const window = { kick: .46, throw: .52, wave: .72, dance: 2.6, flinch: .42 }[actor.gesture];
      frame = Math.min(PERSON_FRAMES[action] - 1, Math.floor((this.time - g.start) / window * PERSON_FRAMES[action]));
    } else {
      this.gestures.delete(actor.id);
      // Each person keeps their own beat, or 48 people would step in lockstep.
      let phase = 0; for (const ch of actor.id) phase = (phase * 31 + ch.charCodeAt(0)) % 997;
      frame = Math.floor((this.time + phase / 997 * 2) * (action === 'run' ? 12 : action === 'walk' ? 8 : action === 'type' ? 6 : 1.5)) % PERSON_FRAMES[action];
    }
    return { action, dir: dirOf(actor.facing), frame, umbrella: actor.umbrella };
  }
  /** Call even while covered: flight completion callbacks belong to the ongoing simulation. */
  frame(dt: number, state: FrameState) {
    const started = performance.now();
    this.draw(dt, state);
    // Average cost of a frame over the last 120, readable from outside (QA): canvas.dataset.frameMs.
    this.spent += performance.now() - started;
    if (++this.counted === 120) { this.canvas.dataset.frameMs = (this.spent / 120).toFixed(2); this.spent = 0; this.counted = 0; }
  }
  private draw(dt: number, state: FrameState) {
    this.time += dt; this.actors = state.actors;
    this.city?.update(dt);
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i]!; f.elapsed += dt;
      if (f.elapsed >= 1.1) { this.flights.splice(i, 1); f.done?.(); }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!; p.life -= dt; p.vy += dt * 60; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    this.overlay.style.visibility = state.covered ? 'hidden' : '';
    if (state.covered || !this.office) return;
    const player = state.actors.find(a => a.kind === 'player');
    const target = this.target ?? (state.follow && player ? { x: player.x * TILE, y: player.z * TILE } : null);
    if (target) { const k = Math.min(1, dt * 5); this.camera.x += (target.x - this.camera.x) * k; this.camera.y += (target.y - this.camera.y) * k; }
    this.clamp();
    const office = this.office, ctx = this.ctx, view = viewportRect(this.camera, this.size);
    const point = (x: number, y: number) => ({ x: Math.round(x - view.x), y: Math.round(y - view.y) });
    const draw = (d: Drawable) => { if (!inViewport(d, view)) return; const p = point(d.x - d.sprite.ax, d.y - d.sprite.ay); ctx.drawImage(this.image(d.sprite.buf), p.x, p.y); };
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); ctx.fillStyle = '#343b49'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.lastDark !== state.dark) {
      // An office saved without colours gets the defaults the settings form shows.
      this.floor = this.art.drawFloor(office.width, office.depth, office.floorColor.trim() || '#f6f7f9', state.dark);
      this.walls = this.art.drawWalls(office.width, office.depth, office.wallColor.trim() || '#ffffff', 2, state.dark); this.lastDark = state.dark;
    }
    if (this.floor) draw(this.floor);
    const city = this.city?.frame(state.dark, state.raining);
    const ground: Drawable[] = [], objects: ObjectDrawable[] = [...this.walls];
    const lights: Light[] = [...(city?.lights ?? [])], signs: SignText[] = [...(city?.signs ?? [])];
    const add = (d: Drawable) => (d.layer === 'ground' ? ground : objects).push(d);
    for (const d of city?.drawables ?? []) add(d);
    const slow = Math.floor(this.time * 2) & 1;
    for (const item of office.items) {
      // A stale item of a type this build does not know is skipped, not a reason to lose the whole view.
      if (!Object.hasOwn(CATALOG, item.type)) continue;
      const activeSeats = item.type === 'teamdesk' ? (item.seats ?? []).filter(seat => state.activeDesks.has(seat.id)).map(seat => seat.id) : [];
      const active = item.type !== 'teamdesk' && state.activeDesks.has(item.id!);
      const key = `${state.dark ? 1 : 0}|${slow}|${active ? 1 : 0}|${activeSeats.join('+')}`;
      let cached = this.itemDraws.get(item);
      if (!cached || cached.key !== key) { cached = { key, list: this.art.drawItem(item, { dark: state.dark, frame: slow, active, activeSeats }) }; this.itemDraws.set(item, cached); }
      for (const d of cached.list) add(d);
      const c = center(item);
      if ((active && item.type !== 'teamdesk') || item.type === 'lamp') lights.push({ x: c.x * TILE, y: c.z * TILE - 8, radius: active ? 24 : 40, color: active ? '#5fd3ff' : '#ffe9a0', strength: .7 });
      if (item.type === 'teamdesk') for (const seat of item.seats ?? []) if (state.activeDesks.has(seat.id)) {
        lights.push({ x: (item.x + seat.dx + Math.sin(seat.face) * .4) * TILE, y: (item.z + seat.dz + Math.cos(seat.face) * .4) * TILE - 8, radius: 24, color: '#5fd3ff', strength: .7 });
      }
      if (item.type === 'zone' && item.label) signs.push({ text: item.label, x: c.x * TILE, y: (item.z + (item.d ?? 1)) * TILE + ZONE_PLAQUE_Y, size: 5, color: '#f4f1ea', plate: state.dark ? 'rgba(13,11,22,.78)' : 'rgba(58,51,70,.82)' });
    }
    for (const d of ground) draw(d);
    const ring = (a: ActorView, color: string, radius: number) => {
      const p = point(a.x * TILE, a.z * TILE); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(p.x, p.y, radius, radius / 2, 0, 0, Math.PI * 2); ctx.stroke();
    };
    for (const actor of state.actors) {
      if (actor.selected || actor.kind === 'player') ring(actor, actor.look.top, 7);
      const attention = state.attention[actor.id]; if (attention) ring(actor, TONES[attention.tone], 9 + (attention.tone === 'alert' ? Math.sin(this.time * 4) : 0));
      objects.push({ sprite: this.art.drawPerson(actor.look, this.pose(actor)), x: actor.x * TILE, y: actor.z * TILE, sortY: actor.z * TILE, layer: 'object', person: true });
    }
    for (const d of sortDrawables(objects)) draw(d);
    // Effects sit above objects and under night lighting.
    for (const p of this.particles) { const s = point(p.x, p.y); ctx.fillStyle = p.color; ctx.fillRect(s.x, s.y, 2, 2); }
    for (const f of this.flights) {
      const k = f.elapsed / 1.1;
      const p = point((f.from.x + (f.to.x - f.from.x) * k) * TILE, (f.from.z + (f.to.z - f.from.z) * k) * TILE - 20 - Math.sin(k * Math.PI) * 20);
      ctx.font = '10px "Segoe UI Emoji", Tahoma, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff'; ctx.fillText(f.text, p.x, p.y);
    }
    if (state.raining) {
      ctx.strokeStyle = '#9fd8f080'; ctx.beginPath();
      for (let i = 0; i < 120; i++) { const x = (i * 67 + this.time * 13) % this.canvas.width, y = (i * 43 + this.time * 140) % this.canvas.height; ctx.moveTo(x, y); ctx.lineTo(x - 1, y + 4); } ctx.stroke();
    }
    if (state.alarm) { ctx.fillStyle = `rgba(220,30,40,${.12 + .1 * Math.sin(this.time * 9)})`; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); }
    if (state.dark) {
      const n = this.night; n.globalCompositeOperation = 'source-over'; n.clearRect(0, 0, this.nightCanvas.width, this.nightCanvas.height);
      n.fillStyle = '#0d0b16a6'; n.fillRect(0, 0, this.nightCanvas.width, this.nightCanvas.height); n.globalCompositeOperation = 'destination-out';
      { // The office keeps its ceiling lights on: the floor area is only slightly dimmed.
        const a = point(0, -24), w = office.width * TILE, h = office.depth * TILE + 24;
        n.fillStyle = 'rgba(0,0,0,.82)'; n.fillRect(a.x, a.y, w, h);
      }
      const seen = lights.filter(l => l.x + l.radius > view.x && l.x - l.radius < view.x + view.w && l.y + l.radius > view.y && l.y - l.radius < view.y + view.h);
      for (const light of seen) {
        const p = point(light.x, light.y);
        n.globalAlpha = Math.min(1, light.strength); n.drawImage(this.lightImage('#000000', light.radius), p.x - light.radius, p.y - light.radius);
      }
      n.globalAlpha = 1;
      ctx.drawImage(this.nightCanvas, 0, 0);
      ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = .16;
      for (const light of seen) { const p = point(light.x, light.y); ctx.drawImage(this.lightImage(light.color, light.radius), p.x - light.radius, p.y - light.radius); }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    this.text.clearRect(0, 0, this.size.w, this.size.h);
    for (const sign of signs) this.sign(sign);
    const live = new Set<HTMLElement>();
    const shown: { label: HTMLElement; x: number; y: number; w: number; h: number }[] = [];
    // Tag sizes change rarely (a status dot, a speech line): measured every 15th frame, not every frame.
    const measure = this.frames++ % 15 === 0;
    for (const actor of state.actors) {
      const label = actor.label; if (!label) continue;
      live.add(label); this.labels.add(label); if (label.parentElement !== this.overlay) this.overlay.append(label);
      const p = sceneToScreen({ x: actor.x * TILE, y: actor.z * TILE - 26 }, this.camera, this.size);
      label.style.position = 'absolute'; label.style.left = '0'; label.style.top = '0'; label.style.zIndex = String(Math.max(0, Math.round(actor.z * TILE)));
      const hidden = p.x < -150 || p.x > this.size.w + 150 || p.y < -150 || p.y > this.size.h + 150;
      label.style.display = hidden ? 'none' : '';
      if (hidden) continue;
      let size = this.labelSizes.get(label);
      if (!size || measure) { size = { w: label.offsetWidth || 40, h: label.offsetHeight || 18 }; this.labelSizes.set(label, size); }
      shown.push({ label, x: Math.round(p.x), y: Math.round(p.y), ...size });
    }
    // People standing together: their tags are moved apart instead of piling up.
    const ys = spreadLabels(shown);
    shown.forEach((tag, i) => { tag.label.style.transform = `translate(${tag.x}px,${ys[i]}px) translate(-50%,-100%)`; });
    for (const label of this.labels) if (!live.has(label)) { label.remove(); this.labels.delete(label); }
    for (const id of this.gestures.keys()) if (!state.actors.some(a => a.id === id)) this.gestures.delete(id);
  }
  /** A soft round light, drawn once per colour and size. */
  private lightImage(color: string, radius: number) {
    const r = Math.max(1, Math.round(radius)), key = `${color}|${r}`;
    let cv = this.lightImages.get(key);
    if (!cv) {
      cv = document.createElement('canvas'); cv.width = cv.height = r * 2;
      const c = cv.getContext('2d')!, g = c.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, color); g.addColorStop(1, 'transparent'); c.fillStyle = g; c.fillRect(0, 0, r * 2, r * 2);
      this.lightImages.set(key, cv);
    }
    return cv;
  }
  /** Letter clusters of a vertical sign: a Thai vowel or tone mark stays with its consonant. */
  private clustersOf(text: string) {
    let parts = this.clusters.get(text);
    if (!parts) { parts = letterClusters(text); this.clusters.set(text, parts); }
    return parts;
  }
  private sign(sign: SignText) {
    const p = sceneToScreen(sign, this.camera, this.size), ctx = this.text;
    if (p.x < -400 || p.x > this.size.w + 400 || p.y < -400 || p.y > this.size.h + 400) return;
    const height = Math.max(9, sign.size * this.camera.zoom);
    ctx.font = `600 ${height}px ${sign.font === 'mono' ? 'monospace' : '"Noto Sans Thai", Tahoma, sans-serif'}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = sign.color;
    if (sign.plate && !sign.vertical) {
      const w = ctx.measureText(sign.text).width + height * .9, h = height * 1.45;
      ctx.shadowBlur = 0; ctx.fillStyle = sign.plate; ctx.beginPath(); ctx.roundRect(Math.round(p.x - w / 2), Math.round(p.y - h / 2), Math.round(w), Math.round(h), h * .3); ctx.fill();
      ctx.fillStyle = sign.color;
    }
    ctx.shadowColor = sign.glow ?? 'transparent'; ctx.shadowBlur = sign.glow ? height * .6 : 0;
    if (sign.vertical) {
      const parts = this.clustersOf(sign.text);
      parts.forEach((part, i) => ctx.fillText(part, Math.round(p.x), Math.round(p.y + (i - (parts.length - 1) / 2) * height * 1.15)));
    } else ctx.fillText(sign.text, Math.round(p.x), Math.round(p.y));
    ctx.shadowBlur = 0;
  }
  dispose() {
    this.events.abort(); this.observer.disconnect();
    for (const label of this.labels) { label.style.transform = ''; label.style.display = ''; label.style.zIndex = ''; }
    for (const flight of this.flights) flight.done?.();
    this.overlay.remove(); this.canvas.remove(); this.textCanvas.remove();
    this.flights.length = 0; this.particles.length = 0; this.gestures.clear(); this.labels.clear();
    this.city = undefined; this.office = undefined; this.actors = []; this.walls = []; this.floor = undefined;
  }
}

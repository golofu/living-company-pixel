import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AWNINGS, CART_POOL, City, SHOP_POOL, WARM, createCity, vehicleSprite } from './city.ts';
import { drawPerson } from './people.ts';
import { PixelBuffer, TILE, rgba, type CityFrame, type Drawable } from './types.ts';

const options = { width: 26, depth: 18, name: 'Gen AI Space', seed: 41 };
const W = options.width * TILE, H = options.depth * TILE;
const tagged = (f: CityFrame, kind: string) => f.drawables.filter(d => (d as Drawable & { kind: string }).kind === kind);
const positions = (f: CityFrame) => f.drawables.map(d => [d.x, d.y]);
const city = () => new City(options);
const leading = /[เ-ไ]/;
const graphemes = (s: string) => [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(s)].length;

/** Static scene (ground, buildings, props, carts) laid into one buffer the size of the bounds, the way the view stacks it. */
function composeStatic(c: City, dark: boolean, wet = false) {
  const b = c.bounds(), out = new PixelBuffer(b.w, b.h), f = c.frame(dark, wet);
  const still = f.drawables.filter(d => ['ground', 'building', 'prop', 'cart'].includes((d as Drawable & { kind: string }).kind));
  for (const d of [...still.filter(d => d.layer === 'ground'), ...still.filter(d => d.layer === 'object').sort((a, b) => a.sortY - b.sortY)]) out.blit(d.sprite.buf, Math.round(d.x - d.sprite.ax - b.x), Math.round(d.y - d.sprite.ay - b.y));
  return { out, b };
}
/** Side of the biggest square of one colour (transparent pixels, the office, never count). */
function biggestFlatSquare(buf: PixelBuffer) {
  let best = 0, prev = new Int16Array(buf.w + 1), at: [number, number] = [0, 0];
  for (let y = 0; y < buf.h; y++) {
    const row = new Int16Array(buf.w + 1);
    for (let x = 0; x < buf.w; x++) {
      const c = buf.data[y * buf.w + x]!;
      if (!(c & 255)) continue;
      const same = x > 0 && y > 0 && buf.data[y * buf.w + x - 1] === c && buf.data[(y - 1) * buf.w + x] === c && buf.data[(y - 1) * buf.w + x - 1] === c;
      row[x + 1] = same ? Math.min(row[x]!, prev[x + 1]!, prev[x]!) + 1 : 1;
      if (row[x + 1]! > best) { best = row[x + 1]!; at = [x, y]; }
    }
    prev = row;
  }
  return { best, at };
}

test('bounds contains office and extends on every side; factory obeys contract', () => {
  const b = createCity(options).bounds();
  assert.ok(b.x < 0 && b.y <= -150 && b.x + b.w > W && b.y + b.h > H + 8 * TILE);
});
test('real frames contain a crowd of about 45, fourteen vehicles, four carts and vendors', () => {
  const f = city().frame(true, false);
  assert.equal(tagged(f, 'walker').length, 30); assert.equal(tagged(f, 'customer').length, 16); assert.equal(tagged(f, 'vendor').length, 4);
  assert.ok(tagged(f, 'walker').length + tagged(f, 'customer').length >= 45);
  assert.equal(tagged(f, 'vehicle').length, 14); assert.equal(tagged(f, 'cart').length, 4);
  for (const d of f.drawables) assert.ok(d.sprite.buf.filled() > 0);
});
test('walkers and vehicles change positions; Thai left-hand traffic: upper lane moves right, lower lane left', () => {
  // Heading east (+x) a driver's left is north, i.e. the upper lane (nearer the office) carries +x and the lower lane -x.
  const c = city(), a = c.frame(false, false); c.update(1); const b = c.frame(false, false);
  for (const kind of ['walker', 'vehicle']) {
    const before = tagged(a, kind), after = tagged(b, kind);
    assert.ok(after.filter((d, i) => d.x !== before[i]!.x || d.y !== before[i]!.y).length >= (kind === 'walker' ? 14 : 8));
  }
  tagged(b, 'vehicle').forEach((v, i) => { const prev = tagged(a, 'vehicle')[i]!; assert.ok(v.y < H + 96 ? v.x >= prev.x : v.x <= prev.x); });
  assert.equal(tagged(a, 'vehicle').filter(v => v.y < H + 96).length, 7);
});
test('500 updates keep every moving base in bounds and outside office/door approach', () => {
  const c = city(), b = c.bounds();
  for (let i = 0; i < 500; i++) {
    c.update(1);
    const f = c.frame(false, false);
    for (const d of [...tagged(f, 'walker'), ...tagged(f, 'vehicle'), ...tagged(f, 'customer'), ...tagged(f, 'parked')]) {
      assert.ok(d.x >= b.x && d.x < b.x + b.w && d.y >= b.y && d.y < b.y + b.h);
      assert.ok(!(d.x >= 0 && d.x <= W && d.y >= 0 && d.y <= H));
      assert.ok(!(Math.abs(d.x - W / 2) <= TILE / 2 && d.y > H && d.y < H + TILE));
      assert.equal(d.sortY, d.y);
    }
  }
});
test('same seed and dt sequence reproduce positions and pixel buffers', () => {
  const a = city(), b = city();
  for (const dt of [.1, .4, 2, .017, 1.5]) { a.update(dt); b.update(dt); }
  for (const dark of [false, true]) for (const wet of [false, true]) {
    const af = a.frame(dark, wet), bf = b.frame(dark, wet);
    assert.deepEqual(positions(af), positions(bf)); assert.deepEqual(af.signs, bf.signs); assert.deepEqual(af.lights, bf.lights);
    af.drawables.forEach((d, i) => assert.deepEqual(d.sprite.buf.data, bf.drawables[i]!.sprite.buf.data));
  }
});
test('seed changes shops/theme; company name and eight original shop signs survive', () => {
  const a = city().frame(true, false), b = new City({ ...options, seed: 42 }).frame(true, false);
  const known = new Set(SHOP_POOL.flatMap(p => [p.full, p.short]));
  assert.ok(a.signs.some(s => s.text === options.name)); assert.ok(a.signs.filter(s => s.vertical).length >= 1);
  const shops = a.signs.filter(s => known.has(s.text));
  assert.equal(shops.length, 8); assert.equal(new Set(shops.map(s => s.text)).size, 8);
  assert.notDeepEqual(a.signs.map(s => [s.text, s.color]), b.signs.map(s => [s.text, s.color]));
  assert.ok(a.lights.length >= 60 && a.lights.every(l => l.radius > 0 && l.strength > 0));
});
test('rain changes all pedestrian umbrellas and adds opaque puddle pixels', () => {
  const c = city(), dry = c.frame(true, false), wet = c.frame(true, true);
  for (const kind of ['walker', 'vendor', 'customer']) tagged(dry, kind).forEach((d, i) => { const umbrella = tagged(wet, kind)[i]!.sprite; assert.notEqual(d.sprite, umbrella); assert.ok(umbrella.buf.h > d.sprite.buf.h); });
  assert.notDeepEqual(tagged(dry, 'ground')[0]!.sprite.buf.data, tagged(wet, 'ground')[0]!.sprite.buf.data);
});
test('ground fully covers south band; office interior pixels remain transparent', () => {
  const c = city();
  for (const dark of [false, true]) for (const wet of [false, true]) {
    const d = tagged(c.frame(dark, wet), 'ground')[0]!, b = d.sprite.buf;
    for (let y = H; y < c.bounds().y + c.bounds().h; y++) for (let x = c.bounds().x; x < c.bounds().x + c.bounds().w; x++) assert.equal(b.get(x - d.x, y - d.y) & 255, 255);
    for (const [x, y] of [[0, 0], [W / 2, H / 2], [W - 1, H - 1]]) assert.equal(b.get(x! - d.x, y! - d.y), 0);
  }
});
test('static buffers are reused across frames, including weather switches', () => {
  const c = city(), a = c.frame(true, true); c.update(.4); const b = c.frame(true, true);
  for (const kind of ['ground', 'building', 'cart', 'prop', 'parked']) tagged(a, kind).forEach((d, i) => assert.equal(d.sprite, tagged(b, kind)[i]!.sprite));
  assert.ok(c.frame(false, false).signs.every(s => !s.glow));
});
test('five vehicle kinds with distinct silhouettes, animated wheels and a rider who sits on the scooter', () => {
  const c = city(), f = c.frame(false, false), cars = tagged(f, 'vehicle'), kinds = c.vehicleKinds();
  assert.deepEqual([...new Set(kinds)].sort(), [0, 1, 2, 3, 4]);
  const mask = (d: Drawable) => JSON.stringify([...d.sprite.buf.data].map(p => p & 255 ? 1 : 0));
  const byKind = new Map<number, Set<string>>();
  cars.forEach((d, i) => { if (d.y < H + 96) { const s = byKind.get(kinds[i]!) ?? new Set(); s.add(mask(d)); byKind.set(kinds[i]!, s); } });
  assert.equal(new Set([...byKind.values()].map(s => [...s][0])).size, 5, 'one silhouette per kind');
  const sprites = new Set(cars.map(d => d.sprite));
  for (let i = 0; i < 10; i++) { c.update(.07); tagged(c.frame(false, false), 'vehicle').forEach(d => sprites.add(d.sprite)); }
  assert.ok(sprites.size >= 16, 'both wheel frames of every look');
  // The rider wears an unmistakable green; its torso must sit over the seat, above the floorboard and between the wheels.
  const look = { sex: 'f', outfit: 'casual', hair: 'short', hairColor: '#211918', skin: '#d8aa82', glasses: false, top: '#12e034', inner: '#12e034', bottom: '#303442', shoes: '#24232c' } as const;
  const s = vehicleSprite(3, rgba('#d8262d'), 1, 0, drawPerson(look, { action: 'sit', dir: 'right', frame: 0 }));
  let x0 = 99, x1 = -1, y0 = 99, y1 = -1;
  for (let y = 0; y < s.buf.h; y++) for (let x = 0; x < s.buf.w; x++) { const p = s.buf.get(x, y); if ((p >>> 24) < 100 && (p >>> 16 & 255) > 150 && (p >>> 8 & 255) < 130 && (p & 255) === 255) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
  assert.ok(x1 >= 0, 'rider torso found');
  assert.ok(x0 >= 14 && x1 <= 42, `torso x ${x0}-${x1} lies between the wheels`);
  assert.ok(y1 >= 22 && y1 <= 30 && y0 <= 24, `torso y ${y0}-${y1} reaches the seat and stays above the floorboard`);
  assert.ok(y1 < 34, 'rider does not hang below the body');
});
test('cars slow to a stop before occupied zebra crossing and resume afterwards', () => {
  const c = city(); let stops = 0, resumed = false; const stopped = new Set<number>();
  let prev = tagged(c.frame(false, false), 'vehicle');
  for (let i = 0; i < 900; i++) {
    c.update(.1); const f = c.frame(false, false), now = tagged(f, 'vehicle');
    const occupied = tagged(f, 'walker').some(d => Math.abs(d.x - W / 2) < 20 && d.y > H + 51 && d.y < H + 144);
    now.forEach((v, j) => { const delta = Math.abs(v.x - prev[j]!.x); if (occupied && Math.abs(Math.abs(v.x - W / 2) - 55) < 1 && delta < .02) { stops++; stopped.add(j); } if (stopped.has(j) && delta > 1) resumed = true; });
    prev = now;
  }
  assert.ok(stops > 0); assert.ok(resumed);
});
test('a traffic light stands at the crossing and shows red while people cross', () => {
  const c = city(), signalAt = (f: CityFrame) => tagged(f, 'signal');
  const green = signalAt(c.frame(false, false)); assert.equal(green.length, 2);
  let sawRed = false;
  for (let i = 0; i < 400 && !sawRed; i++) { c.update(.1); const now = signalAt(c.frame(false, false)); if (now[0]!.sprite !== green[0]!.sprite) sawRed = true; }
  assert.ok(sawRed, 'the light changes while the crossing is in use');
  assert.ok(c.frame(true, false).lights.some(l => (l.color === '#ff3b3b' || l.color === '#3dff9a') && l.radius === 16));
});
test('nonfinite/negative elapsed times leave simulation unchanged', () => {
  const c = city(), before = positions(c.frame(false, false));
  for (const dt of [-1, NaN, Infinity, 0]) c.update(dt);
  assert.deepEqual(positions(c.frame(false, false)), before);
});

test('bounds cover every sprite of a deep office', () => {
  const city = new City({ width: 30, depth: 40, name: 'Deep', seed: 7 });
  const b = city.bounds();
  for (const d of city.frame(false, false).drawables) assert.ok(d.y - d.sprite.ay >= b.y, `sprite top ${d.y - d.sprite.ay} is above the bounds top ${b.y}`);
});

test('vertical signs have no word that starts with a leading vowel, for every seed tried', () => {
  for (const seed of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
    const frame = new City({ width: 26, depth: 18, name: 'Signs', seed }).frame(true, false);
    for (const sign of frame.signs) if (sign.vertical) assert.doesNotMatch(sign.text, leading, sign.text);
  }
  for (const p of SHOP_POOL) { assert.doesNotMatch(p.short, leading, p.short); assert.ok(graphemes(p.short) <= 6, p.short); }
});

test('lantern lights are big, warm and sit on the lanterns, below the top of their string', () => {
  const city = new City({ width: 26, depth: 18, name: 'Lights', seed: 3 });
  const lanternLights = city.frame(true, false).lights.filter(l => l.color === '#ff9b3d' && l.radius === 30 && l.strength === .85);
  assert.ok(lanternLights.length > 0);
  for (const l of lanternLights) assert.ok(l.y >= 18 * 16, `lantern light at y=${l.y} floats above the string at ${18 * 16}`);
});

// ---- the reviewed defects ----

test('no large flat block of one colour is left in bounds outside the office (day, night, rain)', () => {
  for (const seed of [41, 42, 7]) {
    const c = new City({ ...options, seed });
    for (const [dark, wet] of [[false, false], [true, false], [true, true]] as const) {
      const { out, b } = composeStatic(c, dark, wet), r = biggestFlatSquare(out);
      assert.ok(r.best < 48, `seed ${seed} dark=${dark}: a flat ${r.best}x${r.best} block ends at scene (${r.at[0] + b.x}, ${r.at[1] + b.y})`);
    }
  }
});

test('the corners above the first shops are filled by a back row of rooftops', () => {
  const c = city(), b = c.bounds(), f = c.frame(true, false);
  const back = f.drawables.filter(d => (d as Drawable & { id: string }).id.startsWith('back-'));
  assert.ok(back.length >= 12);
  // Every column of the corner strip (from the top of bounds down to the first shop roof) is covered by some back building.
  for (let x = Math.ceil(b.x); x < 0; x += 3) assert.ok(back.some(d => x >= d.x && x < d.x + d.sprite.buf.w && b.y + 30 >= d.y - d.sprite.ay && d.y > -99), `no back building at x=${x}`);
  for (let x = W; x < b.x + b.w; x += 3) assert.ok(back.some(d => x >= d.x && x < d.x + d.sprite.buf.w && d.y > -99), `no back building at x=${x}`);
  assert.ok(f.lights.some(l => l.y < -120), 'rooftop signs glow');
});

test('each cart sign sits on a dark plate above the awning, not on its stripes', () => {
  const c = city(), f = c.frame(true, false), carts = tagged(f, 'cart'), plate = rgba('#0d0b16');
  const names = new Set(CART_POOL.flat());
  const cartSigns = f.signs.filter(s => names.has(s.text));
  assert.equal(cartSigns.length, 4);
  cartSigns.forEach((s, i) => {
    const d = carts[i]!, top = d.y - d.sprite.ay, lx = s.x - d.x;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -16; dx <= 16; dx++) assert.equal(d.sprite.buf.get(lx + dx, s.y - top + dy), plate, `cart ${i} plate at ${dx},${dy}`);
    assert.ok(s.y + 3 < top + 10, 'the plate is above the awning');
  });
});

test('every shop has its own front: 2-4 windows, awning, sign shape and neon colour', () => {
  const specs = city().shopSpecs;
  assert.equal(specs.length, 8);
  assert.ok(new Set(specs.map(s => s.awning)).size >= 6 && AWNINGS.length >= 6);
  assert.equal(new Set(specs.map(s => s.sign)).size, 4);
  assert.ok(new Set(specs.map(s => s.neon)).size >= 5);
  assert.ok(new Set(specs.map(s => s.windows.length)).size >= 2);
  for (const s of specs) assert.ok(s.windows.length >= 2 && s.windows.length <= 4 * Math.max(1, Math.floor((s.h - 70) / 21)));
  assert.ok(new Set(specs.map(s => s.name.goods)).size >= 4);
  assert.ok(new Set(specs.map(s => `${s.ac}${s.laundry}${s.plants}${s.crates}${s.doorLeft}`)).size >= 4);
  const frame = city().frame(false, false);
  const shopSprites = frame.drawables.filter(d => (d as Drawable & { id: string }).id.startsWith('shop-')).map(d => JSON.stringify([...d.sprite.buf.data]));
  assert.equal(new Set(shopSprites).size, 8);
});

test('the name pool is big, original, and different streets get different shops', () => {
  assert.ok(SHOP_POOL.length >= 30);
  assert.equal(new Set(SHOP_POOL.map(p => p.full)).size, SHOP_POOL.length); assert.equal(new Set(SHOP_POOL.map(p => p.short)).size, SHOP_POOL.length);
  const sets = [41, 42, 43, 44].map(seed => new City({ ...options, seed }).shopSpecs.map(s => s.name.full).sort().join('|'));
  assert.equal(new Set(sets).size, 4);
  assert.equal(new Set([41, 42, 43, 44].flatMap(seed => new City({ ...options, seed }).shopSpecs.map(s => s.name.full))).size >= 20, true);
});

test('at night each window is lit or dark on its own, in three warm tints', () => {
  const seen = new Set<number>();
  for (const seed of [41, 42, 43, 44, 45]) {
    const c = new City({ ...options, seed }), night = c.frame(true, false);
    c.shopSpecs.forEach((s, i) => {
      const d = night.drawables.find(x => (x as Drawable & { id: string }).id === `shop-${i < 4 ? 0 : 1}-${i % 4}`)!;
      for (const w of s.windows) {
        seen.add(w.lit);
        const px = d.sprite.buf.get(s.inset + w.x + 3, w.y + 3);
        if (w.lit >= 0) assert.equal(px, rgba(WARM[w.lit]!), 'lit window shows its tint'); else assert.notEqual(px, rgba(WARM[0]!));
        const dark = (px >>> 24) + (px >>> 16 & 255) + (px >>> 8 & 255);
        if (w.lit < 0) assert.ok(dark < 250, 'dark window is dark');
      }
    });
  }
  assert.deepEqual([...seen].sort(), [-1, 0, 1, 2]);
});

test('the crowd has clusters of 3-5 at carts and at the crossing, and varied bright looks', () => {
  const c = city(), f = c.frame(false, false), customers = tagged(f, 'customer');
  for (const cx of [-77, W * .22, W * .78, W + 76]) assert.ok(customers.filter(d => Math.abs(d.x - cx) < 20).length >= 3);
  const waiting = tagged(f, 'walker').filter(d => Math.abs(d.x - W / 2) < 24 && Math.abs(d.y - (H + 45)) < 6);
  assert.ok(waiting.length >= 3 && waiting.length <= 10, `${waiting.length} people wait at the crossing`);
  const lum = (d: Drawable) => { let bright = 0; for (const p of d.sprite.buf.data) if (p & 255) { const l = ((p >>> 24) * 3 + (p >>> 16 & 255) * 5 + (p >>> 8 & 255)) / 9; if (l > 165) bright++; } return bright; };
  const walkers = tagged(f, 'walker');
  assert.ok(walkers.filter(d => lum(d) >= 14).length >= walkers.length * .6, 'most walkers are not dark blobs');
  assert.ok(new Set(walkers.map(d => JSON.stringify([...d.sprite.buf.data]))).size >= 14, 'looks are varied');
});

test('steam puffs rise over every cart and animate with update()', () => {
  const c = city(), a = tagged(c.frame(false, false), 'steam'); c.update(.5); const b = tagged(c.frame(false, false), 'steam');
  assert.equal(a.length, 12); assert.equal(b.length, 12);
  assert.ok(b.filter((d, i) => d.y !== a[i]!.y).length >= 10);
  assert.ok(new Set(b.map(d => d.sprite)).size >= 2);
});

test('parked scooters stand in a row at the kerb', () => {
  const p = tagged(city().frame(false, false), 'parked');
  assert.ok(p.length >= 8);
  assert.ok(p.every(d => d.y === H + 49));
  assert.ok(p.every(d => d.x < W / 2 - 25 || d.x > W / 2 + 25), 'none on the zebra');
});

test('night mood: coloured light smears under signs, puddles reflect neon, day stays clean', () => {
  const c = city(), night = c.frame(true, false), day = c.frame(false, false);
  assert.equal(day.lights.length, 0, 'day has no light layer');
  // each shop sign casts a second, lower pool of its own colour
  for (const s of c.shopSpecs.slice(0, 8)) assert.ok(night.lights.filter(l => l.color === s.neon).length >= 2, s.neon);
  const g = tagged(night, 'ground')[0]!.sprite.buf, d = tagged(day, 'ground')[0]!.sprite.buf, ox = -c.bounds().x, oy = -c.bounds().y;
  const avg = (buf: PixelBuffer, x0: number, x1: number, y: number) => { let gr = 0, n = 0; for (let x = x0; x < x1; x++) { const p = buf.get(x, y); gr += (p >>> 16 & 255) - (p >>> 24); n++; } return gr / n; };
  // the company sign is cyan for this seed: the ledge below it turns greener than the same ledge far from it
  assert.ok(avg(g, ox + W / 2 - 6, ox + W / 2 + 6, oy - 12) - avg(g, ox - 34, ox - 22, oy - 12) > 12, 'ground below the company sign is tinted');
  assert.notDeepEqual(g.data, d.data);
  const wetNight = tagged(c.frame(true, true), 'ground')[0]!.sprite.buf;
  let neonPixels = 0; for (let i = 0; i < g.data.length; i++) { const p = wetNight.data[i]!; if (p !== g.data[i] && Math.max(p >>> 24, p >>> 16 & 255, p >>> 8 & 255) - Math.min(p >>> 24, p >>> 16 & 255, p >>> 8 & 255) > 70) neonPixels++; }
  assert.ok(neonPixels > 200, `${neonPixels} coloured reflection pixels in the puddles`);
});

test('building a city and one frame stay cheap', () => {
  const t0 = performance.now(), c = city(), built = performance.now() - t0;
  const t1 = performance.now(); for (let i = 0; i < 100; i++) c.frame(i % 2 === 0, i % 3 === 0); const frame = (performance.now() - t1) / 100;
  assert.ok(built < 3000, `construct ${built.toFixed(0)} ms`); assert.ok(frame < 5, `frame ${frame.toFixed(2)} ms`);
});

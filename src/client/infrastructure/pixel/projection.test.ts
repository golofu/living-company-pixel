import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampCamera, spreadLabels, startZoom, hitTest, letterClusters, pickItem, inViewport, sceneToScreen, screenToFloor, screenToScene, sortDrawables } from './projection.ts';
import { PixelBuffer, type ActorView, type Drawable } from './types.ts';
import { readView } from '../../domain/view.ts';

for (const zoom of [2, 3, 4]) test(`projection round trip at zoom ${zoom}`, () => {
  const camera = { x: 71, y: -32, zoom }, viewport = { w: 960, h: 640 };
  for (const p of [{ x: 0, y: 0 }, { x: -81, y: 352 }, { x: 123.5, y: -12.5 }]) {
    const screen = sceneToScreen(p, camera, viewport);
    assert.deepEqual(screenToScene(screen, camera, viewport), p);
    assert.deepEqual(screenToFloor(screen, camera, viewport), { x: p.x / 16, z: p.y / 16 });
  }
});
test('clamp every edge and centre scenes smaller than viewport', () => {
  const size = { w: 200, h: 100 }, bounds = { x: -20, y: -40, w: 400, h: 300 };
  assert.deepEqual(clampCamera({ x: -1000, y: -1000, zoom: 2 }, size, bounds), { x: 30, y: -15, zoom: 2 });
  assert.deepEqual(clampCamera({ x: 1000, y: 1000, zoom: 2 }, size, bounds), { x: 330, y: 235, zoom: 2 });
  assert.deepEqual(clampCamera({ x: 900, y: -900, zoom: 2 }, { w: 1200, h: 800 }, bounds), { x: 180, y: 110, zoom: 2 });
});
const sprite = { buf: new PixelBuffer(16, 24), ax: 8, ay: 24 };
test('object sort uses feet and puts people after furniture on ties', () => {
  const make = (sortY: number, person = false) => ({ sprite, x: 0, y: sortY, sortY, layer: 'object' as const, person });
  const back = make(1), desk = make(20), person = make(20, true), front = make(40);
  assert.deepEqual(sortDrawables([front, person, desk, back]), [back, desk, person, front]);
});
test('hit test chooses front-most overlapping body and misses outside', () => {
  const back = { id: 'back', x: 2, z: 2 } as ActorView, front = { id: 'front', x: 2, z: 2.5 } as ActorView;
  assert.equal(hitTest([front, back], 32, 30), front);
  assert.equal(hitTest([back, front], 41, 30), null);
  assert.equal(hitTest([back, front], 32, 41), null);
});
test('viewport culling includes partially visible sprites and rejects outside', () => {
  const d: Drawable = { sprite, x: 5, y: 20, sortY: 20, layer: 'object' };
  assert.equal(inViewport(d, { x: 0, y: 0, w: 10, h: 10 }), true);
  assert.equal(inViewport(d, { x: 20, y: 0, w: 10, h: 10 }), false);
});
test('view defaults, saved value and valid page-only query override', () => {
  assert.equal(readView(null), 'pixel');
  assert.equal(readView('invalid'), 'pixel');
  assert.equal(readView('3d'), '3d');
  assert.equal(readView('pixel', '?view=3d'), '3d');
  assert.equal(readView('3d', '?view=pixel'), 'pixel');
  assert.equal(readView('3d', '?view=invalid'), '3d');
});

test('pickItem returns the seat of a team desk and reaches the tall part of furniture', () => {
  const items = [
    { id: 'team', type: 'teamdesk' as const, x: 2, z: 2, w: 4, d: 2, seats: [{ id: 'seat-a', dx: 1, dz: 0, face: 0 }, { id: 'seat-b', dx: 3, dz: 2, face: Math.PI }] },
    { id: 'fridge', type: 'fridge' as const, x: 10, z: 5 },
    { id: 'rug', type: 'rug' as const, x: 14, z: 5 },
  ];
  assert.deepEqual(pickItem(items, 3 * 16, 2.3 * 16), { itemId: 'seat-a' });
  assert.deepEqual(pickItem(items, 5 * 16, 3.8 * 16), { itemId: 'seat-b' });
  assert.deepEqual(pickItem(items, 10.5 * 16, 5 * 16 - 14), { itemId: 'fridge' }, 'the upper part of a tall item is clickable');
  assert.equal(pickItem(items, 10.5 * 16, 5 * 16 - 30), null);
  assert.equal(pickItem(items, 15 * 16, 5.5 * 16), null, 'rugs are floor');
});

test('vertical signs keep Thai marks with their letter, with and without Intl.Segmenter', () => {
  const expected = ['\u0e40', '\u0e1b\u0e34', '\u0e14', '2', '4', '\u0e0a\u0e31\u0e48', '\u0e27'];
  assert.deepEqual(letterClusters('\u0e40\u0e1b\u0e34\u0e14 24 \u0e0a\u0e31\u0e48\u0e27'), expected);
  assert.deepEqual(letterClusters('\u0e40\u0e1b\u0e34\u0e14 24 \u0e0a\u0e31\u0e48\u0e27', null), expected, 'no Segmenter: no throw, same clusters');
});

test('the start zoom shows the whole office width, closer for a small office', () => {
  assert.equal(startZoom(1364, 45 * 16), 2);
  assert.equal(startZoom(1364, 26 * 16), 4);
  assert.equal(startZoom(1364, 50 * 16), 2);
  assert.equal(startZoom(1364, 70 * 16), 1);
  assert.equal(startZoom(1364, 12 * 16), 4);
  assert.equal(startZoom(600, 45 * 16), 1);
});

test('name tags of a crowd are moved apart, the front one staying put', () => {
  const tags = [{ x: 100, y: 200, w: 60, h: 18 }, { x: 110, y: 198, w: 60, h: 18 }, { x: 105, y: 190, w: 60, h: 18 }, { x: 400, y: 200, w: 60, h: 18 }];
  const ys = spreadLabels(tags);
  assert.equal(ys[0], 200, 'the lowest tag keeps its place');
  assert.equal(ys[3], 200, 'a tag far away is untouched');
  const boxes = tags.map((t, i) => ({ ...t, y: ys[i]! }));
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
    const overlap = Math.abs(boxes[a]!.x - boxes[b]!.x) < 60 && Math.abs(boxes[a]!.y - boxes[b]!.y) < 18;
    assert.ok(!overlap, `tags ${a} and ${b} still overlap: ${ys}`);
  }
  assert.ok(ys[1]! < 200 && ys[2]! < ys[1]!, 'tags behind move up, in order');
});

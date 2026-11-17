import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PixelBuffer, rgba, shade } from './types.ts';

test('rgba reads 3- and 6-digit hex and keeps red above 127 positive', () => {
  assert.equal(rgba('#ff0000'), 0xff0000ff);
  assert.equal(rgba('f00'), 0xff0000ff);
  assert.equal(rgba('#102030', 128), 0x10203080);
});

test('rgba reads the alpha of 8-digit hex, trims spaces and clamps alpha', () => {
  assert.equal(rgba('#ff000080'), 0xff000080);
  assert.equal(rgba('  #ff0000 '), 0xff0000ff);
  assert.equal(rgba('#00ff00', 300), 0x00ff00ff);
  assert.equal(rgba('#00ff00', -5), 0x00ff0000);
});

test('rgba answers a colour that is not hex with visible magenta, never silent black', () => {
  for (const bad of ['notacolour', '', '#zzzzzz', '#abcd', 'rgb(1,2)']) assert.equal(rgba(bad), 0xff00ffff, bad);
});

test('PixelBuffer snaps fractional coordinates to whole pixels', () => {
  const b = new PixelBuffer(4, 4);
  b.set(1.5, 1.2, 0xff0000ff);
  assert.equal(b.get(1, 1), 0xff0000ff);
  assert.equal(b.get(1.9, 1.9), 0xff0000ff);
  const dot = new PixelBuffer(1, 1); dot.set(0, 0, 0x00ff00ff);
  b.blit(dot, 2.7, 2.2);
  assert.equal(b.get(2, 2), 0x00ff00ff);
});

test('blending two translucent pixels gives straight source-over alpha', () => {
  const b = new PixelBuffer(1, 1);
  b.set(0, 0, 0xff000064); b.set(0, 0, 0x0000ff64);
  const c = b.get(0, 0), alpha = c & 255;
  // alpha: 100 over 100 of 255 = 161; blue is on top so it outweighs red
  assert.ok(Math.abs(alpha - 161) <= 1, `alpha ${alpha}`);
  assert.ok(((c >>> 8) & 255) > (c >>> 24), 'top colour dominates');
});

test('shade clamps and keeps alpha', () => {
  assert.equal(shade(0xf0f0f080, 2), 0xffffff80);
  assert.equal(shade(0x10203040, 0), 0x00000040);
});

test('rgba reads the colour texts the server accepts, as the 3D view does', () => {
  assert.equal(rgba('rgb(240, 240, 240)'), 0xf0f0f0ff);
  assert.equal(rgba('rgba(255, 0, 0, 0.5)'), 0xff000080);
  assert.equal(rgba('rgb(10 20 30 / 50%)'), 0x0a141e80);
  assert.equal(rgba('white'), 0xffffffff);
  assert.equal(rgba('  White '), 0xffffffff);
  assert.equal(rgba('#ABC'), 0xaabbccff);
});

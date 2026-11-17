import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looks, type Look } from '../../domain/looks.ts';
import { PERSON_FRAMES, type Dir, type PersonAction, type Sprite } from './types.ts';
import { P } from './palette.ts';
import { drawPerson } from './people.ts';

const ACTIONS = Object.keys(PERSON_FRAMES) as PersonAction[];
const DIRS: Dir[] = ['down', 'up', 'left', 'right'];
const female: Look = { sex: 'f', outfit: 'suit', hair: 'long', hairColor: '#3a2418', skin: '#e0b48e', glasses: false, top: '#b5654f', inner: '#efe3d3', bottom: '#eadfcb', shoes: '#8a5a3c' };
const male: Look = { sex: 'm', outfit: 'casual', hair: 'short', hairColor: '#151012', skin: '#d9a77f', glasses: true, top: '#4a2f24', inner: '#4a2f24', bottom: '#2e2e32', shoes: '#2a1f18' };

const same = (a: Sprite, b: Sprite) => a.buf.w === b.buf.w && a.buf.h === b.buf.h && a.buf.data.every((v, i) => v === b.buf.data[i]);
/** Rows (top first) holding something other than the ground shadow. */
function solidRows(s: Sprite): number[] {
  const rows: number[] = [];
  for (let y = 0; y < s.buf.h; y++) for (let x = 0; x < s.buf.w; x++) { const c = s.buf.get(x, y); if ((c & 255) && c !== P.shadow) { rows.push(y); break; } }
  return rows;
}
/** Row of the top of the figure relative to the feet line (negative: above it). */
const headTop = (s: Sprite) => solidRows(s)[0]! - s.ay;

test('every action x dir x frame is drawn, anchored and standing on the ground line', () => {
  for (const look of [female, male]) for (const action of ACTIONS) for (const dir of DIRS) for (let frame = 0; frame < PERSON_FRAMES[action]; frame++) {
    const s = drawPerson(look, { action, dir, frame });
    const tag = `${look.sex} ${action} ${dir} ${frame}`;
    assert.ok(s.buf.filled() > 60, `${tag}: empty`);
    assert.ok(s.ax >= 0 && s.ax < s.buf.w && s.ay >= 0 && s.ay < s.buf.h, `${tag}: anchor outside`);
    const rows = solidRows(s), bottom = rows[rows.length - 1]!;
    assert.ok(Math.abs(bottom - s.ay) <= 1, `${tag}: lowest row ${bottom} vs ay ${s.ay}`);
  }
});

test('results are cached and the look shows', () => {
  const pose = { action: 'walk', dir: 'down', frame: 1 } as const;
  assert.equal(drawPerson(female, pose), drawPerson(female, pose));
  assert.equal(drawPerson(female, { ...pose, frame: 5 }), drawPerson(female, { ...pose, frame: 1 }), 'frame wraps');
  assert.ok(!same(drawPerson(female, pose), drawPerson({ ...female, top: '#2244aa' }, pose)));
  assert.ok(!same(drawPerson(female, pose), drawPerson({ ...female, skin: '#8d5a3c' }, pose)));
  assert.ok(!same(drawPerson(female, pose), drawPerson({ ...female, shoes: '#ffffff' }, pose)));
  assert.ok(!same(drawPerson(female, pose), drawPerson({ ...female, bottom: '#222222' }, pose)));
  assert.ok(!same(drawPerson(female, { action: 'stand', dir: 'down', frame: 0 }), drawPerson({ ...female, inner: '#ff0000' }, { action: 'stand', dir: 'down', frame: 0 })));
});

test('the five hair styles look different from the front, back and side', () => {
  const styles = ['long', 'bob', 'bun', 'ponytail', 'short'] as const;
  for (const dir of ['down', 'up', 'right'] as const) {
    for (let i = 0; i < styles.length; i++) for (let j = i + 1; j < styles.length; j++) {
      const a = drawPerson({ ...female, hair: styles[i]! }, { action: 'stand', dir, frame: 0 });
      const b = drawPerson({ ...female, hair: styles[j]! }, { action: 'stand', dir, frame: 0 });
      assert.ok(!same(a, b), `${styles[i]} and ${styles[j]} are the same from ${dir}`);
    }
  }
});

test('hair colour, glasses and outfit change the picture', () => {
  const stand = { action: 'stand', dir: 'down', frame: 0 } as const;
  assert.ok(!same(drawPerson(male, stand), drawPerson({ ...male, glasses: false }, stand)), 'glasses down');
  assert.ok(!same(drawPerson(male, { ...stand, dir: 'right' }), drawPerson({ ...male, glasses: false }, { ...stand, dir: 'right' })), 'glasses side');
  assert.ok(!same(drawPerson(male, stand), drawPerson({ ...male, hairColor: '#c8a050' }, stand)));
  for (const [a, b] of [['suit', 'formal'], ['formal', 'casual'], ['suit', 'casual']] as const) {
    assert.ok(!same(drawPerson({ ...female, outfit: a }, stand), drawPerson({ ...female, outfit: b }, stand)), `${a} vs ${b}`);
  }
});

test('directions, walking and sitting read correctly', () => {
  for (const look of [female, male]) {
    assert.ok(!same(drawPerson(look, { action: 'stand', dir: 'left', frame: 0 }), drawPerson(look, { action: 'stand', dir: 'right', frame: 0 })), 'left is not right');
    for (const dir of DIRS) {
      for (const action of ['walk', 'run', 'dance'] as const) {
        const frames = Array.from({ length: PERSON_FRAMES[action] }, (_, f) => drawPerson(look, { action, dir, frame: f }));
        assert.ok(frames.some(f => !same(f, frames[0]!)), `${action} ${dir} does not move`);
      }
      const stand = drawPerson(look, { action: 'stand', dir, frame: 0 }), sit = drawPerson(look, { action: 'sit', dir, frame: 0 });
      assert.ok(headTop(sit) > headTop(stand) + 2, `sit ${dir} head is not lower (${headTop(sit)} vs ${headTop(stand)})`);
      const typing = [0, 1].map(f => drawPerson(look, { action: 'type', dir, frame: f }));
      assert.ok(!same(typing[0]!, typing[1]!), `type ${dir} hands do not move`);
    }
  }
});

test('umbrella adds pixels above the head', () => {
  for (const dir of DIRS) for (const action of ['stand', 'walk', 'sit'] as const) {
    const plain = drawPerson(female, { action, dir, frame: 0 }), rain = drawPerson(female, { action, dir, frame: 0, umbrella: true });
    const topPlain = headTop(plain), topRain = headTop(rain);
    assert.ok(topRain <= topPlain - 5, `${action} ${dir}: umbrella reaches ${topRain}, head ${topPlain}`);
    assert.ok(rain.buf.filled() > plain.buf.filled() + 30);
  }
});

test('gestures differ from standing in every direction', () => {
  for (const look of [female, male]) for (const dir of DIRS) {
    const base = drawPerson(look, { action: 'stand', dir, frame: 0 });
    for (const action of ['kick', 'throw', 'wave', 'flinch'] as const) {
      for (let f = 0; f < PERSON_FRAMES[action]; f++) assert.ok(!same(base, drawPerson(look, { action, dir, frame: f })), `${look.sex} ${action} ${dir} ${f}`);
    }
  }
});

test('all staff in looks.json draw in every direction', () => {
  const names = Object.keys(looks);
  assert.ok(names.length >= 8);
  for (const name of names) for (const dir of DIRS) {
    const s = drawPerson(looks[name]!, { action: 'stand', dir, frame: 0 });
    assert.ok(s.buf.filled() > 100, name);
  }
});

test('every member of staff is a different person: all stand/down sprites are distinct', () => {
  const seen = new Set<string>();
  const names = Object.keys(looks);
  for (const name of names) seen.add(Array.from(drawPerson(looks[name]!, { action: 'stand', dir: 'down', frame: 0 }).buf.data).join(','));
  assert.ok(names.length >= 8);
  assert.equal(seen.size, names.length, `only ${seen.size} distinct sprites for ${names.length} people`);
});

test('a look with an unknown hair or outfit falls back to short hair and casual clothes instead of throwing', () => {
  const stand = { action: 'stand', dir: 'down', frame: 0 } as const;
  for (const dir of DIRS) {
    const pose = { ...stand, dir };
    assert.ok(same(drawPerson({ ...male, hair: 'mohawk' as Look['hair'] }, pose), drawPerson({ ...male, hair: 'short' }, pose)), `unknown hair, ${dir}`);
    assert.ok(same(drawPerson({ ...male, outfit: 'spacesuit' as Look['outfit'] }, pose), drawPerson({ ...male, outfit: 'casual' }, pose)), `unknown outfit, ${dir}`);
    assert.doesNotThrow(() => drawPerson({ ...female, hair: 'constructor' as Look['hair'], outfit: 'toString' as Look['outfit'] }, pose));
  }
});

test('a fractional, negative, NaN or missing frame is floored into range instead of throwing', () => {
  const walk = (frame: number) => drawPerson(female, { action: 'walk', dir: 'down', frame });
  assert.equal(walk(1.7), walk(1), 'fractions floor');
  assert.equal(walk(-0.5), walk(3), 'negative wraps (floor(-0.5) = -1)');
  assert.equal(walk(Number.NaN), walk(0));
  assert.equal(walk(Infinity), walk(0));
  assert.equal(drawPerson(female, { action: 'walk', dir: 'down' } as unknown as Parameters<typeof drawPerson>[1]), walk(0), 'missing frame');
  assert.equal(drawPerson(female, { action: 'walk', dir: 'down', frame: '2' as unknown as number }), walk(2), 'numeric string');
  assert.equal(drawPerson(female, { action: 'sit', dir: 'up', frame: 0.4 }), drawPerson(female, { action: 'sit', dir: 'up', frame: 0 }));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crewForHQ, type CrewAgent } from './crew.ts';

const agent = (id: string, over: Partial<CrewAgent> = {}): CrewAgent => ({ id, name: id, role: '', team: 'A', status: 'idle', hiredAt: 1, ...over });

test('HQ gathers workers, the assistant and heads of only the teams doing work', () => {
  const list = [agent('assistant', { role: 'Assistant CEO', team: 'CEO' }), agent('head-a', { role: 'หัวหน้าฝ่าย' }),
    agent('head-b', { role: 'Engineering Lead', team: 'B' }), agent('head-c', { role: 'Head', team: 'C' }),
    agent('a', { status: 'working' }), agent('b', { status: 'working', team: 'B' })];
  assert.deepEqual(crewForHQ(list), new Set(['a', 'b', 'assistant', 'head-a', 'head-b']));
});

test('head fallback uses earliest hired in that team and is independent of input order', () => {
  const list = [agent('new', { hiredAt: 5 }), agent('old', { hiredAt: 1 }), agent('other', { team: 'B', hiredAt: 0 }), agent('worker', { status: 'working', hiredAt: 9 })];
  assert.deepEqual(crewForHQ(list), new Set(['worker', 'old']));
  assert.deepEqual(crewForHQ([...list].reverse()), crewForHQ(list));
});

test('no work means nobody extra; waiting is queued human work rather than mid-task', () => {
  assert.deepEqual(crewForHQ([agent('assistant', { role: 'Studio Producer' }), agent('head', { role: 'Head' }), agent('human', { status: 'waiting', kind: 'human' })]), new Set());
});

test('player is never a worker, assistant or fallback head', () => {
  assert.deepEqual(crewForHQ([agent('__player', { role: 'Assistant CEO', status: 'working', hiredAt: 0 }), agent('p2', { kind: 'player', role: 'Head', status: 'working', hiredAt: 0 }), agent('worker', { status: 'working' })]), new Set(['worker']));
  assert.deepEqual(crewForHQ([agent('__player', { status: 'working' })]), new Set());
});

for (const role of ['Assistant CEO', 'ผู้ช่วย CEO', 'Studio Producer']) test(`assistant role: ${role}`, () => {
  assert.deepEqual(crewForHQ([agent('assistant', { role, team: 'CEO' }), agent('worker', { status: 'working' })]), new Set(['worker', 'assistant']));
});

test('roles are matched in the team, names are not used; no invented assistant', () => {
  assert.deepEqual(crewForHQ([agent('head', { role: 'Head of Design', hiredAt: 10 }), agent('fake', { name: 'Assistant CEO', hiredAt: 0 }), agent('worker', { status: 'working' })]), new Set(['worker', 'head']));
});

// Team file and whole-team use cases: `npm test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Agent } from '../../shared/types.ts';
import { createT } from '../../shared/i18n/index.ts';
import { createAgent } from '../domain/agent.ts';
import type { Runner, StateStore } from '../domain/ports.ts';
import { Agents } from './agents.ts';
import type { Notifier } from './notifier.ts';
import type { Tasks } from './tasks.ts';
import type { Translator } from './translator.ts';
import { seatPoint } from '../../shared/catalog.ts';
import type { Office } from '../../shared/types.ts';

function setup(names: string[] = []) {
  const t = createT('en');
  const state = { agents: names.map((name, i) => ({ ...createAgent({ name, team: 'T' }, 'role'), hiredAt: i })), office: {}, tasks: [] };
  const abandoned: string[] = [];
  const agents = new Agents(
    { state, save() {} } as unknown as StateStore,
    { agent() {}, log() {}, publish() {}, publicAgent: (a: Agent) => a } as unknown as Notifier,
    { abandon: (a: Agent) => void abandoned.push(a.name) } as unknown as Tasks,
    { has: (id: string) => id === 'claude' } as unknown as Runner,
    { t, locale: 'en' } as unknown as Translator,
  );
  return { agents, state, abandoned };
}

test('deleteTeam fires everyone and stops their work', () => {
  const { agents, state, abandoned } = setup(['A', 'B']);
  assert.equal(agents.deleteTeam(), 2);
  assert.deepEqual(state.agents, []);
  assert.deepEqual(abandoned, ['A', 'B']);
});

test('an exported team holds setup only, in hiring order', () => {
  const { agents, state } = setup(['A', 'B']);
  Object.assign(state.agents[0], { sessionId: 's1', totalCost: 5, cwd: '/secret', prompt: 'p' });
  const file = agents.exportTeam();
  assert.equal(file.format, 'agent-office-team');
  assert.deepEqual(file.agents.map(a => a.name), ['A', 'B']);
  assert.equal(file.agents[0].prompt, 'p');
  for (const key of ['id', 'sessionId', 'totalCost', 'cwd', 'hiredAt', 'deskId']) assert.ok(!(key in file.agents[0]), key);
});

test('export then import with replace brings the same team back with fresh memory', () => {
  const { agents, state, abandoned } = setup(['A', 'B']);
  state.agents[0].sessionId = 's1';
  const before = state.agents.map(a => a.id);
  const r = agents.importTeam(agents.exportTeam().agents, true);
  assert.deepEqual(r, { added: ['A', 'B'], skipped: 0 });
  assert.deepEqual(abandoned, ['A', 'B']);
  assert.deepEqual(state.agents.map(a => a.name), ['A', 'B']);
  assert.ok(state.agents.every(a => !before.includes(a.id) && a.sessionId === null));
});

test('adding skips names already in the team, whatever their case', () => {
  const { agents, state, abandoned } = setup(['A']);
  assert.deepEqual(agents.importTeam([{ name: 'a' }, { name: 'B' }]), { added: ['B'], skipped: 1 });
  assert.deepEqual(state.agents.map(a => a.name), ['A', 'B']);
  assert.deepEqual(abandoned, []);
});

test('a CLI this machine lacks falls back to the office default', () => {
  const { agents, state } = setup();
  agents.importTeam([{ name: 'A', provider: 'claude' }, { name: 'B', provider: 'gone' }]);
  assert.deepEqual(state.agents.map(a => a.provider), ['claude', '']);
});

test('a file listing a name twice is refused before anyone is fired', () => {
  const { agents, state, abandoned } = setup(['A']);
  assert.throws(() => agents.importTeam([{ name: 'B' }, { name: ' b ' }], true), /twice/);
  assert.deepEqual(state.agents.map(a => a.name), ['A']);
  assert.deepEqual(abandoned, []);
});

test('startup relayout upgrades a saved office and keeps every agent assigned, without resetting memory', () => {
  const { agents, state } = setup(['A', 'B', 'C']);
  const before = state.agents.map(a => ({ ...a, deskId: 'legacy-' + a.id, sessionId: 'memory-' + a.id }));
  state.agents = before.map(a => ({ ...a }));
  state.office = { name: 'Saved company', items: [{ type: 'desk', id: 'legacy' }] };
  agents.relayout(); // main.ts calls this before serve(), on every launch.
  const office = state.office as Office;
  assert.equal(office.name, 'Saved company');
  assert.ok(office.items.some(i => i.room === 'hq'));
  assert.deepEqual(state.agents.map(a => a.id), before.map(a => a.id));
  for (const a of state.agents) {
    assert.equal(a.sessionId, 'memory-' + a.id);
    assert.equal(a.deskId, 'desk-' + a.id);
    assert.ok(seatPoint(office.items, a.deskId!));
  }
  const first = structuredClone(state);
  agents.relayout();
  assert.deepEqual(state, first);
});

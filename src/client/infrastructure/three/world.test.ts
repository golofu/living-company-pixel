import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { planOffice } from '../../../shared/layout.ts';
import { createT } from '../../../shared/i18n/index.ts';
import { seatPoint, solidGrid } from '../../../shared/catalog.ts';
import type { PublicAgent, Office } from '../../../shared/types.ts';
import { crewForHQ } from '../../domain/crew.ts';
import { hqSeats } from '../../domain/hqSeats.ts';
import { Avatar } from './avatar.ts';

// World imports a generated screen texture. Only that canvas is stubbed; no renderer/browser is started.
Object.defineProperty(globalThis, 'document', { configurable: true, value: {
  createElement: () => ({ getContext: () => ({ fillRect() {} }) }),
} });
const { World } = await import('./world.ts');
const { buildItemMesh, screenOn, screenIdle, screenOff } = await import('./furniture.ts');

const agent = (id: string, over: Partial<PublicAgent> = {}): PublicAgent => ({
  id, name: id, kind: 'agent', role: '', team: 'A', color: '#123456', provider: '', prompt: '', model: '', cwd: '',
  permissionMode: '', allowedTools: '', sessionId: null, totalCost: 0, hiredAt: 1, status: 'idle', activity: '', currentTaskId: null, queued: 0, ...over,
});

function office(list: PublicAgent[]) {
  const plan = planOffice(list);
  list = list.map(a => ({ ...a, deskId: plan.desks[a.id] }));
  // Exercise the actual decide/route/idleWeights/releaseSpot and pixel Avatar.update methods,
  // without constructing a drawing surface or scheduling a render loop.
  const world: InstanceType<typeof World> = Object.assign(Object.create(World.prototype), {
    office: { ...plan, name: 'Test', floorColor: '#fff', wallColor: '#fff' } as Office,
    agents: new Map(list.map(a => [a.id, a])), avatars: new Map(),
    hqCrew: crewForHQ(list), hqSeats: hqSeats(plan.items), spotClaims: new Map(), claimedPoints: new Map(),
    grid: solidGrid(plan.items, plan.width, plan.depth), pixel: {}, attention: {}, cb: { onCoffee() {} },
  });
  for (const a of list) {
    const avatar: Avatar = Object.assign(Object.create(Avatar.prototype), {
      id: a.id, agent: a, group: new THREE.Group(), pixel: true, tr: () => createT('en'),
      el: { firstChild: { textContent: '', style: {} } }, path: [], pose: 'stand', spot: null, idleGoal: null,
      idleUntil: 0, errand: null, visit: null, attention: null, manual: false, running: false, pace: 1,
      phase: 0, lastStatus: 'idle', kickUntil: 0, throwUntil: 0, highFiveUntil: 0, danceUntil: 0, flinchUntil: 0,
    });
    avatar.group.position.set(plan.width / 2, 0, plan.depth - 0.7);
    world.avatars.set(a.id, avatar);
  }
  return world;
}

function change(world: InstanceType<typeof World>, id: string, status: PublicAgent['status']) {
  const next = { ...world.agents.get(id)!, status };
  world.agents.set(id, next);
  world.avatars.get(id)!.agent = next;
  Object.assign(world, { hqCrew: crewForHQ(world.agents.values()) });
}

test('decide: worker, assistant and head get distinct persistent HQ seats; only worker types after walking there', () => {
  const world = office([agent('worker', { status: 'working' }), agent('assistant', { role: 'Assistant CEO', team: 'CEO' }), agent('head', { role: 'Head' })]);
  const keys = new Set();
  for (const av of world.avatars.values()) {
    const goal = world.decide(av, 1000);
    assert.ok(goal.key?.startsWith('hq:'));
    assert.equal(goal.pose, 'sit');
    assert.ok(!keys.has(goal.key)); keys.add(goal.key);
    assert.equal(world.decide(av, 1100).key, goal.key, 'reservation must persist');
    world.route(av, goal);
    assert.ok(av.path.length, 'actual path from south entrance');
    for (let i = 0; i < 1500 && !av.atGoal(); i++) av.update(0.1, i / 10);
    assert.ok(av.atGoal(), `${av.id} reached HQ`);
    av.update(0.1, 151);
    const actor = av.toActorView();
    assert.equal(actor.pose, 'sit');
    assert.equal(actor.working, av.id === 'worker');
  }
});

test('decide: HQ full means own desk, releasing one seat lets another worker take it without duplicates', () => {
  const world = office(Array.from({ length: 12 }, (_, i) => agent('a' + i, { status: 'working', role: i === 11 ? 'Head' : '' })));
  const seats = hqSeats(world.office.items);
  const avatars = [...world.avatars.values()];
  const goals = avatars.map(av => world.decide(av, 1000));
  assert.equal(goals.filter(g => g.key?.startsWith('hq:')).length, seats.length);
  assert.equal(new Set(avatars.map(av => av.spot).filter(Boolean)).size, seats.length);
  const overflow = avatars[seats.length]!;
  assert.equal(goals[seats.length]!.key, 'desk:' + overflow.agent.deskId);
  assert.equal(goals[seats.length]!.pose, 'sit');
  const released = avatars[0]!.spot;
  change(world, avatars[0]!.id, 'idle');
  const goal = world.decide(avatars[0]!, 1200);
  assert.ok(!goal.key?.startsWith('hq:'));
  assert.equal(avatars[0]!.spot?.startsWith('hq-') ?? false, false);
  assert.equal(world.decide(overflow, 1300).key, 'hq:' + released);
});

test('decide: completion releases assistant and head; attention keeps a head at their own desk', () => {
  const world = office([agent('worker', { status: 'working' }), agent('assistant', { role: 'Studio Producer', team: 'CEO' }), agent('head', { role: 'หัวหน้า' }),
    ...Array.from({ length: 4 }, (_, i) => agent('idle' + i, { team: 'B' }))]);
  const head = world.avatars.get('head')!;
  const original = world.decide(head, 1000);
  head.attention = { kind: 'approval', tone: 'alert', icon: '!', text: 'Review', target: 'approvals' };
  assert.equal(world.decide(head, 1100).key, 'desk:' + head.agent.deskId);
  assert.equal(head.spot, null);
  head.attention = null;
  assert.equal(world.decide(head, 1200).key, original.key);
  for (const av of world.avatars.values()) world.decide(av, 1300);
  change(world, 'worker', 'idle');
  for (const av of world.avatars.values()) {
    assert.ok(!world.decide(av, 1400).key?.startsWith('hq:'));
    assert.ok(!av.spot?.startsWith('hq-'));
  }
  const worker = world.avatars.get('worker')!;
  assert.equal(worker.justDone, true);
  const pois = world.office.items.filter(i => !i.private);
  const weights = new Map(world.idleWeights(worker, 1401, true, pois));
  assert.equal(weights.get('game'), 6);
  assert.equal(weights.get('coffee'), 2);
});

test('decide: work interrupts a social errand but a fire drill still evacuates HQ', () => {
  const world = office([agent('worker', { status: 'working' })]);
  const av = world.avatars.get('worker')!;
  av.errand = { goal: { x: 1, z: 1, key: 'coffee' }, until: 2000 };
  assert.ok(world.decide(av, 1000).key?.startsWith('hq:'));
  world.releaseSpot(av);
  av.errand = { goal: { x: 1, z: 1, key: 'evacuate' }, until: 2000, run: true };
  assert.equal(world.decide(av, 1000).key, 'evacuate');
  assert.equal(av.spot, null);
  assert.ok(world.decide(av, 2100).key?.startsWith('hq:'));
});

test('idle weighting mostly favours the desk, with wandering and each leisure activity still possible', () => {
  const world = office([agent('idle')]);
  const av = world.avatars.get('idle')!;
  const weights = new Map(world.idleWeights(av, 1000, true, world.office.items));
  assert.ok(weights.get('desk')! > [...weights].filter(([k]) => k !== 'desk').reduce((s, [, w]) => s + w, 0));
  assert.ok(weights.get('wander')! > 0);
  assert.ok(seatPoint(world.office.items, av.agent.deskId!));
});

test('3D HQ table has a monitor per seat, follows working/support occupants and turns off after release', () => {
  const world = office([agent('worker', { status: 'working' }), agent('head', { role: 'Head' })]);
  const table = world.office.items.find(i => i.seats?.some(s => s.id.startsWith('hq-')))!;
  const mesh = buildItemMesh(table);
  Object.assign(world, { pixel: undefined, itemMeshes: new Map([[table.id, mesh]]) });
  const screens = mesh.userData.screens as Map<string, THREE.Mesh>;
  assert.equal(screens.size, table.seats!.length);
  for (const av of world.avatars.values()) {
    world.decide(av, 1000);
    assert.equal(screens.get(av.spot!)!.material, av.agent.status === 'working' ? screenOn : screenIdle);
  }
  const worker = world.avatars.get('worker')!;
  const seat = worker.spot!;
  world.releaseSpot(worker);
  assert.equal(screens.get(seat)!.material, screenOff);
});

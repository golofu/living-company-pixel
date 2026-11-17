import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookFor, looks, modelFileFor, playerLook } from './looks.ts';

test('named looks retain source colors and callers cannot mutate the source', () => {
  const name = Object.keys(looks)[0];
  const look = lookFor(name, 'ignored', '#ffffff');
  assert.deepEqual(look, looks[name]);
  look.top = '#000000';
  assert.notEqual(look.top, looks[name].top);
});

test('unknown names use a stable id hash and preserve the agent color', () => {
  const first = lookFor('unknown', 'employee-1', '#123456');
  assert.deepEqual(first, lookFor('renamed', 'employee-1', '#123456'));
  assert.equal(first.top, '#123456');
  assert.notDeepEqual(first, lookFor('unknown', 'employee-2', '#123456'));
  assert.doesNotThrow(() => lookFor('toString', 'prototype-name', '#123456'));
});

test('CEO defaults to a male navy suit; male formal never selects a female model', () => {
  const look = playerLook();
  if (!Object.hasOwn(looks, 'CEO')) {
    assert.equal(look.sex, 'm'); assert.equal(look.outfit, 'suit'); assert.equal(look.top, '#1c2d4d');
  }
  assert.equal(modelFileFor({ ...look, sex: 'm', outfit: 'formal' }), 'm-suit.gltf');
  assert.equal(modelFileFor({ ...look, sex: 'm', outfit: 'casual' }), 'm-casual.gltf');
});

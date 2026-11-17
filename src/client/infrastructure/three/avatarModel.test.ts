import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AvatarModel, MATERIAL_ROLES, type ModelPose } from './avatarModel.ts';
import { looks, type Look } from '../../domain/looks.ts';

// Embedded glTF buffer requests use this browser event in Three's FileLoader.
if (!globalThis.ProgressEvent) {
  Object.defineProperty(globalThis, 'ProgressEvent', { value: class {
    constructor(_type: string, properties: object) { Object.assign(this, properties); }
  } });
}
const baseLook: Look = { ...Object.values(looks)[0], hair: 'bob', glasses: false };
const pose: ModelPose = { moving: false, running: false, speed: 0, sitting: false, working: false, time: 1 };
// Every model the code knows must ship; a missing male file must fail, not skip male coverage.
for (const file of Object.keys(MATERIAL_ROLES)) assert.ok(existsSync(new URL(`../../public/models/${file}`, import.meta.url)), `missing ${file}`);
const sources = new Map(Object.keys(MATERIAL_ROLES)
  .map(file => [file,
  readFile(new URL(`../../public/models/${file}`, import.meta.url), 'utf8').then(json => new GLTFLoader().parseAsync(json, '')),
]));
const point = (model: AvatarModel, name: string) => model.bone(name)!.getWorldPosition(new THREE.Vector3());

test('real outfits share geometry while keeping materials, skeletons and colors independent', async () => {
  for (const [file, source] of sources) {
    const gltf = await source;
    const outfit = file.split('-')[1].split('.')[0] as Look['outfit'];
    const sex = file.startsWith('m') ? 'm' : 'f';
    const first = new AvatarModel(gltf, { ...baseLook, sex, outfit });
    const second = new AvatarModel(gltf, { ...baseLook, sex, outfit, top: '#123456' });
    const meshes: THREE.Mesh[][] = [[], []];
    [first, second].forEach((m, i) => m.root.traverse(o => { if (o instanceof THREE.Mesh) meshes[i].push(o); }));
    meshes[0].forEach((mesh, i) => {
      assert.equal(mesh.geometry, meshes[1][i].geometry);
      assert.notEqual(mesh.material, meshes[1][i].material);
      assert.equal((mesh.material as THREE.MeshStandardMaterial).roughness, 0.7);
      const roles = MATERIAL_ROLES[file][mesh.parent?.name ?? mesh.name];
      const material = meshes[1][i].material as THREE.MeshStandardMaterial;
      if (roles?.[material.name] === 'top') assert.equal(material.color.getHexString(), '123456');
    });
    assert.notEqual(first.bone('Head'), second.bone('Head'));
    first.dispose(); second.dispose();
  }
});

test('neutral models are 1.25 high, grounded and face +Z', async () => {
  for (const [file, source] of sources) {
    const model = new AvatarModel(await source, { ...baseLook, sex: file.startsWith('m') ? 'm' : 'f', outfit: file.split('-')[1].split('.')[0] as Look['outfit'] });
    model.update(0.3, pose);
    model.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model.root, true);
    assert.ok(Math.abs(box.min.y) < 0.015, `${file} floor ${box.min.y}`);
    assert.ok(Math.abs(box.max.y - 1.25) < 0.015, `${file} height ${box.max.y}`);
    assert.ok(box.max.z > -box.min.z, 'toes face +Z');
    model.dispose();
  }
});

test('seated feet reach the floor, knees point forward, hips meet the chair; turning preserves pose', async () => {
  const model = new AvatarModel(await sources.get('f-suit.gltf')!, baseLook);
  for (const angle of [0, Math.PI / 2]) {
    model.group.rotation.y = angle;
    model.update(0.016, { ...pose, sitting: true, working: true });
    model.group.updateMatrixWorld(true);
    assert.ok(Math.abs(point(model, 'Hips').y - 0.55) < 0.001);
    for (const side of ['L', 'R']) {
      const foot = model.group.worldToLocal(point(model, `Foot${side}`));
      const knee = model.group.worldToLocal(point(model, `LowerLeg${side}`));
      const thigh = model.group.worldToLocal(point(model, `UpperLeg${side}`));
      assert.ok(knee.z - thigh.z > 0.2, 'knees bend forward');
      assert.ok(Math.abs(point(model, `Foot${side}`).y - 0.0165) < 0.01, 'independent foot IK reaches floor');
      assert.ok(Math.abs(foot.z - knee.z) < 0.001, 'calves point down');
      assert.ok(point(model, `Wrist${side}`).y > 0.70, 'typing hands near keyboard height');
    }
  }
  model.update(0.3, pose);
  assert.equal(model.group.position.y, 0);
  assert.ok(point(model, 'Hips').y > 0.65, 'standing restores neutral pose');
  model.dispose();
});

test('hair/glasses follow Head and accessory geometry is shared across people', async () => {
  const gltf = await sources.get('f-suit.gltf')!;
  const first = new AvatarModel(gltf, { ...baseLook, hair: 'bun', glasses: true });
  const second = new AvatarModel(gltf, { ...baseLook, hair: 'bun', glasses: true });
  const accessories = first.bone('Head')!.getObjectByName('HeadAccessories')!;
  assert.ok(accessories);
  assert.equal(accessories.parent, first.bone('Head'));
  assert.equal((accessories.children[0] as THREE.Mesh).geometry,
    (second.bone('Head')!.getObjectByName('HeadAccessories')!.children[0] as THREE.Mesh).geometry);
  first.dispose(); second.dispose();
});

test('the half-exported male suit is completed once with mirrored limb weights', async () => {
  const source = sources.get('m-suit.gltf');
  if (!source) return;
  const gltf = await source;
  const first = new AvatarModel(gltf, { ...baseLook, sex: 'm' });
  const second = new AvatarModel(gltf, { ...baseLook, sex: 'm' });
  first.root.traverse(node => {
    if (!(node instanceof THREE.SkinnedMesh) || !/^Suit_(Body|Legs|Feet)$/.test(node.parent?.name ?? node.name)) return;
    node.geometry.computeBoundingBox();
    assert.ok(node.geometry.boundingBox!.min.x < 0);
    assert.ok(Math.abs(node.geometry.boundingBox!.min.x + node.geometry.boundingBox!.max.x) < 0.001);
    const weights = node.geometry.getAttribute('skinWeight');
    assert.equal(weights.count, node.geometry.getAttribute('position').count);
  });
  for (const model of [first, second]) {
    model.update(0.5, { ...pose, moving: true, speed: 2.2 });
    const box = new THREE.Box3().setFromObject(model.root, true);
    assert.ok(box.max.x > 0.1 && box.min.x < -0.1, 'both sides survive skinning');
    model.dispose();
  }
});

test('standing clips are not overridden: bones a clip leaves alone keep their value', async () => {
  const gltf = await sources.get('f-suit.gltf')!;
  const wave = gltf.animations.find(c => c.name === 'Wave')!;
  const driven = new Set(wave.tracks.map(t => t.name.split('.')[0]));
  const model = new AvatarModel(gltf, baseLook);
  model.update(0.1, pose);
  const free = [...model.bones.values()].find(b => !driven.has(b.name))!;
  assert.ok(free, 'some bone is not driven by Wave');
  free.position.x += 0.25;
  const marked = free.position.x;
  for (let i = 0; i < 5; i++) model.update(0.05, { ...pose, gesture: 'wave' });
  assert.equal(free.position.x, marked);
  // After sitting, hand-set bones are reset again when standing up.
  model.update(0.05, { ...pose, sitting: true });
  model.update(0.05, pose);
  assert.ok(point(model, 'Hips').y > 0.65);
  model.dispose();
});

test('one skeleton per person, and dispose frees skeletons and materials', async () => {
  const model = new AvatarModel(await sources.get('f-suit.gltf')!, { ...baseLook, glasses: true, hair: 'long' });
  const skeletons = new Set<THREE.Skeleton>();
  const materials = new Set<THREE.Material>();
  model.root.traverse(o => { if (o instanceof THREE.SkinnedMesh) skeletons.add(o.skeleton); if (o instanceof THREE.Mesh) materials.add(o.material as THREE.Material); });
  assert.equal(skeletons.size, 1);
  let freedSkeletons = 0, freedMaterials = 0;
  for (const s of skeletons) { const d = s.dispose.bind(s); s.dispose = () => { freedSkeletons++; d(); }; }
  for (const m of materials) m.addEventListener('dispose', () => freedMaterials++);
  model.dispose();
  assert.equal(freedSkeletons, skeletons.size);
  assert.equal(freedMaterials, materials.size);
  assert.equal(model.group.parent, null);
});

test('a failed model load is not cached, so the next request retries', async () => {
  const { loadAvatarModel, cachedModelFiles } = await import('./avatarModel.ts');
  const look: Look = { ...baseLook, outfit: 'casual' };
  const warn = console.warn; console.warn = () => {};
  try {
    await assert.rejects(loadAvatarModel(look));
    await new Promise(r => setTimeout(r, 0));
    assert.ok(!cachedModelFiles().includes('f-casual.gltf'));
  } finally { console.warn = warn; }
});

test('a gesture while seated plays like the same clip standing (torso untouched by restore)', async () => {
  const gltf = await sources.get('f-suit.gltf')!;
  const seated = new AvatarModel(gltf, baseLook), standing = new AvatarModel(gltf, baseLook);
  seated.update(0.016, { ...pose, sitting: true });
  standing.update(0.016, pose);
  const wave = { gesture: 'dance' as const, gestureSeconds: 2.6 };
  for (let i = 0; i < 60; i++) {
    seated.update(1 / 60, { ...pose, sitting: true, ...wave });
    standing.update(1 / 60, { ...pose, ...wave });
  }
  const a = seated.bone('Torso')!.quaternion, b = standing.bone('Torso')!.quaternion;
  assert.ok(a.angleTo(b) < 0.01, `torso differs by ${a.angleTo(b)}`);
  seated.dispose(); standing.dispose();
});

test('every vertex of every model stays inside its body sphere in every pose and gesture', async () => {
  const poses: Partial<ModelPose>[] = [
    {}, { moving: true, speed: 2.2 }, { moving: true, running: true, speed: 3.74 },
    { sitting: true }, { sitting: true, working: true },
    { gesture: 'kick', gestureSeconds: 0.46 }, { gesture: 'throw', gestureSeconds: 0.52 },
    { gesture: 'wave', gestureSeconds: 0.72 }, { gesture: 'dance', gestureSeconds: 2.6 },
    { gesture: 'flinch', gestureSeconds: 0.42 }, { sitting: true, gesture: 'wave', gestureSeconds: 0.72 },
  ];
  const p = new THREE.Vector3();
  for (const [file, source] of sources) {
    const model = new AvatarModel(await source, { ...baseLook, sex: file.startsWith('m') ? 'm' : 'f', outfit: file.split('-')[1].split('.')[0] as Look['outfit'] });
    const skinned: THREE.SkinnedMesh[] = [];
    model.root.traverse(o => { if (o instanceof THREE.SkinnedMesh) skinned.push(o); });
    assert.equal(new Set(skinned.map(m => m.skeleton)).size, 1, `${file}: one skeleton`);
    for (const extra of poses) {
      for (let f = 0; f < 40; f++) {
        model.update(1 / 60, { ...pose, ...extra, time: f / 60 });
        if (f % 8) continue;
        model.group.updateMatrixWorld(true);
        for (const mesh of skinned) {
          mesh.skeleton.update();
          const sphere = mesh.boundingSphere!;
          const n = mesh.geometry.getAttribute('position').count;
          for (let i = 0; i < n; i++) {
            mesh.getVertexPosition(i, p);
            assert.ok(sphere.containsPoint(p), `${file} ${JSON.stringify(extra)} frame ${f}: vertex ${i} of ${mesh.name} outside by ${p.distanceTo(sphere.center) - sphere.radius}`);
          }
        }
      }
    }
    model.dispose();
  }
});

test('bounds are measured once per file, not per person', async () => {
  const gltf = await sources.get('f-casual.gltf')!;
  const t0 = performance.now();
  const people = Array.from({ length: 30 }, () => new AvatarModel(gltf, { ...baseLook, outfit: 'casual' }));
  const ms = performance.now() - t0;
  let a: THREE.Sphere | undefined, b: THREE.Sphere | undefined;
  people[0].root.traverse(o => { if (o instanceof THREE.SkinnedMesh) a ??= o.boundingSphere!; });
  people[1].root.traverse(o => { if (o instanceof THREE.SkinnedMesh) b ??= o.boundingSphere!; });
  assert.ok(a!.equals(b!) && a !== b, 'same sphere values, separate objects');
  assert.ok(ms < 400, `30 people built in ${ms.toFixed(0)} ms`);
  for (const m of people) m.dispose();
});

test('switching between gestures that share a clip re-applies loop mode and speed', async () => {
  const model = new AvatarModel(await sources.get('f-suit.gltf')!, baseLook);
  const wave = (model as unknown as { actions: Map<string, THREE.AnimationAction> }).actions.get('Wave')!;
  model.update(0.016, pose);
  for (let i = 0; i < 90; i++) model.update(1 / 60, { ...pose, gesture: 'wave', gestureSeconds: 0.72 });
  assert.equal(wave.loop, THREE.LoopOnce);
  model.update(1 / 60, { ...pose, gesture: 'dance', gestureSeconds: 2.6 });
  assert.equal(wave.loop, THREE.LoopRepeat);
  assert.equal(wave.paused, false);
  for (let i = 0; i < 200; i++) model.update(1 / 60, { ...pose, gesture: 'dance', gestureSeconds: 2.6 });
  assert.ok(wave.isRunning(), 'dance keeps looping');
  model.update(1 / 60, { ...pose, gesture: 'wave', gestureSeconds: 0.72 });
  assert.equal(wave.loop, THREE.LoopOnce);
  assert.ok(Math.abs(wave.getEffectiveTimeScale() - wave.getClip().duration / 0.72) < 0.01);
  model.dispose();
});

test('hidden hair and props never catch clicks', async () => {
  for (const [file, look] of [['f-suit.gltf', { ...baseLook, hair: 'short' as const }], ['m-suit.gltf', { ...baseLook, sex: 'm' as const }]] as const) {
    const model = new AvatarModel(await sources.get(file)!, look);
    model.update(0.016, pose);
    model.group.updateMatrixWorld(true);
    let hidden = 0;
    model.root.traverse(o => {
      let hiddenBranch = false;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) hiddenBranch = true;
      if (!hiddenBranch || !(o instanceof THREE.Mesh)) return;
      hidden++;
      const hits: THREE.Intersection[] = [];
      const box = new THREE.Box3().setFromObject(o, true);
      const c = box.getCenter(new THREE.Vector3());
      const r = new THREE.Raycaster(new THREE.Vector3(c.x, c.y, c.z + 5), new THREE.Vector3(0, 0, -1));
      o.raycast(r, hits);
      assert.equal(hits.length, 0, `${file}: hidden ${o.name} was hit`);
    });
    assert.ok(hidden > 0, `${file} has hidden parts to check`);
    model.dispose();
  }
});

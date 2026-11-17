import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { createT } from '../shared/i18n/index.ts';
import { Avatar } from './infrastructure/three/avatar.ts';
import { officeChair } from './infrastructure/three/furniture.ts';
import { lookFor, looks } from './domain/looks.ts';

const query = new URLSearchParams(location.search);
const names = query.has('names') ? query.get('names')!.split(',').filter(Boolean) : Object.keys(looks);
const pose = query.get('pose') ?? 'stand';
const sitting = pose === 'sit' || pose === 'type';
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e8edf3');
scene.add(new THREE.HemisphereLight('#ffffff', '#8998b1', 2.5));
const sun = new THREE.DirectionalLight('#fff5e7', 3);
sun.position.set(-3, 7, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.append(renderer.domElement);
const labels = new CSS2DRenderer();
labels.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none';
document.body.append(labels.domElement);
const columns = Math.min(6, Math.max(1, names.length));
const rows = Math.ceil(names.length / columns);
const width = Math.max(3.4, columns * 1.65 + 0.8);
const depth = Math.max(3, rows * 2.8);
const camera = new THREE.OrthographicCamera();
camera.position.set(0.8, 4 + rows * 0.7, depth * 0.6 + 6);
if (query.get('view') === 'side') camera.position.set(7, 3, 0.8);
camera.lookAt(0, 0.55, 0);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(width + 4, depth + 6), new THREE.MeshStandardMaterial({ color: '#dbe3ec', roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.012;
floor.receiveShadow = true;
scene.add(floor);
const avatars = names.map((name, index) => {
  const holder = new THREE.Group();
  holder.position.set((index % columns - (columns - 1) / 2) * 1.65, 0, (Math.floor(index / columns) - (rows - 1) / 2) * 2.8);
  const look = lookFor(name, name, '#4279a3');
  const avatar = new Avatar({ id: name, name, color: look.top, kind: name === 'CEO' ? 'player' : 'agent', status: pose === 'type' ? 'working' : 'idle' }, () => createT('en'));
  avatar.pose = sitting ? 'sit' : 'stand';
  avatar.manual = pose === 'walk';
  holder.add(avatar.group);
  scene.add(holder);
  if (sitting) {
    officeChair(holder, 0, 0, Math.PI);
  }
  return { avatar, holder, z: holder.position.z };
});
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  labels.setSize(innerWidth, innerHeight);
  const aspect = innerWidth / innerHeight;
  const span = Math.max(width / aspect, depth * 0.76 + 1.8, 2.8);
  camera.left = -span * aspect / 2; camera.right = span * aspect / 2;
  camera.top = span / 2; camera.bottom = -span / 2;
  camera.near = 0.1; camera.far = 100;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
let last = performance.now();
// A fixed time is useful for repeatable captures, while still exercising the mixer.
const fixedTime = query.has('time') ? Number(query.get('time')) : undefined;
function render(now: number, animationTime = now / 1000) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  for (const item of avatars) {
    if (pose === 'walk') item.avatar.group.position.z += dt * 2.2;
    item.avatar.update(dt, animationTime);
    if (pose === 'walk') item.holder.position.z = item.z - item.avatar.z;
  }
  renderer.render(scene, camera);
  labels.render(scene, camera);
  if (fixedTime === undefined) requestAnimationFrame(now => render(now));
}
const loaded = await Promise.all(avatars.map(({ avatar }) => avatar.modelReady));
if (fixedTime !== undefined && Number.isFinite(fixedTime)) {
  for (let i = 0; i < Math.ceil(Math.max(0.3, fixedTime) * 60); i++) render(last + 1000 / 60, i / 60);
} else render(performance.now());
// Expose counts for headless QA without turning failed male loads into a blank preview.
document.documentElement.dataset.models = String(loaded.filter(Boolean).length);
document.documentElement.dataset.avatars = String(avatars.length);
document.title = 'ready';

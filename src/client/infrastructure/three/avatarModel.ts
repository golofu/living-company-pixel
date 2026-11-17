import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { modelFileFor, type Look } from '../../domain/looks.ts';

type Role = 'skin' | 'hairColor' | 'top' | 'inner' | 'bottom' | 'shoes';
type RoleTable = Record<string, Record<string, Role>>;

/** Inspected source primitives; match the outfit node, never the generated Cube name.
 * Hair_Brown is eyebrows, Brown is eyes; formal combines both in Brown.
 * Casual has no inner layer; formal Gold is the belt (mapped to inner).
 */
export const MATERIAL_ROLES: Record<string, RoleTable> = {
  'f-suit.gltf': {
    Suit_Head: { Skin: 'skin', Hair_Blond: 'hairColor', Hair_Brown: 'hairColor' },
    Suit_Body: { Skin: 'skin', Black: 'top', White: 'inner' },
    Suit_Legs: { Black: 'bottom' }, Suit_Feet: { Skin: 'skin', Black: 'shoes' },
  },
  'f-casual.gltf': {
    Casual_Head: { Skin: 'skin', Hair_Blond: 'hairColor', Hair_Brown: 'hairColor' },
    Casual_Body: { Skin: 'skin', White: 'top' }, Casual_Legs: { Orange: 'bottom' },
    Casual_Feet: { Skin: 'skin', Grey: 'shoes' },
  },
  'f-formal.gltf': {
    Formad_Head: { Skin: 'skin', Red: 'hairColor', Brown: 'hairColor' },
    Formal_Body: { Skin: 'skin', LimeGreen: 'top', Gold: 'inner' },
    Formal_Legs: { Skin: 'skin', LimeGreen: 'bottom' },
    Formal_Feet: { Skin: 'skin', Red: 'shoes' },
  },
  'm-suit.gltf': {
    Suit_Head: { Skin: 'skin', Eyebrows: 'hairColor', Hair: 'hairColor' },
    Suit_Body: { Skin: 'skin', Suit: 'top', White: 'inner', Tie: 'inner' },
    Suit_Legs: { Suit: 'bottom' }, Suit_Feet: { Black: 'shoes' },
  },
  'm-casual.gltf': {
    Casual2_Head: { Skin: 'skin', Skin_Darker: 'skin', Eyebrows: 'hairColor', Hair: 'hairColor' },
    Casual2_Body: { Skin: 'skin', LightBrown: 'top' },
    Casual2_Legs: { LightBlue: 'bottom' }, Casual2_Feet: { Red_Dark: 'shoes', White: 'shoes' },
  },
};

// The loader is its own chunk: the office renders (with simple figures) before it arrives.
let loader: Promise<{ loadAsync(url: string): Promise<GLTF> }> | undefined;
const getLoader = () => (loader ??= import('three/addons/loaders/GLTFLoader.js').then(m => new m.GLTFLoader(), error => {
  loader = undefined; // a chunk that failed to load (offline, stale tab) is fetched again next time
  throw error;
}));
const cache = new Map<string, Promise<GLTF>>();
/** Files whose load is cached (pending or done); a failed file drops out. */
export const cachedModelFiles = () => [...cache.keys()];
export function loadAvatarModel(look: Look): Promise<AvatarModel> {
  const file = modelFileFor(look);
  let source = cache.get(file);
  if (!source) {
    const url = `/models/${file}`;
    source = getLoader().then(l => l.loadAsync(url));
    cache.set(file, source);
    // A failed load must not stick: the next avatar that asks tries again.
    source.catch(error => {
      if (cache.get(file) === source) cache.delete(file);
      console.warn(`[avatar] model ${url} failed to load`, error);
    });
  }
  return source.then(gltf => new AvatarModel(gltf, look));
}

// Unit geometry is shared by every accessory, including across outfits.
const ACCESSORY = {
  ball: new THREE.SphereGeometry(0.5, 16, 12),
  cap: new THREE.SphereGeometry(0.5, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.57),
  capsule: new THREE.CapsuleGeometry(0.5, 1, 6, 14),
  frame: new THREE.TorusGeometry(1, 0.075, 6, 24),
  bridge: new THREE.BoxGeometry(1, 1, 1),
};
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const TYPING_ARM = new THREE.Vector3(0, -0.8, 0.6);
const REST_FOREARM = new THREE.Vector3(0, -0.45, 0.9);
const boneKey = (name: string) => name.replace(/[.\s]/g, '');
const prepared = new WeakSet<GLTF>();
const bodySpheres = new WeakMap<GLTF, THREE.Sphere>();

/** This particular male suit export left Blender's mirror modifier unapplied.
 * Reflect each affected primitive once, including joint indices and winding.
 * The repaired source geometry is then shared by all SkeletonUtils clones.
 */
function completeSuit(gltf: GLTF) {
  if (prepared.has(gltf)) return;
  gltf.scene.traverse(node => {
    if (!(node instanceof THREE.SkinnedMesh)) return;
    const section = /_/.test(node.parent?.name ?? '') ? node.parent!.name : node.name;
    if (!/^Suit_(Body|Legs|Feet)$/.test(section)) return;
    const source = node.geometry;
    source.computeBoundingBox();
    if (source.boundingBox!.min.x < -0.0001 || source.boundingBox!.max.x < 0.01) return;
    const geometry = new THREE.BufferGeometry();
    const count = source.getAttribute('position').count;
    const joints = node.skeleton.bones.map(bone => {
      const opposite = bone.name.replace(/([LR])$/, side => side === 'L' ? 'R' : 'L');
      const index = node.skeleton.bones.findIndex(other => other.name === opposite);
      return index < 0 ? node.skeleton.bones.indexOf(bone) : index;
    });
    for (const [name, attribute] of Object.entries(source.attributes)) {
      // GLTFLoader produces ordinary typed BufferAttributes for these files.
      if (!(attribute instanceof THREE.BufferAttribute)) throw new Error('Unsupported suit attribute');
      const ArrayType = attribute.array.constructor as typeof Float32Array;
      const array = new ArrayType(attribute.array.length * 2);
      array.set(attribute.array);
      for (let i = 0; i < attribute.array.length; i++) {
        let value = attribute.array[i];
        if ((name === 'position' || name === 'normal' || name === 'tangent') && i % attribute.itemSize === 0) value = -value;
        if (name === 'tangent' && i % attribute.itemSize === 3) value = -value;
        if (name === 'skinIndex') value = joints[value];
        array[attribute.array.length + i] = value;
      }
      geometry.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize, attribute.normalized));
    }
    const original = Array.from({ length: source.index?.count ?? count }, (_, i) => source.index ? source.index.getX(i) : i);
    const indices = [...original];
    for (let i = 0; i < original.length; i += 3) indices.push(original[i] + count, original[i + 2] + count, original[i + 1] + count);
    geometry.setIndex(indices);
    node.geometry = geometry;
    // Source primitives are not uploaded to the GPU and are no longer referenced.
    source.dispose();
  });
  // Marked only once every primitive is repaired, so a throw above is retried, not half-applied.
  prepared.add(gltf);
}

export interface ModelPose {
  moving: boolean;
  running: boolean;
  speed: number;
  sitting: boolean;
  working: boolean;
  time: number;
  gesture?: 'kick' | 'throw' | 'wave' | 'dance' | 'flinch';
  /** How long the office shows this gesture, so the clip can be fitted to it. */
  gestureSeconds?: number;
}

export class AvatarModel {
  readonly group = new THREE.Group();
  readonly root: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  readonly bones = new Map<string, THREE.Bone>();
  readonly height: number;
  readonly seatOffset: number;
  readonly file: string;
  private readonly baseline: { node: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }[] = [];
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly materials = new Set<THREE.Material>();
  private readonly footRotations = new Map<string, THREE.Quaternion>();
  private readonly lowerLegLengths = new Map<string, number>();
  private readonly footHeights = new Map<string, number>();
  private readonly upperLegLengths = new Map<string, number>();
  private active = '';
  private activeState = '';
  /** Bones were moved by hand last frame (sitting/typing) and must be reset before the mixer runs. */
  private posed = false;
  private readonly skinned: THREE.SkinnedMesh[] = [];
  /** Values of the hand-posed bones just before posing; put back before the mixer runs again. */
  private readonly prePose: { bone: THREE.Bone; position: THREE.Vector3; quaternion: THREE.Quaternion }[] = [];
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly q1 = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly direction = new THREE.Vector3();
  private readonly headTilt = new THREE.Euler();

  constructor(gltf: GLTF, look: Look) {
    this.file = modelFileFor(look);
    if (this.file === 'm-suit.gltf') completeSuit(gltf);
    this.root = clone(gltf.scene);
    this.group.add(this.root);
    this.mixer = new THREE.AnimationMixer(this.root);
    for (const clip of gltf.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.actions.get('Idle_Neutral')?.play();
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    // The glTF default pose is an action pose, not the neutral bind pose.
    this.root.traverse(node => {
      this.baseline.push({ node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() });
      if (node instanceof THREE.Bone) this.bones.set(boneKey(node.name), node);
    });
    const box = new THREE.Box3().setFromObject(this.root, true);
    const scale = 1.25 / (box.max.y - box.min.y);
    this.root.scale.multiplyScalar(scale);
    this.root.position.y -= box.min.y * scale;
    // Include normalization when restoring the neutral pose each frame.
    const rootState = this.baseline.find(state => state.node === this.root)!;
    rootState.scale.copy(this.root.scale);
    rootState.position.copy(this.root.position);
    this.root.updateMatrixWorld(true);
    this.height = 1.25;
    const hips = this.bone('Hips');
    this.seatOffset = 0.55 - (hips?.getWorldPosition(new THREE.Vector3()).y ?? 0.68);
    for (const side of ['L', 'R']) {
      const foot = this.bone(`Foot${side}`);
      const knee = this.bone(`LowerLeg${side}`), thigh = this.bone(`UpperLeg${side}`);
      if (foot && knee && thigh) {
        this.footRotations.set(side, foot.getWorldQuaternion(new THREE.Quaternion()));
        const point = foot.getWorldPosition(new THREE.Vector3());
        this.footHeights.set(side, point.y);
        this.lowerLegLengths.set(side, knee.getWorldPosition(new THREE.Vector3()).distanceTo(point));
        this.upperLegLengths.set(side, thigh.getWorldPosition(new THREE.Vector3()).distanceTo(knee.getWorldPosition(point)));
      }
    }
    this.recolor(look);
    this.accessories(look);
    this.shareSkeleton();
    this.setBounds(gltf);
    this.mixer.stopAllAction();
    this.restore();
  }

  bone(name: string) { return this.bones.get(boneKey(name)); }

  /** SkeletonUtils.clone gives every skinned part its own Skeleton (and bone texture) even though
   * they all drive the same bones. Parts with identical bone lists and inverses share the first one. */
  private shareSkeleton() {
    this.root.traverse(node => { if (node instanceof THREE.SkinnedMesh) this.skinned.push(node); });
    const shared: THREE.Skeleton[] = [];
    const same = (a: THREE.Skeleton, b: THREE.Skeleton) => a.bones.length === b.bones.length
      && a.bones.every((bone, i) => bone === b.bones[i] && a.boneInverses[i].equals(b.boneInverses[i]));
    for (const mesh of this.skinned) {
      const match = shared.find(skeleton => same(skeleton, mesh.skeleton));
      if (match) { if (match !== mesh.skeleton) { mesh.skeleton.dispose(); mesh.bind(match, mesh.bindMatrix); } }
      else shared.push(mesh.skeleton);
    }
  }

  /** One generous sphere for the whole body, shared by every part and every clone of the file.
   * Skinning moves vertices away from the measured pose (a kick swings a foot ~0.8 units), so
   * per-part or per-pose bounds miss limbs; a body sphere with reach margin never does, and it is
   * measured once per file instead of re-skinning every vertex per avatar. No box: raycast then
   * tests the sphere only and falls through to the exact triangle test. */
  private setBounds(gltf: GLTF) {
    let body = bodySpheres.get(gltf);
    if (!body) {
      this.root.updateMatrixWorld(true);
      const box = new THREE.Box3();
      for (const mesh of this.skinned) {
        mesh.skeleton.update();
        mesh.computeBoundingBox();
        box.union(mesh.boundingBox!);
      }
      body = box.getBoundingSphere(new THREE.Sphere());
      // Reach margin: arms and legs swing out about half a body height beyond the standing pose.
      body.radius += (box.max.y - box.min.y) * 0.5;
      bodySpheres.set(gltf, body);
    }
    for (const mesh of this.skinned) {
      mesh.boundingSphere = body.clone();
      (mesh as { boundingBox: THREE.Box3 | null }).boundingBox = null;
    }
  }

  private restore() {
    for (const state of this.baseline) {
      state.node.position.copy(state.position);
      state.node.quaternion.copy(state.quaternion);
      state.node.scale.copy(state.scale);
    }
  }

  private recolor(look: Look) {
    this.root.traverse(node => {
      // Some source packs include a weapon prop used only by combat clips.
      // Hidden parts must not catch clicks either: three.js raycasts invisible meshes.
      if (/^(Pistol|Gun|Sword)(_|$)/i.test(node.name)) { node.visible = false; node.traverse(o => { o.raycast = () => {}; }); }
      if (!(node instanceof THREE.Mesh)) return;
      node.castShadow = true;
      node.receiveShadow = true;
      let part: THREE.Object3D | null = node;
      while (part && !/_(Head|Body|Legs|Feet)$/.test(part.name)) part = part.parent;
      const section = part?.name ?? '';
      const table = MATERIAL_ROLES[this.file]?.[section];
      const convert = (source: THREE.Material) => {
        const role = table?.[source.name];
        const material = new THREE.MeshStandardMaterial({
          color: role ? look[role] : (source as THREE.MeshStandardMaterial).color ?? '#333333',
          roughness: 0.7, metalness: 0, flatShading: false, side: source.side,
        });
        material.name = source.name;
        this.materials.add(material);
        return material;
      };
      node.material = Array.isArray(node.material) ? node.material.map(convert) : convert(node.material);
      if (/_Head$/.test(section) && ['Hair_Blond', 'Red', 'Hair_Black', 'Hair'].includes((node.material as THREE.Material).name)) {
        node.userData.scalpHair = true;
        if (look.hair === 'short' || look.hair === 'bun' || look.hair === 'ponytail') { node.visible = false; node.raycast = () => {}; }
      }
    });
  }

  private accessories(look: Look) {
    const head = this.bone('Head');
    if (!head) return;
    this.root.updateMatrixWorld(true);
    const headBox = new THREE.Box3();
    // Skin bounds exclude bob, eyebrows and eyes; the visible eyes are at 64% of skin height.
    this.root.traverse(node => {
      if (node instanceof THREE.Mesh && (node.material as THREE.Material).name === 'Skin' && /_Head$/.test(node.parent?.name ?? node.name)) {
        headBox.union(new THREE.Box3().setFromObject(node, true));
      }
    });
    if (headBox.isEmpty()) return;
    const frame = new THREE.Group();
    frame.position.copy(headBox.getCenter(new THREE.Vector3()));
    this.group.add(frame);
    head.attach(frame);
    // Values below are measured in normalized office units, in an upright head frame.
    const width = headBox.max.x - headBox.min.x;
    const height = headBox.max.y - headBox.min.y;
    const depth = headBox.max.z - headBox.min.z;
    const hair = new THREE.MeshStandardMaterial({ color: look.hairColor, roughness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: '#20232a', roughness: 0.7 });
    this.materials.add(hair); this.materials.add(dark);
    const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, position: number[], size: number[]) => {
      const obj = new THREE.Mesh(geometry, material);
      obj.position.set(position[0], position[1], position[2]);
      obj.scale.set(size[0], size[1], size[2]);
      obj.castShadow = true;
      frame.add(obj);
      return obj;
    };
    if (['short', 'bun', 'ponytail'].includes(look.hair)) {
      mesh(ACCESSORY.cap, hair, [0, height * 0.33, -depth * 0.08], [width * 1.2, height * 0.8, depth * 1.13]);
    }
    if (look.hair === 'long') {
      mesh(ACCESSORY.capsule, hair, [0, -height * 0.42, -depth * 0.49], [width * 1.16, height * 0.8, depth * 0.42]);
    } else if (look.hair === 'ponytail') {
      const tail = mesh(ACCESSORY.capsule, hair, [0, -height * 0.08, -depth * 0.86], [width * 0.46, height * 0.8, depth * 0.42]);
      tail.rotation.x = -0.3;
    } else if (look.hair === 'bun') {
      mesh(ACCESSORY.ball, hair, [0, height * 0.43, -depth * 0.62], [width * 0.72, height * 0.55, depth * 0.6]);
    }
    if (look.glasses) {
      const radius = width * 0.205;
      const y = height * 0.14, z = depth * 0.52;
      for (const side of [-1, 1]) {
        mesh(ACCESSORY.frame, dark, [side * width * 0.25, y, z], [radius, radius * 0.76, radius]);
        mesh(ACCESSORY.bridge, dark, [side * width * 0.5, y, depth * 0.16], [0.005, 0.005, depth * 0.72]);
      }
      mesh(ACCESSORY.bridge, dark, [0, y, z], [width * 0.12, 0.005, 0.005]);
    }
    frame.name = 'HeadAccessories';
  }

  /** These exported limbs extend along bone-local +Y. Rotate in avatar space. */
  private aim(name: string, direction: THREE.Vector3) {
    const bone = this.bone(name);
    if (!bone?.parent) return;
    bone.getWorldQuaternion(this.q2);
    this.v1.copy(UP).applyQuaternion(this.q2);
    this.group.getWorldQuaternion(this.q2);
    this.v2.copy(direction).normalize().applyQuaternion(this.q2);
    this.q1.setFromUnitVectors(this.v1, this.v2);
    bone.getWorldQuaternion(this.q2).premultiply(this.q1);
    bone.parent.getWorldQuaternion(this.q1).invert();
    bone.quaternion.copy(this.q2).premultiply(this.q1);
    bone.updateWorldMatrix(false, true);
  }

  private worldRotation(name: string, rotation: THREE.Quaternion) {
    const bone = this.bone(name);
    if (!bone?.parent) return;
    this.group.getWorldQuaternion(this.q2).multiply(rotation);
    bone.parent.getWorldQuaternion(this.q1).invert();
    bone.quaternion.copy(this.q2).premultiply(this.q1);
  }

  update(dt: number, pose: ModelPose) {
    let clip = pose.sitting ? '' : pose.moving ? (pose.running ? 'Run' : 'Walk') : 'Idle_Neutral';
    if (pose.gesture === 'kick') clip = 'Kick_Right';
    else if (pose.gesture === 'throw') clip = 'Interact';
    else if (pose.gesture === 'wave' || pose.gesture === 'dance') clip = 'Wave';
    else if (pose.gesture === 'flinch') clip = 'HitRecieve';
    // Two gestures can share a clip (high-five and dance both use Wave) but not loop mode or speed.
    const state = `${clip}|${pose.gesture ?? ''}`;
    if (state !== this.activeState) {
      this.activeState = state;
      const previous = clip === this.active ? undefined : this.actions.get(this.active);
      const next = this.actions.get(clip);
      if (!clip) {
        // Seated without a clip: start from the neutral pose, not from a frozen walking frame.
        this.mixer.stopAllAction();
        this.restore();
        this.posed = false;
      } else if (next) {
        // A gesture plays once, at the speed that fits the time the office gives it.
        const once = !!pose.gesture && pose.gesture !== 'dance';
        next.reset().setEffectiveWeight(1).setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
        next.clampWhenFinished = once;
        next.setEffectiveTimeScale(once && pose.gestureSeconds ? THREE.MathUtils.clamp(next.getClip().duration / pose.gestureSeconds, 0.5, 4) : 1);
        next.play();
        if (previous) previous.crossFadeTo(next, 0.2, false);
        else if (clip !== this.active) next.fadeIn(0.2); // same clip, new gesture: restart at full weight
      }
      this.active = clip;
    }
    const action = this.actions.get(clip);
    if (pose.moving && action && (clip === 'Walk' || clip === 'Run')) {
      // Collision nudges and frame hitches make the measured speed jumpy; keep the stride believable.
      action.setEffectiveTimeScale(THREE.MathUtils.clamp(pose.speed / (pose.running ? 3.74 : 2.2), 0.5, 2));
    }
    // Only undo the bones posed by hand last frame. Three.js writes a clip's value only when it
    // changes, so resetting anything else would overwrite what the clip left in place.
    if (this.posed) for (const saved of this.prePose) { saved.bone.position.copy(saved.position); saved.bone.quaternion.copy(saved.quaternion); }
    this.posed = false;
    this.mixer.update(dt);
    this.group.position.y = pose.sitting ? this.seatOffset : 0;
    this.group.rotation.z = pose.gesture === 'dance' ? Math.sin(pose.time * 8) * 0.1 : 0;
    if (pose.sitting) {
      this.posed = true;
      if (!this.prePose.length) {
        for (const name of ['UpperLegL', 'UpperLegR', 'LowerLegL', 'LowerLegR', 'FootL', 'FootR', 'UpperArmL', 'UpperArmR', 'LowerArmL', 'LowerArmR', 'WristL', 'WristR', 'Head']) {
          const bone = this.bone(name);
          if (bone) this.prePose.push({ bone, position: new THREE.Vector3(), quaternion: new THREE.Quaternion() });
        }
      }
      for (const saved of this.prePose) { saved.position.copy(saved.bone.position); saved.quaternion.copy(saved.bone.quaternion); }
      for (const side of ['L', 'R']) {
        const thigh = this.bone(`UpperLeg${side}`), knee = this.bone(`LowerLeg${side}`), foot = this.bone(`Foot${side}`);
        if (thigh && knee && foot && !(side === 'R' && pose.gesture === 'kick')) {
          const thighY = this.group.worldToLocal(thigh.getWorldPosition(this.v1)).y;
          const lowerLength = this.lowerLegLengths.get(side)!;
          const kneeY = this.footHeights.get(side)! - this.group.position.y + lowerLength;
          const slope = THREE.MathUtils.clamp((kneeY - thighY) / this.upperLegLengths.get(side)!, -0.9, 0);
          this.aim(`UpperLeg${side}`, this.direction.set(0, slope, Math.sqrt(1 - slope * slope)));
          this.aim(`LowerLeg${side}`, DOWN);
          // Foot is an independent IK control under Root, not a LowerLeg child.
          this.group.worldToLocal(knee.getWorldPosition(this.v1));
          this.v1.y -= lowerLength;
          this.group.localToWorld(this.v1);
          foot.position.copy(foot.parent!.worldToLocal(this.v1));
        }
        const footRotation = this.footRotations.get(side);
        if (footRotation && !(side === 'R' && pose.gesture === 'kick')) this.worldRotation(`Foot${side}`, footRotation);
        const gesturing = (side === 'R' && (pose.gesture === 'throw' || pose.gesture === 'wave')) || pose.gesture === 'dance';
        if (!gesturing) {
          this.aim(`UpperArm${side}`, pose.working ? TYPING_ARM : DOWN);
          this.aim(`LowerArm${side}`, pose.working ? FORWARD : REST_FOREARM);
        }
        if (pose.working && !gesturing) {
          const hand = this.bone(`Wrist${side}`);
          if (hand) hand.quaternion.multiply(this.q1.setFromAxisAngle(UP, Math.sin(pose.time * 24 + (side === 'L' ? 0 : 2)) * 0.055));
        }
      }
      const head = this.bone('Head');
      if (pose.working && head) head.quaternion.multiply(this.q1.setFromEuler(this.headTilt.set(0.14 + Math.sin(pose.time * 1.3) * 0.025, Math.sin(pose.time * 0.7) * 0.055, 0)));
    }
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    for (const material of this.materials) material.dispose();
    const skeletons = new Set(this.skinned.map(mesh => mesh.skeleton));
    for (const skeleton of skeletons) skeleton.dispose();
    this.group.removeFromParent();
  }
}

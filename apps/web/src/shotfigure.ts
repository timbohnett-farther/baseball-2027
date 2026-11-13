import * as THREE from "three";
import { limb, mergeByMaterial } from "./rigutil.ts";
import { ANKLE, FOREARM, SHIN, THIGH, UPPER, pelvisHeight, type E3, type Pose } from "./shotscene.ts";

// W32c: a poseable twin of field.tsx's makePlayer for the action shots. Same proportions, materials and userData keys
// (so dress() works on it unchanged), but built as a joint hierarchy: pelvis, thighs/shins, torso, head, upper arms/forearms.
// Each joint group is merged by material, so a figure is a handful of draw calls like the live one.

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const down = (len: number) => V(0, -len, 0);
const std = (c: string | number | THREE.Color, roughness = 0.7) => new THREE.MeshStandardMaterial({ color: c, roughness });

export interface ShotParts {
  pelvis: THREE.Group; torso: THREE.Group; head: THREE.Group;
  thigh: THREE.Group[]; shin: THREE.Group[]; upper: THREE.Group[]; fore: THREE.Group[]; palm: THREE.Object3D[];
  bat: THREE.Group | null;
}
/** Index 0 is the figure's right (-x), index 1 its left (+x), matching the live rig's s = -1, +1. */
const SIDE = [-1, 1] as const;

/** `glove` is the palm index that wears the brown glove (0 = the figure's right, 1 = its left), or null for none (a runner). */
export function makeShotFigure(color: THREE.Color, skinHex: string, hasBat: boolean, ump = false, glove: 0 | 1 | null = 0): THREE.Group {
  const root = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const sleeveMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const capMat = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.8), roughness: 0.55 });
  const pants = std(ump ? "#7d8089" : "#ecebe4"), skin = std(skinHex, 0.65), dark = std("#1a1a1e", 0.6);
  const cleatMat = std("#1a1a1e", 0.6);
  const helmetMat = hasBat ? new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.8), roughness: 0.4 }) : capMat;
  const gloveMat = hasBat ? std(skinHex, 0.65) : skin;

  const pelvis = new THREE.Group(); pelvis.name = "pelvis";
  const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.16, 0.14, 14), pants);
  hips.position.y = 0.0; pelvis.add(hips);
  const parts: ShotParts = { pelvis, torso: new THREE.Group(), head: new THREE.Group(), thigh: [], shin: [], upper: [], fore: [], palm: [], bat: null };

  for (const s of SIDE) {
    const thigh = new THREE.Group(); thigh.position.set(s * 0.12, 0, 0);
    thigh.add(limb(V(0, 0, 0), down(THIGH), 0.085, pants, 0.072));
    const shin = new THREE.Group(); shin.position.y = -THIGH;
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.072, 10, 8), pants); shin.add(knee);
    shin.add(limb(V(0, 0, 0), down(SHIN * 0.3), 0.072, pants, 0.065), limb(down(SHIN * 0.3), down(SHIN - 0.02), 0.06, ump ? dark : capMat, 0.052));
    const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.29), cleatMat);
    cleat.position.set(0, -SHIN - ANKLE + 0.04 + 0.0, 0.05); cleat.castShadow = true; shin.add(cleat);
    mergeByMaterial(shin); thigh.add(shin); mergeByMaterial(thigh);
    pelvis.add(thigh); parts.thigh.push(thigh); parts.shin.push(shin);
  }

  // Waist 0.02 above the hip pivot; shoulders 0.49 above the waist; neck base at 0.55.
  const torso = parts.torso; torso.position.y = 0.02;
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.42, 6, 14), bodyMat); chest.position.y = 0.27; chest.castShadow = true;
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.185, 0.06, 14), dark);
  torso.add(chest, belt);

  const head = parts.head; head.position.y = 0.55;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), skin); neck.position.y = 0.04;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), skin); skull.position.y = 0.16; skull.castShadow = true;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(hasBat ? 0.13 : 0.122, 20, 12, 0, Math.PI * 2, 0, hasBat ? Math.PI * 0.6 : Math.PI / 2), helmetMat);
  cap.position.y = hasBat ? 0.17 : 0.16; cap.castShadow = true;
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.018, 0.11), helmetMat); brim.position.set(0, hasBat ? 0.17 : 0.16, 0.15);
  head.add(neck, skull, cap, brim);
  if (hasBat) { const flap = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.09), helmetMat); flap.position.set(0.12, 0.12, 0.01); head.add(flap); }
  mergeByMaterial(head); torso.add(head);

  for (const s of SIDE) {
    const upper = new THREE.Group(); upper.position.set(s * 0.23, 0.49, 0);
    upper.add(limb(V(0, 0, 0), down(UPPER), 0.062, sleeveMat, 0.05));
    const fore = new THREE.Group(); fore.position.y = -UPPER;
    fore.add(limb(V(0, 0, 0), down(FOREARM), 0.05, skin, 0.04));
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), gloveMat); palm.position.y = -FOREARM; fore.add(palm);
    if (!hasBat && !ump && glove !== null && SIDE[glove] === s) {
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), std("#6d4327", 0.7));
      glove.position.set(s * 0.03, -FOREARM - 0.02, 0.05); glove.scale.set(1, 1.15, 0.6); glove.castShadow = true; fore.add(glove);
    }
    mergeByMaterial(fore); upper.add(fore); mergeByMaterial(upper);
    torso.add(upper); parts.upper.push(upper); parts.fore.push(fore); parts.palm.push(palm);
  }
  mergeByMaterial(torso);

  if (hasBat) {
    const b = new THREE.Group(); b.name = "bat";
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.016, 0.86, 10), std("#c9a06a", 0.45)); stick.position.y = 0.43; stick.castShadow = true;
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.02, 10), std("#2a1d12", 0.5));
    b.add(stick, knob); torso.add(b); parts.bat = b;
  }
  pelvis.add(torso);
  mergeByMaterial(pelvis);
  root.add(pelvis);
  root.userData = { bodyMat, sleeveMat, capMat, cleatMat, helmetMat, gloveMat, skin: skinHex, bat: hasBat, parts };
  return root;
}

const e = (o: THREE.Object3D, v: E3) => o.rotation.set(v[0], v[1], v[2], "YXZ");
const UP = V(0, 1, 0);

/** Pose a shot figure: joint angles, then the pelvis height that plants the lower foot on the ground. */
export function applyPose(fig: THREE.Group, p: Pose) {
  const k = fig.userData.parts as ShotParts;
  k.pelvis.position.y = pelvisHeight(p);
  e(k.pelvis, p.hips); e(k.torso, p.torso); e(k.head, p.head);
  e(k.thigh[0], p.legR); e(k.thigh[1], p.legL); k.shin[0].rotation.set(p.shinR, 0, 0); k.shin[1].rotation.set(p.shinL, 0, 0);
  e(k.upper[0], p.armR); e(k.upper[1], p.armL); k.fore[0].rotation.set(p.foreR, 0, 0); k.fore[1].rotation.set(p.foreL, 0, 0);
  if (k.bat) {
    fig.updateMatrixWorld(true);
    const hand = k.torso.worldToLocal(k.palm[0].getWorldPosition(new THREE.Vector3()));
    k.bat.visible = !!p.bat;
    if (p.bat) { k.bat.position.copy(hand); k.bat.quaternion.setFromUnitVectors(UP, V(...p.bat).normalize()); }
  }
}

/** World position of a figure's palm (0 = the figure's right, 1 = its left), after applyPose. */
export function handWorld(fig: THREE.Group, side: 0 | 1, out = new THREE.Vector3()): THREE.Vector3 {
  fig.updateMatrixWorld(true);
  return (fig.userData.parts as ShotParts).palm[side].getWorldPosition(out);
}

const _S = new THREE.Vector3(), _d = new THREE.Vector3(), _dir = new THREE.Vector3(), _pole = new THREE.Vector3(), _el = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _fd = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _pq = new THREE.Quaternion();

/**
 * Two-bone reach: swing arm `idx` so its palm lands on `target` (world), or as far toward it as the arm reaches. Call after
 * applyPose (which sets joint Euler angles; this overwrites the upper arm's quaternion and the forearm's x rotation).
 * The elbow bends toward world down. Returns the palm-to-target distance left over (0 when reached).
 */
export function reachTo(fig: THREE.Group, idx: 0 | 1, target: THREE.Vector3): number {
  const k = fig.userData.parts as ShotParts, upper = k.upper[idx], fore = k.fore[idx];
  fig.updateMatrixWorld(true);
  upper.getWorldPosition(_S);
  _d.copy(target).sub(_S);
  const full = _d.length(), reach = UPPER + FOREARM - 0.005, D = Math.max(0.05, Math.min(full, reach));
  _dir.copy(_d).normalize();
  const cosA = Math.min(1, Math.max(-1, (UPPER * UPPER + D * D - FOREARM * FOREARM) / (2 * UPPER * D))), sinA = Math.sqrt(1 - cosA * cosA);
  _pole.set(0, -1, 0).addScaledVector(_dir, _dir.y); // world down, made perpendicular to the reach line
  if (_pole.lengthSq() < 1e-6) _pole.set(0, 0, 1).addScaledVector(_dir, -_dir.z);
  _pole.normalize();
  _el.copy(_dir).multiplyScalar(cosA).addScaledVector(_pole, sinA); // upper-arm direction in the world
  _fd.copy(_dir).multiplyScalar(D).addScaledVector(_el, -UPPER).normalize(); // forearm direction (elbow to palm)
  const cosP = Math.min(1, Math.max(-1, _el.dot(_fd))), sinP = Math.sqrt(1 - cosP * cosP);
  // Local axes: -y runs along the upper arm; the forearm flexes toward local +z.
  _y.copy(_el).negate();
  if (sinP > 1e-4) _z.copy(_fd).addScaledVector(_el, -cosP).divideScalar(sinP);
  else _z.copy(_pole).addScaledVector(_el, -_pole.dot(_el)).normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z); _q.setFromRotationMatrix(_m);
  (upper.parent as THREE.Object3D).getWorldQuaternion(_pq);
  upper.quaternion.copy(_pq.invert().multiply(_q));
  fore.rotation.set(-Math.acos(cosP), 0, 0);
  fig.updateMatrixWorld(true);
  return Math.max(0, full - reach);
}

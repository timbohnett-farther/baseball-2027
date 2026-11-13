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
/** Index 0 is the figure's right (-x, the glove side), index 1 its left (+x), matching the live rig's s = -1, +1. */
const SIDE = [-1, 1] as const;

export function makeShotFigure(color: THREE.Color, skinHex: string, hasBat: boolean, ump = false): THREE.Group {
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
    if (!hasBat && !ump && s < 0) {
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), std("#6d4327", 0.7));
      glove.position.set(-0.03, -FOREARM - 0.02, 0.05); glove.scale.set(1, 1.15, 0.6); glove.castShadow = true; fore.add(glove);
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

/** World position of a figure's palm (0 = right/glove side, 1 = left), after applyPose. */
export function handWorld(fig: THREE.Group, side: 0 | 1, out = new THREE.Vector3()): THREE.Vector3 {
  fig.updateMatrixWorld(true);
  return (fig.userData.parts as ShotParts).palm[side].getWorldPosition(out);
}

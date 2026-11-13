import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Tapered cylinder from one joint to the next (the whole rig is posed this way). */
export function limb(from: THREE.Vector3, to: THREE.Vector3, r: number, mat: THREE.Material, tip = r): THREE.Mesh {
  const d = to.clone().sub(from), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(tip, r, len, 10), mat);
  m.position.copy(from).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.castShadow = true;
  return m;
}

/**
 * Bake a parent's direct child meshes into one mesh per (material, shadow flags): same pixels, far fewer draw calls.
 * Materials stay the same instances, so later colour changes (dress()) still reach every merged piece.
 */
export function mergeByMaterial(parent: THREE.Object3D) {
  const buckets = new Map<string, THREE.Mesh[]>();
  for (const c of parent.children) {
    if (!(c instanceof THREE.Mesh) || Array.isArray(c.material)) continue;
    const key = `${c.material.uuid}|${+c.castShadow}${+c.receiveShadow}`;
    buckets.set(key, [...(buckets.get(key) ?? []), c]);
  }
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const baked = meshes.map((m) => { m.updateMatrix(); return m.geometry.clone().applyMatrix4(m.matrix); });
    const geo = mergeGeometries(baked);
    baked.forEach((b) => b.dispose());
    if (!geo) continue; // attribute mismatch: leave these meshes as they were
    const out = new THREE.Mesh(geo, meshes[0].material);
    out.castShadow = meshes[0].castShadow; out.receiveShadow = meshes[0].receiveShadow;
    parent.add(out);
    for (const m of meshes) { parent.remove(m); m.geometry.dispose(); }
  }
}

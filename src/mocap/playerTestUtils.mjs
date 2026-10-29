import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { Quaternion, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { modelTypes } from "../models";

/** The player models with their own GLB in public/. */
export const playerAssets = modelTypes.player.filter(
  (model) => model !== "hfemale",
);

export async function loadGlb(file) {
  const bytes = await readFile(
    new URL(`../../public/${file}.glb`, import.meta.url),
  );
  return new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
}

/** Heavy female uses the same mesh and skeleton as heavy male in the editor.
 * World matrices are not updated: Viewer.load creates the rig before that. */
export function loadPlayer(model, animated = false) {
  return loadGlb(
    `${model === "hfemale" ? "hmale" : model}${animated ? ".anim" : ""}`,
  );
}

export function bone(scene, name) {
  return scene.getObjectByName(`Bip01_${name}`);
}

export function bonePosition(scene, name) {
  return bone(scene, name).getWorldPosition(new Vector3());
}

export function boneQuaternion(scene, name) {
  return bone(scene, name).getWorldQuaternion(new Quaternion());
}

export function direction(scene, start, end) {
  return bonePosition(scene, end).sub(bonePosition(scene, start)).normalize();
}

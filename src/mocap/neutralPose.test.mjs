import { expect, test } from "vitest";
import { Quaternion, Vector3 } from "three";
import { createPlayerRig } from "./rig";
import { standardTPose } from "./neutralPoseTestUtils.mjs";
import { bone, direction, loadGlb, playerAssets } from "./playerTestUtils.mjs";

const files = playerAssets.flatMap((model) => [model, `${model}.anim`]);

async function load(name) {
  return (await loadGlb(name)).scene;
}

function expectDirection(actual, expected) {
  expect(actual.distanceTo(new Vector3(...expected))).toBeLessThan(1e-6);
}
function transforms(scene) {
  const result = new Map();
  scene.traverse((node) => result.set(node.name, {
    position: node.position.toArray(), quaternion: node.quaternion.toArray(), scale: node.scale.toArray(),
  }));
  return result;
}

test.each(files)("%s has a level head, shoulders, hips and limbs in the same standard T-pose", async (name) => {
  const scene = await load(name);
  const stock = transforms(scene);
  const rig = createPlayerRig(scene);
  expect(rig).not.toBeNull();
  try {
    rig.setSmoothing("none");
    rig.applyPose(standardTPose(), 1 / 60, 100);
    expectDirection(direction(scene, "R_UpperArm", "L_UpperArm"), [1, 0, 0]);
    expectDirection(direction(scene, "R_Thigh", "L_Thigh"), [1, 0, 0]);
    const head = bone(scene, "Head").getWorldQuaternion(new Quaternion());
    expectDirection(new Vector3(0, 0, 1).applyQuaternion(head), [0, 0, 1]);
    expectDirection(new Vector3(-1, 0, 0).applyQuaternion(head), [0, 1, 0]);
    for (const [side, sign] of [["L", 1], ["R", -1]]) {
      expectDirection(direction(scene, `${side}_UpperArm`, `${side}_Forearm`), [sign, 0, 0]);
      expectDirection(direction(scene, `${side}_Forearm`, `${side}_Hand`), [sign, 0, 0]);
      expectDirection(direction(scene, `${side}_Thigh`, `${side}_Calf`), [0, -1, 0]);
      expectDirection(direction(scene, `${side}_Calf`, `${side}_Foot`), [0, -1, 0]);
      const hand = bone(scene, `${side}_Hand`).getWorldQuaternion(new Quaternion());
      expectDirection(new Vector3(-1, 0, 0).applyQuaternion(hand), [sign, 0, 0]);
      expectDirection(new Vector3(0, 0, 1).applyQuaternion(hand), [0, -1, 0]);
      const foot = bone(scene, `${side}_Foot`).getWorldQuaternion(new Quaternion());
      expectDirection(new Vector3(0, 0, 1).applyQuaternion(foot), [0, 0, 1]);
      expectDirection(new Vector3(1, 0, 0).applyQuaternion(foot), [0, 1, 0]);
    }
    // Stock spines retain slight authored curvature and lateral offsets. A
    // level T-pose does not require rebinding their mesh or translating bones.
    for (const [node, posed] of transforms(scene)) {
      expect(posed.position).toEqual(stock.get(node).position);
      expect(posed.scale).toEqual(stock.get(node).scale);
      expect(posed.quaternion.every(Number.isFinite)).toBe(true);
    }
    rig.reset();
    expect(transforms(scene)).toEqual(stock);
  } finally {
    rig.dispose();
  }
});

test.each(playerAssets)("%s static and animated assets use identical neutral rigs", async (model) => {
  const scenes = await Promise.all([load(model), load(`${model}.anim`)]);
  expect(transforms(scenes[0])).toEqual(transforms(scenes[1]));
  const rigs = scenes.map(createPlayerRig);
  try {
    for (const rig of rigs) {
      rig.setSmoothing("none");
      rig.applyPose(standardTPose(), 1 / 60, 100);
    }
    expect(transforms(scenes[0])).toEqual(transforms(scenes[1]));
  } finally {
    rigs.forEach((rig) => rig.dispose());
  }
});

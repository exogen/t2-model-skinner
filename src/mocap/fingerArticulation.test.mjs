import { expect, test } from "vitest";
import { AnimationMixer, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { modelTypes } from "../models";
import Viewer from "../Viewer";
import { createPlayerRig } from "./rig";
import { neutralBodyPose, trackedHand } from "./handTestUtils.mjs";
import { recordedHands } from "./recordedHandsTestUtils.mjs";
import { loadPlayer, playerAssets } from "./playerTestUtils.mjs";
import { expectUnmoved, maxMovement, snapshot, vertices } from "./skinTestUtils.mjs";

function weight({ mesh, index }, bone) {
  if (!mesh.isSkinnedMesh) return 0;
  const joint = mesh.skeleton.bones.indexOf(bone);
  if (joint < 0) return 0;
  const indices = mesh.geometry.attributes.skinIndex;
  const weights = mesh.geometry.attributes.skinWeight;
  let total = 0;
  for (let component = 0; component < 4; component++) {
    if (indices.getComponent(index, component) === joint) total += weights.getComponent(index, component);
  }
  return total;
}

const cases = modelTypes.player.flatMap((model) => [false, true].flatMap((animated) =>
  ["left", "right"].map((side) => ({ model, animated, side }))));

test.each(playerAssets)("%s uses real recorded hand palm facing rather than the coarse pose fingertips", async (model) => {
  const { scene } = await loadPlayer(model, false);
  const rig = createPlayerRig(scene);
  rig.setSmoothing("none");
  rig.applyPose(neutralBodyPose(), 1 / 60, 100, recordedHands());
  for (const [side, sign] of [["L", -1], ["R", 1]]) {
    const wrist = scene.getObjectByName(`Bip01_${side}_Hand`);
    const normal = new Vector3(0, 0, 1).applyQuaternion(wrist.getWorldQuaternion(new Quaternion()));
    expect(normal.z * sign).toBeGreaterThan(0.8);
    expect(scene.getObjectByName(`Bip01_${side}_Fingers`).quaternion.toArray().every(Number.isFinite)).toBe(true);
    expect(scene.getObjectByName(`Bip01_${side}_Thumb`).quaternion.toArray().every(Number.isFinite)).toBe(true);
  }
  rig.dispose();
});

test.each(cases)("$model $side fingers and thumb move actual mesh independently of the wrist (animated: $animated)", async ({ model, animated, side }) => {
  const { scene } = await loadPlayer(model, animated);
  scene.updateWorldMatrix(true, true);
  const all = vertices(scene);
  const stock = snapshot(all);
  const prefix = `Bip01_${side === "left" ? "L" : "R"}_`;
  const wrist = scene.getObjectByName(`${prefix}Hand`);
  const fingers = scene.getObjectByName(`${prefix}Fingers`);
  const thumb = scene.getObjectByName(`${prefix}Thumb`);
  expect(fingers).toBeDefined();
  expect(thumb).toBeDefined();
  expect(fingers.parent).toBe(wrist);
  expect(thumb.parent).toBe(wrist);
  const handLength = scene.getObjectByName(`${prefix}FingersTip`).getWorldPosition(new Vector3())
    .distanceTo(wrist.getWorldPosition(new Vector3()));
  const fingerVertices = all.filter((sample) => weight(sample, fingers) > 0.5);
  const thumbVertices = all.filter((sample) => weight(sample, thumb) > 0.5);
  expect(fingerVertices.length).toBeGreaterThan(3);
  expect(thumbVertices.length).toBeGreaterThan(2);
  const rig = createPlayerRig(scene);
  const body = neutralBodyPose();
  const otherSide = side === "left" ? "right" : "left";
  const apply = (settings, time) => rig.applyPose(body, 1 / 60, time, [trackedHand(side, settings), trackedHand(otherSide)]);
  try {
    rig.setSmoothing("none");
    apply({}, 100);
    const wristRotation = wrist.getWorldQuaternion(new Quaternion());
    const forward = new Vector3(side === "left" ? 1 : -1, 0, 0);
    expect(new Vector3(-1, 0, 0).applyQuaternion(wristRotation).distanceTo(forward)).toBeLessThan(1e-6);
    expect(new Vector3(0, 0, 1).applyQuaternion(wristRotation).distanceTo(new Vector3(0, -1, 0))).toBeLessThan(1e-6);
    const fingerStart = snapshot(fingerVertices);
    const fixedOnFingerCurl = snapshot(all.filter((sample) => weight(sample, fingers) === 0));
    apply({ curl: 0.7, pip: 1, dip: 0.5 }, 200);
    expect(wrist.getWorldQuaternion(new Quaternion()).angleTo(wristRotation)).toBeLessThan(1e-6);
    expectUnmoved(fixedOnFingerCurl);
    expect(maxMovement(fingerStart)).toBeGreaterThan(handLength * 0.1);

    apply({}, 300);
    const thumbStart = snapshot(thumbVertices);
    const fixedOnThumbFlex = snapshot(all.filter((sample) => weight(sample, thumb) === 0));
    apply({ thumbCurl: 0.5, thumbOpposition: 1.2 }, 400);
    expect(wrist.getWorldQuaternion(new Quaternion()).angleTo(wristRotation)).toBeLessThan(1e-6);
    expectUnmoved(fixedOnThumbFlex);
    expect(maxMovement(thumbStart)).toBeGreaterThan(handLength * 0.1);

    const roll = new Quaternion().setFromAxisAngle(forward, Math.PI / 2);
    apply({ rotation: roll }, 450);
    expect(wrist.getWorldQuaternion(new Quaternion()).angleTo(roll.clone().multiply(wristRotation))).toBeLessThan(1e-6);

    // Missing detail returns the added joints to the stock grip without
    // requiring a camera/session restart or removing its source skin weights.
    rig.applyPose(body, 1 / 60, 500);
    expect(fingers.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-6);
    expect(thumb.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-6);
    rig.reset();
    expectUnmoved(stock);
  } finally {
    rig.dispose();
  }
});

test.each(playerAssets)("%s exact animated geometry resumes after detailed hand motion/reset", async (model) => {
  const gltf = await loadPlayer(model, true);
  const { scene, animations } = gltf;
  const rig = createPlayerRig(scene);
  const mixer = new AnimationMixer(scene);
  const clip = animations.find((animation) => /forward/i.test(animation.name)) ?? animations[0];
  expect(clip).toBeDefined();
  const viewer = Object.assign(Object.create(Viewer.prototype), {
    model: gltf, rig, mixer, action: null, posing: false, paused: false,
    playbackSpeed: 1, poseAnimationTime: 0, camera: new PerspectiveCamera(),
    controls: { target: new Vector3(), update() {} }, invalidate() {},
  });
  viewer.setAnimation(clip.name, false, 1);
  mixer.update(0.35);
  scene.updateWorldMatrix(true, true);
  const animated = snapshot(vertices(scene));
  viewer.setPoseMode(true);
  rig.setSmoothing("none");
  rig.applyPose(neutralBodyPose(), 1 / 60, 100, [
    trackedHand("left", { curl: 1, pip: 0.6, thumbCurl: 0.6, thumbOpposition: 1.1 }),
    trackedHand("right", { curl: 0.7, pip: 0.6, thumbCurl: 0.8, thumbOpposition: 1.2 }),
  ]);
  viewer.setPoseMode(false);
  scene.updateWorldMatrix(true, true);
  expectUnmoved(animated);
  expect(viewer.action.time).toBeCloseTo(0.35);
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
  rig.dispose();
});

test.each(["none", "classic"])("fingers stay on their curl axis while a %s-smoothed wrist swings", async (smoothing) => {
  const { scene } = await loadPlayer("lmale");
  const rig = createPlayerRig(scene);
  rig.setSmoothing(smoothing);
  const fingers = scene.getObjectByName("Bip01_L_Fingers");
  let worst = 0;
  // Render at 120 Hz with camera samples at 30 Hz, so the wrist lags its target.
  for (let frame = 0; frame < 240; frame++) {
    const sample = Math.floor(frame / 4);
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.2 * Math.sin(sample / 30 * 2 * Math.PI));
    rig.applyPose(neutralBodyPose(), 1 / 120, sample * 1000 / 30, [trackedHand("left", { curl: 0.6, rotation })]);
    const { x, z } = fingers.quaternion;
    worst = Math.max(worst, 2 * Math.asin(Math.min(1, Math.hypot(x, z))));
  }
  expect(worst).toBeLessThan(0.01);
});

import { expect, test } from "vitest";
import { AnimationMixer, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { modelTypes } from "../models";
import { createPlayerRig } from "./rig";
import Viewer from "../Viewer";
import { neutralBodyPose, rotateLandmarks, toModel } from "./handTestUtils.mjs";
import { bone, loadPlayer } from "./playerTestUtils.mjs";
import { expectUnmoved, maxMovement, snapshot, vertices, worldVertex } from "./skinTestUtils.mjs";

function wristRegions(scene, side) {
  const forearm = bone(scene, `${side}_Forearm`);
  const hand = bone(scene, `${side}_Hand`);
  const elbow = forearm.getWorldPosition(new Vector3());
  const wrist = hand.getWorldPosition(new Vector3());
  const length = elbow.distanceTo(wrist);
  const outward = wrist.clone().sub(elbow).normalize();
  const samples = vertices(scene, (mesh) => mesh.isSkinnedMesh &&
    mesh.skeleton.bones.some((joint) => joint === forearm || joint === hand));
  const separateHand = samples.filter(({ mesh }) => mesh.skeleton.bones.includes(hand));
  // Select actual geometry by anatomy. Heavy Bioderm's left mitt shares a
  // two-joint mesh with its forearm; other mitts use separate rigid meshes.
  // Exclude the cuff blend from both rigid regions.
  const alongArm = (sample) => worldVertex(sample).sub(wrist).dot(outward) / length;
  return {
    hand: (separateHand.length ? separateHand : samples).filter((sample) => alongArm(sample) > 0.2),
    forearm: samples.filter((sample) => sample.mesh.skeleton.bones.includes(forearm) &&
      (!sample.mesh.skeleton.bones.includes(hand) || alongArm(sample) < -0.2)),
    samples,
    length,
  };
}

function rotateHandLandmarks(pose, side, rotation) {
  const offset = side === "L" ? 0 : 1;
  return rotateLandmarks(pose, [17 + offset, 19 + offset], rotation, toModel(pose[15 + offset]));
}

const cases = modelTypes.player.flatMap((model) => [false, true].flatMap((animated) =>
  ["L", "R"].flatMap((side) => ["bend", "roll"].map((motion) => ({ model, animated, side, motion })))));

test.each(cases)("$model $side wrist $motion deforms the visible mitt independently and resets to stock (animated: $animated)", async ({ model, animated, side, motion }) => {
  const { scene } = await loadPlayer(model, animated);
  scene.updateWorldMatrix(true, true);
  const stock = snapshot(vertices(scene));
  const regions = wristRegions(scene, side);
  const other = wristRegions(scene, side === "L" ? "R" : "L");
  const upperArm = bone(scene, `${side}_UpperArm`);
  const upperArmVertices = vertices(scene, (mesh) => mesh.isSkinnedMesh && mesh.skeleton.bones.includes(upperArm));
  expect(regions.hand.length).toBeGreaterThan(3);
  expect(regions.forearm.length).toBeGreaterThan(3);
  expect(other.hand.length).toBeGreaterThan(3);
  expect(upperArmVertices.length).toBeGreaterThan(3);
  const rig = createPlayerRig(scene);
  expect(rig).not.toBeNull();
  try {
    rig.setSmoothing("none");
    const pose = neutralBodyPose();
    rig.applyPose(pose, 1 / 60, 100);
    const handBefore = snapshot(regions.hand);
    const fixed = snapshot([...regions.forearm, ...upperArmVertices, ...other.samples]);
    const wrist = bone(scene, `${side}_Hand`).getWorldPosition(new Vector3());
    const forearmRotation = bone(scene, `${side}_Forearm`).getWorldQuaternion(new Quaternion());
    const sign = side === "L" ? 1 : -1;
    const rotation = motion === "bend"
      ? new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), sign * Math.PI / 2)
      : new Quaternion().setFromAxisAngle(new Vector3(sign, 0, 0), Math.PI / 2);
    rig.applyPose(rotateHandLandmarks(pose, side, rotation), 1 / 60, 133);

    const tolerance = regions.length * 1e-4;
    expect(maxMovement(handBefore), "the rendered hand must move, not only its joint node")
      .toBeGreaterThan(regions.length * 0.02);
    for (const { sample, position } of handBefore) {
      const expected = position.clone().sub(wrist).applyQuaternion(rotation).add(wrist);
      expect(worldVertex(sample).distanceTo(expected), `${sample.mesh.name} vertex ${sample.index}`)
        .toBeLessThan(tolerance);
    }
    expectUnmoved(fixed, { tolerance });
    expect(bone(scene, `${side}_Hand`).getWorldPosition(new Vector3()).distanceTo(wrist)).toBeLessThan(tolerance);
    expect(bone(scene, `${side}_Forearm`).getWorldQuaternion(new Quaternion()).angleTo(forearmRotation)).toBeLessThan(1e-6);

    rig.reset();
    expectUnmoved(stock, { tolerance });
  } finally {
    rig.dispose();
  }
});

test("heavy Bioderm restores stock skinned vertices and animation playback when live wrists stop", async () => {
  const gltf = await loadPlayer("hbioderm", true);
  gltf.scene.updateWorldMatrix(true, true);
  const reference = await loadPlayer("hbioderm", true);
  reference.scene.updateWorldMatrix(true, true);
  const rig = createPlayerRig(gltf.scene);
  const viewer = Object.assign(Object.create(Viewer.prototype), {
    model: gltf, rig, mixer: new AnimationMixer(gltf.scene), action: null,
    posing: false, paused: false, playbackSpeed: 1, poseAnimationTime: 0,
    camera: new PerspectiveCamera(), controls: { target: new Vector3(), update() {} },
    invalidate() {},
  });
  const referenceMixer = new AnimationMixer(reference.scene);
  const clip = reference.animations.find((clip) => clip.name === "Forward");
  expect(clip).toBeDefined();
  const elapsed = clip.duration * 0.37;
  referenceMixer.clipAction(clip).play();
  referenceMixer.update(elapsed);
  reference.scene.updateWorldMatrix(true, true);
  viewer.setAnimation("Forward", false, 1);
  viewer.mixer.update(elapsed);
  gltf.scene.updateWorldMatrix(true, true);
  const samples = vertices(gltf.scene);
  const animated = snapshot(samples);
  const tolerance = 1e-7;
  try {
    viewer.setPoseMode(true);
    rig.setSmoothing("none");
    let pose = neutralBodyPose();
    for (const side of ["L", "R"]) {
      pose = rotateHandLandmarks(pose, side,
        new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2));
    }
    rig.applyPose(pose, 1 / 60, 100);
    expect(animated.some(({ sample, position }) => worldVertex(sample).distanceTo(position) > 1e-4)).toBe(true);
    viewer.setPoseMode(false);
    gltf.scene.updateWorldMatrix(true, true);
    expect(viewer.action.time).toBeCloseTo(elapsed, 10);
    expectUnmoved(animated, { tolerance });

    viewer.mixer.update(0.11);
    referenceMixer.update(0.11);
    gltf.scene.updateWorldMatrix(true, true);
    reference.scene.updateWorldMatrix(true, true);
    const expected = vertices(reference.scene);
    expect(samples).toHaveLength(expected.length);
    samples.forEach((sample, index) => {
      expect(sample.mesh.name).toBe(expected[index].mesh.name);
      expect(worldVertex(sample).distanceTo(worldVertex(expected[index])), `${sample.mesh.name} vertex ${sample.index}`)
        .toBeLessThan(tolerance);
    });
  } finally {
    viewer.mixer.stopAllAction();
    referenceMixer.stopAllAction();
    rig.dispose();
  }
});

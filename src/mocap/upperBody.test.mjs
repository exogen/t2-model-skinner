import { expect, test } from "vitest";
import { Quaternion, Vector3 } from "three";
import { createPlayerRig } from "./rig";
import { neutralBodyPose, rotateLandmarks } from "./handTestUtils.mjs";
import {
  bone,
  boneQuaternion,
  loadPlayer,
  playerAssets,
} from "./playerTestUtils.mjs";

const upperPoints = [0, 7, 8, 11, 12, 13, 14, 15, 16];

async function loadRig(name) {
  const { scene } = await loadPlayer(name);
  const rig = createPlayerRig(scene);
  rig.setSmoothing("none");
  return { scene, rig };
}

const pose = () => neutralBodyPose({ hands: false });

// Inspect rendered vertices whose skin weights actually belong to the chest,
// rather than treating changes to an unused transform as visible articulation.
function chestVertices(scene) {
  const vertices = [];
  scene.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
    for (let index = 0; index < position.count; index++) {
      let chest = false;
      for (let component = 0; component < 4; component++) {
        const joint =
          mesh.skeleton.bones[skinIndex.getComponent(index, component)];
        if (
          skinWeight.getComponent(index, component) > 0.5 &&
          /^Bip01_Spine[12]$/.test(joint.name)
        )
          chest = true;
      }
      if (chest)
        vertices.push(
          mesh
            .applyBoneTransform(
              index,
              new Vector3().fromBufferAttribute(position, index),
            )
            .applyMatrix4(mesh.matrixWorld),
        );
    }
  });
  return vertices;
}

test.each(playerAssets)(
  "%s bends its spine for forward lean while pelvis and leg attachments stay stable",
  async (name) => {
    const { scene, rig } = await loadRig(name);
    rig.applyPose(pose(), 1 / 60, 0);
    const pelvis = boneQuaternion(scene, "Pelvis");
    const upperSpine = bone(scene, "Spine2");
    const chestName = upperSpine ? "Spine2" : "Spine1";
    const chestBefore = boneQuaternion(scene, chestName);
    const spineBefore = bone(scene, "Spine1").quaternion.clone();
    const upperBefore = upperSpine?.quaternion.clone();
    const verticesBefore = chestVertices(scene);
    const legs = [
      "L_Thigh",
      "R_Thigh",
      "L_Calf",
      "R_Calf",
      "L_Foot",
      "R_Foot",
    ].map((part) => ({
      part,
      position: bone(scene, part).getWorldPosition(new Vector3()),
    }));
    const bend = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      Math.PI / 6,
    );
    rig.applyPose(rotateLandmarks(pose(), upperPoints, bend), 1 / 60, 100);

    expect(boneQuaternion(scene, "Pelvis").angleTo(pelvis)).toBeLessThan(1e-6);
    expect(
      boneQuaternion(scene, chestName).angleTo(chestBefore.premultiply(bend)),
    ).toBeLessThan(1e-6);
    expect(spineBefore.angleTo(bone(scene, "Spine1").quaternion)).toBeCloseTo(
      upperSpine ? Math.PI / 12 : Math.PI / 6,
    );
    if (upperSpine)
      expect(upperBefore.angleTo(upperSpine.quaternion)).toBeCloseTo(
        Math.PI / 12,
      );
    for (const { part, position } of legs)
      expect(
        bone(scene, part).getWorldPosition(new Vector3()).distanceTo(position),
      ).toBeLessThan(1e-8);
    const after = chestVertices(scene);
    expect(after.length).toBeGreaterThan(0);
    expect(
      Math.max(
        ...after.map((point, index) => point.distanceTo(verticesBefore[index])),
      ),
    ).toBeGreaterThan(0.0001);
  },
);

test.each(playerAssets)(
  "%s keeps torso side lean, twist, and independent head turns after separating pelvic pitch",
  async (name) => {
    const { scene, rig } = await loadRig(name);
    const chestName = bone(scene, "Spine2") ? "Spine2" : "Spine1";
    for (const [axis, angle] of [
      [new Vector3(0, 0, 1), Math.PI / 9],
      [new Vector3(0, 1, 0), Math.PI / 4],
    ]) {
      rig.reset();
      rig.applyPose(pose(), 1 / 60, 0);
      const pelvis = boneQuaternion(scene, "Pelvis");
      const chest = boneQuaternion(scene, chestName);
      const rotation = new Quaternion().setFromAxisAngle(axis, angle);
      const turned = rotateLandmarks(pose(), upperPoints, rotation);
      rig.applyPose(turned, 1 / 60, 100);
      expect(boneQuaternion(scene, "Pelvis").angleTo(pelvis)).toBeLessThan(
        1e-6,
      );
      expect(
        boneQuaternion(scene, chestName).angleTo(chest.premultiply(rotation)),
      ).toBeLessThan(1e-6);
      const neckBefore = boneQuaternion(scene, "Neck");
      const shoulderBefore = bone(scene, "L_UpperArm").getWorldPosition(
        new Vector3(),
      );
      const headBefore = boneQuaternion(scene, "Head");
      const ears = new Vector3(
        turned[7].x + turned[8].x,
        -turned[7].y - turned[8].y,
        -turned[7].z - turned[8].z,
      ).multiplyScalar(0.5);
      const turn = new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        Math.PI / 4,
      );
      rig.applyPose(
        rotateLandmarks(turned, [0, 7, 8], turn, ears),
        1 / 60,
        200,
      );
      expect(
        boneQuaternion(scene, "Head").angleTo(headBefore.premultiply(turn)),
      ).toBeLessThan(1e-6);
      expect(boneQuaternion(scene, "Neck").angleTo(neckBefore)).toBeLessThan(
        1e-6,
      );
      expect(
        bone(scene, "L_UpperArm")
          .getWorldPosition(new Vector3())
          .distanceTo(shoulderBefore),
      ).toBeLessThan(1e-8);
    }
  },
);

test("observable pelvic yaw and roll still follow the hip line", async () => {
  const { scene, rig } = await loadRig("lmale");
  for (const axis of [new Vector3(0, 1, 0), new Vector3(0, 0, 1)]) {
    rig.reset();
    rig.applyPose(pose(), 1 / 60, 0);
    const before = boneQuaternion(scene, "Pelvis");
    const rotation = new Quaternion().setFromAxisAngle(axis, Math.PI / 6);
    const points = pose();
    rig.applyPose(
      rotateLandmarks(
        points,
        points.flatMap((point, index) => (point.visibility ? [index] : [])),
        rotation,
      ),
      1 / 60,
      100,
    );
    expect(
      boneQuaternion(scene, "Pelvis").angleTo(before.premultiply(rotation)),
    ).toBeLessThan(1e-6);
  }
});

test("missing hips remain finite and reset restores every original upper-body transform", async () => {
  const { scene, rig } = await loadRig("lbioderm");
  const saved = [];
  scene.traverse((node) =>
    saved.push({
      node,
      quaternion: node.quaternion.clone(),
      position: node.position.clone(),
    }),
  );
  const points = rotateLandmarks(
    pose(),
    upperPoints,
    new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.5),
  );
  rig.applyPose(points, 1 / 60, 0);
  points[23].visibility = points[24].visibility = 0;
  rig.applyPose(points, 1 / 60, 100);
  for (const { node } of saved)
    expect(node.quaternion.toArray().every(Number.isFinite)).toBe(true);
  rig.reset();
  for (const { node, quaternion, position } of saved) {
    expect(node.quaternion.equals(quaternion)).toBe(true);
    expect(node.position.equals(position)).toBe(true);
  }
});

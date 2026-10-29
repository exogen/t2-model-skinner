import { expect, test } from "vitest";
import { Quaternion, Vector3 } from "three";
import { mirrorPoseLandmarks } from "./mirrorPose";
import { createPlayerRig } from "./rig";
import { neutralBodyPose, toModel } from "./handTestUtils.mjs";
import {
  bone,
  direction,
  loadPlayer,
  playerAssets,
} from "./playerTestUtils.mjs";

const cases = playerAssets.flatMap((model) =>
  ["L", "R"].map((side) => ({ model, side })),
);

function point(pose, index) {
  return toModel(pose[index]);
}
function reflect(vector) {
  return new Vector3(-vector.x, vector.y, vector.z);
}
function axis(scene, name, local) {
  return local
    .clone()
    .applyQuaternion(bone(scene, name).getWorldQuaternion(new Quaternion()));
}
function expectDirection(actual, expected) {
  expect(actual.dot(expected.clone().normalize())).toBeGreaterThan(0.9999);
}

function asymmetricPose(side) {
  const pose = neutralBodyPose({ hands: false });
  const set = (index, x, y, z) => {
    pose[index] = { x, y: -y, z: -z, visibility: 1 };
  };
  // The torso faces the camera while the head looks 30 degrees sideways.
  const yaw = Math.PI / 6;
  set(0, Math.sin(yaw) * 0.12, 1.75, Math.cos(yaw) * 0.12);
  set(7, Math.cos(yaw) * 0.1, 1.75, -Math.sin(yaw) * 0.1);
  set(8, -Math.cos(yaw) * 0.1, 1.75, Math.sin(yaw) * 0.1);
  const offset = side === "L" ? 0 : 1;
  const sign = side === "L" ? 1 : -1;
  // Only this arm is raised and only this knee is bent.
  set(13 + offset, sign * 0.35, 1.8, 0.1);
  set(15 + offset, sign * 0.4, 2.1, 0.05);
  set(25 + offset, sign * 0.2, 0.6, 0.2);
  set(27 + offset, sign * 0.45, 0.55, 0.5);
  for (const index of [0, 1]) {
    const wrist = point(pose, 15 + index);
    const handSign = index === 0 ? 1 : -1;
    // A pitched palm with measurable roll distinguishes a reflected wrist
    // from a side swap that accidentally leaves palm orientation reversed.
    set(19 + index, wrist.x + handSign * 0.16, wrist.y + 0.06, wrist.z + 0.07);
    set(17 + index, wrist.x + handSign * 0.16, wrist.y + 0.06, wrist.z - 0.01);
    const ankle = point(pose, 27 + index);
    set(29 + index, ankle.x - handSign * 0.03, ankle.y - 0.1, ankle.z - 0.06);
    set(31 + index, ankle.x + handSign * 0.05, ankle.y - 0.1, ankle.z + 0.18);
  }
  return pose;
}

test.each(cases)(
  "$model mirrors $side arm, leg, wrist and gaze onto the preview's screen side",
  async ({ model, side }) => {
    const { scene } = await loadPlayer(model);
    const rig = createPlayerRig(scene);
    expect(rig).not.toBeNull();
    const pose = asymmetricPose(side);
    const indexOffset = side === "L" ? 0 : 1;
    const otherSide = side === "L" ? "R" : "L";
    try {
      rig.setSmoothing("none");
      // The raw solver still maps anatomical left to the asset's left bones.
      rig.applyPose(pose, 1 / 60, 100);
      const sourceArm = direction(scene, `${side}_UpperArm`, `${side}_Forearm`);
      expectDirection(
        sourceArm,
        point(pose, 13 + indexOffset).sub(point(pose, 11 + indexOffset)),
      );
      expect(sourceArm.y).toBeGreaterThan(0.9);
      const torso = bone(scene, "Spine1").getWorldQuaternion(new Quaternion());
      const expectedHead = reflect(
        point(pose, 0).sub(
          point(pose, 7).add(point(pose, 8)).multiplyScalar(0.5),
        ),
      );
      const wrist = point(pose, 15 + indexOffset);
      const handDirection = point(pose, 19 + indexOffset)
        .add(point(pose, 17 + indexOffset))
        .multiplyScalar(0.5)
        .sub(wrist);
      const handNormal = handDirection
        .clone()
        .cross(
          point(pose, 19 + indexOffset).sub(point(pose, 17 + indexOffset)),
        );
      if (side === "R") handNormal.negate();

      rig.applyPose(mirrorPoseLandmarks(pose), 1 / 60, 133);
      for (const [start, end, startIndex, endIndex] of [
        ["UpperArm", "Forearm", 11, 13],
        ["Forearm", "Hand", 13, 15],
        ["Thigh", "Calf", 23, 25],
        ["Calf", "Foot", 25, 27],
      ]) {
        expectDirection(
          direction(scene, `${otherSide}_${start}`, `${otherSide}_${end}`),
          reflect(
            point(pose, endIndex + indexOffset).sub(
              point(pose, startIndex + indexOffset),
            ),
          ),
        );
      }
      // Default camera looks from +Z: mirrored raw +X gestures belong on
      // screen-left, where the front-facing model's anatomical right is.
      const raisedShoulder = bone(
        scene,
        `${otherSide}_UpperArm`,
      ).getWorldPosition(new Vector3());
      expect(Math.sign(raisedShoulder.x)).toBe(side === "L" ? -1 : 1);
      expect(
        direction(scene, `${otherSide}_UpperArm`, `${otherSide}_Forearm`).y,
      ).toBeGreaterThan(0.9);
      expectDirection(
        direction(scene, `${side}_UpperArm`, `${side}_Forearm`),
        new Vector3(side === "L" ? 1 : -1, 0, 0),
      );
      expectDirection(
        direction(scene, `${side}_Thigh`, `${side}_Calf`),
        new Vector3(0, -1, 0),
      );
      expectDirection(
        axis(scene, `${otherSide}_Hand`, new Vector3(-1, 0, 0)),
        reflect(handDirection),
      );
      expectDirection(
        axis(scene, `${otherSide}_Hand`, new Vector3(0, 0, 1)),
        reflect(handNormal),
      );
      expectDirection(
        axis(scene, `${otherSide}_Foot`, new Vector3(0, 0, 1)),
        reflect(
          point(pose, 31 + indexOffset).sub(point(pose, 29 + indexOffset)),
        ),
      );
      expectDirection(axis(scene, "Head", new Vector3(0, 0, 1)), expectedHead);
      expect(axis(scene, "Head", new Vector3(-1, 0, 0)).y).toBeGreaterThan(
        0.9999,
      );
      // Reflecting X without relabeling sides would rotate this torso by 180°.
      expect(
        bone(scene, "Spine1")
          .getWorldQuaternion(new Quaternion())
          .angleTo(torso),
      ).toBeLessThan(1e-6);
    } finally {
      rig.dispose();
    }
  },
);

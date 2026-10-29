import { expect } from "vitest";
import { Box3, PerspectiveCamera, Vector3 } from "three";
import { emptyPose } from "./handTestUtils.mjs";
import { loadPlayer } from "./playerTestUtils.mjs";

export const torso = [
  [11, "L_UpperArm"],
  [12, "R_UpperArm"],
  [23, "L_Thigh"],
  [24, "R_Thigh"],
];

/** A player in front of a 30° camera aimed at its bounds, with a framing for it. */
export async function framedPlayer(
  name,
  createFraming,
  { aspect = 1.2, offset = [0, 0, 0] } = {},
) {
  const gltf = await loadPlayer(name);
  const root = gltf.scene;
  root.position.set(...offset);
  root.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(root, true);
  const center = box.getCenter(new Vector3());
  const radius = box.getSize(new Vector3()).length() / 2;
  const camera = new PerspectiveCamera(30, aspect, radius / 100, radius * 100);
  camera.position.copy(center).add(new Vector3(0, radius / 2, radius * 8));
  camera.lookAt(center);
  camera.updateWorldMatrix(true, false);
  return { root, camera, gltf, center, radius, framing: createFraming(root) };
}

export function projectPose(
  root,
  camera,
  transform,
  imageAspect = camera.aspect,
) {
  root.updateWorldMatrix(true, true);
  const pose = emptyPose();
  const width = Math.min(1, imageAspect / camera.aspect);
  const height = Math.min(1, camera.aspect / imageAspect);
  for (const [index, name] of torso) {
    const projected = root
      .getObjectByName(`Bip01_${name}`)
      .getWorldPosition(new Vector3())
      .project(camera);
    pose[index] = {
      x: ((projected.x * transform.scale + transform.x) / width + 1) / 2,
      y: (1 - (projected.y * transform.scale + transform.y) / height) / 2,
      z: 0,
      visibility: 1,
      presence: 1,
    };
    expect(pose[index].x).toBeGreaterThan(0);
    expect(pose[index].x).toBeLessThan(1);
    expect(pose[index].y).toBeGreaterThan(0);
    expect(pose[index].y).toBeLessThan(1);
  }
  return pose;
}

export function facePose({ mouth = true } = {}) {
  const pose = emptyPose();
  for (const [index, x, y] of [
    [0, 0.5, 0.54],
    [2, 0.59, 0.42],
    [5, 0.41, 0.42],
    [7, 0.72, 0.42],
    [8, 0.28, 0.42],
    ...(mouth
      ? [
          [9, 0.56, 0.63],
          [10, 0.44, 0.63],
        ]
      : []),
  ]) {
    pose[index] = { x, y, z: 0, visibility: 1, presence: 1 };
  }
  return pose;
}

export function expectTransform(actual, expected) {
  expect(actual).not.toBeNull();
  for (const key of ["scale", "x", "y"])
    expect(actual[key]).toBeCloseTo(expected[key], 9);
}

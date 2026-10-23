import { expect, test } from "vitest";
import { canFrame, createCameraFraming } from "./cameraFraming";
import { emptyPose } from "./handTestUtils.mjs";
import { expectTransform, facePose, framedPlayer, projectPose } from "./framingTestUtils.mjs";
import { playerAssets } from "./playerTestUtils.mjs";

function load(name, aspect) {
  return framedPlayer(name, createCameraFraming, { aspect });
}

test.each(playerAssets)("%s reconstructs camera position and scale from actual posed torso joints", async (name) => {
  const { root, camera, framing } = await load(name);
  const before = root.position.clone();
  const scale = root.scale.clone();
  const transform = { scale: 2.2, x: -0.18, y: 0.11 };
  const pose = projectPose(root, camera, transform);
  expectTransform(framing.measure(camera, pose, camera.aspect), transform);
  // A pose changes the framing reference, not just the silhouette's rest box.
  root.getObjectByName("Bip01_Spine1").rotateZ(0.3);
  root.getObjectByName("Bip01_L_Clavicle").rotateY(-0.2);
  const changed = projectPose(root, camera, transform);
  expectTransform(framing.measure(camera, changed, camera.aspect), transform);
  expect(root.position.equals(before)).toBe(true);
  expect(root.scale.equals(scale)).toBe(true);
});

test.each(playerAssets)("%s supports face-only close-ups using actual head geometry", async (name) => {
  const { root, camera, framing } = await load(name);
  const pose = facePose();
  const first = framing.measure(camera, pose, camera.aspect);
  expect(first.scale).toBeGreaterThan(3);
  expect([first.scale, first.x, first.y].every(Number.isFinite)).toBe(true);
  // Enlarge the same face 20% and move it left/down. The fitted projection
  // must compose with that exact screen transform, regardless of head shape.
  const enlarged = pose.map((point) => ({ ...point,
    x: 0.5 + (point.x - 0.5) * 1.2 - 0.1,
    y: 0.5 + (point.y - 0.5) * 1.2 + 0.06,
  }));
  expectTransform(framing.measure(camera, enlarged, camera.aspect), {
    scale: first.scale * 1.2, x: first.x * 1.2 - 0.2, y: first.y * 1.2 - 0.12,
  });
  // The attachment is intentionally wildly different on some T2 models.
  // Moving it must not alter the reference built from Head-weighted vertices.
  root.getObjectByName("Eye")?.position.set(100, 200, 300);
  const rebuilt = createCameraFraming(root);
  expectTransform(rebuilt.measure(camera, pose, camera.aspect), first);
});

test.each([[0.6, 4 / 3], [2, 4 / 3], [1.4, 9 / 16]])(
  "viewport %s contains camera aspect %s without stretching the model", async (aspect, imageAspect) => {
    const { root, camera, framing } = await load("lmale", aspect);
    const transform = { scale: 0.8, x: 0.03, y: -0.02 };
    const pose = projectPose(root, camera, transform, imageAspect);
    expectTransform(framing.measure(camera, pose, imageAspect), transform);
  },
);

test("offscreen predicted hips do not defeat face and shoulder crops", async () => {
  const { camera, framing } = await load("lfemale");
  const pose = facePose();
  const expected = framing.measure(camera, pose, camera.aspect);
  pose[23] = { x: 0.2, y: 1.2, z: 0, visibility: 1 };
  pose[24] = { x: 0.8, y: 1.2, z: 0, visibility: 1 };
  pose[11] = { x: -0.1, y: 0.8, z: 0, visibility: 1 };
  pose[12] = { x: 1.1, y: 0.8, z: 0, visibility: 1 };
  expectTransform(framing.measure(camera, pose, camera.aspect), expected);
});

test("hand and leg gestures do not change the camera fit", async () => {
  const { root, camera, framing } = await load("hmale");
  const expected = { scale: 1.8, x: 0.1, y: -0.05 };
  const pose = projectPose(root, camera, expected);
  for (const index of [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 25, 26, 27, 28, 29, 30, 31, 32]) {
    pose[index] = { x: index % 2, y: (index + 1) % 2, z: 0, visibility: 1 };
  }
  for (const name of ["L_Forearm", "R_Forearm", "L_Calf", "R_Calf"]) {
    root.getObjectByName(`Bip01_${name}`).rotateY(1.2);
  }
  expectTransform(framing.measure(camera, pose, camera.aspect), expected);
});

test("visible shoulders work without hips or face landmarks", async () => {
  const { root, camera, framing } = await load("mmale");
  const expected = { scale: 2.1, x: -0.15, y: 0.2 };
  const pose = projectPose(root, camera, expected);
  pose[23].visibility = pose[24].visibility = 0;
  expectTransform(framing.measure(camera, pose, camera.aspect), expected);
});

test("a sparse face detector result can establish framing on the first frame", async () => {
  const { camera, framing } = await load("hbioderm");
  const pose = facePose();
  pose[9].visibility = pose[10].visibility = 0;
  const measured = framing.measure(camera, pose, 4 / 3);
  expect(measured.scale).toBeGreaterThan(3);
  expect([measured.scale, measured.x, measured.y].every(Number.isFinite)).toBe(true);
  // Even ears outside a tight crop leave two eyes and the nose to fit.
  pose[7].x = -0.1;
  pose[8].x = 1.1;
  const cropped = framing.measure(camera, pose, 4 / 3);
  expect(cropped.scale).toBeGreaterThan(3);
  expect([cropped.scale, cropped.x, cropped.y].every(Number.isFinite)).toBe(true);
});

test("bad or insufficient observations do not invent camera movement", async () => {
  const { camera, framing } = await load("lmale");
  expect(framing.measure(camera, [], camera.aspect)).toBeNull();
  const single = emptyPose();
  single[0] = { x: 0.5, y: 0.5, z: 0, visibility: 1 };
  expect(framing.measure(camera, single, camera.aspect)).toBeNull();
  for (const invalid of [{ x: NaN }, { y: Infinity }, { visibility: NaN },
    { presence: 0.49 }, { visibility: 0.49 }, { x: -0.1 }, { y: 1.01 }]) {
    expect(framing.measure(camera, facePose().map((point) => ({ ...point, ...invalid })), camera.aspect)).toBeNull();
  }
  for (const aspect of [0, -1, NaN, Infinity]) expect(framing.measure(camera, facePose(), aspect)).toBeNull();
  const coincident = facePose().map((point) => ({ ...point, x: 0.5, y: 0.5 }));
  expect(framing.measure(camera, coincident, camera.aspect)).toBeNull();
  camera.rotateY(Math.PI);
  expect(framing.measure(camera, facePose(), camera.aspect)).toBeNull();
});

test("canFrame agrees with whether framing can measure the landmarks", async () => {
  const { root, camera, framing } = await load("lmale");
  const hide = (pose, ...indices) => {
    for (const index of indices) pose[index] = { ...pose[index], visibility: 0 };
    return pose;
  };
  const body = () => projectPose(root, camera, { scale: 1.4, x: 0.05, y: -0.1 });
  const withNose = (pose) => {
    pose[0] = { x: 0.5, y: 0.2, z: 0, visibility: 1 };
    return pose;
  };
  const cases = [
    [body(), true],
    [hide(body(), 23, 24), true],
    [hide(body(), 12, 23, 24), false],
    [withNose(hide(body(), 12, 23, 24)), false],
    [facePose(), true],
    [hide(facePose(), 5, 7, 8, 9, 10), true],
    [hide(facePose(), 2, 5, 7, 8, 9, 10), false],
    [[], false],
  ];
  for (const [pose, expected] of cases) {
    expect(canFrame(pose)).toBe(expected);
    expect(framing.measure(camera, pose, camera.aspect) !== null).toBe(expected);
  }
});

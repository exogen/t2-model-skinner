import { expect, test } from "vitest";
import { Box3, Object3D, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { createPlayerRig } from "./rig";
import { createPoseFraming } from "./cameraFraming";
import {
  applyRecording,
  createTake,
  formatTime,
  framableKeys,
  framingAt,
  MAX_RECORDING_SECONDS,
  MIN_KEY_INTERVAL,
  readPose,
} from "./recording";
import { emptyPose, neutralBodyPose, settle } from "./handTestUtils.mjs";
import { loadPlayer } from "./playerTestUtils.mjs";

function bones(count = 2) {
  return Array.from({ length: count }, (_, index) =>
    Object.assign(new Object3D(), { name: `Bip01_${index}` }),
  );
}

const tPose = (bend = 0) => neutralBodyPose({ hands: false, bend });

function expectRotations(nodes, expected, tolerance = 1e-6) {
  nodes.forEach((node, index) => {
    expect(node.quaternion.angleTo(expected[index]), node.name).toBeLessThan(
      tolerance,
    );
  });
}

test("a take keys every 60 hz frame and at most one key per 1/80 s on faster displays", () => {
  const jittered = createTake(bones(), "lmale", { landmarks: [] });
  jittered.add(0, []);
  const deltas = [0.015, 0.018, 0.0166, 0.017, 0.0155];
  for (let i = 0; i < 60; i++)
    expect(jittered.add(deltas[i % deltas.length], [])).toBe(true);
  expect(jittered.finish().times).toHaveLength(61);

  for (const [rate, perSecond] of [
    [120, 60],
    [144, 72],
  ]) {
    const take = createTake(bones(), "lmale", { landmarks: [] });
    take.add(0, []);
    for (let i = 0; i < rate; i++) take.add(1 / rate, []);
    const { times } = take.finish();
    expect(times).toHaveLength(perSecond + 1);
    for (let i = 1; i < times.length; i++)
      expect(times[i] - times[i - 1]).toBeGreaterThan(MIN_KEY_INTERVAL - 1e-6);
  }
});

test("frames without elapsed time add no keys after the first, and one key is not a recording", () => {
  const take = createTake(bones(), "lmale", { landmarks: [] });
  for (const delta of [0, 0, NaN, -1]) expect(take.add(delta, [])).toBe(true);
  expect(take.finish()).toBeNull();
  take.add(1 / 60, []);
  expect(Array.from(take.finish().times)).toEqual([0, Math.fround(1 / 60)]);
});

test("a take refuses keys after sixty seconds and trims its buffers", () => {
  const nodes = bones(3);
  const take = createTake(nodes, "lmale", { landmarks: [] });
  take.add(0, []);
  let frames = 0;
  while (take.add(1 / 60, [])) frames++;
  expect(frames).toBeGreaterThanOrEqual(MAX_RECORDING_SECONDS * 60 - 1);
  expect(frames).toBeLessThanOrEqual(MAX_RECORDING_SECONDS * 60);
  const recording = take.finish();
  const keys = recording.times.length;
  expect(recording.duration).toBe(recording.times[keys - 1]);
  expect(recording.duration).toBeLessThanOrEqual(MAX_RECORDING_SECONDS);
  expect(recording.duration).toBeGreaterThan(MAX_RECORDING_SECONDS - 0.02);
  expect(recording.rotations).toHaveLength(keys * nodes.length * 4);
  expect(recording.framing).toHaveLength(keys * 22);
  expect(recording).toMatchObject({
    kind: "recording",
    model: "lmale",
    nodes: ["Bip01_0", "Bip01_1", "Bip01_2"],
  });
});

test("the first key uses the seed framing when the live input is empty and hidden points stay missing", () => {
  const seed = [];
  seed[11] = { x: 0.4, y: 0.5, z: 0, visibility: 1 };
  seed[12] = { x: 0.6, y: 0.5, z: 0, visibility: 0.2 };
  const live = [];
  live[0] = { x: 0.5, y: 0.25, z: 0, visibility: 0.9 };
  live[23] = { x: 1.2, y: 0.5, z: 0, visibility: 1 };
  const take = createTake(bones(), "lmale", {
    landmarks: seed,
    imageWidth: 640,
    imageHeight: 480,
  });
  take.add(0, []);
  take.add(1 / 60, live, 1280, 720);
  const recording = take.finish();
  const first = framingAt(recording, 0);
  expect(first[11]).toEqual({ x: Math.fround(0.4), y: 0.5, z: 0 });
  expect(11 in first && !(12 in first)).toBe(true);
  const second = framingAt(recording, 1);
  expect(Object.keys(second)).toEqual(["0"]);
  expect(second[0]).toEqual({ x: 0.5, y: 0.25, z: 0 });
  // The first image size seen is kept for the whole recording.
  expect([recording.imageWidth, recording.imageHeight]).toEqual([640, 480]);
  expect(framingAt(readPose(bones(), "lmale", { landmarks: [] }), 0)).toEqual(
    [],
  );
});

function torso(x) {
  const landmarks = [];
  landmarks[11] = { x, y: 0.3, z: 0, visibility: 1 };
  landmarks[12] = { x: x - 0.2, y: 0.3, z: 0, visibility: 1 };
  return landmarks;
}

test("the first key uses the seed whenever framing can't measure the live input", () => {
  const oneShoulder = [];
  oneShoulder[11] = { x: 0.2, y: 0.3, z: 0, visibility: 1 };
  const take = createTake(bones(), "lmale", {
    landmarks: torso(0.6),
    imageWidth: 640,
    imageHeight: 480,
  });
  take.add(0, oneShoulder, 1280, 720);
  take.add(1 / 60, oneShoulder, 1280, 720);
  const recording = take.finish();
  expect(framingAt(recording, 0)[11].x).toBeCloseTo(0.6, 6);
  expect(framingAt(recording, 1)[11].x).toBeCloseTo(0.2, 6);
  expect(recording.imageWidth).toBe(640);
});

test("each key knows the last key at or before it that framing can measure", () => {
  const oneShoulder = [];
  oneShoulder[11] = { x: 0.2, y: 0.3, z: 0, visibility: 1 };
  const face = [];
  face[2] = { x: 0.48, y: 0.2, z: 0, visibility: 1 };
  face[5] = { x: 0.52, y: 0.2, z: 0, visibility: 1 };
  const take = createTake(bones(), "lmale", { landmarks: [] });
  for (const landmarks of [oneShoulder, torso(0.6), oneShoulder, face, []])
    take.add(1 / 60, landmarks);
  expect(Array.from(framableKeys(take.finish()))).toEqual([-1, 1, 1, 3, 3]);
});

test("same-model playback restores sampled rotations and slerps between keys", async () => {
  const { scene } = await loadPlayer("lmale");
  const rig = createPlayerRig(scene);
  settle(rig, tPose());
  const first = rig.nodes.map((node) => node.quaternion.clone());
  const take = createTake(rig.nodes, "lmale", { landmarks: [] });
  take.add(0, []);
  settle(rig, tPose(0.3));
  const second = rig.nodes.map((node) => node.quaternion.clone());
  take.add(0.5, []);
  const recording = take.finish();
  expect(
    Math.max(
      ...second.map((rotation, index) => rotation.angleTo(first[index])),
    ),
  ).toBeGreaterThan(0.2);

  rig.reset();
  expect(applyRecording(recording, rig.nodes, 0)).toBe(0);
  expectRotations(rig.nodes, first);
  expect(applyRecording(recording, rig.nodes, 0.5)).toBe(1);
  expectRotations(rig.nodes, second);
  applyRecording(recording, rig.nodes, 0.25);
  expectRotations(
    rig.nodes,
    first.map((rotation, index) =>
      new Quaternion().slerpQuaternions(rotation, second[index], 0.5),
    ),
  );
  // Times outside the recording hold its ends.
  applyRecording(recording, rig.nodes, 9);
  expectRotations(rig.nodes, second);
});

test("a recording plays onto a freshly loaded scene of the same model by bone name", async () => {
  const { scene } = await loadPlayer("lmale");
  const rig = createPlayerRig(scene);
  settle(rig, tPose(0.3));
  const pose = readPose(rig.nodes, "lmale", { landmarks: [] });
  const expected = rig.nodes.map((node) => node.quaternion.clone());
  const { scene: fresh } = await loadPlayer("lmale", true);
  const nodes = pose.nodes.map((name) => fresh.getObjectByName(name));
  expect(nodes.every(Boolean)).toBe(true);
  applyRecording(pose, [...nodes, undefined], 0);
  expectRotations(nodes, expected);
});

test("a pose applies its single key at any time", () => {
  const nodes = bones();
  nodes[0].quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 1);
  const pose = readPose(nodes, "lmale", { landmarks: [] });
  expect(pose).toMatchObject({ kind: "pose", duration: 0 });
  const target = bones();
  for (const time of [0, 5, -1]) {
    target[0].quaternion.identity();
    expect(applyRecording(pose, target, time)).toBe(0);
    expect(target[0].quaternion.angleTo(nodes[0].quaternion)).toBeLessThan(
      1e-6,
    );
  }
});

test("replayed framing input gives the same framed camera as live input", async () => {
  const { scene } = await loadPlayer("lmale");
  const rig = createPlayerRig(scene);
  const box = new Box3().setFromObject(scene, true);
  const center = box.getCenter(new Vector3());
  const radius = box.getSize(new Vector3()).length() / 2;
  const camera = new PerspectiveCamera(30, 1.2, radius / 100, radius * 100);
  camera.position.copy(center).add(new Vector3(0, 0, radius * 8));
  camera.lookAt(center);
  camera.updateWorldMatrix(true, false);
  const landmarks = emptyPose();
  for (const [index, x, y] of [
    [0, 0.5, 0.2],
    [2, 0.52, 0.18],
    [5, 0.48, 0.18],
    [7, 0.54, 0.19],
    [8, 0.46, 0.19],
    [11, 0.6, 0.32],
    [12, 0.4, 0.32],
    [23, 0.56, 0.62],
    [24, 0.44, 0.62],
  ]) {
    landmarks[index] = { x, y, z: 0.1, visibility: 0.9, presence: 0.95 };
  }
  const live = createPoseFraming(scene);
  live.setInput(landmarks, 640, 480);
  const pose = readPose(rig.nodes, "lmale", {
    landmarks,
    imageWidth: 640,
    imageHeight: 480,
  });
  const replay = createPoseFraming(scene);
  replay.setInput(framingAt(pose, 0), pose.imageWidth, pose.imageHeight);
  const expected = live.update(camera, 1 / 60);
  const actual = replay.update(camera, 1 / 60);
  expect(expected).not.toBeNull();
  expect(replay.imageAspect).toBe(live.imageAspect);
  actual.projectionMatrix.elements.forEach((value, index) => {
    expect(value).toBeCloseTo(expected.projectionMatrix.elements[index], 5);
  });
});

test("times read as minutes and seconds, with tenths when asked", () => {
  expect(formatTime(0)).toBe("0:00");
  expect(formatTime(12.9)).toBe("0:12");
  expect(formatTime(60)).toBe("1:00");
  expect(formatTime(4.25, true)).toBe("0:04.2");
  expect(formatTime(Math.fround(4.2), true)).toBe("0:04.2");
  expect(formatTime(-1, true)).toBe("0:00.0");
});

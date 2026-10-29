import { expect, test } from "vitest";
import { Vector3 } from "three";
import {
  framingLandmarks,
  mirrorImagePoseLandmarks,
  mirrorPoseLandmarks,
  mirrorTrackedHands,
} from "./mirrorPose";
import { bodyFrame, facingFrame, readPosePoint } from "./retarget";

test("image framing reflects normalized coordinates and anatomical sides without changing detector data", () => {
  const raw = Object.freeze(
    Array.from({ length: 33 }, (_, index) =>
      Object.freeze({
        x: index / 32,
        y: index / 40,
        z: 0,
        visibility: 1,
      }),
    ),
  );
  const mirrored = mirrorImagePoseLandmarks(raw);
  expect(mirrored[11]).toEqual({ ...raw[12], x: 1 - raw[12].x });
  expect(mirrored[2]).toEqual({ ...raw[5], x: 1 - raw[5].x });
  expect(mirrorImagePoseLandmarks(mirrored)).toEqual(raw);
  expect(framingLandmarks({ landmarks: raw })).toEqual(mirrored);
});

test("a close-up uses observed face features rather than hallucinated body points", () => {
  const face = {
    confidence: 0.96,
    landmarks: Array.from({ length: 6 }, (_, index) => ({
      x: index / 7,
      y: 0.4,
      z: 0,
    })),
  };
  const frame = {
    face,
    landmarks: Array.from({ length: 33 }, () => ({
      x: 0.9,
      y: 0.9,
      z: 0,
      visibility: 1,
    })),
  };
  const points = framingLandmarks(frame);
  expect(points[2]).toMatchObject({
    x: 1 - face.landmarks[0].x,
    visibility: face.confidence,
  });
  expect(points[5]).toMatchObject({ x: 1 - face.landmarks[1].x });
  expect(points[0]).toMatchObject({ x: 1 - face.landmarks[2].x });
  expect(points[7]).toMatchObject({ x: 1 - face.landmarks[4].x });
  expect(points[8]).toMatchObject({ x: 1 - face.landmarks[5].x });
  expect(points[11]).toBeUndefined();
  expect(points[23]).toBeUndefined();
  expect(
    framingLandmarks({ ...frame, face: { ...face, confidence: NaN } }),
  ).toEqual([]);
});

test("detailed hands mirror as whole hands while retaining thumb and finger indices", () => {
  const points = Object.freeze(
    Array.from({ length: 21 }, (_, index) =>
      Object.freeze({
        x: index / 32,
        y: index / 21,
        z: index / 50,
      }),
    ),
  );
  const hands = Object.freeze(
    ["left", "right"].map((side) =>
      Object.freeze({
        side,
        landmarks: points,
        worldLandmarks: points,
        confidence: 0.9,
      }),
    ),
  );
  const mirrored = mirrorTrackedHands(hands);
  expect(mirrored.map((hand) => hand.side)).toEqual(["right", "left"]);
  for (const hand of mirrored) {
    expect(hand.confidence).toBe(0.9);
    points.forEach((point, index) => {
      expect(hand.landmarks[index]).toEqual({ ...point, x: 1 - point.x });
      expect(hand.worldLandmarks[index]).toEqual({ ...point, x: -point.x });
    });
  }
  expect(mirrorTrackedHands(mirrored)).toEqual(hands);
  expect(mirrorTrackedHands([])).toEqual([]);
});

test("all 33 landmarks reflect X, swap anatomical sides, and retain their other data without mutation", () => {
  const points = Object.freeze(
    Array.from({ length: 33 }, (_, index) =>
      Object.freeze({
        x: index + 0.25,
        y: index + 1.5,
        z: index - 2.5,
        visibility: index / 33,
        presence: 1 - index / 33,
      }),
    ),
  );
  const mirrored = mirrorPoseLandmarks(points);
  const pairs = [
    [0, 0],
    [1, 4],
    [2, 5],
    [3, 6],
    [7, 8],
    [9, 10],
  ];
  for (let left = 11; left < 33; left += 2) pairs.push([left, left + 1]);
  const covered = new Set();
  for (const [left, right] of pairs) {
    for (const [target, source] of [
      [left, right],
      [right, left],
    ]) {
      covered.add(target);
      expect(mirrored[target]).toEqual({
        ...points[source],
        x: -points[source].x,
      });
      expect(mirrored[target]).not.toBe(points[source]);
    }
  }
  expect(covered.size).toBe(33);
  expect(mirrorPoseLandmarks(mirrored)).toEqual(points);
});

test("an asymmetric raised arm and bent leg move to the mirrored side while the torso stays front-facing", () => {
  const points = [];
  const put = (index, x, y, z = 0) => {
    points[index] = { x, y: -y, z: -z, visibility: 1 };
  };
  put(11, 0.3, 1.5);
  put(12, -0.3, 1.5);
  put(13, 0.4, 1.8);
  put(15, 0.4, 2.1);
  put(14, -0.3, 1.2);
  put(16, -0.3, 0.9);
  put(23, 0.15, 1);
  put(24, -0.15, 1);
  put(25, 0.15, 0.7, 0.4);
  put(27, 0.15, 0.4, 0.4);
  put(26, -0.15, 0.5);
  put(28, -0.15, 0.1);
  const mirrored = mirrorPoseLandmarks(points);
  const point = (index) => readPosePoint(mirrored, index);
  expect(point(16).y).toBeGreaterThan(point(15).y);
  expect(point(16).x).toBeLessThan(0);
  expect(point(26).z).toBeCloseTo(0.4);
  expect(point(25).z).toBeCloseTo(0);
  const torso = bodyFrame(point(11).sub(point(12)), new Vector3(0, 1, 0));
  expect(new Vector3(0, 0, 1).applyQuaternion(torso).z).toBeCloseTo(1);
});

test("head yaw mirrors without reversing its forward or up axes", () => {
  const points = [];
  const yaw = Math.PI / 5;
  for (const [index, x, y, z] of [
    [0, 0, 1.7, 0.15],
    [7, 0.1, 1.7, 0],
    [8, -0.1, 1.7, 0],
  ]) {
    const value = new Vector3(x, y, z).applyAxisAngle(
      new Vector3(0, 1, 0),
      yaw,
    );
    points[index] = { x: value.x, y: -value.y, z: -value.z };
  }
  const mirrored = mirrorPoseLandmarks(points);
  const left = readPosePoint(mirrored, 7),
    right = readPosePoint(mirrored, 8);
  const forward = readPosePoint(mirrored, 0).sub(
    left.clone().add(right).multiplyScalar(0.5),
  );
  const rotation = facingFrame(
    forward,
    forward.clone().cross(left.clone().sub(right)),
  );
  const facing = new Vector3(0, 0, 1).applyQuaternion(rotation);
  expect(facing.x).toBeCloseTo(-Math.sin(yaw));
  expect(facing.z).toBeCloseTo(Math.cos(yaw));
  expect(new Vector3(0, 1, 0).applyQuaternion(rotation).y).toBeCloseTo(1);
});

test("partial poses do not invent a missing opposite limb", () => {
  expect(mirrorPoseLandmarks([])).toEqual([]);
  const points = [];
  points[11] = { x: 0.2, y: -0.5, z: 0 };
  const mirrored = mirrorPoseLandmarks(points);
  expect(mirrored[11]).toBeUndefined();
  expect(mirrored[12]).toEqual({ x: -0.2, y: -0.5, z: 0 });
  expect(readPosePoint(mirrored, 11)).toBeNull();
  expect(readPosePoint(mirrored, 12).toArray()).toEqual([-0.2, 0.5, -0]);
});

test.each([
  { x: NaN },
  { y: Infinity },
  { z: -Infinity },
  { visibility: 0.2 },
  { presence: 0.2 },
  { visibility: NaN },
])(
  "invalid or unreliable input stays invalid after mirroring: %j",
  (invalid) => {
    const points = [];
    points[15] = { x: 0.3, y: -0.5, z: 0, visibility: 1, ...invalid };
    const mirrored = mirrorPoseLandmarks(points);
    expect(readPosePoint(mirrored, 16)).toBeNull();
    expect(mirrored[15]).toBeUndefined();
  },
);

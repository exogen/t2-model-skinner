import { expect, test } from "vitest";
import { needsFaceTracking, selectCloseupFace } from "./faceTracking";

const makePose = () => ({ landmarks: Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 })), worldLandmarks: [], timestamp: 100 });
const detection = (x = 160, width = 320) => ({
  categories: [{ score: 0.95 }],
  boundingBox: { originX: x, originY: 100, width, height: width },
  keypoints: [[0.4, 0.4], [0.6, 0.4], [0.5, 0.5], [0.5, 0.6], [0.3, 0.45], [0.7, 0.45]].map(([x, y]) => ({ x, y })),
});

test("face fallback observes pixel aspect and prominent facial size", () => {
  const pose = makePose();
  pose.landmarks[2].x = 0.46;
  pose.landmarks[5].x = 0.54;
  expect(needsFaceTracking(pose, 640, 480)).toBe(true);
  expect(needsFaceTracking(pose, 480, 640)).toBe(false);
  expect(needsFaceTracking(null, 640, 480)).toBe(true);
});

test.each(["visibility", "presence"])("weak %s shoulders trigger fallback without trusting extrapolated confidence", (key) => {
  const pose = makePose();
  expect(needsFaceTracking(pose, 640, 480)).toBe(false);
  pose.landmarks[11][key] = 0.1;
  expect(needsFaceTracking(pose, 640, 480)).toBe(true);
  pose.landmarks[11][key] = 1;
  pose.landmarks[12].x = -0.01;
  expect(needsFaceTracking(pose, 640, 480)).toBe(true);
});

test("face output preserves the detector's anatomical keypoint order and normalizes bounds", () => {
  const result = selectCloseupFace({ detections: [detection()] }, null, 640, 480);
  expect(result.bounds).toEqual({ x: 0.25, y: 100 / 480, width: 0.5, height: 320 / 480 });
  expect(result.landmarks.map(({ x, y }) => [x, y])).toEqual(detection().keypoints.map(({ x, y }) => [x, y]));
  expect(result.landmarks.every(({ z, visibility }) => z === 0 && visibility === 0.95)).toBe(true);
});

test("small, malformed, and weak faces cannot seize close-up framing", () => {
  const low = detection(); low.categories[0].score = 0.4;
  const invalid = detection(); invalid.keypoints[2].x = NaN;
  const missing = detection(); missing.keypoints = [];
  const box = detection(); box.boundingBox.height = Infinity;
  expect(selectCloseupFace({ detections: [detection(160, 30), low, invalid, missing, box] }, null, 640, 480)).toBeUndefined();
  expect(selectCloseupFace({ detections: [detection()] }, null, 0, 480)).toBeUndefined();
});

test("an unrelated face does not replace an existing tracked person", () => {
  const pose = makePose();
  pose.landmarks[0].x = 0.1;
  const unrelated = detection(420, 150);
  expect(selectCloseupFace({ detections: [unrelated] }, pose, 640, 480)).toBeUndefined();
});

test("without a body the largest prominent face wins", () => {
  const small = detection(100, 100), large = detection();
  expect(selectCloseupFace({ detections: [small, large] }, null, 640, 480).bounds.width).toBe(0.5);
});

import { expect, test } from "vitest";
import { freshPose } from "./poseTracking";

const frame = (timestamp, receivedAt) => ({
  landmarks: [],
  worldLandmarks: [],
  timestamp,
  receivedAt,
});

test("fast inference remains fresh for 500ms after arrival and keeps its capture timestamp", () => {
  const pose = frame(100, 200);
  expect(freshPose(pose, 200)).toBe(pose);
  expect(freshPose(pose, 700)).toBe(pose);
  expect(freshPose(pose, 701)).toBeNull();
  expect(pose.timestamp).toBe(100);
});

test("slow inference stays visible between results while its stall timeout remains bounded", () => {
  const pose = frame(100, 1000);
  expect(freshPose(pose, 1900)).toBe(pose);
  expect(freshPose(pose, 2800)).toBe(pose);
  expect(freshPose(pose, 2801)).toBeNull();
  const verySlow = frame(100, 1500);
  expect(freshPose(verySlow, 3500)).toBe(verySlow);
  expect(freshPose(verySlow, 3501)).toBeNull();
});

test("frames without arrival timestamps retain capture-time freshness", () => {
  const pose = frame(100);
  expect(freshPose(pose, 600)).toBe(pose);
  expect(freshPose(pose, 601)).toBeNull();
});

test("an animation-frame timestamp slightly before arrival does not discard a new pose", () => {
  // rAF's frame timestamp can precede performance.now() when the callback runs.
  const pose = frame(100, 950);
  expect(freshPose(pose, 946)).toBe(pose);
});

test("zero arrival time is valid and invalid timing or missing frames are ignored", () => {
  expect(freshPose(frame(-1000, 0), 0)).not.toBeNull();
  expect(freshPose(null, 0)).toBeNull();
  expect(freshPose(undefined, 0)).toBeNull();
  for (const invalid of [NaN, Infinity, -Infinity]) {
    expect(freshPose(frame(100, invalid), 100)).toBeNull();
    expect(freshPose(frame(invalid), 100)).toBeNull();
    expect(freshPose(frame(invalid, 100), 100)).toBeNull();
    expect(freshPose(frame(100, 100), invalid)).toBeNull();
  }
});

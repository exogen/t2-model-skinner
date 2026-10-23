import { expect, test } from "vitest";
import { Quaternion, Vector3 } from "three";
import { detailedHandPose, thumbRotation } from "./retarget";
import { mirrorTrackedHands } from "./mirrorPose";
import { trackedHand } from "./handTestUtils.mjs";
import { recordedHands } from "./recordedHandsTestUtils.mjs";

test("actual Hand Landmarker output preserves the visibly opposite palm-facing sides", () => {
  for (const hand of recordedHands()) {
    const result = detailedHandPose(hand);
    expect(result).not.toBeNull();
    // This fixture's left palm faces the body, while its right palm faces
    // the camera; neither side should be corrected by a blanket 180° turn.
    expect(result.palm.normal.z * (hand.side === "left" ? -1 : 1)).toBeGreaterThan(0.8);
    expect(result.thumbDirection.y * (hand.side === "left" ? -1 : 1)).toBeGreaterThan(0.6);
    expect(result.fingersCurl).toBeGreaterThanOrEqual(0);
    expect(result.fingersCurl).toBeLessThan(Math.PI / 2);
    const mirrored = detailedHandPose(mirrorTrackedHands([hand])[0]);
    expect(mirrored.palm.normal.z).toBeCloseTo(result.palm.normal.z);
    expect(mirrored.thumbDirection.y).toBeCloseTo(-result.thumbDirection.y);
  }
});

test.each(["left", "right"])("%s palm orientation stays fixed while all finger joints and thumb curl", (side) => {
  const opened = detailedHandPose(trackedHand(side));
  const closed = detailedHandPose(trackedHand(side, { curl: 0.7, pip: 1, dip: 0.6, thumbCurl: 1 }));
  expect(opened.palm.rotation.angleTo(closed.palm.rotation)).toBeLessThan(1e-7);
  expect(closed.palm.normal.distanceTo(new Vector3(0, -1, 0))).toBeLessThan(1e-7);
  expect(new Vector3(1, 0, 0).applyQuaternion(closed.palm.rotation).x).toBeCloseTo(side === "left" ? 1 : -1);
  expect(opened.fingersCurl).toBeCloseTo(0);
  expect(closed.fingersCurl).toBeCloseTo(1.3);
  expect(opened.thumbDirection.y).toBeCloseTo(side === "left" ? -1 : 1);
  expect(closed.thumbDirection.z).toBeCloseTo(Math.sin(1));
});

test.each(["left", "right"])("%s hand rotation follows genuine wrist bends and full palm roll independently of origin", (side) => {
  const initial = detailedHandPose(trackedHand(side));
  for (let degrees = 0; degrees <= 360; degrees += 30) {
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0.3, 0.7, 0.2).normalize(), degrees * Math.PI / 180);
    const result = detailedHandPose(trackedHand(side, { rotation, curl: 0.7, origin: new Vector3(4, 5, 6) }));
    expect(result.palm.rotation.angleTo(rotation.clone().multiply(initial.palm.rotation))).toBeLessThan(1e-6);
    expect(result.fingersCurl).toBeCloseTo(0.7);
    expect(result.thumbDirection.distanceTo(initial.thumbDirection)).toBeLessThan(1e-6);
  }
});

test("PIP and DIP bending contributes to a mitt curl even with extended MCP knuckles", () => {
  const result = detailedHandPose(trackedHand("left", { pip: Math.PI / 2, dip: Math.PI / 6 }));
  expect(result.fingersCurl).toBeCloseTo(0.45 * Math.PI / 2 + 0.25 * Math.PI / 6);
});

test("one noisy finger does not overpower the shared finger group", () => {
  const hand = trackedHand("left", { curl: 0.5 });
  const outlier = trackedHand("left", { curl: 2 });
  for (const index of [6, 7, 8]) hand.worldLandmarks[index] = outlier.worldLandmarks[index];
  expect(detailedHandPose(hand).fingersCurl).toBeCloseTo(0.5);
});

test.each(["left", "right"])("mirroring a %s hand reflects palm facing and preserves curl and thumb flex", (side) => {
  const hand = trackedHand(side, {
    curl: 0.4, pip: 0.7, thumbCurl: 0.8,
    rotation: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.6),
  });
  const original = detailedHandPose(hand);
  const [mirrored] = mirrorTrackedHands([hand]);
  const result = detailedHandPose(mirrored);
  expect(mirrored.side).toBe(side === "left" ? "right" : "left");
  expect(result.palm.normal.distanceTo(original.palm.normal.clone().multiply(new Vector3(-1, 1, 1)))).toBeLessThan(1e-6);
  expect(result.fingersCurl).toBeCloseTo(original.fingersCurl);
  expect(result.thumbDirection.z).toBeCloseTo(original.thumbDirection.z);
  expect(result.thumbDirection.y).toBeCloseTo(-original.thumbDirection.y);
});

test("collapsed MCP span retains transported palm roll without using curled fingertips", () => {
  const hand = trackedHand("left", { curl: 1.2, pip: 0.7 });
  for (const z of [-0.00001, 0.00001]) {
    hand.worldLandmarks[5] = { x: 0.08, y: 0, z };
    hand.worldLandmarks[17] = { x: 0.08, y: 0, z: -z };
    const result = detailedHandPose(hand, new Vector3(0, -1, 0));
    expect(result.palm.normal.distanceTo(new Vector3(0, -1, 0))).toBeLessThan(1e-6);
  }
});

test("missing finger chains and thumb relax individually without discarding the observed palm", () => {
  const hand = trackedHand("left", { curl: 0.6 });
  hand.worldLandmarks[4] = { x: NaN, y: 0, z: 0 };
  for (const index of [6, 10, 14]) hand.worldLandmarks[index] = { x: NaN, y: 0, z: 0 };
  const result = detailedHandPose(hand);
  expect(result.palm.normal.y).toBeCloseTo(-1);
  expect(result.thumbDirection).toBeNull();
  expect(result.fingersCurl).toBeNull();
});

test("Hand Landmarker's default zero visibility fields do not discard a confidently associated hand", () => {
  const hand = trackedHand("left", { curl: 0.5 });
  hand.worldLandmarks = hand.worldLandmarks.map((point) => ({ ...point, visibility: 0, presence: 0 }));
  const result = detailedHandPose(hand);
  expect(result).not.toBeNull();
  expect(result.fingersCurl).toBeCloseTo(0.5);
  expect(result.thumbDirection).not.toBeNull();
});

test.each([0.2, NaN, Infinity])("low or invalid hand confidence %s cannot drive the palm", (confidence) => {
  expect(detailedHandPose({ ...trackedHand("left"), confidence })).toBeNull();
});

test("invalid and overflowing hand geometry yields no fabricated orientation", () => {
  for (const x of [NaN, Infinity, Number.MAX_VALUE]) {
    const hand = trackedHand("left");
    hand.worldLandmarks[9] = { x, y: 0, z: 0 };
    expect(detailedHandPose(hand)).toBeNull();
  }
});

test.each(["left", "right"])("%s thumb swing uses its authored direction and bends palmward without extra axial twist", (side) => {
  const opened = detailedHandPose(trackedHand(side));
  const closed = detailedHandPose(trackedHand(side, { thumbCurl: Math.PI / 2 }));
  const result = thumbRotation(opened.thumbDirection, closed.thumbDirection);
  expect(opened.thumbDirection.clone().applyQuaternion(result).distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-6);
  expect(result.angleTo(new Quaternion())).toBeCloseTo(Math.PI / 2);
  expect(thumbRotation(opened.thumbDirection, opened.thumbDirection).angleTo(new Quaternion())).toBeCloseTo(0);
});

test("thumb swing bounds impossible inversions and rejects unusable directions", () => {
  const rest = new Vector3(0, 1, 0);
  expect(thumbRotation(rest, rest.clone().negate()).angleTo(new Quaternion())).toBeCloseTo(Math.PI * 2 / 3);
  expect(thumbRotation(rest, new Vector3())).toBeNull();
  expect(thumbRotation(rest, new Vector3(NaN, 0, 0))).toBeNull();
});

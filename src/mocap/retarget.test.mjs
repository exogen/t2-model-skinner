import { expect, test } from "vitest";
import { Quaternion, Vector3 } from "three";
import {
  bodyFrame,
  facingFrame,
  handFrame,
  limbFrames,
  readPosePoint,
  segmentFrame,
} from "./retarget";

test("camera coordinates preserve anatomical sides and convert to Y-up/Z-forward", () => {
  expect(readPosePoint([{ x: 1, y: 2, z: -3 }], 0)?.toArray()).toEqual([1, -2, 3]);
});

test.each([
  undefined,
  { x: NaN, y: 0, z: 0 },
  { x: 0, y: Infinity, z: 0 },
  { x: 0, y: 0, z: 0, visibility: 0.2 },
  { x: 0, y: 0, z: 0, presence: 0.2 },
  { x: 0, y: 0, z: 0, visibility: NaN },
])("rejects absent, nonfinite, or unreliable landmarks: %j", (point) => {
  expect(readPosePoint([point], 0)).toBeNull();
});

test("body and facing frames produce a consistent right-handed coordinate system", () => {
  const identity = new Quaternion();
  expect(bodyFrame(new Vector3(1, 0, 0), new Vector3(0, 2, 0)).angleTo(identity)).toBeCloseTo(0);
  expect(facingFrame(new Vector3(0, 0, 1), new Vector3(0, 1, 0)).angleTo(identity)).toBeCloseTo(0);
  const turn = bodyFrame(new Vector3(0, 0, -1), new Vector3(0, 1, 0));
  expect(new Vector3(0, 0, 1).applyQuaternion(turn).x).toBeCloseTo(1);
});

test("degenerate frames are ignored instead of producing invalid rotations", () => {
  expect(bodyFrame(new Vector3(), new Vector3(0, 1, 0))).toBeNull();
  expect(segmentFrame(new Vector3(1, 0, 0), new Vector3(1, 0, 0))).toBeNull();
  expect(facingFrame(new Vector3(0, 1, 0), new Vector3(0, 1, 0))).toBeNull();
  expect(limbFrames(new Vector3(), new Vector3(), new Vector3(1, 0, 0), new Vector3(0, 0, 1))).toBeNull();
});

test.each([[true, 1], [false, -1]])("hand frames preserve anatomical palm facing for left=%s", (isLeft, side) => {
  const result = handFrame(new Vector3(), new Vector3(side * 0.2, 0, 0.04), new Vector3(side * 0.2, 0, -0.04), isLeft);
  expect(new Vector3(1, 0, 0).applyQuaternion(result.rotation).distanceTo(new Vector3(side, 0, 0))).toBeLessThan(1e-6);
  expect(result.normal.distanceTo(new Vector3(0, -1, 0))).toBeLessThan(1e-6);
});

test.each([0.001, 1, 1000])("collapsed finger geometry keeps prior roll at scale %s", (scale) => {
  const fallback = new Vector3(0, -1, 0);
  const frames = [-0.0001, 0.0001].map((offset) => handFrame(
    new Vector3(),
    new Vector3(0.2, offset, 0).multiplyScalar(scale),
    new Vector3(0.2, -offset, 0).multiplyScalar(scale),
    true,
    fallback,
  ));
  expect(frames[0].rotation.angleTo(frames[1].rotation)).toBeLessThan(1e-6);
  for (const result of frames) expect(result.normal.distanceTo(fallback)).toBeLessThan(1e-6);
  expect(fallback.toArray()).toEqual([0, -1, 0]);
});

test("nearly collinear palm points use fallback even when finger separation is large", () => {
  const result = handFrame(new Vector3(), new Vector3(0.25, 0.0001, 0), new Vector3(0.15, -0.0001, 0), true, new Vector3(0, -1, 0));
  expect(result.normal.toArray()).toEqual([0, -1, 0]);
});

test("fallback roll is projected around the new hand direction", () => {
  const wrist = new Vector3(4, 5, 6);
  const tip = wrist.clone().add(new Vector3(0.2, 0.1, 0));
  const fallback = new Vector3(0, -1, 0);
  const result = handFrame(wrist, tip, tip, true, fallback);
  const direction = tip.clone().sub(wrist).normalize();
  expect(new Vector3(1, 0, 0).applyQuaternion(result.rotation).distanceTo(direction)).toBeLessThan(1e-6);
  expect(result.normal.dot(direction)).toBeCloseTo(0);
  expect(result.normal.length()).toBeCloseTo(1);
  expect(result.normal.y).toBeLessThan(0);
  expect(wrist.toArray()).toEqual([4, 5, 6]);
  expect(fallback.toArray()).toEqual([0, -1, 0]);
});

test("reliable palm roll can turn through a full rotation without hemisphere clamping", () => {
  let fallback = new Vector3(0, -1, 0);
  let initial;
  for (let degrees = 0; degrees <= 360; degrees += 30) {
    const roll = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), degrees * Math.PI / 180);
    const result = handFrame(new Vector3(), new Vector3(0.2, 0, 0.04).applyQuaternion(roll), new Vector3(0.2, 0, -0.04).applyQuaternion(roll), true, fallback);
    const expected = new Vector3(0, -1, 0).applyQuaternion(roll);
    expect(result.normal.distanceTo(expected)).toBeLessThan(1e-6);
    if (degrees === 0) initial = result.rotation;
    if (degrees === 180) expect(initial.angleTo(result.rotation)).toBeCloseTo(Math.PI);
    if (degrees === 360) expect(initial.angleTo(result.rotation)).toBeLessThan(1e-6);
    fallback = result.normal;
  }
});

test("invalid hand direction or unavailable roll produces no fabricated orientation", () => {
  const origin = new Vector3();
  const tip = new Vector3(0.2, 0, 0);
  expect(handFrame(origin, origin, origin, true, new Vector3(0, 0, 1))).toBeNull();
  expect(handFrame(origin, tip, tip, true)).toBeNull();
  expect(handFrame(origin, tip, tip, true, new Vector3(1, 0, 0))).toBeNull();
  expect(handFrame(origin, tip, tip, true, new Vector3(NaN, 0, 0))).toBeNull();
  expect(handFrame(origin, new Vector3(Infinity, 0, 0), tip, true)).toBeNull();
});

test("bent limbs follow both segment directions and their bend plane", () => {
  const solved = limbFrames(
    new Vector3(), new Vector3(1, 0, 0), new Vector3(1, 1, 0), new Vector3(0, 0, 1),
  );
  expect(new Vector3(1, 0, 0).applyQuaternion(solved.upper).toArray()).toEqual([1, 0, 0]);
  expect(new Vector3(1, 0, 0).applyQuaternion(solved.lower).distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-6);
  expect(solved.normal.toArray()).toEqual([0, 0, 1]);
});

test("near-straight limbs retain their pole when tiny tracking noise changes sign", () => {
  const normal = new Vector3(0, 0, 1);
  const a = limbFrames(new Vector3(), new Vector3(1, 0, 0), new Vector3(2, 0.001, 0), normal);
  const b = limbFrames(new Vector3(), new Vector3(1, 0, 0), new Vector3(2, -0.001, 0), normal);
  expect(a.normal.dot(b.normal)).toBeCloseTo(1);
  expect(a.upper.angleTo(b.upper)).toBeCloseTo(0);
  expect(a.lower.angleTo(b.lower)).toBeLessThan(0.003);
});

test("extending and rebending through noisy near-straight poses cannot flip the limb by 180 degrees", () => {
  let pole = new Vector3(0, 0, 1);
  let previous = null;
  for (const bend of [0.1, 0.12, 0.08, 0, -0.08, -0.111, -0.18, -0.3, 0.18, 0.111]) {
    const result = limbFrames(new Vector3(), new Vector3(1, 0, 0), new Vector3(2, bend, 0), pole);
    expect(result.normal.dot(pole)).toBeGreaterThan(0.999);
    if (previous) expect(result.upper.angleTo(previous)).toBeLessThan(1e-6);
    const expectedLower = new Vector3(1, bend, 0).normalize();
    expect(new Vector3(1, 0, 0).applyQuaternion(result.lower).dot(expectedLower)).toBeGreaterThan(0.99999);
    previous = result.upper;
    pole = result.normal;
  }
});

test("a straight limb aimed along its previous pole still yields finite rotations", () => {
  const solved = limbFrames(new Vector3(), new Vector3(0, 0, 1), new Vector3(0, 0, 2), new Vector3(0, 0, 1));
  expect(solved).not.toBeNull();
  expect(solved.upper.toArray().every(Number.isFinite)).toBe(true);
});


import { expect, test } from "vitest";
import { Quaternion, Vector3 } from "three";
import { headFrame } from "./retarget";

const left = new Vector3(0.1, 1.6, 0);
const right = new Vector3(-0.1, 1.6, 0);
const nose = new Vector3(0, 1.6, 0.12);
const xAxis = new Vector3(1, 0, 0);
const yAxis = new Vector3(0, 1, 0);
const zAxis = new Vector3(0, 0, 1);
const rotate = (point, rotation) => point.clone().applyQuaternion(rotation);

function axes(rotation) {
  return [xAxis, yAxis, zAxis].map((axis) => axis.clone().applyQuaternion(rotation));
}

test.each([0.001, 1, 1000])("level ears stay level despite asymmetric face depth at scale %s", (scale) => {
  const leftEar = new Vector3(0.1, 0, 0.03).multiplyScalar(scale);
  const rightEar = new Vector3(-0.1, 0, -0.03).multiplyScalar(scale);
  const offCenterNose = new Vector3(0.02, -0.025, 0.12).multiplyScalar(scale);
  const rotation = headFrame(leftEar, rightEar, offCenterNose);
  expect(rotation).not.toBeNull();
  const [lateral, up, forward] = axes(rotation);
  expect(lateral.y).toBeCloseTo(0, 12);
  expect(lateral.dot(leftEar.clone().sub(rightEar).normalize())).toBeCloseTo(1, 12);
  expect(up.length()).toBeCloseTo(1, 12);
  expect(forward.dot(lateral)).toBeCloseTo(0, 12);
  expect(forward.z).toBeGreaterThan(0);
});

test.each([
  ["yaw", yAxis, Math.PI / 3],
  ["pitch", xAxis, Math.PI / 4],
  ["roll", zAxis, Math.PI / 6],
  ["reverse-facing yaw", yAxis, Math.PI],
])("genuine head %s follows the measured rotation", (_name, axis, angle) => {
  const expected = new Quaternion().setFromAxisAngle(axis, angle);
  const rotation = headFrame(rotate(left, expected), rotate(right, expected), rotate(nose, expected));
  expect(rotation.angleTo(expected)).toBeLessThan(1e-7);
});

test("combined head rotation retains pitch and roll even with an anatomically offset nose", () => {
  const offCenterNose = nose.clone().add(new Vector3(0.015, -0.025, 0));
  const original = headFrame(left, right, offCenterNose);
  const rotation = new Quaternion().setFromAxisAngle(yAxis, 0.6)
    .multiply(new Quaternion().setFromAxisAngle(xAxis, 0.3))
    .multiply(new Quaternion().setFromAxisAngle(zAxis, -0.4));
  const actual = headFrame(rotate(left, rotation), rotate(right, rotation), rotate(offCenterNose, rotation));
  expect(actual.angleTo(rotation.clone().multiply(original))).toBeLessThan(1e-7);
});

test("mirrored head pose reverses yaw and roll without reversing its forward or up axes", () => {
  const rotation = new Quaternion().setFromAxisAngle(yAxis, 0.6)
    .multiply(new Quaternion().setFromAxisAngle(zAxis, 0.3));
  const points = [left, right, nose].map((point) => rotate(point, rotation));
  const reflect = (point) => new Vector3(-point.x, point.y, point.z);
  const original = axes(headFrame(...points));
  const mirrored = axes(headFrame(reflect(points[1]), reflect(points[0]), reflect(points[2])));
  expect(mirrored[0].distanceTo(reflect(original[0]).negate())).toBeLessThan(1e-12);
  expect(mirrored[1].distanceTo(reflect(original[1]))).toBeLessThan(1e-12);
  expect(mirrored[2].distanceTo(reflect(original[2]))).toBeLessThan(1e-12);
});

test("missing measurable ear or nose direction produces no invented head frame", () => {
  for (const points of [
    [left, left, nose],
    [left, right, new Vector3(0, 1.6, 0)],
    [left, right, new Vector3(0.1, 1.6, 0.001)],
    [left, right, new Vector3(0, 1.6, 0.001)],
    [new Vector3(NaN, 0, 0), right, nose],
    [left, right, new Vector3(0, Infinity, 0)],
  ]) expect(headFrame(...points)).toBeNull();
});

test("head frame calculation does not mutate detector geometry", () => {
  const points = [left, right, nose].map((point) => point.clone());
  headFrame(...points);
  points.forEach((point, index) => expect(point.equals([left, right, nose][index])).toBe(true));
});

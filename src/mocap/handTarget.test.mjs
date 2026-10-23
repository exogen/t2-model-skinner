import { expect, test } from "vitest";
import { Group, Matrix4, PerspectiveCamera, Vector3 } from "three";
import { handImageTarget } from "./retarget";

function fixture(aspect = 4 / 3) {
  const root = new Group();
  const camera = new PerspectiveCamera(50, aspect, 0.01, 100);
  camera.position.set(0, 1, 5);
  camera.lookAt(0, 1, 0);
  camera.updateWorldMatrix(true, false);
  return { root, camera, reference: new Vector3(0, 1, 0) };
}
function screen(root, camera, point) {
  return root.localToWorld(point.clone()).project(camera);
}
function cameraDepth(root, camera, point) {
  return -root.localToWorld(point.clone()).applyMatrix4(camera.matrixWorldInverse).z;
}

test.each([
  { x: 0, y: 0 }, { x: 0.25, y: 0.7 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 },
])("image wrist %j maps to the same screen location at the held depth", (point) => {
  const { root, camera, reference } = fixture();
  const result = handImageTarget(root, camera, camera.aspect, { ...point, z: 0 }, reference);
  expect(result).not.toBeNull();
  const projected = screen(root, camera, result);
  expect(projected.x).toBeCloseTo(point.x * 2 - 1, 12);
  expect(projected.y).toBeCloseTo(1 - point.y * 2, 12);
  expect(cameraDepth(root, camera, result)).toBeCloseTo(cameraDepth(root, camera, reference), 12);
});

test.each([
  { cameraAspect: 16 / 9, imageAspect: 9 / 16, xScale: 81 / 256, yScale: 1 },
  { cameraAspect: 9 / 16, imageAspect: 16 / 9, xScale: 1, yScale: 81 / 256 },
  { cameraAspect: 1, imageAspect: 4 / 3, xScale: 1, yScale: 0.75 },
])("contained image aspect $imageAspect maps inside viewport aspect $cameraAspect", ({ cameraAspect, imageAspect, xScale, yScale }) => {
  const { root, camera, reference } = fixture(cameraAspect);
  const result = handImageTarget(root, camera, imageAspect, { x: 0, y: 0, z: 0 }, reference);
  const projected = screen(root, camera, result);
  expect(projected.x).toBeCloseTo(-xScale, 12);
  expect(projected.y).toBeCloseTo(yScale, 12);
});

test("custom clip-space zoom and principal-point shift are preserved during unprojection", () => {
  const { root, camera, reference } = fixture();
  const framing = new Matrix4().set(
    2.7, 0, 0, 0.42,
    0, 2.7, 0, -0.31,
    0, 0, 1, 0,
    0, 0, 0, 1,
  );
  camera.projectionMatrix.premultiply(framing);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  const projection = camera.projectionMatrix.clone();
  const inverse = camera.projectionMatrixInverse.clone();
  const point = { x: 0.81, y: 0.23, z: -0.1 };
  const result = handImageTarget(root, camera, camera.aspect, point, reference);
  const projected = screen(root, camera, result);
  expect(projected.x).toBeCloseTo(0.62, 12);
  expect(projected.y).toBeCloseTo(0.54, 12);
  expect(cameraDepth(root, camera, result)).toBeCloseTo(5, 12);
  expect(camera.projectionMatrix.equals(projection)).toBe(true);
  expect(camera.projectionMatrixInverse.equals(inverse)).toBe(true);
});

test("root-space targets survive translated, rotated and nonuniformly scaled ancestors", () => {
  const parent = new Group();
  parent.position.set(2, 1, -3);
  parent.rotation.set(0.2, 0.5, -0.1);
  parent.scale.set(1.5, 0.8, 1.2);
  const root = new Group();
  root.position.set(-0.3, 0.2, 0.5);
  root.rotation.set(-0.1, 0.2, 0.1);
  root.scale.set(2, 1.2, 0.7);
  parent.add(root);
  const reference = new Vector3(0.1, 0.2, 0.3);
  const worldReference = root.localToWorld(reference.clone());
  const camera = new PerspectiveCamera(45, 1.4, 0.1, 50);
  camera.position.copy(worldReference).add(new Vector3(3, 2, 8));
  camera.lookAt(worldReference);
  camera.updateWorldMatrix(true, false);
  const result = handImageTarget(root, camera, 1.4, { x: 0.2, y: 0.8, z: 123 }, reference);
  const projected = screen(root, camera, result);
  expect(projected.x).toBeCloseTo(-0.6, 12);
  expect(projected.y).toBeCloseTo(-0.6, 12);
  expect(cameraDepth(root, camera, result)).toBeCloseTo(cameraDepth(root, camera, reference), 12);
});

test("placeholder confidence and image Z do not replace the caller's held depth or mutate inputs", () => {
  const { root, camera, reference } = fixture();
  const wrist = { x: 0.7, y: 0.3, z: -999, visibility: 0, presence: 0 };
  const snapshot = JSON.stringify({ wrist, reference, position: root.position, scale: root.scale,
    rotation: root.quaternion, cameraPosition: camera.position, cameraRotation: camera.quaternion });
  const a = handImageTarget(root, camera, camera.aspect, wrist, reference);
  const b = handImageTarget(root, camera, camera.aspect, { ...wrist, z: 999, presence: NaN }, reference);
  expect(a.distanceTo(b)).toBe(0);
  expect(JSON.stringify({ wrist, reference, position: root.position, scale: root.scale,
    rotation: root.quaternion, cameraPosition: camera.position, cameraRotation: camera.quaternion })).toBe(snapshot);
});

test.each([
  { x: -0.01, y: 0.5, z: 0 }, { x: 1.01, y: 0.5, z: 0 },
  { x: 0.5, y: -0.01, z: 0 }, { x: 0.5, y: 1.01, z: 0 },
  { x: NaN, y: 0.5, z: 0 }, { x: 0.5, y: Infinity, z: 0 }, { x: 0.5, y: 0.5, z: NaN },
])("off-image or nonfinite image wrists are rejected: %j", (wrist) => {
  const { root, camera, reference } = fixture();
  expect(handImageTarget(root, camera, camera.aspect, wrist, reference)).toBeNull();
});

test.each([0, -1, NaN, Infinity])("invalid image aspect %s is rejected", (aspect) => {
  const { root, camera, reference } = fixture();
  expect(handImageTarget(root, camera, aspect, { x: 0.5, y: 0.5, z: 0 }, reference)).toBeNull();
});

test.each([0, -1, 0.005, 100, 101])("reference camera depth %s outside the clipping planes is rejected", (depth) => {
  const { root, camera } = fixture();
  const reference = new Vector3(0, 1, 5 - depth);
  expect(handImageTarget(root, camera, camera.aspect, { x: 0.5, y: 0.5, z: 0 }, reference)).toBeNull();
});

test("nonfinite depth references and singular projections do not produce a target", () => {
  const { root, camera, reference } = fixture();
  const point = { x: 0.5, y: 0.5, z: 0 };
  expect(handImageTarget(root, camera, camera.aspect, point, new Vector3(NaN, 0, 0))).toBeNull();
  camera.projectionMatrix.elements.fill(0);
  camera.projectionMatrixInverse.elements.fill(0);
  expect(handImageTarget(root, camera, camera.aspect, point, reference)).toBeNull();
});

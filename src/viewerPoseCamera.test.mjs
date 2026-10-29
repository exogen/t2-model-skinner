import { afterEach, expect, test, vi } from "vitest";
import { getEnv } from "fabric";
import { Group, PerspectiveCamera, Sphere, Spherical, Vector3 } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import Viewer from "./Viewer";

const { document } = getEnv();
const controllers = [];
afterEach(() => {
  controllers.splice(0).forEach((controls) => controls.dispose());
});

function harness() {
  const camera = new PerspectiveCamera(30, 1.4, 0.001, 100);
  const controls = new OrbitControls(camera, document.createElement("canvas"));
  controllers.push(controls);
  controls.enableDamping = true;
  controls.target.set(0.1, 0.7, -0.2);
  camera.position
    .setFromSpherical(new Spherical(3, (Math.PI * 75) / 180, 0.5))
    .add(controls.target);
  controls.update();
  camera.updateWorldMatrix(true, false);
  return Object.assign(Object.create(Viewer.prototype), {
    camera,
    controls,
    posing: false,
    model: { scene: new Group() },
    poseFraming: null,
    editorCamera: null,
    rig: { reset: vi.fn() },
    action: null,
    mixer: null,
    invalidate: vi.fn(),
    bounds: new Sphere(controls.target.clone(), 1),
    initialDistance: 3,
    cameraOptions: {},
    // fitModel sets these for a model of radius 1.
    baseFov: 30,
    idealAspect: 1,
    minRadius: 2.2,
    maxRadius: 1.05 / Math.sin(Math.PI / 12),
    goalRadius: 3,
    goalLogFov: Math.log(30),
  });
}

/** Steps the zoom until it settles. */
function settle(viewer) {
  for (let frame = 0; frame < 1000 && viewer.stepZoom(1 / 60); frame++);
}

function saved(viewer) {
  return {
    position: viewer.camera.position.clone(),
    rotation: viewer.camera.quaternion.clone(),
    fov: viewer.camera.fov,
    target: viewer.controls.target.clone(),
  };
}
function expectSaved(viewer, before) {
  expect(viewer.camera.position.distanceTo(before.position)).toBeLessThan(
    1e-12,
  );
  expect(viewer.camera.quaternion.angleTo(before.rotation)).toBeLessThan(1e-7);
  expect(viewer.camera.fov).toBe(before.fov);
  expect(viewer.controls.target.equals(before.target)).toBe(true);
  // Nothing eases the view anywhere else afterwards.
  expect(viewer.stepZoom(1 / 60)).toBe(false);
  expect(viewer.camera.position.distanceTo(before.position)).toBeLessThan(
    1e-12,
  );
  expect(viewer.camera.fov).toBe(before.fov);
}
function expectFront(viewer) {
  const offset = viewer.camera.position.clone().sub(viewer.controls.target);
  expect(Math.abs(offset.x)).toBeLessThan(1e-12);
  expect(Math.abs(offset.y)).toBeLessThan(1e-12);
  expect(offset.z).toBeGreaterThan(0);
  expect(
    viewer.camera
      .getWorldDirection(new Vector3())
      .distanceTo(new Vector3(0, 0, -1)),
  ).toBeLessThan(1e-12);
}

test("mocap starts front-on and restores the editor orbit after live rotation/zoom and repeated sessions", () => {
  const viewer = harness();
  viewer.adjustZoom(-0.3);
  settle(viewer);
  const before = saved(viewer);
  for (let repeat = 0; repeat < 3; repeat++) {
    viewer.setPoseMode(true);
    expectFront(viewer);
    expect(
      viewer.camera.position.distanceTo(viewer.controls.target),
    ).toBeCloseTo(before.position.distanceTo(before.target), 12);
    // The pose camera keeps the editor's lens.
    expect(viewer.camera.fov).toBe(before.fov);
    // Inspection remains possible, but cannot replace the editor's saved view.
    viewer.camera.position.set(2, 3, 4);
    viewer.controls.update();
    viewer.adjustZoom(0.4);
    settle(viewer);
    expect(viewer.camera.fov).toBeGreaterThan(before.fov + 5);
    viewer.setPoseMode(true);
    viewer.setPoseMode(false);
    expectSaved(viewer, before);
    expect(viewer.controls.enableDamping).toBe(true);
  }
});

test("an elevated camera creates apparent roll from yaw that the mocap view removes", () => {
  const viewer = harness();
  viewer.resetCamera();
  const center = viewer.controls.target.clone();
  const span = new Vector3(Math.SQRT1_2, 0, -Math.SQRT1_2).multiplyScalar(0.2);
  const roll = () => {
    viewer.camera.updateWorldMatrix(true, false);
    const left = center.clone().add(span).project(viewer.camera);
    const right = center.clone().sub(span).project(viewer.camera);
    return (
      (Math.atan2(left.y - right.y, (left.x - right.x) * viewer.camera.aspect) *
        180) /
      Math.PI
    );
  };
  expect(Math.abs(roll())).toBeGreaterThan(14);
  viewer.setPoseMode(true);
  expect(Math.abs(roll())).toBeLessThan(1e-9);
});

test("reset and a newly fitted model retain a level mocap view and restore the new configured editor view", () => {
  const viewer = harness();
  viewer.setPoseMode(true);
  viewer.camera.position.set(2, 3, 4);
  viewer.controls.update();
  viewer.adjustZoom(-0.5);
  settle(viewer);
  viewer.resetCamera();
  expectFront(viewer);
  // fitModel updates these before resetCamera on every model replacement.
  viewer.bounds = new Sphere(new Vector3(-0.4, 1.1, 0.3), 0.5);
  viewer.initialDistance = 1.5;
  [viewer.minRadius, viewer.maxRadius] = [1.1, 0.525 / Math.sin(Math.PI / 12)];
  viewer.cameraOptions = { orbit: "30deg 65deg 105%" };
  viewer.editorCamera = null;
  viewer.resetCamera();
  expectFront(viewer);
  viewer.adjustZoom(-0.5);
  settle(viewer);
  viewer.setPoseMode(false);
  const expected = new Vector3()
    .setFromSpherical(new Spherical(1.5, (65 * Math.PI) / 180, Math.PI / 6))
    .add(viewer.bounds.center);
  expect(viewer.camera.position.distanceTo(expected)).toBeLessThan(1e-12);
  expect(viewer.controls.target.equals(viewer.bounds.center)).toBe(true);
  // Unzoomed.
  expect(viewer.camera.fov).toBeCloseTo(30, 12);
  expect(viewer.stepZoom(1 / 60)).toBe(false);
});

test("mocap started in the middle of a zoom keeps the view as drawn, and nothing eases after", () => {
  const viewer = harness();
  viewer.adjustZoom(-0.5);
  viewer.stepZoom(1 / 60);
  const before = saved(viewer);
  expect(before.fov).toBeLessThan(30);
  expect(before.fov).toBeGreaterThan(30 * Math.exp(-0.5));
  viewer.setPoseMode(true);
  expect(viewer.camera.position.distanceTo(viewer.controls.target)).toBeCloseTo(
    before.position.distanceTo(before.target),
    12,
  );
  expect(viewer.camera.fov).toBe(before.fov);
  expect(viewer.stepZoom(1 / 60)).toBe(false);
  viewer.setPoseMode(false);
  expectSaved(viewer, before);
});

test("starting before model loading does not save the empty camera as the editor view", () => {
  const viewer = harness();
  viewer.model = null;
  viewer.setPoseMode(true);
  expect(viewer.editorCamera).toBeNull();
  viewer.model = { scene: new Group() };
  viewer.resetCamera();
  expectFront(viewer);
  viewer.setPoseMode(false);
  const expected = new Vector3()
    .setFromSpherical(new Spherical(3, (Math.PI * 75) / 180, 0))
    .add(viewer.bounds.center);
  expect(viewer.camera.position.distanceTo(expected)).toBeLessThan(1e-12);
});

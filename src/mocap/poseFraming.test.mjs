import { expect, test, vi } from "vitest";
import { Box3, Matrix4, Scene, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { modelTypes } from "../models";
import { createPlayerRig } from "./rig";
import { createPoseFraming } from "./cameraFraming";
import { expectTransform, facePose, framedPlayer, projectPose, torso } from "./framingTestUtils.mjs";
import Viewer from "../Viewer";

function fixture(name = "lmale") {
  return framedPlayer(name, createPoseFraming, { offset: [0.003, 0.004, -0.002] });
}

function projectionTransform(camera, base) {
  const matrix = new Matrix4().multiplyMatrices(camera.projectionMatrix, base.projectionMatrixInverse);
  expect(matrix.elements[0]).toBeCloseTo(matrix.elements[5], 12);
  return { scale: matrix.elements[0], x: matrix.elements[12], y: matrix.elements[13] };
}

function cameraState(camera) {
  return {
    position: camera.position.toArray(), rotation: camera.quaternion.toArray(),
    scale: camera.scale.toArray(), matrix: camera.matrix.toArray(), world: camera.matrixWorld.toArray(),
    projection: camera.projectionMatrix.toArray(), inverse: camera.projectionMatrixInverse.toArray(),
    view: camera.view && { ...camera.view }, zoom: camera.zoom, fov: camera.fov,
    aspect: camera.aspect, near: camera.near, far: camera.far,
  };
}

function modelState(root) {
  root.updateWorldMatrix(true, true);
  const state = [];
  root.traverse((node) => {
    state.push([node.position.toArray(), node.quaternion.toArray(), node.scale.toArray()]);
    if (!node.isSkinnedMesh) return;
    state.push([node.bindMatrix.toArray(), node.bindMatrixInverse.toArray()]);
    for (let index = 0; index < node.geometry.attributes.position.count; index++) {
      state.push(node.getVertexPosition(index, new Vector3()).applyMatrix4(node.matrixWorld).toArray());
    }
  });
  return state;
}

function expectImageAlignment(root, camera, points, imageAspect) {
  const width = Math.min(1, imageAspect / camera.aspect);
  const height = Math.min(1, camera.aspect / imageAspect);
  for (const [index, name] of torso) {
    const point = root.getObjectByName(`Bip01_${name}`).getWorldPosition(new Vector3()).project(camera);
    expect(point.x).toBeCloseTo((2 * points[index].x - 1) * width, 9);
    expect(point.y).toBeCloseTo((1 - 2 * points[index].y) * height, 9);
    // The near/far projection is unchanged even during extreme close-ups.
    expect(point.z).toBeGreaterThan(-1);
    expect(point.z).toBeLessThan(1);
  }
}

test.each(modelTypes.player)("%s matches camera XY and scale without changing the model or editor camera", async (name) => {
  const { root, camera: base, framing } = await fixture(name);
  const cameraBefore = cameraState(base);
  const modelBefore = modelState(root);
  const transform = { scale: 2.1, x: -0.15, y: 0.1 };
  const points = projectPose(root, base, transform, 4 / 3);
  framing.setInput(points, 640, 480);
  const camera = framing.update(base, 1 / 60);
  expect(camera).not.toBe(base);
  expectTransform(projectionTransform(camera, base), transform);
  expectImageAlignment(root, camera, points, 4 / 3);
  const identity = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.projectionMatrixInverse);
  identity.elements.forEach((value, index) => expect(value).toBeCloseTo(index % 5 === 0 ? 1 : 0, 10));
  expect(cameraState(base)).toEqual(cameraBefore);
  expect(modelState(root)).toEqual(modelBefore);
  framing.reset();
  expect(framing.imageAspect).toBeNull();
  expect(framing.update(base, 1 / 60)).toBeNull();
  expect(cameraState(base)).toEqual(cameraBefore);
  expect(modelState(root)).toEqual(modelBefore);
});

test.each(modelTypes.player)("%s can fill the frame with its head using only visible facial landmarks", async (name) => {
  const { root, camera: base, framing } = await fixture(name);
  const head = root.getObjectByName("Bip01_Head");
  const headVertices = [];
  root.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const joint = mesh.skeleton.bones.indexOf(head);
    if (joint < 0) return;
    const indices = mesh.geometry.attributes.skinIndex;
    const weights = mesh.geometry.attributes.skinWeight;
    for (let index = 0; index < indices.count; index++) {
      let influence = 0;
      for (let component = 0; component < indices.itemSize; component++) {
        if (indices.getComponent(index, component) === joint) influence += weights.getComponent(index, component);
      }
      if (influence >= 0.5) headVertices.push(mesh.getVertexPosition(index, new Vector3()).applyMatrix4(mesh.matrixWorld));
    }
  });
  const footprint = (camera) => new Box3().setFromPoints(headVertices.map((point) => point.clone().project(camera)));
  const original = footprint(base);
  framing.setInput(facePose({ mouth: false }), 600, 500);
  const camera = framing.update(base, 0);
  const close = footprint(camera);
  expect(close.getSize(new Vector3()).x).toBeGreaterThan(0.8);
  expect(close.getSize(new Vector3()).y).toBeGreaterThan(0.6);
  expect(close.getSize(new Vector3()).x).toBeGreaterThan(original.getSize(new Vector3()).x * 3);
  // Some torso is naturally cropped; zoom must not bring the face through the
  // near plane or move any vertex physically closer to the camera.
  expect(close.min.z).toBeCloseTo(original.min.z, 12);
  expect(close.max.z).toBeCloseTo(original.max.z, 12);
  expect(camera.position.equals(base.position)).toBe(true);
});

test("log zoom and framing-center damping agree at 30, 60 and 120 render frames per second", async () => {
  const { root, camera: base } = await fixture();
  const first = { scale: 0.8, x: 0.1, y: -0.05 };
  const second = { scale: 2.2, x: -0.2, y: 0.12 };
  const measured = [];
  for (const fps of [30, 60, 120]) {
    const framing = createPoseFraming(root);
    framing.setInput(projectPose(root, base, first), 600, 500);
    expectTransform(projectionTransform(framing.update(base, 0), base), first);
    framing.setInput(projectPose(root, base, second), 600, 500);
    let camera;
    for (let index = 0; index < fps / 2; index++) camera = framing.update(base, 1 / fps);
    measured.push(projectionTransform(camera, base));
  }
  const remaining = Math.exp(-8 * 0.5);
  const scale = Math.exp(Math.log(second.scale) + (Math.log(first.scale) - Math.log(second.scale)) * remaining);
  const centerX = -second.x / second.scale + (-first.x / first.scale + second.x / second.scale) * remaining;
  const centerY = -second.y / second.scale + (-first.y / first.scale + second.y / second.scale) * remaining;
  for (const actual of measured) expectTransform(actual, { scale, x: -centerX * scale, y: -centerY * scale });
});

test("tracking loss holds its last view, reacquisition eases toward the new one, and reset forgets it", async () => {
  const { root, camera: base, framing } = await fixture();
  const first = { scale: 1.5, x: -0.2, y: 0.1 };
  const next = { scale: 2.4, x: 0.1, y: -0.2 };
  framing.setInput(projectPose(root, base, first, 4 / 3), 640, 480);
  const established = projectionTransform(framing.update(base, 0), base);
  framing.setInput([]);
  for (let index = 0; index < 120; index++) {
    expectTransform(projectionTransform(framing.update(base, 1 / 60), base), established);
  }
  expect(framing.imageAspect).toBe(4 / 3);
  framing.setInput(projectPose(root, base, next, 4 / 3), 640, 480);
  const changed = projectionTransform(framing.update(base, 1 / 60), base);
  expect(changed.scale).toBeGreaterThan(established.scale);
  expect(changed.scale).toBeLessThan(next.scale);
  framing.reset();
  expect(framing.update(base, 1 / 60)).toBeNull();
  framing.setInput(projectPose(root, base, next, 4 / 3), 640, 480);
  expectTransform(projectionTransform(framing.update(base, 0), base), next);
});

test("resizing, camera zoom and orbit changes remeasure against the unmodified base projection", async () => {
  const { root, camera: base, center, radius, framing } = await fixture();
  for (const [aspect, zoom, angle] of [[0.6, 1, 0], [2, 1.4, 0.3], [1.2, 0.8, -0.35]]) {
    base.aspect = aspect;
    base.zoom = zoom;
    base.position.copy(center).add(new Vector3(Math.sin(angle) * radius * 8, radius / 2, Math.cos(angle) * radius * 8));
    base.lookAt(center);
    base.updateWorldMatrix(true, false);
    base.updateProjectionMatrix();
    const imageAspect = 4 / 3;
    const transform = { scale: 0.7, x: 0.03, y: -0.02 };
    const points = projectPose(root, base, transform, imageAspect);
    const before = cameraState(base);
    framing.setInput(points, 640, 480);
    let camera;
    for (let index = 0; index < 240; index++) camera = framing.update(base, 1 / 60);
    expectTransform(projectionTransform(camera, base), transform);
    expectImageAlignment(root, camera, points, imageAspect);
    expect(cameraState(base)).toEqual(before);
  }
});

test("invalid frame timing and camera dimensions do not corrupt an established view", async () => {
  const { root, camera: base, framing } = await fixture();
  framing.setInput(projectPose(root, base, { scale: 1, x: 0, y: 0 }), 640, 480);
  const initial = projectionTransform(framing.update(base, 0), base);
  framing.setInput(projectPose(root, base, { scale: 2, x: 0.2, y: 0.1 }), NaN, Infinity);
  expect(framing.imageAspect).toBe(4 / 3);
  for (const delta of [0, -1, NaN, Infinity]) expectTransform(projectionTransform(framing.update(base, delta), base), initial);
  const clamped = projectionTransform(framing.update(base, 100), base);
  expect(clamped.scale).toBeGreaterThan(initial.scale);
  expect(clamped.scale).toBeLessThan(2);
});

function viewerHarness({ root, camera, gltf, center }) {
  const scene = new Scene();
  scene.add(root);
  return Object.assign(Object.create(Viewer.prototype), {
    scene, model: gltf, camera, controls: { target: center.clone(), update: vi.fn() },
    rig: createPlayerRig(root), posing: true, poseFraming: null,
    poseRuntime: { createPlayerRig, createPoseFraming },
    originalTextures: new Set(), action: null, mixer: null,
    invalidate: vi.fn(), fitModel: vi.fn(), modelGeneration: 0, disposed: false,
  });
}

test("repeated Viewer stop/start restores the original view without camera or model drift", async () => {
  const data = await fixture("lfemale");
  const viewer = viewerHarness(data);
  viewer.posing = false;
  const before = cameraState(data.camera);
  const original = modelState(data.root);
  const points = projectPose(data.root, data.camera, { scale: 2, x: 0.2, y: -0.15 });
  for (let repeat = 0; repeat < 3; repeat++) {
    viewer.setPoseMode(true);
    expect(data.camera.position.x).toBe(data.center.x);
    expect(data.camera.position.y).toBe(data.center.y);
    expect(data.camera.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    viewer.setPoseFraming(points, 600, 500);
    expect(viewer.poseFraming.update(data.camera, 0)).not.toBeNull();
    viewer.setPoseMode(false);
    expect(viewer.poseFraming.update(data.camera, 1 / 60)).toBeNull();
    expect(viewer.poseFraming.imageAspect).toBeNull();
    viewer.setPoseFraming(points, 600, 500);
    expect(viewer.poseFraming.update(data.camera, 1 / 60)).toBeNull();
    expect(cameraState(data.camera)).toEqual(before);
    expect(modelState(data.root)).toEqual(original);
  }
  viewer.clearModel();
  expect(viewer.poseFraming).toBeNull();
});

test("loading another model clears the previous framing and leaves both roots unchanged", async () => {
  const first = await fixture("lmale");
  const second = await fixture("hbioderm");
  const viewer = viewerHarness(first);
  const firstOriginal = first.root.position.clone();
  const secondOriginal = second.root.position.clone();
  viewer.setPoseFraming(facePose({ mouth: false }), 640, 480);
  const oldFraming = viewer.poseFraming;
  expect(oldFraming.update(first.camera, 0)).not.toBeNull();
  const load = vi.spyOn(GLTFLoader.prototype, "loadAsync").mockResolvedValueOnce(second.gltf);
  try {
    await viewer.load("/hbioderm.glb", {});
    expect(viewer.poseFraming).toBeNull();
    expect(first.root.position.equals(firstOriginal)).toBe(true);
    expect(second.root.position.equals(secondOriginal)).toBe(true);
    viewer.setPoseFraming([], 640, 480);
    expect(viewer.poseFraming).not.toBe(oldFraming);
    expect(viewer.poseFraming.update(first.camera, 1 / 60)).toBeNull();
    viewer.clearModel();
    expect(viewer.poseFraming).toBeNull();
    expect(second.root.position.equals(secondOriginal)).toBe(true);
  } finally {
    load.mockRestore();
  }
});

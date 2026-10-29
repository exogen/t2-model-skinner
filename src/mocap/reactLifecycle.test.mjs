import { afterEach, beforeEach, expect, test, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { getEnv } from "fabric";
import { PerspectiveCamera, Scene, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import ViewerProvider from "../ViewerProvider";
import WarriorViewer from "../WarriorViewer";
import MocapPose from "./MocapPose";
import { createPlayerRig } from "./rig";
import { createPoseFraming } from "./cameraFraming";
import { loadPlayer } from "./playerTestUtils.mjs";
import { idleRecorder } from "./recorderTestUtils";

const fixture = vi.hoisted(() => ({
  viewer: null,
  warrior: null,
  active: false,
  runtime: undefined,
  latestPose: { current: null },
  recorder: null,
}));
vi.mock("../MocapProvider", () => ({
  useMocap: () => ({
    active: fixture.active,
    runtime: fixture.runtime && { viewerRuntime: fixture.runtime },
    tracking: {
      latestPose: fixture.latestPose,
      settings: { smoothing: "classic" },
      recorder: fixture.recorder,
    },
  }),
  LiveMocapPose: () => React.createElement(MocapPose),
}));
vi.mock("../useWarrior", () => ({ default: () => fixture.warrior }));
vi.mock("../useEnvironment", () => ({
  default: () => ({
    environmentImageUrl: null,
    showEnvironment: false,
    exposure: 1,
    renderMode: "skin",
  }),
}));
vi.mock("../Materials", () => ({ default: () => null }));
vi.mock("../Viewer", async (importOriginal) => ({
  ...(await importOriginal()),
  default: class {
    constructor() {
      return fixture.viewer;
    }
  },
}));

const { document } = getEnv();
const poseRuntime = {
  createPlayerRig: vi.fn(createPlayerRig),
  createPoseFraming,
};
let root;
let host;
beforeEach(() => {
  fixture.recorder = idleRecorder();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  root = host = undefined;
  fixture.active = false;
  fixture.runtime = undefined;
  fixture.latestPose.current = null;
  poseRuntime.createPlayerRig.mockClear();
  vi.restoreAllMocks();
});

async function harness() {
  const { default: Viewer } = await vi.importActual("../Viewer");
  const viewer = Object.create(Viewer.prototype);
  const frames = new Set();
  const poseFrames = new Set();
  Object.assign(viewer, {
    scene: new Scene(),
    camera: new PerspectiveCamera(),
    controls: { target: new Vector3(), update: vi.fn() },
    model: null,
    rig: null,
    poseRuntime: null,
    mixer: null,
    action: null,
    originalTextures: new Set(),
    renderMode: "skin",
    randomColorGeometries: new Map(),
    posing: false,
    paused: false,
    disposed: false,
    poseAnimationTime: 0,
    modelGeneration: 0,
    playbackSpeed: 1,
    fitModel: vi.fn(),
    invalidate: vi.fn(),
    setExposure: vi.fn(),
    setEnvironment: vi.fn(async () => {}),
    subscribeFrame(callback) {
      frames.add(callback);
      return () => frames.delete(callback);
    },
    subscribePoseFrame(callback) {
      poseFrames.add(callback);
      return () => poseFrames.delete(callback);
    },
    dispose() {
      this.disposed = true;
      this.clearModel();
    },
  });
  fixture.viewer = viewer;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  return { viewer, frames, poseFrames };
}

async function render({ name = "lmale", active = false, paused = false } = {}) {
  fixture.active = active;
  if (active) fixture.runtime = poseRuntime;
  fixture.warrior = {
    selectedModel: name,
    selectedModelUrl: `/${name}.anim.glb`,
    selectedModelType: "player",
    selectedAnimation: "Forward",
    animationPaused: paused,
    slowModeEnabled: false,
  };
  await act(async () =>
    root.render(
      React.createElement(
        ViewerProvider,
        null,
        React.createElement(WarriorViewer),
      ),
    ),
  );
}

function snapshot(scene) {
  const result = [];
  scene.traverse((node) =>
    result.push([node, node.position.clone(), node.quaternion.clone()]),
  );
  return result;
}

function expectPose(pose) {
  for (const [node, position, rotation] of pose) {
    expect(node.position.distanceTo(position), node.name).toBeLessThan(1e-9);
    expect(
      node.quaternion.clone().normalize().angleTo(rotation.clone().normalize()),
      node.name,
    ).toBeLessThan(1e-6);
  }
}

test.each([false, true])(
  "React effect cleanup preserves the resumed animation pose (paused=%s)",
  async (paused) => {
    const gltf = await loadPlayer("lmale", true);
    vi.spyOn(GLTFLoader.prototype, "loadAsync").mockResolvedValue(gltf);
    const { viewer, frames, poseFrames } = await harness();
    await render({ paused });
    expect(viewer.rig).toBeNull();
    expect(poseRuntime.createPlayerRig).not.toHaveBeenCalled();
    viewer.mixer.update(0.23);
    const expectedTime = viewer.action.time;
    const expectedPose = snapshot(gltf.scene);
    for (let repeat = 0; repeat < 2; repeat++) {
      await render({ active: true, paused });
      expect(frames.size).toBe(1);
      expect(poseFrames.size).toBe(1);
      expect(viewer.action.isRunning()).toBe(false);
      gltf.scene.getObjectByName("Bip01_Pelvis").rotation.y += 1;
      await render({ active: false, paused });
      expect(frames.size).toBe(0);
      expect(poseFrames.size).toBe(0);
      expect(viewer.paused).toBe(paused);
      expect(viewer.action.time).toBeCloseTo(expectedTime, 10);
      expectPose(expectedPose);
    }
    expect(poseRuntime.createPlayerRig).toHaveBeenCalledOnce();
  },
);

test("changing the model and stopping mocap in one React commit does not reset the new animation", async () => {
  const first = await loadPlayer("lmale", true);
  const second = await loadPlayer("hbioderm", true);
  vi.spyOn(GLTFLoader.prototype, "loadAsync")
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second);
  const { viewer, frames, poseFrames } = await harness();
  await render();
  viewer.mixer.update(0.2);
  await render({ active: true });
  const previousRig = viewer.rig;
  const previousReset = vi.spyOn(previousRig, "reset");
  await render({ name: "hbioderm", active: false });
  expect(frames.size).toBe(0);
  expect(poseFrames.size).toBe(0);
  expect(viewer.rig).not.toBe(previousRig);
  expect(previousReset).toHaveBeenCalled();
  expect(viewer.action.isRunning()).toBe(true);
  expect(viewer.action.time).toBe(0);
  const animatedPose = snapshot(second.scene);
  viewer.mixer.update(0);
  expectPose(animatedPose);
});

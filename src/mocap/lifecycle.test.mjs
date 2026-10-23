import { performance } from "node:perf_hooks";
import { afterEach, expect, test, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { getEnv } from "fabric";
import { AnimationMixer, PerspectiveCamera, Quaternion, Scene, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import Viewer from "../Viewer";
import { ModelViewerContext } from "../useModelViewer";
import MocapPose from "./MocapPose";
import { createPlayerRig } from "./rig";
import { createPoseFraming } from "./cameraFraming";
import { framingLandmarks, mirrorPoseLandmarks, mirrorTrackedHands } from "./mirrorPose";
import { loadPlayer } from "./playerTestUtils.mjs";
import { idleRecorder } from "./recorderTestUtils";
import { createTake, framingAt } from "./recording";

const fixture = vi.hoisted(() => ({ mocap: null }));
vi.mock("../MocapProvider", () => ({ useMocap: () => fixture.mocap }));
const { document } = getEnv();
const poseRuntime = { createPlayerRig, createPoseFraming };

// Exercise the real loader, mixer, and Viewer lifecycle methods without making
// the test runner create a WebGL context or request animation frames.
function viewerHarness(gltf = null, runtime = poseRuntime) {
  const viewer = Object.create(Viewer.prototype);
  const callbacks = new Set();
  const poseCallbacks = new Set();
  Object.assign(viewer, {
    scene: new Scene(), camera: new PerspectiveCamera(),
    controls: { target: new Vector3(), update: vi.fn() },
    model: gltf, rig: gltf && runtime ? runtime.createPlayerRig(gltf.scene) : null, poseRuntime: runtime,
    mixer: gltf ? new AnimationMixer(gltf.scene) : null,
    action: null, poseAnimationTime: 0, posing: false, paused: false, originalTextures: new Set(),
    playbackSpeed: 1, disposed: false, modelGeneration: 0,
    invalidate: vi.fn(), resetCamera: vi.fn(), fitModel: vi.fn(),
    subscribeFrame(callback) {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    subscribePoseFrame(callback) {
      poseCallbacks.add(callback);
      return () => poseCallbacks.delete(callback);
    },
  });
  if (gltf) viewer.scene.add(gltf.scene);
  return { viewer, callbacks, poseCallbacks };
}

function transforms(scene) {
  const result = [];
  scene.traverse((node) => result.push([node, node.position.clone(), node.quaternion.clone(), node.scale.clone()]));
  return result;
}

function expectTransforms(expected) {
  for (const [node, position, quaternion, scale] of expected) {
    expect(node.position.distanceTo(position), `${node.name} position`).toBeLessThan(1e-9);
    expect(node.quaternion.clone().normalize().angleTo(quaternion.clone().normalize()), `${node.name} rotation`).toBeLessThan(1e-6);
    expect(node.scale.distanceTo(scale), `${node.name} scale`).toBeLessThan(1e-9);
  }
}

let reactRoot;
let host;
afterEach(async () => {
  if (reactRoot) await act(async () => reactRoot.unmount());
  reactRoot = undefined;
  host?.remove();
  host = undefined;
  fixture.mocap = null;
  vi.restoreAllMocks();
});

test.each(["lmale", "hmale", "lfemale", "hbioderm"])("%s resumes the same animation time and pose after live posing", async (name) => {
  const gltf = await loadPlayer(name, true);
  const { viewer } = viewerHarness(gltf);
  const rest = transforms(gltf.scene);
  const clip = gltf.animations.find((clip) => clip.name === "Forward");
  viewer.setAnimation(clip.name, false, 0.5);
  viewer.mixer.update(clip.duration * 0.37);
  const time = viewer.action.time;
  const animated = transforms(gltf.scene);
  expect(animated.some(([node, position], i) => position.distanceTo(rest[i][1]) > 1e-7)).toBe(true);
  viewer.setPoseMode(true);
  expectTransforms(rest);
  expect(viewer.action.isRunning()).toBe(false);
  const pelvis = gltf.scene.getObjectByName("Bip01_Pelvis");
  pelvis.quaternion.setFromAxisAngle({ x: 0, y: 1, z: 0 }, 1);
  viewer.setPoseMode(false);
  expect(viewer.action.time).toBeCloseTo(time, 10);
  expect(viewer.action.isRunning()).toBe(true);
  expectTransforms(animated);
  viewer.mixer.update(0.01);
  expect(viewer.action.time).toBeCloseTo(time + 0.01, 10);
});

test("a paused animation remains paused at the saved time when live posing stops", async () => {
  const gltf = await loadPlayer("lmale", true);
  const { viewer } = viewerHarness(gltf);
  viewer.setAnimation("Forward", true, 0.05);
  viewer.mixer.update(0.25);
  const time = viewer.action.time;
  const pose = transforms(gltf.scene);
  viewer.setPoseMode(true);
  viewer.setPoseMode(false);
  expect(viewer.paused).toBe(true);
  expect(viewer.playbackSpeed).toBe(0.05);
  expect(viewer.action.time).toBe(time);
  expectTransforms(pose);
});

test.each(["lmale", "hbioderm"].flatMap((model) => [false, true].map((paused) => [model, paused])))(
  "%s binds its exported rest pose lazily without changing an existing animation (paused=%s)", async (name, paused) => {
    const gltf = await loadPlayer(name, true);
    const rest = transforms(gltf.scene);
    const { viewer } = viewerHarness(gltf, null);
    viewer.setAnimation("Forward", paused, 0.5);
    viewer.mixer.update(0.37);
    const time = viewer.action.time;
    const animated = transforms(gltf.scene);
    expect(viewer.rig).toBeNull();
    const bind = vi.fn((scene) => {
      expectTransforms(rest);
      return createPlayerRig(scene);
    });
    const runtime = { ...poseRuntime, createPlayerRig: bind };
    const rig = viewer.setPoseRuntime(runtime);
    expect(rig).not.toBeNull();
    expect(viewer.setPoseRuntime(runtime)).toBe(rig);
    expect(bind).toHaveBeenCalledOnce();
    expect(viewer.paused).toBe(paused);
    expect(viewer.action.time).toBeCloseTo(time, 10);
    expectTransforms(animated);
    viewer.setPoseMode(true);
    expectTransforms(rest);
    viewer.setPoseMode(false);
    expectTransforms(animated);
  },
);

test("ordinary model loading does not create a rig, and a runtime arriving during the next load binds only current scenes", async () => {
  const first = await loadPlayer("lmale", true);
  const second = await loadPlayer("hbioderm", true);
  const { viewer } = viewerHarness(null, null);
  let resolve;
  vi.spyOn(GLTFLoader.prototype, "loadAsync").mockResolvedValueOnce(first)
    .mockReturnValueOnce(new Promise((ready) => { resolve = ready; }));
  const loaded = await viewer.load("/lmale.anim.glb", {});
  expect(loaded.rig).toBeNull();
  expect(viewer.rig).toBeNull();
  const pending = viewer.load("/hbioderm.anim.glb", {});
  const bind = vi.fn(createPlayerRig);
  const runtime = { ...poseRuntime, createPlayerRig: bind };
  const firstRig = viewer.setPoseRuntime(runtime);
  const dispose = vi.spyOn(firstRig, "dispose");
  resolve(second);
  const next = await pending;
  expect(dispose).toHaveBeenCalledOnce();
  expect(next.rig).not.toBeNull();
  expect(next.rig).not.toBe(firstRig);
  expect(viewer.setPoseRuntime(runtime)).toBe(next.rig);
  expect(bind.mock.calls.map(([scene]) => scene)).toEqual([first.scene, second.scene]);
});

test("a model load canceled before lazy runtime installation cannot create a stale rig", async () => {
  const stale = await loadPlayer("lmale");
  const current = await loadPlayer("hbioderm");
  const { viewer } = viewerHarness(null, null);
  let resolve;
  vi.spyOn(GLTFLoader.prototype, "loadAsync")
    .mockReturnValueOnce(new Promise((ready) => { resolve = ready; }))
    .mockResolvedValueOnce(current);
  const pending = viewer.load("/lmale.glb", {});
  viewer.cancelLoad();
  const bind = vi.fn(createPlayerRig);
  viewer.setPoseRuntime({ ...poseRuntime, createPlayerRig: bind });
  resolve(stale);
  expect(await pending).toBeNull();
  expect(bind).not.toHaveBeenCalled();
  const loaded = await viewer.load("/hbioderm.glb", {});
  expect(loaded.rig).not.toBeNull();
  expect(bind).toHaveBeenCalledExactlyOnceWith(current.scene);
});

test("switching models while posing binds the new rest pose and does not start its animation", async () => {
  const first = await loadPlayer("lmale", true);
  const second = await loadPlayer("hbioderm", true);
  const { viewer } = viewerHarness(first);
  const oldRig = viewer.rig;
  const dispose = vi.spyOn(oldRig, "dispose");
  viewer.setAnimation("Forward", false, 0.5);
  viewer.mixer.update(0.3);
  viewer.setPoseMode(true);
  vi.spyOn(GLTFLoader.prototype, "loadAsync").mockResolvedValueOnce(second);
  const rest = transforms(second.scene);
  const loaded = await viewer.load("/hbioderm.anim.glb", {});
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(viewer.scene.children).toEqual([second.scene]);
  expect(loaded.rig).not.toBe(oldRig);
  viewer.setAnimation("Forward", false, 0.5);
  viewer.setPoseMode(true);
  expect(viewer.action.isRunning()).toBe(false);
  expectTransforms(rest);
  viewer.setPoseMode(false);
  expect(viewer.action.time).toBe(0);
  expect(viewer.action.isRunning()).toBe(true);
});

test("player meshes keep culling disabled outside mocap because animation bounds become stale", async () => {
  const gltf = await loadPlayer("lmale", true);
  const { viewer } = viewerHarness();
  vi.spyOn(GLTFLoader.prototype, "loadAsync").mockResolvedValueOnce(gltf);
  await viewer.load("/lmale.anim.glb", {});
  const meshes = [];
  gltf.scene.traverse((node) => { if (node.isSkinnedMesh) meshes.push(node); });
  expect(meshes.length).toBeGreaterThan(0);
  for (const mesh of meshes) expect(mesh.frustumCulled, mesh.name).toBe(false);
});

async function mountPose(context, active = true) {
  fixture.mocap ??= { active, tracking: { latestPose: { current: null }, settings: { smoothing: "classic" } } };
  fixture.mocap.active = active;
  fixture.mocap.tracking.recorder ??= idleRecorder();
  if (!reactRoot) {
    host = document.createElement("div");
    document.body.appendChild(host);
    reactRoot = createRoot(host);
  }
  await act(async () => reactRoot.render(React.createElement(
    ModelViewerContext.Provider, { value: context }, React.createElement(MocapPose),
  )));
}

test("pose subscriptions are replaced when the scene changes and removed when mocap stops", async () => {
  const first = await loadPlayer("lmale");
  const second = await loadPlayer("lfemale");
  const { viewer, callbacks, poseCallbacks } = viewerHarness();
  const firstRig = createPlayerRig(first.scene);
  const secondRig = createPlayerRig(second.scene);
  const resetFirst = vi.spyOn(firstRig, "reset");
  const resetSecond = vi.spyOn(secondRig, "reset");
  await mountPose({ viewer, scene: first.scene, rig: firstRig, model: { materials: [] } });
  expect(callbacks.size).toBe(1);
  expect(poseCallbacks.size).toBe(1);
  const secondContext = { viewer, scene: second.scene, rig: secondRig, model: { materials: [] } };
  await mountPose(secondContext);
  expect(callbacks.size).toBe(1);
  expect(poseCallbacks.size).toBe(1);
  expect(resetFirst).toHaveBeenCalledTimes(1);
  await mountPose(secondContext, false);
  expect(callbacks.size).toBe(0);
  expect(poseCallbacks.size).toBe(0);
  expect(resetSecond).toHaveBeenCalledTimes(1);
});

test("inference stalls return the avatar toward rest rather than repeating an old pose", async () => {
  const gltf = await loadPlayer("lmale");
  const { viewer, callbacks } = viewerHarness(gltf);
  const apply = vi.spyOn(viewer.rig, "applyPose");
  fixture.mocap = { active: true, tracking: { settings: { smoothing: "classic" }, latestPose: { current: {
    worldLandmarks: [{ x: 1, y: 2, z: 3 }], timestamp: performance.now(),
  } } } };
  await mountPose({ viewer, scene: gltf.scene, rig: viewer.rig, model: { materials: [] } });
  for (const frame of callbacks) frame(1 / 60);
  expect(apply).toHaveBeenLastCalledWith(mirrorPoseLandmarks(fixture.mocap.tracking.latestPose.current.worldLandmarks), 1 / 60,
    fixture.mocap.tracking.latestPose.current.timestamp, []);
  fixture.mocap.tracking.latestPose.current.timestamp -= 1000;
  for (const frame of callbacks) frame(1 / 60);
  expect(apply).toHaveBeenLastCalledWith([], 1 / 60, undefined, []);
});

test("hands-only input reaches the base pose and runs fallback with each final render camera", async () => {
  const gltf = await loadPlayer("lmale");
  const { viewer, callbacks, poseCallbacks } = viewerHarness(gltf);
  const apply = vi.spyOn(viewer.rig, "applyPose").mockImplementation(() => {});
  const fallback = vi.fn();
  viewer.rig.applyHandFallback = fallback;
  const hand = {
    side: "left", confidence: 0.95,
    landmarks: Array.from({ length: 21 }, () => ({ x: 0.25, y: 0.4, z: 0 })),
    worldLandmarks: Array.from({ length: 21 }, () => ({ x: 0.1, y: 0.2, z: 0.3 })),
  };
  const pose = { landmarks: [], worldLandmarks: [], hands: [hand], timestamp: performance.now(), imageWidth: 640, imageHeight: 480 };
  fixture.mocap = { active: true, tracking: {
    settings: { smoothing: "classic" }, latestPose: { current: pose },
  } };
  const context = { viewer, scene: gltf.scene, rig: viewer.rig, model: { materials: [] } };
  await mountPose(context);
  const renderCamera = new PerspectiveCamera(35, 0.75);
  for (const frame of callbacks) frame(1 / 60);
  expect(apply).toHaveBeenLastCalledWith([], 1 / 60, pose.timestamp, mirrorTrackedHands([hand]));
  for (const frame of poseCallbacks) frame(1 / 60, renderCamera, 4 / 3);
  expect(fallback).toHaveBeenLastCalledWith(renderCamera, 4 / 3, 1 / 60);
  renderCamera.zoom = 2;
  renderCamera.updateProjectionMatrix();
  for (const frame of poseCallbacks) frame(1 / 60, renderCamera, 4 / 3);
  expect(fallback).toHaveBeenCalledTimes(2);
  expect(apply).toHaveBeenCalledTimes(1);
  pose.timestamp -= 5000;
  for (const frame of callbacks) frame(1 / 60);
  expect(apply).toHaveBeenLastCalledWith([], 1 / 60, undefined, []);
  await mountPose(context, false);
  expect(callbacks.size).toBe(0);
  expect(poseCallbacks.size).toBe(0);
});

test("camera image landmarks and dimensions reach framing, stale input clears, and stop resets", async () => {
  const gltf = await loadPlayer("lmale");
  const { viewer, callbacks } = viewerHarness(gltf);
  const move = vi.spyOn(viewer, "setPoseFraming").mockImplementation(() => {});
  const reset = vi.spyOn(viewer, "resetPoseFraming");
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  landmarks[23] = { x: 0.7, y: 0.6, z: 0, visibility: 1 };
  landmarks[24] = { x: 0.8, y: 0.6, z: 0, visibility: 1 };
  const pose = { landmarks, worldLandmarks: [], timestamp: performance.now(), imageWidth: 640, imageHeight: 480 };
  fixture.mocap = { active: true, tracking: {
    settings: { smoothing: "classic" }, latestPose: { current: pose },
  } };
  const context = { viewer, scene: gltf.scene, rig: viewer.rig, model: { materials: [] } };
  await mountPose(context);
  for (const frame of callbacks) frame(0.1);
  expect(move).toHaveBeenLastCalledWith(framingLandmarks(pose), 640, 480);
  const first = move.mock.lastCall[0];
  for (const frame of callbacks) frame(0.1);
  expect(move.mock.lastCall[0]).toBe(first);

  pose.timestamp -= 5000;
  for (const frame of callbacks) frame(0.1);
  expect(move).toHaveBeenLastCalledWith([], undefined, undefined);
  await mountPose(context, false);
  expect(reset).toHaveBeenCalledOnce();
  expect(callbacks.size).toBe(0);
});

test("changing smoothing updates the rig without resetting the pose or replacing its frame subscription", async () => {
  const gltf = await loadPlayer("lmale");
  const { viewer, callbacks } = viewerHarness(gltf);
  const context = { viewer, scene: gltf.scene, rig: viewer.rig, model: { materials: [] } };
  fixture.mocap = { active: true, tracking: { settings: { smoothing: "classic" }, latestPose: { current: null } } };
  const setSmoothing = vi.spyOn(viewer.rig, "setSmoothing");
  const reset = vi.spyOn(viewer.rig, "reset");
  await mountPose(context);
  const subscription = Array.from(callbacks)[0];
  fixture.mocap.tracking.settings = { smoothing: "adaptive" };
  await mountPose(context);
  expect(setSmoothing).toHaveBeenLastCalledWith("adaptive");
  expect(reset).not.toHaveBeenCalled();
  expect(Array.from(callbacks)).toEqual([subscription]);
});

test("the rig displays newly arrived slow inference using its original capture timestamp", async () => {
  const gltf = await loadPlayer("lmale");
  const { viewer, callbacks } = viewerHarness(gltf);
  const apply = vi.spyOn(viewer.rig, "applyPose");
  const now = performance.now();
  const pose = { worldLandmarks: [{ x: 1, y: 2, z: 3 }], timestamp: now - 850, receivedAt: now };
  fixture.mocap = { active: true, tracking: {
    settings: { smoothing: "classic" }, latestPose: { current: pose },
  } };
  await mountPose({ viewer, scene: gltf.scene, rig: viewer.rig, model: { materials: [] } });
  for (const frame of callbacks) frame(1 / 60);
  expect(apply).toHaveBeenLastCalledWith(mirrorPoseLandmarks(pose.worldLandmarks), 1 / 60, pose.timestamp, []);
  const mirrored = apply.mock.lastCall[0];
  vi.spyOn(performance, "now").mockReturnValue(now + 900);
  for (const frame of callbacks) frame(1 / 60);
  expect(apply).toHaveBeenLastCalledWith(mirrored, 1 / 60, pose.timestamp, []);
  expect(apply.mock.lastCall[0]).toBe(mirrored);
  vi.spyOn(performance, "now").mockReturnValue(now + 1701);
  for (const frame of callbacks) frame(1 / 60);
  expect(apply).toHaveBeenLastCalledWith([], 1 / 60, undefined, []);
});

test("presentation mirroring reuses each camera result and leaves the preview's raw landmarks untouched", async () => {
  const gltf = await loadPlayer("lmale");
  const { viewer, callbacks } = viewerHarness(gltf);
  const apply = vi.spyOn(viewer.rig, "applyPose").mockImplementation(() => {});
  const worldLandmarks = Object.freeze(Array.from({ length: 33 }, (_, index) => Object.freeze({
    x: index / 33, y: index / 22, z: index / 44, visibility: 1,
  })));
  const landmarks = Object.freeze(worldLandmarks.map((point) => Object.freeze({ ...point, x: 0.2 })));
  const now = performance.now();
  const hands = Object.freeze([Object.freeze({
    side: "left", confidence: 0.95,
    landmarks: Object.freeze(landmarks.slice(0, 21)),
    worldLandmarks: Object.freeze(worldLandmarks.slice(0, 21)),
  })]);
  const pose = { landmarks, worldLandmarks, hands, timestamp: now };
  fixture.mocap = { active: true, tracking: {
    settings: { smoothing: "none" }, latestPose: { current: pose },
  } };
  await mountPose({ viewer, scene: gltf.scene, rig: viewer.rig, model: { materials: [] } });
  for (const frame of callbacks) frame(1 / 60);
  const first = apply.mock.lastCall[0];
  expect(first).toEqual(mirrorPoseLandmarks(worldLandmarks));
  expect(first).not.toBe(worldLandmarks);
  expect(pose.landmarks).toBe(landmarks);
  const firstHands = apply.mock.lastCall[3];
  expect(firstHands).toEqual(mirrorTrackedHands(hands));
  expect(pose.hands).toBe(hands);
  for (const frame of callbacks) frame(1 / 60);
  expect(apply.mock.lastCall[0]).toBe(first);
  expect(apply.mock.lastCall[3]).toBe(firstHands);

  fixture.mocap.tracking.latestPose.current = { ...pose, timestamp: now + 1 };
  for (const frame of callbacks) frame(1 / 60);
  expect(apply.mock.lastCall[0]).not.toBe(first);
  expect(apply.mock.lastCall[3]).not.toBe(firstHands);
  expect(apply.mock.lastCall[2]).toBe(now + 1);

  fixture.mocap.tracking.latestPose.current = { ...pose, timestamp: now - 5000 };
  for (const frame of callbacks) frame(1 / 60);
  const missing = apply.mock.lastCall[0];
  expect(missing).toEqual([]);
  expect(apply.mock.lastCall[2]).toBeUndefined();
  expect(apply.mock.lastCall[3]).toEqual([]);
  for (const frame of callbacks) frame(1 / 60);
  expect(apply.mock.lastCall[0]).toBe(missing);
});

function framingInput(offset = 0) {
  const landmarks = [];
  landmarks[11] = { x: 0.6 + offset, y: 0.3, z: 0, visibility: 1 };
  landmarks[12] = { x: 0.4 + offset, y: 0.3, z: 0, visibility: 1 };
  return landmarks;
}

/** One second from rest to the pelvis turned half a radian. */
function turnRecording(rig) {
  const pelvis = rig.nodes.find((node) => node.name === "Bip01_Pelvis");
  const rest = pelvis.quaternion.clone();
  const turned = rest.clone().premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.5));
  const take = createTake(rig.nodes, "lmale", { landmarks: [] });
  take.add(0, framingInput(), 640, 480);
  pelvis.quaternion.copy(turned);
  take.add(1, framingInput(0.1), 640, 480);
  rig.reset();
  const recording = { ...take.finish(), id: 1, label: "Animation 1" };
  // Playback normalizes, and the exported rest rotation is slightly off unit
  // length, which angleTo would magnify.
  return { recording, pelvis, rest: rest.normalize(), turned: turned.normalize() };
}

async function mountPlayback(gltf, selected) {
  const harness = viewerHarness(gltf);
  const recorder = idleRecorder({ recordings: [selected], selected });
  fixture.mocap = { active: true, tracking: { settings: { smoothing: "classic" }, latestPose: { current: null }, recorder } };
  const context = { viewer: harness.viewer, scene: gltf.scene, rig: harness.viewer.rig, model: { materials: [] } };
  await mountPose(context);
  return { ...harness, recorder, context };
}

test("live frames are sampled after the hand fallback finishes the bones", async () => {
  const gltf = await loadPlayer("lmale");
  const { viewer, callbacks, poseCallbacks } = viewerHarness(gltf);
  const apply = vi.spyOn(viewer.rig, "applyPose");
  const fallback = vi.spyOn(viewer.rig, "applyHandFallback");
  const framing = vi.spyOn(viewer, "setPoseFraming").mockImplementation(() => {});
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  const pose = { landmarks, worldLandmarks: [], timestamp: performance.now(), imageWidth: 640, imageHeight: 480 };
  const recorder = idleRecorder();
  fixture.mocap = { active: true, tracking: { settings: { smoothing: "classic" }, latestPose: { current: pose }, recorder } };
  await mountPose({ viewer, scene: gltf.scene, rig: viewer.rig, model: { materials: [] } });
  for (const frame of callbacks) frame(1 / 60);
  for (const frame of poseCallbacks) frame(1 / 60, new PerspectiveCamera(), 4 / 3);
  const order = [apply, fallback, recorder.sampleFrame].map((spy) => spy.mock.invocationCallOrder[0]);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(recorder.sampleFrame).toHaveBeenCalledExactlyOnceWith(1 / 60, framingLandmarks(pose), 640, 480);
  expect(recorder.sampleFrame.mock.lastCall[1]).toBe(framing.mock.lastCall[0]);
});

test("the loaded rig is attached to the recorder while mocap is active", async () => {
  const gltf = await loadPlayer("lmale");
  const { viewer } = viewerHarness(gltf);
  const detach = vi.fn();
  const recorder = idleRecorder({ attach: vi.fn(() => detach) });
  fixture.mocap = { active: true, tracking: { settings: { smoothing: "classic" }, latestPose: { current: null }, recorder } };
  const context = { viewer, scene: gltf.scene, rig: viewer.rig, model: { materials: [] } };
  await mountPose(context);
  expect(recorder.attach).toHaveBeenCalledExactlyOnceWith({ viewer, nodes: viewer.rig.nodes });
  await mountPose(context);
  expect(recorder.attach).toHaveBeenCalledOnce();
  await mountPose(context, false);
  expect(detach).toHaveBeenCalledOnce();
});

test("the view outside the camera area is faded while the photo booth counts down to a shot or holds after one", async () => {
  const { viewer } = viewerHarness();
  const fade = vi.spyOn(viewer, "setFadeOutsideCameraArea");
  const recorder = idleRecorder();
  fixture.mocap = { active: true, tracking: { settings: { smoothing: "classic" }, latestPose: { current: null }, recorder } };
  const context = { viewer, scene: null, rig: null, model: { materials: [] } };
  const mountActivity = (activity, active = true) => {
    fixture.mocap.tracking.recorder = { ...recorder, activity };
    return mountPose(context, active);
  };
  const countdown = (taken) => ({ phase: "booth-countdown", taken, endsAt: performance.now() + 3000 });
  await mountActivity(null);
  await mountActivity({ phase: "record-countdown", endsAt: performance.now() + 3000 });
  await mountActivity({ phase: "recording", startedAt: performance.now() });
  expect(fade).not.toHaveBeenCalled();
  await mountActivity(countdown(0));
  await mountActivity({ phase: "booth-hold", taken: 1 });
  await mountActivity(countdown(1));
  expect(fade.mock.calls).toEqual([[true]]);
  await mountActivity({ phase: "developing", taken: 3 });
  expect(fade.mock.calls).toEqual([[true], [false]]);
  // Stopping the camera ends it too.
  await mountActivity(countdown(0));
  await mountActivity(countdown(0), false);
  expect(fade.mock.calls).toEqual([[true], [false], [true], [false]]);
});

test("a selected recording drives the bones and framing while the live rig is suspended", async () => {
  const gltf = await loadPlayer("lmale");
  const rig = createPlayerRig(gltf.scene);
  const { recording, pelvis, rest, turned } = turnRecording(rig);
  const framing = vi.spyOn(Viewer.prototype, "setPoseFraming").mockImplementation(() => {});
  const { viewer, callbacks, poseCallbacks } = await mountPlayback(gltf, recording);
  const apply = vi.spyOn(viewer.rig, "applyPose");
  expect(callbacks.size).toBe(1);
  expect(poseCallbacks.size).toBe(0);
  for (const frame of callbacks) frame(0.5);
  expect(apply).not.toHaveBeenCalled();
  expect(pelvis.quaternion.angleTo(new Quaternion().slerpQuaternions(rest, turned, 0.5))).toBeLessThan(1e-6);
  expect(framing).toHaveBeenLastCalledWith(framingAt(recording, 0), 640, 480);
  expect(framing.mock.lastCall[0][11]).toEqual({ x: Math.fround(0.6), y: Math.fround(0.3), z: 0 });
  expect(host.textContent).toContain("Animation 1");
});

test("playback advances by frame time, loops at the end and holds while paused", async () => {
  const gltf = await loadPlayer("lmale");
  const { recording, pelvis, rest, turned } = turnRecording(createPlayerRig(gltf.scene));
  vi.spyOn(Viewer.prototype, "setPoseFraming").mockImplementation(() => {});
  const { callbacks, recorder } = await mountPlayback(gltf, recording);
  const at = (alpha) => new Quaternion().slerpQuaternions(rest, turned, alpha);
  const frame = (delta) => { for (const callback of callbacks) callback(delta); };
  frame(0.5);
  frame(0.75);
  expect(recorder.playbackRef.current.time).toBeCloseTo(0.25, 6);
  expect(pelvis.quaternion.angleTo(at(0.25))).toBeLessThan(1e-6);
  recorder.playbackRef.current.paused = true;
  frame(0.1);
  expect(recorder.playbackRef.current.time).toBeCloseTo(0.25, 6);
  recorder.playbackRef.current.time = 5;
  frame(0.1);
  expect(pelvis.quaternion.angleTo(turned)).toBeLessThan(1e-6);
});

test("seeking back snaps the framing before the recorded input is applied", async () => {
  const gltf = await loadPlayer("lmale");
  const { recording } = turnRecording(createPlayerRig(gltf.scene));
  const framing = vi.spyOn(Viewer.prototype, "setPoseFraming").mockImplementation(() => {});
  const reset = vi.spyOn(Viewer.prototype, "resetPoseFraming");
  const { callbacks, recorder } = await mountPlayback(gltf, recording);
  const frame = (delta) => { for (const callback of callbacks) callback(delta); };
  frame(0.6);
  frame(1 / 60);
  reset.mockClear();
  frame(1 / 60);
  expect(reset).not.toHaveBeenCalled();
  recorder.playbackRef.current.time = 0.1;
  framing.mockClear();
  frame(1 / 60);
  expect(reset).toHaveBeenCalledOnce();
  expect(reset.mock.invocationCallOrder[0]).toBeLessThan(framing.mock.invocationCallOrder[0]);
  // While paused, every change of time is a seek.
  recorder.playbackRef.current.paused = true;
  recorder.playbackRef.current.time = 0.15;
  frame(1 / 60);
  expect(reset).toHaveBeenCalledTimes(2);
  frame(1 / 60);
  expect(reset).toHaveBeenCalledTimes(2);
});

test("returning to the live camera resyncs the rig before live poses resume", async () => {
  const gltf = await loadPlayer("lmale");
  const { recording } = turnRecording(createPlayerRig(gltf.scene));
  vi.spyOn(Viewer.prototype, "setPoseFraming").mockImplementation(() => {});
  const { viewer, callbacks, poseCallbacks, recorder, context } = await mountPlayback(gltf, recording);
  const resync = vi.spyOn(viewer.rig, "resync");
  const reset = vi.spyOn(viewer.rig, "reset");
  const apply = vi.spyOn(viewer.rig, "applyPose");
  for (const frame of callbacks) frame(0.5);
  fixture.mocap.tracking.recorder = { ...recorder, selected: null };
  await mountPose(context);
  expect(resync).toHaveBeenCalledOnce();
  expect(reset).not.toHaveBeenCalled();
  expect(callbacks.size).toBe(1);
  expect(poseCallbacks.size).toBe(1);
  for (const frame of callbacks) frame(1 / 60);
  expect(resync.mock.invocationCallOrder[0]).toBeLessThan(apply.mock.invocationCallOrder[0]);
  expect(host.textContent).not.toContain("Animation 1");
});

test("a seek onto a key framing can't measure keeps the framing of the last key it could", async () => {
  const gltf = await loadPlayer("lmale");
  const rig = createPlayerRig(gltf.scene);
  const take = createTake(rig.nodes, "lmale", { landmarks: [] });
  const oneShoulder = [];
  oneShoulder[11] = { x: 0.6, y: 0.3, z: 0, visibility: 1 };
  take.add(0, framingInput(), 640, 480);
  take.add(0.5, oneShoulder, 640, 480);
  take.add(0.5, oneShoulder, 640, 480);
  const recording = { ...take.finish(), id: 1, label: "Animation 1" };
  const framing = vi.spyOn(Viewer.prototype, "setPoseFraming").mockImplementation(() => {});
  const reset = vi.spyOn(Viewer.prototype, "resetPoseFraming");
  const { callbacks, recorder } = await mountPlayback(gltf, recording);
  const frame = (delta) => { for (const callback of callbacks) callback(delta); };
  recorder.playbackRef.current.paused = true;
  frame(0);
  recorder.playbackRef.current.time = 0.75;
  reset.mockClear();
  frame(0);
  // Key 1 has one shoulder, which framing can't measure: snap to key 0's input.
  expect(reset).toHaveBeenCalledOnce();
  expect(framing).toHaveBeenLastCalledWith(framingAt(recording, 0), 640, 480);
  expect(reset.mock.invocationCallOrder[0]).toBeLessThan(framing.mock.invocationCallOrder.at(-1));
  // Holding still feeds the key's own input, which keeps that framing.
  frame(0);
  expect(framing).toHaveBeenLastCalledWith(framingAt(recording, 1), 640, 480);
  expect(reset).toHaveBeenCalledOnce();
});

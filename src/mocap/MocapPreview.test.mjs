import { afterEach, beforeEach, expect, test, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { getEnv } from "fabric";
import MocapPreview from "./MocapPreview";
import {
  drawFaceSkeleton,
  drawHandSkeletons,
  drawPoseSkeleton,
} from "./posePreview";
import { DEFAULT_POSE_SETTINGS } from "./poseSettings";
import { idleRecorder } from "./recorderTestUtils";

const fixture = vi.hoisted(() => ({ active: false, tracking: null }));
vi.mock("../MocapProvider", () => ({ useMocap: () => fixture }));
// Keep dropdown positioning frames separate from the skeleton drawing loop.
vi.mock("./MocapDebugPanel", async (importOriginal) => {
  const { createElement } = await import("react");
  return {
    ...(await importOriginal()),
    default: ({ id }) => createElement("div", { id, "data-debug": "" }),
  };
});
vi.mock("./RecorderControls", async () => {
  const { createElement } = await import("react");
  return {
    CaptureControls: () => createElement("div", { "data-capture": "" }),
    PlaybackControls: () => createElement("div", { "data-playback": "" }),
  };
});
vi.mock("./RecorderOverlay", async () => {
  const { createElement } = await import("react");
  return { default: () => createElement("div", { "data-overlay": "" }) };
});
vi.mock("./posePreview", async (importOriginal) => ({
  ...(await importOriginal()),
  drawPoseSkeleton: vi.fn(),
  drawHandSkeletons: vi.fn(),
  drawFaceSkeleton: vi.fn(),
}));

let root;
let host;
let callbacks;
let context;
let bounds;
let resizeObserver;

async function render(active) {
  fixture.active = active;
  fixture.tracking.status = active ? "tracking" : "idle";
  await act(async () => root.render(React.createElement(MocapPreview)));
}

function frame(timestamp) {
  const [id, callback] = callbacks.entries().next().value;
  callbacks.delete(id);
  callback(timestamp);
}

beforeEach(() => {
  const { document, window } = getEnv();
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  callbacks = new Map();
  let callbackId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback) => {
    const id = ++callbackId;
    callbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id) => callbacks.delete(id));
  resizeObserver = { callback: null, observe: vi.fn(), disconnect: vi.fn() };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback) {
        resizeObserver.callback = callback;
        return resizeObserver;
      }
    },
  );
  context = { clearRect: vi.fn(), setTransform: vi.fn() };
  vi.spyOn(window.HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context,
  );
  bounds = { width: 600, height: 600 };
  vi.spyOn(
    window.HTMLElement.prototype,
    "getBoundingClientRect",
  ).mockImplementation(() => bounds);
  vi.spyOn(
    window.HTMLVideoElement.prototype,
    "videoWidth",
    "get",
  ).mockReturnValue(640);
  vi.spyOn(
    window.HTMLVideoElement.prototype,
    "videoHeight",
    "get",
  ).mockReturnValue(480);
  fixture.tracking = {
    videoRef: vi.fn(),
    latestPose: { current: null },
    status: "idle",
    error: null,
    settings: { ...DEFAULT_POSE_SETTINGS },
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    switching: false,
    stats: null,
    recorder: idleRecorder(),
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("the camera ref stays mounted when inactive and stopping cancels drawing", async () => {
  await render(false);
  const video = host.querySelector("video");
  expect(fixture.tracking.videoRef.mock.calls[0][0]).toBe(video);
  expect(host.querySelector("section").hidden).toBe(true);
  expect(callbacks.size).toBe(0);
  await render(true);
  expect(host.querySelector("section").hidden).toBe(false);
  expect(callbacks.size).toBe(1);
  await render(false);
  expect(callbacks.size).toBe(0);
  expect(resizeObserver.disconnect).toHaveBeenCalledOnce();
  expect(host.querySelector("video")).toBe(video);
  expect(
    fixture.tracking.videoRef.mock.calls.every(([element]) => element !== null),
  ).toBe(true);
});

test("draws normalized landmarks, skips duplicate frames, and clears stale poses", async () => {
  await render(true);
  const pose = {
    landmarks: [{ x: 0.2, y: 0.3, z: 0 }],
    worldLandmarks: [],
    timestamp: 100,
    hands: [
      {
        side: "left",
        confidence: 0.9,
        landmarks: [{ x: 0.4, y: 0.3, z: 0 }],
        worldLandmarks: [],
      },
    ],
  };
  fixture.tracking.latestPose.current = pose;
  frame(100);
  expect(drawPoseSkeleton).toHaveBeenCalledWith(
    context,
    pose.landmarks,
    { x: 0, y: 75, width: 600, height: 450 },
    pose.hands,
    undefined,
  );
  expect(drawHandSkeletons).toHaveBeenCalledWith(context, pose.hands, {
    x: 0,
    y: 75,
    width: 600,
    height: 450,
  });
  const clearCount = context.clearRect.mock.calls.length;
  frame(116);
  expect(drawPoseSkeleton).toHaveBeenCalledOnce();
  expect(drawHandSkeletons).toHaveBeenCalledOnce();
  expect(context.clearRect).toHaveBeenCalledTimes(clearCount);
  frame(601);
  expect(drawPoseSkeleton).toHaveBeenCalledOnce();
  expect(context.clearRect).toHaveBeenCalledTimes(clearCount + 1);
});

test("resizing redraws the current pose in the new contained rectangle", async () => {
  await render(true);
  const pose = { landmarks: [], worldLandmarks: [], timestamp: 100 };
  fixture.tracking.latestPose.current = pose;
  frame(100);
  bounds = { width: 800, height: 300 };
  resizeObserver.callback();
  frame(116);
  expect(drawPoseSkeleton).toHaveBeenLastCalledWith(
    context,
    pose.landmarks,
    { x: 200, y: 0, width: 400, height: 300 },
    undefined,
    undefined,
  );
  expect(drawPoseSkeleton).toHaveBeenCalledTimes(2);
});

test("a slow detector's pose stays visible between results and clears on a stall", async () => {
  await render(true);
  const pose = {
    landmarks: [{ x: 0.2, y: 0.3, z: 0 }],
    worldLandmarks: [],
    timestamp: 100,
    receivedAt: 950,
  };
  fixture.tracking.latestPose.current = pose;
  frame(950);
  expect(drawPoseSkeleton).toHaveBeenCalledWith(
    context,
    pose.landmarks,
    { x: 0, y: 75, width: 600, height: 450 },
    undefined,
    undefined,
  );
  const clearCount = context.clearRect.mock.calls.length;
  frame(1850);
  expect(context.clearRect).toHaveBeenCalledTimes(clearCount);
  frame(2651);
  expect(context.clearRect).toHaveBeenCalledTimes(clearCount + 1);
  expect(drawPoseSkeleton).toHaveBeenCalledOnce();
});

test("face-only tracking draws its own observed points and clears them on loss", async () => {
  await render(true);
  const face = {
    confidence: 0.9,
    landmarks: Array.from({ length: 6 }, () => ({ x: 0.4, y: 0.5, z: 0 })),
  };
  fixture.tracking.latestPose.current = {
    landmarks: [],
    worldLandmarks: [],
    face,
    timestamp: 100,
  };
  frame(100);
  expect(drawFaceSkeleton).toHaveBeenCalledWith(context, face, {
    x: 0,
    y: 75,
    width: 600,
    height: 450,
  });
  const clears = context.clearRect.mock.calls.length;
  frame(601);
  expect(drawFaceSkeleton).toHaveBeenCalledOnce();
  expect(context.clearRect).toHaveBeenCalledTimes(clears + 1);
});

test("pose debug opens over the camera image from the toolbar, in production builds too", async () => {
  vi.stubEnv("NODE_ENV", "production");
  await render(true);
  const [top, stage] = host.querySelector("section").children;
  const toggle = [...top.querySelectorAll("button")].find(
    (button) => button.textContent === "Pose debug",
  );
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(host.querySelector("[data-debug]")).toBeNull();
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  const panel = host.querySelector("[data-debug]");
  expect(panel.parentElement).toBe(stage);
  expect(toggle.getAttribute("aria-controls")).toBe(panel.id);
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(host.querySelector("[data-debug]")).toBeNull();
});

test("messages show below the camera in place of playback, leaving the top bar to Live and pose debug", async () => {
  const update = (changes) =>
    act(async () => {
      Object.assign(fixture.tracking, changes);
      root.render(React.createElement(MocapPreview));
    });
  await render(true);
  const [top, , bottom] = host.querySelector("section").children;
  const region = bottom.querySelector("[role='status']");
  const live = top.lastElementChild.firstElementChild;
  expect(live.dataset.off).toBeUndefined();
  await update({ status: "lost" });
  expect(bottom.querySelector("[data-playback]")).toBeNull();
  expect(bottom.querySelector("[role='status']")).toBe(region);
  expect(region.textContent).toBe(
    "Move into view. Include your legs for full-body tracking.",
  );
  // Live keeps its space, so the top bar doesn't rewrap.
  expect(top.lastElementChild.firstElementChild).toBe(live);
  expect(live.dataset.off).toBe("true");
  await update({ status: "error", error: "Camera access was denied." });
  expect(bottom.querySelector("[role='alert']")).toBe(region);
  expect(region.textContent).toBe("Camera access was denied.");
  await update({ status: "tracking", error: null });
  expect(bottom.querySelector("[data-playback]")).not.toBeNull();
  expect(region.textContent).toBe("Live");
  expect(live.dataset.off).toBeUndefined();
});

test("the capture and playback bars surround the stage and the skeleton measures the stage", async () => {
  await render(true);
  const [top, stage, bottom] = host.querySelector("section").children;
  expect(top.querySelector("[data-capture]")).not.toBeNull();
  // Live, then pose debug, at the end of the top bar. Screen readers hear
  // "Live" from the status region below.
  const end = top.lastElementChild;
  expect([...end.children].map((child) => child.textContent)).toEqual([
    "Live",
    "Pose debug",
  ]);
  expect(end.firstElementChild.getAttribute("aria-hidden")).toBe("true");
  expect(bottom.querySelector("[role='status']").textContent).toBe("Live");
  expect([...stage.children].map((child) => child.localName)).toEqual([
    "video",
    "canvas",
    "div",
  ]);
  expect(stage.querySelector("[data-overlay]")).not.toBeNull();
  expect(bottom.querySelector("[data-playback]")).not.toBeNull();
  expect(resizeObserver.observe).toHaveBeenCalledOnce();
  expect(resizeObserver.observe.mock.calls[0][0]).toBe(stage);
});

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import React, { act, useCallback, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { getEnv } from "fabric";
import usePoseTracking from "./usePoseTracking";
import { DEFAULT_POSE_SETTINGS } from "./poseSettings";

const fixture = vi.hoisted(() => ({ api: null, apis: [] }));
const { document, window } = getEnv();
const { DOMException } = globalThis;
vi.mock("comlink", () => ({
  wrap: () => fixture.apis.shift() ?? fixture.api,
  transfer: (value) => value,
  releaseProxy: Symbol.for("releaseProxy"),
}));

let root;
let host;
let tracking;
let video;
let callbacks;
let workers;
let stream;
let getUserMedia;
let nextCallback;
let videoVersion;
let configureNextVideo;

function detectorApi() {
  return {
    initialize: vi.fn(async () => ({ delegate: "GPU" })),
    detect: vi.fn(async () => null),
    [Symbol.for("releaseProxy")]: vi.fn(),
  };
}

function queueDetector(initialization) {
  const api = detectorApi();
  if (initialization)
    api.initialize.mockReturnValueOnce(initialization.promise);
  fixture.apis.push(api);
  return api;
}

function prepareVideo(node) {
  node.play = vi.fn(async () => {});
  Object.defineProperty(node, "readyState", { value: 2 });
  Object.defineProperty(node, "videoWidth", { value: 640 });
  Object.defineProperty(node, "videoHeight", { value: 480 });
  node.currentTime = 1;
  node.requestVideoFrameCallback = vi.fn((callback) => {
    const id = ++nextCallback;
    callbacks.set(id, callback);
    return id;
  });
  node.cancelVideoFrameCallback = vi.fn((id) => callbacks.delete(id));
  configureNextVideo?.(node);
  configureNextVideo = null;
}

function Harness({ videoKey = 0, showVideo = true }) {
  const value = usePoseTracking();
  const { videoRef: captureRef } = value;
  const videoRef = useCallback(
    (node) => {
      if (node) prepareVideo(node);
      captureRef(node);
    },
    [captureRef],
  );
  useLayoutEffect(() => {
    tracking = value;
  }, [value]);
  return showVideo
    ? React.createElement("video", { key: videoKey, ref: videoRef })
    : null;
}

beforeEach(async () => {
  const env = getEnv();
  vi.stubGlobal("document", env.document);
  vi.stubGlobal("window", env.window);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  callbacks = new Map();
  workers = [];
  nextCallback = 0;
  videoVersion = 0;
  configureNextVideo = null;
  const track = { stop: vi.fn(), enabled: true, addEventListener: vi.fn() };
  stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  getUserMedia = vi.fn(async () => stream);
  fixture.api = detectorApi();
  fixture.apis = [];
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("OffscreenCanvas", class {});
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ close: vi.fn() })),
  );
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        this.listeners = {};
        this.terminate = vi.fn();
        workers.push(this);
      }
      addEventListener(type, listener) {
        this.listeners[type] = listener;
      }
    },
  );
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(Harness)));
  video = host.querySelector("video");
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function start() {
  await act(async () => expect(await tracking.start()).toBe(true));
}

async function replaceVideo(showVideo = true) {
  await act(async () =>
    root.render(
      React.createElement(Harness, {
        videoKey: ++videoVersion,
        showVideo,
      }),
    ),
  );
  video = host.querySelector("video");
}

function nextFrame(timestamp) {
  const [id, callback] = callbacks.entries().next().value;
  callbacks.delete(id);
  video.currentTime += 0.033;
  return callback(timestamp);
}

async function changeSettings(patch) {
  await act(async () => tracking.updateSettings(patch));
}

async function runConfigurationTimer() {
  await act(async () => vi.advanceTimersByTimeAsync(150));
}

async function setHidden(hidden) {
  vi.spyOn(document, "hidden", "get").mockReturnValue(hidden);
  await act(async () =>
    document.dispatchEvent(new window.Event("visibilitychange")),
  );
}

test("camera and tracker start only after explicit activation, then stop releases both", async () => {
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(workers).toHaveLength(0);
  await start();
  expect(fixture.api.initialize).toHaveBeenCalledWith(
    {
      wasmUrl: "/mocap/tasks-vision-1.1.1",
      modelUrl: "/mocap/pose_landmarker_full_v1.task",
      handModelUrl: "/mocap/hand_landmarker_v1.task",
      faceModelUrl: "/mocap/blaze_face_short_range_v1.tflite",
    },
    DEFAULT_POSE_SETTINGS,
  );
  expect(getUserMedia).toHaveBeenCalledWith(
    expect.objectContaining({ audio: false }),
  );
  expect(video.srcObject).toBe(stream);
  expect(tracking.status).toBe("lost");
  await act(async () => tracking.stop());
  expect(stream.getTracks()[0].stop).toHaveBeenCalledOnce();
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  expect(callbacks.size).toBe(0);
  expect(video.srcObject).toBeNull();
  expect(tracking.latestPose.current).toBeNull();
  expect(tracking.status).toBe("idle");
});

test("unavailable detailed hands warn without preventing body tracking, and disabling clears the warning", async () => {
  const warning =
    "Detailed hand tracking could not start. Body tracking is still active.";
  fixture.api.initialize.mockResolvedValueOnce({
    delegate: "GPU",
    handWarning: warning,
  });
  await start();
  expect(tracking.error).toBe(warning);
  const pose = { landmarks: [], worldLandmarks: [], timestamp: 100, hands: [] };
  fixture.api.detect.mockResolvedValueOnce(pose);
  await act(async () => nextFrame(100));
  expect(tracking.latestPose.current).toBe(pose);
  expect(tracking.status).toBe("tracking");
  expect(tracking.error).toBe(warning);

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const next = queueDetector();
  await changeSettings({ handTracking: false });
  expect(tracking.latestPose.current).toBeNull();
  await runConfigurationTimer();
  expect(next.initialize).toHaveBeenCalledWith(
    expect.any(Object),
    expect.objectContaining({ handTracking: false }),
  );
  expect(tracking.error).toBeNull();
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(stream.getTracks()[0].stop).not.toHaveBeenCalled();
});

test("stopping during loading prevents a later camera permission request", async () => {
  const initialization = Promise.withResolvers();
  fixture.api.initialize.mockReturnValue(initialization.promise);
  let started;
  await act(async () => {
    started = tracking.start();
  });
  expect(tracking.status).toBe("loading");
  await act(async () => tracking.stop());
  await expect(started).resolves.toBe(false);
  await act(async () => initialization.resolve());
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(tracking.status).toBe("idle");
});

test("stopping while permission is pending closes a camera granted later", async () => {
  const permission = Promise.withResolvers();
  getUserMedia.mockReturnValue(permission.promise);
  let started;
  await act(async () => {
    started = tracking.start();
  });
  expect(tracking.status).toBe("requesting");
  await act(async () => tracking.stop());
  await expect(started).resolves.toBe(false);
  await act(async () => permission.resolve(stream));
  expect(stream.getTracks()[0].stop).toHaveBeenCalledOnce();
  expect(video.srcObject).toBeNull();
  expect(tracking.status).toBe("idle");
});

test("camera denial reports a useful error and releases the worker", async () => {
  getUserMedia.mockRejectedValue(
    new DOMException("Permission denied", "NotAllowedError"),
  );
  await act(async () => expect(await tracking.start()).toBe(false));
  expect(tracking.status).toBe("error");
  expect(tracking.error).toMatch(/access was denied/);
  expect(workers[0].terminate).toHaveBeenCalledOnce();
});

test("only one inference can be in flight and poses are published without queuing stale frames", async () => {
  const inference = Promise.withResolvers();
  fixture.api.detect.mockReturnValueOnce(inference.promise);
  await start();
  let first;
  await act(async () => {
    first = nextFrame(100);
  });
  expect(fixture.api.detect).toHaveBeenCalledOnce();
  await act(async () => nextFrame(133));
  expect(fixture.api.detect).toHaveBeenCalledOnce();
  const pose = {
    landmarks: [{ x: 1, y: 2, z: 3 }],
    worldLandmarks: [{ x: 1, y: 2, z: 3 }],
    timestamp: 100,
  };
  await act(async () => {
    inference.resolve(pose);
    await first;
  });
  expect(tracking.latestPose.current).toBe(pose);
  expect(tracking.status).toBe("tracking");
  await act(async () => nextFrame(166));
  expect(fixture.api.detect).toHaveBeenCalledTimes(2);
  expect(fixture.api.detect.mock.calls[1][1]).toBe(166);
  expect(tracking.status).toBe("lost");
});

test("hiding the tab pauses camera frames and clears stale poses, then resumes", async () => {
  await start();
  tracking.latestPose.current = { timestamp: 1 };
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(async () =>
    document.dispatchEvent(new window.Event("visibilitychange")),
  );
  expect(tracking.status).toBe("paused");
  expect(tracking.latestPose.current).toBeNull();
  expect(stream.getTracks()[0].enabled).toBe(false);
  expect(callbacks.size).toBe(0);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  await act(async () =>
    document.dispatchEvent(new window.Event("visibilitychange")),
  );
  expect(tracking.status).toBe("lost");
  expect(stream.getTracks()[0].enabled).toBe(true);
  expect(callbacks.size).toBe(1);
});

test("camera pauses if the tab hides while initial video playback is still pending", async () => {
  const playback = Promise.withResolvers();
  video.play.mockReturnValue(playback.promise);
  let started;
  await act(async () => {
    started = tracking.start();
  });
  expect(video.play).toHaveBeenCalledOnce();
  expect(video.srcObject).toBe(stream);
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(async () =>
    document.dispatchEvent(new window.Event("visibilitychange")),
  );
  expect(stream.getVideoTracks()[0].enabled).toBe(false);
  expect(tracking.status).toBe("paused");
  expect(callbacks.size).toBe(0);
  await act(async () => {
    playback.resolve();
    await started;
  });
  expect(stream.getVideoTracks()[0].enabled).toBe(false);
  expect(tracking.status).toBe("paused");
});

test("unmount releases the camera and pending frame callbacks", async () => {
  await start();
  await act(async () => root.render(null));
  expect(stream.getTracks()[0].stop).toHaveBeenCalledOnce();
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  expect(callbacks.size).toBe(0);
});

test("worker failure stops the camera and can be retried", async () => {
  await start();
  await act(async () => workers[0].listeners.error());
  expect(tracking.status).toBe("error");
  expect(stream.getTracks()[0].stop).toHaveBeenCalledOnce();
  await start();
  expect(workers).toHaveLength(2);
  expect(tracking.status).toBe("lost");
});

test("a keyed preview remount reuses the camera and worker and captures the new video", async () => {
  await start();
  const previous = video;
  const canceledCallback = callbacks.values().next().value;
  tracking.latestPose.current = { timestamp: 1 };
  await replaceVideo();
  expect(video).not.toBe(previous);
  expect(previous.srcObject).toBeNull();
  expect(previous.cancelVideoFrameCallback).toHaveBeenCalledOnce();
  expect(video.srcObject).toBe(stream);
  expect(video.play).toHaveBeenCalledOnce();
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(fixture.api.initialize).toHaveBeenCalledOnce();
  expect(workers).toHaveLength(1);
  expect(stream.getTracks()[0].stop).not.toHaveBeenCalled();
  expect(tracking.latestPose.current).toBeNull();
  expect(callbacks.size).toBe(1);
  await act(async () => canceledCallback(100));
  expect(callbacks.size).toBe(1);
  expect(fixture.api.detect).not.toHaveBeenCalled();
  await act(async () => nextFrame(133));
  expect(globalThis.createImageBitmap.mock.calls[0]?.[0]).toBe(video);
  expect(fixture.api.detect).toHaveBeenCalledOnce();
  expect(callbacks.size).toBe(1);
  await act(async () => tracking.stop());
  expect(previous.srcObject).toBeNull();
  expect(video.srcObject).toBeNull();
  expect(callbacks.size).toBe(0);
});

test("a preview replaced during permission attaches only the current video", async () => {
  const permission = Promise.withResolvers();
  getUserMedia.mockReturnValue(permission.promise);
  let started;
  await act(async () => {
    started = tracking.start();
  });
  const previous = video;
  await replaceVideo();
  await act(async () => {
    permission.resolve(stream);
    await started;
  });
  expect(previous.srcObject).toBeNull();
  expect(previous.play).not.toHaveBeenCalled();
  expect(video.srcObject).toBe(stream);
  expect(video.play).toHaveBeenCalledOnce();
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(callbacks.size).toBe(1);
});

test("startup can wait for a preview to mount without requesting the camera again", async () => {
  await replaceVideo(false);
  let started;
  await act(async () => {
    started = tracking.start();
  });
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(callbacks.size).toBe(0);
  expect(tracking.error).toBeNull();
  await replaceVideo();
  await expect(started).resolves.toBe(true);
  expect(video.srcObject).toBe(stream);
  expect(video.play).toHaveBeenCalledOnce();
  expect(getUserMedia).toHaveBeenCalledOnce();
});

test("replacing a preview during startup ignores its stale play rejection", async () => {
  const previousPlayback = Promise.withResolvers();
  const nextPlayback = Promise.withResolvers();
  video.play.mockReturnValue(previousPlayback.promise);
  let started;
  await act(async () => {
    started = tracking.start();
  });
  configureNextVideo = (node) =>
    node.play.mockReturnValue(nextPlayback.promise);
  await replaceVideo();
  await act(async () =>
    previousPlayback.reject(
      new DOMException("Playback interrupted", "AbortError"),
    ),
  );
  expect(tracking.error).toBeNull();
  expect(stream.getTracks()[0].stop).not.toHaveBeenCalled();
  expect(video.srcObject).toBe(stream);
  await act(async () => {
    nextPlayback.resolve();
    expect(await started).toBe(true);
  });
  expect(callbacks.size).toBe(1);
  expect(getUserMedia).toHaveBeenCalledOnce();
});

test.each(["resolve", "reject"])(
  "old-video inference cannot overwrite or stop a replacement when it %ss",
  async (settle) => {
    const inference = Promise.withResolvers();
    fixture.api.detect.mockReturnValueOnce(inference.promise);
    await start();
    let oldFrame;
    await act(async () => {
      oldFrame = nextFrame(100);
    });
    const oldBitmap = await globalThis.createImageBitmap.mock.results[0].value;
    await replaceVideo();
    await act(async () => nextFrame(133));
    expect(fixture.api.detect).toHaveBeenCalledOnce();
    await act(async () => {
      inference[settle](
        settle === "resolve"
          ? { timestamp: 100 }
          : new Error("Old frame failed"),
      );
      await oldFrame;
    });
    expect(tracking.latestPose.current).toBeNull();
    expect(tracking.error).toBeNull();
    expect(stream.getTracks()[0].stop).not.toHaveBeenCalled();
    expect(oldBitmap.close).toHaveBeenCalledOnce();
    const pose = { timestamp: 166 };
    fixture.api.detect.mockResolvedValueOnce(pose);
    await act(async () => nextFrame(166));
    expect(globalThis.createImageBitmap.mock.lastCall[0]).toBe(video);
    expect(fixture.api.detect).toHaveBeenCalledTimes(2);
    expect(tracking.latestPose.current).toBe(pose);
    expect(callbacks.size).toBe(1);
  },
);

test("a bitmap from a detached video is closed without running stale inference", async () => {
  const capture = Promise.withResolvers();
  globalThis.createImageBitmap.mockReturnValueOnce(capture.promise);
  await start();
  let oldFrame;
  await act(async () => {
    oldFrame = nextFrame(100);
  });
  await replaceVideo();
  const bitmap = { close: vi.fn() };
  await act(async () => {
    capture.resolve(bitmap);
    await oldFrame;
  });
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(fixture.api.detect).not.toHaveBeenCalled();
  await act(async () => nextFrame(133));
  expect(fixture.api.detect).toHaveBeenCalledOnce();
});

test("detaching and remounting a preview while hidden preserves the paused camera", async () => {
  await start();
  const previous = video;
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(async () =>
    document.dispatchEvent(new window.Event("visibilitychange")),
  );
  await replaceVideo(false);
  expect(previous.srcObject).toBeNull();
  expect(callbacks.size).toBe(0);
  expect(stream.getTracks()[0].stop).not.toHaveBeenCalled();
  await replaceVideo();
  expect(video.srcObject).toBe(stream);
  expect(stream.getTracks()[0].enabled).toBe(false);
  expect(tracking.status).toBe("paused");
  expect(callbacks.size).toBe(0);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  await act(async () =>
    document.dispatchEvent(new window.Event("visibilitychange")),
  );
  expect(stream.getTracks()[0].enabled).toBe(true);
  expect(callbacks.size).toBe(1);
  await act(async () => root.render(null));
  expect(video.srcObject).toBeNull();
  expect(stream.getTracks()[0].stop).toHaveBeenCalledOnce();
  expect(callbacks.size).toBe(0);
});

test("a current replacement playback failure stops the camera", async () => {
  await start();
  configureNextVideo = (node) =>
    node.play.mockRejectedValue(
      new DOMException("Playback denied", "NotAllowedError"),
    );
  await replaceVideo();
  expect(tracking.status).toBe("error");
  expect(tracking.error).toMatch(/access was denied/);
  expect(video.srcObject).toBeNull();
  expect(stream.getTracks()[0].stop).toHaveBeenCalledOnce();
  expect(callbacks.size).toBe(0);
});

test("stopping pending playback prevents later remounts or play completions from restarting capture", async () => {
  const playback = Promise.withResolvers();
  video.play.mockReturnValue(playback.promise);
  let started;
  await act(async () => {
    started = tracking.start();
  });
  await act(async () => tracking.stop());
  await replaceVideo();
  await act(async () => {
    playback.resolve();
    expect(await started).toBe(false);
  });
  expect(video.srcObject).toBeNull();
  expect(video.play).not.toHaveBeenCalled();
  expect(callbacks.size).toBe(0);
  expect(tracking.status).toBe("idle");
});

test("animation-frame fallback cancels replaced videos and never duplicates its callback queue", async () => {
  const fallback = (node) => {
    node.requestVideoFrameCallback = undefined;
  };
  fallback(video);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback) => {
      const id = ++nextCallback;
      callbacks.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id) => callbacks.delete(id)),
  );
  await start();
  configureNextVideo = fallback;
  await replaceVideo();
  expect(globalThis.cancelAnimationFrame).toHaveBeenCalledOnce();
  const canceledCallback = callbacks.values().next().value;
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(async () =>
    document.dispatchEvent(new window.Event("visibilitychange")),
  );
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  await act(async () => {
    document.dispatchEvent(new window.Event("visibilitychange"));
    document.dispatchEvent(new window.Event("visibilitychange"));
    await canceledCallback(100);
  });
  expect(callbacks.size).toBe(1);
  expect(fixture.api.detect).not.toHaveBeenCalled();
  await act(async () => nextFrame(133));
  expect(globalThis.createImageBitmap.mock.calls[0]?.[0]).toBe(video);
  expect(callbacks.size).toBe(1);
  await act(async () => tracking.stop());
  expect(callbacks.size).toBe(0);
});

test("switching model quality keeps the camera and publishes only the new detector's frames", async () => {
  await start();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const initialization = Promise.withResolvers();
  const next = queueDetector(initialization);
  tracking.latestPose.current = { timestamp: 1 };
  await changeSettings({ model: "lite" });
  expect(tracking.switching).toBe(true);
  expect(tracking.latestPose.current).toBeNull();
  await runConfigurationTimer();
  expect(next.initialize).toHaveBeenCalledWith(
    expect.objectContaining({
      modelUrl: "/mocap/pose_landmarker_lite_v1.task",
    }),
    expect.objectContaining({ model: "lite" }),
  );
  expect(workers[0].terminate).not.toHaveBeenCalled();
  await act(async () => nextFrame(100));
  expect(fixture.api.detect).not.toHaveBeenCalled();
  expect(next.detect).not.toHaveBeenCalled();
  await act(async () => initialization.resolve({ delegate: "GPU" }));
  expect(tracking.switching).toBe(false);
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  expect(fixture.api[Symbol.for("releaseProxy")]).toHaveBeenCalledOnce();
  expect(video.srcObject).toBe(stream);
  expect(video.play).toHaveBeenCalledOnce();
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(stream.getTracks()[0].stop).not.toHaveBeenCalled();
  const pose = { timestamp: 133 };
  next.detect.mockResolvedValueOnce(pose);
  await act(async () => nextFrame(133));
  expect(tracking.latestPose.current).toBe(pose);
  expect(tracking.status).toBe("tracking");
});

test("debounced settings changes create only the latest requested detector", async () => {
  await start();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const next = queueDetector();
  await changeSettings({ model: "lite" });
  await changeSettings({ minDetectionConfidence: 0.7 });
  await changeSettings({ handTracking: false });
  expect(workers).toHaveLength(1);
  await runConfigurationTimer();
  expect(workers).toHaveLength(2);
  expect(next.initialize).toHaveBeenCalledWith(
    expect.any(Object),
    expect.objectContaining({
      model: "lite",
      minDetectionConfidence: 0.7,
      handTracking: false,
    }),
  );
  expect(getUserMedia).toHaveBeenCalledOnce();
});

test("a superseded detector load cannot replace the latest candidate", async () => {
  await start();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const liteLoad = Promise.withResolvers();
  const lite = queueDetector(liteLoad);
  await changeSettings({ model: "lite" });
  await runConfigurationTimer();
  const latestLoad = Promise.withResolvers();
  const latest = queueDetector(latestLoad);
  await changeSettings({ minDetectionConfidence: 0.7 });
  expect(workers[1].terminate).toHaveBeenCalledOnce();
  await runConfigurationTimer();
  await act(async () => liteLoad.resolve({ delegate: "GPU" }));
  expect(tracking.switching).toBe(true);
  expect(tracking.settings.minDetectionConfidence).toBe(0.7);
  expect(workers[0].terminate).not.toHaveBeenCalled();
  await act(async () => latestLoad.resolve({ delegate: "GPU" }));
  expect(tracking.switching).toBe(false);
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  expect(workers[2].terminate).not.toHaveBeenCalled();
  const pose = { timestamp: 100 };
  latest.detect.mockResolvedValueOnce(pose);
  await act(async () => nextFrame(100));
  expect(tracking.latestPose.current).toBe(pose);
  expect(lite.detect).not.toHaveBeenCalled();
  expect(getUserMedia).toHaveBeenCalledOnce();
});

test("settings changed during initial loading select the new detector before requesting a camera", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const firstLoad = Promise.withResolvers();
  fixture.api.initialize.mockReturnValueOnce(firstLoad.promise);
  let started;
  await act(async () => {
    started = tracking.start();
  });
  const nextLoad = Promise.withResolvers();
  const next = queueDetector(nextLoad);
  await changeSettings({ model: "lite" });
  await runConfigurationTimer();
  await act(async () => firstLoad.resolve({ delegate: "GPU" }));
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  await act(async () => {
    nextLoad.resolve({ delegate: "GPU" });
    expect(await started).toBe(true);
  });
  expect(next.initialize).toHaveBeenCalledOnce();
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(tracking.settings.model).toBe("lite");
  expect(video.srcObject).toBe(stream);
});

test.each([false, true])(
  "stopping during a detector switch releases all resources (load started: %s)",
  async (loadStarted) => {
    await start();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const initialization = Promise.withResolvers();
    queueDetector(initialization);
    await changeSettings({ model: "lite" });
    if (loadStarted) await runConfigurationTimer();
    await act(async () => tracking.stop());
    await act(async () => initialization.resolve({ delegate: "GPU" }));
    await runConfigurationTimer();
    expect(workers).toHaveLength(loadStarted ? 2 : 1);
    for (const worker of workers)
      expect(worker.terminate).toHaveBeenCalledOnce();
    expect(stream.getTracks()[0].stop).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(callbacks.size).toBe(0);
    expect(tracking.status).toBe("idle");
    expect(tracking.switching).toBe(false);
    expect(tracking.latestPose.current).toBeNull();
  },
);

test.each(["resolve", "reject"])(
  "old-detector inference cannot overwrite a successful switch when it %ss",
  async (settle) => {
    const inference = Promise.withResolvers();
    fixture.api.detect.mockReturnValueOnce(inference.promise);
    await start();
    let oldFrame;
    await act(async () => {
      oldFrame = nextFrame(100);
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const next = queueDetector();
    await changeSettings({ model: "lite" });
    await runConfigurationTimer();
    const pose = { timestamp: 200 };
    next.detect.mockResolvedValueOnce(pose);
    await act(async () => nextFrame(200));
    await act(async () => {
      inference[settle](
        settle === "resolve"
          ? { timestamp: 100 }
          : new Error("Stale inference"),
      );
      await oldFrame;
    });
    expect(tracking.latestPose.current).toBe(pose);
    expect(tracking.error).toBeNull();
    expect(tracking.status).toBe("tracking");
    expect(stream.getTracks()[0].stop).not.toHaveBeenCalled();
    const bitmap = await globalThis.createImageBitmap.mock.results[0].value;
    expect(bitmap.close).toHaveBeenCalledOnce();
  },
);

test("rig smoothing updates and defaults reset do not rebuild the detector or interrupt its pose", async () => {
  await start();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const pose = { timestamp: 100 };
  fixture.api.detect.mockResolvedValueOnce(pose);
  await act(async () => nextFrame(100));
  for (const smoothing of ["none", "classic", "stable"]) {
    await changeSettings({ smoothing });
    await runConfigurationTimer();
    expect(tracking.settings.smoothing).toBe(smoothing);
    expect(tracking.latestPose.current).toBe(pose);
    expect(tracking.switching).toBe(false);
  }
  await act(async () => tracking.resetSettings());
  await runConfigurationTimer();
  expect(tracking.settings).toEqual(DEFAULT_POSE_SETTINGS);
  expect(workers).toHaveLength(1);
  expect(workers[0].terminate).not.toHaveBeenCalled();
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(tracking.latestPose.current).toBe(pose);
});

test.each(["initialize", "worker"])(
  "a failed replacement %s preserves the working detector and latest rig smoothing",
  async (failure) => {
    await start();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const initialization = Promise.withResolvers();
    queueDetector(initialization);
    await changeSettings({ model: "lite" });
    await runConfigurationTimer();
    await changeSettings({ smoothing: "classic" });
    await act(async () => {
      if (failure === "initialize")
        initialization.reject(new Error("Model unavailable"));
      else workers[1].listeners.error();
    });
    expect(tracking.settings).toEqual({
      ...DEFAULT_POSE_SETTINGS,
      smoothing: "classic",
    });
    expect(tracking.error).toMatch(/previous settings are still active/);
    expect(tracking.switching).toBe(false);
    expect(workers[0].terminate).not.toHaveBeenCalled();
    expect(workers[1].terminate).toHaveBeenCalledOnce();
    const pose = { timestamp: 100 };
    fixture.api.detect.mockResolvedValueOnce(pose);
    await act(async () => nextFrame(100));
    expect(tracking.latestPose.current).toBe(pose);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(stream.getTracks()[0].stop).not.toHaveBeenCalled();
  },
);

test.each(["resolve", "reject"])(
  "inference from before a failed switch stays stale when the old detector resumes (%s)",
  async (settle) => {
    const inference = Promise.withResolvers();
    fixture.api.detect.mockReturnValueOnce(inference.promise);
    await start();
    let oldFrame;
    await act(async () => {
      oldFrame = nextFrame(100);
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const next = queueDetector();
    next.initialize.mockRejectedValueOnce(new Error("Cannot load comparison"));
    await changeSettings({ model: "lite" });
    await runConfigurationTimer();
    const fallbackError = tracking.error;
    expect(fallbackError).toMatch(/previous settings/);
    await act(async () => {
      inference[settle](
        settle === "resolve"
          ? { timestamp: 100 }
          : new Error("Old frame failed"),
      );
      await oldFrame;
    });
    expect(tracking.latestPose.current).toBeNull();
    expect(tracking.status).toBe("lost");
    expect(tracking.error).toBe(fallbackError);
    expect(stream.getTracks()[0].stop).not.toHaveBeenCalled();
    const fresh = { timestamp: 200 };
    fixture.api.detect.mockResolvedValueOnce(fresh);
    await act(async () => nextFrame(200));
    expect(tracking.latestPose.current).toBe(fresh);
  },
);

test("switching while hidden keeps the camera paused until visibility returns", async () => {
  await start();
  await setHidden(true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const initialization = Promise.withResolvers();
  const next = queueDetector(initialization);
  await changeSettings({ model: "lite" });
  await runConfigurationTimer();
  expect(tracking.status).toBe("paused");
  expect(callbacks.size).toBe(0);
  await act(async () => initialization.resolve({ delegate: "GPU" }));
  expect(tracking.status).toBe("paused");
  expect(stream.getVideoTracks()[0].enabled).toBe(false);
  expect(callbacks.size).toBe(0);
  await setHidden(false);
  expect(tracking.status).toBe("lost");
  expect(stream.getVideoTracks()[0].enabled).toBe(true);
  expect(callbacks.size).toBe(1);
  await act(async () => nextFrame(100));
  expect(next.detect).toHaveBeenCalledOnce();
  expect(getUserMedia).toHaveBeenCalledOnce();
});

test.each(["resolve", "reject"])(
  "inference started before hiding is stale after the tab becomes visible again (%s)",
  async (settle) => {
    const inference = Promise.withResolvers();
    fixture.api.detect.mockReturnValueOnce(inference.promise);
    await start();
    let oldFrame;
    await act(async () => {
      oldFrame = nextFrame(100);
    });
    await setHidden(true);
    await setHidden(false);
    await act(async () => {
      inference[settle](
        settle === "resolve"
          ? { timestamp: 100 }
          : new Error("Pre-pause frame failed"),
      );
      await oldFrame;
    });
    expect(tracking.latestPose.current).toBeNull();
    expect(tracking.error).toBeNull();
    expect(tracking.status).toBe("lost");
    expect(stream.getTracks()[0].stop).not.toHaveBeenCalled();
    const fresh = { timestamp: 200 };
    fixture.api.detect.mockResolvedValueOnce(fresh);
    await act(async () => nextFrame(200));
    expect(tracking.latestPose.current).toBe(fresh);
  },
);

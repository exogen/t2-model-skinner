import { afterEach, beforeEach, expect, test, vi } from "vitest";
import React, { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { getEnv } from "fabric";
import { Object3D, Vector3 } from "three";
import { framingAt } from "./recording";
import { COUNTDOWN_SECONDS } from "./useRecorder";

const COUNTDOWN = COUNTDOWN_SECONDS * 1000;
const art = vi.hoisted(() => ({
  loaded: { logo: "logo" },
  fallback: { logo: "text" },
}));
vi.mock("./photos", async (importOriginal) => ({
  ...(await importOriginal()),
  renderBoothStrip: vi.fn(() => ({ width: 800, height: 2009 })),
  loadStripArt: vi.fn(async () => art.loaded),
  fallbackStripArt: vi.fn(() => art.fallback),
}));
const screenshots = vi.hoisted(() => [
  { screenshot: 1 },
  { screenshot: 2 },
  { screenshot: 1 },
]);
vi.mock("./mapBackgrounds", async (importOriginal) => ({
  ...(await importOriginal()),
  loadMapPictures: vi.fn(async () => screenshots),
}));
vi.mock("../modelImage", async (importOriginal) => ({
  ...(await importOriginal()),
  canvasBlob: vi.fn(
    async () => new globalThis.Blob(["png"], { type: "image/png" }),
  ),
}));

const { document } = getEnv();
let recorderModule;
let photos;
let mapBackgrounds;
let modelImage;
let WarriorContext;
let root;
let host;
let recorder;

function Harness({ status }) {
  const value = recorderModule.default(status);
  useLayoutEffect(() => {
    recorder = value;
  });
  return null;
}

async function render(status = "tracking", actualModel = "lmale") {
  await act(async () =>
    root.render(
      React.createElement(
        WarriorContext.Provider,
        { value: { actualModel } },
        React.createElement(Harness, { status }),
      ),
    ),
  );
}

function createStage(names = ["Bip01_Pelvis", "Bip01_Spine"]) {
  const nodes = names.map((name) => Object.assign(new Object3D(), { name }));
  const captures = [];
  const viewer = {
    captureFrame: vi.fn(() => {
      const capture = Promise.withResolvers();
      captures.push(capture);
      return capture.promise;
    }),
  };
  return { nodes, viewer, captures };
}

async function attach(stage) {
  let detach;
  await act(async () => {
    detach = recorder.attach({ viewer: stage.viewer, nodes: stage.nodes });
  });
  return () => act(async () => detach());
}

async function advance(ms) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

async function sample(frames, landmarks = []) {
  await act(async () => {
    for (let i = 0; i < frames; i++)
      recorder.sampleFrame(1 / 60, landmarks, 640, 480);
  });
}

/** Starts a recording and runs its countdown. */
async function startRecording() {
  await act(async () => {
    void recorder.record();
  });
  await advance(COUNTDOWN);
  expect(recorder.activity?.phase).toBe("recording");
}

const names = {
  caption: { skin: "Beagle", model: "Human Male", armor: "Light armor" },
  fileName: "Beagle - lmale - Photo strip - 2026-10-20 14-03-05.png",
  alt: "Photo strip with 3 poses of Beagle on Human Male • Light",
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  // A fresh module keeps recordings from leaking between tests.
  vi.resetModules();
  recorderModule = await import("./useRecorder");
  photos = await import("./photos");
  mapBackgrounds = await import("./mapBackgrounds");
  modelImage = await import("../modelImage");
  ({ WarriorContext } = await import("../useWarrior"));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  recorder = null;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

test("record counts down five seconds, records live frames until stop, then selects and plays the recording", async () => {
  await render();
  const stage = createStage();
  await attach(stage);
  expect(recorder.attached).toBe(true);
  const startedAt = globalThis.performance.now();
  await act(async () => {
    void recorder.record();
  });
  expect(recorder.activity).toEqual({
    phase: "record-countdown",
    endsAt: startedAt + COUNTDOWN,
  });
  expect(recorder.announcement.text).toBe("Recording starts in 3 seconds.");
  await sample(10);
  await advance(COUNTDOWN - 1);
  expect(recorder.activity.phase).toBe("record-countdown");
  await advance(1);
  expect(recorder.activity).toEqual({
    phase: "recording",
    startedAt: startedAt + COUNTDOWN,
  });
  expect(recorder.announcement.text).toBe("Recording.");
  await act(async () => {
    for (let i = 0; i < 90; i++) {
      stage.nodes[0].rotation.y = i / 90;
      recorder.sampleFrame(1 / 60, [], 640, 480);
    }
  });
  await act(async () => recorder.stop());
  expect(recorder.activity).toBeNull();
  expect(recorder.recordings).toHaveLength(1);
  const [recording] = recorder.recordings;
  expect(recording).toMatchObject({
    kind: "recording",
    model: "lmale",
    label: "Animation 1",
    nodes: ["Bip01_Pelvis", "Bip01_Spine"],
    imageWidth: 640,
    imageHeight: 480,
  });
  expect(recording.times).toHaveLength(90);
  expect(recording.duration).toBeCloseTo(89 / 60, 5);
  expect(recorder.selected).toBe(recording);
  expect(recorder.paused).toBe(false);
  expect(recorder.playbackRef.current).toEqual({ time: 0, paused: false });
  expect(recorder.announcement.text).toBe(
    "Animation 1 saved, 1 second. Playing it now.",
  );
});

test("stopping during the countdown records nothing and leaves no timers", async () => {
  await render();
  await attach(createStage());
  await act(async () => {
    void recorder.record();
  });
  await act(async () => recorder.stop());
  expect(recorder.activity).toBeNull();
  expect(recorder.announcement.text).toBe("Recording canceled.");
  expect(vi.getTimerCount()).toBe(0);
  await advance(10000);
  await sample(30);
  expect(recorder.recordings).toEqual([]);
  expect(recorder.activity).toBeNull();
});

test("a recording stops itself at sixty seconds, keeps its keys and plays", async () => {
  await render();
  await attach(createStage());
  await startRecording();
  await sample(3700);
  expect(recorder.activity).toBeNull();
  const [recording] = recorder.recordings;
  expect(recording.duration).toBeLessThanOrEqual(60);
  expect(recording.duration).toBeGreaterThan(59.9);
  expect(recorder.selected).toBe(recording);
  expect(recorder.announcement.text).toBe(
    "Recording stopped at the 60-second limit. Animation 1 saved. Playing it now.",
  );
});

test.each(["paused", "idle", "error"])(
  "camera status %s keeps an unfinished recording unselected and cancels countdowns",
  async (status) => {
    await render();
    const stage = createStage();
    await attach(stage);
    await startRecording();
    await sample(30);
    await render(status);
    expect(recorder.activity).toBeNull();
    expect(recorder.recordings).toHaveLength(1);
    expect(recorder.selected).toBeNull();
    expect(recorder.announcement.text).toBe(
      "Recording stopped. Animation 1 saved.",
    );

    await render();
    await act(async () => {
      void recorder.record();
    });
    await render(status);
    expect(recorder.activity).toBeNull();
    expect(recorder.announcement.text).toBe("Recording canceled.");

    await render();
    let booth;
    await act(async () => {
      booth = recorder.startBooth(names);
    });
    await render(status);
    await expect(booth).resolves.toBeUndefined();
    expect(recorder.activity).toBeNull();
    expect(recorder.announcement.text).toBe("Photo booth canceled.");
    expect(stage.viewer.captureFrame).not.toHaveBeenCalled();
  },
);

test.each(["lost", "loading", "requesting"])(
  "camera status %s does not interrupt a recording",
  async (status) => {
    await render();
    await attach(createStage());
    await startRecording();
    await sample(30);
    await render(status);
    await sample(30);
    expect(recorder.activity?.phase).toBe("recording");
    await act(async () => recorder.stop());
    expect(recorder.recordings[0].times).toHaveLength(60);
  },
);

test("detaching the model saves the recording under its model, cancels countdowns and returns to the live camera", async () => {
  await render();
  let detach = await attach(createStage());
  await startRecording();
  await sample(30);
  await detach();
  expect(recorder.attached).toBe(false);
  expect(recorder.activity).toBeNull();
  expect(recorder.recordings).toHaveLength(1);
  expect(recorder.recordings[0].model).toBe("lmale");
  expect(recorder.selected).toBeNull();

  detach = await attach(createStage());
  await act(async () => recorder.select(recorder.recordings[0].id));
  expect(recorder.selected).not.toBeNull();
  await act(async () => {
    void recorder.record();
  });
  expect(recorder.selected).toBeNull();
  await act(async () => recorder.select(recorder.recordings[0].id));
  await detach();
  expect(recorder.selected).toBeNull();

  // A stale detach can't remove the model that replaced it.
  const stale = await attach(createStage());
  const current = createStage();
  await attach(current);
  await stale();
  expect(recorder.attached).toBe(true);
  await act(async () => {
    void recorder.record();
  });
  expect(recorder.activity?.phase).toBe("record-countdown");
});

test("the photo booth shoots after a 3-second countdown each time, with one-second holds, and saves each pose", async () => {
  await render();
  const stage = createStage();
  await attach(stage);
  let booth;
  const start = globalThis.performance.now();
  await act(async () => {
    booth = recorder.startBooth(names);
  });
  expect(recorder.activity).toEqual({
    phase: "booth-countdown",
    taken: 0,
    endsAt: start + COUNTDOWN,
  });
  expect(recorder.announcement.text).toBe(
    "Photo booth: first photo in 3 seconds.",
  );
  await advance(COUNTDOWN - 1);
  expect(stage.viewer.captureFrame).not.toHaveBeenCalled();
  await advance(1);
  // Photos are the camera image's area, where the framing places the model.
  expect(stage.viewer.captureFrame).toHaveBeenCalledExactlyOnceWith({
    cameraArea: true,
  });
  for (let shot = 0; shot < 3; shot++) {
    stage.nodes[0].quaternion.setFromAxisAngle(new Vector3(0, 1, 0), shot + 1);
    await act(async () => stage.captures[shot].resolve({ shot }));
    expect(recorder.recordings[0]).toMatchObject({
      kind: "pose",
      label: `Pose ${shot + 1}`,
      duration: 0,
    });
    expect(recorder.recordings[0].rotations[1]).toBeCloseTo(
      Math.sin((shot + 1) / 2),
      6,
    );
    if (shot === 2) break;
    expect(recorder.activity).toEqual({ phase: "booth-hold", taken: shot + 1 });
    expect(recorder.announcement.text).toBe(
      `Photo ${shot + 1} of 3 taken. Next photo in 4 seconds.`,
    );
    const holdStart = globalThis.performance.now();
    await advance(1000);
    expect(recorder.activity).toEqual({
      phase: "booth-countdown",
      taken: shot + 1,
      endsAt: holdStart + 1000 + COUNTDOWN,
    });
    await advance(COUNTDOWN - 1);
    expect(stage.viewer.captureFrame).toHaveBeenCalledTimes(shot + 1);
    await advance(1);
    expect(stage.viewer.captureFrame).toHaveBeenCalledTimes(shot + 2);
  }
  await act(async () => {
    await booth;
  });
  expect(recorder.activity).toBeNull();
  expect(recorder.recordings.map((entry) => entry.label)).toEqual([
    "Pose 3",
    "Pose 2",
    "Pose 1",
  ]);
  expect(recorder.selected).toBeNull();
  expect(photos.renderBoothStrip.mock.calls[0][0]).toEqual([
    { shot: 0 },
    { shot: 1 },
    { shot: 2 },
  ]);
});

test("a booth pose is the one in the captured frame", async () => {
  await render();
  const stage = createStage();
  await attach(stage);
  // Browsers encode images in a later task, after the next frame. Encoding a
  // photo before reading the pose would then read the moved bone.
  modelImage.canvasBlob.mockImplementation(
    () =>
      new Promise((resolve) => {
        globalThis.setTimeout(
          () => resolve(new globalThis.Blob(["png"], { type: "image/png" })),
          0,
        );
      }),
  );
  await act(async () => {
    void recorder.startBooth(names);
  });
  await advance(COUNTDOWN);
  const captured = new Vector3(0, 1, 0);
  stage.nodes[0].quaternion.setFromAxisAngle(captured, 0.5);
  // The next frame moves the bone; the pose must not see it.
  globalThis.setTimeout(
    () => stage.nodes[0].quaternion.setFromAxisAngle(captured, 2),
    0,
  );
  await act(async () => {
    stage.captures[0].resolve({});
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(stage.nodes[0].quaternion.y).toBeCloseTo(Math.sin(1), 6);
  expect(recorder.recordings[0].rotations[1]).toBeCloseTo(Math.sin(0.25), 6);
});

test("cancelling the photo booth keeps earlier poses and offers no strip", async () => {
  await render();
  const stage = createStage();
  await attach(stage);
  let booth;
  await act(async () => {
    booth = recorder.startBooth(names);
  });
  await advance(COUNTDOWN);
  await act(async () => stage.captures[0].resolve({}));
  await advance(1000);
  expect(recorder.activity.phase).toBe("booth-countdown");
  await act(async () => recorder.stop());
  await expect(booth).resolves.toBeUndefined();
  expect(recorder.activity).toBeNull();
  expect(recorder.strip).toBeNull();
  expect(recorder.recordings.map((entry) => entry.label)).toEqual(["Pose 1"]);
  expect(recorder.announcement.text).toBe("Photo booth canceled.");
  expect(vi.getTimerCount()).toBe(0);
});

test("a finished booth adds its poses and delivers a png strip with the fixed file name", async () => {
  await render();
  const stage = createStage();
  await attach(stage);
  const encoding = Promise.withResolvers();
  modelImage.canvasBlob.mockReturnValueOnce(encoding.promise);
  let booth;
  await act(async () => {
    booth = recorder.startBooth(names);
  });
  for (let shot = 0; shot < 3; shot++) {
    await advance(shot ? 1000 + COUNTDOWN : COUNTDOWN);
    await act(async () => stage.captures[shot].resolve({ shot }));
  }
  expect(recorder.activity).toEqual({ phase: "developing", taken: 3 });
  expect(recorder.announcement.text).toBe(
    "Photo 3 of 3 taken. Developing the photo strip.",
  );
  await act(async () => {
    encoding.resolve(new globalThis.Blob(["png"], { type: "image/png" }));
    await booth;
  });
  expect(photos.loadStripArt).toHaveBeenCalledOnce();
  expect(photos.renderBoothStrip).toHaveBeenCalledExactlyOnceWith(
    [{ shot: 0 }, { shot: 1 }, { shot: 2 }],
    names.caption,
    art.loaded,
    [],
  );
  expect(mapBackgrounds.loadMapPictures).not.toHaveBeenCalled();
  expect(recorder.strip).toMatchObject({
    width: 800,
    height: 2009,
    fileName: names.fileName,
    alt: names.alt,
    frames: [{ shot: 0 }, { shot: 1 }, { shot: 2 }],
    caption: names.caption,
    art: art.loaded,
    background: null,
  });
  expect(recorder.strip.blob.type).toBe("image/png");
  expect(recorder.recordings.map((entry) => entry.label)).toEqual([
    "Pose 3",
    "Pose 2",
    "Pose 1",
  ]);
  expect(recorder.activity).toBeNull();
  await act(async () => recorder.dismissStrip());
  expect(recorder.strip).toBeNull();
});

test("a booth whose fonts and logo are still loading 3 seconds after the last shot draws with the fallbacks", async () => {
  photos.loadStripArt.mockReturnValueOnce(new Promise(() => {}));
  await render();
  const stage = createStage();
  await attach(stage);
  const encoding = Promise.withResolvers();
  modelImage.canvasBlob.mockReturnValueOnce(encoding.promise);
  let booth;
  await act(async () => {
    booth = recorder.startBooth(names);
  });
  for (let shot = 0; shot < 3; shot++) {
    await advance(shot ? 1000 + COUNTDOWN : COUNTDOWN);
    await act(async () => stage.captures[shot].resolve({ shot }));
  }
  await advance(2900);
  expect(photos.renderBoothStrip).not.toHaveBeenCalled();
  expect(recorder.activity).toEqual({ phase: "developing", taken: 3 });
  await advance(100);
  expect(photos.renderBoothStrip).toHaveBeenCalledExactlyOnceWith(
    [{ shot: 0 }, { shot: 1 }, { shot: 2 }],
    names.caption,
    art.fallback,
    [],
  );
  await act(async () => {
    encoding.resolve(new globalThis.Blob(["png"], { type: "image/png" }));
    await booth;
  });
  expect(recorder.strip).toMatchObject({
    width: 800,
    height: 2009,
    fileName: names.fileName,
  });
  expect(vi.getTimerCount()).toBe(0);
});

test("canceling while the strip's fonts and logo load ends the wait without drawing a strip", async () => {
  photos.loadStripArt.mockReturnValueOnce(new Promise(() => {}));
  await render();
  const stage = createStage();
  await attach(stage);
  let booth;
  await act(async () => {
    booth = recorder.startBooth(names);
  });
  for (let shot = 0; shot < 3; shot++) {
    await advance(shot ? 1000 + COUNTDOWN : COUNTDOWN);
    await act(async () => stage.captures[shot].resolve({ shot }));
  }
  expect(recorder.activity).toEqual({ phase: "developing", taken: 3 });
  await act(async () => {
    recorder.stop();
    await booth;
  });
  expect(recorder.announcement.text).toBe("Photo booth canceled.");
  expect(photos.renderBoothStrip).not.toHaveBeenCalled();
  expect(photos.fallbackStripArt).not.toHaveBeenCalled();
  expect([recorder.strip, recorder.failure]).toEqual([null, null]);
  expect(vi.getTimerCount()).toBe(0);
});

/** Takes the booth's three shots. */
async function shootBooth(stage) {
  for (let shot = 0; shot < 3; shot++) {
    await advance(shot ? 1000 + COUNTDOWN : COUNTDOWN);
    await act(async () => stage.captures[shot].resolve({ shot }));
  }
}

test("a booth with a map background loads its screenshots during the countdowns and draws the photos over them", async () => {
  await render();
  const stage = createStage();
  await attach(stage);
  const encoding = Promise.withResolvers();
  modelImage.canvasBlob.mockReturnValueOnce(encoding.promise);
  let booth;
  await act(async () => {
    booth = recorder.startBooth(names, "DX_Ice");
  });
  expect(mapBackgrounds.loadMapPictures).toHaveBeenCalledExactlyOnceWith(
    "DX_Ice",
    3,
  );
  await shootBooth(stage);
  await act(async () => {
    encoding.resolve(new globalThis.Blob(["png"], { type: "image/png" }));
    await booth;
  });
  expect(photos.renderBoothStrip).toHaveBeenCalledExactlyOnceWith(
    [{ shot: 0 }, { shot: 1 }, { shot: 2 }],
    names.caption,
    art.loaded,
    screenshots,
  );
  expect(recorder.strip.background).toBe("DX_Ice");
});

test.each([
  ["can't load", () => Promise.resolve([]), 0],
  [
    "are still loading 3 seconds after the last shot",
    () => new Promise(() => {}),
    3000,
  ],
])(
  "a booth whose map screenshots %s draws over the gradient",
  async (_, loading, wait) => {
    mapBackgrounds.loadMapPictures.mockReturnValueOnce(loading());
    await render();
    const stage = createStage();
    await attach(stage);
    const encoding = Promise.withResolvers();
    modelImage.canvasBlob.mockReturnValueOnce(encoding.promise);
    let booth;
    await act(async () => {
      booth = recorder.startBooth(names, "DX_Ice");
    });
    await shootBooth(stage);
    if (wait) {
      await advance(wait - 100);
      expect(photos.renderBoothStrip).not.toHaveBeenCalled();
      await advance(100);
    }
    await act(async () => {
      encoding.resolve(new globalThis.Blob(["png"], { type: "image/png" }));
      await booth;
    });
    expect(photos.renderBoothStrip).toHaveBeenCalledExactlyOnceWith(
      [{ shot: 0 }, { shot: 1 }, { shot: 2 }],
      names.caption,
      art.loaded,
      [],
    );
    expect(recorder.strip.background).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  },
);

test("a failed shot ends the photo booth and keeps the failure until it is dismissed", async () => {
  await render();
  const stage = createStage();
  await attach(stage);
  let booth;
  await act(async () => {
    booth = recorder.startBooth(names);
  });
  await advance(COUNTDOWN);
  await act(async () =>
    stage.captures[0].reject(new Error("The 3D view has closed.")),
  );
  await expect(booth).resolves.toBeUndefined();
  expect(recorder.activity).toBeNull();
  expect(recorder.failure).toBe("The photo booth could not finish. Try again.");
  await act(async () => recorder.dismissFailure());
  expect(recorder.failure).toBeNull();
  await act(async () => {
    booth = recorder.startBooth(names);
  });
  await advance(COUNTDOWN);
  await act(async () =>
    stage.captures[1].reject(new Error("The 3D view has closed.")),
  );
  // A new booth clears the last failure before it starts.
  await act(async () => {
    void recorder.startBooth(names);
  });
  expect(recorder.failure).toBeNull();
  await act(async () => recorder.stop());
  expect(recorder.failure).toBeNull();
});

test("the photo booth leaves playback before its first countdown", async () => {
  await render();
  await attach(createStage());
  await startRecording();
  await sample(30);
  await act(async () => recorder.stop());
  await act(async () => recorder.seek(0.2));
  expect(recorder.selected).not.toBeNull();
  await act(async () => {
    void recorder.startBooth(names);
  });
  expect(recorder.activity.phase).toBe("booth-countdown");
  expect(recorder.selected).toBeNull();
  expect(recorder.paused).toBe(false);
  expect(recorder.playbackRef.current).toEqual({ time: 0, paused: false });
});

function shoulders(x) {
  const landmarks = [];
  for (const [index, offset] of [
    [11, 0],
    [12, -0.2],
    [23, -0.05],
    [24, -0.15],
  ]) {
    landmarks[index] = {
      x: x + offset,
      y: index < 20 ? 0.3 : 0.6,
      z: 0,
      visibility: 1,
    };
  }
  return landmarks;
}

test("recordings and booth poses keep the framing input framing could measure", async () => {
  await render();
  const stage = createStage();
  await attach(stage);
  await sample(1, shoulders(0.6));
  await act(async () => {
    void recorder.record();
  });
  await advance(COUNTDOWN);
  // The first key is taken while nobody is measurable, so it uses the last
  // framing the viewer was holding.
  const oneShoulder = [];
  oneShoulder[11] = { x: 0.2, y: 0.3, z: 0, visibility: 1 };
  await sample(1, oneShoulder);
  await sample(1, shoulders(0.7));
  await act(async () => recorder.stop());
  const [recording] = recorder.recordings;
  expect(framingAt(recording, 0)[11].x).toBeCloseTo(0.6, 6);
  expect(framingAt(recording, 1)[11].x).toBeCloseTo(0.7, 6);
  expect([recording.imageWidth, recording.imageHeight]).toEqual([640, 480]);

  await act(async () => {
    void recorder.startBooth(names);
  });
  await sample(1, oneShoulder);
  await advance(COUNTDOWN);
  await act(async () => stage.captures[0].resolve({}));
  const pose = recorder.recordings.find((entry) => entry.kind === "pose");
  expect(framingAt(pose, 0)[11].x).toBeCloseTo(0.7, 6);
  expect(framingAt(pose, 0)[24].x).toBeCloseTo(0.55, 6);
});

test("recordings are listed only for the model they were captured on and numbered per model", async () => {
  await render();
  let detach = await attach(createStage());
  await startRecording();
  await sample(10);
  await act(async () => recorder.stop());
  await detach();
  await render("tracking", "hbioderm");
  expect(recorder.recordings).toEqual([]);
  detach = await attach(createStage(["Bip01_Pelvis"]));
  await startRecording();
  await sample(10);
  await act(async () => recorder.stop());
  expect(
    recorder.recordings.map((entry) => [entry.label, entry.model]),
  ).toEqual([["Animation 1", "hbioderm"]]);
  await detach();
  await render();
  const stage = createStage();
  await attach(stage);
  await startRecording();
  await sample(10);
  await act(async () => recorder.stop());
  await act(async () => {
    void recorder.startBooth(names);
  });
  await advance(COUNTDOWN);
  await act(async () => stage.captures[0].resolve({}));
  expect(recorder.recordings.map((entry) => entry.label)).toEqual([
    "Pose 1",
    "Animation 2",
    "Animation 1",
  ]);
  expect(recorder.recordings.every((entry) => entry.model === "lmale")).toBe(
    true,
  );
});

test("seeking pauses at the chosen time and selecting restarts from the start", async () => {
  await render();
  await attach(createStage());
  await startRecording();
  await sample(120);
  await act(async () => recorder.stop());
  const { id } = recorder.selected;
  await act(async () => recorder.seek(1.25));
  expect(recorder.playbackRef.current).toEqual({ time: 1.25, paused: true });
  expect(recorder.paused).toBe(true);
  await act(async () => recorder.setPaused(false));
  expect(recorder.playbackRef.current).toEqual({ time: 1.25, paused: false });
  expect(recorder.paused).toBe(false);
  await act(async () => recorder.seek(-3));
  expect(recorder.playbackRef.current.time).toBe(0);
  await act(async () => recorder.select(id));
  expect(recorder.playbackRef.current).toEqual({ time: 0, paused: false });
  expect(recorder.paused).toBe(false);
  await act(async () => recorder.select(null));
  expect(recorder.selected).toBeNull();
});

test("recordings survive remounting the recorder, including one in progress", async () => {
  await render();
  await attach(createStage());
  await startRecording();
  await sample(10);
  await act(async () => recorder.stop());
  await startRecording();
  await sample(10);
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  expect(recorder.recordings.map((entry) => entry.label)).toEqual([
    "Animation 2",
    "Animation 1",
  ]);
  expect(recorder.selected).toBeNull();
  expect(recorder.activity).toBeNull();
});

test("record and photo booth do nothing while busy or without an attached model", async () => {
  await render();
  await act(async () => {
    void recorder.record();
    void recorder.startBooth(names);
  });
  expect(recorder.activity).toBeNull();
  const stage = createStage();
  await attach(stage);
  await act(async () => {
    void recorder.record();
  });
  const countdown = recorder.activity;
  await act(async () => {
    void recorder.record();
    void recorder.startBooth(names);
  });
  expect(recorder.activity).toBe(countdown);
  await advance(COUNTDOWN);
  await act(async () => {
    void recorder.startBooth(names);
  });
  expect(recorder.activity.phase).toBe("recording");
  expect(stage.viewer.captureFrame).not.toHaveBeenCalled();
});

test("callbacks keep their identity across renders", async () => {
  await render();
  const first = recorder;
  await attach(createStage());
  await startRecording();
  for (const key of [
    "stop",
    "select",
    "setPaused",
    "seek",
    "dismissStrip",
    "dismissFailure",
    "attach",
    "sampleFrame",
    "playbackRef",
  ]) {
    expect(recorder[key], key).toBe(first[key]);
  }
});

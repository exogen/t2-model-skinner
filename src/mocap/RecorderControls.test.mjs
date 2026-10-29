import { afterEach, beforeEach, expect, test, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { getEnv } from "fabric";
import { saveAs } from "file-saver";
import { CaptureControls, PlaybackControls } from "./RecorderControls";
import { idleRecorder } from "./recorderTestUtils";
import { chooseOption, openSelect } from "../selectTestUtils";
import * as mapBackgrounds from "./mapBackgrounds";
import * as photos from "./photos";
import * as modelImage from "../modelImage";

const fixture = vi.hoisted(() => ({ warrior: null }));
vi.mock("../useWarrior", () => ({ default: () => fixture.warrior }));
vi.mock("file-saver", () => ({ saveAs: vi.fn() }));
// The t2-maps gallery, without the network: two maps, screenshots that load
// as named stand-ins, and the chosen map.
const gallery = vi.hoisted(() => ({ chosen: null, maps: null }));
vi.mock("./mapBackgrounds", async (importOriginal) => ({
  ...(await importOriginal()),
  loadMaps: vi.fn(() => gallery.maps),
  loadMapPictures: vi.fn(async (mission, count) =>
    Array.from({ length: count }, (_, index) => ({
      name: `${mission}.${index + 1}`,
    })),
  ),
  chosenMapBackground: vi.fn(() => gallery.chosen),
  chooseMapBackground: vi.fn((mission) => {
    gallery.chosen = mission;
  }),
}));
vi.mock("./photos", async (importOriginal) => ({
  ...(await importOriginal()),
  renderBoothStrip: vi.fn((frames, caption, art, backgrounds) => ({
    width: 800,
    height: backgrounds.length ? 2100 : 2009,
    backgrounds,
  })),
}));
vi.mock("../modelImage", async (importOriginal) => ({
  ...(await importOriginal()),
  canvasBlob: vi.fn(
    async (canvas) =>
      new globalThis.Blob(
        [canvas.backgrounds.map(({ name }) => name).join() || "gradient"],
        { type: "image/png" },
      ),
  ),
}));

const { document, window } = getEnv();
const animationFrames = {
  request: globalThis.requestAnimationFrame,
  cancel: globalThis.cancelAnimationFrame,
};
const originalResizeObserver = globalThis.ResizeObserver;
// jsdom has no ResizeObserver; resize() reports a resize of whatever these watch.
const resizeObservers = [];
class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = new Set();
    resizeObservers.push(this);
  }
  observe(target) {
    this.targets.add(target);
  }
  disconnect() {
    this.targets.clear();
  }
}
const watching = () =>
  resizeObservers.filter((observer) => observer.targets.size);
const resize = () =>
  act(async () => {
    for (const observer of watching())
      observer.callback(
        [...observer.targets].map((target) => ({ target })),
        observer,
      );
  });
const recording = {
  id: 1,
  kind: "recording",
  label: "Animation 1",
  duration: 3,
};
const pose = { id: 2, kind: "pose", label: "Pose 1", duration: 0 };
let root;
let host;
let commits;

async function render(recorder, status = "tracking") {
  await act(async () =>
    root.render(
      React.createElement(
        React.Profiler,
        {
          id: "controls",
          onRender: () => {
            commits++;
          },
        },
        React.createElement(CaptureControls, { recorder, status }),
        React.createElement(PlaybackControls, { recorder }),
      ),
    ),
  );
}

const captureButtons = () => [
  ...host
    .querySelector("[role='group'][aria-label='Capture']")
    .querySelectorAll("button"),
];
const button = (label) =>
  [...host.querySelectorAll("button")].find(
    (element) =>
      (element.getAttribute("aria-label") ?? element.textContent) === label,
  );
const dialog = () => document.body.querySelector("dialog[open]");

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "performance", "Date"],
  });
  vi.setSystemTime(new Date(2026, 9, 20, 14, 3, 5));
  fixture.warrior = {
    selectedSkin: "Beagle",
    selectedSkinType: "default",
    selectedModel: "lmale",
    selectedModelType: "player",
  };
  gallery.chosen = null;
  gallery.maps = Promise.resolve([
    { mission: "DX_Ice", label: "Dangerous Crossing (Ice)", imageCount: 3 },
    { mission: "Katabatic", label: "Katabatic", imageCount: 1 },
  ]);
  commits = 0;
  resizeObservers.length = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.stubGlobal("requestAnimationFrame", animationFrames.request);
  vi.stubGlobal("cancelAnimationFrame", animationFrames.cancel);
  vi.stubGlobal("ResizeObserver", originalResizeObserver);
});

test("record and photo booth wait for an attached model and a tracking camera", async () => {
  const recorder = idleRecorder();
  await render(recorder);
  const [record, booth] = captureButtons();
  expect([record.disabled, booth.disabled]).toEqual([true, true]);
  expect([record.title, booth.title]).toEqual(
    Array(2).fill("Available once the model has loaded"),
  );
  for (const [status, enabled] of [
    ["loading", false],
    ["requesting", false],
    ["tracking", true],
    ["lost", true],
  ]) {
    await render({ ...recorder, attached: true }, status);
    expect([record.disabled, booth.disabled], status).toEqual([
      !enabled,
      !enabled,
    ]);
    if (!enabled)
      expect(record.title).toBe("Available while the camera is tracking");
  }
  expect(record.title).toBe(
    "Record your motion after a 3-second countdown, up to 60 seconds",
  );
  expect(booth.title).toBe(
    "Take 3 photos, each after a countdown, and make a photo strip",
  );
});

test("the record button counts down then stops while keeping one focused element and fixed names", async () => {
  const recorder = idleRecorder({ attached: true });
  await render(recorder);
  const [record, booth] = captureButtons();
  record.focus();
  await act(async () => record.click());
  expect(recorder.record).toHaveBeenCalledOnce();
  const now = globalThis.performance.now();
  await render({
    ...recorder,
    activity: { phase: "record-countdown", endsAt: now + 3000 },
  });
  expect(captureButtons()[0]).toBe(record);
  expect(document.activeElement).toBe(record);
  expect(record.getAttribute("aria-label")).toBe("Cancel recording");
  expect(record.textContent).toBe("Cancel · 3");
  expect(
    record.querySelector("[class*='Number']").getAttribute("aria-hidden"),
  ).toBe("true");
  expect(booth.disabled).toBe(true);
  expect(booth.title).toBe("Available after recording");
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  expect(record.textContent).toBe("Cancel · 2");
  await act(async () => record.click());
  expect(recorder.stop).toHaveBeenCalledOnce();
  await render({
    ...recorder,
    activity: { phase: "recording", startedAt: globalThis.performance.now() },
  });
  expect(document.activeElement).toBe(record);
  expect(record.getAttribute("aria-label")).toBe("Stop recording");
  expect(record.textContent).toBe("Stop · 0:00");
  await act(async () => {
    vi.advanceTimersByTime(12000);
  });
  expect(record.textContent).toBe("Stop · 0:12");
  await act(async () => record.click());
  expect(recorder.stop).toHaveBeenCalledTimes(2);
  await render(recorder);
  expect(record.getAttribute("aria-label")).toBeNull();
  expect(record.textContent).toBe("Record");
  expect(document.activeElement).toBe(record);
});

test("the photo booth button starts a booth named after the skin and model and cancels while running", async () => {
  const recorder = idleRecorder({ attached: true });
  await render(recorder);
  const [record, booth] = captureButtons();
  await act(async () => booth.click());
  expect(recorder.startBooth).toHaveBeenCalledExactlyOnceWith(
    {
      caption: { skin: "Beagle", model: "Human Male", armor: "Light armor" },
      fileName: "Beagle - lmale - Photo strip - 2026-10-20 14-03-05.png",
      alt: "Photo strip with 3 poses of Beagle on Human Male • Light",
    },
    null,
  );
  await render({
    ...recorder,
    activity: {
      phase: "booth-countdown",
      taken: 0,
      endsAt: globalThis.performance.now() + 3000,
    },
  });
  expect(booth.getAttribute("aria-label")).toBe("Cancel photo booth");
  expect(booth.textContent).toBe("Cancel · 3");
  expect(record.disabled).toBe(true);
  expect(record.title).toBe("Available after the photo booth");
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  await act(async () => booth.click());
  expect(recorder.stop).toHaveBeenCalledOnce();
  await render({ ...recorder, activity: { phase: "booth-hold", taken: 1 } });
  expect(booth.textContent).toBe("Cancel");
});

test("a photo booth failure kept by the recorder is shown in a message and then cleared", async () => {
  const recorder = idleRecorder({
    attached: true,
    failure: "The photo booth could not finish. Try again.",
  });
  await render(recorder);
  expect(dialog().querySelector("[role='alert']").textContent).toBe(
    "The photo booth could not finish. Try again.",
  );
  expect(dialog().querySelector("h2").textContent).toBe(
    "Unable to finish photo booth",
  );
  expect(recorder.dismissFailure).toHaveBeenCalledOnce();
  await act(async () => dialog().querySelector("footer button").click());
  expect(dialog()).toBeNull();
});

test("the second click of a double click is ignored", async () => {
  const recorder = idleRecorder({ attached: true });
  await render(recorder);
  const [record] = captureButtons();
  await act(async () => record.click());
  await render({
    ...recorder,
    activity: {
      phase: "record-countdown",
      endsAt: globalThis.performance.now() + 3000,
    },
  });
  await act(async () => {
    vi.advanceTimersByTime(399);
  });
  await act(async () => record.click());
  expect(recorder.record).toHaveBeenCalledOnce();
  expect(recorder.stop).not.toHaveBeenCalled();
  await act(async () => {
    vi.advanceTimersByTime(1);
  });
  await act(async () => record.click());
  expect(recorder.stop).toHaveBeenCalledOnce();
});

test("developing keeps the photo booth button focusable but inert", async () => {
  const recorder = idleRecorder({
    attached: true,
    activity: { phase: "developing", taken: 3 },
  });
  await render(recorder);
  const booth = captureButtons()[1];
  expect(booth.disabled).toBe(false);
  expect(booth.getAttribute("aria-disabled")).toBe("true");
  expect(booth.getAttribute("aria-label")).toBe("Developing the photo strip");
  await act(async () => booth.click());
  expect(recorder.startBooth).not.toHaveBeenCalled();
  expect(recorder.stop).not.toHaveBeenCalled();
});

test("the playback dropdown offers the live camera plus this model's recordings and poses newest first", async () => {
  await render(idleRecorder());
  // With nothing to play back, the area stays empty.
  expect(host.querySelector("#MocapPlayback")).toBeNull();
  expect(host.querySelector("[class*='Playback']")).toBeNull();

  const recordings = [
    { ...pose, id: 4 },
    { ...recording, id: 3, label: "Animation 2", duration: 3.4 },
    { ...recording, duration: 0.3 },
  ];
  const recorder = idleRecorder({ recordings });
  await render(recorder);
  const trigger = host.querySelector("#MocapPlayback");
  expect(trigger.textContent).toContain("Live camera");
  const popup = await openSelect(trigger);
  expect(
    [...popup.querySelectorAll("[role='option']")].map(
      (option) => option.textContent,
    ),
  ).toEqual([
    "Live camera",
    "Animation 2 · 0:03",
    "Animation 1 · 0:01",
    "Pose 1",
  ]);
  expect(
    [...popup.querySelectorAll("[role='group']")].map(
      (group) => group.firstElementChild.textContent,
    ),
  ).toEqual(["Animations", "Poses"]);
  await act(async () =>
    [...popup.querySelectorAll("[role='option']")][2].click(),
  );
  expect(recorder.select).toHaveBeenLastCalledWith(1);
  await render({ ...recorder, selected: recordings[0] });
  await chooseOption(trigger, "live");
  expect(recorder.select).toHaveBeenLastCalledWith(null);
  await render({ ...recorder, activity: { phase: "booth-hold", taken: 1 } });
  expect(trigger.disabled).toBe(true);
});

test("a recording shows play, pause and a timeline that seeks and pauses; a pose hides them", async () => {
  const recorder = idleRecorder({
    recordings: [pose, recording],
    selected: recording,
  });
  recorder.seek.mockImplementation((seconds) => {
    recorder.playbackRef.current.time = seconds;
  });
  await render(recorder);
  await act(async () => button("Pause animation").click());
  expect(recorder.setPaused).toHaveBeenLastCalledWith(true);
  await render({ ...recorder, paused: true });
  await act(async () => button("Play animation").click());
  expect(recorder.setPaused).toHaveBeenLastCalledWith(false);
  const range = host.querySelector("input[type='range']");
  expect(range.getAttribute("aria-label")).toBe("Playback position");
  expect(Number(range.max)).toBe(3);
  const setValue = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(range),
    "value",
  ).set;
  await act(async () => {
    setValue.call(range, "1.5");
    range.dispatchEvent(new globalThis.Event("input", { bubbles: true }));
  });
  expect(recorder.seek).toHaveBeenCalledExactlyOnceWith(1.5);
  expect(range.getAttribute("aria-valuetext")).toBe("0:01.5 of 0:03.0");
  expect(range.nextElementSibling.textContent).toBe("0:01.5 / 0:03.0");

  await render({ ...recorder, selected: pose });
  expect(host.querySelector("input[type='range']")).toBeNull();
  expect(button("Pause animation")).toBeUndefined();
  expect(button("Save image")).toBeUndefined();
});

test("the timeline follows shared playback time without re-rendering", async () => {
  const frames = new Map();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id) => frames.delete(id));
  const runFrame = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  };
  const recorder = idleRecorder({
    recordings: [recording],
    selected: recording,
  });
  await render(recorder);
  const range = host.querySelector("input[type='range']");
  const readout = range.nextElementSibling;
  expect(readout.getAttribute("aria-hidden")).toBe("true");
  expect(readout.textContent).toBe("0:00.0 / 0:03.0");
  const rendered = commits;
  recorder.playbackRef.current.time = 1.5;
  runFrame();
  expect(Number(range.value)).toBeCloseTo(1.5, 5);
  expect(readout.textContent).toBe("0:01.5 / 0:03.0");
  expect(range.getAttribute("aria-valuetext")).toBe("0:01.5 of 0:03.0");
  recorder.playbackRef.current.time = 1.8;
  runFrame();
  expect(readout.textContent).toBe("0:01.8 / 0:03.0");
  // Screen readers hear about the new position once per second.
  expect(range.getAttribute("aria-valuetext")).toBe("0:01.5 of 0:03.0");
  recorder.playbackRef.current.time = 2.1;
  runFrame();
  expect(range.getAttribute("aria-valuetext")).toBe("0:02.1 of 0:03.0");
  expect(commits).toBe(rendered);
  recorder.playbackRef.current.time = 2.6;
  runFrame();
  expect(range.getAttribute("aria-valuetext")).toBe("0:02.1 of 0:03.0");
  // Once paused, the slider speaks the exact position on screen.
  await render({ ...recorder, paused: true });
  expect(frames.size).toBe(0);
  expect(range.getAttribute("aria-valuetext")).toBe("0:02.6 of 0:03.0");
});

function finishedStrip(overrides = {}) {
  return {
    blob: new globalThis.Blob(["png"], { type: "image/png" }),
    width: 800,
    height: 2009,
    fileName: "Beagle - lmale - Photo strip - 2026-10-20 14-03-05.png",
    alt: "Photo strip with 3 poses of Beagle on Human Male • Light",
    frames: ["frame 1", "frame 2", "frame 3"],
    caption: { skin: "Beagle", model: "Human Male", armor: "Light armor" },
    art: { logo: "logo" },
    background: null,
    ...overrides,
  };
}

/** Lets the dialog load the map list and screenshots and draw the strip. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

const backgroundInput = () => dialog().querySelector("input[role='combobox']");
const backgroundOptions = () => [
  ...dialog().querySelectorAll("[role='listbox'] [role='option']"),
];
const backgroundOption = (label) =>
  backgroundOptions().find((option) => option.textContent === label);
const optionLabels = () =>
  backgroundOptions().map((option) => option.textContent);
const chosenBackground = () =>
  backgroundOptions()
    .filter((option) => option.getAttribute("aria-selected") === "true")
    .map((option) => option.textContent);
// The item arrow keys move from and Enter chooses.
const activeBackground = () => {
  const id = backgroundInput().getAttribute("aria-activedescendant");
  return id ? document.getElementById(id).textContent : null;
};
const listStatus = () => dialog().querySelector("[role='status']");
const tryAgainButton = () =>
  [...dialog().querySelectorAll("button")].find(
    (element) => element.textContent === "Try again",
  );

/** Ariakit gives focus that lands on a map back to the search box only when
 * the box is visible, which nothing is to jsdom. */
function showSearchBox() {
  const getClientRects = window.Element.prototype.getClientRects;
  vi.spyOn(window.Element.prototype, "getClientRects").mockImplementation(
    function () {
      return this.getAttribute("role") === "combobox"
        ? [{}]
        : getClientRects.call(this);
    },
  );
}

async function chooseBackground(label) {
  const option = backgroundOption(label);
  if (!option) throw new Error(`Missing background: ${label}`);
  await act(async () => option.click());
}

async function searchMaps(text) {
  const input = backgroundInput();
  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  await act(async () => {
    input.focus();
    setValue.call(input, text);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

const press = (target, key) =>
  act(async () => {
    const event = new window.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  });
const stripImage = () => dialog().querySelector("img[class*='StripImage']");
const mapPictures = (mission) =>
  [1, 2, 3].map((image) => ({ name: `${mission}.${image}` }));
const downloadButton = () =>
  [...dialog().querySelectorAll("footer button")].find((element) =>
    /Download|Drawing/.test(element.textContent),
  );

test("a finished photo booth opens a strip dialog that focuses download, saves the png and closes", async () => {
  // Browsers focus the first focusable element when a dialog opens, which here
  // is the close button. Download must take focus after that.
  const { HTMLDialogElement } = getEnv().window;
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
    function () {
      this.open = true;
      this.querySelector("button:not(:disabled)")?.focus();
    },
  );
  const createObjectURL = vi
    .spyOn(globalThis.URL, "createObjectURL")
    .mockReturnValue("blob:strip");
  vi.spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
  const strip = finishedStrip();
  const recorder = idleRecorder({ attached: true, strip });
  await render(recorder);
  expect(dialog().querySelector("h2").textContent).toBe("Photo strip");
  const image = dialog().querySelector("img");
  expect(createObjectURL).toHaveBeenCalledExactlyOnceWith(strip.blob);
  expect(image.getAttribute("src")).toBe("blob:strip");
  // The strip's height depends on its captions.
  expect([image.getAttribute("width"), image.getAttribute("height")]).toEqual([
    "800",
    "2009",
  ]);
  expect(image.alt).toBe(strip.alt);
  // No explanation, once the map list is in.
  await settle();
  expect(listStatus().textContent).toBe("");
  expect(dialog().querySelector("[role='alert']")).toBeNull();
  const download = [...dialog().querySelectorAll("footer button")].find(
    (element) => element.textContent === "Download",
  );
  expect(document.activeElement).toBe(download);
  await act(async () => download.click());
  expect(saveAs).toHaveBeenCalledExactlyOnceWith(strip.blob, strip.fileName);
  expect(recorder.dismissStrip).toHaveBeenCalledOnce();
});

test("retake closes the strip and starts another booth; escape discards it", async () => {
  vi.spyOn(globalThis.URL, "createObjectURL").mockReturnValue("blob:strip");
  vi.spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
  const recorder = idleRecorder({ attached: true, strip: finishedStrip() });
  await render(recorder);
  const retake = () =>
    [...dialog().querySelectorAll("footer button")].find(
      (element) => element.textContent === "Retake",
    );
  await act(async () => retake().click());
  expect(recorder.dismissStrip).toHaveBeenCalledOnce();
  expect(recorder.startBooth).toHaveBeenCalledOnce();
  await render({ ...recorder, attached: false });
  expect(retake().disabled).toBe(true);
  await act(async () =>
    dialog().dispatchEvent(
      new globalThis.Event("cancel", { cancelable: true }),
    ),
  );
  expect(recorder.dismissStrip).toHaveBeenCalledTimes(2);
});

test("the strip image url is revoked when the dialog closes", async () => {
  vi.spyOn(globalThis.URL, "createObjectURL").mockReturnValue("blob:strip");
  const revoke = vi
    .spyOn(globalThis.URL, "revokeObjectURL")
    .mockImplementation(() => {});
  const recorder = idleRecorder({ attached: true, strip: finishedStrip() });
  await render(recorder);
  expect(revoke).not.toHaveBeenCalled();
  await render({ ...recorder, strip: null });
  expect(dialog()).toBeNull();
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:strip");
});

test("the photo booth starts with the map chosen last", async () => {
  gallery.chosen = "DX_Ice";
  const recorder = idleRecorder({ attached: true });
  await render(recorder);
  await act(async () => captureButtons()[1].click());
  expect(recorder.startBooth.mock.lastCall[1]).toBe("DX_Ice");
});

test("choosing a map from the list beside the strip draws each photo over one of its screenshots", async () => {
  vi.spyOn(globalThis.URL, "createObjectURL").mockReturnValue("blob:strip");
  vi.spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
  const strip = finishedStrip();
  await render(idleRecorder({ attached: true, strip }));
  await settle();
  // Always shown, left of the strip rather than in the header.
  const list = dialog().querySelector("[role='listbox']");
  expect(dialog().querySelector("header").contains(list)).toBe(false);
  expect(
    list.compareDocumentPosition(stripImage()) &
      window.Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect([
    backgroundInput().labels[0].textContent,
    backgroundInput().getAttribute("aria-expanded"),
  ]).toEqual(["Background", "true"]);
  expect(
    document.getElementById(list.getAttribute("aria-labelledby")).textContent,
  ).toBe("Background");
  expect(optionLabels()).toEqual([
    "Default background",
    "Dangerous Crossing (Ice)",
    "Katabatic",
  ]);
  expect(chosenBackground()).toEqual(["Default background"]);
  expect(photos.renderBoothStrip).not.toHaveBeenCalled();
  await chooseBackground("Dangerous Crossing (Ice)");
  await settle();
  expect(chosenBackground()).toEqual(["Dangerous Crossing (Ice)"]);
  // The search box doesn't take the map's name, and the list stays.
  expect([backgroundInput().value, optionLabels().length]).toEqual(["", 3]);
  expect(mapBackgrounds.chooseMapBackground).toHaveBeenLastCalledWith("DX_Ice");
  expect(mapBackgrounds.loadMapPictures).toHaveBeenLastCalledWith("DX_Ice", 3);
  expect(photos.renderBoothStrip).toHaveBeenLastCalledWith(
    strip.frames,
    strip.caption,
    strip.art,
    mapPictures("DX_Ice"),
  );
  expect(stripImage().getAttribute("height")).toBe("2100");
  expect(stripImage().dataset.pending).toBeUndefined();
  // Download saves the strip as shown.
  const shown = await modelImage.canvasBlob.mock.results.at(-1).value;
  await act(async () =>
    [...dialog().querySelectorAll("footer button")]
      .find((element) => element.textContent === "Download")
      .click(),
  );
  expect(saveAs).toHaveBeenCalledExactlyOnceWith(shown, strip.fileName);
});

test("choosing the default background goes back to the gradient", async () => {
  vi.spyOn(globalThis.URL, "createObjectURL").mockReturnValue("blob:strip");
  vi.spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
  gallery.chosen = "Katabatic";
  const strip = finishedStrip({ background: "Katabatic" });
  await render(idleRecorder({ attached: true, strip }));
  await settle();
  // The booth already drew this map.
  expect(photos.renderBoothStrip).not.toHaveBeenCalled();
  expect(chosenBackground()).toEqual(["Katabatic"]);
  await chooseBackground("Default background");
  await settle();
  expect(mapBackgrounds.chooseMapBackground).toHaveBeenLastCalledWith(null);
  expect(photos.renderBoothStrip).toHaveBeenLastCalledWith(
    strip.frames,
    strip.caption,
    strip.art,
    [],
  );
});

test("a strip the booth drew without the chosen map is drawn again with it", async () => {
  vi.spyOn(globalThis.URL, "createObjectURL").mockReturnValue("blob:strip");
  vi.spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
  gallery.chosen = "DX_Ice";
  let loaded;
  mapBackgrounds.loadMapPictures.mockReturnValueOnce(
    new Promise((resolve) => {
      loaded = resolve;
    }),
  );
  const strip = finishedStrip();
  await render(idleRecorder({ attached: true, strip }));
  await settle();
  expect(stripImage().dataset.pending).toBe("true");
  expect(photos.renderBoothStrip).not.toHaveBeenCalled();
  loaded(mapPictures("DX_Ice"));
  await settle();
  expect(photos.renderBoothStrip).toHaveBeenCalledExactlyOnceWith(
    strip.frames,
    strip.caption,
    strip.art,
    mapPictures("DX_Ice"),
  );
  expect(stripImage().dataset.pending).toBeUndefined();
});

test("download waits while the strip is drawn over a newly chosen map", async () => {
  vi.spyOn(globalThis.URL, "createObjectURL").mockReturnValue("blob:strip");
  vi.spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
  const strip = finishedStrip();
  await render(idleRecorder({ attached: true, strip }));
  await settle();
  let loaded;
  mapBackgrounds.loadMapPictures.mockReturnValueOnce(
    new Promise((resolve) => {
      loaded = resolve;
    }),
  );
  await chooseBackground("Dangerous Crossing (Ice)");
  await settle();
  expect([
    downloadButton().textContent,
    downloadButton().getAttribute("aria-disabled"),
  ]).toEqual(["Drawing…", "true"]);
  await act(async () => downloadButton().click());
  expect(saveAs).not.toHaveBeenCalled();
  loaded(mapPictures("DX_Ice"));
  await settle();
  expect([
    downloadButton().textContent,
    downloadButton().getAttribute("aria-disabled"),
  ]).toEqual(["Download", null]);
  await act(async () => downloadButton().click());
  expect(saveAs).toHaveBeenCalledExactlyOnceWith(
    await modelImage.canvasBlob.mock.results.at(-1).value,
    strip.fileName,
  );
});

test("a map whose screenshots don't load is named, and the choice goes back to the strip shown", async () => {
  vi.spyOn(globalThis.URL, "createObjectURL").mockReturnValue("blob:strip");
  vi.spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
  mapBackgrounds.loadMapPictures.mockResolvedValueOnce([]);
  const strip = finishedStrip();
  await render(idleRecorder({ attached: true, strip }));
  await settle();
  await chooseBackground("Dangerous Crossing (Ice)");
  await settle();
  expect(dialog().querySelector("[role='alert']").textContent).toBe(
    "Dangerous Crossing (Ice)'s screenshots couldn't load.",
  );
  expect(chosenBackground()).toEqual(["Default background"]);
  expect(mapBackgrounds.chooseMapBackground).toHaveBeenLastCalledWith(null);
  expect(photos.renderBoothStrip).not.toHaveBeenCalled();
  expect(downloadButton().getAttribute("aria-disabled")).toBeNull();
  // Choosing it again tries again.
  await chooseBackground("Dangerous Crossing (Ice)");
  await settle();
  expect(dialog().querySelector("[role='alert']")).toBeNull();
  expect(photos.renderBoothStrip).toHaveBeenLastCalledWith(
    strip.frames,
    strip.caption,
    strip.art,
    mapPictures("DX_Ice"),
  );
});

test("while the map list loads, only the default background is listed", async () => {
  vi.spyOn(globalThis.URL, "createObjectURL").mockReturnValue("blob:strip");
  vi.spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
  gallery.maps = new Promise(() => {});
  await render(idleRecorder({ attached: true, strip: finishedStrip() }));
  await settle();
  expect(optionLabels()).toEqual(["Default background"]);
  expect(listStatus().textContent).toBe("Loading maps…");
});

test("a map list that can't load says so in the same live region and can be tried again", async () => {
  vi.spyOn(globalThis.URL, "createObjectURL").mockReturnValue("blob:strip");
  vi.spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
  showSearchBox();
  const maps = await gallery.maps;
  gallery.maps = Promise.reject(new Error("offline"));
  gallery.maps.catch(() => {});
  await render(idleRecorder({ attached: true, strip: finishedStrip() }));
  // Screen readers only hear a live region change that was already there.
  const status = listStatus();
  await settle();
  expect(listStatus()).toBe(status);
  expect(status.textContent).toBe("The map list couldn't load. Try again");
  expect(optionLabels()).toEqual(["Default background"]);
  let loaded;
  gallery.maps = new Promise((resolve) => {
    loaded = resolve;
  });
  tryAgainButton().focus();
  await act(async () => tryAgainButton().click());
  await settle();
  expect(mapBackgrounds.loadMaps).toHaveBeenCalledTimes(2);
  expect([status.textContent, tryAgainButton()]).toEqual([
    "Loading maps…",
    undefined,
  ]);
  // The button is gone, so focus goes to the search box rather than the page.
  expect(document.activeElement).toBe(backgroundInput());
  loaded(maps);
  await settle();
  expect(mapBackgrounds.chooseMapBackground).not.toHaveBeenCalled();
  expect(optionLabels()).toEqual([
    "Default background",
    "Dangerous Crossing (Ice)",
    "Katabatic",
  ]);
  expect(listStatus()).toBe(status);
  expect(status.textContent).toBe("");
});

test("the search box narrows the list by name, Enter chooses the first match, and Escape clears the search before closing", async () => {
  vi.spyOn(globalThis.URL, "createObjectURL").mockReturnValue("blob:strip");
  vi.spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
  const recorder = idleRecorder({ attached: true, strip: finishedStrip() });
  await render(recorder);
  await settle();
  expect(backgroundInput().placeholder).toBe("Search maps…");
  await searchMaps("crossing");
  expect(optionLabels()).toEqual(["Dangerous Crossing (Ice)"]);
  await press(backgroundInput(), "Enter");
  await settle();
  expect(mapBackgrounds.chooseMapBackground).toHaveBeenCalledExactlyOnceWith(
    "DX_Ice",
  );
  expect(chosenBackground()).toEqual(["Dangerous Crossing (Ice)"]);
  // What was typed stays.
  expect(backgroundInput().value).toBe("crossing");
  // Mission names aren't searched.
  await searchMaps("dx_ice");
  expect(optionLabels()).toEqual([]);
  expect(listStatus().textContent).toBe("No matches");
  await searchMaps("kat");
  expect(activeBackground()).toBe("Katabatic");
  // A canceled Escape keydown isn't a request to close the dialog.
  expect((await press(backgroundInput(), "Escape")).defaultPrevented).toBe(
    true,
  );
  expect([backgroundInput().value, optionLabels().length]).toEqual(["", 3]);
  // The map that matched isn't left active, where Enter would choose it.
  expect(activeBackground()).toBeNull();
  await press(backgroundInput(), "Enter");
  await settle();
  expect(mapBackgrounds.chooseMapBackground).toHaveBeenCalledOnce();
  expect((await press(backgroundInput(), "Escape")).defaultPrevented).toBe(
    false,
  );
  expect(recorder.dismissStrip).not.toHaveBeenCalled();
  // The arrow keys start at the chosen map again.
  expect((await press(backgroundInput(), "ArrowDown")).defaultPrevented).toBe(
    true,
  );
  expect(activeBackground()).toBe("Dangerous Crossing (Ice)");
});

test("an arrow key pressed before the full list is back from Escape waits for it, then moves to the chosen map", async () => {
  vi.spyOn(globalThis.URL, "createObjectURL").mockReturnValue("blob:strip");
  vi.spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
  showSearchBox();
  await render(idleRecorder({ attached: true, strip: finishedStrip() }));
  await settle();
  await chooseBackground("Dangerous Crossing (Ice)");
  await settle();
  await searchMaps("kat");
  expect(optionLabels()).toEqual(["Katabatic"]);
  // Outside act(), React shows the cleared search box at once and brings the
  // full list back later, as in a browser.
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    const input = backgroundInput();
    const key = (name) => {
      const event = new window.KeyboardEvent("keydown", {
        key: name,
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(event);
      return event;
    };
    key("Escape");
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect([input.value, optionLabels()]).toEqual(["", ["Katabatic"]]);
    expect(key("ArrowDown").defaultPrevented).toBe(true);
    expect(activeBackground()).toBeNull();
    await vi.waitFor(() =>
      expect(activeBackground()).toBe("Dangerous Crossing (Ice)"),
    );
    expect(optionLabels()).toHaveLength(3);
  } finally {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  }
});

test("typing after such an early arrow key leaves the first match active, not the chosen map", async () => {
  vi.spyOn(globalThis.URL, "createObjectURL").mockReturnValue("blob:strip");
  vi.spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
  showSearchBox();
  await render(idleRecorder({ attached: true, strip: finishedStrip() }));
  await settle();
  await chooseBackground("Katabatic");
  await settle();
  await searchMaps("dan");
  expect(optionLabels()).not.toContain("Katabatic");
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    const input = backgroundInput();
    const key = (name) => {
      const event = new window.KeyboardEvent("keydown", {
        key: name,
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(event);
      return event;
    };
    key("Escape");
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(key("ArrowDown").defaultPrevented).toBe(true);
    const setValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setValue.call(input, "a");
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await vi.waitFor(() =>
      expect(optionLabels()).toEqual([
        "Default background",
        "Dangerous Crossing (Ice)",
        "Katabatic",
      ]),
    );
    await vi.waitFor(() =>
      expect(activeBackground()).toBe("Default background"),
    );
    // setTimeout is faked here; React's scheduler uses setImmediate.
    for (let i = 0; i < 5; i++)
      await new Promise((resolve) => globalThis.setImmediate(resolve));
    expect(activeBackground()).toBe("Default background");
  } finally {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  }
});

test("focusing the search box starts the arrow keys at the chosen map, which the box's description names", async () => {
  vi.spyOn(globalThis.URL, "createObjectURL").mockReturnValue("blob:strip");
  vi.spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
  showSearchBox();
  await render(idleRecorder({ attached: true, strip: finishedStrip() }));
  await settle();
  const input = backgroundInput();
  const description = () =>
    document.getElementById(input.getAttribute("aria-describedby")).textContent;
  expect(description()).toBe("Default background");
  await chooseBackground("Dangerous Crossing (Ice)");
  await settle();
  expect(description()).toBe("Dangerous Crossing (Ice)");
  expect(activeBackground()).toBeNull();
  await act(async () => input.focus());
  expect(activeBackground()).toBe("Dangerous Crossing (Ice)");
  expect(document.activeElement).toBe(input);
  await press(input, "ArrowDown");
  expect(activeBackground()).toBe("Katabatic");
});

test("the arrow keys move from a clicked map, not the one chosen before", async () => {
  vi.spyOn(globalThis.URL, "createObjectURL").mockReturnValue("blob:strip");
  vi.spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
  showSearchBox();
  await render(idleRecorder({ attached: true, strip: finishedStrip() }));
  await settle();
  expect(document.activeElement).toBe(downloadButton());
  // A mouse press focuses the map, which hands focus to the search box before
  // the click chooses it.
  const option = backgroundOption("Dangerous Crossing (Ice)");
  await act(async () => option.focus());
  await act(async () => option.click());
  await settle();
  expect(document.activeElement).toBe(backgroundInput());
  expect(activeBackground()).toBe("Dangerous Crossing (Ice)");
  await press(backgroundInput(), "ArrowDown");
  expect(activeBackground()).toBe("Katabatic");
});

/** A pointerdown from a finger, a pen or a mouse: jsdom has no PointerEvent. */
function pointerDown(target, pointerType) {
  const event = new window.MouseEvent("pointerdown", { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  target.dispatchEvent(event);
}

test("a tap on a map chooses it without focusing it, which would open the on-screen keyboard", async () => {
  vi.spyOn(globalThis.URL, "createObjectURL").mockReturnValue("blob:strip");
  vi.spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
  await render(idleRecorder({ attached: true, strip: finishedStrip() }));
  await settle();
  // A tap's mouse events come after its pointer events. Canceling the
  // mousedown keeps focus where it was.
  const tap = (label, pointerType) =>
    act(async () => {
      const option = backgroundOption(label);
      pointerDown(option, pointerType);
      const mousedown = new window.MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      option.dispatchEvent(mousedown);
      option.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      return mousedown;
    });
  expect((await tap("Katabatic", "touch")).defaultPrevented).toBe(true);
  await settle();
  expect(chosenBackground()).toEqual(["Katabatic"]);
  // Active, as a click would make it.
  expect(activeBackground()).toBe("Katabatic");
  expect((await tap("Default background", "pen")).defaultPrevented).toBe(true);
  await settle();
  expect(chosenBackground()).toEqual(["Default background"]);
  expect(
    (await tap("Dangerous Crossing (Ice)", "mouse")).defaultPrevented,
  ).toBe(false);
  await settle();
  expect(chosenBackground()).toEqual(["Dangerous Crossing (Ice)"]);
});

test("try again moves focus to the search box, except after a tap, where that would open the on-screen keyboard", async () => {
  vi.spyOn(globalThis.URL, "createObjectURL").mockReturnValue("blob:strip");
  vi.spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
  showSearchBox();
  gallery.maps = Promise.reject(new Error("offline"));
  gallery.maps.catch(() => {});
  await render(idleRecorder({ attached: true, strip: finishedStrip() }));
  await settle();
  let fail;
  gallery.maps = new Promise((resolve, reject) => {
    fail = reject;
  });
  await act(async () => {
    const button = tryAgainButton();
    pointerDown(button, "touch");
    button.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, detail: 1 }),
    );
  });
  await settle();
  expect(mapBackgrounds.loadMaps).toHaveBeenCalledTimes(2);
  expect(listStatus().textContent).toBe("Loading maps…");
  expect(document.activeElement).not.toBe(backgroundInput());
  // Pressed with a key, it moves focus, whatever the last press was.
  fail(new Error("offline"));
  await settle();
  gallery.maps = new Promise(() => {});
  await act(async () =>
    tryAgainButton().dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, detail: 0 }),
    ),
  );
  await settle();
  expect(mapBackgrounds.loadMaps).toHaveBeenCalledTimes(3);
  expect(document.activeElement).toBe(backgroundInput());
});

/** Lays out the map list `layout.height` px tall, with 30 px items from its
 * top: jsdom has no layout. */
function layOutBackgrounds(layout) {
  const getBoundingClientRect = window.Element.prototype.getBoundingClientRect;
  vi.spyOn(window.Element.prototype, "clientHeight", "get").mockImplementation(
    function () {
      return this.getAttribute("role") === "listbox" ? layout.height : 0;
    },
  );
  vi.spyOn(
    window.Element.prototype,
    "getBoundingClientRect",
  ).mockImplementation(function () {
    if (this.getAttribute("role") !== "option")
      return getBoundingClientRect.call(this);
    const top =
      [...this.parentElement.children].indexOf(this) * 30 -
      this.parentElement.scrollTop;
    return { top, bottom: top + 30, left: 0, right: 0, width: 0, height: 30 };
  });
}

test("a map list loaded before the strip has its size centers the chosen map once it has a height", async () => {
  vi.spyOn(globalThis.URL, "createObjectURL").mockReturnValue("blob:strip");
  vi.spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
  // The list loaded for an earlier strip, and this one's image hasn't loaded.
  gallery.chosen = "Katabatic";
  const layout = { height: 0 };
  layOutBackgrounds(layout);
  const recorder = idleRecorder({
    attached: true,
    strip: finishedStrip({ background: "Katabatic" }),
  });
  await render(recorder);
  await settle();
  const list = dialog().querySelector("[role='listbox']");
  expect(optionLabels()).toEqual([
    "Default background",
    "Dangerous Crossing (Ice)",
    "Katabatic",
  ]);
  await resize();
  expect(list.scrollTop).toBe(0);
  layout.height = 40;
  await resize();
  // Katabatic's top, 60 px down, less half the list (jsdom's items have no
  // offsetHeight).
  expect(list.scrollTop).toBe(40);
  // Only the once: after that the user may have scrolled.
  expect(watching()).toEqual([]);
  // So does closing the dialog before the list has a height.
  await render({ ...recorder, strip: null });
  layout.height = 0;
  await render(recorder);
  await settle();
  expect(watching()).toHaveLength(1);
  await render({ ...recorder, strip: null });
  expect(watching()).toEqual([]);
});

test("the chosen map is centered at once in a list that has its height, but not after the user typed or scrolled", async () => {
  vi.spyOn(globalThis.URL, "createObjectURL").mockReturnValue("blob:strip");
  vi.spyOn(globalThis.URL, "revokeObjectURL").mockImplementation(() => {});
  gallery.chosen = "Katabatic";
  const layout = { height: 40 };
  layOutBackgrounds(layout);
  const recorder = idleRecorder({
    attached: true,
    strip: finishedStrip({ background: "Katabatic" }),
  });
  const list = () => dialog().querySelector("[role='listbox']");
  const reopenWithoutHeight = async () => {
    await render({ ...recorder, strip: null });
    layout.height = 0;
    await render(recorder);
    await settle();
  };
  await render(recorder);
  await settle();
  expect(list().scrollTop).toBe(40);
  await reopenWithoutHeight();
  await searchMaps("kat");
  layout.height = 40;
  await resize();
  expect(list().scrollTop).toBe(0);
  await reopenWithoutHeight();
  list().scrollTop = 10;
  layout.height = 40;
  await resize();
  expect(list().scrollTop).toBe(10);
});

test("photo strips are named after the skin shown in the skin dropdown and the model", async () => {
  const recorder = idleRecorder({ attached: true });
  fixture.warrior = {
    selectedSkin: "__untitled__",
    selectedSkinType: "import",
    selectedModel: "hfemale",
    selectedModelType: "player",
  };
  await render(recorder);
  await act(async () => captureButtons()[1].click());
  expect(recorder.startBooth.mock.lastCall[0]).toMatchObject({
    caption: {
      skin: "Untitled Imported Skin",
      model: "Human Female",
      armor: "Heavy armor",
    },
    fileName:
      "Untitled Imported Skin - hfemale - Photo strip - 2026-10-20 14-03-05.png",
  });
});

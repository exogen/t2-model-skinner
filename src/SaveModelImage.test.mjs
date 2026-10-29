import { afterEach, beforeEach, expect, test, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { getEnv } from "fabric";
import { saveAs } from "file-saver";
import SaveModelImage from "./SaveModelImage";
import { exportModelImage } from "./modelImage";
import { ViewerContext } from "./useViewer";

const fixture = vi.hoisted(() => ({ warrior: null, mocap: null }));
vi.mock("./useWarrior", () => ({ default: () => fixture.warrior }));
vi.mock("./MocapProvider", () => ({ useMocap: () => fixture.mocap }));
vi.mock("file-saver", () => ({ saveAs: vi.fn() }));
vi.mock("./modelImage", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, exportModelImage: vi.fn(actual.exportModelImage) };
});

const { document } = getEnv();
let root;
let host;
let encode;

/** A transparent frame with an opaque block where the model is. */
function frame(
  width = 40,
  height = 30,
  model = { x: 10, y: 5, width: 10, height: 12 },
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  if (model) {
    const context = canvas.getContext("2d");
    const image = context.createImageData(model.width, model.height);
    image.data.fill(255);
    context.putImageData(image, model.x, model.y);
  }
  return canvas;
}

async function render(viewer) {
  await act(async () =>
    root.render(
      React.createElement(
        ViewerContext.Provider,
        { value: { viewer, setViewer: vi.fn() } },
        React.createElement(SaveModelImage),
      ),
    ),
  );
}

const button = () => host.querySelector("button[aria-label='Save image']");
const alert = () => document.body.querySelector("dialog[open] [role='alert']");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 20, 14, 3, 5));
  encode = vi
    .spyOn(document.createElement("canvas").constructor.prototype, "toBlob")
    .mockImplementation((callback, type) =>
      callback(new globalThis.Blob(["image"], { type })),
    );
  fixture.warrior = {
    selectedSkin: "Beagle",
    selectedSkinType: "default",
    selectedModel: "lmale",
    selectedModelType: "player",
  };
  fixture.mocap = { tracking: null };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

test("save image waits for a loaded model", async () => {
  await render(null);
  expect(button().disabled).toBe(true);
  expect(button().title).toBe("Save image");
  await render({ captureFrame: vi.fn() });
  expect(button().disabled).toBe(false);
});

test("save image downloads the drawn model without a background, cut to the model", async () => {
  const viewer = { captureFrame: vi.fn(async () => frame()) };
  await render(viewer);
  await act(async () => button().click());
  expect(viewer.captureFrame).toHaveBeenCalledExactlyOnceWith({
    background: false,
  });
  expect(exportModelImage).toHaveBeenCalledExactlyOnceWith(viewer);
  expect([
    encode.mock.contexts[0].width,
    encode.mock.contexts[0].height,
  ]).toEqual([10 + 16, 12 + 16]);
  const blob = await exportModelImage.mock.results[0].value;
  expect(saveAs).toHaveBeenCalledExactlyOnceWith(
    blob,
    "Beagle - lmale - 2026-10-20 14-03-05.png",
  );
  // Each click saves the frame drawn after it.
  await act(async () => button().click());
  expect(viewer.captureFrame).toHaveBeenCalledTimes(2);
  expect(saveAs).toHaveBeenCalledTimes(2);
});

test("weapons and vehicles with their stock skin are named the way the skin dropdown names it", async () => {
  fixture.warrior = {
    selectedSkin: "weapon_disc",
    selectedSkinType: "default",
    selectedModel: "disc",
    selectedModelType: "weapon",
  };
  await render({ captureFrame: vi.fn(async () => frame()) });
  await act(async () => button().click());
  expect(saveAs.mock.lastCall[1]).toBe(
    "Default - disc - 2026-10-20 14-03-05.png",
  );
});

test("an image saved during playback is named after the recording or pose", async () => {
  fixture.mocap = { tracking: { recorder: { selected: { label: "Pose 2" } } } };
  fixture.warrior = {
    selectedSkin: "__untitled__",
    selectedSkinType: "import",
    selectedModel: "hfemale",
    selectedModelType: "player",
  };
  await render({ captureFrame: vi.fn(async () => frame()) });
  await act(async () => button().click());
  expect(saveAs.mock.lastCall[1]).toBe(
    "Untitled Imported Skin - hfemale - Pose 2 - 2026-10-20 14-03-05.png",
  );
});

test("save image ignores clicks while saving and reports failures", async () => {
  const pending = Promise.withResolvers();
  const viewer = { captureFrame: vi.fn(() => pending.promise) };
  await render(viewer);
  await act(async () => {
    button().click();
    button().click();
  });
  expect(viewer.captureFrame).toHaveBeenCalledOnce();
  await act(async () => pending.reject(new Error("The 3D view has closed.")));
  expect(saveAs).not.toHaveBeenCalled();
  expect(alert().textContent).toBe("The image could not be saved. Try again.");
  await act(async () =>
    document.body.querySelector("dialog[open] footer button").click(),
  );
  viewer.captureFrame.mockResolvedValueOnce(frame());
  await act(async () => button().click());
  expect(saveAs).toHaveBeenCalledOnce();
});

test("a frame without the model in it is not saved", async () => {
  const viewer = { captureFrame: vi.fn(async () => frame(40, 30, null)) };
  await render(viewer);
  await act(async () => button().click());
  expect(saveAs).not.toHaveBeenCalled();
  expect(alert().textContent).toBe(
    "The model is out of view, so there is nothing to save.",
  );
  await act(async () =>
    document.body.querySelector("dialog[open] footer button").click(),
  );
  viewer.captureFrame.mockResolvedValueOnce(frame());
  await act(async () => button().click());
  expect(saveAs).toHaveBeenCalledOnce();
});

import { afterEach, expect, test, vi } from "vitest";
import { createCaptureApi } from "./CaptureAutomation";
import { captureActivity } from "./captureActivity";
import { exportModelImage } from "./modelImage";

vi.mock("./modelImage", async (original) => ({
  ...(await original()),
  exportModelImage: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

function harness() {
  const warrior = {
    selectedModel: "lmale",
    actualModel: "lmale",
    selectedSkin: "Example",
    selectedSkinType: "import",
    setSelectedAnimation: vi.fn(),
    setAnimationPaused: vi.fn(),
    setSelectedSkinType: vi.fn(),
    setSelectedSkin: vi.fn(),
    setSelectedModel: vi.fn(),
  };
  let angle = 17;
  const getCaptureCamera = () => ({ width: 680, height: 800, theta: angle });
  const viewer = {
    animationSettled: true,
    getCaptureCamera,
    setCaptureCamera: vi.fn((options) => {
      if (options?.orbit) angle = Number.parseFloat(options.orbit);
      return getCaptureCamera();
    }),
    captureFrame: vi.fn(),
  };
  const live = {
    current: {
      warrior,
      viewer,
      canvases: { color: { status: "ready" }, metallic: { status: "ready" } },
      editor: { isResolvingSize: false },
      skin: {
        getSkinImages: () => ({
          colorImageUrl: ["color"],
          metallicImageUrl: ["metallic"],
        }),
      },
      environment: { setHeldWeapon: vi.fn() },
    },
  };
  let closed = false;
  return {
    warrior,
    viewer,
    api: createCaptureApi(42, live, () => closed),
    close: () => {
      closed = true;
    },
  };
}

test("model selection accepts the heavy female alias and resets the skin and animation", () => {
  const { api, warrior } = harness();
  api.selectModel("hfemale");
  expect(warrior.setSelectedModel).toHaveBeenCalledWith("hfemale");
  expect(warrior.setSelectedSkin).toHaveBeenCalledWith("Blood Eagle");
  expect(warrior.setSelectedAnimation).toHaveBeenCalledWith(null);
  expect(() => api.selectModel("unknown")).toThrow("Unknown model");
});

test("readiness waits for preview work which finishes after canvases become ready", async () => {
  const { api } = harness();
  const task = captureActivity.register("metallic preview");
  task.update(1);
  try {
    expect(api.getState().ready).toBe(false);
    const ready = api.whenReady({ revision: 42, model: "lmale" });
    task.update(0);
    expect((await ready).ready).toBe(true);
  } finally {
    task.dispose();
  }
});

test("failed assets reject an export and a changed session cannot capture", async () => {
  const { api, viewer, close } = harness();
  const task = captureActivity.register("texture");
  task.update(0, new Error("decode failed"));
  try {
    await expect(api.exportImage()).rejects.toThrow("decode failed");
  } finally {
    task.dispose();
  }
  await expect(api.exportImage({ revision: 41 })).rejects.toThrow(
    "selection changed",
  );
  const pending = api.exportImage({ revision: 42 });
  close();
  await expect(pending).rejects.toThrow("selection changed");
  expect(viewer.captureFrame).not.toHaveBeenCalled();
});

test("concurrent exports keep their requested camera until each image is encoded", async () => {
  const { api, viewer } = harness();
  const frame = Promise.withResolvers();
  exportModelImage.mockImplementation(async () => {
    await frame.promise;
    return new globalThis.Blob([String(viewer.getCaptureCamera().theta)]);
  });
  const first = api.exportImage({ camera: { orbit: "0deg 75deg 105%" } });
  const second = api.exportImage({ camera: { orbit: "90deg 75deg 105%" } });
  await vi.waitFor(() => expect(exportModelImage).toHaveBeenCalledOnce());
  expect(viewer.setCaptureCamera).toHaveBeenCalledTimes(1);
  frame.resolve();
  const images = await Promise.all([first, second]);
  expect(images.map((image) => image.camera.theta)).toEqual([0, 90]);
  expect(images[0].dataUrl).not.toBe(images[1].dataUrl);
});

test("camera changes wait for an active export", async () => {
  const { api, viewer } = harness();
  const frame = Promise.withResolvers();
  exportModelImage.mockImplementation(async () => {
    await frame.promise;
    return new globalThis.Blob(["image"]);
  });
  const image = api.exportImage({ camera: { orbit: "37deg 75deg 105%" } });
  await vi.waitFor(() => expect(exportModelImage).toHaveBeenCalledOnce());
  const camera = api.setCamera({ orbit: "90deg 75deg 105%" });
  expect(viewer.setCaptureCamera).toHaveBeenCalledTimes(1);
  frame.resolve();
  expect((await image).camera.theta).toBe(37);
  expect((await camera).theta).toBe(90);
});

test("a failed export releases the camera for subsequent requests", async () => {
  const { api } = harness();
  exportModelImage.mockRejectedValueOnce(new Error("encoding failed"));
  exportModelImage.mockResolvedValueOnce(new globalThis.Blob(["next image"]));
  const first = api.exportImage();
  const next = api.exportImage();
  await expect(first).rejects.toThrow("encoding failed");
  await expect(next).resolves.toHaveProperty("dataUrl");
});

test("an export without camera overrides preserves the current view", async () => {
  const { api, viewer } = harness();
  exportModelImage.mockResolvedValueOnce(new globalThis.Blob(["image"]));
  expect((await api.exportImage()).camera.theta).toBe(17);
  expect(viewer.setCaptureCamera).not.toHaveBeenCalled();
});

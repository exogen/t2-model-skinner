import { expect, test, vi } from "vitest";
import { createCaptureApi } from "./CaptureAutomation";
import { captureActivity } from "./captureActivity";

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
  const viewer = {
    animationSettled: true,
    getCaptureCamera: () => ({ width: 680, height: 800 }),
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

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { getEnv } from "fabric";
import HeldWeapon from "./HeldWeapon";
import { captureActivity } from "./captureActivity";

const fixture = vi.hoisted(() => ({}));
vi.mock("./useModelViewer", () => ({ default: () => fixture.modelViewer }));
vi.mock("./useWarrior", () => ({ default: () => fixture.warrior }));
vi.mock("./useSettings", () => ({ default: () => ({ basePath: "" }) }));
vi.mock("./useImageLoader", () => ({
  default: () => ({ loadImage: fixture.loadImage }),
}));
vi.mock("./useImageWorker", () => ({ default: () => fixture.worker }));
vi.mock("./armPoses", () => ({
  loadArmPoses: (...args) => fixture.loadArmPoses(...args),
}));
vi.mock("./materialBinding", () => ({
  createMaterialBinding: () => {
    const binding = {
      setSlowMode: vi.fn(),
      setTextures: vi.fn(),
      clearTextures: vi.fn(),
      dispose: vi.fn(),
    };
    fixture.bindings.push(binding);
    return binding;
  },
}));

let root, host;
const mounted = () => ({ materials: [[]], scene: {} });
const state = () => captureActivity.snapshot();
async function render(weapon = "disc") {
  await act(async () =>
    root.render(React.createElement(HeldWeapon, { weapon, skin: null })),
  );
}

beforeEach(() => {
  fixture.model = Promise.withResolvers();
  fixture.image = Promise.withResolvers();
  fixture.pose = Promise.withResolvers();
  fixture.bindings = [];
  fixture.modelViewer = {
    scene: {},
    viewer: {
      mount: vi.fn(() => fixture.model.promise),
      unmount: vi.fn(),
      setArmPose: vi.fn(),
    },
  };
  fixture.warrior = {
    actualModel: "lmale",
    slowModeEnabled: false,
    importedSkins: new Map(),
  };
  fixture.loadImage = vi.fn(() => fixture.image.promise);
  fixture.loadArmPoses = vi.fn(() => fixture.pose.promise);
  fixture.worker = {
    removeAlphaFromArrayBuffer: vi.fn(async () => "color"),
    convertArrayBufferAlphaToGrayscale: vi.fn(async () => "gray"),
    convertGrayscaleImageUrlToMetallicRoughness: vi.fn(async () => "packed"),
  };
  vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
  host = getEnv().document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  expect(state().pending).toBe(0);
  expect(state().errors).toEqual([]);
});

test("capture waits for both the held model and its converted textures", async () => {
  await render();
  expect(state().pending).toBe(1);
  await act(async () => fixture.model.resolve(mounted()));
  expect(fixture.loadImage).toHaveBeenCalled();
  expect(state().pending).toBe(1);
  await act(async () => fixture.image.resolve(new ArrayBuffer(8)));
  expect(state().pending).toBe(0);
  expect(fixture.bindings[0].setTextures).toHaveBeenCalledWith({
    colorUrls: ["color"],
    metallicUrls: ["packed"],
    fallbackUrl: "/white.png",
  });
});

test("held model failures reject readiness until the weapon is removed", async () => {
  await render();
  await act(async () => fixture.model.reject(new Error("model failed")));
  expect(state().errors).toEqual(["Held weapon disc: model failed"]);
});

test("failed weapon textures remain a capture error", async () => {
  fixture.image.reject(new Error("texture failed"));
  // Keep the rejection observed before the model starts requesting the image.
  fixture.image.promise.catch(() => {});
  await render();
  await act(async () => fixture.model.resolve(mounted()));
  expect(state().errors).toEqual(["Held weapon skin disc: texture failed"]);
});

test("removing a pending weapon disposes its tracking and any late model", async () => {
  await render();
  const part = mounted();
  await act(async () => root.unmount());
  root = null;
  expect(state().pending).toBe(0);
  await act(async () => fixture.model.resolve(part));
  expect(fixture.modelViewer.viewer.unmount).toHaveBeenCalledWith(part);
});

test("capture waits for the held weapon's arm pose", async () => {
  fixture.image.resolve(new ArrayBuffer(8));
  await render("sniper");
  await act(async () => fixture.model.resolve(mounted()));
  expect(state().pending).toBe(1);
  const pose = {};
  await act(async () => fixture.pose.resolve(new Map([["Looksn", pose]])));
  expect(fixture.modelViewer.viewer.setArmPose).toHaveBeenCalledWith(pose);
  expect(state().pending).toBe(0);
});

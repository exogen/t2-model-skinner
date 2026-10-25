import { afterEach, expect, test, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { getEnv } from "fabric";
import { Group } from "three";
import WarriorViewer from "./WarriorViewer";
import ViewerProvider from "./ViewerProvider";

const fixture = vi.hoisted(() => ({ viewer: null, warrior: null }));
vi.mock("./Viewer", async (importOriginal) => ({
  ...await importOriginal(),
  default: class { constructor() { return fixture.viewer; } },
}));
vi.mock("./useWarrior", () => ({ default: () => fixture.warrior }));
vi.mock("./useEnvironment", () => ({
  default: () => ({ environmentImageUrl: null, showEnvironment: false, exposure: 1, renderMode: "skin" }),
}));
vi.mock("./MocapProvider", () => ({ useMocap: () => ({ active: false, runtime: null }), LiveMocapPose: () => null }));
vi.mock("./Materials", () => ({ default: () => null }));

const { document } = getEnv();
let root;
let host;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  root = host = undefined;
});

function fakeViewer() {
  return {
    load: vi.fn(async () => ({ scene: new Group(), model: { materials: [] }, rig: null })),
    cancelLoad: vi.fn(), setAnimation: vi.fn(), setPoseMode: vi.fn(), setExposure: vi.fn(), setRenderMode: vi.fn(),
    setEnvironment: vi.fn(async () => {}), setBackgroundVisible: vi.fn(), dispose: vi.fn(),
  };
}

test.each([
  ["lmale", "player", false], ["disc", "weapon", true], ["vehicle_air_scout", "vehicle", true],
])("with no animation chosen, %s (a %s) plays its first clip: %s", async (model, type, playFirstClip) => {
  fixture.viewer = fakeViewer();
  fixture.warrior = {
    selectedModel: model, selectedModelUrl: `/${model}.glb`, selectedModelType: type,
    selectedAnimation: null, animationPaused: false, slowModeEnabled: false,
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(ViewerProvider, null, React.createElement(WarriorViewer))));
  expect(fixture.viewer.load).toHaveBeenCalledOnce();
  expect(fixture.viewer.setAnimation).toHaveBeenLastCalledWith(null, false, 0.5, playFirstClip);
});

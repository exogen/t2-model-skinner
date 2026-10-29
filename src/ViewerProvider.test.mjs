import { afterEach, beforeEach, expect, test, vi } from "vitest";
import React, { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { getEnv } from "fabric";
import { Group } from "three";
import ViewerProvider from "./ViewerProvider";
import useViewer from "./useViewer";
import WarriorViewer from "./WarriorViewer";

const fixture = vi.hoisted(() => ({ viewer: null, warrior: null }));
vi.mock("./Viewer", async (importOriginal) => ({
  ...(await importOriginal()),
  default: class {
    constructor() {
      return fixture.viewer;
    }
  },
}));
vi.mock("./useWarrior", () => ({ default: () => fixture.warrior }));
vi.mock("./useEnvironment", () => ({
  default: () => ({
    environmentImageUrl: null,
    showEnvironment: false,
    exposure: 1,
    renderMode: "skin",
  }),
}));
vi.mock("./MocapProvider", () => ({
  useMocap: () => ({ active: false, runtime: null }),
  LiveMocapPose: () => null,
}));
vi.mock("./Materials", () => ({ default: () => null }));

const { document } = getEnv();
let root;
let host;
let shared;

function Toolbar() {
  const { viewer } = useViewer();
  useLayoutEffect(() => {
    shared = viewer;
  }, [viewer]);
  return null;
}

async function render(model) {
  fixture.warrior = {
    selectedModel: model,
    selectedModelUrl: `/${model}.glb`,
    selectedModelType: "player",
    selectedAnimation: null,
    animationPaused: false,
    slowModeEnabled: false,
  };
  await act(async () =>
    root.render(
      React.createElement(
        ViewerProvider,
        null,
        React.createElement(Toolbar),
        React.createElement(WarriorViewer),
      ),
    ),
  );
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  shared = undefined;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

test("controls outside the model viewer get the viewer only while a model is loaded", async () => {
  const loads = [];
  const viewer = (fixture.viewer = {
    load: vi.fn(() => {
      const load = Promise.withResolvers();
      loads.push(load);
      return load.promise;
    }),
    cancelLoad: vi.fn(),
    setAnimation: vi.fn(),
    setPoseMode: vi.fn(),
    setExposure: vi.fn(),
    setRenderMode: vi.fn(),
    setEnvironment: vi.fn(async () => {}),
    setBackgroundVisible: vi.fn(),
    dispose: vi.fn(),
  });
  const finishLoad = () =>
    act(async () =>
      loads
        .at(-1)
        .resolve({ scene: new Group(), model: { materials: [] }, rig: null }),
    );
  await render("lmale");
  expect(shared).toBeNull();
  await finishLoad();
  expect(shared).toBe(viewer);
  // The viewer isn't shared while the next model loads.
  await render("hbioderm");
  expect(shared).toBeNull();
  await finishLoad();
  expect(shared).toBe(viewer);
  // Closing the view takes it back.
  await act(async () =>
    root.render(
      React.createElement(ViewerProvider, null, React.createElement(Toolbar)),
    ),
  );
  expect(viewer.dispose).toHaveBeenCalled();
  expect(shared).toBeNull();
});

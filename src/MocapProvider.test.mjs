import { afterEach, beforeEach, expect, test, vi } from "vitest";
import React, {
  act,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { getEnv } from "fabric";

const { document } = getEnv();
let root;
let host;
let boundary;
let context;
let fixture;

function useMockTracking() {
  // eslint-disable-next-line react-hooks/immutability -- Count test renders to catch publication loops.
  fixture.hookRenders++;
  if (fixture.hookRenders > 40)
    throw new Error("Tracking publication created a render loop");
  const [status, setStatus] = useState("idle");
  const [settings, setSettings] = useState({ smoothing: "adaptive" });
  const running = useRef(false);
  const start = useCallback(async () => {
    if (running.current) return false;
    running.current = true;
    fixture.starts++;
    fixture.activeResources++;
    setStatus("tracking");
    return true;
  }, []);
  const release = useCallback(() => {
    if (running.current) {
      running.current = false;
      fixture.activeResources--;
    }
  }, []);
  const stop = useCallback(() => {
    fixture.stops++;
    release();
    setStatus("idle");
  }, [release]);
  const updateSettings = useCallback(
    (patch) => setSettings((previous) => ({ ...previous, ...patch })),
    [],
  );
  useEffect(() => release, [release]);
  return { status, settings, start, stop, updateSettings, error: null };
}

function Editor() {
  const [edits, setEdits] = useState(0);
  const next = boundary.useMocap();
  useLayoutEffect(() => {
    context = next;
  }, [next]);
  useEffect(() => {
    fixture.editorMounts++;
    return () => {
      fixture.editorUnmounts++;
    };
  }, []);
  return React.createElement(
    "div",
    { "data-editor": true },
    React.createElement(
      "button",
      { "data-edit": true, onClick: () => setEdits((n) => n + 1) },
      `Edits: ${edits}`,
    ),
    React.createElement(boundary.LiveMocapControls),
  );
}

function tree(strict = false) {
  const provider = React.createElement(
    boundary.default,
    null,
    React.createElement(Editor),
  );
  return strict
    ? React.createElement(React.StrictMode, null, provider)
    : provider;
}

async function render(strict = false) {
  await act(async () => root.render(tree(strict)));
}
async function camera() {
  await act(async () =>
    host.querySelector("button[aria-controls='MocapPreview']").click(),
  );
}
async function loadRuntime() {
  await act(async () => {
    fixture.gate.resolve();
    await fixture.loaded.promise;
    await vi.dynamicImportSettled();
  });
}
async function importRuntime(importOriginal) {
  const current = fixture;
  current.runtimeImports++;
  try {
    await current.gate.promise;
    return await importOriginal();
  } finally {
    current.loaded.resolve();
  }
}

beforeEach(async () => {
  vi.resetModules();
  fixture = {
    gate: Promise.withResolvers(),
    loaded: Promise.withResolvers(),
    player: true,
    runtimeImports: 0,
    hookImports: 0,
    hookRenders: 0,
    starts: 0,
    stops: 0,
    activeResources: 0,
    editorMounts: 0,
    editorUnmounts: 0,
  };
  context = null;
  vi.doMock("./useWarrior", () => ({
    default: () => ({
      selectedModelType: fixture.player ? "player" : "weapon",
    }),
  }));
  vi.doMock("./mocap/usePoseTracking", () => {
    fixture.hookImports++;
    return { default: useMockTracking };
  });
  vi.doMock("./mocap/MocapPreview", () => ({ default: () => null }));
  vi.doMock("./mocap/MocapPose", () => ({ default: () => null }));
  vi.doMock("./mocap/rig", () => ({ createPlayerRig: vi.fn() }));
  vi.doMock("./mocap/cameraFraming", () => ({
    createPoseFraming: vi.fn(),
    framingLandmarkIndices: [],
    isFramingVisible: () => false,
  }));
  vi.doMock("./mocap/MocapRuntime", importRuntime);
  boundary = await import("./MocapProvider");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (fixture.runtimeImports && context.loading) await loadRuntime();
  if (root) await act(async () => root.unmount());
  host.remove();
  vi.doUnmock("./mocap/MocapRuntime");
  vi.restoreAllMocks();
});

test("ordinary editor mount imports no runtime or tracker; activation preserves editor identity and edits", async () => {
  await render();
  expect(fixture.runtimeImports).toBe(0);
  expect(fixture.hookImports).toBe(0);
  expect(fixture.hookRenders).toBe(0);
  const editor = host.querySelector("[data-editor]");
  await act(async () => host.querySelector("[data-edit]").click());
  await camera();
  expect(context.loading).toBe(true);
  expect(context.active).toBe(true);
  expect(fixture.starts).toBe(0);
  await loadRuntime();
  expect(fixture.runtimeImports).toBe(1);
  expect(fixture.starts).toBe(1);
  expect(context.tracking.status).toBe("tracking");
  expect(context.tracking.recorder.recordings).toEqual([]);
  expect(host.querySelector("[data-editor]")).toBe(editor);
  expect(host.querySelector("[data-edit]").textContent).toBe("Edits: 1");
  expect(fixture.editorMounts).toBe(1);
  expect(fixture.editorUnmounts).toBe(0);
  expect(fixture.hookRenders).toBeLessThan(5);
  const renders = fixture.hookRenders;
  await render();
  expect(fixture.hookRenders).toBe(renders);
});

test("cancelling a deferred runtime import prevents late camera activation and supports a later restart", async () => {
  await render();
  await camera();
  await camera();
  expect(context.active).toBe(false);
  await loadRuntime();
  expect(fixture.hookRenders).toBe(0);
  expect(fixture.starts).toBe(0);
  await camera();
  await act(async () => vi.dynamicImportSettled());
  expect(fixture.runtimeImports).toBe(1);
  expect(fixture.starts).toBe(1);
});

test.each(["model", "unmount"])(
  "%s change during deferred import prevents late activation",
  async (change) => {
    await render();
    await camera();
    if (change === "model") {
      fixture.player = false;
      await render();
    } else {
      await act(async () => root.unmount());
      root = null;
    }
    await loadRuntime();
    expect(fixture.starts).toBe(0);
    expect(fixture.hookRenders).toBe(0);
    if (change === "model") expect(context.active).toBe(false);
  },
);

test("runtime resolution and a nonplayer switch in one commit cannot leave the camera running", async () => {
  await render();
  await camera();
  await act(async () => {
    fixture.gate.resolve();
    await fixture.loaded.promise;
    await vi.dynamicImportSettled();
    fixture.player = false;
    root.render(tree());
  });
  await act(async () => {});
  expect(context.active).toBe(false);
  expect(fixture.activeResources).toBe(0);
  fixture.player = true;
  await render();
  expect(fixture.activeResources).toBe(0);
  await camera();
  await act(async () => vi.dynamicImportSettled());
  expect(fixture.activeResources).toBe(1);
});

test("a failed runtime chunk can be retried without remounting the editor", async () => {
  await render();
  const editor = host.querySelector("[data-editor]");
  await camera();
  await act(async () => {
    fixture.gate.reject(new Error("Chunk unavailable"));
    await vi.dynamicImportSettled();
  });
  expect(context.error).toMatch(/could not load/);
  expect(context.loading).toBe(false);
  expect(context.active).toBe(false);
  // The test module loader caches rejected mock imports. Evict that failed
  // module to model a chunk that becomes available on the next network attempt.
  vi.resetModules();
  fixture.loaded = Promise.withResolvers();
  fixture.gate = Promise.withResolvers();
  vi.doMock("./mocap/MocapRuntime", importRuntime);
  await camera();
  await loadRuntime();
  expect(context.error).toBeNull();
  expect(fixture.starts).toBe(1);
  expect(host.querySelector("[data-editor]")).toBe(editor);
});

test("stopping and switching away from player models release resources while restart retains settings", async () => {
  await render();
  await camera();
  await loadRuntime();
  await act(async () =>
    context.tracking.updateSettings({ smoothing: "stable" }),
  );
  await camera();
  expect(fixture.activeResources).toBe(0);
  await camera();
  expect(fixture.starts).toBe(2);
  expect(context.tracking.settings.smoothing).toBe("stable");
  fixture.player = false;
  await render();
  expect(context.active).toBe(false);
  expect(fixture.activeResources).toBe(0);
  expect(host.querySelector("button[aria-controls='MocapPreview']")).toBeNull();
  fixture.player = true;
  await render();
  expect(fixture.starts).toBe(2);
  await camera();
  expect(context.tracking.settings.smoothing).toBe("stable");
  expect(fixture.runtimeImports).toBe(1);
  expect(fixture.activeResources).toBe(1);
  await act(async () => root.unmount());
  root = null;
  expect(fixture.activeResources).toBe(0);
});

test("StrictMode effect replay leaves one running tracker and can stop and restart", async () => {
  await render(true);
  await camera();
  await loadRuntime();
  expect(context.active).toBe(true);
  expect(fixture.activeResources).toBe(1);
  expect(fixture.hookRenders).toBeLessThan(12);
  await camera();
  expect(fixture.activeResources).toBe(0);
  await camera();
  expect(fixture.activeResources).toBe(1);
  await act(async () => root.unmount());
  root = null;
  expect(fixture.activeResources).toBe(0);
});

test("the recorder's live region stays mounted outside the camera panel after the camera stops", async () => {
  await render();
  expect(host.querySelector("p[role='status']")).toBeNull();
  await camera();
  await loadRuntime();
  const region = host.querySelector("p[role='status']");
  expect(region).not.toBeNull();
  expect(region.closest("#MocapPreview")).toBeNull();
  await camera();
  expect(context.active).toBe(false);
  expect(host.querySelector("p[role='status']")).toBe(region);
});

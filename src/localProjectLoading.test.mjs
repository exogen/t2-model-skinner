import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getEnv } from "fabric";
import {
  act,
  canvas,
  editor,
  image,
  input,
} from "./skinProjectTestUtils.mjs";
import { captureSkinProject, createSkinProjectZip } from "./skinProjectUtils";

const catalog = vi.hoisted(() => [
  { file: "sets/A + #50% 🍂.skin", name: "Catalog Label", model: "mfemale" },
]);
vi.mock("./localProjects", () => ({
  localProjects: catalog,
  getLocalProject: (file) => catalog.find((entry) => entry.file === file),
}));
vi.mock("./useSettings", () => ({
  default: () => ({ basePath: "/t2-model-skinner", canvasPadding: 64 }),
}));

const { File } = getEnv().window;
const originalFile = globalThis.File;
beforeEach(() => vi.stubGlobal("File", File));
afterEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("File", originalFile);
});

function response(bytes) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function projectFetch(handler) {
  const fetch = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation((url, options) =>
    String(url).startsWith("/t2-model-skinner/projects/")
      ? handler(String(url), options)
      : fetch(url, options)
  );
}

function currentCanvas(app) {
  return app.canvases[app.tools.activeCanvas].canvas;
}

test("a local project keeps its filename identity, document name, HD size, and edits across unrelated updates", async () => {
  const source = canvas();
  source.add(image({ left: 864 }));
  const project = captureSkinProject([input("base", source, null, [1024, 1024])], "mfemale", "Document Name");
  const bytes = await (await createSkinProjectZip(project)).generateAsync({ type: "nodebuffer" });
  const fetch = projectFetch(async () => response(bytes));
  const app = await editor();
  try {
    await act(async () => app.tools.setSizeMultiplier(4));
    await act(async () => app.tools.loadLocalProject(catalog[0].file));
    await app.settle();
    expect(app.warrior.selectedModel).toBe("mfemale");
    expect(app.warrior.selectedSkinType).toBe("local");
    expect(app.warrior.selectedSkin).toBe(catalog[0].file);
    expect(app.tools.loadedLocalProject).toBe(catalog[0].file);
    expect(app.tools.exportName).toBe("Document Name");
    expect(app.tools.sizeMultiplier).toBe(2);
    expect(currentCanvas(app).item(0).left).toBe(864);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "/t2-model-skinner/projects/sets/A%20%2B%20%2350%25%20%F0%9F%8D%82.skin",
      { signal: expect.any(globalThis.AbortSignal) }
    );
    const opened = currentCanvas(app);
    const added = image({ left: 456 });
    await act(async () => {
      opened.add(added);
      app.tools.setBrushSize(37);
      app.tools.setExportName("Edited Name");
      app.warrior.setSelectedAnimation("run");
      app.warrior.addImportedSkins(new Map());
    });
    expect(currentCanvas(app)).toBe(opened);
    expect(opened.item(1)).toBe(added);
    expect(app.tools.loadedLocalProject).toBe(catalog[0].file);
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      app.warrior.setSelectedSkinType("default");
      app.warrior.setSelectedSkin("Blood Eagle");
    });
    expect(app.tools.loadedLocalProject).toBeNull();
    expect(app.tools.sizeMultiplier).toBe(4);
  } finally {
    await app.close();
    await source.dispose();
  }
});

test("an unknown project filename is rejected before fetching", async () => {
  const fetch = projectFetch(vi.fn());
  const app = await editor();
  try {
    const before = currentCanvas(app);
    await act(async () => {
      await expect(app.tools.loadLocalProject("../unknown.skin")).rejects.toThrow("no longer available");
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(currentCanvas(app)).toBe(before);
  } finally {
    await app.close();
  }
});

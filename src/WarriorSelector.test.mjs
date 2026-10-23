import { afterEach, expect, test, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import WarriorSelector from "./WarriorSelector";
import { WarriorContext } from "./useWarrior";
import { ToolsContext } from "./useTools";
import useWarrior from "./useWarrior";
import WarriorProvider, { getSkinImageUrls } from "./WarriorProvider";
import modelConfig, { modelTypes, modelToModelType } from "./models";
import { chooseOption, openSelect } from "./selectTestUtils.mjs";

const routing = vi.hoisted(() => ({
  search: "",
  router: { replace: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => routing.router,
  useSearchParams: () => new globalThis.URLSearchParams(routing.search),
}));

vi.mock("./useManifest", () => {
  const manifest = {
    customSkins: { disc: ["New Weapon Skin", "Folder/Skin"] },
    newSkins: { disc: ["New Weapon Skin"] },
  };
  return { default: () => [manifest, true] };
});

vi.mock("./localProjects", () => {
  const localProjects = [
    { file: "Aurora.skin", name: "Aurora", model: "lfemale" },
    { file: "Folder/100% + Blue? & #.skin", name: "100% + Blue? & #", model: "lmale" },
  ];
  return { localProjects, getLocalProject: (file) => localProjects.find((project) => project.file === file) };
});

test.each([
  ["lmale", "base", "R-Skin#1", "R-Skin%231.lmale.png"],
  ["disc", "weapon_disc", "Folder/Skin #1?100%", "Folder/Skin%20%231%3F100%25/weapon_disc.png"],
  ["vehicle_air_bomber", "vehicle_air_bomber1", "Café + #1", "Caf%C3%A9%20%2B%20%231/vehicle_air_bomber1.png"],
  ["lmale", "base", "Literal%23", "Literal%2523.lmale.png"],
])("custom %s textures preserve special characters in their URLs", (model, material, skin, path) => {
  const urls = getSkinImageUrls({
    basePath: "", actualModel: model, selectedSkin: skin, selectedSkinType: "custom",
  });
  expect(urls[material][0]).toBe(`https://assets.tribes2.online/skins/files/${path}`);
});

test.each(["", "/t2-model-skinner"])("stock and fallback textures preserve the %j deployment path", (basePath) => {
  const stock = getSkinImageUrls({
    basePath, actualModel: "lmale", selectedSkin: "Blood Eagle", selectedSkinType: "default",
  });
  expect(stock.base[0]).toBe(`${basePath}/textures/Blood%20Eagle.lmale.png`);
  const projectFallback = getSkinImageUrls({
    basePath, actualModel: "lmale", selectedSkin: "Project #1", selectedSkinType: "project",
  });
  expect(projectFallback).toEqual(stock);
  const special = getSkinImageUrls({
    basePath, actualModel: "lmale", selectedSkin: "Skin #1?100%", selectedSkinType: "default",
  });
  expect(special.base[0]).toBe(`${basePath}/textures/Skin%20%231%3F100%25.lmale.png`);
});

test("all custom animation frames escape the skin folder exactly once", () => {
  const urls = getSkinImageUrls({
    basePath: "", actualModel: "disc", selectedSkin: "Folder/100% #1", selectedSkinType: "custom",
  });
  expect(urls.dcase00).toEqual(Array.from({ length: 6 }, (_, frame) =>
    `https://assets.tribes2.online/skins/files/Folder/100%25%20%231/dcase0${frame}.png`,
  ));
});

test("imported image URLs are passed through unchanged", () => {
  const imageUrl = "data:image/png;base64,AA+/AA==";
  const urls = getSkinImageUrls({
    basePath: "/t2-model-skinner", actualModel: "lmale",
    selectedSkin: "Imported #1", selectedSkinType: "import",
    importedSkins: new Map([["lmale", new Map([["Imported #1", {
      isComplete: true, materials: new Map([["base", [imageUrl]]]),
    }]])]]),
  });
  expect(urls.base).toEqual([imageUrl]);
});

const { document, window } = globalThis;
let root, host;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

async function selector(selectedSkinType, selectedSkin, overrides = {}) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const setSelectedSkin = vi.fn();
  const loadSkinFiles = vi.fn();
  const tools = {
    loadSkinFiles, loadLocalProject: vi.fn(async () => {}),
    cancelSkinLoad: vi.fn(), loadedLocalProject: null,
    setSelectedMaterialIndex: vi.fn(), ...overrides.tools,
  };
  const warrior = {
    selectedModel: "disc", actualModel: "disc", selectedModelType: "weapon",
    selectedSkinType, selectedSkin, setSelectedSkin, setSelectedSkinType: vi.fn(),
    setSelectedModel: vi.fn(), setSelectedAnimation: vi.fn(), setAnimationPaused: vi.fn(),
    importedSkins: new Map([["disc", new Map([["Imported", { name: "Imported", isComplete: true }]])]]),
    ...overrides.warrior,
  };
  const render = () =>
    root.render(
      React.createElement(
        WarriorContext.Provider,
        {
          value: warrior,
        },
        React.createElement(
          ToolsContext.Provider,
          { value: tools },
          React.createElement(WarriorSelector)
        )
      )
    );
  await act(async () => render());
  return {
    select: host.querySelector("#SkinSelect"),
    setSelectedSkin,
    loadSkinFiles,
    tools, warrior, render,
  };
}

test("an imported skin remains selected when the editor session remounts", async () => {
  const { select } = await selector("import", "Imported");
  expect(select.textContent).toBe("Imported");
});

test("a newly listed weapon skin selects its New Skins entry", async () => {
  const { select } = await selector("custom", "New Weapon Skin");
  const popup = await openSelect(select);
  const selected = popup.querySelector('[aria-selected="true"]');
  expect(selected.closest('[role="group"]').textContent).toContain("New Skins ✨");
  expect(popup.querySelectorAll('[data-value="custom/New Weapon Skin"]')).toHaveLength(1);
});

test("selecting a skin preserves slashes in its name", async () => {
  const { select, setSelectedSkin } = await selector(
    "custom",
    "New Weapon Skin"
  );
  await chooseOption(select, "custom/Folder/Skin");
  expect(setSelectedSkin).toHaveBeenCalledWith("Folder/Skin");
});

test("every selectable model has one classification and material definitions", async () => {
  const models = Object.values(modelTypes).flat();
  expect(new Set(models).size).toBe(models.length);
  await selector("import", "Imported");
  const popup = await openSelect(host.querySelector("#ModelSelect"));
  const options = [...popup.querySelectorAll('[role="option"]')].map(
    (option) => option.dataset.value
  );
  expect([...models].sort()).toEqual(options.sort());
  for (const model of models) {
    expect(
      modelConfig.materials[model === "hfemale" ? "hmale" : model]
    ).toBeDefined();
  }
  expect(modelToModelType("hfemale")).toBe("player");
  expect(modelToModelType("unknown")).toBeUndefined();
});

for (const initialModel of [
  "disc",
  "vehicle_grav_scout",
  "hfemale",
  "unknown",
]) {
  test(`model type stays derived after loading ${initialModel} from the URL and switching models`, async () => {
    routing.search = `m=${initialModel}`;
    let warrior;
    function Probe() {
      const current = useWarrior();
      React.useLayoutEffect(() => {
        warrior = current;
      }, [current]);
      return null;
    }
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root.render(
        React.createElement(WarriorProvider, null, React.createElement(Probe))
      )
    );
    expect(warrior.selectedModel).toBe(
      initialModel === "unknown" ? "lmale" : initialModel
    );
    for (const [model, type] of [
      ["disc", "weapon"],
      ["vehicle_grav_scout", "vehicle"],
      ["hfemale", "player"],
    ]) {
      await act(async () => warrior.setSelectedModel(model));
      expect(warrior.selectedModelType).toBe(type);
      expect(warrior.actualModel).toBe(model === "hfemale" ? "hmale" : model);
    }
  });
}

test.each(["R-Skin#1", "100% + Blue? & #", "Literal%23"])("editor links round-trip the exact skin name %j", async (name) => {
  routing.search = new globalThis.URLSearchParams({ m: "lmale", s: name }).toString();
  let warrior;
  function Probe() {
    const current = useWarrior();
    React.useLayoutEffect(() => { warrior = current; }, [current]);
    return null;
  }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(
    React.createElement(WarriorProvider, null, React.createElement(Probe)),
  ));
  expect(warrior.selectedSkin).toBe(name);
  const imageUrl = new globalThis.URL(warrior.skinImageUrls.base[0]);
  expect(imageUrl.hash).toBe("");
  expect(imageUrl.search).toBe("");
  expect(decodeURIComponent(imageUrl.pathname)).toBe(`/skins/files/${name}.lmale.png`);
  const changedName = `${name} renamed`;
  await act(async () => warrior.setSelectedSkin(changedName));
  const [href] = routing.router.replace.mock.calls.at(-1);
  expect(new globalThis.URL(href, "https://example.com").searchParams.get("s")).toBe(changedName);
});


test("the file picker uses the shared skin loader and displays its errors", async () => {
  const { loadSkinFiles } = await selector("default", "Default");
  const file = new window.File(["archive"], "Example.skin");
  const input = host.querySelector('input[type="file"]');
  Object.defineProperty(input, "files", { value: [file] });
  loadSkinFiles.mockRejectedValueOnce(new Error("Unable to read project"));
  await act(async () =>
    input.dispatchEvent(new window.Event("change", { bubbles: true }))
  );
  expect(loadSkinFiles).toHaveBeenCalledWith([file]);
  expect(host.querySelector('[role="alert"]').textContent).toBe(
    "Unable to read project"
  );
  await act(async () =>
    input.dispatchEvent(new window.Event("change", { bubbles: true }))
  );
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("Projects lists every bundled model and the current manual project without changing selection before load", async () => {
  const pending = deferred();
  const loadLocalProject = vi.fn(() => pending.promise);
  const { select, tools, warrior } = await selector("project", "My manually opened skin", {
    tools: { loadLocalProject },
  });
  const popup = await openSelect(select);
  const group = [...popup.querySelectorAll('[role="group"]')].find((group) => group.textContent.includes("Projects"));
  expect([...group.querySelectorAll('[role="option"]')].map((option) => option.dataset.value)).toEqual([
    "local/Aurora.skin", "local/Folder/100% + Blue? & #.skin", "project/My manually opened skin",
  ]);
  await act(async () => group.querySelector('[data-value="local/Aurora.skin"]').click());
  expect(loadLocalProject).toHaveBeenCalledWith("Aurora.skin");
  expect(warrior.setSelectedSkin).not.toHaveBeenCalled();
  expect(warrior.setSelectedModel).not.toHaveBeenCalled();
  expect(host.querySelector('[role="status"]').textContent).toBe("Loading…");
  expect(select.disabled).toBe(false);
  await act(async () => pending.resolve());
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(tools.loadedLocalProject).toBeNull();
});

test("selecting a bundled filename preserves every character and displays its catalog name", async () => {
  const file = "Folder/100% + Blue? & #.skin";
  const view = await selector("local", file, { tools: { loadedLocalProject: file } });
  const { select, tools } = view;
  expect(select.textContent).toBe("100% + Blue? & #");
  await chooseOption(select, "local/Aurora.skin");
  expect(tools.loadLocalProject).toHaveBeenCalledWith("Aurora.skin");
  await chooseOption(select, `local/${file}`);
  expect(tools.cancelSkinLoad).toHaveBeenCalledTimes(1);
  view.warrior.selectedSkinType = "custom";
  view.warrior.selectedSkin = "New Weapon Skin";
  await act(async () => view.render());
  await chooseOption(select, `local/${file}`);
  expect(tools.loadLocalProject).toHaveBeenLastCalledWith(file);
});

test("a URL project loads once per selection even when loader callback identity changes", async () => {
  const pending = deferred();
  const loadLocalProject = vi.fn(() => pending.promise);
  const view = await selector("local", "Aurora.skin", { tools: { loadLocalProject } });
  expect(loadLocalProject).toHaveBeenCalledTimes(1);
  view.tools.loadLocalProject = vi.fn(() => pending.promise);
  await act(async () => view.render());
  expect(view.tools.loadLocalProject).not.toHaveBeenCalled();
  await act(async () => pending.resolve());
  view.tools.loadedLocalProject = "Aurora.skin";
  await act(async () => view.render());
  expect(view.tools.loadLocalProject).not.toHaveBeenCalled();
});

test("manually choosing another project during URL loading does not restart the URL project", async () => {
  const first = deferred();
  const second = deferred();
  const loadLocalProject = vi.fn((file) => file === "Aurora.skin" ? first.promise : second.promise);
  const view = await selector("local", "Aurora.skin", { tools: { loadLocalProject } });
  const secondFile = "Folder/100% + Blue? & #.skin";
  await chooseOption(view.select, `local/${secondFile}`);
  expect(loadLocalProject.mock.calls).toEqual([["Aurora.skin"], [secondFile]]);
  view.tools.loadLocalProject = vi.fn((file) => file === "Aurora.skin" ? first.promise : second.promise);
  await act(async () => view.render());
  expect(view.tools.loadLocalProject).not.toHaveBeenCalled();
  await act(async () => first.reject(new Error("Old URL request cancelled")));
  expect(host.querySelector('[role="status"]').textContent).toBe("Loading…");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => second.resolve());
  expect(host.querySelector('[role="status"]')).toBeNull();
});

test("failed URL projects show one error and can retry without an automatic retry loop", async () => {
  const loadLocalProject = vi.fn().mockRejectedValueOnce(new Error("Unable to read project")).mockResolvedValue(undefined);
  const view = await selector("local", "Aurora.skin", { tools: { loadLocalProject } });
  expect(loadLocalProject).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="alert"]').textContent).toBe("Unable to read projectRetry");
  await act(async () => view.render());
  expect(loadLocalProject).toHaveBeenCalledTimes(1);
  await act(async () => host.querySelector('[role="alert"] button').click());
  expect(loadLocalProject).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

test("another skin selection cancels a pending project and ignores its late failure", async () => {
  const pending = deferred();
  const view = await selector("custom", "New Weapon Skin", { tools: { loadLocalProject: vi.fn(() => pending.promise) } });
  await chooseOption(view.select, "local/Aurora.skin");
  await chooseOption(view.select, "custom/Folder/Skin");
  expect(view.tools.cancelSkinLoad).toHaveBeenCalledTimes(1);
  expect(view.warrior.setSelectedSkin).toHaveBeenCalledWith("Folder/Skin");
  await act(async () => pending.reject(new Error("Cancelled old request")));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector('[role="status"]')).toBeNull();
});

test("reselecting the current skin cancels a pending project", async () => {
  const pending = deferred();
  const view = await selector("custom", "New Weapon Skin", { tools: { loadLocalProject: vi.fn(() => pending.promise) } });
  await chooseOption(view.select, "local/Aurora.skin");
  await chooseOption(view.select, "custom/New Weapon Skin");
  expect(view.tools.cancelSkinLoad).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve());
  expect(host.querySelector('[role="status"]')).toBeNull();
});

test.each(["model", "file"])("%s selection cancels a pending bundled project", async (kind) => {
  const pending = deferred();
  const view = await selector("custom", "New Weapon Skin", { tools: { loadLocalProject: vi.fn(() => pending.promise) } });
  await chooseOption(view.select, "local/Aurora.skin");
  if (kind === "model") await chooseOption(host.querySelector("#ModelSelect"), "lfemale");
  else await act(async () => host.querySelector('button[aria-label="Load Skin"]').click());
  expect(view.tools.cancelSkinLoad).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(new Error("Cancelled")));
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

test.each(["model", "file"])("a %s action without a new selection preserves the initial URL project load", async (kind) => {
  const pending = deferred();
  const view = await selector("local", "Aurora.skin", { tools: { loadLocalProject: vi.fn(() => pending.promise) } });
  if (kind === "model") await chooseOption(host.querySelector("#ModelSelect"), "disc");
  else {
    await act(async () => host.querySelector('button[aria-label="Load Skin"]').click());
    const input = host.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", { value: [] });
    await act(async () => input.dispatchEvent(new window.Event("change", { bubbles: true })));
  }
  expect(view.tools.cancelSkinLoad).not.toHaveBeenCalled();
  expect(view.tools.loadSkinFiles).not.toHaveBeenCalled();
  expect(view.tools.loadLocalProject).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role="status"]').textContent).toBe("Loading…");
  await act(async () => pending.resolve());
});

test.each(["model", "file"])("a %s action without a new selection preserves a failed URL project's Retry", async (kind) => {
  const view = await selector("local", "Aurora.skin", {
    tools: { loadLocalProject: vi.fn().mockRejectedValueOnce(new Error("Project unavailable")).mockResolvedValue(undefined) },
  });
  if (kind === "model") await chooseOption(host.querySelector("#ModelSelect"), "disc");
  else await act(async () => host.querySelector('button[aria-label="Load Skin"]').click());
  expect(view.tools.cancelSkinLoad).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]').textContent).toBe("Project unavailableRetry");
  await act(async () => host.querySelector('[role="alert"] button').click());
  expect(view.tools.loadLocalProject).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

test("choosing an actual file still cancels an initial URL project", async () => {
  const pending = deferred();
  const view = await selector("local", "Aurora.skin", { tools: { loadLocalProject: vi.fn(() => pending.promise) } });
  const input = host.querySelector('input[type="file"]');
  const file = new window.File(["archive"], "Different.skin");
  Object.defineProperty(input, "files", { value: [file] });
  await act(async () => input.dispatchEvent(new window.Event("change", { bubbles: true })));
  expect(view.tools.cancelSkinLoad).toHaveBeenCalledTimes(1);
  expect(view.tools.loadSkinFiles).toHaveBeenCalledWith([file]);
  await act(async () => pending.reject(new Error("Old request cancelled")));
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

test("a failed manual file offers recovery for the URL project it cancelled", async () => {
  const pending = deferred();
  const view = await selector("local", "Aurora.skin", {
    tools: {
      loadLocalProject: vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue(undefined),
      loadSkinFiles: vi.fn().mockRejectedValue(new Error("Manual file unreadable")),
    },
  });
  const input = host.querySelector('input[type="file"]');
  Object.defineProperty(input, "files", { value: [new window.File(["bad"], "Different.skin")] });
  await act(async () => input.dispatchEvent(new window.Event("change", { bubbles: true })));
  expect(host.querySelector('[role="alert"]').textContent).toBe("Manual file unreadableRetry");
  await act(async () => host.querySelector('[role="alert"] button').click());
  expect(view.tools.loadLocalProject.mock.calls).toEqual([["Aurora.skin"], ["Aurora.skin"]]);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => pending.reject(new Error("Old request cancelled")));
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

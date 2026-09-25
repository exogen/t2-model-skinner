import { afterEach, expect, test, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import WarriorSelector from "./WarriorSelector";
import { WarriorContext } from "./useWarrior";
import { ToolsContext } from "./useTools";
import useWarrior from "./useWarrior";
import WarriorProvider, { getSkinImageUrls } from "./WarriorProvider";
import modelConfig, { modelTypes, modelToModelType } from "./models";

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

async function selector(selectedSkinType, selectedSkin) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const setSelectedSkin = vi.fn();
  const loadSkinFiles = vi.fn();
  await act(async () =>
    root.render(
      React.createElement(
        WarriorContext.Provider,
        {
          value: {
            selectedModel: "disc",
            actualModel: "disc",
            selectedModelType: "weapon",
            selectedSkinType,
            selectedSkin,
            setSelectedSkin,
            setSelectedSkinType: vi.fn(),
            importedSkins: new Map([
              [
                "disc",
                new Map([
                  [
                    "Imported",
                    {
                      name: "Imported",
                      isComplete: true,
                    },
                  ],
                ]),
              ],
            ]),
          },
        },
        React.createElement(
          ToolsContext.Provider,
          { value: { loadSkinFiles } },
          React.createElement(WarriorSelector)
        )
      )
    )
  );
  return {
    select: host.querySelector("#SkinSelect"),
    setSelectedSkin,
    loadSkinFiles,
  };
}

test("an imported skin remains selected when the editor session remounts", async () => {
  const { select } = await selector("import", "Imported");
  expect(select.selectedOptions[0].textContent).toBe("Imported");
});

test("a newly listed weapon skin selects its New Skins entry", async () => {
  const { select } = await selector("custom", "New Weapon Skin");
  expect(select.selectedOptions[0].parentElement.label).toBe("New Skins ✨");
});

test("selecting a skin preserves slashes in its name", async () => {
  const { select, setSelectedSkin } = await selector(
    "custom",
    "New Weapon Skin"
  );
  await act(async () => {
    select.value = [...select.options].find(
      (option) => option.textContent === "Folder/Skin"
    ).value;
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  expect(setSelectedSkin).toHaveBeenCalledWith("Folder/Skin");
});

test("every selectable model has one classification and material definitions", async () => {
  const models = Object.values(modelTypes).flat();
  expect(new Set(models).size).toBe(models.length);
  await selector("import", "Imported");
  const options = [...host.querySelector("#ModelSelect").options].map(
    ({ value }) => value
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

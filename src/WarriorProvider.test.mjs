import { afterEach, expect, test, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import WarriorProvider, { getSkinImageUrls } from "./WarriorProvider";
import useWarrior from "./useWarrior";

const routing = vi.hoisted(() => ({
  search: "",
  router: { replace: vi.fn() },
}));
const catalog = vi.hoisted(() => [
  {
    file: "Folder/100% + Café? & #.skin",
    name: "100% + Café? & #",
    model: "lfemale",
  },
  { file: "Literal%23.skin", name: "Literal%23", model: "hfemale" },
  { file: "Legacy.skin", name: "Legacy" },
  { file: "Unknown model.skin", name: "Unknown model", model: "not-a-model" },
]);
vi.mock("next/navigation", () => ({
  usePathname: () => "/t2-model-skinner/",
  useRouter: () => routing.router,
  useSearchParams: () => new globalThis.URLSearchParams(routing.search),
}));
vi.mock("./localProjects", () => ({
  localProjects: catalog,
  getLocalProject: (file) => catalog.find((project) => project.file === file),
}));

let root, host, warrior;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = host = warrior = undefined;
  routing.router.replace.mockClear();
});

async function mount(params) {
  routing.search = new globalThis.URLSearchParams(params).toString();
  function Probe() {
    const value = useWarrior();
    React.useLayoutEffect(() => {
      warrior = value;
    }, [value]);
    return null;
  }
  host = globalThis.document.createElement("div");
  globalThis.document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      React.createElement(WarriorProvider, null, React.createElement(Probe)),
    ),
  );
}

function latestUrl() {
  return new globalThis.URL(
    routing.router.replace.mock.calls.at(-1)[0],
    "https://example.com",
  );
}

test.each(catalog.slice(0, 2))(
  "bundled project URL round-trips $file and uses its own model metadata",
  async (project) => {
    await mount({
      p: project.file,
      m: "disc",
      s: "Old skin",
      untouched: "a+b",
    });
    expect(warrior.selectedSkinType).toBe("local");
    expect(warrior.selectedSkin).toBe(project.file);
    expect(warrior.selectedModel).toBe(project.model);
    expect(warrior.actualModel).toBe(
      project.model === "hfemale" ? "hmale" : project.model,
    );
    const url = latestUrl();
    expect(url.searchParams.get("p")).toBe(project.file);
    expect(url.searchParams.get("m")).toBe(project.model);
    expect(url.searchParams.has("s")).toBe(false);
    expect(url.searchParams.get("untouched")).toBe("a+b");
    expect(url.hash).toBe("");
  },
);

test.each(["Legacy.skin", "Unknown model.skin"])(
  "%s falls back to the URL's valid model",
  async (file) => {
    await mount({ p: file, m: "disc" });
    expect(warrior.selectedSkinType).toBe("local");
    expect(warrior.selectedSkin).toBe(file);
    expect(warrior.selectedModel).toBe("disc");
  },
);

test.each([
  "../outside.skin",
  "Missing.skin",
  "https://example.com/project.skin",
])(
  "unknown project %s safely falls back to normal skin selection",
  async (file) => {
    await mount({ p: file, m: "lfemale", s: "100% + # Custom" });
    expect(warrior.selectedSkinType).toBe("custom");
    expect(warrior.selectedSkin).toBe("100% + # Custom");
    expect(warrior.selectedModel).toBe("lfemale");
    expect(latestUrl().searchParams.has("p")).toBe(false);
    expect(latestUrl().searchParams.get("s")).toBe("100% + # Custom");
  },
);

test("an unknown project and invalid model use the normal editor defaults", async () => {
  await mount({ p: "Unknown.skin", m: "bad" });
  expect(warrior.selectedModel).toBe("lmale");
  expect(warrior.selectedSkin).toBe("Blood Eagle");
  expect(warrior.selectedSkinType).toBe("default");
  expect(latestUrl().searchParams.has("p")).toBe(false);
});

test.each(["default", "custom", "project", "import", null])(
  "switching from a local project to %s removes p",
  async (type) => {
    await mount({ p: catalog[0].file });
    const name = type ? "Other / 100% & #?" : null;
    await act(async () => {
      warrior.setSelectedSkin(name);
      warrior.setSelectedSkinType(type);
    });
    expect(latestUrl().searchParams.has("p")).toBe(false);
    expect(latestUrl().searchParams.get("s")).toBe(name);
  },
);

test("selecting a bundled project writes p and removes the previous s", async () => {
  await mount({ m: "lmale", s: "Blood Eagle" });
  await act(async () => {
    warrior.setSelectedModel("lfemale");
    warrior.setSelectedSkin(catalog[0].file);
    warrior.setSelectedSkinType("local");
  });
  expect(latestUrl().searchParams.get("p")).toBe(catalog[0].file);
  expect(latestUrl().searchParams.get("m")).toBe("lfemale");
  expect(latestUrl().searchParams.has("s")).toBe(false);
});

test.each(["lmale", "lfemale", "disc", "vehicle_air_bomber"])(
  "%s bundled project materials fall back to stock textures",
  (model) => {
    const basePath = "/t2-model-skinner";
    expect(
      getSkinImageUrls({
        basePath,
        actualModel: model,
        selectedSkin: catalog[0].file,
        selectedSkinType: "local",
      }),
    ).toEqual(
      getSkinImageUrls({
        basePath,
        actualModel: model,
        selectedSkin: "Opened project",
        selectedSkinType: "project",
      }),
    );
  },
);

test.each([
  ["hbioderm", "Horde"],
  ["lbioderm", "Horde"],
  ["lfemale", "Blood Eagle"],
  ["hfemale", "Blood Eagle"],
  ["disc", "weapon_disc"],
])(
  "a %s URL without a skin shows the model's default, %s",
  async (model, skin) => {
    await mount({ m: model });
    expect(warrior.selectedModel).toBe(model);
    expect(warrior.selectedSkin).toBe(skin);
    expect(warrior.selectedSkinType).toBe("default");
    expect(latestUrl().searchParams.get("s")).toBe(skin);
  },
);

test("a bioderm skin that isn't available falls back to the Horde skin's textures", async () => {
  await mount({ m: "mbioderm", s: "Blood Eagle" });
  expect(warrior.selectedSkin).toBe("Blood Eagle");
  expect(warrior.defaultSkinImageUrls).toEqual({
    base: ["/textures/Horde.mbioderm.png"],
  });
});

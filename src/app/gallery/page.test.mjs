import { afterEach, beforeEach, expect, test, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Link from "next/link";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import GalleryPage from "./page";
import { saveZipFile } from "../../exportUtils";
import { chooseOption } from "../../selectTestUtils.mjs";

const fixture = vi.hoisted(() => ({
  query: {},
  manifest: null,
  isLoaded: true,
  loadError: false,
  retry: vi.fn(),
}));
vi.mock("../../useManifest", () => ({
  default: () => [
    fixture.manifest,
    fixture.isLoaded,
    {
      error: fixture.loadError,
      retry: fixture.retry,
    },
  ],
}));
vi.mock("next/link", () => ({
  default: vi.fn(({ prefetch, ...props }) => React.createElement("a", props)),
}));
vi.mock("file-saver", () => ({ saveAs: vi.fn() }));
vi.mock("../../deployPaths", async (importOriginal) => ({
  ...(await importOriginal()),
  SKIN_GALLERY_BASE_URL: "/gallery-previews",
}));
vi.mock("../../exportUtils", async (importOriginal) => ({
  ...(await importOriginal()),
  saveZipFile: vi.fn(async () => {}),
}));

const { document, window } = globalThis;
const data = new Uint8Array([1, 2, 3]).buffer;
const response = { ok: true, arrayBuffer: async () => data };
let root, host;
const onUrlUpdate = vi.fn();

beforeEach(() => {
  fixture.query = {};
  fixture.isLoaded = true;
  fixture.loadError = false;
  fixture.retry.mockReset();
  fixture.manifest = {
    customSkins: { hmale: ["Example"], lmale: ["Example"], mmale: ["Example"] },
    newSkins: {},
    packs: {
      Pack: {
        version: "1",
        skins: { hmale: ["Example"], lmale: ["Example"], mmale: ["Example"] },
        files: ["Example.hmale.png", "Example.lmale.png", "Example.mmale.png"],
      },
    },
    sizeMultiplier: { "Example.mmale.png": 2 },
  };
  vi.stubGlobal("localStorage", {
    getItem: () => "yes",
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
  vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.spyOn(window, "alert").mockImplementation(() => {});
  vi.mocked(saveZipFile).mockClear();
  vi.mocked(Link).mockClear();
  onUrlUpdate.mockClear();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.restoreAllMocks();
});

async function gallery(onRender) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const page = React.createElement(
    NuqsTestingAdapter,
    {
      searchParams: fixture.query,
      hasMemory: true,
      onUrlUpdate,
    },
    React.createElement(GalleryPage),
  );
  await act(async () =>
    root.render(
      onRender
        ? React.createElement(React.Profiler, { id: "gallery", onRender }, page)
        : page,
    ),
  );
  return host.querySelector('button[aria-label="Download Example skin"]');
}

function dialog() {
  return document.querySelector("dialog");
}
function button(label) {
  return [...dialog().querySelectorAll("button")].find(
    (node) => node.textContent === label,
  );
}
function radio(label) {
  return [...dialog().querySelectorAll("label")]
    .find((node) => node.textContent.startsWith(label))
    .querySelector("input");
}
async function click(node) {
  await act(async () => node.click());
}
function summary() {
  const fields = Object.fromEntries(
    [...dialog().querySelectorAll("dl > div")].map((row) => [
      row.querySelector("dt").textContent,
      row.querySelector("dd").textContent,
    ]),
  );
  const modelCount = dialog().querySelector("table thead strong");
  if (modelCount) fields["Models:"] = modelCount.textContent;
  return fields;
}
function savedFiles() {
  const [zip] = vi.mocked(saveZipFile).mock.calls.at(-1);
  return Object.keys(zip.files).filter((path) => !zip.files[path].dir);
}
function weapons() {
  fixture.query.filter = "disc";
  fixture.manifest.customSkins = {
    disc: ["Example"],
    chaingun: ["Example"],
    energy: ["example"],
    lmale: ["Example"],
    vehicle_grav_tank: ["Example"],
  };
}

function downloadAll() {
  return host.querySelector(
    'header button[aria-label="Download all player skins"]',
  );
}

test("a failed catalog load offers retry and keeps the full collection download available", async () => {
  fixture.isLoaded = false;
  fixture.loadError = true;
  await gallery();
  expect(host.querySelector('[role="alert"]').textContent).toContain(
    "Unable to load skins",
  );
  expect(host.querySelector('[aria-label="Loading skins"]')).toBeNull();
  expect(host.querySelector('[aria-label="Skin previews"]')).toBeNull();
  await click(host.querySelector('[role="alert"] button'));
  expect(fixture.retry).toHaveBeenCalledOnce();
  await click(downloadAll());
  expect(dialog().querySelector("h2").textContent).toBe("All player skins");
});

test.each([
  { preference: "no", label: "Standard", filename: "zPlayerSkins-All.vl2" },
  { preference: "yes", label: "HD", filename: "zPlayerSkins-All-HD.vl2" },
])(
  "Download all uses the latest $label release and the saved preference",
  async ({ preference, label, filename }) => {
    globalThis.localStorage.getItem = () => preference;
    await gallery();
    await click(downloadAll());
    expect(dialog().querySelector("h2").textContent).toBe("All player skins");
    expect(radio(label).checked).toBe(true);
    const link = dialog().querySelector("footer a");
    expect(link.href).toBe(
      `https://github.com/exogen/t2-skins/releases/latest/download/${filename}`,
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(saveZipFile).not.toHaveBeenCalled();
    // Prevent jsdom navigation while exercising the normal dismissal on download.
    link.addEventListener("click", (event) => event.preventDefault());
    await click(link);
    expect(dialog()).toBeNull();
    expect(downloadAll().disabled).toBe(false);
  },
);

test("Download all asks for resolution, updates the release link, and remembers the choice", async () => {
  globalThis.localStorage.getItem = () => null;
  await gallery();
  await click(downloadAll());
  expect(button("Download .vl2").disabled).toBe(true);
  expect(dialog().querySelector("footer a")).toBeNull();
  await click(radio("Standard"));
  expect(dialog().querySelector("footer a").href).toBe(
    "https://github.com/exogen/t2-skins/releases/latest/download/zPlayerSkins-All.vl2",
  );
  await click(radio("HD"));
  expect(dialog().querySelector("footer a").href).toBe(
    "https://github.com/exogen/t2-skins/releases/latest/download/zPlayerSkins-All-HD.vl2",
  );
  expect(globalThis.localStorage.setItem).toHaveBeenLastCalledWith(
    "hiResDownload",
    "yes",
  );
  expect(host.querySelector("#hiResSelect")).toBeNull();
  await click(button("Cancel"));
  expect(dialog()).toBeNull();
  await click(downloadAll());
  expect(radio("HD").checked).toBe(true);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(saveZipFile).not.toHaveBeenCalled();
});

test.each([{ filter: "Pack" }, { filter: "disc" }, { q: "Example" }])(
  "Download all remains available regardless of the gallery filter: %j",
  async (query) => {
    fixture.query = query;
    await gallery();
    const trigger = downloadAll();
    await act(async () => {
      trigger.click();
      trigger.click();
    });
    expect(document.querySelectorAll("dialog")).toHaveLength(1);
    expect(trigger.disabled).toBe(true);
    expect(dialog().querySelector("h2").textContent).toBe("All player skins");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    await act(async () =>
      dialog().dispatchEvent(new window.Event("cancel", { cancelable: true })),
    );
    expect(dialog()).toBeNull();
    expect(trigger.disabled).toBe(false);
  },
);

test.each(["Café + #1?100% & Blue", "Literal%23"])(
  "gallery previews and editor links preserve %j",
  async (name) => {
    fixture.query.filter = "lmale";
    fixture.manifest.customSkins.lmale = [name];
    await gallery();
    const image = host.querySelector("img");
    const previewUrl = new globalThis.URL(
      image.getAttribute("src"),
      "https://example.com",
    );
    expect(previewUrl.hash).toBe("");
    expect(previewUrl.search).toBe("");
    expect(decodeURIComponent(previewUrl.pathname)).toBe(
      `/gallery-previews/${name}.lmale.webp`,
    );
    const editorLink = [...host.querySelectorAll("a")].find((link) =>
      link.querySelector("svg[aria-label='Load in Editor']"),
    );
    const editorUrl = new globalThis.URL(
      editorLink.getAttribute("href"),
      "https://example.com",
    );
    expect(editorUrl.searchParams.get("s")).toBe(name);
  },
);

async function selectFilter(id, value) {
  await chooseOption(host.querySelector(`#${id}`), value);
}

async function search(value) {
  await act(async () => {
    const input = host.querySelector("#SkinSearch");
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

function previews() {
  return [...host.querySelectorAll('[aria-label="Skin previews"] img')].map(
    (image) => image.getAttribute("src"),
  );
}

function latestUrl() {
  expect(onUrlUpdate).toHaveBeenCalled();
  return onUrlUpdate.mock.calls.at(-1)[0];
}

async function reloadGallery() {
  fixture.query = new globalThis.URLSearchParams(latestUrl().queryString);
  await act(async () => root.unmount());
  host.remove();
  await gallery();
}

test("the default gallery shows every model without rewriting its URL", async () => {
  await gallery();
  expect(host.querySelector("#ModelSelect").value).toBe("all");
  expect(previews()).toHaveLength(3);
  expect(onUrlUpdate).not.toHaveBeenCalled();
});

test.each(["all", "new", "Pack"])(
  "switching to all models clears the model parameter and preserves %s on reload",
  async (collection) => {
    fixture.query = { collection, filter: "lmale", source: "shared link" };
    fixture.manifest.newSkins = { ...fixture.manifest.customSkins };
    await gallery();
    await selectFilter("ModelSelect", "all");
    expect(Object.fromEntries(latestUrl().searchParams)).toEqual({
      collection,
      source: "shared link",
    });
    await reloadGallery();
    expect(host.querySelector("#CollectionSelect").value).toBe(collection);
    expect(host.querySelector("#ModelSelect").value).toBe("all");
    expect(previews()).toHaveLength(3);
  },
);

test("selecting a model and searching preserves that scope in shared URLs, including after clearing search", async () => {
  await gallery();
  await selectFilter("ModelSelect", "lmale");
  await search("Example");
  expect(Object.fromEntries(latestUrl().searchParams)).toEqual({
    collection: "all",
    filter: "lmale",
    q: "Example",
  });
  await reloadGallery();
  expect(host.querySelector("#ModelSelect").value).toBe("lmale");
  expect(previews()).toEqual(["/gallery-previews/Example.lmale.webp"]);
  await click(host.querySelector('button[aria-label="Clear search"]'));
  expect(Object.fromEntries(latestUrl().searchParams)).toEqual({
    collection: "all",
    filter: "lmale",
  });
  await reloadGallery();
  expect(host.querySelector("#ModelSelect").value).toBe("lmale");
  expect(previews()).toHaveLength(1);
});

test.each(["lmale", "Pack"])(
  "clearing a legacy global search removes the stale %s filter and still shows all models on reload",
  async (filter) => {
    fixture.query = { filter, q: "Example" };
    await gallery();
    await click(host.querySelector('button[aria-label="Clear search"]'));
    expect(Object.fromEntries(latestUrl().searchParams)).toEqual({
      collection: "all",
    });
    await reloadGallery();
    expect(host.querySelector("#CollectionSelect").value).toBe("all");
    expect(host.querySelector("#ModelSelect").value).toBe("all");
    expect(previews()).toHaveLength(3);
  },
);

test("all-model collection and search URLs preserve special characters on reload", async () => {
  const collection = "Pack + #1?100% & Café";
  const name = "Example + #1?100% & Café";
  fixture.manifest.packs[collection] = {
    version: "1",
    skins: { lmale: [name], mmale: [name] },
    files: [],
  };
  await gallery();
  await selectFilter("CollectionSelect", collection);
  await search(name);
  expect(Object.fromEntries(latestUrl().searchParams)).toEqual({
    collection,
    q: name,
  });
  await reloadGallery();
  expect(host.querySelector("#CollectionSelect").value).toBe(collection);
  expect(host.querySelector("#ModelSelect").value).toBe("all");
  expect(host.querySelector("#SkinSearch").value).toBe(name);
  expect(previews()).toHaveLength(2);
});

test("typing commits before results change without re-rendering the preview cards", async () => {
  fixture.manifest.customSkins.lmale = ["Example", "Extra", "Outside"];
  const previewRenders = () =>
    vi
      .mocked(Link)
      .mock.calls.filter(([props]) => props.href.startsWith("/?m=")).length;
  const commits = [];
  await gallery(() =>
    commits.push({
      query: host.querySelector("#SkinSearch").value,
      previews: previews(),
      renders: previewRenders(),
    }),
  );
  const initialPreviews = previews();
  const initialRenders = previewRenders();
  commits.length = 0;

  await search("Ex");
  // The input must commit immediately while React retains the previous grid.
  expect(commits).toContainEqual({
    query: "Ex",
    previews: initialPreviews,
    renders: initialRenders,
  });
  expect(previews()).toEqual([
    "/gallery-previews/Example.lmale.webp",
    "/gallery-previews/Example.mmale.webp",
    "/gallery-previews/Example.hmale.webp",
    "/gallery-previews/Extra.lmale.webp",
  ]);
  // Narrowing the results should reuse unchanged cards, including their links/icons.
  expect(previewRenders()).toBe(initialRenders);
  await search("Extra");
  expect(host.querySelector("#SkinSearch").value).toBe("Extra");
  expect(previews()).toEqual(["/gallery-previews/Extra.lmale.webp"]);
  expect(previewRenders()).toBe(initialRenders);
});

test.each([
  { query: {}, collection: "all", model: "all", count: 3 },
  { query: { filter: "" }, collection: "all", model: "all", count: 3 },
  { query: { filter: "all" }, collection: "all", model: "all", count: 3 },
  { query: { filter: "lmale" }, collection: "all", model: "lmale", count: 1 },
  { query: { collection: "all" }, collection: "all", model: "all", count: 3 },
  { query: { collection: "Pack" }, collection: "Pack", model: "all", count: 3 },
  { query: { collection: "new" }, collection: "new", model: "all", count: 1 },
  { query: { q: "Example" }, collection: "all", model: "all", count: 3 },
  {
    query: { q: "Example", filter: "mmale" },
    collection: "all",
    model: "all",
    count: 3,
  },
  {
    query: { q: "Example", filter: "Pack" },
    collection: "all",
    model: "all",
    count: 3,
  },
  { query: { filter: "Pack" }, collection: "Pack", model: "all", count: 3 },
  { query: { filter: "new" }, collection: "new", model: "all", count: 1 },
  {
    query: { filter: "hfemale" },
    collection: "all",
    model: "hfemale",
    count: 1,
  },
  {
    query: { collection: "Pack", filter: "mmale" },
    collection: "Pack",
    model: "mmale",
    count: 1,
  },
  {
    query: { collection: "all", filter: "lmale", q: "Example" },
    collection: "all",
    model: "lmale",
    count: 1,
  },
])(
  "split filters preserve gallery entry points: $query",
  async ({ query, collection, model, count }) => {
    fixture.query = query;
    fixture.manifest.newSkins = { lmale: ["Example"] };
    await gallery();
    expect(host.querySelector("#CollectionSelect").value).toBe(collection);
    expect(host.querySelector("#ModelSelect").value).toBe(model);
    expect(host.querySelector("#SkinSearch").hidden).toBe(false);
    expect(previews()).toHaveLength(count);
    if (model === "hfemale")
      expect(previews()[0]).toBe("/gallery-previews/Example.hmale.webp");
  },
);

test("search combines with the visible collection and model, and clearing retains both", async () => {
  fixture.manifest.customSkins.lmale.push("Outside");
  fixture.manifest.packs.Pack.skins.lmale = ["Example", "Another"];
  fixture.manifest.newSkins = { lmale: ["Another"], mmale: ["Example"] };
  await gallery();
  await selectFilter("ModelSelect", "lmale");
  await search("Outside");
  expect(previews()).toEqual(["/gallery-previews/Outside.lmale.webp"]);
  expect(host.querySelector("#ModelSelect").value).toBe("lmale");
  await selectFilter("CollectionSelect", "Pack");
  expect(previews()).toEqual([]);
  expect(host.querySelector('[role="status"]').textContent).toBe(
    "No skins match these filters.",
  );
  await search("Example");
  expect(previews()).toEqual(["/gallery-previews/Example.lmale.webp"]);
  await selectFilter("ModelSelect", "all");
  expect(previews()).toHaveLength(3);
  await selectFilter("CollectionSelect", "new");
  expect(previews()).toEqual(["/gallery-previews/Example.mmale.webp"]);
  await click(host.querySelector('button[aria-label="Clear search"]'));
  expect(host.querySelector("#SkinSearch").value).toBe("");
  expect(host.querySelector("#CollectionSelect").value).toBe("new");
  expect(host.querySelector("#ModelSelect").value).toBe("all");
  expect(previews()).toHaveLength(2);
  expect(document.activeElement).toBe(host.querySelector("#SkinSearch"));
});

test("a filtered pack keeps its full download separate from the preview grid", async () => {
  fixture.query = { filter: "Pack" };
  await gallery();
  await selectFilter("ModelSelect", "lmale");
  await search("Example");
  expect(previews()).toHaveLength(1);
  expect(
    host.querySelector('section[aria-label="Pack pack"] h2').textContent,
  ).toBe("Pack");
  await click(host.querySelector('button[aria-label="Download Pack pack"]'));
  expect(summary()["Files:"]).toBe("3");
  await click(button("Download .vl2"));
  expect(savedFiles()).toHaveLength(3);
});

test("weapon sets default to the selected weapon and retain individual archive names", async () => {
  weapons();
  await click(await gallery());
  expect(radio("Disc Launcher only").checked).toBe(true);
  expect(radio("Full weapon set").checked).toBe(false);
  expect(summary()).toEqual({
    "Models:": "1 (disc)",
    "Files:": "7",
    "HD:": "No",
  });
  await click(button("Download .vl2"));
  expect(vi.mocked(saveZipFile).mock.calls[0][1]).toBe(
    "zWeaponDisc-Example.vl2",
  );
  expect(savedFiles()).toHaveLength(7);
  expect(savedFiles()).toContain("textures/skins/dcase05.png");
  expect(savedFiles()).not.toContain("textures/skins/weapon_chaingun.png");
  expect(dialog()).toBeNull();
});

test("a full weapon set includes matching weapons and excludes players, vehicles, and differently cased names", async () => {
  weapons();
  await click(await gallery());
  await click(radio("Full weapon set"));
  expect(summary()).toEqual({
    "Models:": "2 (disc, chaingun)",
    "Files:": "8",
    "HD:": "No",
  });
  await click(button("Download .vl2"));
  expect(vi.mocked(saveZipFile).mock.calls[0][1]).toBe(
    "zWeaponSkinSet-Example.vl2",
  );
  expect(savedFiles()).toHaveLength(8);
  expect(savedFiles()).toContain("textures/skins/weapon_chaingun.png");
  expect(savedFiles().some((name) => /lmale|tank|energy/.test(name))).toBe(
    false,
  );
});

test("a standalone weapon does not offer a set choice", async () => {
  weapons();
  fixture.manifest.customSkins.chaingun = [];
  await click(await gallery());
  expect(dialog().querySelector('input[name="weapon-scope"]')).toBeNull();
  expect(summary()["Models:"]).toBe("1 (disc)");
});

test("sets preserve material filename overrides, spaces, and standard-resolution game filenames", async () => {
  fixture.query.filter = "plasmathrower";
  fixture.manifest.customSkins = {
    plasmathrower: ["Example"],
    shocklance: ["Example"],
  };
  fixture.manifest.sizeMultiplier = {
    "Example/weapon_shocklance_glow .png": 2,
  };
  globalThis.localStorage.getItem = () => "no";
  await click(await gallery());
  await click(radio("Full weapon set"));
  expect(summary()).toEqual({
    "Models:": "2 (plasmathrower, shocklance)",
    "Files:": "4",
    "HD:": "No",
  });
  expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => url)).toContain(
    "https://assets.tribes2.online/skins/files/Example/weapon_shocklance_glow%20%401x.png",
  );
  await click(button("Download .vl2"));
  expect(vi.mocked(saveZipFile).mock.calls[0][1]).toBe(
    "zWeaponSkinSet-Example@1x.vl2",
  );
  expect(savedFiles()).toEqual([
    "textures/skins/weapon_plasma1.png",
    "textures/skins/weapon_plasma2.png",
    "textures/skins/weapon_shocklance.png",
    "textures/skins/weapon_shocklance_glow .png",
  ]);
});

test("player downloads still collect all armor variants in dropdown order", async () => {
  await click(await gallery());
  expect(dialog().querySelector('input[name="weapon-scope"]')).toBeNull();
  expect(summary()).toEqual({
    "Models:": "3",
    "Files:": "3",
    "HD:": "Yes (requires QoL patch)",
  });
  const rows = [
    ...dialog().querySelectorAll(
      'table[aria-label="Included player models"] tbody tr',
    ),
  ];
  expect(rows.map((row) => row.querySelector("th").textContent)).toEqual([
    "Male",
    "Female",
    "Bioderm",
  ]);
  expect(
    rows.map((row) =>
      [...row.querySelectorAll("td")].map((cell) =>
        cell.getAttribute("aria-label"),
      ),
    ),
  ).toEqual([
    ["Included", "Included", "Included"],
    ["Not included", "Not included", "Not included"],
    ["Not included", "Not included", "Not included"],
  ]);
});

test.each([
  { models: ["hmale"], male: true, female: false },
  { models: ["hmale", "lfemale"], male: false, female: true },
  { models: ["hmale", "mfemale"], male: false, female: true },
  { models: ["hmale", "lfemale", "mfemale"], male: false, female: true },
  { models: ["hmale", "lmale", "lfemale"], male: true, female: true },
  { models: ["hmale", "mmale", "mfemale"], male: true, female: true },
  { models: ["hmale", "mmale"], male: true, female: false },
  { models: ["lmale", "lfemale", "mfemale"], male: false, female: false },
  { models: ["hmale", "lbioderm", "hbioderm"], male: true, female: false },
])(
  "shared heavy-human coverage follows the accompanying variants: %j",
  async ({ models, male, female }) => {
    fixture.query.filter = models[0];
    fixture.manifest.customSkins = Object.fromEntries(
      models.map((model) => [model, ["Example"]]),
    );
    await click(await gallery());
    const cells = [...dialog().querySelectorAll("table tbody td:last-child")];
    expect(
      cells.slice(0, 2).map((cell) => !!cell.querySelector("svg")),
    ).toEqual([male, female]);
    expect(cells[2].getAttribute("aria-label")).toBe(
      models.includes("hbioderm") ? "Included" : "Not included",
    );
    await click(button("Download .vl2"));
    expect(savedFiles()).toHaveLength(models.length);
    expect(savedFiles().includes("textures/skins/Example.hmale.png")).toBe(
      models.includes("hmale"),
    );
  },
);

test.each(["lmale", "mfemale"])(
  "heavy-human coverage excludes unavailable %s variants",
  async (missingModel) => {
    fixture.manifest.customSkins = {
      lmale: ["Example"],
      hmale: ["Example"],
      mfemale: ["Example"],
    };
    vi.mocked(globalThis.fetch).mockImplementation(async (url) =>
      url.endsWith(`.${missingModel}.png`)
        ? { ok: false, status: 404 }
        : response,
    );
    await click(await gallery());
    const cells = [...dialog().querySelectorAll("table tbody td:last-child")];
    expect(
      cells.slice(0, 2).map((cell) => !!cell.querySelector("svg")),
    ).toEqual(missingModel === "lmale" ? [false, true] : [true, false]);
  },
);

test("a gallery VL2 keeps literal names while normalizing the standard-resolution suffix", async () => {
  fixture.manifest.customSkins.lmale = ["R-Skin#1"];
  fixture.manifest.sizeMultiplier["R-Skin#1.lmale.png"] = 2;
  globalThis.localStorage.getItem = () => "no";
  await gallery();
  await click(
    host.querySelector('button[aria-label="Download R-Skin#1 skin"]'),
  );
  expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => url)).toContain(
    "https://assets.tribes2.online/skins/files/R-Skin%231.lmale%401x.png",
  );
  await click(button("Download .vl2"));
  expect(vi.mocked(saveZipFile).mock.calls[0][1]).toBe(
    "zPlayerSkin-R-Skin#1@1x.vl2",
  );
  expect(savedFiles()).toEqual(["textures/skins/R-Skin#1.lmale.png"]);
});

test("rapid clicks open one dialog and cancellation aborts pending requests", async () => {
  let resolve;
  vi.mocked(globalThis.fetch).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const trigger = await gallery();
  await act(async () => {
    trigger.click();
    trigger.click();
  });
  expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  expect(document.querySelectorAll("dialog")).toHaveLength(1);
  expect(button("Preparing…").disabled).toBe(true);
  expect(
    dialog().querySelector('footer [aria-live="polite"]').textContent,
  ).toBe("Preparing…");
  const signal = vi.mocked(globalThis.fetch).mock.calls[0][1].signal;
  await click(button("Cancel"));
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(response));
  expect(dialog()).toBeNull();
  expect(saveZipFile).not.toHaveBeenCalled();
  expect(trigger.disabled).toBe(false);
  await click(trigger);
  expect(button("Download .vl2").disabled).toBe(false);
});

test("changing scope ignores late responses for the previous selection", async () => {
  weapons();
  const pending = [];
  vi.mocked(globalThis.fetch).mockImplementation(
    (url, { signal }) =>
      new Promise((resolve) => pending.push({ url, signal, resolve })),
  );
  await click(await gallery());
  await click(radio("Full weapon set"));
  expect(button("Preparing…").disabled).toBe(true);
  await act(async () =>
    pending
      .filter((item) => !item.signal.aborted)
      .forEach((item) => item.resolve(response)),
  );
  expect(summary()["Files:"]).toBe("8");
  await act(async () =>
    pending
      .filter((item) => item.signal.aborted)
      .forEach((item) => item.resolve(response)),
  );
  expect(summary()["Models:"]).toBe("2 (disc, chaingun)");
  await click(button("Download .vl2"));
  expect(savedFiles()).toHaveLength(8);
});

test("missing overrides are excluded from the model count and HD status without blocking a partial download", async () => {
  vi.mocked(globalThis.fetch).mockImplementation(async (url) =>
    url.endsWith(".mmale.png") ? { ok: false, status: 404 } : response,
  );
  await click(await gallery());
  expect(summary()).toEqual({ "Models:": "2", "Files:": "2", "HD:": "No" });
  await click(button("Download .vl2"));
  expect(savedFiles()).toEqual([
    "textures/skins/Example.lmale.png",
    "textures/skins/Example.hmale.png",
  ]);
});

test("empty downloads and server errors stay in the dialog and can be retried", async () => {
  vi.mocked(globalThis.fetch).mockResolvedValue({ ok: false, status: 404 });
  await click(await gallery());
  expect(dialog().querySelector('[role="alert"]').textContent).toContain(
    "No skin files are available",
  );
  expect(button("Download .vl2")).toBeUndefined();
  vi.mocked(globalThis.fetch).mockRejectedValue(new Error("Connection lost"));
  await click(button("Try again"));
  expect(dialog().querySelector('[role="alert"]').textContent).toContain(
    "Connection lost",
  );
  vi.mocked(globalThis.fetch).mockResolvedValue(response);
  await click(button("Try again"));
  expect(button("Download .vl2").disabled).toBe(false);
  expect(window.alert).not.toHaveBeenCalled();
  expect(window.confirm).not.toHaveBeenCalled();
});

test("leaving the gallery aborts preparation and never saves", async () => {
  let resolve;
  vi.mocked(globalThis.fetch).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await click(await gallery());
  const signal = vi.mocked(globalThis.fetch).mock.calls[0][1].signal;
  await act(async () => root.unmount());
  root = null;
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(response));
  expect(saveZipFile).not.toHaveBeenCalled();
});

test("packs use the same dialog and retain their filenames", async () => {
  fixture.query.filter = "Pack";
  await gallery();
  await click(host.querySelector('button[aria-label="Download Pack pack"]'));
  expect(summary()["Models:"]).toBe("3 (lmale, mmale, hmale)");
  await click(button("Download .vl2"));
  expect(vi.mocked(saveZipFile).mock.calls[0][1]).toBe("zSkinPack-Pack-v1.vl2");
});

test("Ask chooses HD support inside the dialog before fetching any files", async () => {
  globalThis.localStorage.getItem = () => null;
  await click(await gallery());
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(button("Download .vl2").disabled).toBe(true);
  await click(radio("Standard"));
  expect(summary()["HD:"]).toBe("No");
  expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => url)).toContain(
    "https://assets.tribes2.online/skins/files/Example.mmale%401x.png",
  );
  expect(globalThis.localStorage.setItem).toHaveBeenCalledWith(
    "hiResDownload",
    "no",
  );
});

test("HD is recalculated when a full set adds an HD weapon", async () => {
  weapons();
  globalThis.localStorage.getItem = () => null;
  fixture.manifest.sizeMultiplier["Example/weapon_chaingun.png"] = 2;
  await click(await gallery());
  expect(summary()["HD:"]).toBe("No");
  await click(radio("Full weapon set"));
  expect(button("Download .vl2").disabled).toBe(true);
  await click(radio("HD"));
  expect(summary()["HD:"]).toBe("Yes (requires QoL patch)");
  await click(button("Download .vl2"));
  expect(savedFiles()).toContain("textures/skins/weapon_chaingun.png");
});

test("Escape closes the dialog without saving", async () => {
  await click(await gallery());
  await act(async () =>
    dialog().dispatchEvent(new window.Event("cancel", { cancelable: true })),
  );
  expect(dialog()).toBeNull();
  expect(saveZipFile).not.toHaveBeenCalled();
});

test("failed archive creation remains retryable and saving cannot be triggered twice", async () => {
  let reject;
  vi.mocked(saveZipFile).mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await click(await gallery());
  await act(async () => {
    button("Download .vl2").click();
    button("Download .vl2").click();
  });
  expect(saveZipFile).toHaveBeenCalledTimes(1);
  expect(button("Preparing…").disabled).toBe(true);
  expect(
    dialog().querySelector('footer [aria-live="polite"]').textContent,
  ).toBe("Preparing…");
  await act(async () => reject(new Error("Archive failed")));
  expect(dialog().querySelector('[role="alert"]').textContent).toContain(
    "Archive failed",
  );
  await click(button("Try again"));
  await click(button("Download .vl2"));
  expect(dialog()).toBeNull();
});

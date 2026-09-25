import { afterEach, beforeEach, expect, test, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import GalleryPage from "./page";
import { saveZipFile } from "../../exportUtils";

const fixture = vi.hoisted(() => ({ query: {}, manifest: null }));
vi.mock("nuqs", async () => {
  const { useState } = await import("react");
  return {
    useQueryState: (key, options) => useState(fixture.query[key] ?? options.defaultValue),
  };
});
vi.mock("../../useManifest", () => ({ default: () => [fixture.manifest, true] }));
vi.mock("next/head", () => ({ default: () => null }));
vi.mock("next/link", () => ({ default: (props) => React.createElement("a", props) }));
vi.mock("file-saver", () => ({ saveAs: vi.fn() }));
vi.mock("../../deployPaths", async (importOriginal) => ({
  ...await importOriginal(),
  SKIN_GALLERY_BASE_URL: "/gallery-previews",
}));
vi.mock("../../exportUtils", async (importOriginal) => ({
  ...await importOriginal(),
  saveZipFile: vi.fn(async () => {}),
}));

const { document, window } = globalThis;
const data = new Uint8Array([1, 2, 3]).buffer;
const response = { ok: true, arrayBuffer: async () => data };
let root, host;

beforeEach(() => {
  fixture.query = {};
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
  vi.stubGlobal("localStorage", { getItem: () => "yes", setItem: vi.fn(), removeItem: vi.fn() });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
  vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.spyOn(window, "alert").mockImplementation(() => {});
  vi.mocked(saveZipFile).mockClear();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.restoreAllMocks();
});

async function gallery() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(GalleryPage)));
  return host.querySelector('button[aria-label="Download Example skin"]');
}

test.each(["Café + #1?100% & Blue", "Literal%23"])("gallery previews and editor links preserve %j", async (name) => {
  fixture.manifest.customSkins.lmale = [name];
  await gallery();
  const image = host.querySelector("img");
  const previewUrl = new globalThis.URL(image.getAttribute("src"), "https://example.com");
  expect(previewUrl.hash).toBe("");
  expect(previewUrl.search).toBe("");
  expect(decodeURIComponent(previewUrl.pathname)).toBe(`/gallery-previews/${name}.lmale.webp`);
  const editorLink = [...host.querySelectorAll("a")].find((link) => link.querySelector("svg[aria-label='Load in Editor']"));
  const editorUrl = new globalThis.URL(editorLink.getAttribute("href"), "https://example.com");
  expect(editorUrl.searchParams.get("s")).toBe(name);
  expect(editorUrl.searchParams.get("m")).toBe("lmale");
});

test("a gallery VL2 keeps the skin name while normalizing the standard-resolution texture suffix", async () => {
  fixture.manifest.customSkins.lmale = ["R-Skin#1"];
  fixture.manifest.sizeMultiplier["R-Skin#1.lmale.png"] = 2;
  globalThis.localStorage.getItem = () => "no";
  vi.mocked(window.confirm).mockReturnValue(true);
  await gallery();
  const button = host.querySelector('button[aria-label="Download R-Skin#1 skin"]');
  await act(async () => button.click());
  expect(globalThis.fetch).toHaveBeenCalledWith(
    "https://assets.tribes2.online/skins/files/R-Skin%231.lmale%401x.png",
  );
  const [zip, name] = vi.mocked(saveZipFile).mock.calls[0];
  expect(name).toBe("zPlayerSkin-R-Skin#1@1x.vl2");
  expect(Object.keys(zip.files).filter((path) => !zip.files[path].dir)).toEqual([
    "textures/skins/R-Skin#1.lmale.png",
  ]);
});

test("rapid clicks share one preparation and cancellation allows a retry", async () => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  vi.mocked(globalThis.fetch).mockReturnValue(pending);
  const button = await gallery();
  try {
    await act(async () => { button.click(); button.click(); });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    expect(button.disabled).toBe(true);
    expect(host.querySelector("#hiResSelect").disabled).toBe(true);
    await act(async () => resolve(response));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(saveZipFile).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(window.confirm).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => resolve(response));
  }
});

test("missing overrides are excluded from the models, file count, and HD status", async () => {
  vi.mocked(globalThis.fetch).mockImplementation(async (url) => url.endsWith(".mmale.png")
    ? { ok: false, status: 404 }
    : response);
  const button = await gallery();
  await act(async () => button.click());
  expect(window.confirm).toHaveBeenCalledWith(
    "Download “Example”?\n\nModels: 2 (lmale, hmale)\nFiles: 2\nHD: No",
  );
  expect(saveZipFile).not.toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(true);
  await act(async () => button.click());
  const [zip] = vi.mocked(saveZipFile).mock.calls[0];
  expect(Object.keys(zip.files).filter((name) => name.endsWith(".png"))).toEqual([
    "textures/skins/Example.lmale.png", "textures/skins/Example.hmale.png",
  ]);
});

test("an entirely unavailable skin does not offer an empty archive", async () => {
  vi.mocked(globalThis.fetch).mockResolvedValue({ ok: false, status: 404 });
  const button = await gallery();
  await act(async () => button.click());
  expect(window.confirm).not.toHaveBeenCalled();
  expect(window.alert).toHaveBeenCalledWith("No skin files are available to download.");
  expect(saveZipFile).not.toHaveBeenCalled();
});

test("server errors release the download controls for retry", async () => {
  vi.mocked(globalThis.fetch).mockRejectedValue(new Error("Connection lost"));
  const button = await gallery();
  await act(async () => button.click());
  expect(window.alert).toHaveBeenCalledWith("Connection lost");
  expect(button.disabled).toBe(false);
  vi.mocked(globalThis.fetch).mockResolvedValue(response);
  await act(async () => button.click());
  expect(window.confirm).toHaveBeenCalledTimes(1);
});

test("leaving the gallery while files load does not open a stale confirmation", async () => {
  let resolve;
  vi.mocked(globalThis.fetch).mockReturnValue(new Promise((done) => { resolve = done; }));
  const button = await gallery();
  await act(async () => button.click());
  await act(async () => root.unmount());
  root = null;
  await act(async () => resolve(response));
  expect(window.confirm).not.toHaveBeenCalled();
  expect(window.alert).not.toHaveBeenCalled();
  expect(saveZipFile).not.toHaveBeenCalled();
});

test("pack cancellation shows models in dropdown order and releases the controls", async () => {
  fixture.query.filter = "Pack";
  await gallery();
  const button = [...host.querySelectorAll("button")].find((button) => button.textContent === "Download");
  await act(async () => button.click());
  expect(window.confirm).toHaveBeenCalledWith(
    "Download “Pack”?\n\nModels: 3 (lmale, mmale, hmale)\nFiles: 3\nHD: Yes (requires QoL patch)",
  );
  expect(saveZipFile).not.toHaveBeenCalled();
  expect(button.disabled).toBe(false);
});

test.each(["lmale", "Pack"])("%s downloads report HD: No when using standard-resolution alternatives", async (selection) => {
  fixture.query.filter = selection;
  globalThis.localStorage.getItem = () => "no";
  const skinButton = await gallery();
  const button = selection === "Pack"
    ? [...host.querySelectorAll("button")].find((button) => button.textContent === "Download")
    : skinButton;
  await act(async () => button.click());
  expect(globalThis.fetch).toHaveBeenCalledWith(
    "https://assets.tribes2.online/skins/files/Example.mmale%401x.png",
  );
  expect(window.confirm).toHaveBeenCalledWith(
    `Download “${selection === "Pack" ? "Pack" : "Example"}”?\n\nModels: 3 (lmale, mmale, hmale)\nFiles: 3\nHD: No`,
  );
});

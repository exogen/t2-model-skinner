import { afterEach, expect, test, vi } from "vitest";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { collectFiles, createZipFile, exportSkinTextures } from "./exportUtils";

vi.mock("file-saver", () => ({ saveAs: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

test.each(["BloodBanshee.lfemale.png", "BloodBanshee.lfemale@1x.png"])(
  "a missing %s override can fall back to the stock texture",
  async (filename) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false, status: 404, statusText: "Not Found",
    });
    await expect(collectFiles([filename], { skipNotFound: true })).resolves.toEqual([]);
  }
);

test("standard-resolution downloads restore game filenames and omit missing overrides", async () => {
  const data = new Uint8Array([1, 2, 3]).buffer;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
    url.endsWith("dcase00.png")
      ? { ok: false, status: 404 }
      : { ok: true, arrayBuffer: async () => data }
  );
  const files = await collectFiles([
    "BloodBanshee.lfemale@1x.png", "Neon/dcase00.png",
  ], { skipNotFound: true });
  expect(files).toEqual([{ name: "BloodBanshee.lfemale.png", data }]);
  const zip = createZipFile(files);
  expect(await zip.file("textures/skins/BloodBanshee.lfemale.png").async("uint8array"))
    .toEqual(new Uint8Array(data));
});

test("temporary server errors still report download failures", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: false, status: 500, statusText: "Server Error",
  });
  await expect(collectFiles(["effect.png"], { skipNotFound: true }))
    .rejects.toThrow("500");
});

test.each([
  ["R-Skin#1.lmale.png", "R-Skin%231.lmale.png"],
  ["Folder/Skin #1?100%/weapon_disc.png", "Folder/Skin%20%231%3F100%25/weapon_disc.png"],
  ["Literal%23.lmale.png", "Literal%2523.lmale.png"],
])("downloads %s without interpreting its name as a URL fragment or query", async (filename, path) => {
  const data = new Uint8Array([1, 2, 3]).buffer;
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true, arrayBuffer: async () => data,
  });
  const files = await collectFiles([filename]);
  expect(fetch).toHaveBeenCalledWith(`https://assets.tribes2.online/skins/files/${path}`);
  expect(files[0].name).toBe(filename);
  const zip = await JSZip.loadAsync(await createZipFile(files).generateAsync({ type: "uint8array" }));
  expect(Object.keys(zip.files).filter((name) => !zip.files[name].dir)).toEqual([
    `textures/skins/${filename}`,
  ]);
  expect(await zip.file(`textures/skins/${filename}`).async("uint8array")).toEqual(new Uint8Array(data));
});

test.each([
  ["R-Skin#1", 1], ["Literal%23", 1], ["Café + 50%", 2],
])("editor VL2 export preserves %j in both the download and texture filenames", async (name, sizeMultiplier) => {
  const data = new Uint8Array([1, 2, 3]).buffer;
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true, arrayBuffer: async () => data,
  });
  await exportSkinTextures([
    { material: { name: "base" }, frameIndex: 0, colorImageUrl: "data:image/png;base64,AQID" },
  ], { format: "vl2", name, model: "lmale", sizeMultiplier }, vi.fn());
  const [blob, downloadName] = vi.mocked(saveAs).mock.calls.at(-1);
  expect(downloadName).toBe(`zPlayerSkin-${name}${sizeMultiplier > 1 ? "-@2x" : ""}.vl2`);
  const bytes = await new Promise((resolve, reject) => {
    const reader = new globalThis.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  const zip = await JSZip.loadAsync(bytes);
  expect(Object.keys(zip.files).filter((path) => !zip.files[path].dir)).toEqual([
    `textures/skins/${name}.lmale.png`,
  ]);
  expect(await zip.file(`textures/skins/${name}.lmale.png`).async("uint8array")).toEqual(new Uint8Array(data));
});

test("editor PNG export also preserves literal percent and hash characters", async () => {
  const imageUrl = "data:image/png;base64,AQID";
  await exportSkinTextures([
    { material: { name: "base" }, frameIndex: 0, colorImageUrl: imageUrl },
  ], { format: "png", name: "Skin%23 #1", model: "lmale", sizeMultiplier: 1 }, vi.fn());
  expect(saveAs).toHaveBeenLastCalledWith(imageUrl, "Skin%23 #1.lmale.png");
});

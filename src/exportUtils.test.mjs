import { afterEach, expect, test, vi } from "vitest";
import { collectFiles, createZipFile } from "./exportUtils";

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

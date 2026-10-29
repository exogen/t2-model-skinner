import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getEnv } from "fabric";

const { document } = getEnv();
const originalFetch = globalThis.fetch;
let gallery;

beforeEach(async () => {
  // A fresh module, so the list, the screenshots and the chosen map start
  // empty, and no network: the map list fails unless a test serves it.
  vi.resetModules();
  vi.restoreAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("offline");
    }),
  );
  gallery = await import("./mapBackgrounds");
});

afterEach(() => {
  vi.stubGlobal("fetch", originalFetch);
});

function serveMaps(missions) {
  globalThis.fetch.mockImplementation(async () => ({
    ok: true,
    json: async () => missions,
  }));
}

/** Replaces document.createElement("img") with images that load or fail
 * when told to. */
function fakeImages() {
  const images = [];
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((name) => {
    if (name !== "img") return createElement(name);
    const image = {
      set src(url) {
        images.push({ image, url });
      },
    };
    return image;
  });
  return images;
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

test("the map list keeps maps with screenshots, adds the file name to shared names and sorts by name", () => {
  expect(
    gallery.parseMaps({
      b: { missionName: "Map10", displayName: "Map 10", imageCount: 2 },
      a: { missionName: "Map2", displayName: " Map 2 ", imageCount: 1 },
      c: {
        missionName: "BeggarsRunLak",
        displayName: "Beggar's Run",
        imageCount: 4,
      },
      d: {
        missionName: "BeggarsRun",
        displayName: "Beggar's Run",
        imageCount: 3,
      },
      e: { missionName: "zeta", displayName: null, imageCount: 5 },
      f: { missionName: "NoImages", displayName: "No Images", imageCount: 0 },
      g: { displayName: "Nameless", imageCount: 1 },
      h: null,
    }),
  ).toEqual([
    {
      mission: "BeggarsRun",
      label: "Beggar's Run (BeggarsRun)",
      imageCount: 3,
    },
    {
      mission: "BeggarsRunLak",
      label: "Beggar's Run (BeggarsRunLak)",
      imageCount: 4,
    },
    { mission: "Map2", label: "Map 2", imageCount: 1 },
    { mission: "Map10", label: "Map 10", imageCount: 2 },
    { mission: "zeta", label: "zeta", imageCount: 5 },
  ]);
  expect(gallery.parseMaps(null)).toEqual([]);
  expect(gallery.parseMaps("missions")).toEqual([]);
});

test("screenshots are addressed by mission and number", () => {
  expect(gallery.mapImageUrl("DX_Ice", 2)).toBe(
    "https://exogen.github.io/t2-maps/images/DX_Ice.2.webp",
  );
  expect(gallery.mapImageUrl("Odd Name#1", 1)).toBe(
    "https://exogen.github.io/t2-maps/images/Odd%20Name%231.1.webp",
  );
});

test("the map list loads once from the gallery, and a failed load is tried again", async () => {
  globalThis.fetch
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        a: { missionName: "DX_Ice", displayName: "Ice", imageCount: 2 },
      }),
    });
  await expect(gallery.loadMaps()).rejects.toThrow("HTTP 503");
  expect(await gallery.loadMaps()).toEqual([
    { mission: "DX_Ice", label: "Ice", imageCount: 2 },
  ]);
  await gallery.loadMaps();
  expect(globalThis.fetch.mock.calls.map(([url]) => url)).toEqual(
    Array(2).fill("https://exogen.github.io/t2-maps/missions.json"),
  );
});

test("the photos get the map's first screenshots in order, starting over when it has fewer", async () => {
  serveMaps({
    a: { missionName: "DX_Ice", displayName: "Ice", imageCount: 2 },
    b: { missionName: "Big", displayName: "Big", imageCount: 5 },
  });
  const images = fakeImages();
  const pictures = gallery.loadMapPictures("DX_Ice", 3);
  await settle();
  // Loaded with CORS, so a strip drawn over them can still be saved.
  expect(images.map(({ image, url }) => [image.crossOrigin, url])).toEqual(
    [1, 2].map((image) => ["anonymous", gallery.mapImageUrl("DX_Ice", image)]),
  );
  images.forEach(({ image }) => image.onload());
  const [first, second] = images.map(({ image }) => image);
  const [one, two, three] = await pictures;
  expect([one === first, two === second, three === first]).toEqual([
    true,
    true,
    true,
  ]);
  // A map with more screenshots uses only the first ones.
  const big = gallery.loadMapPictures("Big", 3);
  await settle();
  expect(images.slice(2).map(({ url }) => url)).toEqual(
    [1, 2, 3].map((image) => gallery.mapImageUrl("Big", image)),
  );
  images.slice(2).forEach(({ image }) => image.onload());
  await big;
});

test("without the map list, screenshots that don't exist are skipped, and none loading leaves none", async () => {
  const images = fakeImages();
  const pictures = gallery.loadMapPictures("Katabatic", 3);
  await settle();
  expect(images.map(({ url }) => url)).toEqual(
    [1, 2, 3].map((image) => gallery.mapImageUrl("Katabatic", image)),
  );
  images[0].image.onload();
  images[1].image.onerror();
  images[2].image.onerror();
  expect(
    (await pictures).map((picture) => picture === images[0].image),
  ).toEqual([true, true, true]);
  const none = gallery.loadMapPictures("Nowhere", 3);
  await settle();
  images.slice(3).forEach(({ image }) => image.onerror());
  expect(await none).toEqual([]);
});

test("screenshots load once, and one that failed is tried again", async () => {
  serveMaps({ a: { missionName: "One", displayName: "One", imageCount: 1 } });
  const images = fakeImages();
  const failed = gallery.loadMapPictures("One", 3);
  await settle();
  images[0].image.onerror();
  expect(await failed).toEqual([]);
  const loaded = gallery.loadMapPictures("One", 3);
  await settle();
  expect(images).toHaveLength(2);
  images[1].image.onload();
  expect((await loaded).every((picture) => picture === images[1].image)).toBe(
    true,
  );
  await gallery.loadMapPictures("One", 3);
  expect(images).toHaveLength(2);
});

test("only the last few maps' screenshots stay loaded", async () => {
  const images = fakeImages();
  for (let map = 1; map <= 10; map++)
    void gallery.loadMapPictures(`Map${map}`, 1);
  await settle();
  expect(images).toHaveLength(10);
  void gallery.loadMapPictures("Map10", 1);
  await settle();
  expect(images).toHaveLength(10);
  void gallery.loadMapPictures("Map1", 1);
  await settle();
  expect(images).toHaveLength(11);
  images.forEach(({ image }) => image.onerror());
  await settle();
});

test("a map list without maps counts as failed, so it's tried again", async () => {
  globalThis.fetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ unexpected: true }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        a: { missionName: "DX_Ice", displayName: "Ice", imageCount: 2 },
      }),
    });
  await expect(gallery.loadMaps()).rejects.toThrow("no maps");
  expect(await gallery.loadMaps()).toHaveLength(1);
});

test("screenshots that take longer than 10 seconds leave the photos without", async () => {
  vi.useFakeTimers();
  try {
    const images = fakeImages();
    let result = null;
    const pictures = gallery.loadMapPictures("Slow", 3).then((value) => {
      result = value;
    });
    await vi.advanceTimersByTimeAsync(9999);
    expect([images.length, result]).toEqual([3, null]);
    await vi.advanceTimersByTimeAsync(1);
    await pictures;
    expect(result).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("the chosen map lasts until the page reloads", async () => {
  expect(gallery.chosenMapBackground()).toBeNull();
  gallery.chooseMapBackground("DX_Ice");
  expect(gallery.chosenMapBackground()).toBe("DX_Ice");
  vi.resetModules();
  gallery = await import("./mapBackgrounds");
  expect(gallery.chosenMapBackground()).toBeNull();
});

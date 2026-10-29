import { afterEach, expect, test, vi } from "vitest";
import { getEnv } from "fabric";
import {
  captionLayouts,
  fallbackStripArt,
  PHOTO_HEIGHT,
  PHOTO_WIDTH,
  renderBoothStrip,
  renderPhoto,
  renderPhotoStrip,
  STRIP_WIDTH,
} from "./photos";

const { document } = getEnv();

// Canvas property setters like fillStyle and font don't apply under Node 24,
// so the sources are painted pixel by pixel and the tests check placement, not
// color. Text measures at the default font, so the header's size here is not
// the real one, and every caption fits on one line; captionLayouts gets a fake
// measurer instead. jsdom passes drawImage the native canvas behind an
// element, so draws are told apart by size.
function solid(width, height, color) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const image = context.createImageData(width, height);
  for (let i = 0; i < image.data.length; i += 4) image.data.set(color, i);
  context.putImageData(image, 0, 0);
  return canvas;
}

function pixel(canvas, x, y) {
  return Array.from(canvas.getContext("2d").getImageData(x, y, 1, 1).data);
}

const red = [255, 0, 0, 255];
const green = [0, 255, 0, 255];
const blue = [0, 0, 255, 255];
const yellow = [255, 255, 0, 255];

/** Measures like a monospace font with 0.6em characters and a 0.6em cap
 * height. */
function monospace() {
  return {
    font: "10px monospace",
    measureText(text) {
      const size = parseFloat(this.font);
      return {
        width: Array.from(text).length * 0.6 * size,
        actualBoundingBoxAscent: 0.6 * size,
      };
    },
  };
}

const lines = (layout) => layout.lines.map((line) => line.join(""));

function spyOnContext() {
  const context = Object.getPrototypeOf(
    document.createElement("canvas").getContext("2d"),
  );
  return {
    fillText: vi.spyOn(context, "fillText"),
    drawImage: vi.spyOn(context, "drawImage"),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("a photo contains the captured frame scaled to fit and centered", () => {
  const photo = renderPhoto(solid(4, 2, red), 8, 8);
  expect([photo.width, photo.height]).toEqual([8, 8]);
  for (const y of [3, 4]) expect(pixel(photo, 4, y)).toEqual(red);
  for (const y of [0, 7]) expect(pixel(photo, 4, y)).not.toEqual(red);
  const full = renderPhoto(solid(6, 4, blue));
  expect([full.width, full.height]).toEqual([6, 4]);
  expect(pixel(full, 0, 0)).toEqual(blue);
});

/** A transparent canvas with a red block where the model is. */
function capturedFrame(width, height, block) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  if (block) {
    const context = canvas.getContext("2d");
    const image = context.createImageData(block.width, block.height);
    for (let i = 0; i < image.data.length; i += 4) image.data.set(red, i);
    context.putImageData(image, block.x, block.y);
  }
  return canvas;
}

test("a photo over a map screenshot crops the screenshot to fill it and draws the frame on top", () => {
  const photo = renderPhoto(
    capturedFrame(8, 6, { x: 3, y: 2, width: 2, height: 2 }),
    8,
    6,
    solid(16, 9, blue),
  );
  for (const [x, y] of [
    [0, 0],
    [7, 0],
    [0, 5],
    [7, 5],
  ])
    expect(pixel(photo, x, y)).toEqual(blue);
  expect(pixel(photo, 4, 3)).toEqual(red);
});

test("a booth strip draws each captured frame over its own background, or the gradient without one", () => {
  const { drawImage } = spyOnContext();
  const frames = [1, 2, 3].map(() => capturedFrame(PHOTO_WIDTH, PHOTO_HEIGHT));
  const strip = renderBoothStrip(
    frames,
    { skin: "Blood Eagle", model: "Human Male", armor: "Light armor" },
    { logo: solid(580, 177, yellow) },
    [solid(16, 9, blue), solid(16, 9, green)],
  );
  const tops = drawImage.mock.calls
    .filter((call) => call[3] === PHOTO_WIDTH && call[1] === 76)
    .map((call) => call[2]);
  expect(tops).toHaveLength(3);
  expect(pixel(strip, 400, tops[0] + 243)).toEqual(blue);
  expect(pixel(strip, 400, tops[1] + 243)).toEqual(green);
  for (const color of [blue, green])
    expect(pixel(strip, 400, tops[2] + 243)).not.toEqual(color);
});

test("a photo strip opens with Hello from the logo and the site, then captions each photo below it", () => {
  const { fillText, drawImage } = spyOnContext();
  const logo = solid(580, 177, yellow);
  const strip = renderPhotoStrip(
    [
      solid(PHOTO_WIDTH, PHOTO_HEIGHT, red),
      solid(PHOTO_WIDTH, PHOTO_HEIGHT, green),
      solid(PHOTO_WIDTH, PHOTO_HEIGHT, blue),
    ],
    { skin: "Blood Eagle", model: "Human Male", armor: "Light armor" },
    { logo },
  );
  expect([PHOTO_WIDTH, PHOTO_HEIGHT]).toEqual([648, 486]);
  expect(strip.width).toBe(STRIP_WIDTH);
  const tops = drawImage.mock.calls
    .filter((call) => call[3] === PHOTO_WIDTH)
    .map((call) => call[2]);
  expect(tops).toHaveLength(3);
  // One-line captions keep the bands between photos at 66px.
  expect([tops[1] - tops[0], tops[2] - tops[1]]).toEqual([
    PHOTO_HEIGHT + 66,
    PHOTO_HEIGHT + 66,
  ]);
  expect(strip.height).toBe(tops[2] + PHOTO_HEIGHT + 66 + 12);
  [red, green, blue].forEach((color, index) => {
    expect(pixel(strip, 400, tops[index] + 243)).toEqual(color);
    // Rounded corners.
    expect(pixel(strip, 100, tops[index] + 24)).toEqual(color);
    expect(pixel(strip, 77, tops[index] + 1)).not.toEqual(color);
  });

  const textBetween = (top, bottom) =>
    fillText.mock.calls
      .filter(([text, , y]) => text !== "Hello from" && y > top && y < bottom)
      .map(([text]) => text)
      .join("");
  expect(textBetween(tops[0] + PHOTO_HEIGHT, tops[1])).toBe("BLOOD EAGLE");
  expect(textBetween(tops[1] + PHOTO_HEIGHT, tops[2])).toBe("HUMAN MALE");
  expect(textBetween(tops[2] + PHOTO_HEIGHT, strip.height)).toBe("LIGHT ARMOR");

  // The script's shade, then its letters.
  expect(
    fillText.mock.calls.filter(([text]) => text === "Hello from"),
  ).toHaveLength(2);
  const [, x, y, width, height] = drawImage.mock.calls.find(
    (call) => call[3] === 580,
  );
  expect([width, height]).toEqual([580, 177]);
  // The logo's artwork ends at the photos' right edge, above the first photo.
  expect(Math.abs(x + 0.976 * 580 - (STRIP_WIDTH - 76))).toBeLessThan(1);
  expect(y + height).toBeLessThan(tops[0]);
  expect(
    pixel(strip, Math.round(x + width / 2), Math.round(y + height / 2)),
  ).toEqual(yellow);
  expect(textBetween(y, tops[0])).toBe("SKINS.TRIBES2.ONLINE");
});

test("without the logo the strip draws its name as text in the logo's place", () => {
  const { fillText, drawImage } = spyOnContext();
  const art = fallbackStripArt();
  expect([art.logo.width, art.logo.height]).toEqual([580, 177]);
  expect(fillText.mock.calls.map(([text]) => text)).toEqual(["TRIBES 2"]);
  renderPhotoStrip(
    [solid(PHOTO_WIDTH, PHOTO_HEIGHT, red)],
    { skin: "Blood Eagle", model: "Human Male", armor: "" },
    art,
  );
  expect(drawImage.mock.calls.filter((call) => call[3] === 580)).toHaveLength(
    1,
  );
});

test("captions are set at one size with wide letter spacing, and an empty one is left out", () => {
  const [skin, model, armor] = captionLayouts(monospace(), [
    "Blood Eagle",
    "Human Male",
    "Light armor",
  ]);
  expect([lines(skin), lines(model), lines(armor)]).toEqual([
    ["BLOOD EAGLE"],
    ["HUMAN MALE"],
    ["LIGHT ARMOR"],
  ]);
  expect([skin.size, model.size, armor.size]).toEqual([28, 28, 28]);
  expect(skin.tracking).toBeCloseTo(0.2 * 28);
  expect(
    captionLayouts(monospace(), ["Blood Eagle", "", " "]).slice(1),
  ).toEqual([null, null]);
});

test("a long skin name wraps onto two balanced lines and the other captions are set at the same size", () => {
  const [skin, model, armor] = captionLayouts(monospace(), [
    "Diamond Sword Legendary Commander Edition (Winter Camo)",
    "Bioderm",
    "Heavy armor",
  ]);
  expect(lines(skin)).toEqual([
    "DIAMOND SWORD LEGENDARY",
    "COMMANDER EDITION (WINTER CAMO)",
  ]);
  expect([skin.size, model.size, armor.size]).toEqual([24, 24, 24]);
  expect(skin.blockHeight).toBeCloseTo(0.6 * 24 + 1.25 * 24);
});

test("names joined with hyphens or underscores break after them, and other long words break mid-word with a hyphen", () => {
  const measure = monospace();
  const [catalog] = captionLayouts(measure, [
    "turtledove-officially-licensed-skin",
  ]);
  expect(lines(catalog)).toEqual(["TURTLEDOVE-OFFICIALLY-", "LICENSED-SKIN"]);
  const [underscored] = captionLayouts(measure, [
    "DOM_Defence_Assistant_team_Captain",
  ]);
  expect(lines(underscored)).toEqual([
    "DOM_DEFENCE_",
    "ASSISTANT_TEAM_CAPTAIN",
  ]);
  const [word] = captionLayouts(measure, [
    "Supercalifragilisticexpialidocious",
  ]);
  expect(lines(word)).toEqual(["SUPERCALIFRAGILI-", "STICEXPIALIDOCIOUS"]);
});

test("a caption too long for two lines ends with an ellipsis", () => {
  const [long] = captionLayouts(monospace(), [
    Array(30).fill("Long").join(" "),
  ]);
  expect(long.size).toBe(20);
  expect(long.lines).toHaveLength(2);
  expect(long.lines[0].at(-1)).toBe("G");
  expect(long.lines[1].at(-1)).toBe("…");
  for (const line of long.lines) {
    expect(
      line.length * 0.6 * 20 + (line.length - 1) * long.tracking,
    ).toBeLessThanOrEqual(600);
  }
});

test("emoji stay whole and right-to-left names are drawn unspaced", () => {
  const measure = monospace();
  const [pirate] = captionLayouts(measure, ["🏴‍☠️ Crew"]);
  expect(pirate.lines[0][0]).toBe("🏴‍☠️");
  const [hebrew] = captionLayouts(measure, ["שלום עולם"]);
  expect(hebrew.lines).toEqual([["שלום עולם"]]);
  expect(hebrew.tracking).toBe(0);
});

test("the strip's fonts and logo load once, and a logo that fails is drawn as text and tried again", async () => {
  vi.resetModules();
  const { loadStripArt } = await import("./photos");
  const images = [];
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((name) => {
    if (name !== "img") return createElement(name);
    const image = {
      naturalWidth: 580,
      naturalHeight: 177,
      set src(url) {
        images.push({ image, url });
      },
    };
    return image;
  });
  // jsdom has no font loading; the strip still gets its art.
  const failed = loadStripArt();
  expect(images.map(({ url }) => url)).toEqual(["/tribes2-logo.png"]);
  images[0].image.onerror();
  const { logo: fallback } = await failed;
  expect([fallback.tagName, fallback.width, fallback.height]).toEqual([
    "CANVAS",
    580,
    177,
  ]);

  const fonts = { load: vi.fn(async () => []) };
  document.fonts = fonts;
  try {
    const loaded = loadStripArt();
    expect(images).toHaveLength(2);
    images[1].image.onload();
    expect((await loaded).logo).toBe(images[1].image);
    expect(loadStripArt()).toBe(loaded);
    expect(images).toHaveLength(2);
    expect(fonts.load.mock.calls.map(([font]) => font)).toEqual([
      expect.stringContaining('"Share Tech Mono"'),
      expect.stringContaining('"Yellowtail"'),
    ]);
  } finally {
    delete document.fonts;
  }
});

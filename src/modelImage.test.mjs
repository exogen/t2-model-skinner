import { afterEach, expect, test, vi } from "vitest";
import { getEnv } from "fabric";
import {
  canvasBlob,
  imageFileName,
  skinLabel,
  trimTransparent,
} from "./modelImage";

const { document } = getEnv();

// Canvas property setters like fillStyle don't apply under Node 24, so the
// images are painted pixel by pixel.
function canvas(width, height, pixels = []) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const context = element.getContext("2d");
  for (const [x, y, color] of pixels) {
    const image = context.createImageData(1, 1);
    image.data.set(color);
    context.putImageData(image, x, y);
  }
  return element;
}

function solid(width, height, color) {
  return canvas(
    width,
    height,
    Array.from({ length: width * height }, (_, i) => [
      i % width,
      Math.floor(i / width),
      color,
    ]),
  );
}

function pixel(source, x, y) {
  return Array.from(source.getContext("2d").getImageData(x, y, 1, 1).data);
}

const red = [255, 0, 0, 255];
const faint = [0, 0, 255, 1];

afterEach(() => {
  vi.restoreAllMocks();
});

test("trimming keeps every pixel that isn't fully transparent, plus a margin", () => {
  const source = canvas(20, 10, [
    [4, 3, red],
    [12, 6, faint],
  ]);
  const trimmed = trimTransparent(source, 2);
  expect([trimmed.width, trimmed.height]).toEqual([9 + 4, 4 + 4]);
  expect(pixel(trimmed, 2, 2)).toEqual(red);
  expect(pixel(trimmed, 10, 5)[3]).toBe(1);
  expect(pixel(trimmed, 0, 0)).toEqual([0, 0, 0, 0]);
  expect(pixel(trimmed, 12, 7)).toEqual([0, 0, 0, 0]);
  expect([
    trimTransparent(source).width,
    trimTransparent(source).height,
  ]).toEqual([9, 4]);
});

test("trimming an image with nothing in it gives nothing", () => {
  expect(trimTransparent(canvas(8, 8), 4)).toBeNull();
});

test("skins are named the way the skin dropdown names them", () => {
  expect(skinLabel("player", "default", "Blood Eagle")).toBe("Blood Eagle");
  expect(skinLabel("weapon", "default", "weapon_disc")).toBe("Default");
  expect(skinLabel("vehicle", "default", "vehicle_grav_scout")).toBe("Default");
  expect(skinLabel("weapon", "custom", "Gold Disc")).toBe("Gold Disc");
  expect(skinLabel("player", "import", "__untitled__")).toBe(
    "Untitled Imported Skin",
  );
  // Production builds have no local projects.
  expect(skinLabel("player", "local", "secret.skin")).toBe("");
  expect(skinLabel("player", "default", null)).toBe("");
});

test("canvas blobs are png images and encoding failures reject", async () => {
  const canvas = solid(2, 2, red);
  const blob = await canvasBlob(canvas);
  expect(blob.type).toBe("image/png");
  expect(blob.size).toBeGreaterThan(0);
  vi.spyOn(canvas, "toBlob").mockImplementation((callback) => callback(null));
  await expect(canvasBlob(canvas)).rejects.toThrow("could not be encoded");
});

test("image file names are cleaned, timestamped and never use the NAME.MODEL.png form", () => {
  const date = new Date(2026, 9, 20, 14, 3, 5);
  expect(imageFileName("Blood Eagle", "lmale", "Photo strip", date)).toBe(
    "Blood Eagle - lmale - Photo strip - 2026-10-20 14-03-05.png",
  );
  expect(
    imageFileName(
      ' a/b:c*d?"e<f>g|h\\i\tj  k\n',
      "hmale",
      "Pose 2",
      new Date(2026, 0, 2, 3, 4, 5),
    ),
  ).toBe("a-b-c-d--e-f-g-h-i j k - hmale - Pose 2 - 2026-01-02 03-04-05.png");
  expect(imageFileName("a\u0001b", "lmale", "Pose 1", date)).toMatch(/^a-b - /);
  expect(imageFileName("  ", "lmale", "Animation 1", date)).toMatch(
    /^Untitled skin - lmale - /,
  );
  expect(imageFileName("x".repeat(80), "lmale", "Pose 1", date)).toMatch(
    /^x{60} - lmale/,
  );
  // The cut counts characters, so it never splits an emoji.
  expect(
    imageFileName(`${"x".repeat(59)}😀😀`, "lmale", "Pose 1", date),
  ).toMatch(/^x{59}😀 - lmale/);
  expect(imageFileName("Mr. T.lmale", "lmale", "Pose 1", date)).not.toMatch(
    /\.[a-z_]+\.png$/i,
  );
  expect(imageFileName("Blood Eagle", "lmale", null, date)).toBe(
    "Blood Eagle - lmale - 2026-10-20 14-03-05.png",
  );
});

test("shared export supports a full transparent frame and requested encoding", async () => {
  const { exportModelImage } = await import("./modelImage");
  const frame = document.createElement("canvas");
  frame.width = 680;
  frame.height = 800;
  frame.getContext("2d").fillRect(100, 100, 100, 100);
  let format, quality;
  frame.toBlob = (callback, type, q) => {
    format = type;
    quality = q;
    callback(new globalThis.Blob(["webp"], { type }));
  };
  const blob = await exportModelImage(
    {
      captureFrame: async (options) => {
        expect(options).toEqual({ background: false });
        return frame;
      },
    },
    { type: "image/webp", quality: 0.75, trim: false },
  );
  expect([format, quality, blob.type]).toEqual([
    "image/webp",
    0.75,
    "image/webp",
  ]);
});

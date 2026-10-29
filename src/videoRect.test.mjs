import { expect, test } from "vitest";
import { containedVideoRect, pixelBox } from "./videoRect";

test("a pixel box covers the contained camera area in device pixels", () => {
  const area = containedVideoRect(640, 480, 1, 1);
  expect(pixelBox(area, 2, 1280, 960)).toEqual({
    x: 160,
    y: 0,
    width: 960,
    height: 960,
  });
  expect(pixelBox(containedVideoRect(640, 480, 2, 1), 1, 640, 480)).toEqual({
    x: 0,
    y: 80,
    width: 640,
    height: 320,
  });
});

test("pixel boxes round each edge and stay inside the canvas", () => {
  // The canvas is floor(333 * 1.5) wide, but the right edge rounds to 500.
  const area = containedVideoRect(333, 250, 4 / 3, 1);
  expect(pixelBox(area, 1.5, 499, 375)).toEqual({
    x: 0,
    y: 0,
    width: 499,
    height: 375,
  });
  // Rounding the width alone would lose the last column.
  expect(
    pixelBox({ x: 0.4, y: 0, width: 10.2, height: 10 }, 1, 100, 100),
  ).toEqual({ x: 0, y: 0, width: 11, height: 10 });
  expect(
    pixelBox({ x: -5, y: -5, width: 20, height: 20 }, 1, 100, 100),
  ).toEqual({ x: 0, y: 0, width: 15, height: 15 });
  expect(
    pixelBox({ x: 120, y: 0, width: 20, height: 20 }, 1, 100, 100).width,
  ).toBe(0);
});

import { expect, test, vi } from "vitest";
import {
  drawHandSkeletons,
  drawPoseSkeleton,
  previewPoint,
} from "./posePreview";
import { containedVideoRect } from "../videoRect";

test("landscape video and its landmarks share the centered letterbox rectangle", () => {
  const rect = containedVideoRect(600, 600, 640, 480);
  expect(rect).toEqual({ x: 0, y: 75, width: 600, height: 450 });
  expect(previewPoint({ x: 0.25, y: 0.5, z: 0 }, rect)).toEqual({
    x: 150,
    y: 300,
  });
});

test("portrait video and a resized viewport keep the same contain projection", () => {
  expect(containedVideoRect(800, 500, 480, 640)).toEqual({
    x: 212.5,
    y: 0,
    width: 375,
    height: 500,
  });
  expect(containedVideoRect(300, 600, 480, 640)).toEqual({
    x: 0,
    y: 100,
    width: 300,
    height: 400,
  });
});

test("missing video metadata does not produce invalid coordinates", () => {
  expect(containedVideoRect(600, 400, 0, 0)).toBeNull();
  expect(containedVideoRect(0, 400, 640, 480)).toBeNull();
  expect(containedVideoRect(600, NaN, 640, 480)).toBeNull();
});

test("unreliable and non-finite landmarks are hidden", () => {
  const rect = { x: 0, y: 0, width: 100, height: 100 };
  const point = { x: 0.5, y: 0.5, z: 0 };
  expect(previewPoint(point, rect)).toEqual({ x: 50, y: 50 });
  for (const change of [
    { visibility: 0.49 },
    { presence: 0.49 },
    { visibility: NaN },
    { x: Infinity },
  ]) {
    expect(previewPoint({ ...point, ...change }, rect)).toBeNull();
  }
  expect(previewPoint(undefined, rect)).toBeNull();
});

test("bones require both confident endpoints and drawing clips to the video", () => {
  const context = Object.fromEntries(
    [
      "save",
      "restore",
      "beginPath",
      "rect",
      "clip",
      "moveTo",
      "lineTo",
      "stroke",
      "arc",
      "fill",
    ].map((method) => [method, vi.fn()]),
  );
  const points = Array(33);
  points[11] = { x: 0.25, y: 0.25, z: 0 };
  points[12] = { x: 0.75, y: 0.25, z: 0 };
  points[13] = { x: 0.2, y: 0.5, z: 0, visibility: 0.2 };
  drawPoseSkeleton(context, points, { x: 0, y: 75, width: 600, height: 450 });
  expect(context.rect).toHaveBeenCalledWith(0, 75, 600, 450);
  expect(context.clip).toHaveBeenCalledOnce();
  expect(context.moveTo).toHaveBeenCalledOnce();
  expect(context.moveTo).toHaveBeenCalledWith(150, 187.5);
  expect(context.lineTo).toHaveBeenCalledWith(450, 187.5);
  expect(context.arc).toHaveBeenCalledTimes(2);
  expect(context.restore).toHaveBeenCalledOnce();
});

test("detailed hands show all 21 nodes in the video rectangle and reject uncertain matches", () => {
  const context = Object.fromEntries(
    [
      "save",
      "restore",
      "beginPath",
      "rect",
      "clip",
      "moveTo",
      "lineTo",
      "stroke",
      "arc",
      "fill",
    ].map((method) => [method, vi.fn()]),
  );
  const hand = {
    confidence: 1,
    side: "left",
    worldLandmarks: [],
    landmarks: Array.from({ length: 21 }, () => ({
      x: 0.25,
      y: 0.5,
      z: 0,
      visibility: 0,
      presence: 0,
    })),
  };
  const rect = { x: 200, y: 0, width: 400, height: 300 };
  drawHandSkeletons(
    context,
    [hand, { ...hand, confidence: 0.4 }, { ...hand, confidence: NaN }],
    rect,
  );
  expect(context.rect).toHaveBeenCalledExactlyOnceWith(200, 0, 400, 300);
  expect(context.lineTo).toHaveBeenCalledTimes(21);
  expect(context.arc).toHaveBeenCalledTimes(21);
  expect(context.arc).toHaveBeenCalledWith(300, 150, 2, 0, Math.PI * 2);
  expect(context.restore).toHaveBeenCalledOnce();
});

test("detailed hand overlays replace coarse fingertips only for confidently tracked sides", () => {
  const context = Object.fromEntries(
    [
      "save",
      "restore",
      "beginPath",
      "rect",
      "clip",
      "moveTo",
      "lineTo",
      "stroke",
      "arc",
      "fill",
    ].map((method) => [method, vi.fn()]),
  );
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  drawPoseSkeleton(context, points, { x: 0, y: 0, width: 100, height: 100 }, [
    { side: "left", confidence: 0.9, landmarks: points.slice(0, 21) },
    { side: "right", confidence: 0.4, landmarks: points.slice(0, 21) },
  ]);
  expect(context.arc).toHaveBeenCalledTimes(30);
  expect(context.lineTo).toHaveBeenCalledTimes(31);
});

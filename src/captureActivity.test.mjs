import { expect, test } from "vitest";
import { createCaptureActivity } from "./captureActivity";

test("readiness includes concurrent work and errors until retry or owner disposal", () => {
  const activity = createCaptureActivity();
  const color = activity.register("color");
  const metallic = activity.register("metallic");
  color.update(1);
  metallic.update(1);
  expect(activity.snapshot().pending).toBe(2);
  color.update(0);
  expect(activity.snapshot().pending).toBe(1);
  metallic.update(0, new Error("decode failed"));
  expect(activity.snapshot().errors).toEqual(["metallic: decode failed"]);
  metallic.update(1);
  expect(activity.snapshot().errors).toEqual([]);
  metallic.dispose();
  metallic.update(1, "stale result");
  expect(activity.snapshot().pending).toBe(0);
  expect(activity.snapshot().errors).toEqual([]);
  color.dispose();
});

test("completed work changes the revision even when the pending total returns to zero", () => {
  const activity = createCaptureActivity();
  const task = activity.register("preview");
  const before = activity.snapshot().revision;
  task.update(1);
  task.update(0);
  expect(activity.snapshot().revision).toBeGreaterThan(before);
  const after = activity.snapshot().revision;
  task.update(0);
  expect(activity.snapshot().revision).toBe(after);
});

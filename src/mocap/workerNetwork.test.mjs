import { expect, test, vi } from "vitest";
import { sameOriginFetch } from "./workerNetwork";

const { Request, URL } = globalThis;
const workerUrl = "https://example.test/t2-model-skinner/worker.js";

test("runtime metrics cannot reach native fetch", async () => {
  const native = vi.fn();
  const request = sameOriginFetch(native, workerUrl);
  await expect(
    request("https://odml.pa.googleapis.com/v1/log", {
      method: "POST",
      body: "metrics",
    }),
  ).rejects.toThrow(/Cross-origin/);
  expect(native).not.toHaveBeenCalled();
});

test.each([
  [
    "./mocap/wasm/runtime.wasm",
    "https://example.test/t2-model-skinner/mocap/wasm/runtime.wasm",
  ],
  [
    "/t2-model-skinner/mocap/pose.task",
    "https://example.test/t2-model-skinner/mocap/pose.task",
  ],
  [
    new URL("https://example.test/mocap/pose.task"),
    "https://example.test/mocap/pose.task",
  ],
])(
  "same-origin asset %s loads with redirects disabled",
  async (input, expected) => {
    const response = {};
    const native = vi.fn(async () => response);
    const request = sameOriginFetch(native, workerUrl);
    expect(
      await request(input, { cache: "force-cache", redirect: "follow" }),
    ).toBe(response);
    expect(native).toHaveBeenCalledWith(expected, {
      cache: "force-cache",
      redirect: "error",
    });
  },
);

test("Request inputs retain their settings and cannot target another origin", async () => {
  const native = vi.fn(async () => ({}));
  const request = sameOriginFetch(native, workerUrl);
  const local = new Request("https://example.test/model.task", {
    headers: { accept: "application/octet-stream" },
  });
  await request(local);
  expect(native).toHaveBeenCalledWith(local, { redirect: "error" });
  await expect(
    request(new Request("https://other.test/model.task")),
  ).rejects.toThrow(/Cross-origin/);
  expect(native).toHaveBeenCalledOnce();
});

test("blob worker URLs retain the owning page origin", async () => {
  const native = vi.fn(async () => ({}));
  const request = sameOriginFetch(
    native,
    "blob:https://example.test/session-id",
  );
  await request("/mocap/pose.task");
  expect(native).toHaveBeenCalledWith("https://example.test/mocap/pose.task", {
    redirect: "error",
  });
});

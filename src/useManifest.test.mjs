import { afterEach, beforeEach, expect, test, vi } from "vitest";
import React, { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import useManifest, { defaultManifest } from "./useManifest";

const { document, console } = globalThis;
let root, host, result;
function Probe() {
  const value = useManifest();
  useLayoutEffect(() => { result = value; }, [value]);
  return null;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(globalThis, "fetch");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

test.each(["http", "network", "json"])("a %s failure can be retried without leaving a stale error", async (failure) => {
  if (failure === "network") vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("Offline"));
  else vi.mocked(globalThis.fetch).mockResolvedValueOnce({
    ok: failure !== "http",
    json: async () => { throw new Error("Invalid JSON"); },
  });
  await act(async () => root.render(React.createElement(Probe)));
  expect(result[0]).toBe(defaultManifest);
  expect(result[1]).toBe(false);
  expect(result[2].error).toBe(true);

  let resolve;
  vi.mocked(globalThis.fetch).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await act(async () => result[2].retry());
  expect(result[1]).toBe(false);
  expect(result[2].error).toBe(false);
  const manifest = { ...defaultManifest, customSkins: { lmale: ["Example"] } };
  await act(async () => resolve({ ok: true, json: async () => manifest }));
  expect(result[0]).toBe(manifest);
  expect(result[1]).toBe(true);
  expect(result[2].error).toBe(false);
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
});

test("leaving during a catalog request aborts it and ignores its late failure", async () => {
  let reject;
  vi.mocked(globalThis.fetch).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  await act(async () => root.render(React.createElement(Probe)));
  const signal = vi.mocked(globalThis.fetch).mock.calls[0][1].signal;
  await act(async () => root.unmount());
  expect(signal.aborted).toBe(true);
  await act(async () => reject(new Error("Request aborted")));
  expect(console.error).not.toHaveBeenCalled();
});

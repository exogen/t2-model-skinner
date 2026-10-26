import { afterEach, beforeEach, expect, test, vi } from "vitest";
import React, { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import useManifest, { defaultManifest } from "./useManifest";

const { document, console, setTimeout } = globalThis;
let root, host, result, queryClient;
function Probe() {
  const value = useManifest();
  useLayoutEffect(() => { result = value; }, [value]);
  return null;
}

// React Query passes on its updates in timeouts, a few after the response.
async function settle(work) {
  await act(async () => { await work?.(); });
  for (let tick = 0; tick < 5; tick++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

function app(...children) {
  return React.createElement(QueryClientProvider, { client: queryClient }, ...children);
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  queryClient = new QueryClient();
  vi.spyOn(globalThis, "fetch");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  host.remove();
  vi.restoreAllMocks();
});

test.each(["http", "network", "json"])("a %s failure can be retried without leaving a stale error", async (failure) => {
  if (failure === "network") vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("Offline"));
  else vi.mocked(globalThis.fetch).mockResolvedValueOnce({
    ok: failure !== "http",
    json: async () => { throw new Error("Invalid JSON"); },
  });
  await settle(async () => root.render(app(React.createElement(Probe))));
  expect(result[0]).toBe(defaultManifest);
  expect(result[1]).toBe(false);
  expect(result[2].error).toBe(true);

  let resolve;
  vi.mocked(globalThis.fetch).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await settle(async () => result[2].retry());
  expect(result[1]).toBe(false);
  expect(result[2].error).toBe(false);
  const manifest = { ...defaultManifest, customSkins: { lmale: ["Example"] } };
  await settle(async () => resolve({ ok: true, json: async () => manifest }));
  expect(result[0]).toBe(manifest);
  expect(result[1]).toBe(true);
  expect(result[2].error).toBe(false);
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
});

test("leaving during a catalog request aborts it and ignores its late failure", async () => {
  let reject;
  vi.mocked(globalThis.fetch).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  await settle(async () => root.render(app(React.createElement(Probe))));
  const signal = vi.mocked(globalThis.fetch).mock.calls[0][1].signal;
  await act(async () => root.unmount());
  expect(signal.aborted).toBe(true);
  await act(async () => reject(new Error("Request aborted")));
  expect(console.error).not.toHaveBeenCalled();
});

test("everything using the manifest shares one request, and showing more later doesn't fetch again", async () => {
  const manifest = { ...defaultManifest, customSkins: { disc: ["Example"] } };
  vi.mocked(globalThis.fetch).mockResolvedValue({ ok: true, json: async () => manifest });
  await settle(async () => root.render(app(React.createElement(Probe, { key: 1 }), React.createElement(Probe, { key: 2 }))));
  expect(result[0]).toEqual(manifest);
  await settle(async () => root.render(app(
    React.createElement(Probe, { key: 1 }), React.createElement(Probe, { key: 2 }), React.createElement(Probe, { key: 3 }),
  )));
  expect(result[1]).toBe(true);
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});

test("a failure is logged once however many things use the manifest", async () => {
  vi.mocked(globalThis.fetch).mockResolvedValueOnce({ ok: false, json: async () => ({}) });
  await settle(async () => root.render(app(React.createElement(Probe, { key: 1 }), React.createElement(Probe, { key: 2 }))));
  expect(result[2].error).toBe(true);
  expect(console.error).toHaveBeenCalledOnce();
});

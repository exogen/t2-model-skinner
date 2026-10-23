import React, { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { getEnv } from "fabric";
import { expect, test, vi } from "vitest";
import useAsyncTask from "./useAsyncTask";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function mount(latest = true) {
  const host = getEnv().document.createElement("div");
  const root = createRoot(host);
  let run;
  function Harness() {
    const task = useAsyncTask(latest);
    useLayoutEffect(() => { run = task; }, [task]);
    return null;
  }
  await act(async () => root.render(React.createElement(Harness)));
  return { run, close: () => act(async () => root.unmount()) };
}

test.each([true, false])("cancel aborts pending runs and keeps the owner usable (latest=%s)", async (latest) => {
  const owner = await mount(latest);
  const pending = [deferred(), deferred()];
  const signals = [];
  const commit = vi.fn();
  const dispose = vi.fn();
  try {
    const first = owner.run((signal) => { signals.push(signal); return pending[0].promise; }, commit, dispose);
    const second = owner.run((signal) => { signals.push(signal); return pending[1].promise; }, commit, dispose);
    owner.run.cancel();
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true]);
    pending[1].resolve("second");
    pending[0].resolve("first");
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(dispose.mock.calls.map(([value]) => value).sort()).toEqual(["first", "second"]);
    expect(await owner.run(async () => "next", commit)).toBe(true);
    expect(commit).toHaveBeenCalledExactlyOnceWith("next");
  } finally {
    await owner.close();
  }
});

test("cancel suppresses a pending failure while a subsequent failure still reaches its caller", async () => {
  const owner = await mount();
  const pending = deferred();
  try {
    const loading = owner.run(() => pending.promise, vi.fn());
    owner.run.cancel();
    pending.reject(new Error("stale download"));
    await expect(loading).resolves.toBe(false);
    await expect(owner.run(async () => { throw new Error("current download"); }, vi.fn()))
      .rejects.toThrow("current download");
  } finally {
    await owner.close();
  }
});

test("a new run aborts earlier work in latest mode", async () => {
  const owner = await mount();
  const pending = deferred();
  const commit = vi.fn();
  const dispose = vi.fn();
  try {
    let oldSignal;
    const old = owner.run((signal) => { oldSignal = signal; return pending.promise; }, commit, dispose);
    expect(await owner.run(async () => "new", commit)).toBe(true);
    expect(oldSignal.aborted).toBe(true);
    pending.resolve("old");
    expect(await old).toBe(false);
    expect(commit).toHaveBeenCalledExactlyOnceWith("new");
    expect(dispose).toHaveBeenCalledExactlyOnceWith("old");
  } finally {
    await owner.close();
  }
});

test("unmount aborts work even after cancellation and a later request", async () => {
  const owner = await mount();
  const pending = deferred();
  const commit = vi.fn();
  const dispose = vi.fn();
  owner.run.cancel();
  let signal;
  const loading = owner.run((nextSignal) => {
    signal = nextSignal;
    return pending.promise;
  }, commit, dispose);
  await owner.close();
  expect(signal.aborted).toBe(true);
  pending.resolve("late");
  await expect(loading).resolves.toBe(false);
  expect(commit).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledExactlyOnceWith("late");
  expect(await owner.run(async () => "unmounted", commit)).toBe(false);
});

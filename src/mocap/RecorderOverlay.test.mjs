import { afterEach, beforeEach, expect, test, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { getEnv } from "fabric";
import RecorderOverlay, {
  RecorderAnnouncer,
  ViewerOverlay,
} from "./RecorderOverlay";

const { document } = getEnv();
let root;
let host;

async function render(props, component = RecorderOverlay) {
  await act(async () => root.render(React.createElement(component, props)));
}

const renderViewer = (props) =>
  render({ playback: null, paused: false, ...props }, ViewerOverlay);

async function advance(ms) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

const overlay = () => host.querySelector("[class*='Overlay']");
const digit = () =>
  overlay().querySelector("[class*='Digit']")?.textContent ?? null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

test("the overlay counts down one number per second from the shared deadline", async () => {
  await render({
    activity: {
      phase: "record-countdown",
      endsAt: globalThis.performance.now() + 5000,
    },
  });
  expect(overlay().textContent).toContain("Recording starts in");
  expect(digit()).toBe("5");
  await advance(999);
  expect(digit()).toBe("5");
  await advance(1);
  expect(digit()).toBe("4");
  await advance(3000);
  expect(digit()).toBe("1");
  await advance(5000);
  expect(digit()).toBe("1");
  expect(vi.getTimerCount()).toBe(0);
  // A deadline already partly spent starts at the right number.
  await render({
    activity: {
      phase: "booth-countdown",
      taken: 1,
      endsAt: globalThis.performance.now() + 2500,
    },
  });
  expect(digit()).toBe("3");
  expect(overlay().textContent).toContain("Photo 2 of 3");
});

test("recording shows a capped REC timer and a recording frame", async () => {
  await render({
    activity: { phase: "recording", startedAt: globalThis.performance.now() },
  });
  expect(overlay().dataset.recording).toBe("true");
  expect(overlay().textContent).toBe("REC 0:00 / 1:00");
  expect(digit()).toBeNull();
  await advance(12000);
  expect(overlay().textContent).toBe("REC 0:12 / 1:00");
  await advance(70000);
  expect(overlay().textContent).toBe("REC 1:00 / 1:00");
  await render({ activity: null });
  expect(overlay().dataset.recording).toBeUndefined();
  expect(overlay().textContent).toBe("");
  expect(vi.getTimerCount()).toBe(0);
});

test("each photo booth shot replays the flash once", async () => {
  await render({
    activity: {
      phase: "booth-countdown",
      taken: 0,
      endsAt: globalThis.performance.now() + 5000,
    },
  });
  expect(overlay().querySelector("[data-flash]")).toBeNull();
  await render({ activity: { phase: "booth-hold", taken: 1 } });
  const first = overlay().querySelector("[data-flash]");
  expect(first).not.toBeNull();
  expect(overlay().textContent).toBe("Photo 1 of 3 taken");
  await render({
    activity: {
      phase: "booth-countdown",
      taken: 1,
      endsAt: globalThis.performance.now() + 3000,
    },
  });
  expect(overlay().querySelector("[data-flash]")).toBe(first);
  await render({ activity: { phase: "booth-hold", taken: 2 } });
  expect(overlay().querySelector("[data-flash]")).not.toBe(first);
  await render({ activity: { phase: "developing", taken: 3 } });
  expect(overlay().textContent).toBe("Developing photos…");
});

test("over the 3D view, countdowns and recording show only the shot flash", async () => {
  await renderViewer({
    activity: {
      phase: "record-countdown",
      endsAt: globalThis.performance.now() + 5000,
    },
  });
  expect(overlay().textContent).toBe("");
  await renderViewer({
    activity: { phase: "recording", startedAt: globalThis.performance.now() },
  });
  expect(overlay().textContent).toBe("");
  expect(overlay().dataset.recording).toBeUndefined();
  await renderViewer({ activity: { phase: "booth-hold", taken: 1 } });
  expect(overlay().textContent).toBe("");
  expect(overlay().querySelector("[data-flash]")).not.toBeNull();
  // It doesn't tick.
  expect(vi.getTimerCount()).toBe(0);
});

test("over the 3D view, the selected animation or pose is named while idle", async () => {
  await renderViewer({
    activity: null,
    playback: { kind: "recording", label: "Animation 2" },
  });
  expect(overlay().textContent).toBe("Animation 2");
  expect(overlay().querySelector("svg")).not.toBeNull();
  await renderViewer({
    activity: null,
    playback: { kind: "pose", label: "Pose 4" },
  });
  expect(overlay().textContent).toBe("Pose 4");
  expect(overlay().querySelector("svg")).toBeNull();
  await renderViewer({
    activity: {
      phase: "record-countdown",
      endsAt: globalThis.performance.now() + 5000,
    },
    playback: { kind: "pose", label: "Pose 4" },
  });
  expect(overlay().textContent).not.toContain("Pose 4");
});

test("the overlays are hidden from assistive technology", async () => {
  await render({
    activity: { phase: "recording", startedAt: globalThis.performance.now() },
  });
  expect(overlay().getAttribute("aria-hidden")).toBe("true");
  await renderViewer({
    activity: null,
    playback: { kind: "pose", label: "Pose 4" },
  });
  expect(overlay().getAttribute("aria-hidden")).toBe("true");
});

test("the announcer speaks one message per change and repeats a repeated message", async () => {
  const announce = (announcement) =>
    act(async () =>
      root.render(React.createElement(RecorderAnnouncer, { announcement })),
    );
  await announce(null);
  const region = host.firstElementChild;
  expect(region.getAttribute("role")).toBe("status");
  expect(region.textContent).toBe("");
  await announce({ id: 1, text: "Recording." });
  expect(region.textContent).toBe("Recording. ");
  await announce({ id: 2, text: "Recording." });
  expect(host.firstElementChild).toBe(region);
  expect(region.textContent).toBe("Recording.");
});

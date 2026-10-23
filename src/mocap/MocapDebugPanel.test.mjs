import { afterEach, expect, test, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import MocapDebugPanel from "./MocapDebugPanel";
import { DEFAULT_POSE_SETTINGS } from "./poseSettings";
import { chooseOption } from "../selectTestUtils.mjs";

const updateSettings = vi.hoisted(() => vi.fn());
vi.mock("../MocapProvider", () => ({ useMocap: () => ({ tracking: {
  settings: DEFAULT_POSE_SETTINGS,
  updateSettings,
  resetSettings: vi.fn(),
  switching: false,
  stats: null,
} }) }));

let root, host;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  updateSettings.mockClear();
});

test("detailed hands can be disabled for comparison without changing body quality", async () => {
  host = globalThis.document.createElement("div");
  globalThis.document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(MocapDebugPanel)));
  // The footer only speaks up while the tracker is switching models.
  expect(host.querySelector("[role='status']").textContent).toBe("");
  const field = [...host.querySelectorAll("label")].find((node) => node.textContent.includes("Detailed hands"));
  const checkbox = field.querySelector("input");
  expect(checkbox.checked).toBe(true);
  await act(async () => checkbox.click());
  expect(updateSettings).toHaveBeenCalledExactlyOnceWith({ handTracking: false });
});

test.each([
  ["Model quality", "lite", { model: "lite" }],
  ["Rig smoothing", "stable", { smoothing: "stable" }],
])("the %s dropdown applies its setting", async (label, value, setting) => {
  host = globalThis.document.createElement("div");
  globalThis.document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(MocapDebugPanel)));
  const field = [...host.querySelectorAll("label")].find((node) => node.textContent === label);
  const trigger = globalThis.document.getElementById(field.htmlFor);
  await chooseOption(trigger, value);
  expect(updateSettings).toHaveBeenCalledWith(setting);
});

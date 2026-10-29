import { expect, test } from "vitest";
import {
  DEFAULT_POSE_SETTINGS,
  detectorSettingsKey,
  normalizePoseSettings,
} from "./poseSettings";

test("empty or invalid settings restore the recommended Full and Adaptive defaults", () => {
  expect(normalizePoseSettings({})).toEqual(DEFAULT_POSE_SETTINGS);
  expect(
    normalizePoseSettings({
      model: "unknown",
      smoothing: "bad",
      minDetectionConfidence: NaN,
      minPresenceConfidence: Infinity,
      minTrackingConfidence: "0.7",
    }),
  ).toEqual(DEFAULT_POSE_SETTINGS);
  expect(DEFAULT_POSE_SETTINGS).toMatchObject({
    model: "full",
    smoothing: "adaptive",
  });
});

test("supported settings survive normalization and confidence stays in the supported range", () => {
  expect(
    normalizePoseSettings({
      model: "lite",
      smoothing: "stable",
      minDetectionConfidence: -1,
      minPresenceConfidence: 2,
      minTrackingConfidence: 0.7,
    }),
  ).toEqual({
    model: "lite",
    smoothing: "stable",
    handTracking: true,
    minDetectionConfidence: 0.1,
    minPresenceConfidence: 0.9,
    minTrackingConfidence: 0.7,
  });
  for (const model of ["lite", "full"])
    for (const smoothing of ["none", "classic", "adaptive", "stable"]) {
      expect(normalizePoseSettings({ smoothing, model })).toMatchObject({
        smoothing,
        model,
      });
    }
});

test("detailed hands can be disabled independently of body settings", () => {
  const enabled = normalizePoseSettings({});
  const disabled = normalizePoseSettings({ handTracking: false });
  expect(enabled.handTracking).toBe(true);
  expect(disabled).toEqual({ ...enabled, handTracking: false });
  expect(detectorSettingsKey(disabled)).not.toBe(detectorSettingsKey(enabled));
});

test("rig smoothing never changes detector identity", () => {
  for (const smoothing of ["none", "classic", "adaptive", "stable"]) {
    expect(detectorSettingsKey({ ...DEFAULT_POSE_SETTINGS, smoothing })).toBe(
      detectorSettingsKey(DEFAULT_POSE_SETTINGS),
    );
  }
});

test("confidence and model quality changes rebuild the detector", () => {
  for (const field of [
    "minDetectionConfidence",
    "minPresenceConfidence",
    "minTrackingConfidence",
  ]) {
    expect(
      detectorSettingsKey({ ...DEFAULT_POSE_SETTINGS, [field]: 0.8 }),
    ).not.toBe(detectorSettingsKey(DEFAULT_POSE_SETTINGS));
  }
  expect(
    detectorSettingsKey({ ...DEFAULT_POSE_SETTINGS, model: "lite" }),
  ).not.toBe(detectorSettingsKey(DEFAULT_POSE_SETTINGS));
});

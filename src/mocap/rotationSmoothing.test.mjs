import { expect, test } from "vitest";
import { Quaternion, Vector3 } from "three";
import {
  createRotationSmoother,
  poseSmoothingAlpha,
} from "./rotationSmoothing";

const modes = ["none", "classic", "adaptive", "stable"];
const axis = new Vector3(0, 1, 0);
const rotation = (angle) => new Quaternion().setFromAxisAngle(axis, angle);

test("quaternion damping converges equally at 30, 60, and 120 Hz", () => {
  const target = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.2);
  const sample = (fps) => {
    const rotation = new Quaternion();
    for (let i = 0; i < fps / 2; i++)
      rotation.slerp(target, poseSmoothingAlpha(1 / fps));
    return rotation;
  };
  expect(sample(30).angleTo(sample(120))).toBeLessThan(1e-6);
  expect(sample(60).angleTo(target)).toBeLessThan(0.002);
  expect(poseSmoothingAlpha(-1)).toBe(0);
  expect(poseSmoothingAlpha(NaN)).toBe(0);
});

test("no extra smoothing follows the current target immediately", () => {
  const filter = createRotationSmoother("none");
  filter.reset(rotation(0));
  expect(filter.filter(rotation(1), 1 / 60).angleTo(rotation(1))).toBeLessThan(
    1e-7,
  );
});

test.each(modes)(
  "%s treats antipodal quaternions as the same rotation",
  (mode) => {
    const filter = createRotationSmoother(mode);
    const target = rotation(0.8);
    filter.reset(target);
    for (let i = 0; i < 60; i++) {
      const sample = target.clone();
      if (i % 2) sample.set(-sample.x, -sample.y, -sample.z, -sample.w);
      expect(filter.filter(sample, 1 / 60).angleTo(target)).toBeLessThan(1e-7);
    }
  },
);

test.each(modes)(
  "%s rejects invalid time/rotations without corrupting subsequent tracking",
  (mode) => {
    const filter = createRotationSmoother(mode);
    filter.reset(rotation(0.4));
    for (const delta of [0, -1, NaN, Infinity]) {
      expect(
        filter.filter(rotation(1), delta).angleTo(rotation(0.4)),
      ).toBeLessThan(1e-7);
    }
    for (const target of [
      new Quaternion(0, 0, 0, 0),
      new Quaternion(NaN, 0, 0, 1),
      new Quaternion(1e300, 1, 1, 1),
    ]) {
      expect(filter.filter(target, 1 / 60).angleTo(rotation(0.4))).toBeLessThan(
        1e-7,
      );
    }
    const output = filter.filter(rotation(1), 1 / 60);
    expect(output.toArray().every(Number.isFinite)).toBe(true);
    expect(output.length()).toBeCloseTo(1, 10);
  },
);

test.each(["adaptive", "stable"])(
  "%s reset clears learned velocity without changing the supplied pose",
  (mode) => {
    const filter = createRotationSmoother(mode);
    filter.reset(rotation(0));
    for (let i = 0; i < 20; i++) filter.filter(rotation(i / 10), 1 / 60);
    filter.reset(rotation(0.5));
    const fresh = createRotationSmoother(mode);
    fresh.reset(rotation(0.5));
    expect(
      filter
        .filter(rotation(0.6), 1 / 60)
        .angleTo(fresh.filter(rotation(0.6), 1 / 60)),
    ).toBeLessThan(1e-7);
    filter.reset();
    expect(
      filter.filter(rotation(-1), 1 / 60).angleTo(rotation(-1)),
    ).toBeLessThan(1e-7);
  },
);

test.each(["adaptive", "stable"])(
  "%s follows rotations across the ±180 degree boundary by the short path",
  (mode) => {
    const filter = createRotationSmoother(mode);
    const before = rotation(Math.PI - 0.02);
    const after = rotation(-Math.PI + 0.02);
    filter.reset(before);
    const first = filter.filter(after, 1 / 60).clone();
    expect(first.angleTo(before)).toBeLessThan(0.04);
    for (let frame = 0; frame < 240; frame++) filter.filter(after, 1 / 60);
    expect(filter.filter(after, 1 / 60).angleTo(after)).toBeLessThan(1e-6);
  },
);

function jitter(mode, fps = 60) {
  const filter = createRotationSmoother(mode);
  filter.reset(rotation(0));
  let squareError = 0;
  let samples = 0;
  for (let i = 0; i < fps * 5; i++) {
    const time = i / fps;
    // Deterministic 8/11 Hz noise on an otherwise stationary tracked joint.
    const angle =
      0.018 * Math.sin(2 * Math.PI * 8 * time) +
      0.012 * Math.sin(2 * Math.PI * 11 * time);
    const output = filter.filter(rotation(angle), 1 / fps);
    if (time > 1) {
      squareError += output.angleTo(rotation(0)) ** 2;
      samples++;
    }
  }
  return Math.sqrt(squareError / samples);
}

test.each([30, 60, 120])(
  "adaptive presets reduce stationary jitter compared with classic at %s Hz",
  (fps) => {
    const raw = jitter("none", fps);
    const classic = jitter("classic", fps);
    const adaptive = jitter("adaptive", fps);
    const stable = jitter("stable", fps);
    expect(classic).toBeLessThan(raw * 0.4);
    expect(adaptive).toBeLessThan(classic * 0.7);
    expect(stable).toBeLessThan(adaptive * 0.65);
  },
);

function stepTime(mode) {
  const filter = createRotationSmoother(mode);
  filter.reset(rotation(0));
  for (let frame = 1; frame <= 120; frame++) {
    if (filter.filter(rotation(1), 1 / 60).angleTo(rotation(1)) < 0.1)
      return frame / 60;
  }
  return Infinity;
}

test("adaptive reduces fast-motion lag while steady keeps the extra delay bounded", () => {
  expect(stepTime("adaptive")).toBeLessThan(stepTime("classic"));
  expect(stepTime("stable")).toBeLessThanOrEqual(0.25);
});

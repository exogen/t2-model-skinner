import { expect, test } from "vitest";
import { Vector3 } from "three";
import { solveArmIK } from "./retarget";

function options(patch = {}) {
  return {
    shoulder: new Vector3(),
    target: new Vector3(1.2, 0, 0),
    upperLength: 1,
    lowerLength: 0.8,
    bendDirection: new Vector3(0, -1, 0),
    ...patch,
  };
}
function assertLengths(input, result) {
  expect(result).not.toBeNull();
  const tolerance = Math.max(input.upperLength, input.lowerLength) * 1e-10;
  expect(
    Math.abs(result.elbow.distanceTo(input.shoulder) - input.upperLength),
  ).toBeLessThan(tolerance);
  expect(
    Math.abs(result.elbow.distanceTo(result.wrist) - input.lowerLength),
  ).toBeLessThan(tolerance);
  expect(result.bendDirection.length()).toBeCloseTo(1, 12);
  expect(
    [result.elbow, result.wrist, result.bendDirection].every((point) =>
      point.toArray().every(Number.isFinite),
    ),
  ).toBe(true);
}

test("reachable wrists use the preferred natural elbow side without stretching", () => {
  const input = options();
  const result = solveArmIK(input);
  assertLengths(input, result);
  expect(result.wrist.toArray()).toEqual(input.target.toArray());
  expect(result.elbow.y).toBeLessThan(-0.5);
  expect(result.elbow.z).toBe(0);
});

test.each([
  { target: new Vector3(20, 0, 0), reach: 1.8 },
  { target: new Vector3(0.01, 0, 0), reach: 0.2 },
  { target: new Vector3(1.8, 0, 0), reach: 1.8 },
  { target: new Vector3(0.2, 0, 0), reach: 0.2 },
])("clamps the wrist to reachable distance $reach", ({ target, reach }) => {
  const input = options({ target });
  const result = solveArmIK(input);
  assertLengths(input, result);
  expect(result.wrist.distanceTo(input.shoulder)).toBeCloseTo(reach, 12);
});

test.each([
  [1, 1],
  [1, 0.4],
  [0.4, 1],
])(
  "a wrist at the shoulder stays finite with lengths %s/%s",
  (upperLength, lowerLength) => {
    const input = options({
      target: new Vector3(),
      upperLength,
      lowerLength,
      previousElbow: new Vector3(0, -upperLength, 0),
    });
    const result = solveArmIK(input);
    assertLengths(input, result);
    expect(result.elbow.distanceTo(input.previousElbow)).toBeLessThan(1e-12);
    expect(result.wrist.length()).toBeCloseTo(
      Math.abs(upperLength - lowerLength),
      12,
    );
  },
);

test.each([new Vector3(), new Vector3(1, 0, 0)])(
  "zero or collinear bend preferences have a deterministic fallback: %j",
  (bendDirection) => {
    const input = options({ bendDirection });
    const result = solveArmIK(input);
    assertLengths(input, result);
    expect(result.elbow.y).toBeLessThan(0);
  },
);

test("a valid tracked elbow seeds exactly the same two-bone configuration", () => {
  const shoulder = new Vector3(2, 3, 4);
  const elbow = shoulder.clone().add(new Vector3(0.4, -0.7, 0.3).normalize());
  const target = elbow
    .clone()
    .add(new Vector3(0.3, 0.5, -0.2).normalize().multiplyScalar(0.8));
  const input = options({
    shoulder,
    target,
    bendDirection: elbow.clone().sub(shoulder),
    previousElbow: elbow,
  });
  const result = solveArmIK(input);
  assertLengths(input, result);
  expect(result.elbow.distanceTo(elbow)).toBeLessThan(1e-12);
  expect(result.wrist.distanceTo(target)).toBeLessThan(1e-12);
});

test("near-extension camera jitter cannot flip the elbow to the opposite side", () => {
  let bendDirection = new Vector3(0, -1, 0.2).normalize();
  let previousElbow;
  for (let frame = 0; frame < 180; frame++) {
    const target = new Vector3(
      1.8 + 0.08 * Math.sin(frame / 8),
      0.0001 * Math.sin(frame * 3),
      0.0001 * Math.cos(frame * 2),
    );
    const input = options({ target, bendDirection, previousElbow });
    const result = solveArmIK(input);
    assertLengths(input, result);
    expect(result.bendDirection.dot(bendDirection)).toBeGreaterThan(0.999);
    expect(result.bendDirection.y).toBeLessThan(-0.9);
    previousElbow = result.elbow;
    bendDirection = result.bendDirection;
  }
});

test("an opposite noisy elbow hint does not override the retained bend side", () => {
  const input = options({ previousElbow: new Vector3(0.7, 0.01, 0) });
  const result = solveArmIK(input);
  assertLengths(input, result);
  expect(result.elbow.y).toBeLessThan(0);
});

test.each([
  new Vector3(1.2, 0.3, 0.4),
  new Vector3(5, 0, 0),
  new Vector3(0, 1.2, 0),
  new Vector3(),
])(
  "mirroring the shoulder, target and history mirrors the solution: %j",
  (target) => {
    const reflect = (point) => new Vector3(-point.x, point.y, point.z);
    const input = options({
      shoulder: new Vector3(0.3, 1.4, 0.2),
      target,
      bendDirection: new Vector3(0.2, -1, 0.3),
      previousElbow: new Vector3(0.7, 0.7, 0.5),
    });
    const mirrored = {
      ...input,
      shoulder: reflect(input.shoulder),
      target: reflect(input.target),
      bendDirection: reflect(input.bendDirection),
      previousElbow: reflect(input.previousElbow),
    };
    const a = solveArmIK(input),
      b = solveArmIK(mirrored);
    assertLengths(input, a);
    assertLengths(mirrored, b);
    expect(b.elbow.distanceTo(reflect(a.elbow))).toBeLessThan(1e-12);
    expect(b.wrist.distanceTo(reflect(a.wrist))).toBeLessThan(1e-12);
    expect(b.bendDirection.distanceTo(reflect(a.bendDirection))).toBeLessThan(
      1e-12,
    );
  },
);

test.each([1e-6, 1, 1e6])(
  "solver is invariant to model scale %s and leaves inputs unchanged",
  (scale) => {
    const original = options({
      shoulder: new Vector3(0.2, 0.3, 0.1),
      target: new Vector3(1.2, 0.1, 0.4),
    });
    const input = {
      ...original,
      shoulder: original.shoulder.clone().multiplyScalar(scale),
      target: original.target.clone().multiplyScalar(scale),
      upperLength: scale,
      lowerLength: 0.8 * scale,
      bendDirection: original.bendDirection.clone(),
    };
    const saved = JSON.stringify(input);
    const result = solveArmIK(input),
      baseline = solveArmIK(original);
    assertLengths(input, result);
    expect(
      result.elbow.clone().divideScalar(scale).distanceTo(baseline.elbow),
    ).toBeLessThan(1e-12);
    expect(JSON.stringify(input)).toBe(saved);
  },
);

test.each([
  { upperLength: 0 },
  { lowerLength: -1 },
  { upperLength: Infinity },
  { lowerLength: NaN },
  { shoulder: new Vector3(NaN, 0, 0) },
  { target: new Vector3(0, Infinity, 0) },
  { bendDirection: new Vector3(0, 0, NaN) },
  { previousElbow: new Vector3(Infinity, 0, 0) },
  { upperLength: 1e308, lowerLength: 1e308 },
])(
  "invalid geometry returns no pose instead of contaminating the rig: %j",
  (invalid) => {
    expect(solveArmIK(options(invalid))).toBeNull();
  },
);

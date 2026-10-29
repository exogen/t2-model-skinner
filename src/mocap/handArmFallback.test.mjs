import { expect, test } from "vitest";
import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { modelTypes } from "../models";
import { createPlayerRig } from "./rig";
import { neutralBodyPose, trackedHand } from "./handTestUtils.mjs";
import { mirrorTrackedHands } from "./mirrorPose";
import { loadPlayer } from "./playerTestUtils.mjs";

const delta = 1 / 60;
const imageAspect = 4 / 3;
const sides = ["left", "right"];
const cases = modelTypes.player.flatMap((model) =>
  sides.map((side) => ({ model, side })),
);

function bone(scene, side, part) {
  return scene.getObjectByName(`Bip01_${side === "left" ? "L" : "R"}_${part}`);
}

function position(scene, side, part) {
  return scene.worldToLocal(
    bone(scene, side, part).getWorldPosition(new Vector3()),
  );
}

function localTransforms(scene) {
  const result = new Map();
  scene.traverse((node) =>
    result.set(node, [
      node.position.toArray(),
      node.quaternion.toArray(),
      node.scale.toArray(),
    ]),
  );
  return result;
}

function arm(scene, side) {
  const shoulder = position(scene, side, "UpperArm");
  const elbow = position(scene, side, "Forearm");
  const wrist = position(scene, side, "Hand");
  return {
    shoulder,
    elbow,
    wrist,
    upper: shoulder.distanceTo(elbow),
    lower: elbow.distanceTo(wrist),
  };
}

function armTransforms(scene, side) {
  return ["UpperArm", "Forearm", "Hand", "Fingers", "Thumb"].map((part) => {
    const node = bone(scene, side, part);
    return [
      node.getWorldPosition(new Vector3()).toArray(),
      node.getWorldQuaternion(new Quaternion()).toArray(),
    ];
  });
}

function withoutArm(side, missing = "all") {
  const pose = neutralBodyPose();
  const first = side === "left" ? 11 : 12;
  const indices =
    missing === "all"
      ? [first, first + 2, first + 4]
      : [first + { shoulder: 0, elbow: 2, wrist: 4 }[missing]];
  for (const index of indices) pose[index].visibility = 0;
  return pose;
}

function imagePoint(scene, camera, point) {
  const ndc = scene.localToWorld(point.clone()).project(camera);
  return {
    x: (ndc.x / Math.min(1, imageAspect / camera.aspect) + 1) / 2,
    y: (1 - ndc.y / Math.min(1, camera.aspect / imageAspect)) / 2,
    z: 0,
  };
}

function setTarget(scene, camera, hand, point) {
  hand.landmarks[0] = {
    ...imagePoint(scene, camera, point),
    visibility: 0,
    presence: 0,
  };
  expect(hand.landmarks[0].x).toBeGreaterThan(0);
  expect(hand.landmarks[0].x).toBeLessThan(1);
  expect(hand.landmarks[0].y).toBeGreaterThan(0);
  expect(hand.landmarks[0].y).toBeLessThan(1);
}

function reachableTarget(scene, side, along = 0.5, down = 0.3) {
  const current = arm(scene, side);
  const reach = current.upper + current.lower;
  const target = current.shoulder
    .clone()
    .add(
      new Vector3((side === "left" ? 1 : -1) * along * reach, -down * reach, 0),
    );
  // The actual entry wrist defines fallback depth, independently of the hand
  // task's centered world coordinates or its image landmark's relative Z.
  target.z = current.wrist.z;
  return target;
}

function expectLengths(scene, side, expected) {
  const actual = arm(scene, side);
  expect(Math.abs(actual.upper / expected.upper - 1)).toBeLessThan(1e-6);
  expect(Math.abs(actual.lower / expected.lower - 1)).toBeLessThan(1e-6);
  expect(
    [...actual.shoulder, ...actual.elbow, ...actual.wrist].every(
      Number.isFinite,
    ),
  ).toBe(true);
}

function expectAtTarget(scene, camera, side, target, hand) {
  expect(position(scene, side, "Hand").distanceTo(target)).toBeLessThan(1e-7);
  const projected = imagePoint(scene, camera, position(scene, side, "Hand"));
  expect(projected.x).toBeCloseTo(hand.landmarks[0].x, 6);
  expect(projected.y).toBeCloseTo(hand.landmarks[0].y, 6);
}

async function player(model, animated = false) {
  const { scene } = await loadPlayer(model, animated);
  const stock = localTransforms(scene);
  const rig = createPlayerRig(scene);
  expect(rig).not.toBeNull();
  rig.setSmoothing("none");
  rig.applyPose(neutralBodyPose(), delta, 1);
  const shoulder = position(scene, "left", "UpperArm");
  const height = shoulder.y - position(scene, "left", "Foot").y;
  const camera = new PerspectiveCamera(55, 16 / 9, 0.001, 1000);
  camera.position.set(0, shoulder.y - height * 0.1, shoulder.z + height * 4);
  camera.lookAt(0, camera.position.y, shoulder.z);
  camera.updateMatrixWorld(true);
  return { scene, rig, camera, stock };
}

test.each(cases)(
  "$model $side hand fills missing shoulder, elbow or wrist without moving the other arm",
  async ({ model, side }) => {
    const { scene, rig, camera } = await player(model);
    try {
      for (const missing of ["shoulder", "elbow", "wrist"]) {
        rig.reset();
        rig.applyPose(neutralBodyPose(), delta, 1);
        const lengths = arm(scene, side);
        const hand = trackedHand(side);
        hand.landmarks[0] = { x: 0.5, y: 0.5, z: 0 };
        rig.applyPose(withoutArm(side, missing), delta, 2, [hand]);
        const opposite = side === "left" ? "right" : "left";
        const fixed = armTransforms(scene, opposite);
        const target = reachableTarget(scene, side);
        setTarget(scene, camera, hand, target);
        rig.applyHandFallback(camera, imageAspect, delta);
        expectAtTarget(scene, camera, side, target, hand);
        expectLengths(scene, side, lengths);
        expect(armTransforms(scene, opposite)).toEqual(fixed);
      }
    } finally {
      rig.dispose();
    }
  },
);

test.each(modelTypes.player)(
  "%s animated asset follows both hands with no body and still rotates wrists/fingers/thumbs",
  async (model) => {
    const { scene, rig, camera } = await player(model, true);
    try {
      rig.reset();
      const hands = sides.map((side) => trackedHand(side));
      for (const hand of hands) hand.landmarks[0] = { x: 0.5, y: 0.5, z: 0 };
      rig.applyPose([], delta, 100, hands);
      const lengths = sides.map((side) => arm(scene, side));
      const targets = sides.map((side) => reachableTarget(scene, side));
      hands.forEach((hand, index) =>
        setTarget(scene, camera, hand, targets[index]),
      );
      rig.applyHandFallback(camera, imageAspect, delta);
      const rotations = sides.map((side) =>
        ["Hand", "Fingers", "Thumb"].map((part) =>
          bone(scene, side, part).getWorldQuaternion(new Quaternion()),
        ),
      );
      for (let index = 0; index < sides.length; index++) {
        expectAtTarget(
          scene,
          camera,
          sides[index],
          targets[index],
          hands[index],
        );
        expectLengths(scene, sides[index], lengths[index]);
      }
      const roll = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.8);
      const curled = sides.map((side, index) => {
        const hand = trackedHand(side, {
          rotation: roll,
          curl: 0.6,
          pip: 0.7,
          dip: 0.4,
          thumbCurl: 0.7,
          thumbOpposition: 0.9,
        });
        hand.landmarks[0] = { ...hands[index].landmarks[0] };
        return hand;
      });
      rig.applyPose([], delta, 200, curled);
      rig.applyHandFallback(camera, imageAspect, delta);
      sides.forEach((side, index) => {
        expectAtTarget(scene, camera, side, targets[index], curled[index]);
        expectLengths(scene, side, lengths[index]);
        for (const [part, joint] of [
          ["Hand", 0],
          ["Fingers", 1],
          ["Thumb", 2],
        ]) {
          expect(
            bone(scene, side, part)
              .getWorldQuaternion(new Quaternion())
              .angleTo(rotations[index][joint]),
          ).toBeGreaterThan(0.1);
        }
      });
    } finally {
      rig.dispose();
    }
  },
);

test.each(modelTypes.player)(
  "%s clamps unreachable hands, ignores centered hand translation, and recovers tracking/reset",
  async (model) => {
    const { scene, rig, camera, stock } = await player(model);
    try {
      const neutral = sides.map((side) => arm(scene, side));
      const hand = trackedHand("left");
      hand.landmarks[0] = { x: 0.5, y: 0.5, z: 0 };
      const pose = withoutArm("left");
      rig.applyPose(pose, delta, 100, [hand]);
      const lengths = arm(scene, "left");
      const reach = lengths.upper + lengths.lower;
      const target = lengths.shoulder
        .clone()
        .add(new Vector3(reach * 2, -reach * 0.2, 0));
      target.z = lengths.wrist.z;
      setTarget(scene, camera, hand, target);
      rig.applyHandFallback(camera, imageAspect, delta);
      expect(
        position(scene, "left", "Hand").distanceTo(lengths.shoulder),
      ).toBeCloseTo(reach, 9);
      expectLengths(scene, "left", lengths);
      const reached = position(scene, "left", "Hand");
      const rotation = bone(scene, "left", "Hand").getWorldQuaternion(
        new Quaternion(),
      );
      const translated = trackedHand("left", {
        origin: new Vector3(10, -20, 30),
      });
      translated.landmarks[0] = { ...hand.landmarks[0], z: -999 };
      // Slow, continuous inference keeps the same held depth even when target
      // rotation history is cleared after an interval longer than 500 ms.
      for (const timestamp of [900, 1800, 2700]) {
        rig.applyPose(pose, delta, timestamp, [translated]);
        rig.applyHandFallback(camera, imageAspect, delta);
        expect(
          position(scene, "left", "Hand").distanceTo(reached),
        ).toBeLessThan(1e-7);
        expect(
          bone(scene, "left", "Hand")
            .getWorldQuaternion(new Quaternion())
            .angleTo(rotation),
        ).toBeLessThan(1e-6);
        expectLengths(scene, "left", lengths);
      }
      rig.applyPose(neutralBodyPose(), delta, 2800);
      rig.applyHandFallback(camera, imageAspect, delta);
      sides.forEach((side, index) => {
        const actual = arm(scene, side);
        // A straight tracked arm leaves bone roll unobservable, so its retained
        // bend-plane history may differ while every observed joint is correct.
        for (const joint of ["shoulder", "elbow", "wrist"]) {
          expect(actual[joint].distanceTo(neutral[index][joint])).toBeLessThan(
            1e-7,
          );
        }
      });
      // A stale frame is an empty body/hand sample; it must not keep solving the
      // previous wrist indefinitely, including after another post-framing call.
      rig.applyPose(pose, delta, 2900, [hand]);
      rig.applyHandFallback(camera, imageAspect, delta);
      rig.applyPose([], delta);
      rig.applyHandFallback(camera, imageAspect, delta);
      for (const [node, expected] of stock) {
        expect(node.position.toArray()).toEqual(expected[0]);
        expect(
          node.quaternion
            .clone()
            .normalize()
            .angleTo(new Quaternion(...expected[1]).normalize()),
        ).toBeLessThan(1e-6);
      }
      rig.applyPose(pose, delta, 3100, [hand]);
      const reacquired = reachableTarget(scene, "left", 0.4, 0.4);
      setTarget(scene, camera, hand, reacquired);
      rig.applyHandFallback(camera, imageAspect, delta);
      expectAtTarget(scene, camera, "left", reacquired, hand);
      rig.reset();
      expect(localTransforms(scene)).toEqual(stock);
    } finally {
      rig.dispose();
    }
  },
);

test("cached hand sample is retargeted through changed final camera framing", async () => {
  const { scene, rig, camera } = await player("lmale");
  try {
    const hand = trackedHand("left");
    hand.landmarks[0] = { x: 0.5, y: 0.5, z: 0 };
    const pose = withoutArm("left");
    rig.applyPose(pose, delta, 100, [hand]);
    const target = reachableTarget(scene, "left");
    setTarget(scene, camera, hand, target);
    rig.applyHandFallback(camera, imageAspect, delta);
    const first = position(scene, "left", "Hand");
    camera.projectionMatrix.premultiply(
      new Matrix4().makeTranslation(0.03, -0.025, 0),
    );
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    // The detector did not run again: the render camera alone changed.
    rig.applyPose(pose, delta, 100, [hand]);
    rig.applyHandFallback(camera, imageAspect, delta);
    const second = position(scene, "left", "Hand");
    expect(first.distanceTo(second)).toBeGreaterThan(0.001);
    const projected = imagePoint(scene, camera, second);
    expect(projected.x).toBeCloseTo(hand.landmarks[0].x, 8);
    expect(projected.y).toBeCloseTo(hand.landmarks[0].y, 8);
  } finally {
    rig.dispose();
  }
});

test.each(sides)(
  "raw %s hand fallback follows the mirrored preview side",
  async (sourceSide) => {
    const { scene, rig, camera } = await player("hbioderm");
    try {
      const side = sourceSide === "left" ? "right" : "left";
      const mirrored = mirrorTrackedHands([trackedHand(sourceSide)])[0];
      mirrored.landmarks[0] = { x: 0.5, y: 0.5, z: 0 };
      rig.applyPose([], delta, 100, [mirrored]);
      const target = reachableTarget(scene, side);
      const raw = trackedHand(sourceSide);
      raw.landmarks[0] = imagePoint(scene, camera, target);
      raw.landmarks[0].x = 1 - raw.landmarks[0].x;
      const hand = mirrorTrackedHands([raw])[0];
      rig.applyPose([], delta, 101, [hand]);
      rig.applyHandFallback(camera, imageAspect, delta);
      expectAtTarget(scene, camera, side, target, hand);
      expect(hand.side).toBe(side);
      expect(Math.sign(target.x - position(scene, side, "UpperArm").x)).toBe(
        side === "left" ? 1 : -1,
      );
    } finally {
      rig.dispose();
    }
  },
);

test.each(["classic", "adaptive", "stable"])(
  "%s smoothing converges without stretching at different render rates",
  async (mode) => {
    const results = [];
    for (const fps of [30, 120]) {
      const { scene, rig, camera } = await player("lmale");
      try {
        const hand = trackedHand("left");
        hand.landmarks[0] = { x: 0.5, y: 0.5, z: 0 };
        const pose = withoutArm("left");
        rig.applyPose(pose, delta, 100, [hand]);
        const lengths = arm(scene, "left");
        const target = reachableTarget(scene, "left", 0.4, 0.4);
        setTarget(scene, camera, hand, target);
        rig.setSmoothing(mode);
        for (let frame = 0; frame < fps * 2; frame++) {
          rig.applyPose(pose, 1 / fps, 100, [hand]);
          rig.applyHandFallback(camera, imageAspect, 1 / fps);
          expectLengths(scene, "left", lengths);
        }
        const wrist = position(scene, "left", "Hand");
        const reach = lengths.upper + lengths.lower;
        expect(wrist.distanceTo(target) / reach).toBeLessThan(0.01);
        results.push({ wrist, reach });
      } finally {
        rig.dispose();
      }
    }
    expect(
      results[0].wrist.distanceTo(results[1].wrist) / results[0].reach,
    ).toBeLessThan(0.01);
  },
);

test.each(cases)(
  "$model $side keeps a detailed hand when body arm landmarks collapse",
  async ({ model, side }) => {
    const { scene, rig, camera } = await player(model);
    try {
      const first = side === "left" ? 11 : 12;
      const otherSide = side === "left" ? "right" : "left";
      for (const collapsed of ["upper", "lower"]) {
        rig.reset();
        rig.applyPose(neutralBodyPose(), delta, 1);
        const otherBefore = armTransforms(scene, otherSide);
        const lengths = arm(scene, side);
        const pose = neutralBodyPose();
        // Confidence alone does not make a zero-length tracked segment usable.
        // The separate 21-point hand remains valid and can supply the fallback.
        const joint = first + (collapsed === "upper" ? 2 : 4);
        pose[joint] = { ...pose[joint - 2] };
        const hand = trackedHand(side);
        hand.landmarks[0] = { x: 0.5, y: 0.5, z: 0 };
        rig.applyPose(pose, delta, 2, [hand]);
        const target = reachableTarget(scene, side);
        setTarget(scene, camera, hand, target);
        rig.applyHandFallback(camera, imageAspect, delta);
        expectAtTarget(scene, camera, side, target, hand);
        expectLengths(scene, side, lengths);
        armTransforms(scene, otherSide).forEach((transform, jointIndex) => {
          transform.forEach((components, componentIndex) => {
            components.forEach((value, axis) => {
              expect(value).toBeCloseTo(
                otherBefore[jointIndex][componentIndex][axis],
                12,
              );
            });
          });
        });
      }
    } finally {
      rig.dispose();
    }
  },
);

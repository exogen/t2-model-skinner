import { expect, test, vi } from "vitest";
import {
  AnimationMixer,
  LoopOnce,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from "three";
import Viewer, { disposeObject } from "./Viewer";
import { armPoseClip } from "./armPoses";
import { armThread } from "./models";
import {
  bone,
  bonePosition,
  loadPlayer,
  playerAssets,
} from "./mocap/playerTestUtils.mjs";

// In the game, only light armor carries the laser rifle.
const withoutLaserRiflePose = ["hmale", "lbioderm", "mbioderm", "hbioderm"];

/** Whether two rotations match, to float32 precision. */
function expectSameRotation(actual, expected) {
  expect(Math.abs(actual.dot(expected))).toBeGreaterThan(1 - 1e-6);
}

/** `scene` posed by `clip` at its middle, level aim, alone. */
function holdMiddle(scene, clip) {
  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
  action.play();
  action.paused = true;
  action.time = clip.duration / 2;
  mixer.update(0);
  scene.updateMatrixWorld(true);
  return mixer;
}

test.each(playerAssets)(
  "%s has an arm animation for each weapon held its own way",
  async (model) => {
    const { animations } = await loadPlayer(model, true);
    const names = animations.map(({ name }) => name);
    expect(names).toContain(armThread(model, "missile"));
    if (withoutLaserRiflePose.includes(model))
      expect(names).not.toContain(armThread(model, "sniper"));
    else expect(names).toContain(armThread(model, "sniper"));
    // Other weapons use the default arm animation, whose level aim is the rest pose.
    expect(armThread(model, "disc")).toBeFalsy();
  },
);

test("the medium female holds the missile launcher with her Lookth animation", () => {
  expect(armThread("mfemale", "missile")).toBe("Lookth");
  expect(armThread("lfemale", "missile")).toBe("Lookms");
});

test.each([
  ["lmale", "missile"],
  ["lmale", "sniper"],
  ["mfemale", "missile"],
  ["lfemale", "sniper"],
  ["hbioderm", "missile"],
])(
  "on %s without an animation, the %s arm pose puts the hands where the game's arm animation does",
  async (model, weapon) => {
    const [plain, animated] = await Promise.all([
      loadPlayer(model),
      loadPlayer(model, true),
    ]);
    const clip = animated.animations.find(
      ({ name }) => name === armThread(model, weapon),
    );
    const pose = armPoseClip(clip, animated.scene);
    holdMiddle(plain.scene, pose);
    holdMiddle(animated.scene, clip);
    for (const hand of ["R_Hand", "L_Hand"]) {
      expect(
        bonePosition(plain.scene, hand).distanceTo(
          bonePosition(animated.scene, hand),
        ),
      ).toBeLessThan(1e-6);
    }
    // The pose moves the right arm well away from rest.
    const rest = (await loadPlayer(model)).scene;
    rest.updateMatrixWorld(true);
    expect(
      bonePosition(plain.scene, "R_Hand").distanceTo(
        bonePosition(rest, "R_Hand"),
      ),
    ).toBeGreaterThan(1e-4);
    disposeObject(plain.scene);
    disposeObject(animated.scene);
    disposeObject(rest);
  },
);

test("over another animation, the arm pose turns each bone from where that animation has it", async () => {
  const [{ scene, animations }, source] = await Promise.all([
    loadPlayer("lmale", true),
    loadPlayer("lmale", true),
  ]);
  const clip = source.animations.find(({ name }) => name === "Lookms");
  const pose = armPoseClip(clip, source.scene);
  const run = animations.find(({ name }) => name === "Forward");
  const mixer = new AnimationMixer(scene);
  mixer.clipAction(run).play();
  mixer.update(0.2);
  const arm = bone(scene, "R_UpperArm");
  const running = arm.quaternion.clone();
  const action = mixer.clipAction(pose);
  action.play();
  action.paused = true;
  mixer.update(0);
  const change = new Quaternion().fromArray(
    pose.tracks.find(({ name }) => name === "Bip01_R_UpperArm.quaternion")
      .values,
  );
  expectSameRotation(arm.quaternion, running.multiply(change));
  disposeObject(scene);
  disposeObject(source.scene);
});

function viewerHarness(scene, animations) {
  return Object.assign(Object.create(Viewer.prototype), {
    model: { scene, animations },
    mixer: new AnimationMixer(scene),
    action: null,
    armAction: null,
    rig: null,
    posing: false,
    paused: false,
    playbackSpeed: 1,
    poseAnimationTime: 0,
    camera: new PerspectiveCamera(),
    controls: { target: new Vector3(), update() {} },
    invalidate: vi.fn(),
  });
}

test("the arm pose stays through animation changes, leaves while posing with the camera, and comes back", async () => {
  const [{ scene, animations }, source] = await Promise.all([
    loadPlayer("lmale", true),
    loadPlayer("lmale", true),
  ]);
  const pose = armPoseClip(
    source.animations.find(({ name }) => name === "Looksn"),
    source.scene,
  );
  const viewer = viewerHarness(scene, animations);
  const arm = bone(scene, "R_UpperArm");
  const rest = arm.quaternion.clone();
  const posed = rest
    .clone()
    .multiply(
      new Quaternion().fromArray(
        pose.tracks.find(({ name }) => name === "Bip01_R_UpperArm.quaternion")
          .values,
      ),
    );

  viewer.setArmPose(pose);
  expectSameRotation(arm.quaternion, posed);
  // Paused, a new animation replaces the old at once, and the pose stays.
  viewer.setAnimation("Root", true, 0.5);
  viewer.setAnimation(null, true, 0.5);
  expectSameRotation(arm.quaternion, posed);

  viewer.setPoseMode(true);
  expectSameRotation(arm.quaternion, rest);
  viewer.setPoseMode(false);
  expectSameRotation(arm.quaternion, posed);

  viewer.setArmPose(null);
  expectSameRotation(arm.quaternion, rest);
  disposeObject(scene);
  disposeObject(source.scene);
});

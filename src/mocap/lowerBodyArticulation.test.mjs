import { expect, test } from "vitest";
import { Quaternion, Vector3 } from "three";
import { modelTypes } from "../models";
import { createPlayerRig } from "./rig";
import { neutralBodyPose, rotateLandmarks, toLandmark, toModel } from "./handTestUtils.mjs";
import { bonePosition, loadPlayer } from "./playerTestUtils.mjs";
import { expectUnmoved, maxMovement, snapshot, vertices } from "./skinTestUtils.mjs";

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);
const SIDES = [["L", 0], ["R", 1]];
const cases = modelTypes.player.flatMap((model) => [false, true].map((animated) => ({ model, animated })));

function point(pose, index) {
  return toModel(pose[index]);
}

function put(pose, index, position) {
  pose[index] = toLandmark(position);
}

function neutralPose() {
  const pose = neutralBodyPose({ hands: false });
  const set = (index, x, y, z) => put(pose, index, new Vector3(x, y, z));
  for (const [offset, sign] of [[0, 1], [1, -1]]) {
    // A slight initial knee bend makes the anatomical bend plane measurable.
    set(27 + offset, sign * 0.15, 0.1, -0.1);
    set(29 + offset, sign * 0.15, 0, -0.18);
    set(31 + offset, sign * 0.15, 0, 0.1);
  }
  return pose;
}

function boneVertices(scene, names) {
  return vertices(scene, (mesh) => mesh.isSkinnedMesh &&
    mesh.skeleton.bones.some((joint) => names.includes(joint.name.slice(6))));
}

function around(position, pivot, rotation, translation = new Vector3()) {
  return position.sub(pivot).applyQuaternion(rotation).add(pivot).add(translation);
}

function legNames(side) {
  return ["Thigh", "Calf", "Foot", "Toe0"].map((part) => `${side}_${part}`);
}

test.each(cases)("$model lower joints deform the actual leg, boot and toe vertices independently (animated: $animated)",
  async ({ model, animated }) => {
    const { scene } = await loadPlayer(model, animated);
    scene.updateWorldMatrix(true, true);
    const samples = boneVertices(scene, SIDES.flatMap(([side]) => legNames(side)));
    const stock = snapshot(samples);
    const rig = createPlayerRig(scene);
    rig.setSmoothing("none");
    const baseline = neutralPose();
    let timestamp = 0;
    const apply = (pose) => rig.applyPose(pose, 1 / 60, ++timestamp);
    try {
      for (const [side, offset] of SIDES) {
        const thigh = boneVertices(scene, [`${side}_Thigh`]);
        const calf = boneVertices(scene, [`${side}_Calf`]);
        const foot = boneVertices(scene, [`${side}_Foot`, `${side}_Toe0`]);
        const otherLeg = boneVertices(scene, legNames(side === "L" ? "R" : "L"));
        expect(thigh.length).toBeGreaterThan(3);
        expect(calf.length).toBeGreaterThan(3);
        expect(foot.length).toBeGreaterThan(3);

        for (const [motion, axis, angle] of [
          ["pitch", X, Math.PI / 4], ["yaw", Y, Math.PI / 2],
          ["roll", Z, Math.PI / 4], ["sole reversal", Z, Math.PI],
        ]) {
          rig.reset();
          apply(baseline);
          const ankle = bonePosition(scene, `${side}_Foot`);
          const before = snapshot(foot);
          const fixed = snapshot([...thigh, ...calf, ...otherLeg]);
          const rotation = new Quaternion().setFromAxisAngle(axis, angle);
          apply(rotateLandmarks(baseline, [29 + offset, 31 + offset], rotation, point(baseline, 27 + offset)));
          expect(maxMovement(before)).toBeGreaterThan(1e-5);
          expectUnmoved(before, { transform: (position) => around(position, ankle, rotation), label: `${side} foot ${motion}` });
          expectUnmoved(fixed);
        }

        rig.reset();
        apply(baseline);
        const knee = bonePosition(scene, `${side}_Calf`);
        const belowKnee = snapshot([...calf, ...foot]);
        const fixed = snapshot([...thigh, ...otherLeg]);
        const kneeRotation = new Quaternion().setFromAxisAngle(X, Math.PI / 2 - Math.atan(0.1 / 0.4));
        const bent = rotateLandmarks(baseline, [27 + offset, 29 + offset, 31 + offset], kneeRotation, point(baseline, 25 + offset));
        apply(bent);
        expectUnmoved(belowKnee, { transform: (position) => around(position, knee, kneeRotation), label: `${side} knee flexion` });
        expectUnmoved(fixed);

        // Keep a measured 45° sole roll through a nearly collinear triangle,
        // including when the calf moves. A cached world-space up would fail.
        rig.reset();
        const roll = new Quaternion().setFromAxisAngle(Z, Math.PI / 4);
        const rolled = rotateLandmarks(baseline, [29 + offset, 31 + offset], roll, point(baseline, 27 + offset));
        apply(rolled);
        const rolledBoot = snapshot(foot);
        const rolledCalf = snapshot(calf);
        const rolledFixed = snapshot([...thigh, ...otherLeg]);
        const anklePoint = point(rolled, 27 + offset);
        const forward = point(rolled, 31 + offset).sub(point(rolled, 29 + offset)).normalize();
        const soleUp = Y.clone().applyQuaternion(roll);
        for (const noise of [-0.001, 0, 0.001, -0.00001]) {
          const uncertain = rolled.map((landmark) => ({ ...landmark }));
          put(uncertain, 29 + offset, anklePoint.clone().addScaledVector(forward, -0.08).addScaledVector(soleUp, noise));
          put(uncertain, 31 + offset, anklePoint.clone().addScaledVector(forward, 0.2).addScaledVector(soleUp, noise));
          apply(uncertain);
          expectUnmoved(rolledBoot, { label: `${side} sole noise ${noise}` });
          expectUnmoved(rolledCalf);
          expectUnmoved(rolledFixed);
          // Move the calf and its uncertain foot together, then move back.
          apply(rotateLandmarks(uncertain, [27 + offset, 29 + offset, 31 + offset], kneeRotation, point(rolled, 25 + offset)));
          expectUnmoved(rolledBoot, {
            transform: (position) => around(position, knee, kneeRotation), label: `${side} calf-relative sole history`,
          });
          expectUnmoved(rolledCalf, { transform: (position) => around(position, knee, kneeRotation) });
          expectUnmoved(rolledFixed);
          apply(uncertain);
        }
      }
      rig.reset();
      expectUnmoved(stock, { label: "stock reset" });
    } finally {
      rig.dispose();
    }
  });

test.each(cases)("$model hips, knees and boots follow a squat and body turn (animated: $animated)",
  async ({ model, animated }) => {
    const { scene } = await loadPlayer(model, animated);
    scene.updateWorldMatrix(true, true);
    const rig = createPlayerRig(scene);
    rig.setSmoothing("none");
    const baseline = neutralPose();
    try {
      rig.applyPose(baseline, 1 / 60, 1);
      const squat = baseline.map((landmark) => ({ ...landmark }));
      const expected = [];
      for (const [side, offset] of SIDES) {
        const hip = bonePosition(scene, `${side}_Thigh`);
        const knee = bonePosition(scene, `${side}_Calf`);
        const ankle = bonePosition(scene, `${side}_Foot`);
        const thighRotation = new Quaternion().setFromAxisAngle(X, -Math.PI / 4);
        const calfRotation = new Quaternion().setFromAxisAngle(X, Math.PI / 4 - Math.atan(0.1 / 0.4));
        const targetKnee = around(knee.clone(), hip, thighRotation);
        const kneeTranslation = targetKnee.clone().sub(knee);
        const targetAnkle = around(ankle.clone(), knee, calfRotation, kneeTranslation);
        expected.push({
          thigh: snapshot(boneVertices(scene, [`${side}_Thigh`])),
          calf: snapshot(boneVertices(scene, [`${side}_Calf`])),
          foot: snapshot(boneVertices(scene, [`${side}_Foot`, `${side}_Toe0`])),
          hip, knee, thighRotation, calfRotation, kneeTranslation,
          ankleTranslation: targetAnkle.clone().sub(ankle),
        });
        const inputHip = point(baseline, 23 + offset);
        const inputKnee = point(baseline, 25 + offset);
        const newKnee = around(inputKnee.clone(), inputHip, thighRotation);
        const newAnkle = around(point(baseline, 27 + offset), inputKnee, calfRotation, newKnee.clone().sub(inputKnee));
        put(squat, 25 + offset, newKnee);
        put(squat, 27 + offset, newAnkle);
        for (const index of [29 + offset, 31 + offset]) {
          put(squat, index, point(baseline, index).add(newAnkle.clone().sub(point(baseline, 27 + offset))));
        }
      }
      rig.applyPose(squat, 1 / 60, 2);
      for (const saved of expected) {
        expectUnmoved(saved.thigh, { transform: (position) => around(position, saved.hip, saved.thighRotation), label: "squat thigh" });
        expectUnmoved(saved.calf, {
          transform: (position) => around(position, saved.knee, saved.calfRotation, saved.kneeTranslation), label: "squat calf",
        });
        expectUnmoved(saved.foot, { transform: (position) => position.add(saved.ankleTranslation), label: "squat boot stays level" });
      }

      rig.reset();
      rig.applyPose(baseline, 1 / 60, 3);
      const pelvis = bonePosition(scene, "Pelvis");
      const lower = snapshot(boneVertices(scene, ["Pelvis", ...SIDES.flatMap(([side]) => legNames(side))]));
      const yaw = new Quaternion().setFromAxisAngle(Y, Math.PI / 2);
      const tracked = baseline.map((_, index) => index).filter((index) => baseline[index].visibility);
      rig.applyPose(rotateLandmarks(baseline, tracked, yaw, new Vector3(0, 1, 0)), 1 / 60, 4);
      expectUnmoved(lower, { transform: (position) => around(position, pelvis, yaw), label: "whole-body turn" });
    } finally {
      rig.dispose();
    }
  });

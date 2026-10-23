import { expect, test } from "vitest";
import { Group, Quaternion, Vector3 } from "three";
import { createPlayerRig } from "./rig";
import { emptyPose, neutralBodyPose, settle, toModel } from "./handTestUtils.mjs";
import { bone, direction, loadPlayer, playerAssets } from "./playerTestUtils.mjs";

const tPose = () => neutralBodyPose({ hands: false });

function snapshot(scene) {
  const values = [];
  scene.traverse((node) => values.push({
    node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(),
  }));
  return values;
}

test.each(playerAssets)("%s follows a synthetic pose using its existing rigid skin and hierarchy", async (name) => {
  const { scene } = await loadPlayer(name);
  const before = snapshot(scene);
  const rig = createPlayerRig(scene);
  expect(rig).not.toBeNull();
  let mesh;
  scene.traverse((node) => {
    if (node.isSkinnedMesh && node.skeleton.bones.includes(bone(scene, "L_UpperArm"))) mesh = node;
  });
  const vertex = new Vector3().fromBufferAttribute(mesh.geometry.attributes.position, 0);
  const originalVertex = mesh.applyBoneTransform(0, vertex.clone());
  settle(rig, tPose());
  for (const [side, x] of [["L", 1], ["R", -1]]) {
    expect(direction(scene, `${side}_UpperArm`, `${side}_Forearm`).dot(new Vector3(x, 0, 0))).toBeGreaterThan(0.9999);
    expect(direction(scene, `${side}_Forearm`, `${side}_Hand`).dot(new Vector3(x, 0, 0))).toBeGreaterThan(0.9999);
    expect(direction(scene, `${side}_Thigh`, `${side}_Calf`).dot(new Vector3(0, -1, 0))).toBeGreaterThan(0.9999);
    expect(direction(scene, `${side}_Calf`, `${side}_Foot`).dot(new Vector3(0, -1, 0))).toBeGreaterThan(0.9999);
  }
  expect(mesh.applyBoneTransform(0, vertex.clone()).distanceTo(originalVertex)).toBeGreaterThan(0.00001);
  for (const saved of before) {
    expect(saved.node.position.equals(saved.position)).toBe(true);
    expect(saved.node.scale.equals(saved.scale)).toBe(true);
    expect(saved.node.quaternion.toArray().every(Number.isFinite)).toBe(true);
  }
  rig.reset();
  for (const saved of before) expect(saved.node.quaternion.equals(saved.quaternion)).toBe(true);
});

test("arm tracking still works when hips and lower body are out of view", async () => {
  const { scene } = await loadPlayer("lfemale");
  const rig = createPlayerRig(scene);
  const pose = tPose();
  for (let i = 23; i < pose.length; i++) pose[i].visibility = 0;
  const thigh = bone(scene, "L_Thigh").quaternion.clone().normalize();
  settle(rig, pose);
  expect(direction(scene, "L_UpperArm", "L_Forearm").x).toBeGreaterThan(0.9999);
  expect(bone(scene, "L_Thigh").quaternion.angleTo(thigh)).toBeLessThan(1e-6);
});

test("a bent elbow and knee follow anatomical left without moving the other side", async () => {
  const { scene } = await loadPlayer("mbioderm");
  const rig = createPlayerRig(scene);
  const pose = tPose();
  pose[15] = { x: 0.6, y: -1.8, z: 0, visibility: 1 };
  pose[27] = { x: 0.15, y: -0.5, z: 0.4, visibility: 1 };
  settle(rig, pose);
  expect(direction(scene, "L_Forearm", "L_Hand").dot(new Vector3(0, 1, 0))).toBeGreaterThan(0.9999);
  expect(direction(scene, "L_Calf", "L_Foot").dot(new Vector3(0, 0, -1))).toBeGreaterThan(0.9999);
  expect(direction(scene, "R_Forearm", "R_Hand").x).toBeLessThan(-0.9999);
});

test("unreliable limbs settle to rest while reliable limbs continue tracking", async () => {
  const { scene } = await loadPlayer("lmale");
  const rig = createPlayerRig(scene);
  const rest = bone(scene, "L_UpperArm").quaternion.clone().normalize();
  const pose = tPose();
  settle(rig, pose);
  expect(bone(scene, "L_UpperArm").quaternion.angleTo(rest)).toBeGreaterThan(0.1);
  pose[13].visibility = 0.1;
  settle(rig, pose);
  expect(bone(scene, "L_UpperArm").quaternion.angleTo(rest)).toBeLessThan(1e-6);
  expect(direction(scene, "R_UpperArm", "R_Forearm").x).toBeLessThan(-0.9999);
  settle(rig, []);
  expect(bone(scene, "L_UpperArm").quaternion.angleTo(rest)).toBeLessThan(1e-6);
});

test("world transforms outside the rig do not change pose interpretation", async () => {
  const { scene } = await loadPlayer("hmale");
  const container = new Group();
  container.position.set(7, 8, 9);
  container.rotation.y = Math.PI / 2;
  container.scale.setScalar(50);
  container.add(scene);
  const rig = createPlayerRig(scene);
  settle(rig, tPose());
  expect(direction(scene, "L_UpperArm", "L_Forearm").dot(new Vector3(0, 0, -1))).toBeGreaterThan(0.9999);
  expect(container.position.toArray()).toEqual([7, 8, 9]);
  expect(container.scale.toArray()).toEqual([50, 50, 50]);
});

test("head motion is independent of the neck node that also parents the shoulders", async () => {
  const { scene } = await loadPlayer("lmale");
  const rig = createPlayerRig(scene);
  const pose = tPose();
  settle(rig, pose);
  const originalHead = bone(scene, "Head").getWorldQuaternion(new Quaternion());
  const originalNeck = bone(scene, "Neck").quaternion.clone();
  const originalArm = direction(scene, "L_UpperArm", "L_Forearm");
  pose[0].x = 0.12;
  pose[0].z = 0;
  pose[7].x = 0;
  pose[7].z = 0.1;
  pose[8].x = 0;
  pose[8].z = -0.1;
  settle(rig, pose);
  expect(bone(scene, "Head").getWorldQuaternion(new Quaternion()).angleTo(originalHead)).toBeGreaterThan(1);
  expect(bone(scene, "Neck").quaternion.angleTo(originalNeck)).toBeLessThan(1e-6);
  expect(direction(scene, "L_UpperArm", "L_Forearm").distanceTo(originalArm)).toBeLessThan(1e-6);
});

// Numerical output from Pose Landmarker Lite on the official MediaPipe pose
// sample: an upright person looking sideways. No image is required by the test.
const sidewaysHeadLandmarks = {
  0: [-0.076872, -0.629300, -0.125100],
  7: [0.029819, -0.657336, -0.087559],
  8: [-0.076818, -0.637762, -0.009113],
  11: [0.169104, -0.508975, -0.073030],
  12: [-0.141661, -0.480413, 0.047819],
  23: [0.099937, 0.008144, -0.046209],
  24: [-0.100631, -0.008430, 0.046472],
};

test.each(playerAssets)("%s maps measured gaze without confusing the eye attachment height with head pitch", async (name) => {
  const { scene } = await loadPlayer(name);
  const rig = createPlayerRig(scene);
  const pose = emptyPose();
  for (const [index, [x, y, z]] of Object.entries(sidewaysHeadLandmarks)) {
    pose[index] = { x, y, z, visibility: 1 };
  }
  const point = (index) => toModel(pose[index]);
  const measuredForward = point(0).sub(point(7).add(point(8)).multiplyScalar(0.5)).normalize();
  settle(rig, pose);
  const headRotation = bone(scene, "Head").getWorldQuaternion(new Quaternion());
  const actualForward = new Vector3(0, 0, 1).applyQuaternion(headRotation);
  expect(actualForward.dot(measuredForward)).toBeGreaterThan(0.9999);
  expect(actualForward.y).toBeGreaterThan(-0.25);
  expect(actualForward.x).toBeLessThan(-0.4);
  // The head stays upright while looking left; it does not bury its face in
  // the breastplate because the exported Eye point is above the neck pivot.
  expect(new Vector3(-1, 0, 0).applyQuaternion(headRotation).y).toBeGreaterThan(0.9);
});

test.each(playerAssets)("%s keeps level ears level despite asymmetric nose/depth estimates", async (name) => {
  const { scene } = await loadPlayer(name);
  const rig = createPlayerRig(scene);
  rig.setSmoothing("none");
  const pose = tPose();
  pose[7] = { x: 0.1, y: -1.75, z: -0.03, visibility: 1 };
  pose[8] = { x: -0.1, y: -1.75, z: 0.03, visibility: 1 };
  pose[0] = { x: 0.02, y: -1.725, z: -0.12, visibility: 1 };
  rig.applyPose(pose, 1 / 60);
  const rotation = bone(scene, "Head").getWorldQuaternion(new Quaternion());
  // Head +Y is the lateral axis: its elevation must follow the observed ears,
  // rather than acquiring roll as the nose-forward vector is orthogonalized.
  const lateral = new Vector3(0, 1, 0).applyQuaternion(rotation);
  expect(lateral.y).toBeCloseTo(0, 7);
  expect(lateral.dot(new Vector3(0.2, 0, 0.06).normalize())).toBeCloseTo(1, 7);
});

test("rigid mitts and boots follow their tracked directions without finger or toe animation", async () => {
  const { scene } = await loadPlayer("hbioderm");
  const rig = createPlayerRig(scene);
  const pose = tPose();
  const set = (i, x, y, z) => { pose[i] = { x, y: -y, z: -z, visibility: 1 }; };
  set(19, 1.1, 1.5, 0.04);
  set(17, 1.1, 1.5, -0.04);
  set(20, -1.1, 1.5, 0.04);
  set(18, -1.1, 1.5, -0.04);
  set(29, 0.15, 0, -0.05);
  set(31, 0.15, 0, 0.2);
  set(30, -0.15, 0, -0.05);
  set(32, -0.15, 0, 0.2);
  const toe = bone(scene, "L_Toe0").quaternion.clone().normalize();
  settle(rig, pose);
  for (const [side, x] of [["L", 1], ["R", -1]]) {
    const handRotation = bone(scene, `${side}_Hand`).getWorldQuaternion(new Quaternion());
    expect(new Vector3(-1, 0, 0).applyQuaternion(handRotation).dot(new Vector3(x, 0, 0))).toBeGreaterThan(0.9999);
    expect(new Vector3(0, 0, 1).applyQuaternion(handRotation).dot(new Vector3(0, -1, 0))).toBeGreaterThan(0.9999);
    const footRotation = bone(scene, `${side}_Foot`).getWorldQuaternion(new Quaternion());
    expect(new Vector3(0, 0, 1).applyQuaternion(footRotation).z).toBeGreaterThan(0.9999);
    expect(new Vector3(1, 0, 0).applyQuaternion(footRotation).y).toBeGreaterThan(0.9999);
  }
  expect(bone(scene, "L_Toe0").quaternion.angleTo(toe)).toBeLessThan(1e-6);
});

test("dispose restores rest and ignores late inference frames", async () => {
  const { scene } = await loadPlayer("hbioderm");
  const rig = createPlayerRig(scene);
  const before = snapshot(scene);
  settle(rig, tPose());
  rig.dispose();
  settle(rig, tPose());
  for (const saved of before) expect(saved.node.quaternion.equals(saved.quaternion)).toBe(true);
});

test("non-player objects do not create a rig", () => {
  expect(createPlayerRig(new Group())).toBeNull();
});

test("a weak-bend camera sample has the same roll on 30, 60, and 120 Hz displays", async () => {
  const results = [];
  for (const fps of [30, 60, 120]) {
    const { scene } = await loadPlayer("lmale");
    const rig = createPlayerRig(scene);
    // Remove display damping to isolate bend-plane feedback from rendering.
    rig.setSmoothing("none");
    const pose = tPose();
    for (let frame = 0; frame < fps / 2; frame++) {
      const cameraFrame = Math.floor(frame * 30 / fps);
      pose[15] = { x: 0.9, y: -1.5 - 0.015 * Math.cos(cameraFrame / 4), z: 0.01, visibility: 1 };
      rig.applyPose(pose, 1 / fps, cameraFrame * 1000 / 30);
    }
    results.push(bone(scene, "L_UpperArm").getWorldQuaternion(new Quaternion()));
  }
  expect(results[0].angleTo(results[1])).toBeLessThan(1e-6);
  expect(results[0].angleTo(results[2])).toBeLessThan(1e-6);
});

test("cached samples keep rendering smoothly and missing tracking clears the old pose", async () => {
  const { scene } = await loadPlayer("lfemale");
  const rig = createPlayerRig(scene);
  const rest = bone(scene, "L_UpperArm").quaternion.clone().normalize();
  const pose = tPose();
  rig.applyPose(pose, 1 / 60, 100);
  const first = direction(scene, "L_UpperArm", "L_Forearm").x;
  for (let frame = 0; frame < 120; frame++) rig.applyPose(pose, 1 / 60, 100);
  expect(direction(scene, "L_UpperArm", "L_Forearm").x).toBeGreaterThan(first);
  expect(direction(scene, "L_UpperArm", "L_Forearm").x).toBeGreaterThan(0.9999);
  for (let frame = 0; frame < 120; frame++) rig.applyPose([], 1 / 60, 100);
  expect(bone(scene, "L_UpperArm").quaternion.angleTo(rest)).toBeLessThan(1e-6);
  // The same timestamp is valid again after losing or explicitly resetting a pose.
  rig.setSmoothing("none");
  rig.applyPose(pose, 1 / 60, 100);
  expect(direction(scene, "L_UpperArm", "L_Forearm").x).toBeGreaterThan(0.9999);
  rig.reset();
  expect(bone(scene, "L_UpperArm").quaternion.clone().normalize().angleTo(rest)).toBeLessThan(1e-6);
  rig.applyPose(pose, 1 / 60, 100);
  expect(direction(scene, "L_UpperArm", "L_Forearm").x).toBeGreaterThan(0.9999);
});

test.each(playerAssets)("%s supports adaptive rotation smoothing without changing its rest transforms", async (name) => {
  const { scene } = await loadPlayer(name);
  const rig = createPlayerRig(scene);
  const saved = snapshot(scene);
  for (const mode of ["adaptive", "stable", "none"]) {
    rig.reset();
    rig.setSmoothing(mode);
    const pose = tPose();
    for (let frame = 0; frame < 120; frame++) rig.applyPose(pose, 1 / 60, 100);
    expect(direction(scene, "L_UpperArm", "L_Forearm").x).toBeGreaterThan(0.9999);
    expect(direction(scene, "R_Calf", "R_Foot").y).toBeLessThan(-0.9999);
    for (const before of saved) {
      expect(before.node.position.equals(before.position)).toBe(true);
      expect(before.node.scale.equals(before.scale)).toBe(true);
      expect(before.node.quaternion.toArray().every(Number.isFinite)).toBe(true);
    }
  }
});

test("changing smoothing preserves the current pose and clears filter history", async () => {
  const { scene } = await loadPlayer("mbioderm");
  const rig = createPlayerRig(scene);
  rig.applyPose(tPose(), 1 / 60, 100);
  for (const mode of ["adaptive", "stable", "none", "classic"]) {
    const saved = snapshot(scene);
    rig.setSmoothing(mode);
    for (const before of saved) expect(before.node.quaternion.equals(before.quaternion)).toBe(true);
    rig.applyPose(tPose(), 1 / 60, 100);
  }
  rig.dispose();
  const rest = snapshot(scene);
  rig.setSmoothing("adaptive");
  rig.applyPose(tPose(), 1 / 60, 200);
  for (const before of rest) expect(before.node.quaternion.equals(before.quaternion)).toBe(true);
});

test.each(["L", "R"])("%s wrist keeps its roll through collapsed finger samples and still accepts a real palm flip", async (side) => {
  const { scene } = await loadPlayer("lmale");
  const rig = createPlayerRig(scene);
  rig.setSmoothing("none");
  const pose = tPose();
  const offset = side === "L" ? 0 : 1;
  const sign = side === "L" ? 1 : -1;
  const setSpan = (span) => {
    pose[19 + offset] = { x: sign * 1.1, y: -1.5, z: -span / 2, visibility: 1 };
    pose[17 + offset] = { x: sign * 1.1, y: -1.5, z: span / 2, visibility: 1 };
  };
  setSpan(0.08);
  rig.applyPose(pose, 1 / 60, 100);
  const original = bone(scene, `${side}_Hand`).getWorldQuaternion(new Quaternion());
  for (const [index, span] of [0.0002, -0.0002, 0].entries()) {
    setSpan(span);
    rig.applyPose(pose, 1 / 60, 133 + index * 33);
    expect(bone(scene, `${side}_Hand`).getWorldQuaternion(new Quaternion()).angleTo(original)).toBeLessThan(1e-6);
  }
  // A clear reversed palm is real motion, not the sign ambiguity of a nearly
  // straight elbow. It must be able to turn all the way over.
  setSpan(-0.08);
  rig.applyPose(pose, 1 / 60, 233);
  expect(bone(scene, `${side}_Hand`).getWorldQuaternion(new Quaternion()).angleTo(original)).toBeCloseTo(Math.PI, 6);
  rig.dispose();
});

test.each([
  ...playerAssets.filter((name) => !name.includes("bioderm")).map((name) => [name, 28]),
  ["lbioderm", 27], ["mbioderm", 27], ["hbioderm", 29],
])("%s lists the %i Bip01 nodes it drives, parents first", async (name, count) => {
  const { scene } = await loadPlayer(name);
  const { nodes } = createPlayerRig(scene);
  expect(nodes).toHaveLength(count);
  expect(new Set(nodes).size).toBe(count);
  nodes.forEach((node, index) => {
    expect(node.name.startsWith("Bip01_")).toBe(true);
    if (node.parent?.name.startsWith("Bip01_")) expect(nodes.indexOf(node.parent)).toBeLessThan(index);
  });
});

test("resync continues smoothing from rotations another writer set", async () => {
  const { scene } = await loadPlayer("lmale");
  const rig = createPlayerRig(scene);
  const rest = rig.nodes.map((node) => node.quaternion.clone());
  const pose = tPose();
  pose[13] = { x: 0.3, y: -1.2, z: 0, visibility: 1 };
  pose[15] = { x: 0.3, y: -0.9, z: 0, visibility: 1 };
  settle(rig, pose);
  const posed = rig.nodes.map((node) => node.quaternion.clone());
  const farthest = (from) => Math.max(...rig.nodes.map((node, index) => node.quaternion.angleTo(from[index])));
  expect(farthest(rest)).toBeGreaterThan(0.3);
  const replay = () => rig.nodes.forEach((node, index) => node.quaternion.copy(posed[index]));

  rig.reset();
  replay();
  rig.resync();
  rig.applyPose(pose, 1 / 60);
  expect(farthest(posed)).toBeLessThan(1e-3);

  // Without a resync, smoothing still starts from the rest pose.
  rig.reset();
  replay();
  rig.applyPose(pose, 1 / 60);
  expect(farthest(posed)).toBeGreaterThan(0.1);
});

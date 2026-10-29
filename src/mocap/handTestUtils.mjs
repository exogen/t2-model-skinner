import { Quaternion, Vector3 } from "three";

/** Synthetic anatomical hands in model world coordinates, converted back to
 * camera coordinates at the boundary. Both palms face down in the T pose. */
export function trackedHand(
  side,
  {
    curl = 0,
    pip = 0,
    dip = 0,
    thumbCurl = 0,
    thumbOpposition = 0,
    rotation = new Quaternion(),
    origin = new Vector3(),
  } = {},
) {
  const forward = new Vector3(side === "left" ? 1 : -1, 0, 0);
  const across = new Vector3(0, 0, 1);
  const palmward = new Vector3(0, -1, 0);
  const points = Array.from({ length: 21 }, () => new Vector3());
  for (const [mcp, spread, distance] of [
    [5, 0.035, 0.075],
    [9, 0, 0.085],
    [13, -0.02, 0.078],
    [17, -0.038, 0.065],
  ]) {
    points[mcp] = forward
      .clone()
      .multiplyScalar(distance)
      .addScaledVector(across, spread);
    for (const [joint, angle, length] of [
      [1, curl, 0.035],
      [2, curl + pip, 0.025],
      [3, curl + pip + dip, 0.02],
    ]) {
      points[mcp + joint] = points[mcp + joint - 1]
        .clone()
        .addScaledVector(forward, Math.cos(angle) * length)
        .addScaledVector(palmward, Math.sin(angle) * length);
    }
  }
  points[1] = forward
    .clone()
    .multiplyScalar(0.025)
    .addScaledVector(across, 0.025);
  const thumbDirection = across
    .clone()
    .multiplyScalar(Math.cos(thumbCurl) * Math.cos(thumbOpposition))
    .addScaledVector(forward, Math.cos(thumbCurl) * Math.sin(thumbOpposition))
    .addScaledVector(palmward, Math.sin(thumbCurl));
  for (let index = 2; index <= 4; index++)
    points[index] = points[index - 1]
      .clone()
      .addScaledVector(thumbDirection, 0.025);
  const worldLandmarks = points.map((point) => {
    const world = point.applyQuaternion(rotation).add(origin);
    return { x: world.x, y: -world.y, z: -world.z };
  });
  return {
    side,
    worldLandmarks,
    landmarks: worldLandmarks.map((point) => ({ ...point })),
    confidence: 1,
  };
}

export function emptyPose() {
  return Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 0,
  }));
}

/** A camera-facing T-pose with the hips 1 m above the origin. `bend` lowers
 * each elbow by that much and each wrist by twice that much. */
export function neutralBodyPose({ hands = true, bend = 0 } = {}) {
  const pose = emptyPose();
  const set = (index, x, y, z) => {
    pose[index] = { x, y: -y, z: -z, visibility: 1 };
  };
  set(0, 0, 1.75, 0.12);
  set(7, 0.1, 1.75, 0);
  set(8, -0.1, 1.75, 0);
  for (const [offset, sign] of [
    [0, 1],
    [1, -1],
  ]) {
    set(11 + offset, sign * 0.3, 1.5, 0);
    set(13 + offset, sign * 0.6, 1.5 - bend, 0);
    set(15 + offset, sign * 0.9, 1.5 - 2 * bend, 0);
    if (hands) {
      set(17 + offset, sign * 1.1, 1.5, -0.04);
      set(19 + offset, sign * 1.1, 1.5, 0.04);
    }
    set(23 + offset, sign * 0.15, 1, 0);
    set(25 + offset, sign * 0.15, 0.5, 0);
    set(27 + offset, sign * 0.15, 0.1, 0);
  }
  return pose;
}

/** Pose landmarks point Y and Z the other way from model coordinates. */
export function toModel({ x, y, z }) {
  return new Vector3(x, -y, -z);
}

export function toLandmark({ x, y, z }) {
  return { x, y: -y, z: -z, visibility: 1 };
}

/** A copy of the pose with the given landmarks rotated about a model-space pivot. */
export function rotateLandmarks(
  pose,
  indices,
  rotation,
  pivot = new Vector3(0, 1, 0),
) {
  const result = pose.map((landmark) => ({ ...landmark }));
  for (const index of indices) {
    result[index] = toLandmark(
      toModel(pose[index]).sub(pivot).applyQuaternion(rotation).add(pivot),
    );
  }
  return result;
}

export function settle(rig, pose) {
  for (let i = 0; i < 120; i++) rig.applyPose(pose, 1 / 60);
}

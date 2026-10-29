import {
  Matrix4,
  Quaternion,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
} from "three";
import type { PoseLandmark, TrackedHand } from "./poseTracking";
import { isConfident, isInImage, MIN_CONFIDENCE } from "./landmarks";

// Pose retargeting geometry. Skeleton names, bind-pose calibration, and applying
// these rotations live in rig.ts; this file works only with points and frames.
// Sections: landmarks and tuning, reference frames, hands, arm IK, camera targets.

// The low-poly hand has one shared finger hinge and a separate thumb swing.
// Limits are degrees. PIP/DIP flexion contributes less than the MCP knuckle
// because the mesh cannot bend those three joints independently.
const handArticulation = {
  maxFingerCurlDegrees: 99,
  maxThumbSwingDegrees: 120,
  pipCurlWeight: 0.45,
  dipCurlWeight: 0.25,
};
const MAX_FINGER_CURL = Math.PI * (handArticulation.maxFingerCurlDegrees / 180);
const MAX_THUMB_SWING = (Math.PI * handArticulation.maxThumbSwingDegrees) / 180;

// MediaPipe landmark indices. Left/right refer to the tracked person's anatomy.

export const poseIndices = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftPinky: 17,
  rightPinky: 18,
  leftIndex: 19,
  rightIndex: 20,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

// MCP = finger-base knuckle; PIP/DIP are the next two knuckles toward the tip.
const handIndices = {
  wrist: 0,
  thumbBase: 1,
  thumbTip: 4,
  indexMCP: 5,
  middleMCP: 9,
  ringMCP: 13,
  pinkyMCP: 17,
} as const;
const fingerMCPs = [
  handIndices.indexMCP,
  handIndices.middleMCP,
  handIndices.ringMCP,
  handIndices.pinkyMCP,
];

const EPSILON = 1e-10;

const finite = (point: { x: number; y: number; z: number }) =>
  [point.x, point.y, point.z].every(Number.isFinite);
/** Finite, and long enough to normalize. */
const usable = (vector: Vector3) =>
  finite(vector) &&
  Number.isFinite(vector.lengthSq()) &&
  vector.lengthSq() >= EPSILON;

export function midpoint(a: Vector3, b: Vector3) {
  return a.clone().add(b).multiplyScalar(0.5);
}

// Coordinate conversion and reference frames

/** MediaPipe's camera coordinates become model +Y up, +Z toward the viewer.
 * Left/right indices stay intact here; the live preview mirrors its pose
 * before handing it to this anatomical solver. */
export function readPosePoint(
  landmarks: readonly PoseLandmark[],
  index: number,
): Vector3 | null {
  const point = landmarks[index];
  if (!isConfident(point) || !Number.isFinite(point.z)) return null;
  return new Vector3(point.x, -point.y, -point.z);
}

function frame(x: Vector3, y: Vector3, z: Vector3): Quaternion {
  return new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(x, y, z),
  );
}

/** A body frame: X points to the person's left, Y up, Z forward. */
export function bodyFrame(left: Vector3, up: Vector3): Quaternion | null {
  if (left.lengthSq() < EPSILON || up.lengthSq() < EPSILON) return null;
  const x = left.clone().normalize();
  const z = x.clone().cross(up);
  if (z.lengthSq() < EPSILON) return null;
  z.normalize();
  const y = z.clone().cross(x).normalize();
  return frame(x, y, z);
}

/** A segment frame: X follows its length and Z is its bend-plane normal. */
export function segmentFrame(
  direction: Vector3,
  normal: Vector3,
): Quaternion | null {
  if (direction.lengthSq() < EPSILON || normal.lengthSq() < EPSILON)
    return null;
  const x = direction.clone().normalize();
  const y = normal.clone().cross(x);
  if (y.lengthSq() < EPSILON) return null;
  y.normalize();
  const z = x.clone().cross(y).normalize();
  return frame(x, y, z);
}

export interface HandFrame {
  rotation: Quaternion;
  normal: Vector3;
}

/** A rigid palm frame from Pose Landmarker's coarse hand points. Tiny finger
 * separation or nearly collinear points cannot reliably measure palm roll;
 * keep a caller-provided roll while still following the hand's direction. */
export function handFrame(
  wrist: Vector3,
  index: Vector3,
  pinky: Vector3,
  isLeft: boolean,
  fallbackNormal?: Vector3,
): HandFrame | null {
  if (![wrist, index, pinky].every(finite)) return null;
  const direction = midpoint(index, pinky).sub(wrist);
  return palmFrame(direction, index.clone().sub(pinky), isLeft, fallbackNormal);
}

/** Palm orientation from a wrist-to-knuckle direction and an index-to-pinky
 * span. Detailed hand tracking uses MCP knuckles, which stay fixed when the
 * fingers curl; the coarse pose fallback can share the same roll handling. */
function palmFrame(
  direction: Vector3,
  span: Vector3,
  isLeft: boolean,
  fallbackNormal?: Vector3,
): HandFrame | null {
  if (![direction, span].every(finite)) return null;
  const lengthSq = direction.lengthSq();
  const spanSq = span.lengthSq();
  if (
    !Number.isFinite(lengthSq) ||
    !Number.isFinite(spanSq) ||
    lengthSq < EPSILON
  )
    return null;
  const measured = direction.clone().cross(span);
  const measuredSq = measured.lengthSq();
  if (!Number.isFinite(measuredSq)) return null;
  // These dimensionless checks work at any body scale. Require a finger span
  // at least 10% of hand length and a triangle sine of at least 0.15.
  const reliable =
    spanSq >= lengthSq * 0.1 ** 2 &&
    measuredSq >= lengthSq * spanSq * 0.15 ** 2;
  let normal: Vector3;
  if (reliable) {
    normal = measured.normalize();
    if (!isLeft) normal.negate();
    // Palm facing has a real sign: unlike a limb's bend plane, its normal
    // must be allowed to reverse when the person rolls their wrist.
  } else {
    if (!fallbackNormal || !usable(fallbackNormal)) return null;
    normal = fallbackNormal.clone().normalize();
  }

  const forward = direction.clone().normalize();
  normal.addScaledVector(forward, -normal.dot(forward));
  if (normal.lengthSq() < EPSILON) return null;
  normal.normalize();
  const rotation = segmentFrame(forward, normal);
  return rotation ? { rotation, normal } : null;
}

/** A head/foot frame with an explicit forward and up direction. */
export function facingFrame(forward: Vector3, up: Vector3): Quaternion | null {
  if (forward.lengthSq() < EPSILON || up.lengthSq() < EPSILON) return null;
  const z = forward.clone().normalize();
  const x = up.clone().cross(z);
  if (x.lengthSq() < EPSILON) return null;
  x.normalize();
  const y = z.clone().cross(x).normalize();
  return frame(x, y, z);
}

/** Ears observe the head's lateral axis. Preserve that span instead of
 * tilting it to fit a noisy or anatomically off-center nose-to-ear vector.
 * The nose determines which way the face points around the ear axis. */
export function headFrame(
  leftEar: Vector3,
  rightEar: Vector3,
  nose: Vector3,
): Quaternion | null {
  if (![leftEar, rightEar, nose].every(finite)) return null;
  const left = leftEar.clone().sub(rightEar);
  const forward = nose.clone().sub(midpoint(leftEar, rightEar));
  const leftSq = left.lengthSq();
  const forwardSq = forward.lengthSq();
  const up = forward.clone().cross(left);
  const upSq = up.lengthSq();
  if (
    ![leftSq, forwardSq, upSq].every(Number.isFinite) ||
    leftSq < EPSILON ||
    forwardSq < EPSILON ||
    forwardSq < leftSq * 0.05 ** 2 ||
    upSq < leftSq * forwardSq * 0.15 ** 2
  )
    return null;
  return bodyFrame(left.normalize(), up.normalize());
}

interface FootFrame {
  rotation: Quaternion;
  up: Vector3;
}

/** Heel/toe determine forward, while ankle height determines sole roll.
 * A nearly flat triangle cannot measure roll reliably: retain the caller's
 * transported prior up instead of flipping the boot on landmark noise. */
export function footFrame(
  ankle: Vector3,
  heel: Vector3,
  toe: Vector3,
  fallbackUp?: Vector3,
): FootFrame | null {
  if (![ankle, heel, toe].every(finite)) return null;

  const forward = toe.clone().sub(heel);
  const lengthSq = forward.lengthSq();
  if (!Number.isFinite(lengthSq) || lengthSq < EPSILON) return null;
  forward.normalize();
  const measuredUp = ankle.clone().sub(midpoint(heel, toe));
  const upLengthSq = measuredUp.lengthSq();
  if (!Number.isFinite(upLengthSq)) return null;
  measuredUp.addScaledVector(forward, -measuredUp.dot(forward));
  const heightSq = measuredUp.lengthSq();
  // Relative height also rejects a tiny but perpendicular ankle offset.
  // Triangle angle rejects an ankle lying nearly along the heel/toe axis.
  const reliable =
    heightSq >= lengthSq * 0.1 ** 2 && heightSq >= upLengthSq * 0.15 ** 2;
  let up: Vector3;
  if (reliable) {
    // Sole facing has a real sign; a clearly measured upside-down foot must
    // remain upside down even if the previous frame faced the other way.
    up = measuredUp.normalize();
  } else {
    if (!fallbackUp || !usable(fallbackUp)) return null;
    up = fallbackUp.clone().normalize();
    up.addScaledVector(forward, -up.dot(forward));
    if (up.lengthSq() < EPSILON) return null;
    up.normalize();
  }

  const rotation = facingFrame(forward, up);
  return rotation ? { rotation, up } : null;
}

interface LimbFrames {
  upper: Quaternion;
  lower: Quaternion;
  normal: Vector3;
}

/** Three points determine bend and direction, but a straight limb has no
 * measurable twist. Keep the previous bend-plane normal there instead of
 * amplifying noise. */
export function limbFrames(
  start: Vector3,
  middle: Vector3,
  end: Vector3,
  fallbackNormal: Vector3,
): LimbFrames | null {
  const upper = middle.clone().sub(start);
  const lower = end.clone().sub(middle);
  if (upper.lengthSq() < EPSILON || lower.lengthSq() < EPSILON) return null;
  upper.normalize();
  lower.normalize();
  const measuredNormal = upper.clone().cross(lower);
  const bend = measuredNormal.length();
  let normal = fallbackNormal.clone();
  if (bend > 0.04) {
    measuredNormal.divideScalar(bend);
    // A plane has two equivalent normal directions. Preserve its hemisphere
    // across extension/rebending instead of interpolating opposing vectors
    // through zero and suddenly rolling the entire arm or leg by 180°.
    if (measuredNormal.dot(normal) < 0) measuredNormal.negate();
    // Blend only while the bend plane is weak; strong bends use its measured
    // axis. The caller rotates the previous normal with the torso as it turns.
    const weight = Math.min(1, (bend - 0.04) / 0.14);
    normal.lerp(measuredNormal, weight);
  }
  if (normal.lengthSq() < EPSILON) normal.copy(fallbackNormal);
  normal.normalize();
  let upperFrame = segmentFrame(upper, normal);
  let lowerFrame = segmentFrame(lower, normal);
  if (!upperFrame || !lowerFrame) {
    // The normal can line up with the limb as it turns toward the camera.
    const alternate =
      Math.abs(upper.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
    normal = upper.clone().cross(alternate).normalize();
    if (normal.dot(fallbackNormal) < 0) normal.negate();
    upperFrame = segmentFrame(upper, normal);
    lowerFrame = segmentFrame(lower, normal);
  }
  return upperFrame && lowerFrame
    ? { upper: upperFrame, lower: lowerFrame, normal }
    : null;
}

// Detailed hand orientation and finger articulation

const HAND_AXES = new Quaternion().setFromAxisAngle(
  new Vector3(0, 0, 1),
  Math.PI,
);

export interface DetailedHandPose {
  palm: HandFrame;
  /** One mitt hinge approximates the four fingers' combined flexion. */
  fingersCurl: number | null;
  /** CMC-to-tip direction in the player's hand axes: -X distal, +Z palmward. */
  thumbDirection: Vector3 | null;
}

function median(values: number[]) {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
}

function angleDifference(a: number, b: number) {
  const difference = a - b;
  return Math.atan2(Math.sin(difference), Math.cos(difference));
}

/** Hand Landmarker world points have their own origin. Only directions within
 * one hand are used here; its wrist position must never replace the body wrist. */
export function detailedHandPose(
  hand: TrackedHand,
  fallbackNormal?: Vector3,
): DetailedHandPose | null {
  if (!Number.isFinite(hand.confidence) || hand.confidence < MIN_CONFIDENCE)
    return null;
  const point = (index: number) => {
    const point = hand.worldLandmarks[index];
    // Hand Landmarker emits visibility=0 as an unset/default field, not a
    // measured joint confidence. Its whole-hand association is gated above.
    return point && finite(point)
      ? new Vector3(point.x, -point.y, -point.z)
      : null;
  };
  const wrist = point(handIndices.wrist);
  const index = point(handIndices.indexMCP);
  const middle = point(handIndices.middleMCP);
  const pinky = point(handIndices.pinkyMCP);
  if (!wrist || !index || !middle || !pinky) return null;
  const forward = middle.clone().sub(wrist);
  const palm = palmFrame(
    forward,
    index.clone().sub(pinky),
    hand.side === "left",
    fallbackNormal,
  );
  if (!palm) return null;
  forward.normalize();

  const curls: number[] = [];
  for (const mcp of fingerMCPs) {
    const chain = [mcp, mcp + 1, mcp + 2, mcp + 3].map(point);
    if (chain.some((joint) => !joint)) continue;
    const angles: number[] = [];
    for (let index = 1; index < chain.length; index++) {
      const direction = chain[index]!.clone().sub(chain[index - 1]!);
      const distal = direction.dot(forward);
      const palmward = direction.dot(palm.normal);
      // Ignore degenerate segments and pure sideways spread, neither of
      // which provides an observable flexion angle.
      const lengthSq = distal * distal + palmward * palmward;
      if (!Number.isFinite(lengthSq) || lengthSq < EPSILON) break;
      angles.push(Math.atan2(palmward, distal));
    }
    if (angles.length !== 3) continue;
    const proximal = Math.max(0, angles[0]);
    const pip = Math.max(0, angleDifference(angles[1], angles[0]));
    const dip = Math.max(0, angleDifference(angles[2], angles[1]));
    // The low-poly mitt has one bend, not three independently skinned
    // knuckles. Distal flexion contributes less to that shared hinge.
    curls.push(
      Math.min(
        MAX_FINGER_CURL,
        proximal +
          handArticulation.pipCurlWeight * pip +
          handArticulation.dipCurlWeight * dip,
      ),
    );
  }

  const thumbBase = point(handIndices.thumbBase);
  const thumbTip = point(handIndices.thumbTip);
  let thumbDirection: Vector3 | null = null;
  if (thumbBase && thumbTip) {
    const direction = thumbTip.sub(thumbBase);
    const lengthSq = direction.lengthSq();
    if (Number.isFinite(lengthSq) && lengthSq >= EPSILON) {
      // The measured frame's +X points distally; player hands use -X.
      const inverseHand = palm.rotation.clone().multiply(HAND_AXES).invert();
      thumbDirection = direction.normalize().applyQuaternion(inverseHand);
    }
  }
  return {
    palm,
    fingersCurl: curls.length >= 2 ? median(curls) : null,
    thumbDirection,
  };
}

/** Swing the authored thumb's measured rest direction toward the camera's
 * thumb direction, without inventing an unobservable twist around that axis. */
export function thumbRotation(
  restDirection: Vector3,
  direction: Vector3,
): Quaternion | null {
  if (![restDirection, direction].every(usable)) return null;
  const rotation = new Quaternion().setFromUnitVectors(
    restDirection.clone().normalize(),
    direction.clone().normalize(),
  );
  const angle = 2 * Math.acos(Math.min(1, Math.abs(rotation.w)));
  if (angle > MAX_THUMB_SWING)
    rotation.slerp(new Quaternion(), 1 - MAX_THUMB_SWING / angle);
  return rotation;
}

// Two-bone inverse kinematics for a hand observed without its arm

interface ArmIKOptions {
  shoulder: Vector3;
  target: Vector3;
  upperLength: number;
  lowerLength: number;
  /** Preferred elbow direction in root space, relative to the shoulder.
   * Reuse the returned direction to retain the bend side through extension. */
  bendDirection: Vector3;
  /** Optional absolute root-space elbow position from the preceding sample. */
  previousElbow?: Vector3 | null;
}

interface ArmIKResult {
  elbow: Vector3;
  /** The reachable wrist position; targets beyond either reach limit clamp. */
  wrist: Vector3;
  /** Unit direction perpendicular to the shoulder-to-wrist axis. */
  bendDirection: Vector3;
}

const magnitude = (point: Vector3) => Math.hypot(point.x, point.y, point.z);

function projected(point: Vector3, axis: Vector3) {
  return point.clone().addScaledVector(axis, -point.dot(axis));
}

/** Choose a perpendicular direction without a left/right-specific world axis,
 * so reflected inputs also produce reflected elbows at degenerate targets. */
function perpendicular(axis: Vector3) {
  const fallback =
    Math.abs(axis.y) <= Math.abs(axis.z)
      ? new Vector3(0, -1, 0)
      : new Vector3(0, 0, 1);
  const result = projected(fallback, axis);
  return result.divideScalar(magnitude(result));
}

function chooseBend(options: ArmIKOptions, axis: Vector3) {
  const preferred = projected(options.bendDirection, axis);
  const preferredLength = magnitude(preferred);
  const originalLength = magnitude(options.bendDirection);
  const hasPreference =
    originalLength > 0 && preferredLength > originalLength * 1e-6;
  if (hasPreference) preferred.divideScalar(preferredLength);

  const history = options.previousElbow
    ? projected(options.previousElbow.clone().sub(options.shoulder), axis)
    : null;
  const historyLength = history ? magnitude(history) : 0;
  if (!hasPreference) {
    return history && historyLength > options.upperLength * 0.02
      ? history.divideScalar(historyLength)
      : perpendicular(axis);
  }
  if (!history || historyLength <= options.upperLength * 0.02) return preferred;
  history.divideScalar(historyLength);
  // A nearly straight arm's projected elbow can cross the target ray on
  // small camera noise. Its history may steer the plane, not reverse the
  // caller's retained bend side. Reliable tracking can supply a fresh side.
  if (history.dot(preferred) < 0) history.negate();
  const t = Math.min(1, (historyLength / options.upperLength - 0.02) / 0.13);
  preferred.lerp(history, t * t * (3 - 2 * t));
  return preferred.divideScalar(magnitude(preferred));
}

/** Exact two-bone geometry for a missing arm, independent of camera/detector
 * coordinates. Lengths never stretch and inputs are never mutated. A reliable
 * tracked elbow should bypass this fallback; it can seed bendDirection when
 * tracking is lost. The hand task's centered world points are not a target. */
export function solveArmIK(options: ArmIKOptions): ArmIKResult | null {
  const {
    shoulder,
    target,
    upperLength,
    lowerLength,
    bendDirection,
    previousElbow,
  } = options;
  if (
    ![
      shoulder,
      target,
      bendDirection,
      ...(previousElbow ? [previousElbow] : []),
    ].every(finite) ||
    ![upperLength, lowerLength].every(
      (length) => Number.isFinite(length) && length > 0,
    )
  )
    return null;
  const maximum = upperLength + lowerLength;
  if (!Number.isFinite(maximum)) return null;
  const minimum = Math.abs(upperLength - lowerLength);
  const axis = target.clone().sub(shoulder);
  const distance = magnitude(axis);
  if (!Number.isFinite(distance)) return null;
  if (distance > 0) {
    axis.divideScalar(distance);
  } else {
    // At the shoulder there is no target direction. Preserve an observable
    // previous elbow, or the caller's natural bend, instead of normalizing 0.
    const hint = previousElbow?.clone().sub(shoulder) ?? bendDirection.clone();
    const hintLength = magnitude(hint);
    if (!Number.isFinite(hintLength)) return null;
    if (hintLength > 0) hint.divideScalar(hintLength);
    else hint.set(0, -1, 0);
    if (minimum === 0) {
      const elbow = shoulder.clone().addScaledVector(hint, upperLength);
      return finite(elbow)
        ? { elbow, wrist: shoulder.clone(), bendDirection: hint }
        : null;
    }
    axis.copy(hint).multiplyScalar(upperLength > lowerLength ? 1 : -1);
  }
  const reach = Math.max(minimum, Math.min(maximum, distance));
  const bend = chooseBend(options, axis);
  // Normalize the triangle before squaring its sides, avoiding overflow and
  // preserving the same result for centimeter-scale and larger model rigs.
  const scale = Math.max(upperLength, lowerLength);
  const a = upperLength / scale;
  const b = lowerLength / scale;
  const d = reach / scale;
  const along =
    reach === maximum
      ? a
      : reach === minimum
        ? upperLength > lowerLength
          ? a
          : -a
        : Math.max(-a, Math.min(a, (((a - b) * (a + b)) / d + d) / 2));
  const height = Math.sqrt(Math.max(0, (a - along) * (a + along)));
  const elbow = shoulder
    .clone()
    .addScaledVector(axis, along * scale)
    .addScaledVector(bend, height * scale);
  const wrist = shoulder.clone().addScaledVector(axis, reach);
  return [elbow, wrist, bend].every(finite)
    ? { elbow, wrist, bendDirection: bend }
    : null;
}

// Image-space wrist target at the model's retained depth

/** Unproject an already mirrored hand-image wrist onto the held model depth.
 * The caller captures/retains depthReference in root space when fallback starts;
 * repeatedly using a clamped IK wrist would feed its reach limit back as depth.
 * Hand Landmarker has no per-point visibility/presence, so only XYZ is checked. */
export function handImageTarget(
  root: Object3D,
  camera: PerspectiveCamera,
  imageAspect: number,
  wrist: PoseLandmark,
  depthReference: Vector3,
): Vector3 | null {
  if (
    ![wrist, depthReference].every(finite) ||
    !isInImage(wrist) ||
    ![imageAspect, camera.aspect, camera.near, camera.far].every(
      Number.isFinite,
    ) ||
    imageAspect <= 0 ||
    camera.aspect <= 0 ||
    camera.near <= 0 ||
    camera.far <= camera.near
  )
    return null;

  root.updateWorldMatrix(true, false);
  camera.updateWorldMatrix(true, false);
  const reference = root
    .localToWorld(depthReference.clone())
    .applyMatrix4(camera.matrixWorldInverse);
  const depth = -reference.z;
  if (!Number.isFinite(depth) || depth <= camera.near || depth >= camera.far)
    return null;
  // Preserve the actual render projection, including automatic clip-space
  // zoom/shift. Calling updateProjectionMatrix here would erase that framing.
  const projected = reference.applyMatrix4(camera.projectionMatrix);
  if (!Number.isFinite(projected.z) || projected.z < -1 || projected.z > 1)
    return null;
  const width = Math.min(1, imageAspect / camera.aspect);
  const height = Math.min(1, camera.aspect / imageAspect);
  const target = new Vector3(
    (wrist.x * 2 - 1) * width,
    (1 - wrist.y * 2) * height,
    projected.z,
  ).unproject(camera);
  root.worldToLocal(target);
  return target.toArray().every(Number.isFinite) ? target : null;
}

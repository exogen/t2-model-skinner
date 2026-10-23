import { Object3D, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { MAX_POSE_AGE_MS, type PoseLandmark, type TrackedHand } from "./poseTracking";
import { isInImage } from "./landmarks";
import { createRotationSmoother, poseSmoothingAlpha, type RotationSmoother, type RotationSmoothingMode } from "./rotationSmoothing";
import {
  bodyFrame,
  detailedHandPose,
  thumbRotation,
  solveArmIK,
  handImageTarget,
  type DetailedHandPose,
  facingFrame,
  footFrame,
  handFrame,
  headFrame,
  limbFrames,
  midpoint,
  poseIndices,
  readPosePoint,
  segmentFrame,
  type HandFrame,
} from "./retarget";

// Rig definition — all eight player models use the same Bip01 skeleton.
// Names below omit the prefix. Rest transforms and bone lengths come from the
// loaded GLB; there are no per-model rotation corrections to maintain here.
// Mesh weights and added finger/thumb joints are authored by
// scripts/buildPlayerRigs.mjs. Pose geometry and hand limits live in retarget.ts.
const skeleton = {
  prefix: "Bip01_",
  pelvis: "Pelvis",
  lowerSpine: "Spine1",
  upperSpine: "Spine2", // Optional: humans have it, Bioderms do not.
  head: "Head",
  // These bones inherit their parents' motion rather than receiving targets.
  // Spine also parents the thighs; Neck also parents both clavicles.
  inherited: ["Spine", "Neck", "L_Clavicle", "R_Clavicle"],
} as const;

// Each chain is ordered proximal → distal: shoulder/elbow/wrist or hip/knee/ankle.
// Left/right always means the character's anatomical side. Mirroring happens
// before the pose reaches this rig, never by changing bone names or mesh scale.
const limbDefinitions = {
  leftArm: {
    side: "left", kind: "arm",
    bones: ["L_UpperArm", "L_Forearm", "L_Hand"],
    landmarks: [poseIndices.leftShoulder, poseIndices.leftElbow, poseIndices.leftWrist],
    fingers: ["L_Fingers", "L_FingersTip"], thumb: ["L_Thumb", "L_ThumbTip"],
  },
  leftLeg: {
    side: "left", kind: "leg",
    bones: ["L_Thigh", "L_Calf", "L_Foot"],
    landmarks: [poseIndices.leftHip, poseIndices.leftKnee, poseIndices.leftAnkle],
  },
  rightArm: {
    side: "right", kind: "arm",
    bones: ["R_UpperArm", "R_Forearm", "R_Hand"],
    landmarks: [poseIndices.rightShoulder, poseIndices.rightElbow, poseIndices.rightWrist],
    fingers: ["R_Fingers", "R_FingersTip"], thumb: ["R_Thumb", "R_ThumbTip"],
  },
  rightLeg: {
    side: "right", kind: "leg",
    bones: ["R_Thigh", "R_Calf", "R_Foot"],
    landmarks: [poseIndices.rightHip, poseIndices.rightKnee, poseIndices.rightAnkle],
  },
} as const;

// Bone-local axes in the exported rigs (not world axes). A bend normal is
// perpendicular to the elbow/knee's bend plane, not an IK pole's position.
const boneAxes = {
  limbBendNormal: new Vector3(0, -1, 0),
  headForward: new Vector3(0, 0, 1),
  headUp: new Vector3(-1, 0, 0),
  handDistal: new Vector3(-1, 0, 0),
  palmNormal: new Vector3(0, 0, 1),
  fingerCurl: new Vector3(0, 1, 0),
  footForward: new Vector3(0, 0, 1),
  footUp: new Vector3(1, 0, 0),
};
const ROOT_UP = new Vector3(0, 1, 0);

// When only a hand is visible, IK places the elbow down and slightly outward.
// These directions are in model-root space; actual bone lengths never stretch.
const elbowRestDirections = {
  left: new Vector3(0.35, -1, -0.2),
  right: new Vector3(-0.35, -1, -0.2),
};
const SPINE_BEND_SHARE = 0.5; // Lower spine's share when Spine2 is present.

export interface PlayerRig {
  applyPose(landmarks: readonly PoseLandmark[], deltaSeconds: number, timestamp?: number, hands?: readonly TrackedHand[]): void;
  /** Complete hand-led arms after the final framing camera is available. */
  applyHandFallback(camera: PerspectiveCamera, imageAspect: number, deltaSeconds: number): void;
  setSmoothing(mode: RotationSmoothingMode): void;
  /** Every Bip01 node the rig binds, parents first. Live posing changes only
   * their rotations. */
  readonly nodes: readonly Object3D[];
  /** Continue smoothing from the bones' current rotations after something
   * else posed them, like recording playback. */
  resync(): void;
  reset(): void;
  dispose(): void;
}

interface BoneBinding {
  node: Object3D;
  restPosition: Vector3;
  restRotation: Quaternion;
  restScale: Vector3;
  /** Rest rotation in model-root space, excluding the viewer transform. */
  restRootRotation: Quaternion;
  /** Anatomical frame → authored bone frame, calibrated from the rest pose. */
  retargetOffset?: Quaternion;
}

interface Limb {
  upper: BoneBinding;
  lower: BoneBinding;
  end: BoneBinding;
  indices: readonly [number, number, number];
  restBendNormal: Vector3;
  previousBendNormal: Vector3 | null;
  /** The palm normal (arms) or sole up (legs) in forearm/calf space. */
  restRoll: Vector3;
  previousRoll: Vector3 | null;
  isArm: boolean;
  isLeft: boolean;
  fingers?: BoneBinding;
  restFingerCurl?: number;
  thumb?: BoneBinding;
  restThumbDirection?: Vector3;
  upperLength: number;
  lowerLength: number;
  fallbackHand: TrackedHand | null;
  fallbackDepth: Vector3 | null;
  fallbackElbow: Vector3 | null;
  fallbackBend: Vector3 | null;
  trackedArm: boolean;
}

/** Bind immediately after GLTF load, before an animation mixer changes the
 * exported pose. T2's rigid skins share named transform ancestors, many of
 * which are Object3Ds rather than members of a SkinnedMesh's bone array. */
export function createPlayerRig(root: Object3D): PlayerRig | null {
  // Rest pose: capture the exported local transforms before any animation.
  const names = new Map<string, Object3D>();
  root.traverse((node) => names.set(node.name, node));
  const required = [
    skeleton.pelvis, skeleton.lowerSpine, skeleton.head, ...skeleton.inherited,
    ...Object.values(limbDefinitions).flatMap((limb) => limb.bones),
  ];
  if (required.some((name) => !names.has(`${skeleton.prefix}${name}`))) return null;

  root.updateWorldMatrix(true, true);
  const inverseRootRotation = root.getWorldQuaternion(new Quaternion()).invert();
  const bindings = new Map<string, BoneBinding>();
  for (const [name, node] of Array.from(names)) {
    if (!name.startsWith(skeleton.prefix)) continue;
    bindings.set(name.slice(skeleton.prefix.length), {
      node,
      restPosition: node.position.clone(),
      restRotation: node.quaternion.clone(),
      restScale: node.scale.clone(),
      restRootRotation: node.getWorldQuaternion(new Quaternion()).premultiply(inverseRootRotation),
    });
  }
  const bone = (name: string) => bindings.get(name)!;
  const rootPosition = (binding: BoneBinding) => root.worldToLocal(binding.node.getWorldPosition(new Vector3()));
  const hipLeft = rootPosition(bone(limbDefinitions.leftLeg.bones[0]));
  const hipRight = rootPosition(bone(limbDefinitions.rightLeg.bones[0]));
  const shoulderLeft = rootPosition(bone(limbDefinitions.leftArm.bones[0]));
  const shoulderRight = rootPosition(bone(limbDefinitions.rightArm.bones[0]));
  const trunkUp = midpoint(shoulderLeft, shoulderRight).sub(midpoint(hipLeft, hipRight));
  const restHips = bodyFrame(hipLeft.clone().sub(hipRight), trunkUp);
  const restChest = bodyFrame(shoulderLeft.clone().sub(shoulderRight), trunkUp);
  if (!restHips || !restChest) return null;

  // Calibration: map anatomical orientations onto each bone's authored axes.
  const bindFrame = (binding: BoneBinding, reference: Quaternion | null) => {
    if (reference) binding.retargetOffset = reference.clone().invert().multiply(binding.restRootRotation);
  };
  bindFrame(bone(skeleton.pelvis), restHips);
  const upperSpine = bindings.get(skeleton.upperSpine);
  // Thighs attach to Spine, so all torso bending starts above that node.
  bindFrame(bone(skeleton.lowerSpine), restHips.clone().slerp(restChest, upperSpine ? SPINE_BEND_SHARE : 1));
  if (upperSpine) bindFrame(upperSpine, restChest);

  const head = bone(skeleton.head);
  // Head +Z faces forward and -X points up in every player rig. The Eye
  // attachment is a camera position above the bone pivot, not a gaze vector;
  // using its position would pitch human helmets downward by roughly 45°.
  bindFrame(head, facingFrame(
    boneAxes.headForward.clone().applyQuaternion(head.restRootRotation),
    boneAxes.headUp.clone().applyQuaternion(head.restRootRotation),
  ));

  // Fingers/thumbs are optional so original, unarticulated GLBs still work.
  const restTip = ([name, tipName]: readonly [string, string]) => {
    const binding = bindings.get(name);
    const tip = bindings.get(tipName);
    if (!binding || tip?.node.parent !== binding.node) return null;
    const direction = tip.restPosition.clone().applyQuaternion(binding.restRotation);
    return direction.lengthSq() > 1e-10 ? { binding, direction } : null;
  };

  const limbs: Limb[] = [];
  for (const definition of Object.values(limbDefinitions)) {
    const isArm = definition.kind === "arm";
    const isLeft = definition.side === "left";
    const [upper, lower, end] = definition.bones.map(bone);
    const restBendNormal = boneAxes.limbBendNormal.clone().applyQuaternion(upper.restRootRotation);
    bindFrame(upper, segmentFrame(rootPosition(lower).sub(rootPosition(upper)), restBendNormal));
    bindFrame(lower, segmentFrame(rootPosition(end).sub(rootPosition(lower)), restBendNormal));
    if (isArm) {
      // Added mitt children preserve the authored wrist axes and stock grip.
      bindFrame(end, segmentFrame(
        boneAxes.handDistal.clone().applyQuaternion(end.restRootRotation),
        boneAxes.palmNormal.clone().applyQuaternion(end.restRootRotation),
      ));
    } else {
      bindFrame(end, facingFrame(
        boneAxes.footForward.clone().applyQuaternion(end.restRootRotation),
        boneAxes.footUp.clone().applyQuaternion(end.restRootRotation),
      ));
    }
    // Retain palm/sole orientation relative to the forearm/calf, so it can
    // follow that bone when the detector cannot observe wrist/ankle roll.
    const restRoll = (isArm ? boneAxes.palmNormal : boneAxes.footUp).clone()
      .applyQuaternion(end.restRootRotation).applyQuaternion(lower.restRootRotation.clone().invert());
    const limb: Limb = {
      upper, lower, end, indices: definition.landmarks, isArm, isLeft,
      restBendNormal, previousBendNormal: null, restRoll, previousRoll: null,
      upperLength: rootPosition(upper).distanceTo(rootPosition(lower)),
      lowerLength: rootPosition(lower).distanceTo(rootPosition(end)),
      fallbackHand: null, fallbackDepth: null, fallbackElbow: null, fallbackBend: null, trackedArm: false,
    };
    if (definition.kind === "arm") {
      const fingers = restTip(definition.fingers);
      if (fingers) {
        limb.fingers = fingers.binding;
        limb.restFingerCurl = Math.atan2(fingers.direction.z, -fingers.direction.x);
      }
      const thumb = restTip(definition.thumb);
      if (thumb) {
        limb.thumb = thumb.binding;
        limb.restThumbDirection = thumb.direction.normalize();
      }
    }
    limbs.push(limb);
  }

  // Evaluation order and temporal state. Parents must be applied first.
  const depth = (node: Object3D) => {
    let count = 0;
    for (let parent = node.parent; parent && parent !== root; parent = parent.parent) count++;
    return count;
  };
  const ordered = Array.from(bindings.values()).sort((a, b) => depth(a.node) - depth(b.node));
  const bindingByNode = new Map(ordered.map((binding) => [binding.node as Object3D, binding]));
  const parentBinding = (binding: BoneBinding) =>
    binding.node.parent ? bindingByNode.get(binding.node.parent) : undefined;
  let disposed = false;
  let previousChest: Quaternion | null = null;
  let previousHips: Quaternion | null = null;
  let smoothing: RotationSmoothingMode = "classic";
  let lastTimestamp: number | undefined;
  let targets = new Map<BoneBinding, Quaternion>();
  const deferred = new Set<BoneBinding>();
  const smoothers = new Map<BoneBinding, RotationSmoother>();
  const smoothsWorld = () => smoothing === "adaptive" || smoothing === "stable";

  const resetSmoothers = () => {
    root.updateWorldMatrix(true, true);
    const inverseRoot = root.getWorldQuaternion(new Quaternion()).invert();
    for (const binding of ordered) {
      const filter = createRotationSmoother(smoothing);
      filter.reset(smoothsWorld()
        ? binding.node.getWorldQuaternion(new Quaternion()).premultiply(inverseRoot)
        : binding.node.quaternion);
      smoothers.set(binding, filter);
    }
  };

  const forgetLimb = (limb: Limb, retainHandDepth = false) => {
    limb.previousBendNormal = null;
    limb.previousRoll = null;
    limb.fallbackHand = null;
    if (!retainHandDepth) {
      limb.fallbackDepth = limb.fallbackElbow = limb.fallbackBend = null;
      limb.trackedArm = false;
    }
  };

  const clearTargets = (retainHandDepth = false) => {
    targets.clear();
    deferred.clear();
    lastTimestamp = undefined;
    for (const limb of limbs) forgetLimb(limb, retainHandDepth);
    previousChest = previousHips = null;
  };

  const reset = () => {
    for (const binding of ordered) {
      binding.node.position.copy(binding.restPosition);
      binding.node.quaternion.copy(binding.restRotation);
      binding.node.scale.copy(binding.restScale);
      binding.node.updateMatrix();
    }
    clearTargets();
    root.updateWorldMatrix(true, true);
    resetSmoothers();
  };

  const handTargets = (
    limb: Limb, hand: HandFrame, detailed: DetailedHandPose | null,
    forearmRotation: Quaternion, output: Map<BoneBinding, Quaternion>,
  ) => {
    const wristRotation = hand.rotation.clone().multiply(limb.end.retargetOffset!);
    output.set(limb.end, wristRotation);
    limb.previousRoll = hand.normal.clone().applyQuaternion(forearmRotation.clone().invert());
    if (limb.fingers && detailed?.fingersCurl != null) {
      const flex = new Quaternion().setFromAxisAngle(boneAxes.fingerCurl, detailed.fingersCurl - limb.restFingerCurl!);
      output.set(limb.fingers, wristRotation.clone().multiply(flex).multiply(limb.fingers.restRotation));
    }
    if (limb.thumb && detailed?.thumbDirection) {
      const flex = thumbRotation(limb.restThumbDirection!, detailed.thumbDirection);
      if (flex) output.set(limb.thumb, wristRotation.clone().multiply(flex).multiply(limb.thumb.restRotation));
    }
  };

  const deferHandArm = (limb: Limb, tracked: TrackedHand | undefined) => {
    const wrist = tracked?.landmarks[0];
    if (!tracked || !isInImage(wrist) ||
        !detailedHandPose(tracked, boneAxes.palmNormal.clone()
          .applyQuaternion(limb.end.node.getWorldQuaternion(new Quaternion()))
          .applyQuaternion(root.getWorldQuaternion(new Quaternion()).invert()))) return false;
    limb.fallbackHand = tracked;
    for (const binding of [limb.upper, limb.lower, limb.end, limb.fingers, limb.thumb]) {
      if (binding) deferred.add(binding);
    }
    return true;
  };

  // Retargeting: derive bone orientations from the tracked landmarks.
  const solve = (landmarks: readonly PoseLandmark[], hands: readonly TrackedHand[]) => {
    const point = (index: number) => readPosePoint(landmarks, index);
    const leftShoulder = point(poseIndices.leftShoulder);
    const rightShoulder = point(poseIndices.rightShoulder);
    const leftHip = point(poseIndices.leftHip);
    const rightHip = point(poseIndices.rightHip);
    const shoulders = leftShoulder && rightShoulder ? midpoint(leftShoulder, rightShoulder) : null;
    const hips = leftHip && rightHip ? midpoint(leftHip, rightHip) : null;
    const up = shoulders && hips ? shoulders.clone().sub(hips) : ROOT_UP;
    // The hip line observes yaw/roll, but not pelvic pitch. Using the trunk's
    // up vector here would put all forward leaning into the pelvis and leave
    // the spine rigid. Keep that unobserved pitch neutral and bend the torso
    // above the leg attachments instead.
    const hipFrame = leftHip && rightHip ? bodyFrame(leftHip.clone().sub(rightHip), ROOT_UP) : null;
    const chestFrame = leftShoulder && rightShoulder
      ? bodyFrame(leftShoulder.clone().sub(rightShoulder), up) : null;
    targets = new Map<BoneBinding, Quaternion>();
    deferred.clear();
    const target = (binding: BoneBinding, pose: Quaternion | null) => {
      if (pose && binding.retargetOffset) targets.set(binding, pose.clone().multiply(binding.retargetOffset));
    };
    target(bone(skeleton.pelvis), hipFrame);
    if (chestFrame) {
      target(bone(skeleton.lowerSpine), (hipFrame ?? restHips).clone().slerp(chestFrame, upperSpine ? SPINE_BEND_SHARE : 1));
      if (upperSpine) target(upperSpine, chestFrame);
    }

    const leftEar = point(poseIndices.leftEar);
    const rightEar = point(poseIndices.rightEar);
    const nose = point(poseIndices.nose);
    if (leftEar && rightEar && nose) {
      target(head, headFrame(leftEar, rightEar, nose));
    }

    for (const limb of limbs) {
      const [start, middle, end] = limb.indices.map(point);
      const tracked = limb.isArm ? hands.find((hand) => hand.side === (limb.isLeft ? "left" : "right")) : undefined;
      limb.fallbackHand = null;
      if (!start || !middle || !end) {
        if (!deferHandArm(limb, tracked)) forgetLimb(limb);
        continue;
      }
      const body = limb.isArm ? chestFrame : hipFrame;
      const previousBody = limb.isArm ? previousChest : previousHips;
      const restBody = limb.isArm ? restChest : restHips;
      const fallback = limb.previousBendNormal?.clone() ?? limb.restBendNormal.clone();
      // Turn the previous normal with the body's rotation since the last sample
      // (or the rest normal with the body's rotation from rest).
      const previous = limb.previousBendNormal ? previousBody : restBody;
      if (body && previous) {
        fallback.applyQuaternion(body.clone().multiply(previous.clone().invert()));
      }
      const solved = limbFrames(start, middle, end, fallback);
      if (!solved) {
        // A collapsed/invalid body segment is no more useful than a missing
        // joint, but an independently observed hand can still guide the arm.
        if (!deferHandArm(limb, tracked)) forgetLimb(limb);
        continue;
      }
      limb.fallbackDepth = limb.fallbackElbow = limb.fallbackBend = null;
      limb.previousBendNormal = solved.normal;
      limb.trackedArm = true;
      target(limb.upper, solved.upper);
      target(limb.lower, solved.lower);
      if (limb.isArm) {
        const index = point(limb.isLeft ? poseIndices.leftIndex : poseIndices.rightIndex);
        const pinky = point(limb.isLeft ? poseIndices.leftPinky : poseIndices.rightPinky);
        const forearmRotation = solved.lower.clone().multiply(limb.lower.retargetOffset!);
        // Transport roll in forearm space through collapsed/edge-on samples.
        const fallback = (limb.previousRoll ?? limb.restRoll).clone().applyQuaternion(forearmRotation);
        const detailed = tracked ? detailedHandPose(tracked, fallback) : null;
        const hand = detailed?.palm ?? (index && pinky
          ? handFrame(end, index, pinky, limb.isLeft, fallback) : null);
        if (hand) {
          handTargets(limb, hand, detailed, forearmRotation, targets);
        } else {
          limb.previousRoll = null;
        }
      } else {
        const heel = point(limb.isLeft ? poseIndices.leftHeel : poseIndices.rightHeel);
        const toe = point(limb.isLeft ? poseIndices.leftFootIndex : poseIndices.rightFootIndex);
        if (heel && toe) {
          const calfRotation = solved.lower.clone().multiply(limb.lower.retargetOffset!);
          // A nearly flat ankle/heel/toe triangle does not observe sole roll.
          // Carry the prior sole-up with the calf while following the toes.
          const fallback = (limb.previousRoll ?? limb.restRoll).clone().applyQuaternion(calfRotation);
          const foot = footFrame(end, heel, toe, fallback);
          target(limb.end, foot?.rotation ?? null);
          limb.previousRoll = foot
            ? foot.up.clone().applyQuaternion(calfRotation.invert()) : null;
        } else {
          limb.previousRoll = null;
        }
      }
    }
    previousChest = chestFrame;
    previousHips = hipFrame;
  };

  // Pose application: root-space targets → parent-local bone rotations.
  const applyBoneBinding = (
    binding: BoneBinding, target: Quaternion | undefined, parentTarget: Quaternion | undefined,
    deltaSeconds: number, rootRotation: Quaternion,
  ) => {
    const desired = target?.clone();
    const filter = smoothers.get(binding)!;
    if (desired && smoothsWorld()) {
      desired.copy(filter.filter(desired, deltaSeconds));
    }
    if (desired) {
      // World smoothing aims each bone at its filtered target from wherever
      // its parent actually is. Local smoothing filters the rotation relative
      // to the parent's target instead, so a lagging parent (like the wrist)
      // doesn't twist its children (like the fingers) off their hinge axis.
      const parentRotation = !smoothsWorld() && parentTarget
        ? parentTarget.clone().premultiply(rootRotation)
        : binding.node.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
      desired.premultiply(rootRotation).premultiply(parentRotation.invert());
      binding.node.quaternion.copy(smoothsWorld()
        ? desired : filter.filter(desired, deltaSeconds)).normalize();
    } else {
      // Missing landmarks return only this part to its local rest pose.
      // Clear adaptive velocity so reacquisition cannot reuse stale motion.
      binding.node.quaternion.slerp(binding.restRotation, smoothing === "none" ? 1 : poseSmoothingAlpha(deltaSeconds)).normalize();
      filter.reset(smoothsWorld()
        ? binding.node.getWorldQuaternion(new Quaternion()).premultiply(rootRotation.clone().invert())
        : binding.node.quaternion);
    }
    binding.node.updateMatrix();
  };

  resetSmoothers();
  return {
    applyPose(landmarks, deltaSeconds, timestamp, hands = []) {
      if (disposed) return;
      const alpha = poseSmoothingAlpha(deltaSeconds);
      if (!alpha) return;
      if (!landmarks.length && !hands.length) {
        clearTargets();
      } else if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp !== lastTimestamp) {
        // Bend-plane history belongs to camera samples, not render frames. A cached
        // target still damps smoothly between samples without accumulating
        // extra bend-plane feedback on faster displays.
        if (timestamp !== undefined && lastTimestamp !== undefined &&
            (timestamp < lastTimestamp || timestamp - lastTimestamp > MAX_POSE_AGE_MS)) {
          // The pose expired before this sample, so the bend-plane and smoothing
          // history is stale. Keep the hand-only IK depth.
          clearTargets(timestamp > lastTimestamp);
          resetSmoothers();
        }
        solve(landmarks, hands);
        lastTimestamp = timestamp;
      }

      root.updateWorldMatrix(true, true);
      const rootRotation = root.getWorldQuaternion(new Quaternion());
      for (const binding of ordered) {
        if (deferred.has(binding)) continue;
        const parent = parentBinding(binding);
        applyBoneBinding(binding, targets.get(binding), parent && targets.get(parent), deltaSeconds, rootRotation);
      }
      root.updateWorldMatrix(true, true);
    },
    // Two-bone IK is only needed when a hand is visible but its arm is not.
    // Run it after camera framing, which supplies the wrist's screen target.
    applyHandFallback(camera, imageAspect, deltaSeconds) {
      if (disposed || !poseSmoothingAlpha(deltaSeconds)) return;
      root.updateWorldMatrix(true, true);
      const rootRotation = root.getWorldQuaternion(new Quaternion());
      const applyArm = (limb: Limb, output: Map<BoneBinding, Quaternion>) => {
        for (const binding of [limb.upper, limb.lower, limb.end, limb.fingers, limb.thumb]) {
          if (!binding) continue;
          const parent = parentBinding(binding);
          const parentTarget = parent && (output.get(parent) ?? targets.get(parent));
          applyBoneBinding(binding, output.get(binding), parentTarget, deltaSeconds, rootRotation);
        }
        root.updateWorldMatrix(true, true);
      };
      for (const limb of limbs) {
        const tracked = limb.fallbackHand;
        if (!tracked) continue;
        const shoulder = rootPosition(limb.upper);
        if (!limb.fallbackDepth) {
          const wrist = rootPosition(limb.end);
          // Hold the entry depth relative to the shoulder. Reusing the
          // reach-clamped wrist's depth would ratchet the arm across frames.
          limb.fallbackDepth = wrist.clone().sub(shoulder);
          limb.fallbackElbow = limb.trackedArm ? rootPosition(limb.lower) : null;
          const axis = wrist.sub(shoulder).normalize();
          const bend = limb.fallbackElbow?.clone().sub(shoulder)
            ?? elbowRestDirections[limb.isLeft ? "left" : "right"].clone();
          bend.addScaledVector(axis, -bend.dot(axis));
          limb.fallbackBend = bend.lengthSq() > 1e-10 ? bend.normalize()
            : elbowRestDirections[limb.isLeft ? "left" : "right"].clone().normalize();
        }
        const desired = handImageTarget(root, camera, imageAspect, tracked.landmarks[0],
          shoulder.clone().add(limb.fallbackDepth));
        // If IK can't be solved, ease the arm toward rest like an untracked limb.
        if (!desired) { applyArm(limb, new Map()); continue; }
        const solved = solveArmIK({ shoulder, target: desired,
          upperLength: limb.upperLength, lowerLength: limb.lowerLength,
          bendDirection: limb.fallbackBend!, previousElbow: limb.fallbackElbow });
        if (!solved) { applyArm(limb, new Map()); continue; }
        limb.fallbackElbow = solved.elbow;
        limb.fallbackBend = solved.bendDirection;
        const normal = solved.bendDirection.clone().cross(solved.wrist.clone().sub(shoulder));
        const prior = limb.previousBendNormal ?? limb.restBendNormal;
        if (normal.lengthSq() < 1e-10) normal.copy(prior);
        else {
          normal.normalize();
          if (normal.dot(prior) < 0) normal.negate();
        }
        const upper = segmentFrame(solved.elbow.clone().sub(shoulder), normal);
        const lower = segmentFrame(solved.wrist.clone().sub(solved.elbow), normal);
        if (!upper || !lower) { applyArm(limb, new Map()); continue; }
        limb.previousBendNormal = normal;
        const forearm = lower.multiply(limb.lower.retargetOffset!);
        const output = new Map<BoneBinding, Quaternion>([
          [limb.upper, upper.multiply(limb.upper.retargetOffset!)], [limb.lower, forearm],
        ]);
        const fallback = (limb.previousRoll ?? limb.restRoll).clone().applyQuaternion(forearm);
        const detailed = detailedHandPose(tracked, fallback);
        if (detailed) handTargets(limb, detailed.palm, detailed, forearm, output);
        // Each deferred binding is damped exactly once, after framing settles
        // for this render.
        applyArm(limb, output);
      }
    },
    setSmoothing(mode) {
      if (disposed || mode === smoothing) return;
      smoothing = mode;
      resetSmoothers();
    },
    nodes: ordered.map((binding) => binding.node),
    resync() {
      if (disposed) return;
      clearTargets();
      resetSmoothers();
    },
    reset,
    dispose() {
      if (disposed) return;
      reset();
      disposed = true;
    },
  };
}

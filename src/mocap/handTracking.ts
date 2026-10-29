import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";
import type { PoseLandmark, TrackedHand } from "./poseTracking";
import { isInImage, isVisibleInImage, MIN_CONFIDENCE } from "./landmarks";

type HandResult = Pick<HandLandmarkerResult, "landmarks" | "worldLandmarks"> &
  Partial<Pick<HandLandmarkerResult, "handedness">>;

const sides = [
  { side: "left", wrist: 15, elbow: 13 },
  { side: "right", wrist: 16, elbow: 14 },
] as const;
const MIN_HANDEDNESS = 0.9;
const MAX_CONTINUITY_MS = 500;

/** Find unambiguous one-to-one matches for two anatomical sides. */
function match(costs: number[][]): number[] {
  const options = costs.map((side) => [
    -1,
    ...side.flatMap((cost, index) => (cost <= 1 ? [index] : [])),
  ]);
  const assignments = options[0].flatMap((left) =>
    options[1].flatMap((right) =>
      left !== -1 && left === right
        ? []
        : [
            {
              indices: [left, right],
              count: Number(left !== -1) + Number(right !== -1),
              cost:
                (left === -1 ? 0 : costs[0][left]) +
                (right === -1 ? 0 : costs[1][right]),
            },
          ],
    ),
  );
  assignments.sort((a, b) => b.count - a.count || a.cost - b.cost);
  const best = assignments[0];
  if (!best?.count) return [-1, -1];
  const ambiguous = assignments.filter(
    (candidate) =>
      candidate.count === best.count && candidate.cost - best.cost < 0.1,
  );
  return best.indices.map((index, side) =>
    ambiguous.some((candidate) => candidate.indices[side] !== index)
      ? -1
      : index,
  );
}

/** Body wrists identify the active person's hands first. If a wrist is outside
 * the frame or unobserved, recent hand motion and then confident handedness
 * can identify that side independently. The latter assumes one camera user;
 * it never overrides a visible, contradictory body wrist. */
export function associateHands(
  result: HandResult,
  pose: readonly PoseLandmark[],
  width: number,
  height: number,
  previousHands: readonly TrackedHand[] = [],
): TrackedHand[] {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0))
    return [];
  const shortSide = Math.min(width, height);
  const distance = (a: PoseLandmark, b: PoseLandmark) =>
    Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
  const finite = (point: PoseLandmark) =>
    !!point && [point.x, point.y, point.z].every(Number.isFinite);
  const hands = result.landmarks.flatMap((landmarks, index) => {
    const worldLandmarks = result.worldLandmarks[index];
    const classification = result.handedness?.[index]?.[0];
    // Tasks 1.1.1 reports anatomical sides for the unmirrored input. The
    // presentation layer later swaps sides with its camera-preview reflection.
    const classifiedSide =
      classification?.categoryName === "Left"
        ? "left"
        : classification?.categoryName === "Right"
          ? "right"
          : null;
    const handedness =
      classifiedSide &&
      Number.isFinite(classification!.score) &&
      classification!.score >= MIN_HANDEDNESS &&
      classification!.score <= 1
        ? { side: classifiedSide, score: classification!.score }
        : null;
    return landmarks.length === 21 &&
      worldLandmarks?.length === 21 &&
      // Hand presence is thresholded by the task; per-point score fields are
      // placeholders and cannot be used to reject an otherwise detected hand.
      landmarks.every(finite) &&
      worldLandmarks.every(finite) &&
      isInImage(landmarks[0])
      ? [{ landmarks, worldLandmarks, handedness }]
      : [];
  });
  if (!hands.length) return [];

  const anchors = sides.map(({ wrist, elbow }) => {
    const point = pose[wrist];
    if (!isVisibleInImage(point)) return null;
    const forearm = pose[elbow];
    const radius = isVisibleInImage(forearm)
      ? Math.max(
          shortSide * 0.06,
          Math.min(shortSide * 0.2, distance(point, forearm) * 0.6),
        )
      : shortSide * 0.1;
    return {
      point,
      radius,
      confidence: Math.min(point.visibility ?? 1, point.presence ?? 1),
    };
  });
  const poseCosts = anchors.map((anchor) =>
    hands.map((hand) =>
      anchor
        ? distance(anchor.point, hand.landmarks[0]) / anchor.radius
        : Infinity,
    ),
  );
  const indices = match(poseCosts);
  const confidence = indices.map((index, side) =>
    index === -1
      ? 0
      : Math.min(anchors[side]!.confidence, 1 - poseCosts[side][index] * 0.5),
  );
  // A hand near a visible wrist belongs to that association problem, even
  // when two close wrists make it ambiguous. A fallback must not steal it.
  const reserved = new Set(
    hands.flatMap((_, index) =>
      poseCosts.some((costs) => costs[index] <= 1) ? [index] : [],
    ),
  );
  const previous = sides.map(({ side }) =>
    previousHands.find(
      (hand) =>
        hand.side === side &&
        Number.isFinite(hand.confidence) &&
        hand.confidence >= MIN_CONFIDENCE &&
        isInImage(hand.landmarks[0]),
    ),
  );
  const continuityCosts = sides.map(({ side }, sideIndex) =>
    hands.map((hand, index) =>
      !anchors[sideIndex] &&
      previous[sideIndex] &&
      !reserved.has(index) &&
      (!hand.handedness || hand.handedness.side === side)
        ? distance(previous[sideIndex]!.landmarks[0], hand.landmarks[0]) /
          (shortSide * 0.2)
        : Infinity,
    ),
  );
  const continuity = match(continuityCosts);
  continuity.forEach((index, side) => {
    if (index === -1) return;
    indices[side] = index;
    confidence[side] = Math.min(
      previous[side]!.confidence,
      1 - continuityCosts[side][index] * 0.5,
    );
    reserved.add(index);
  });
  const classifierCosts = sides.map(({ side }, sideIndex) =>
    hands.map((hand, index) =>
      !anchors[sideIndex] &&
      indices[sideIndex] === -1 &&
      !reserved.has(index) &&
      hand.handedness?.side === side
        ? 1 - hand.handedness.score
        : Infinity,
    ),
  );
  match(classifierCosts).forEach((index, side) => {
    if (index === -1) return;
    indices[side] = index;
    // This is side-assignment confidence, not hand-presence or joint quality.
    confidence[side] = hands[index].handedness!.score;
  });
  return indices.flatMap((index, side): TrackedHand[] =>
    index === -1
      ? []
      : [
          {
            side: sides[side].side,
            // The task serializes visibility:0 without a visibility model. Keep xyz
            // only so consumers don't mistake placeholder scores for invisible joints.
            landmarks: hands[index].landmarks.map(({ x, y, z }) => ({
              x,
              y,
              z,
            })),
            worldLandmarks: hands[index].worldLandmarks.map(({ x, y, z }) => ({
              x,
              y,
              z,
            })),
            confidence: confidence[side],
          },
        ],
  );
}

/** Continuity is scoped to this worker session and consecutive camera samples.
 * Missing hands, time discontinuities and image-size changes clear its history. */
export function createHandAssociator() {
  let previous: TrackedHand[] = [];
  let previousTimestamp: number | undefined;
  let previousWidth: number | undefined;
  let previousHeight: number | undefined;
  const reset = () => {
    previous = [];
    previousTimestamp = previousWidth = previousHeight = undefined;
  };
  return {
    associate(
      result: HandResult,
      pose: readonly PoseLandmark[],
      width: number,
      height: number,
      timestamp: number,
    ) {
      if (
        !Number.isFinite(timestamp) ||
        previousTimestamp === undefined ||
        timestamp <= previousTimestamp ||
        timestamp - previousTimestamp > MAX_CONTINUITY_MS ||
        width !== previousWidth ||
        height !== previousHeight
      )
        reset();
      const hands = associateHands(result, pose, width, height, previous);
      previous = hands;
      previousTimestamp = timestamp;
      previousWidth = width;
      previousHeight = height;
      return hands;
    },
    reset,
  };
}

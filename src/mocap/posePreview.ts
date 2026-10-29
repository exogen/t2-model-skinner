import type { PoseLandmark, TrackedFace, TrackedHand } from "./poseTracking";
import { isConfident, MIN_CONFIDENCE } from "./landmarks";
import type { VideoRect } from "../videoRect";

// MediaPipe's 33-point Pose Landmarker connections. Keep the small topology here
// so showing the preview does not import the inference runtime on the main thread.
const connections = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 7],
  [0, 4],
  [4, 5],
  [5, 6],
  [6, 8],
  [9, 10],
  [11, 12],
  [11, 13],
  [13, 15],
  [15, 17],
  [15, 19],
  [15, 21],
  [17, 19],
  [12, 14],
  [14, 16],
  [16, 18],
  [16, 20],
  [16, 22],
  [18, 20],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [24, 26],
  [25, 27],
  [26, 28],
  [27, 29],
  [28, 30],
  [29, 31],
  [30, 32],
  [27, 31],
  [28, 32],
] as const;

const handConnections = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
] as const;
const faceConnections = [
  [4, 0],
  [0, 1],
  [1, 5],
  [0, 2],
  [1, 2],
  [2, 3],
] as const;

export function previewPoint(point: PoseLandmark | undefined, rect: VideoRect) {
  if (!isConfident(point)) return null;
  return {
    x: rect.x + point.x * rect.width,
    y: rect.y + point.y * rect.height,
  };
}

export function drawPoseSkeleton(
  context: CanvasRenderingContext2D,
  landmarks: readonly PoseLandmark[],
  rect: VideoRect,
  hands: readonly TrackedHand[] = [],
  face?: TrackedFace,
) {
  // Detailed hands replace the coarse fingertip triangles, retaining the body
  // wrist so elbow-to-wrist connections remain visible.
  const hidden = new Set<number>();
  if (confidentFace(face))
    for (let index = 0; index < 11; index++) hidden.add(index);
  for (const hand of hands) {
    if (!confidentHand(hand)) continue;
    for (const index of hand.side === "left" ? [17, 19, 21] : [18, 20, 22])
      hidden.add(index);
  }
  const body = hidden.size
    ? landmarks.map((point, index) => (hidden.has(index) ? undefined : point))
    : landmarks;
  drawSkeleton(context, body, rect, connections, 3, (index) =>
    index < 11 ? 2.5 : 4.5,
  );
}

function confidentHand(hand: TrackedHand) {
  return (
    Number.isFinite(hand.confidence) &&
    hand.confidence >= MIN_CONFIDENCE &&
    hand.landmarks.length === 21
  );
}

function confidentFace(face: TrackedFace | undefined): face is TrackedFace {
  return (
    !!face &&
    Number.isFinite(face.confidence) &&
    face.confidence >= MIN_CONFIDENCE &&
    face.landmarks.length === 6
  );
}

export function drawFaceSkeleton(
  context: CanvasRenderingContext2D,
  face: TrackedFace | undefined,
  rect: VideoRect,
) {
  if (confidentFace(face))
    drawSkeleton(context, face.landmarks, rect, faceConnections, 2, () => 3);
}

export function drawHandSkeletons(
  context: CanvasRenderingContext2D,
  hands: readonly TrackedHand[],
  rect: VideoRect,
) {
  for (const hand of hands) {
    if (!confidentHand(hand)) continue;
    // HandLandmarker leaves unused visibility/presence fields at zero; those
    // are not the Pose model's per-joint confidence measurements.
    const points = hand.landmarks.map(({ x, y, z }) => ({ x, y, z }));
    drawSkeleton(context, points, rect, handConnections, 1.5, () => 2);
  }
}

function drawSkeleton(
  context: CanvasRenderingContext2D,
  landmarks: readonly (PoseLandmark | undefined)[],
  rect: VideoRect,
  edges: readonly (readonly [number, number])[],
  lineWidth: number,
  pointRadius: (index: number) => number,
) {
  const points = landmarks.map((landmark) => previewPoint(landmark, rect));
  context.save();
  context.beginPath();
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.clip();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  for (const [from, to] of edges) {
    const start = points[from];
    const end = points[to];
    if (!start || !end) continue;
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
  }
  context.lineWidth = lineWidth + 3;
  context.strokeStyle = "#062a2ccc";
  context.stroke();
  context.lineWidth = lineWidth;
  context.strokeStyle = "#77f5d4";
  context.stroke();
  context.lineWidth = 1.5;
  context.strokeStyle = "#062a2c";
  context.fillStyle = "#d8fff3";
  points.forEach((point, index) => {
    if (!point) return;
    context.beginPath();
    context.arc(point.x, point.y, pointRadius(index), 0, Math.PI * 2);
    context.fill();
    context.stroke();
  });
  context.restore();
}

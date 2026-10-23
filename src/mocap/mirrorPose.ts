import type { PoseFrame, PoseLandmark, TrackedHand } from "./poseTracking";
import { MIN_CONFIDENCE } from "./landmarks";

// MediaPipe's facial landmarks are grouped by side; the remaining landmarks
// alternate left/right. The nose (0) is the only unpaired landmark.
const oppositeSide = [
  0, 4, 5, 6, 1, 2, 3, 8, 7, 10, 9,
  12, 11, 14, 13, 16, 15, 18, 17, 20, 19, 22, 21,
  24, 23, 26, 25, 28, 27, 30, 29, 32, 31,
] as const;

/** Mirror the performed pose to match the camera preview, without reflecting
 * the model or its skin. Swapping sides together with X reflection preserves
 * the body's facing direction and each limb's anatomical coordinate frame. */
export function mirrorPoseLandmarks(landmarks: readonly PoseLandmark[]): PoseLandmark[] {
  const mirrored = new Array<PoseLandmark>(landmarks.length);
  landmarks.forEach((point, index) => {
    // Retain absent points as absent rather than manufacturing confidence.
    if (point) mirrored[oppositeSide[index] ?? index] = { ...point, x: -point.x };
  });
  return mirrored;
}

/** Image-space version of the same reflection, for camera framing. */
export function mirrorImagePoseLandmarks(landmarks: readonly PoseLandmark[]): PoseLandmark[] {
  return mirrorPoseLandmarks(landmarks).map((point) => ({ ...point, x: 1 + point.x }));
}

/** The face fallback has its own six-point topology. Convert only its observed
 * eyes/ears/nose, without treating predicted offscreen body points as framing. */
export function framingLandmarks(frame: PoseFrame): PoseLandmark[] {
  if (!frame.face) return mirrorImagePoseLandmarks(frame.landmarks ?? []);
  const points: PoseLandmark[] = [];
  const face = frame.face;
  if (!Number.isFinite(face.confidence) || face.confidence < MIN_CONFIDENCE) return points;
  // FaceDetector: right eye, left eye, nose, mouth, right ear, left ear.
  for (const [faceIndex, poseIndex] of [[0, 5], [1, 2], [2, 0], [4, 8], [5, 7]]) {
    const point = face.landmarks[faceIndex];
    if (point) points[poseIndex] = { ...point, visibility: face.confidence, presence: face.confidence };
  }
  return mirrorImagePoseLandmarks(points);
}

/** Each hand uses the same wrist/thumb/finger indices. Reflect coordinates and
 * swap the whole hand's side, never the individual finger indices. */
export function mirrorTrackedHands(hands: readonly TrackedHand[]): TrackedHand[] {
  return hands.map((hand) => ({
    ...hand,
    side: hand.side === "left" ? "right" : "left",
    landmarks: hand.landmarks.map((point) => ({ ...point, x: 1 - point.x })),
    worldLandmarks: hand.worldLandmarks.map((point) => ({ ...point, x: -point.x })),
  }));
}

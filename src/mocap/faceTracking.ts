import type { FaceDetectorResult } from "@mediapipe/tasks-vision";
import type { PoseFrame, PoseLandmark, TrackedFace } from "./poseTracking";
import { isInImage, MIN_CONFIDENCE } from "./landmarks";

function visible(point: PoseLandmark | undefined): point is PoseLandmark {
  return (
    isInImage(point) &&
    (point.visibility ?? 1) >= MIN_CONFIDENCE &&
    (point.presence ?? 1) >= MIN_CONFIDENCE
  );
}

/** Body poses can retain high confidence for extrapolated, offscreen shoulders
 * in a face close-up. Inspect the image geometry as well as confidence. */
export function needsFaceTracking(
  pose: PoseFrame | null,
  width: number,
  height: number,
): boolean {
  if (!pose) return true;
  const points = pose.landmarks;
  if (!visible(points[11]) || !visible(points[12])) return true;
  const leftEye = points[2],
    rightEye = points[5];
  return (
    visible(leftEye) &&
    visible(rightEye) &&
    Math.hypot(
      (leftEye.x - rightEye.x) * width,
      (leftEye.y - rightEye.y) * height,
    ) >
      Math.min(width, height) * 0.1
  );
}

/** Select a prominent face belonging to the body we already track. Without a
 * body, take the largest face, matching the app's single-person interaction. */
export function selectCloseupFace(
  result: FaceDetectorResult,
  pose: PoseFrame | null,
  width: number,
  height: number,
): TrackedFace | undefined {
  if (!(width > 0 && height > 0)) return undefined;
  const faces: TrackedFace[] = [];
  const nose = pose?.landmarks[0];
  for (const detection of result.detections) {
    const confidence = detection.categories[0]?.score ?? 0;
    const box = detection.boundingBox;
    if (
      !Number.isFinite(confidence) ||
      confidence < MIN_CONFIDENCE ||
      !box ||
      ![box.originX, box.originY, box.width, box.height].every(
        Number.isFinite,
      ) ||
      Math.min(box.width, box.height) < Math.min(width, height) * 0.18 ||
      detection.keypoints.length < 6 ||
      detection.keypoints
        .slice(0, 6)
        .some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
    )
      continue;
    const bounds = {
      x: box.originX / width,
      y: box.originY / height,
      width: box.width / width,
      height: box.height / height,
    };
    // A loose box tolerates the body detector's inaccurate close-up nose but
    // excludes a separate face elsewhere in the image.
    if (
      visible(nose) &&
      (nose.x < bounds.x - bounds.width * 0.5 ||
        nose.x > bounds.x + bounds.width * 1.5 ||
        nose.y < bounds.y - bounds.height * 0.5 ||
        nose.y > bounds.y + bounds.height * 1.5)
    )
      continue;
    faces.push({
      bounds,
      confidence,
      landmarks: detection.keypoints.slice(0, 6).map((point) => ({
        x: point.x,
        y: point.y,
        z: 0,
        visibility: confidence,
        presence: confidence,
      })),
    });
  }
  if (visible(nose)) {
    faces.sort(
      (a, b) =>
        Math.hypot(
          (a.landmarks[2].x - nose.x) * width,
          (a.landmarks[2].y - nose.y) * height,
        ) -
        Math.hypot(
          (b.landmarks[2].x - nose.x) * width,
          (b.landmarks[2].y - nose.y) * height,
        ),
    );
  } else
    faces.sort(
      (a, b) =>
        b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height,
    );
  return faces[0];
}

import type { PoseLandmark } from "./poseTracking";

// Shared with the tracking worker, so keep this free of runtime imports.

/** The lowest visibility or presence score a landmark needs, and the lowest
 * confidence for a whole hand or face. */
export const MIN_CONFIDENCE = 0.5;

/** Finite x and y, and any visibility or presence at least MIN_CONFIDENCE. */
export function isConfident(point: PoseLandmark | undefined): point is PoseLandmark {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
    [point.visibility, point.presence].every((score) =>
      score === undefined || (Number.isFinite(score) && score >= MIN_CONFIDENCE));
}

/** Inside the image, whatever its scores. */
export function isInImage(point: PoseLandmark | undefined): point is PoseLandmark {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
    point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

export function isVisibleInImage(point: PoseLandmark | undefined): point is PoseLandmark {
  return isInImage(point) && isConfident(point);
}

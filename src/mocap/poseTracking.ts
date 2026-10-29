export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
}

export interface TrackedHand {
  side: "left" | "right";
  /** Normalized image coordinates, before presentation mirroring. */
  landmarks: PoseLandmark[];
  /** Hand-centered meters in camera axes; not body-relative positions. */
  worldLandmarks: PoseLandmark[];
  /** Confidence in the anatomical side assignment, from a body wrist,
   * recent hand motion, or the hand classifier when the body is unobserved. */
  confidence: number;
}

export interface TrackedFace {
  /** Six normalized image points: anatomical right eye, left eye, nose,
   * mouth, right ear, left ear. No depth or world-space pose is inferred. */
  landmarks: PoseLandmark[];
  /** Normalized image bounds, before presentation mirroring. */
  bounds: { x: number; y: number; width: number; height: number };
  confidence: number;
}

export interface PoseFrame {
  landmarks: PoseLandmark[];
  worldLandmarks: PoseLandmark[];
  hands?: TrackedHand[];
  face?: TrackedFace;
  /** Source frame dimensions for matching the camera's aspect and framing. */
  imageWidth?: number;
  imageHeight?: number;
  /** Capture time, retained for tracking and retargeting sample identity. */
  timestamp: number;
  /** Arrival time on the main thread's performance clock. Slow inference
   * must not make a newly received result expire before it can be displayed. */
  receivedAt?: number;
}

/** The longest a pose is held while waiting for the next detector result. */
export const MAX_POSE_AGE_MS = 2000;

/** Hold slow CPU results long enough for the next inference to arrive instead
 * of easing toward rest between frames. A pose expires after twice its
 * inference time, clamped between 500ms and MAX_POSE_AGE_MS. */
export function freshPose(
  pose: PoseFrame | null | undefined,
  now: number,
): PoseFrame | null {
  if (!pose || !Number.isFinite(now) || !Number.isFinite(pose.timestamp))
    return null;
  const arrived = pose.receivedAt ?? pose.timestamp;
  const maxAge = Math.max(
    500,
    Math.min(MAX_POSE_AGE_MS, 2 * (arrived - pose.timestamp)),
  );
  return Number.isFinite(arrived) && now - arrived <= maxAge ? pose : null;
}

export type TrackingStatus =
  "idle" | "loading" | "requesting" | "tracking" | "paused" | "lost" | "error";

export function cameraErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Camera access was denied. Allow camera access in your browser and try again.";
    }
    if (error.name === "NotFoundError") {
      return "No camera was found. Connect a camera and try again.";
    }
    if (error.name === "NotReadableError") {
      return "The camera is unavailable. Close other apps using it and try again.";
    }
    if (error.name === "OverconstrainedError") {
      return "This camera could not start with the requested settings. Try another camera.";
    }
  }
  return "Motion tracking could not start. Check your connection and browser camera support, then try again.";
}

// Pending permission requests cannot be cancelled. Let callers stop waiting while
// separately disposing any stream that arrives after the session was stopped.
export function untilAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(new DOMException("Tracking stopped", "AbortError"));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

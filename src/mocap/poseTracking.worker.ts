import * as Comlink from "comlink";
import { FaceDetector, FilesetResolver, HandLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { PoseFrame } from "./poseTracking";
import type { Delegate, PoseDetectorAssets, PoseTrackingSettings } from "./poseSettings";
import { sameOriginFetch } from "./workerNetwork";
import { createHandAssociator } from "./handTracking";
import { needsFaceTracking, selectCloseupFace } from "./faceTracking";

globalThis.fetch = sameOriginFetch(globalThis.fetch.bind(globalThis), self.location.href);

let tracker: PoseLandmarker | null = null;
let handTracker: HandLandmarker | null = null;
let faceTracker: FaceDetector | null = null;
let createFaceTracker: (() => Promise<FaceDetector>) | null = null;
let generation = 0;
const handAssociator = createHandAssociator();

/** Create a task on the GPU, or on the CPU if that fails while still open. */
async function createTask<T>(
  create: (delegate: Delegate) => Promise<T>, checkOpen: () => void,
): Promise<{ task: T; delegate: Delegate }> {
  try {
    return { task: await create("GPU"), delegate: "GPU" };
  } catch {
    checkOpen();
    return { task: await create("CPU"), delegate: "CPU" };
  }
}

const api = {
  async initialize(assets: PoseDetectorAssets, settings: PoseTrackingSettings) {
    api.close();
    const current = generation;
    let body: PoseLandmarker | null = null;
    let hands: HandLandmarker | null = null;
    const checkOpen = () => {
      if (generation !== current) throw new Error("Motion tracker closed during initialization");
    };
    try {
      const fileset = await FilesetResolver.forVisionTasks(assets.wasmUrl);
      checkOpen();
      let delegate: Delegate;
      const createBody = (delegate: Delegate) =>
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: assets.modelUrl, delegate },
          canvas: new OffscreenCanvas(1, 1),
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: settings.minDetectionConfidence,
          minPosePresenceConfidence: settings.minPresenceConfidence,
          minTrackingConfidence: settings.minTrackingConfidence,
          outputSegmentationMasks: false,
        });
      ({ task: body, delegate } = await createTask(createBody, checkOpen));
      checkOpen();
      let handDelegate: Delegate | null = null;
      let handWarning: string | null = null;
      if (settings.handTracking) {
        const create = (delegate: Delegate) =>
          HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: assets.handModelUrl, delegate },
            canvas: new OffscreenCanvas(1, 1),
            runningMode: "VIDEO",
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          });
        try {
          checkOpen();
          ({ task: hands, delegate: handDelegate } = await createTask(create, checkOpen));
        } catch {
          handWarning = "Detailed hand tracking could not start. Body tracking is still active.";
        }
      }
      checkOpen();
      tracker = body;
      handTracker = hands;
      // Resolve the small close-up task only if body landmarks cannot describe
      // the camera framing. Regular full-body tracking pays no inference cost.
      if (assets.faceModelUrl) createFaceTracker = async () => {
        checkOpen();
        const create = (delegate: Delegate) => FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: assets.faceModelUrl, delegate },
          canvas: new OffscreenCanvas(1, 1),
          runningMode: "VIDEO",
          minDetectionConfidence: 0.5,
        });
        return (await createTask(create, checkOpen)).task;
      };
      return { delegate, handDelegate, handWarning };
    } catch {
      body?.close();
      hands?.close();
      throw new Error("Motion tracker could not be initialized");
    }
  },

  async detect(bitmap: ImageBitmap, timestamp: number): Promise<PoseFrame | null> {
    try {
      const current = generation;
      if (!tracker) throw new Error("Motion tracker is not ready");
      const result = tracker.detectForVideo(bitmap, timestamp);
      const landmarks = result.landmarks[0];
      const worldLandmarks = result.worldLandmarks[0];
      let pose: PoseFrame | null = landmarks?.length && worldLandmarks?.length
        ? { landmarks, worldLandmarks, timestamp } : null;
      if (current !== generation) return null;
      if (handTracker) {
        const hands = handAssociator.associate(
          handTracker.detectForVideo(bitmap, timestamp), pose?.landmarks ?? [],
          bitmap.width, bitmap.height, timestamp,
        );
        if (hands.length) pose ??= { landmarks: [], worldLandmarks: [], timestamp };
        if (pose) pose.hands = hands;
      }
      if (needsFaceTracking(pose, bitmap.width, bitmap.height)) {
        if (!faceTracker && createFaceTracker) {
          const create = createFaceTracker;
          createFaceTracker = null;
          try {
            const face = await create();
            if (current !== generation) { face.close(); return null; }
            faceTracker = face;
          } catch {
            // An optional face fallback must not stop working body/hand tracking.
          }
        }
        if (current !== generation) return null;
        if (faceTracker) {
          try {
            const face = selectCloseupFace(faceTracker.detectForVideo(bitmap, timestamp), pose, bitmap.width, bitmap.height);
            if (face) {
              pose ??= { landmarks: [], worldLandmarks: [], timestamp };
              pose.face = face;
            }
          } catch {
            faceTracker.close();
            faceTracker = null;
          }
        }
      }
      if (!pose) return null;
      pose.imageWidth = bitmap.width;
      pose.imageHeight = bitmap.height;
      return pose;
    } finally {
      bitmap.close();
    }
  },

  close() {
    generation++;
    tracker?.close();
    tracker = null;
    handTracker?.close();
    handTracker = null;
    handAssociator.reset();
    faceTracker?.close();
    faceTracker = null;
    createFaceTracker = null;
  },
};

export type PoseTrackingWorker = typeof api;

Comlink.expose(api);

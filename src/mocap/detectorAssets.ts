import { getLocalAssetUrl } from "../deployPaths";
import type { PoseDetectorAssets, PoseTrackingSettings } from "./poseSettings";

/** Shared by the camera and benchmark so both exercise the same models. */
export function detectorAssets(
  base: string,
  model: PoseTrackingSettings["model"],
): PoseDetectorAssets {
  return {
    wasmUrl: getLocalAssetUrl(base, "mocap/tasks-vision-1.1.1"),
    modelUrl: getLocalAssetUrl(base, `mocap/pose_landmarker_${model}_v1.task`),
    handModelUrl: getLocalAssetUrl(base, "mocap/hand_landmarker_v1.task"),
    faceModelUrl: getLocalAssetUrl(
      base,
      "mocap/blaze_face_short_range_v1.tflite",
    ),
  };
}

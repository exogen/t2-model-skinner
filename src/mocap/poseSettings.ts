export interface PoseTrackingSettings {
  model: "lite" | "full";
  handTracking: boolean;
  smoothing: "none" | "classic" | "adaptive" | "stable";
  minDetectionConfidence: number;
  minPresenceConfidence: number;
  minTrackingConfidence: number;
}

// Selected from the recorded corpus and synthetic smoothing comparisons.
export const DEFAULT_POSE_SETTINGS: PoseTrackingSettings = {
  model: "full",
  handTracking: true,
  smoothing: "adaptive",
  minDetectionConfidence: 0.5,
  minPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
};

export type Delegate = "GPU" | "CPU";

export interface PoseTrackingStats {
  fps: number;
  frameMs: number;
  delegate: Delegate | null;
  handDelegate: Delegate | null;
  width: number;
  height: number;
}

export interface PoseDetectorAssets {
  wasmUrl: string;
  modelUrl: string;
  handModelUrl: string;
  faceModelUrl?: string;
}

export function normalizePoseSettings(value: Partial<PoseTrackingSettings>): PoseTrackingSettings {
  const confidence = (input: number | undefined) =>
    typeof input === "number" && Number.isFinite(input) ? Math.max(0.1, Math.min(0.9, input)) : 0.5;
  return {
    model: value.model === "lite" || value.model === "full"
      ? value.model : DEFAULT_POSE_SETTINGS.model,
    handTracking: value.handTracking !== false,
    smoothing: ["none", "classic", "adaptive", "stable"].includes(value.smoothing ?? "")
      ? value.smoothing as PoseTrackingSettings["smoothing"] : DEFAULT_POSE_SETTINGS.smoothing,
    minDetectionConfidence: confidence(value.minDetectionConfidence),
    minPresenceConfidence: confidence(value.minPresenceConfidence),
    minTrackingConfidence: confidence(value.minTrackingConfidence),
  };
}

// Rig smoothing applies without rebuilding the detector.
export function detectorSettingsKey(settings: PoseTrackingSettings): string {
  return [settings.model, settings.minDetectionConfidence, settings.minPresenceConfidence,
    settings.minTrackingConfidence, settings.handTracking].join(":");
}

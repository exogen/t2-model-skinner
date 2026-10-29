import { memo, useEffect, useLayoutEffect } from "react";
import type { PoseRuntime } from "../Viewer";
import { createPoseFraming } from "./cameraFraming";
import usePoseTracking from "./usePoseTracking";
import useRecorder, { type Recorder } from "./useRecorder";
import { createPlayerRig } from "./rig";
import { RecorderAnnouncer } from "./RecorderOverlay";

export { default as Preview } from "./MocapPreview";
export { default as Pose } from "./MocapPose";

export const viewerRuntime: PoseRuntime = {
  createPlayerRig,
  createPoseFraming,
};

export type MocapTracking = ReturnType<typeof usePoseTracking> & {
  recorder: Recorder;
};

// The memo boundary prevents publishing tracking state to the shell from
// re-rendering this hook in a loop. Keep it mounted after stopping so settings
// survive the next activation; the hook stops all camera/worker resources.
export const Controller = memo(function MocapController({
  onTracking,
  requested,
  requestId,
}: {
  onTracking: (tracking: MocapTracking) => void;
  requested: boolean;
  requestId: number;
}) {
  const tracking = usePoseTracking();
  const recorder = useRecorder(tracking.status);
  const { start, stop } = tracking;
  useLayoutEffect(() => {
    onTracking({ ...tracking, recorder });
  }, [tracking, recorder, onTracking]);
  useEffect(() => {
    if (requested) void start();
    else stop();
  }, [requested, requestId, start, stop]);
  return <RecorderAnnouncer announcement={recorder.announcement} />;
});

import { useEffect } from "react";
import useModelViewer from "../useModelViewer";
import { useMocap } from "../MocapProvider";
import {
  freshPose,
  type PoseFrame,
  type PoseLandmark,
  type TrackedHand,
} from "./poseTracking";
import {
  framingLandmarks,
  mirrorPoseLandmarks,
  mirrorTrackedHands,
} from "./mirrorPose";
import { applyRecording, framableKeys, framingAt } from "./recording";
import { ViewerOverlay } from "./RecorderOverlay";

// Playback steps further than this, or backwards, are seeks or loops.
const PLAYBACK_JUMP_SECONDS = 0.15;

export default function MocapPose() {
  const { viewer, rig } = useModelViewer();
  const { active, tracking } = useMocap();
  const {
    latestPose,
    settings: { smoothing },
    recorder,
  } = tracking!;
  const { selected, paused, activity, attach, sampleFrame, playbackRef } =
    recorder;
  useEffect(() => {
    rig?.setSmoothing(smoothing);
  }, [rig, smoothing]);
  useEffect(
    () => (active && rig ? attach({ viewer, nodes: rig.nodes }) : undefined),
    [viewer, rig, active, attach],
  );

  // Photo booth shots copy only the camera image's area, so while one is on
  // its way, what they'll leave out is faded.
  const booth =
    activity?.phase === "booth-countdown" || activity?.phase === "booth-hold";
  useEffect(() => {
    if (!active || !booth) return;
    viewer.setFadeOutsideCameraArea(true);
    return () => viewer.setFadeOutsideCameraArea(false);
  }, [viewer, active, booth]);

  // The camera drives the rig while no recording or pose is selected.
  useEffect(() => {
    if (!active || !rig || selected) return;
    let mirroredFrame: PoseFrame | null = null;
    let mirroredLandmarks: PoseLandmark[] = [];
    let mirroredHands: TrackedHand[] = [];
    let imageLandmarks: PoseLandmark[] = [];
    const unsubscribe = viewer.subscribeFrame((delta) => {
      // An inference stall must not leave the model frozen indefinitely.
      const fresh = freshPose(latestPose.current, performance.now());
      if (fresh !== mirroredFrame) {
        mirroredFrame = fresh;
        mirroredLandmarks = fresh
          ? mirrorPoseLandmarks(fresh.worldLandmarks)
          : [];
        mirroredHands = mirrorTrackedHands(fresh?.hands ?? []);
        imageLandmarks = fresh ? framingLandmarks(fresh) : [];
      }
      rig.applyPose(mirroredLandmarks, delta, fresh?.timestamp, mirroredHands);
      viewer.setPoseFraming(
        imageLandmarks,
        fresh?.imageWidth,
        fresh?.imageHeight,
      );
    });
    const unsubscribeHands = viewer.subscribePoseFrame(
      (delta, camera, imageAspect) => {
        rig.applyHandFallback(camera, imageAspect, delta);
        // The bones are final only after the hand fallback, so this is the pose
        // the frame draws.
        sampleFrame(
          delta,
          imageLandmarks,
          mirroredFrame?.imageWidth,
          mirroredFrame?.imageHeight,
        );
      },
    );
    return () => {
      unsubscribe();
      unsubscribeHands();
      rig.reset();
      viewer.resetPoseFraming();
      viewer.invalidate();
    };
  }, [viewer, rig, active, latestPose, selected, sampleFrame]);

  // A recording or pose replaces the live camera. It also replays the framing
  // input recorded with each key, so the view matches what was seen live.
  useEffect(() => {
    if (!active || !rig || !selected) return;
    const byName = new Map(rig.nodes.map((node) => [node.name, node]));
    const nodes = selected.nodes.map((name) => byName.get(name));
    const framable = framableKeys(selected);
    let key = -1;
    let framing: PoseLandmark[] = [];
    let lastTime: number | null = null;
    viewer.resetPoseFraming();
    const unsubscribe = viewer.subscribeFrame((delta) => {
      const playback = playbackRef.current;
      if (!playback.paused && selected.duration > 0) {
        playback.time = (playback.time + delta) % selected.duration;
      }
      const time = Math.min(playback.time, selected.duration);
      const nextKey = applyRecording(selected, nodes, time);
      if (nextKey !== key) {
        key = nextKey;
        framing = framingAt(selected, key);
      }
      // The bones jump on a seek or loop, so the framing jumps with them
      // instead of easing. While paused, every change is a seek. A key framing
      // can't measure snaps to the last one it could, as live mocap would.
      const jumped =
        lastTime === null ||
        (time !== lastTime &&
          (playback.paused ||
            time < lastTime ||
            time - lastTime > PLAYBACK_JUMP_SECONDS));
      lastTime = time;
      if (jumped && framable[key] >= 0) {
        viewer.resetPoseFraming();
        viewer.setPoseFraming(
          framingAt(selected, framable[key]),
          selected.imageWidth,
          selected.imageHeight,
        );
      } else {
        viewer.setPoseFraming(
          framing,
          selected.imageWidth,
          selected.imageHeight,
        );
      }
    });
    return () => {
      unsubscribe();
      // Live posing continues from the replayed pose instead of snapping to rest.
      rig.resync();
      viewer.invalidate();
    };
  }, [viewer, rig, active, selected, playbackRef]);

  return active ? (
    <ViewerOverlay activity={activity} playback={selected} paused={paused} />
  ) : null;
}

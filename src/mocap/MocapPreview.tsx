import { useCallback, useEffect, useId, useRef, useState } from "react";
import { VisuallyHidden } from "@ariakit/react";
import { useMocap } from "../MocapProvider";
import {
  drawFaceSkeleton,
  drawHandSkeletons,
  drawPoseSkeleton,
} from "./posePreview";
import { containedVideoRect } from "../videoRect";
import { freshPose, type PoseFrame } from "./poseTracking";
import styles from "./MocapPreview.module.css";
import MocapDebugPanel, { PoseDebugToggle } from "./MocapDebugPanel";
import { CaptureControls, PlaybackControls } from "./RecorderControls";
import RecorderOverlay from "./RecorderOverlay";

const statusLabels = {
  idle: "",
  loading: "Loading motion tracking…",
  requesting: "Allow camera access to begin.",
  tracking: "Live",
  paused: "Camera paused while this tab is hidden.",
  lost: "Move into view. Include your legs for full-body tracking.",
  error: "",
};

export default function MocapPreview() {
  const { active, tracking } = useMocap();
  const { videoRef, latestPose, status, error, recorder } = tracking!;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoElement = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const debugId = useId();
  const [debugOpen, setDebugOpen] = useState(false);
  const attachVideo = useCallback(
    (video: HTMLVideoElement | null) => {
      videoElement.current = video;
      videoRef(video);
    },
    [videoRef],
  );

  useEffect(() => {
    const stage = stageRef.current;
    const video = videoElement.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!stage || !video || !canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!active) return;

    let width = 0;
    let height = 0;
    let pixelRatio = 0;
    let dirty = true;
    let frameId = 0;
    let drawnPose: PoseFrame | null | undefined;
    const measure = () => {
      const bounds = stage.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      dirty = true;
    };
    const invalidate = () => {
      dirty = true;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    video.addEventListener("resize", invalidate);
    video.addEventListener("loadedmetadata", invalidate);
    measure();

    const draw = (now: number) => {
      const nextPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      if (dirty || nextPixelRatio !== pixelRatio) {
        pixelRatio = nextPixelRatio;
        canvas.width = Math.round(width * pixelRatio);
        canvas.height = Math.round(height * pixelRatio);
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        dirty = true;
      }
      const pose = freshPose(latestPose.current, now);
      if (dirty || drawnPose !== pose) {
        context.clearRect(0, 0, width, height);
        const rect = containedVideoRect(
          width,
          height,
          video.videoWidth,
          video.videoHeight,
        );
        if (pose && rect) {
          drawPoseSkeleton(
            context,
            pose.landmarks,
            rect,
            pose.hands,
            pose.face,
          );
          drawHandSkeletons(context, pose.hands ?? [], rect);
          drawFaceSkeleton(context, pose.face, rect);
        }
        drawnPose = pose;
        dirty = false;
      }
      frameId = requestAnimationFrame(draw);
    };
    frameId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      video.removeEventListener("resize", invalidate);
      video.removeEventListener("loadedmetadata", invalidate);
      context.clearRect(0, 0, width, height);
    };
  }, [active, latestPose]);

  // Anything but "Live" goes below the camera, in place of playback, so long
  // messages don't crowd the capture buttons.
  const message = error || (status === "tracking" ? "" : statusLabels[status]);
  const live = !message && status === "tracking";

  return (
    <section
      id="MocapPreview"
      className={styles.Preview}
      hidden={!active}
      aria-label="Motion capture"
    >
      <div className={styles.Bar} data-edge="top">
        <CaptureControls recorder={recorder} status={status} />
        <div className={styles.End}>
          {/* Hidden but still taking its space when not live, so the bar
              doesn't rewrap as tracking starts and stops. */}
          <span
            className={styles.Live}
            data-off={!live || undefined}
            aria-hidden="true"
          >
            <span className={styles.LiveDot} />
            Live
          </span>
          <PoseDebugToggle
            open={debugOpen}
            onToggle={() => setDebugOpen((open) => !open)}
            controls={debugId}
          />
        </div>
      </div>
      <div ref={stageRef} className={styles.Stage}>
        <video
          ref={attachVideo}
          className={styles.Video}
          autoPlay
          muted
          playsInline
          aria-label="Mirrored live camera"
        />
        <canvas
          ref={canvasRef}
          className={styles.Skeleton}
          aria-hidden="true"
        />
        <RecorderOverlay activity={recorder.activity} />
        {debugOpen && <MocapDebugPanel id={debugId} />}
      </div>
      <div className={styles.Bar} data-edge="bottom">
        {!message && <PlaybackControls recorder={recorder} />}
        {/* One live region for every status, "Live" included, so screen
            readers hear each change. It's visible only with a message, and
            stays the same element either way. */}
        <VisuallyHidden
          render={(props) => (
            <p {...props} style={message ? undefined : props.style} />
          )}
          className={message ? styles.Message : undefined}
          role={error ? "alert" : "status"}
        >
          {error || statusLabels[status]}
        </VisuallyHidden>
      </div>
    </section>
  );
}

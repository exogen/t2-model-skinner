import { useCallback, useEffect, useRef, useState } from "react";
import * as Comlink from "comlink";
import { BASE_PATH } from "../deployPaths";
import { detectorAssets } from "./detectorAssets";
import { cameraErrorMessage, untilAborted } from "./poseTracking";
import type { PoseFrame, TrackingStatus } from "./poseTracking";
import type { PoseTrackingWorker } from "./poseTracking.worker";
import {
  DEFAULT_POSE_SETTINGS,
  detectorSettingsKey,
  normalizePoseSettings,
} from "./poseSettings";
import type {
  Delegate,
  PoseTrackingSettings,
  PoseTrackingStats,
} from "./poseSettings";

interface DetectorSession {
  controller: AbortController;
  worker: Worker;
  api: Comlink.Remote<PoseTrackingWorker>;
  settings: PoseTrackingSettings;
  busy: boolean;
  delegate: Delegate | null;
  handDelegate: Delegate | null;
}

interface TrackingSession {
  controller: AbortController;
  detector: DetectorSession | null;
  pendingDetector: DetectorSession | null;
  configure: ((immediate?: boolean) => void) | null;
  configureTimer: ReturnType<typeof setTimeout> | null;
  switching: boolean;
  stream: MediaStream | null;
  video: HTMLVideoElement | null;
  videoGeneration: number;
  bindVideo: ((video: HTMLVideoElement | null) => void) | null;
  videoCallback: number | null;
  animationCallback: number | null;
  frameGeneration: number;
  inferenceGeneration: number;
  lastVideoTime: number;
  visibilityListener: (() => void) | null;
}

function cancelFrame(session: TrackingSession) {
  session.frameGeneration++;
  if (session.videoCallback !== null)
    session.video?.cancelVideoFrameCallback?.(session.videoCallback);
  if (session.animationCallback !== null)
    cancelAnimationFrame(session.animationCallback);
  session.videoCallback = null;
  session.animationCallback = null;
}

function disposeDetector(detector: DetectorSession | null) {
  if (!detector) return;
  detector.controller.abort();
  detector.api[Comlink.releaseProxy]();
  detector.worker.terminate();
}

export default function usePoseTracking() {
  const [status, setStatus] = useState<TrackingStatus>("idle");
  const statusRef = useRef<TrackingStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState(DEFAULT_POSE_SETTINGS);
  const settingsRef = useRef(settings);
  const [switching, setSwitching] = useState(false);
  const [stats, setStats] = useState<PoseTrackingStats | null>(null);
  const sessionRef = useRef<TrackingSession | null>(null);
  const videoElement = useRef<HTMLVideoElement | null>(null);
  const latestPose = useRef<PoseFrame | null>(null);

  const updateStatus = useCallback((next: TrackingStatus) => {
    if (statusRef.current !== next) {
      statusRef.current = next;
      setStatus(next);
    }
  }, []);

  const updateSettings = useCallback((patch: Partial<PoseTrackingSettings>) => {
    const previous = settingsRef.current;
    const next = normalizePoseSettings({ ...previous, ...patch });
    settingsRef.current = next;
    setSettings(next);
    if (detectorSettingsKey(previous) !== detectorSettingsKey(next)) {
      sessionRef.current?.configure?.();
    }
  }, []);
  const resetSettings = useCallback(
    () => updateSettings(DEFAULT_POSE_SETTINGS),
    [updateSettings],
  );

  const videoRef = useCallback((video: HTMLVideoElement | null) => {
    videoElement.current = video;
    const bindVideo = sessionRef.current?.bindVideo;
    if (bindVideo) bindVideo(video);
    else if (video) video.srcObject = null;
  }, []);

  const dispose = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    latestPose.current = null;
    setStats(null);
    setSwitching(false);
    if (!session) return;
    session.controller.abort();
    cancelFrame(session);
    const video = session.video;
    session.video = null;
    session.videoGeneration++;
    session.bindVideo = null;
    if (session.visibilityListener) {
      document.removeEventListener(
        "visibilitychange",
        session.visibilityListener,
      );
    }
    session.stream?.getTracks().forEach((track) => track.stop());
    if (video?.srcObject === session.stream) video.srcObject = null;
    if (session.configureTimer !== null) clearTimeout(session.configureTimer);
    session.configure = null;
    disposeDetector(session.pendingDetector);
    disposeDetector(session.detector);
  }, []);

  const stop = useCallback(() => {
    dispose();
    setError(null);
    updateStatus("idle");
  }, [dispose, updateStatus]);

  useEffect(() => dispose, [dispose]);

  const start = useCallback(async () => {
    if (sessionRef.current) return false;
    setError(null);
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof Worker === "undefined" ||
      typeof OffscreenCanvas === "undefined" ||
      typeof createImageBitmap === "undefined"
    ) {
      setError(
        "Motion capture needs a camera and a current browser on HTTPS or localhost.",
      );
      updateStatus("error");
      return false;
    }

    updateStatus("loading");
    let session: TrackingSession | null = null;
    try {
      session = {
        controller: new AbortController(),
        detector: null,
        pendingDetector: null,
        configure: null,
        configureTimer: null,
        switching: false,
        stream: null,
        video: null,
        videoGeneration: 0,
        bindVideo: null,
        videoCallback: null,
        animationCallback: null,
        frameGeneration: 0,
        inferenceGeneration: 0,
        lastVideoTime: -1,
        visibilityListener: null,
      };
      sessionRef.current = session;
      const current = session;
      const signal = current.controller.signal;
      const fail = (message: string) => {
        if (sessionRef.current !== current) return;
        dispose();
        setError(message);
        updateStatus("error");
      };
      let detectorReady!: () => void;
      const firstDetector = new Promise<void>((resolve) => {
        detectorReady = resolve;
      });
      let metrics = { since: performance.now(), frames: 0, duration: 0 };
      const settledStatus = () => {
        if (current.stream) updateStatus(document.hidden ? "paused" : "lost");
      };
      current.configure = (immediate = false) => {
        if (signal.aborted) return;
        if (current.configureTimer !== null)
          clearTimeout(current.configureTimer);
        current.configureTimer = null;
        disposeDetector(current.pendingDetector);
        current.pendingDetector = null;
        current.inferenceGeneration++;
        current.switching = true;
        setSwitching(true);
        latestPose.current = null;
        setStats(null);
        setError(null);
        if (!document.hidden) updateStatus("loading");
        const configure = async () => {
          current.configureTimer = null;
          if (signal.aborted) return;
          const requested = settingsRef.current;
          let candidate: DetectorSession | null = null;
          try {
            const worker = new Worker(
              new URL("./poseTracking.worker.ts", import.meta.url),
            );
            candidate = {
              worker,
              api: Comlink.wrap<PoseTrackingWorker>(worker),
              controller: new AbortController(),
              settings: requested,
              busy: false,
              delegate: null,
              handDelegate: null,
            };
            current.pendingDetector = candidate;
            const initializing = candidate;
            const workerFailure = new Promise<never>((_, reject) => {
              worker.addEventListener("error", () => {
                if (current.detector === initializing) {
                  fail(
                    "Motion tracking stopped unexpectedly. Try starting it again.",
                  );
                } else reject(new Error("Could not load the motion tracker."));
              });
            });
            const result = await untilAborted(
              Promise.race([
                candidate.api.initialize(
                  detectorAssets(BASE_PATH, requested.model),
                  requested,
                ),
                workerFailure,
              ]),
              candidate.controller.signal,
            );
            if (signal.aborted || current.pendingDetector !== candidate) return;
            candidate.delegate = result?.delegate ?? null;
            candidate.handDelegate = result?.handDelegate ?? null;
            setError(result?.handWarning ?? null);
            disposeDetector(current.detector);
            current.detector = candidate;
            current.pendingDetector = null;
            current.switching = false;
            current.lastVideoTime = -1;
            metrics = { since: performance.now(), frames: 0, duration: 0 };
            setSwitching(false);
            settledStatus();
            detectorReady();
          } catch (cause) {
            if (
              signal.aborted ||
              (candidate && current.pendingDetector !== candidate)
            )
              return;
            disposeDetector(candidate);
            current.pendingDetector = null;
            current.switching = false;
            setSwitching(false);
            if (current.detector) {
              // Keep the working detector and camera if the new settings cannot load.
              const restored = {
                ...current.detector.settings,
                smoothing: settingsRef.current.smoothing,
              };
              settingsRef.current = restored;
              setSettings(restored);
              setError(
                "Could not switch the motion tracker. The previous settings are still active.",
              );
              settledStatus();
            } else {
              fail(cameraErrorMessage(cause));
            }
          }
        };
        if (immediate) void configure();
        else current.configureTimer = setTimeout(() => void configure(), 150);
      };
      current.configure(true);
      await untilAborted(firstDetector, signal);
      signal.throwIfAborted();
      updateStatus("requesting");
      const camera = navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
      void camera.then(
        (stream) => {
          if (signal.aborted)
            stream.getTracks().forEach((track) => track.stop());
        },
        () => {},
      );
      current.stream = await untilAborted(camera, signal);
      signal.throwIfAborted();
      current.stream.getVideoTracks().forEach((track) => {
        track.addEventListener("ended", () =>
          fail("The camera disconnected. Reconnect it and try again."),
        );
      });
      let playbackStarted!: () => void;
      const firstPlayback = new Promise<void>((resolve) => {
        playbackStarted = resolve;
      });
      const isCurrentVideo = (video: HTMLVideoElement, generation: number) =>
        !signal.aborted &&
        current.video === video &&
        current.videoGeneration === generation;
      const schedule = () => {
        const video = current.video;
        if (
          signal.aborted ||
          document.hidden ||
          !video ||
          current.videoCallback !== null ||
          current.animationCallback !== null
        )
          return;
        const generation = current.videoGeneration;
        const frameGeneration = ++current.frameGeneration;
        const callback = (timestamp: number) => {
          if (current.frameGeneration !== frameGeneration) return;
          return frame(timestamp, video, generation);
        };
        if (video.requestVideoFrameCallback) {
          current.videoCallback = video.requestVideoFrameCallback(callback);
        } else {
          current.animationCallback = requestAnimationFrame(callback);
        }
      };
      const frame = async (
        timestamp: number,
        video: HTMLVideoElement,
        generation: number,
      ) => {
        // A cancelled callback from a detached video must not clear or create
        // callbacks belonging to the replacement video.
        if (!isCurrentVideo(video, generation)) return;
        current.videoCallback = null;
        current.animationCallback = null;
        if (document.hidden) return;
        schedule();
        const detector = current.detector;
        if (
          current.switching ||
          !detector ||
          detector.busy ||
          video.readyState < 2 ||
          video.currentTime === current.lastVideoTime
        )
          return;
        current.lastVideoTime = video.currentTime;
        detector.busy = true;
        const startedAt = performance.now();
        const inferenceGeneration = current.inferenceGeneration;
        const isCurrentDetector = () =>
          isCurrentVideo(video, generation) &&
          current.inferenceGeneration === inferenceGeneration &&
          !current.switching &&
          current.detector === detector &&
          !document.hidden;
        let bitmap: ImageBitmap | null = null;
        try {
          bitmap = await createImageBitmap(video);
          if (!isCurrentDetector()) return;
          const result = await untilAborted(
            detector.api.detect(Comlink.transfer(bitmap, [bitmap]), timestamp),
            detector.controller.signal,
          );
          if (!isCurrentDetector()) return;
          if (result) result.receivedAt = performance.now();
          latestPose.current = result;
          metrics.frames++;
          metrics.duration += performance.now() - startedAt;
          const elapsed = performance.now() - metrics.since;
          if (elapsed >= 500) {
            setStats({
              fps: (metrics.frames * 1000) / elapsed,
              frameMs: metrics.duration / metrics.frames,
              delegate: detector.delegate,
              handDelegate: detector.handDelegate,
              width: video.videoWidth,
              height: video.videoHeight,
            });
            metrics = { since: performance.now(), frames: 0, duration: 0 };
          }
          updateStatus(result ? "tracking" : "lost");
        } catch {
          if (isCurrentDetector()) {
            fail(
              "Motion tracking stopped unexpectedly. Try starting it again.",
            );
          }
        } finally {
          bitmap?.close();
          detector.busy = false;
        }
      };
      current.visibilityListener = () => {
        current.inferenceGeneration++;
        latestPose.current = null;
        metrics = { since: performance.now(), frames: 0, duration: 0 };
        setStats(null);
        current.stream?.getVideoTracks().forEach((track) => {
          track.enabled = !document.hidden;
        });
        if (document.hidden) {
          cancelFrame(current);
          updateStatus("paused");
        } else {
          updateStatus(current.switching ? "loading" : "lost");
          schedule();
        }
      };
      current.bindVideo = (video) => {
        if (current.video === video || signal.aborted) return;
        cancelFrame(current);
        if (current.video?.srcObject === current.stream)
          current.video.srcObject = null;
        current.video = video;
        const generation = ++current.videoGeneration;
        current.lastVideoTime = -1;
        latestPose.current = null;
        if (!video) return;
        video.srcObject = current.stream;
        current.visibilityListener?.();
        const playbackFailed = (cause: unknown) => {
          if (isCurrentVideo(video, generation))
            fail(cameraErrorMessage(cause));
        };
        try {
          // A replacement can play while the old play() is still pending.
          // Its eventual rejection or inference result belongs to the old
          // generation and must not stop this camera session.
          void Promise.resolve(video.play()).then(() => {
            if (isCurrentVideo(video, generation)) playbackStarted();
          }, playbackFailed);
        } catch (cause) {
          playbackFailed(cause);
        }
      };
      document.addEventListener("visibilitychange", current.visibilityListener);
      current.visibilityListener();
      current.bindVideo(videoElement.current);
      // Playback can wait while a tab is hidden. Start observing visibility
      // first so the camera is paused even before the first frame can play.
      await untilAborted(firstPlayback, signal);
      signal.throwIfAborted();
      return true;
    } catch (cause) {
      if (session && sessionRef.current !== session) return false;
      dispose();
      setError(cameraErrorMessage(cause));
      updateStatus("error");
      return false;
    }
  }, [dispose, updateStatus]);

  return {
    videoRef,
    latestPose,
    status,
    error,
    start,
    stop,
    settings,
    updateSettings,
    resetSettings,
    switching,
    stats,
  };
}

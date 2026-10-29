import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Object3D } from "three";
import { canvasBlob } from "../modelImage";
import useWarrior from "../useWarrior";
import type Viewer from "../Viewer";
import { canFrame } from "./cameraFraming";
import {
  untilAborted,
  type PoseLandmark,
  type TrackingStatus,
} from "./poseTracking";
import {
  createTake,
  MAX_RECORDING_SECONDS,
  readPose,
  type FramingInput,
  type Recording,
  type RecordingData,
  type Take,
} from "./recording";
import { loadMapPictures } from "./mapBackgrounds";
import {
  fallbackStripArt,
  loadStripArt,
  renderBoothStrip,
  type StripArt,
  type StripCaption,
} from "./photos";

/** Every countdown: before a recording and before each photo booth shot. */
export const COUNTDOWN_SECONDS = 3;
/** How many photos the booth takes. */
export const BOOTH_SHOTS = 3;
/** The pause after each shot before the next countdown starts. */
const SHOT_HOLD_SECONDS = 1;
/** How long a finished booth waits for the strip's fonts, logo and
 * background, which started loading with the first countdown, before drawing
 * with fallbacks. */
const STRIP_ART_WAIT_SECONDS = 3;

/** endsAt and startedAt are performance.now() times. `taken` counts the photos
 * taken so far. */
export type RecorderActivity =
  | { phase: "record-countdown"; endsAt: number }
  | { phase: "recording"; startedAt: number }
  | { phase: "booth-countdown"; taken: number; endsAt: number }
  | { phase: "booth-hold"; taken: number }
  | { phase: "developing"; taken: number };

/** The loaded model, registered by MocapPose while mocap is active. */
interface RecorderStage {
  viewer: Pick<Viewer, "captureFrame">;
  nodes: readonly Object3D[];
}

export interface PlaybackState {
  time: number;
  paused: boolean;
}

/** Set when the photo booth starts, so a skin change can't rename it halfway. */
export interface BoothNames {
  caption: StripCaption;
  fileName: string;
  alt: string;
}

export interface PhotoStrip {
  blob: Blob;
  width: number;
  height: number;
  fileName: string;
  alt: string;
  /** What the strip was drawn from, so it can be drawn again over another
   * background. */
  frames: readonly HTMLCanvasElement[];
  caption: StripCaption;
  art: StripArt;
  /** The map whose screenshots `blob` was drawn over, or null for the
   * gradient. */
  background: string | null;
}

type StopReason = "user" | "limit" | "interrupted";

// Kept outside React so recordings survive leaving and returning to the
// editor. They last until the page reloads.
const library = {
  entries: [] as readonly Recording[],
  counts: new Map<string, Record<Recording["kind"], number>>(),
  nextId: 1,
};

function delay(seconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, seconds * 1000);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

const LATE = Symbol("late");

/** `promise`'s value, or `fallback()` if it takes longer than `seconds`: a
 * stalled download shouldn't hold up the strip. Rejects when `signal`
 * aborts. */
async function within<T>(
  promise: Promise<T>,
  seconds: number,
  signal: AbortSignal,
  fallback: () => T,
) {
  // Ends the wait when the promise wins the race, as well as on abort.
  const waiting = new AbortController();
  const abort = () => waiting.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  try {
    const value = await Promise.race([
      promise,
      delay(seconds, waiting.signal).then((): typeof LATE => LATE),
    ]);
    return value === LATE ? fallback() : value;
  } finally {
    signal.removeEventListener("abort", abort);
    waiting.abort();
  }
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Records motion from the live rig, runs the photo booth, and holds the
 * recording or pose being played back. Lives in the always-mounted Controller;
 * per-frame state stays in refs so the editor doesn't re-render every frame. */
export default function useRecorder(status: TrackingStatus) {
  const { actualModel } = useWarrior();
  const [entries, setEntries] = useState(() => library.entries);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [paused, setPausedState] = useState(false);
  const [activity, setActivity] = useState<RecorderActivity | null>(null);
  const [attached, setAttached] = useState(false);
  const [strip, setStrip] = useState<PhotoStrip | null>(null);
  // Kept here, not in the controls, so a remounted camera panel still shows it.
  const [failure, setFailure] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<{
    id: number;
    text: string;
  } | null>(null);
  const playbackRef = useRef<PlaybackState>({ time: 0, paused: false });
  const stageRef = useRef<RecorderStage | null>(null);
  // The latest landmarks framing could measure. The viewer keeps the framing
  // they gave until it can measure newer ones.
  const framingRef = useRef<FramingInput>({ landmarks: [] });
  const takeRef = useRef<Take | null>(null);
  const jobRef = useRef<{
    controller: AbortController;
    kind: "record" | "booth";
  } | null>(null);

  const recordings = useMemo(
    () => entries.filter((entry) => entry.model === actualModel).reverse(),
    [entries, actualModel],
  );
  const selected = recordings.find((entry) => entry.id === selectedId) ?? null;

  const announce = useCallback((text: string) => {
    setAnnouncement((previous) => ({ id: (previous?.id ?? 0) + 1, text }));
  }, []);

  const add = useCallback((data: RecordingData) => {
    const counts = library.counts.get(data.model) ?? { recording: 0, pose: 0 };
    library.counts.set(data.model, counts);
    counts[data.kind]++;
    const entry: Recording = {
      ...data,
      id: library.nextId++,
      label: `${data.kind === "pose" ? "Pose" : "Animation"} ${counts[data.kind]}`,
    };
    library.entries = [...library.entries, entry];
    setEntries(library.entries);
    return entry;
  }, []);

  const select = useCallback((id: number | null) => {
    playbackRef.current = { time: 0, paused: false };
    setPausedState(false);
    setSelectedId(id);
  }, []);

  const setPaused = useCallback((value: boolean) => {
    playbackRef.current.paused = value;
    setPausedState(value);
  }, []);

  /** Scrubbing pauses playback, so the chosen moment stays on screen. */
  const seek = useCallback((seconds: number) => {
    playbackRef.current.time = Math.max(0, seconds);
    playbackRef.current.paused = true;
    setPausedState(true);
  }, []);

  const end = useCallback(
    (reason: StopReason) => {
      const job = jobRef.current;
      const take = takeRef.current;
      if (!job && !take) return;
      jobRef.current = null;
      takeRef.current = null;
      job?.controller.abort();
      setActivity(null);
      if (job) {
        announce(
          job.kind === "booth"
            ? "Photo booth canceled."
            : "Recording canceled.",
        );
        return;
      }
      const data = take!.finish();
      if (!data) {
        announce("The animation was too short to keep.");
        return;
      }
      const entry = add(data);
      if (reason === "interrupted") {
        announce(`Recording stopped. ${entry.label} saved.`);
        return;
      }
      select(entry.id);
      announce(
        reason === "limit"
          ? `Recording stopped at the ${MAX_RECORDING_SECONDS}-second limit. ${entry.label} saved. Playing it now.`
          : `${entry.label} saved, ${plural(Math.max(1, Math.round(data.duration)), "second")}. Playing it now.`,
      );
    },
    [add, announce, select],
  );

  const stop = useCallback(() => end("user"), [end]);

  /** Called by MocapPose once the hand fallback has finished the bones, so
   * the key matches the pose this frame draws. */
  const sampleFrame = useCallback(
    (
      deltaSeconds: number,
      landmarks: readonly PoseLandmark[],
      imageWidth?: number,
      imageHeight?: number,
    ) => {
      if (landmarks !== framingRef.current.landmarks && canFrame(landmarks)) {
        framingRef.current = { landmarks, imageWidth, imageHeight };
      }
      const take = takeRef.current;
      if (take && !take.add(deltaSeconds, landmarks, imageWidth, imageHeight))
        end("limit");
    },
    [end],
  );

  const attach = useCallback(
    (stage: RecorderStage) => {
      stageRef.current = stage;
      setAttached(true);
      return () => {
        if (stageRef.current !== stage) return;
        stageRef.current = null;
        framingRef.current = { landmarks: [] };
        setAttached(false);
        end("interrupted");
        // Stopping the camera or loading another model returns to the live camera.
        select(null);
      };
    },
    [end, select],
  );

  const record = useCallback(async () => {
    if (jobRef.current || takeRef.current || !stageRef.current) return;
    const controller = new AbortController();
    jobRef.current = { controller, kind: "record" };
    select(null);
    setActivity({
      phase: "record-countdown",
      endsAt: performance.now() + COUNTDOWN_SECONDS * 1000,
    });
    announce(`Recording starts in ${plural(COUNTDOWN_SECONDS, "second")}.`);
    try {
      await delay(COUNTDOWN_SECONDS, controller.signal);
    } catch {
      return; // Canceled; end() already reset everything.
    }
    const stage = stageRef.current;
    if (!stage) {
      end("interrupted");
      return;
    }
    jobRef.current = null;
    takeRef.current = createTake(stage.nodes, actualModel, framingRef.current);
    setActivity({ phase: "recording", startedAt: performance.now() });
    announce("Recording.");
  }, [actualModel, announce, end, select]);

  /** Sets `failure` if a shot or the strip fails. */
  const startBooth = useCallback(
    async (names: BoothNames, background: string | null = null) => {
      if (jobRef.current || takeRef.current || !stageRef.current) return;
      const controller = new AbortController();
      const { signal } = controller;
      const shots = BOOTH_SHOTS;
      jobRef.current = { controller, kind: "booth" };
      select(null);
      setFailure(null);
      // The strip's fonts, logo and background load during the countdowns.
      const art = loadStripArt();
      const backdrop = background
        ? loadMapPictures(background, shots)
        : Promise.resolve<HTMLImageElement[]>([]);
      const frames: HTMLCanvasElement[] = [];
      try {
        for (let index = 0; index < shots; index++) {
          setActivity({
            phase: "booth-countdown",
            taken: index,
            endsAt: performance.now() + COUNTDOWN_SECONDS * 1000,
          });
          if (index === 0)
            announce(
              `Photo booth: first photo in ${plural(COUNTDOWN_SECONDS, "second")}.`,
            );
          await delay(COUNTDOWN_SECONDS, signal);
          const stage = stageRef.current;
          if (!stage) throw new Error("The model is not loaded.");
          const frame = await untilAborted(
            stage.viewer.captureFrame({ cameraArea: true }),
            signal,
          );
          // Read the pose before awaiting anything else. This runs in the
          // microtasks right after the frame that drew `frame`, before another
          // frame can move a bone.
          add(readPose(stage.nodes, actualModel, framingRef.current));
          frames.push(frame);
          const taken = index + 1;
          if (taken < shots) {
            setActivity({ phase: "booth-hold", taken });
            const next = SHOT_HOLD_SECONDS + COUNTDOWN_SECONDS;
            announce(
              `Photo ${taken} of ${shots} taken. Next photo in ${plural(next, "second")}.`,
            );
            await delay(SHOT_HOLD_SECONDS, signal);
          } else {
            setActivity({ phase: "developing", taken });
            announce(
              `Photo ${taken} of ${shots} taken. Developing the photo strip.`,
            );
          }
        }
        const [stripArt, pictures] = await Promise.all([
          within(art, STRIP_ART_WAIT_SECONDS, signal, fallbackStripArt),
          within(backdrop, STRIP_ART_WAIT_SECONDS, signal, () => []),
        ]);
        const canvas = renderBoothStrip(
          frames,
          names.caption,
          stripArt,
          pictures,
        );
        const blob = await untilAborted(canvasBlob(canvas), signal);
        setStrip({
          blob,
          width: canvas.width,
          height: canvas.height,
          fileName: names.fileName,
          alt: names.alt,
          frames,
          caption: names.caption,
          art: stripArt,
          background: pictures.length ? background : null,
        });
      } catch {
        if (!signal.aborted)
          setFailure("The photo booth could not finish. Try again.");
      } finally {
        if (jobRef.current?.controller === controller) {
          jobRef.current = null;
          setActivity(null);
        }
      }
    },
    [actualModel, add, announce, select],
  );

  const dismissStrip = useCallback(() => setStrip(null), []);
  const dismissFailure = useCallback(() => setFailure(null), []);

  // A hidden tab, a stopped camera or a failure ends a recording and cancels
  // countdowns. Losing sight of the performer doesn't: walking back to the
  // computer is part of the recording.
  useEffect(() => {
    if (status === "paused" || status === "idle" || status === "error")
      end("interrupted");
  }, [status, end]);
  // A recording in progress still reaches the library on unmount.
  useEffect(() => () => end("interrupted"), [end]);

  return useMemo(
    () => ({
      /** This model's recordings and poses, newest first. */
      recordings,
      selected,
      paused,
      activity,
      /** Whether a loaded rig is registered. */
      attached,
      strip,
      /** Why the last photo booth stopped early, if it failed. */
      failure,
      /** The latest message for the live region. `id` changes even when the
       * text repeats. */
      announcement,
      playbackRef,
      record,
      startBooth,
      stop,
      select,
      setPaused,
      seek,
      dismissStrip,
      dismissFailure,
      attach,
      sampleFrame,
    }),
    [
      recordings,
      selected,
      paused,
      activity,
      attached,
      strip,
      failure,
      announcement,
      record,
      startBooth,
      stop,
      select,
      setPaused,
      seek,
      dismissStrip,
      dismissFailure,
      attach,
      sampleFrame,
    ],
  );
}

export type Recorder = ReturnType<typeof useRecorder>;

import { Quaternion, type Object3D } from "three";
import {
  canFrame,
  framingLandmarkIndices,
  isFramingVisible,
} from "./cameraFraming";
import type { PoseLandmark } from "./poseTracking";

export const MAX_RECORDING_SECONDS = 60;
/** At most one key per 1/80 s keeps every frame of a 60 Hz display, even
 * with uneven frame times, and thins out faster displays. */
export const MIN_KEY_INTERVAL = 1 / 80;
const MAX_KEYS = Math.ceil(MAX_RECORDING_SECONDS / MIN_KEY_INTERVAL) + 1;

/** What the viewer's pose framing was given for a frame. */
export interface FramingInput {
  landmarks: readonly PoseLandmark[];
  imageWidth?: number;
  imageHeight?: number;
}

/** Bone rotations captured from live mocap. A pose has a single key. */
export interface RecordingData {
  kind: "recording" | "pose";
  /** The actualModel it was captured on. Rest rotations differ between models. */
  model: string;
  /** Bip01 node names, parents first. */
  nodes: readonly string[];
  /** Seconds from the first key. */
  times: Float32Array;
  /** x, y, z, w per node per key. */
  rotations: Float32Array;
  /** Mirrored image x, y per framingLandmarkIndices entry per key, or NaN
   * where that landmark was hidden. Playback frames the camera with these. */
  framing: Float32Array;
  imageWidth?: number;
  imageHeight?: number;
  /** The time of the last key, so 0 for a pose. */
  duration: number;
}

export interface Recording extends RecordingData {
  id: number;
  /** Like "Animation 2" or "Pose 4". */
  label: string;
}

export interface Take {
  /** Adds a key with the nodes' current rotations and this frame's framing
   * input. Returns false once the take is full. */
  add(
    deltaSeconds: number,
    landmarks: readonly PoseLandmark[],
    imageWidth?: number,
    imageHeight?: number,
  ): boolean;
  /** The keys so far, or null with fewer than two. */
  finish(): RecordingData | null;
}

const FRAMING_STRIDE = framingLandmarkIndices.length * 2;

function validSize(width?: number, height?: number) {
  return (
    !!width &&
    !!height &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  );
}

function writeRotations(
  nodes: readonly Object3D[],
  target: Float32Array,
  offset: number,
) {
  for (let i = 0; i < nodes.length; i++)
    nodes[i].quaternion.toArray(target, offset + i * 4);
}

function writeFraming(
  landmarks: readonly PoseLandmark[],
  target: Float32Array,
  offset: number,
) {
  for (let i = 0; i < framingLandmarkIndices.length; i++) {
    const point = landmarks[framingLandmarkIndices[i]];
    const visible = isFramingVisible(point);
    target[offset + i * 2] = visible ? point.x : NaN;
    target[offset + i * 2 + 1] = visible ? point.y : NaN;
  }
}

/** Records keys for `nodes` on the render clock. `seed` frames the first key
 * when framing can't measure the live input, since the viewer is still
 * holding the framing from `seed`. */
export function createTake(
  nodes: readonly Object3D[],
  model: string,
  seed: FramingInput,
): Take {
  const stride = nodes.length * 4;
  const times = new Float32Array(MAX_KEYS);
  const rotations = new Float32Array(MAX_KEYS * stride);
  const framing = new Float32Array(MAX_KEYS * FRAMING_STRIDE);
  let count = 0;
  let elapsed = 0;
  let lastKey = 0;
  let imageWidth: number | undefined;
  let imageHeight: number | undefined;

  return {
    add(deltaSeconds, landmarks, width, height) {
      if (count) {
        // A frame without elapsed time can't have moved anything.
        if (!(deltaSeconds > 0)) return true;
        elapsed += deltaSeconds;
        if (elapsed > MAX_RECORDING_SECONDS || count === MAX_KEYS) return false;
        if (elapsed - lastKey < MIN_KEY_INTERVAL) return true;
      }
      const input =
        !count && !canFrame(landmarks)
          ? seed
          : { landmarks, imageWidth: width, imageHeight: height };
      times[count] = lastKey = elapsed;
      writeRotations(nodes, rotations, count * stride);
      writeFraming(input.landmarks, framing, count * FRAMING_STRIDE);
      if (
        imageWidth === undefined &&
        validSize(input.imageWidth, input.imageHeight)
      ) {
        imageWidth = input.imageWidth;
        imageHeight = input.imageHeight;
      }
      count++;
      return true;
    },
    finish() {
      if (count < 2) return null;
      return {
        kind: "recording",
        model,
        nodes: nodes.map((node) => node.name),
        times: times.slice(0, count),
        rotations: rotations.slice(0, count * stride),
        framing: framing.slice(0, count * FRAMING_STRIDE),
        imageWidth,
        imageHeight,
        duration: times[count - 1],
      };
    },
  };
}

/** A single key with the nodes' current rotations. */
export function readPose(
  nodes: readonly Object3D[],
  model: string,
  input: FramingInput,
): RecordingData {
  const rotations = new Float32Array(nodes.length * 4);
  const framing = new Float32Array(FRAMING_STRIDE);
  writeRotations(nodes, rotations, 0);
  writeFraming(input.landmarks, framing, 0);
  const sized = validSize(input.imageWidth, input.imageHeight);
  return {
    kind: "pose",
    model,
    nodes: nodes.map((node) => node.name),
    times: new Float32Array(1),
    rotations,
    framing,
    imageWidth: sized ? input.imageWidth : undefined,
    imageHeight: sized ? input.imageHeight : undefined,
    duration: 0,
  };
}

/** The last key at or before `time`. */
function keyAt(times: Float32Array, time: number) {
  let low = 0;
  let high = times.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (times[middle] <= time) low = middle;
    else high = middle - 1;
  }
  return low;
}

const from = new Quaternion();
const to = new Quaternion();

/** Poses `nodes`, which line up with `recording.nodes`, at `time` and returns
 * the key it used. Missing nodes are skipped. */
export function applyRecording(
  recording: RecordingData,
  nodes: readonly (Object3D | undefined)[],
  time: number,
) {
  const { times, rotations } = recording;
  const key = keyAt(times, time);
  const next = Math.min(key + 1, times.length - 1);
  const span = times[next] - times[key];
  const alpha =
    span > 0 ? Math.min(Math.max((time - times[key]) / span, 0), 1) : 0;
  const stride = recording.nodes.length * 4;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node) continue;
    from.fromArray(rotations, key * stride + i * 4);
    to.fromArray(rotations, next * stride + i * 4);
    node.quaternion.slerpQuaternions(from, to, alpha).normalize();
  }
  return key;
}

/** The framing input recorded with `key`, as sparse image landmarks. Empty
 * when no landmark was visible. */
export function framingAt(
  recording: RecordingData,
  key: number,
): PoseLandmark[] {
  const points: PoseLandmark[] = [];
  const offset = key * FRAMING_STRIDE;
  for (let i = 0; i < framingLandmarkIndices.length; i++) {
    const x = recording.framing[offset + i * 2];
    const y = recording.framing[offset + i * 2 + 1];
    if (Number.isFinite(x) && Number.isFinite(y))
      points[framingLandmarkIndices[i]] = { x, y, z: 0 };
  }
  return points;
}

/** For each key, the last key at or before it with landmarks framing can
 * measure, or -1. After a seek, playback frames the camera from that key:
 * it's the framing live mocap would still be holding. */
export function framableKeys(recording: RecordingData) {
  const keys = new Int32Array(recording.times.length);
  let last = -1;
  for (let key = 0; key < keys.length; key++) {
    if (canFrame(framingAt(recording, key))) last = key;
    keys[key] = last;
  }
  return keys;
}

/** Like "0:12", or "0:04.2" with tenths. Rounds down. */
export function formatTime(seconds: number, tenths = false) {
  // The small offset keeps Float32 times like 4.1999998 at 4.2.
  const units = Math.floor(Math.max(0, seconds) * (tenths ? 10 : 1) + 1e-4);
  const whole = tenths ? Math.floor(units / 10) : units;
  const text = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  return tenths ? `${text}.${units % 10}` : text;
}

import {
  AdditiveAnimationBlendMode,
  AnimationClip,
  KeyframeTrack,
  Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { disposeObject } from "./Viewer";
import modelConfig from "./models";

/** The arm animation `clip` held at level aim, its middle, as a change to
 * the pose of `root`, whose nodes are at rest. Played on top of another
 * animation, it moves each node by as much as the game's arm animation would,
 * so it works like the game's arm thread blending over the body's. */
export function armPoseClip(clip: AnimationClip, root: Object3D) {
  const time = clip.duration / 2;
  const tracks = clip.tracks.flatMap((track): KeyframeTrack[] => {
    const dot = track.name.lastIndexOf(".");
    const node = root.getObjectByName(track.name.slice(0, dot));
    if (!node) return [];
    const property = track.name.slice(dot + 1);
    const value = track.createInterpolant().evaluate(time);
    if (property === "quaternion") {
      const change = node.quaternion
        .clone()
        .invert()
        .multiply(new Quaternion().fromArray(value));
      return [new QuaternionKeyframeTrack(track.name, [0], change.toArray())];
    }
    if (property === "position" || property === "scale") {
      const change = new Vector3().fromArray(value).sub(node[property]);
      return [new VectorKeyframeTrack(track.name, [0], change.toArray())];
    }
    return [];
  });
  return new AnimationClip(clip.name, 0, tracks, AdditiveAnimationBlendMode);
}

// Every arm animation a weapon is held with.
const armThreads = new Set([
  ...Object.values(modelConfig.armThreads),
  ...Object.values(modelConfig.armThreadOverrides).flatMap((names) =>
    Object.values(names),
  ),
]);
const armPoses = new Map<string, Promise<Map<string, AnimationClip>>>();

/** The arm poses of the animated model at `url`, by animation name. Each
 * model is loaded once. */
export function loadArmPoses(url: string) {
  let poses = armPoses.get(url);
  if (!poses) {
    poses = new GLTFLoader().loadAsync(url).then((gltf) => {
      try {
        return new Map(
          gltf.animations
            .filter((clip) => armThreads.has(clip.name))
            .map((clip) => [clip.name, armPoseClip(clip, gltf.scene)]),
        );
      } finally {
        disposeObject(gltf.scene);
      }
    });
    armPoses.set(url, poses);
    // A failed load can be tried again.
    poses.catch(() => armPoses.delete(url));
  }
  return poses;
}

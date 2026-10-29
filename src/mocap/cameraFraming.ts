import {
  Box3,
  Matrix4,
  Object3D,
  PerspectiveCamera,
  SkinnedMesh,
  Vector2,
  Vector3,
} from "three";
import type { PoseLandmark } from "./poseTracking";
import { isVisibleInImage } from "./landmarks";

/** A uniform transform of the base camera's normalized device coordinates. */
interface CameraFramingTransform {
  scale: number;
  x: number;
  y: number;
}

interface Reference {
  node: Object3D;
  point: Vector3;
}

interface Correspondence {
  model: Vector2;
  image: Vector2;
}

const torsoBones = [
  [11, "L_UpperArm"],
  [12, "R_UpperArm"],
  [23, "L_Thigh"],
  [24, "R_Thigh"],
] as const;
const faceIndices = [0, 2, 5, 7, 8, 9, 10] as const;

/** The image landmarks framing uses: face points, then shoulders and hips. */
export const framingLandmarkIndices: readonly number[] = [
  ...faceIndices,
  ...torsoBones.map(([index]) => index),
];

export const isFramingVisible = isVisibleInImage;

/** Whether framing can measure these landmarks: it needs two visible torso
 * points or two visible face points. Otherwise it holds its last framing. */
export function canFrame(landmarks: readonly PoseLandmark[]) {
  const visible = (indices: readonly number[]) =>
    indices.filter((index) => isFramingVisible(landmarks[index])).length;
  return (
    visible(torsoBones.map(([index]) => index)) >= 2 ||
    visible(faceIndices) >= 2
  );
}

/** Find the actual head silhouette, rather than the game's Eye attachment:
 * that attachment is a first-person camera position and varies between rigs. */
function headBounds(root: Object3D, head: Object3D) {
  const box = new Box3();
  const point = new Vector3();
  root.traverse((mesh) => {
    if (!(mesh instanceof SkinnedMesh)) return;
    const indices = mesh.geometry.attributes.skinIndex;
    const weights = mesh.geometry.attributes.skinWeight;
    if (!indices || !weights) return;
    const headJoints = new Set<number>();
    mesh.skeleton.bones.forEach((bone, index) => {
      for (
        let ancestor: Object3D | null = bone;
        ancestor;
        ancestor = ancestor.parent
      ) {
        if (ancestor === head) {
          headJoints.add(index);
          break;
        }
      }
    });
    if (!headJoints.size) return;
    for (let index = 0; index < indices.count; index++) {
      let influence = 0;
      for (let component = 0; component < indices.itemSize; component++) {
        if (headJoints.has(indices.getComponent(index, component)))
          influence += weights.getComponent(index, component);
      }
      if (influence < 0.5) continue;
      mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
      box.expandByPoint(head.worldToLocal(point));
    }
  });
  return box;
}

function average(points: readonly Correspondence[]): Correspondence {
  const model = new Vector2();
  const image = new Vector2();
  for (const point of points) {
    model.add(point.model);
    image.add(point.image);
  }
  return {
    model: model.divideScalar(points.length),
    image: image.divideScalar(points.length),
  };
}

/** Fit screen scale and translation without rotation or stretching. Multiplying
 * X by the viewport aspect makes the residual a distance in screen pixels. */
function fit(
  points: readonly Correspondence[],
  aspect: number,
): CameraFramingTransform | null {
  if (points.length < 2) return null;
  const center = average(points);
  let sourceVariance = 0;
  let targetVariance = 0;
  let covariance = 0;
  for (const { model, image } of points) {
    const sourceX = (model.x - center.model.x) * aspect;
    const sourceY = model.y - center.model.y;
    const targetX = (image.x - center.image.x) * aspect;
    const targetY = image.y - center.image.y;
    sourceVariance += sourceX * sourceX + sourceY * sourceY;
    targetVariance += targetX * targetX + targetY * targetY;
    covariance += sourceX * targetX + sourceY * targetY;
  }
  // Coincident or nearly invisible features cannot provide a useful zoom.
  if (sourceVariance < 1e-8 || targetVariance < 1e-6) return null;
  const scale = covariance / sourceVariance;
  const x = center.image.x - center.model.x * scale;
  const y = center.image.y - center.model.y * scale;
  return scale > 0 && [scale, x, y].every(Number.isFinite)
    ? { scale, x, y }
    : null;
}

/** Build once in the model's rest pose. Measurements use the currently posed
 * bones and the unmodified orbit camera, so moving limbs cannot feed back into
 * framing or change the apparent distance from the camera.
 *
 * Image landmarks must already use displayed (mirrored) coordinates and sides.
 * The camera image is contained in the viewport, preserving its aspect ratio. */
export function createCameraFraming(root: Object3D) {
  root.updateWorldMatrix(true, true);
  const references = new Map<number, Reference>();
  for (const [index, name] of torsoBones) {
    const node = root.getObjectByName(`Bip01_${name}`);
    if (node) references.set(index, { node, point: new Vector3() });
  }
  const head = root.getObjectByName("Bip01_Head");
  if (head) {
    const bounds = headBounds(root, head);
    const size = bounds.getSize(new Vector3());
    if (
      !bounds.isEmpty() &&
      [size.x, size.y, size.z].every(
        (value) => Number.isFinite(value) && value > 0,
      )
    ) {
      // Every player head uses -X up, +Y anatomical left, and +Z forward.
      // Facial landmarks are proportions of each mesh's helmet/head bounds;
      // they are only a framing reference, not extra facial animation bones.
      const eyeHeight = bounds.min.x + size.x * 0.42;
      const centerY = (bounds.min.y + bounds.max.y) / 2;
      const front = bounds.max.z;
      const centerZ = (bounds.min.z + bounds.max.z) / 2;
      const add = (index: number, x: number, y: number, z: number) =>
        references.set(index, { node: head, point: new Vector3(x, y, z) });
      add(0, eyeHeight + size.x * 0.16, centerY, front);
      for (const [eye, ear, mouth, side] of [
        [2, 7, 9, 1],
        [5, 8, 10, -1],
      ]) {
        add(
          eye,
          eyeHeight,
          centerY + size.y * 0.19 * side,
          front - size.z * 0.12,
        );
        add(ear, eyeHeight, centerY + size.y * 0.45 * side, centerZ);
        add(
          mouth,
          eyeHeight + size.x * 0.31,
          centerY + size.y * 0.14 * side,
          front - size.z * 0.05,
        );
      }
    }
  }

  return {
    measure(
      camera: PerspectiveCamera,
      landmarks: readonly PoseLandmark[],
      imageAspect: number,
    ): CameraFramingTransform | null {
      if (
        ![camera.aspect, imageAspect].every(
          (value) => Number.isFinite(value) && value > 0,
        )
      )
        return null;
      root.updateWorldMatrix(true, true);
      camera.updateWorldMatrix(true, false);
      const width = Math.min(1, imageAspect / camera.aspect);
      const height = Math.min(1, camera.aspect / imageAspect);
      const correspondences = new Map<number, Correspondence>();
      for (const [index, reference] of Array.from(references)) {
        const image = landmarks[index];
        if (!isFramingVisible(image)) continue;
        const world = reference.node.localToWorld(reference.point.clone());
        const depth = -world.clone().applyMatrix4(camera.matrixWorldInverse).z;
        if (!Number.isFinite(depth) || depth <= camera.near) continue;
        const model = world.project(camera);
        if (![model.x, model.y].every(Number.isFinite)) continue;
        correspondences.set(index, {
          model: new Vector2(model.x, model.y),
          image: new Vector2(
            (2 * image.x - 1) * width,
            (1 - 2 * image.y) * height,
          ),
        });
      }
      const torso = torsoBones.flatMap(([index]) => {
        const point = correspondences.get(index);
        return point ? [point] : [];
      });
      if (torso.length === 4) return fit(torso, camera.aspect);
      const face = faceIndices.flatMap((index) => {
        const point = correspondences.get(index);
        return point ? [point] : [];
      });
      if (torso.length >= 2) {
        // One face-center correspondence stabilizes upper-body crops without
        // giving seven small facial landmarks more weight than the torso.
        return fit(
          face.length ? [...torso, average(face)] : torso,
          camera.aspect,
        );
      }
      return fit(face, camera.aspect);
    },
  };
}

interface FramingState {
  logScale: number;
  centerX: number;
  centerY: number;
}

/** Returns a copy of the orbit camera with a smoothed zoom and offset applied
 * to its projection matrix, so the model lines up with the webcam image. */
export function createPoseFraming(root: Object3D) {
  const reference = createCameraFraming(root);
  const camera = new PerspectiveCamera();
  const transform = new Matrix4();
  let landmarks: readonly PoseLandmark[] = [];
  let imageAspect: number | null = null;
  let current: FramingState | null = null;
  let target: FramingState | null = null;

  return {
    get imageAspect() {
      return imageAspect;
    },
    setInput(points: readonly PoseLandmark[], width?: number, height?: number) {
      landmarks = points;
      if (
        width &&
        height &&
        Number.isFinite(width) &&
        Number.isFinite(height) &&
        width > 0 &&
        height > 0
      ) {
        imageAspect = width / height;
      }
    },
    reset() {
      landmarks = [];
      imageAspect = null;
      current = target = null;
    },
    update(
      base: PerspectiveCamera,
      deltaSeconds: number,
    ): PerspectiveCamera | null {
      base.updateWorldMatrix(true, false);
      const measured = reference.measure(
        base,
        landmarks,
        imageAspect ?? base.aspect,
      );
      if (measured) {
        target = {
          logScale: Math.log(measured.scale),
          centerX: -measured.x / measured.scale,
          centerY: -measured.y / measured.scale,
        };
      }
      if (!target) return null;
      current ??= { ...target };
      if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) {
        const alpha = -Math.expm1(-8 * Math.min(deltaSeconds, 0.1));
        current.logScale += (target.logScale - current.logScale) * alpha;
        current.centerX += (target.centerX - current.centerX) * alpha;
        current.centerY += (target.centerY - current.centerY) * alpha;
      }
      const scale = Math.exp(current.logScale);
      camera.copy(base, false);
      // Apply a uniform scale and principal-point shift in clip space. This
      // gives close-ups without moving the model through the near plane.
      transform.set(
        scale,
        0,
        0,
        -current.centerX * scale,
        0,
        scale,
        0,
        -current.centerY * scale,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
      );
      camera.projectionMatrix.premultiply(transform);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      return camera;
    },
  };
}

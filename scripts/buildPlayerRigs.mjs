import { Buffer } from "node:buffer";
import console from "node:console";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { Matrix4, Quaternion, Vector3 } from "three";

/** Player mesh rig authoring. Edit the hand profiles below, then run:
 *   node scripts/buildPlayerRigs.mjs --check  (validate all 16 GLBs)
 *   node scripts/buildPlayerRigs.mjs --write  (rebuild them from embedded source)
 *
 * The build first repairs Heavy Bioderm's missing left-wrist weights, then
 * adds a grouped finger hinge and a separate thumb hinge to both hands.
 * Original mesh data, UVs, transforms and stock animations are preserved.
 * Live pose retargeting reads the resulting skeleton in src/mocap/rig.ts.
 */

// Hand bind-pose profiles. Left/right always mean the character's own side.
// Positions are in the existing Hand bone's local axes, in forearm lengths:
//   -X: wrist toward fingertips; +Z: toward the palm; Y: across the hand.
// fingerKnuckleX locates the finger crease; thumbPivot is [X, Y, Z].
// thumbWeightBand is the inner/outer edge of the thumb's skin-weight blend,
// measured toward the thumb (-Y on the left hand, +Y on the right).
// Bioderm thumbs also need Z * thumbDepthWeight to separate their mesh lobe.
// Each side is measured independently: the authored grips are not symmetric.
const handProfiles = {
  lmale: {
    left: { fingerKnuckleX: -0.39, thumbPivot: [-0.24, -0.17, 0.035] },
    right: { fingerKnuckleX: -0.39, thumbPivot: [-0.24, 0.17, 0.035] },
    thumbWeightBand: [0.17, 0.23],
  },
  mmale: {
    left: { fingerKnuckleX: -0.48, thumbPivot: [-0.27, -0.17, 0] },
    right: { fingerKnuckleX: -0.51, thumbPivot: [-0.27, 0.17, 0] },
    thumbWeightBand: [0.16, 0.22],
  },
  hmale: {
    left: { fingerKnuckleX: -0.50, thumbPivot: [-0.28, -0.18, 0.02] },
    right: { fingerKnuckleX: -0.43, thumbPivot: [-0.22, 0.18, 0.03] },
    thumbWeightBand: [0.18, 0.24],
  },
  lfemale: {
    left: { fingerKnuckleX: -0.40, thumbPivot: [-0.22, -0.13, 0] },
    right: { fingerKnuckleX: -0.40, thumbPivot: [-0.22, 0.13, 0] },
    thumbWeightBand: [0.13, 0.18],
  },
  mfemale: {
    left: { fingerKnuckleX: -0.39, thumbPivot: [-0.22, -0.13, 0.02] },
    right: { fingerKnuckleX: -0.37, thumbPivot: [-0.22, 0.13, 0.02] },
    thumbWeightBand: [0.13, 0.18],
  },
  lbioderm: {
    left: { fingerKnuckleX: -0.53, thumbPivot: [-0.14, -0.13, 0.12] },
    right: { fingerKnuckleX: -0.53, thumbPivot: [-0.14, 0.13, 0.09] },
    thumbWeightBand: [0.16, 0.25], thumbDepthWeight: 0.5,
  },
  mbioderm: {
    left: { fingerKnuckleX: -0.54, thumbPivot: [-0.19, -0.21, 0.03] },
    right: { fingerKnuckleX: -0.54, thumbPivot: [-0.19, 0.20, 0.12] },
    thumbWeightBand: [0.20, 0.30], thumbDepthWeight: 0.5,
  },
  hbioderm: {
    left: { fingerKnuckleX: -0.59, thumbPivot: [-0.15, -0.20, 0.04] },
    right: { fingerKnuckleX: -0.60, thumbPivot: [-0.15, 0.20, 0.06] },
    thumbWeightBand: [0.18, 0.28], thumbDepthWeight: 0.5,
  },
};

// GLB I/O. Appended bind matrices and weights leave the source bytes intact.
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const components = {
  5121: [1, "readUInt8"], 5123: [2, "readUInt16LE"],
  5125: [4, "readUInt32LE"], 5126: [4, "readFloatLE"],
};
const widths = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 };
const metadataKey = "t2HandArticulation";
const version = 1;

function requireValue(condition, message) {
  if (!condition) throw new Error(`Cannot build player rig: ${message}`);
}

function parseGlb(buffer) {
  requireValue(buffer.length >= 28 && buffer.readUInt32LE(0) === 0x46546c67 &&
    buffer.readUInt32LE(4) === 2 && buffer.readUInt32LE(8) === buffer.length, "invalid GLB header");
  const jsonLength = buffer.readUInt32LE(12);
  const binOffset = 20 + jsonLength;
  requireValue(buffer.readUInt32LE(16) === JSON_CHUNK &&
    binOffset + 8 <= buffer.length && buffer.readUInt32LE(binOffset + 4) === BIN_CHUNK &&
    binOffset + 8 + buffer.readUInt32LE(binOffset) === buffer.length, "expected JSON and BIN chunks");
  const json = JSON.parse(buffer.subarray(20, binOffset).toString("utf8"));
  const binary = buffer.subarray(binOffset + 8);
  requireValue(json.buffers?.length === 1 && !json.buffers[0].uri &&
    json.buffers[0].byteLength <= binary.length, "expected one embedded buffer");
  return { json, binary };
}

function readAccessor(json, binary, index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor?.bufferView];
  const component = components[accessor?.componentType];
  const width = widths[accessor?.type];
  requireValue(accessor && view && component && width && !accessor.sparse &&
    !accessor.normalized && view.buffer === 0, "unsupported accessor");
  const [size, read] = component;
  const stride = view.byteStride ?? size * width;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const end = start + (accessor.count - 1) * stride + size * width;
  requireValue(Number.isInteger(accessor.count) && accessor.count > 0 &&
    Number.isInteger(start) && start >= (view.byteOffset ?? 0) &&
    Number.isInteger(stride) && stride >= size * width &&
    end <= binary.length && end <= (view.byteOffset ?? 0) + view.byteLength, "accessor exceeds buffer");
  return Array.from({ length: accessor.count * width }, (_, i) =>
    binary[read](start + Math.floor(i / width) * stride + (i % width) * size));
}

function encodeGlb(json, binary) {
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc((text.length + 3) & ~3, 0x20);
  text.copy(padded);
  const result = Buffer.alloc(12 + 8 + padded.length + 8 + binary.length);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(padded.length, 12);
  result.writeUInt32LE(JSON_CHUNK, 16);
  padded.copy(result, 20);
  result.writeUInt32LE(binary.length, 20 + padded.length);
  result.writeUInt32LE(BIN_CHUNK, 24 + padded.length);
  binary.copy(result, 28 + padded.length);
  return result;
}

function createGlbWriter(json, binary) {
  const chunks = [binary];
  let byteLength = binary.length;
  const append = (values, componentType, type, target) => {
    const size = components[componentType][0];
    const chunk = Buffer.alloc(values.length * size);
    values.forEach((value, i) => componentType === 5123
      ? chunk.writeUInt16LE(value, i * size) : chunk.writeFloatLE(value, i * size));
    const bufferView = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: chunk.length, ...(target ? { target } : {}) });
    const accessor = json.accessors.length;
    json.accessors.push({ bufferView, componentType, count: values.length / widths[type], type });
    chunks.push(chunk);
    byteLength += chunk.length;
    return accessor;
  };
  return {
    append,
    encode() {
      json.buffers[0].byteLength = byteLength;
      return encodeGlb(json, Buffer.concat(chunks));
    },
  };
}

function worldTransforms(json) {
  const parents = new Map();
  json.nodes.forEach((node, index) => node.children?.forEach((child) => parents.set(child, index)));
  const worlds = new Map();
  const world = (index) => {
    if (worlds.has(index)) return worlds.get(index);
    const node = json.nodes[index];
    const matrix = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
      new Vector3().fromArray(node.translation ?? [0, 0, 0]),
      new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
      new Vector3().fromArray(node.scale ?? [1, 1, 1]),
    );
    if (parents.has(index)) matrix.premultiply(world(parents.get(index)));
    worlds.set(index, matrix);
    return matrix;
  };
  return world;
}

function smoothstep(start, end, value) {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function centroid(points) {
  requireValue(points.length > 0, "no vertices for a hand landmark");
  return points.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(points.length);
}

/** Append the missing wrist binding without rewriting any original binary data.
 * The source animation already animates Hand; its previously invisible movement
 * becomes visible once the merged forearm/mitt mesh uses that joint. */
export function repairPlayerModel(buffer) {
  const { json, binary } = parseGlb(buffer);
  const nodeIndex = (name) => json.nodes.findIndex((node) => node.name === name);
  const armIndex = nodeIndex("Bio_heavyLarm");
  const forearmIndex = nodeIndex("Bip01_L_Forearm");
  const handIndex = nodeIndex("Bip01_L_Hand");
  requireValue(armIndex >= 0 && forearmIndex >= 0 && handIndex >= 0, "required nodes are missing");
  const arm = json.nodes[armIndex];
  const mesh = json.meshes[arm.mesh];
  const skin = json.skins[arm.skin];
  const articulated = skin?.joints.length === 4 &&
    skin.joints[2] === nodeIndex("Bip01_L_Fingers") &&
    skin.joints[3] === nodeIndex("Bip01_L_Thumb") &&
    skin.joints.slice(2).every((joint) => json.nodes[handIndex].children?.includes(joint));
  requireValue(json.nodes[forearmIndex].children?.includes(handIndex) &&
    mesh?.primitives.length === 1 && skin?.joints[0] === forearmIndex &&
    (skin.joints.length === 1 || ((skin.joints.length === 2 || articulated) && skin.joints[1] === handIndex)) &&
    json.nodes.filter((node) => node.skin === arm.skin).length === 1 &&
    json.nodes.filter((node) => node.mesh === arm.mesh).length === 1, "unexpected mesh or joint binding");
  const primitive = mesh.primitives[0];
  requireValue((primitive.mode ?? 4) === 4, "expected triangles");
  const positions = readAccessor(json, binary, primitive.attributes.POSITION);
  const indices = readAccessor(json, binary, primitive.indices);
  const existingJoints = readAccessor(json, binary, primitive.attributes.JOINTS_0);
  const existingWeights = readAccessor(json, binary, primitive.attributes.WEIGHTS_0);
  const inverses = readAccessor(json, binary, skin.inverseBindMatrices);
  const count = positions.length / 3;
  requireValue(Number.isInteger(count) && indices.length % 3 === 0 &&
    existingJoints.length === count * 4 && existingWeights.length === count * 4 &&
    inverses.length === skin.joints.length * 16 &&
    [...positions, ...inverses].every(Number.isFinite) &&
    indices.every((index) => Number.isInteger(index) && index >= 0 && index < count),
  "invalid vertex or inverse-bind data");

  const world = worldTransforms(json);
  const forearmWorld = world(forearmIndex);
  const handWorld = world(handIndex);
  const wrist = new Vector3().setFromMatrixPosition(handWorld);
  const axis = wrist.clone().sub(new Vector3().setFromMatrixPosition(forearmWorld));
  const length = axis.length();
  requireValue(Number.isFinite(length) && length > 1e-10, "invalid wrist pivot");
  axis.divideScalar(length);
  const forearmInverse = new Matrix4().fromArray(inverses);
  const originalSkin = forearmWorld.clone().multiply(forearmInverse);
  const projected = Array.from({ length: count }, (_, i) =>
    new Vector3().fromArray(positions, i * 3).applyMatrix4(originalSkin).sub(wrist).dot(axis) / length);

  // UV islands span both arm and mitt. Crossing triangle edges locate the
  // actual cuff, and equal positions receive equal weights across UV seams.
  let blendStart = 0;
  let blendEnd = Infinity;
  for (let i = 0; i < indices.length; i += 3) {
    for (let edge = 0; edge < 3; edge++) {
      const a = projected[indices[i + edge]];
      const b = projected[indices[i + (edge + 1) % 3]];
      const proximal = Math.min(a, b);
      const distal = Math.max(a, b);
      if (proximal <= 0 && distal > 0) {
        blendStart = Math.min(blendStart, proximal);
        blendEnd = Math.min(blendEnd, distal);
      }
    }
  }
  requireValue(Number.isFinite(blendEnd) && blendStart >= -0.2 && blendEnd <= 0.2 &&
    blendEnd - blendStart > 1e-8 &&
    projected.some((t) => t < -0.2) && projected.some((t) => t > 0.2), "wrist cuff was not found");
  const joints = Array(count * 4).fill(0);
  const weights = Array(count * 4).fill(0);
  const stats = { vertices: count, forearmVertices: 0, handVertices: 0, blendedVertices: 0, blendStart, blendEnd };
  projected.forEach((value, index) => {
    const t = Math.max(0, Math.min(1, (value - blendStart) / (blendEnd - blendStart)));
    const weight = t * t * (3 - 2 * t);
    joints[index * 4 + 1] = 1;
    weights[index * 4] = Math.fround(1 - weight);
    weights[index * 4 + 1] = Math.fround(weight);
    if (weight === 0) stats.forearmVertices++;
    else if (weight === 1) stats.handVertices++;
    else stats.blendedVertices++;
  });
  const handInverse = handWorld.clone().invert().multiply(forearmWorld).multiply(forearmInverse);
  const newInverses = [...forearmInverse.elements, ...handInverse.elements].map(Math.fround);
  if (skin.joints.length >= 2) {
    const matches = articulated
      ? Array.from({ length: count }, (_, index) => {
        let forearm = 0;
        let hand = 0;
        for (let component = 0; component < 4; component++) {
          const joint = existingJoints[index * 4 + component];
          const weight = existingWeights[index * 4 + component];
          if (!Number.isInteger(joint) || joint < 0 || joint >= skin.joints.length ||
            !Number.isFinite(weight) || weight < 0 || weight > 1) return false;
          if (joint === 0) forearm += weight;
          else hand += weight;
        }
        // Fingers/thumb inherit Hand, so their combined influence must retain
        // exactly the original wrist cuff's forearm-versus-hand partition.
        return forearm === weights[index * 4] && Math.abs(hand - weights[index * 4 + 1]) < 1e-7;
      }).every(Boolean)
      : joints.every((value, i) => value === existingJoints[i]) &&
        weights.every((value, i) => value === existingWeights[i]);
    requireValue(matches && newInverses.every((value, i) => value === inverses[i]),
      "existing wrist repair does not match");
    return { buffer, changed: false, stats };
  }
  requireValue(existingWeights.every((weight, i) => weight === (i % 4 === 0 ? 1 : 0)) &&
    existingJoints.every((joint, i) => i % 4 !== 0 || joint === 0), "expected a rigid forearm skin");

  const output = createGlbWriter(json, binary);
  primitive.attributes.JOINTS_0 = output.append(joints, 5123, "VEC4", 34962);
  primitive.attributes.WEIGHTS_0 = output.append(weights, 5126, "VEC4", 34962);
  skin.inverseBindMatrices = output.append(newInverses, 5126, "MAT4");
  skin.joints = [forearmIndex, handIndex];
  return { buffer: output.encode(), changed: true, stats };
}

// Retain the original references so the augmentation can be checked against a
// reconstructed source without checking in a second set of large model files.
// Original binary bytes and accessors remain untouched in the GLB.
export function restoreUnarticulatedModel(buffer) {
  const { json, binary } = parseGlb(buffer);
  const metadata = json.asset.extras?.[metadataKey];
  if (!metadata) return buffer;
  requireValue(metadata.version === version && metadata.hands?.length === 2, "unsupported articulation metadata");
  for (const saved of metadata.hands) {
    const hand = json.nodes[saved.hand];
    if (saved.children === null) delete hand.children;
    else hand.children = saved.children;
    const primitive = json.meshes[saved.mesh].primitives[0];
    primitive.attributes.JOINTS_0 = saved.joints;
    primitive.attributes.WEIGHTS_0 = saved.weights;
    json.skins[saved.skin] = saved.skinDefinition;
  }
  json.nodes.length = metadata.nodes;
  json.accessors.length = metadata.accessors;
  json.bufferViews.length = metadata.bufferViews;
  json.buffers[0].byteLength = metadata.bufferLength;
  if (metadata.assetExtras === null) delete json.asset.extras;
  else json.asset.extras = metadata.assetExtras;
  return encodeGlb(json, binary.subarray(0, metadata.binaryLength));
}

/** Add two small, independent hinges to each existing fused mitt. The child
 * rest transforms and inverse binds cancel exactly in the skinning equation;
 * existing animations continue to move the hands with both hinges at rest. */
export function articulatePlayerModel(buffer, model) {
  const { json, binary } = parseGlb(buffer);
  const profile = handProfiles[model];
  requireValue(profile, `unknown player model ${model}`);
  if (json.asset.extras?.[metadataKey]) {
    const result = articulatePlayerModel(restoreUnarticulatedModel(buffer), model);
    requireValue(result.buffer.equals(buffer), "existing hand articulation does not match");
    return { buffer, changed: false, stats: result.stats };
  }
  requireValue(!json.nodes.some((node) => /^Bip01_[LR]_(Fingers|Thumb)/.test(node.name ?? "")),
    "unrecognized existing finger or thumb joints");
  const world = worldTransforms(json);
  const metadata = {
    version, model, nodes: json.nodes.length, accessors: json.accessors.length,
    bufferViews: json.bufferViews.length, bufferLength: json.buffers[0].byteLength,
    binaryLength: binary.length, assetExtras: json.asset.extras ?? null, hands: [],
  };
  const output = createGlbWriter(json, binary);
  const stats = [];
  for (const side of ["L", "R"]) {
    const handProfile = side === "L" ? profile.left : profile.right;
    const handIndex = json.nodes.findIndex((node) => node.name === `Bip01_${side}_Hand`);
    const forearmIndex = json.nodes.findIndex((node) => node.name === `Bip01_${side}_Forearm`);
    requireValue(handIndex >= 0 && forearmIndex >= 0, `${side} hand hierarchy missing`);
    const meshNodes = json.nodes.filter((node) => node.skin !== undefined && json.skins[node.skin].joints.includes(handIndex));
    requireValue(meshNodes.length === 1, `${side} hand requires one existing skinned mesh`);
    const meshNode = meshNodes[0];
    const mesh = json.meshes[meshNode.mesh];
    const skin = json.skins[meshNode.skin];
    requireValue(mesh.primitives.length === 1 && skin.joints.length <= 2 &&
      skin.joints.every((joint) => joint === handIndex || joint === forearmIndex) &&
      json.nodes.filter((node) => node.mesh === meshNode.mesh).length === 1 &&
      json.nodes.filter((node) => node.skin === meshNode.skin).length === 1, `${side} hand has incompatible binding`);
    const primitive = mesh.primitives[0];
    requireValue((primitive.mode ?? 4) === 4, `${side} hand must use triangles`);
    const positions = readAccessor(json, binary, primitive.attributes.POSITION);
    const oldJoints = readAccessor(json, binary, primitive.attributes.JOINTS_0);
    const oldWeights = readAccessor(json, binary, primitive.attributes.WEIGHTS_0);
    const inverses = readAccessor(json, binary, skin.inverseBindMatrices);
    const count = positions.length / 3;
    requireValue(oldJoints.length === count * 4 && oldWeights.length === count * 4 &&
      inverses.length === skin.joints.length * 16 && [...positions, ...inverses].every(Number.isFinite),
    `${side} hand has invalid skin arrays`);
    const handJoint = skin.joints.indexOf(handIndex);
    const handInverse = new Matrix4().fromArray(inverses, handJoint * 16);
    const handWorld = world(handIndex);
    const length = new Vector3().setFromMatrixPosition(world(forearmIndex))
      .applyMatrix4(handWorld.clone().invert()).length();
    requireValue(Number.isFinite(length) && length > 1e-10, `${side} wrist scale is invalid`);
    const local = Array.from({ length: count }, (_, i) =>
      new Vector3().fromArray(positions, i * 3).applyMatrix4(handInverse).divideScalar(length));
    const baseWeights = Array.from({ length: count }, (_, i) => {
      const values = Array(skin.joints.length).fill(0);
      for (let component = 0; component < 4; component++) {
        const joint = oldJoints[i * 4 + component];
        const weight = oldWeights[i * 4 + component];
        requireValue(Number.isInteger(joint) && joint >= 0 && joint < skin.joints.length &&
          Number.isFinite(weight) && weight >= 0 && weight <= 1, `${side} invalid vertex influence`);
        values[joint] += weight;
      }
      requireValue(Math.abs(values.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-6,
        `${side} vertex weights are not normalized`);
      return values;
    });
    const unique = new Map();
    local.forEach((point, i) => {
      if (baseWeights[i][handJoint] > 0.5) unique.set(point.toArray().map((value) => value.toFixed(7)).join(","), point);
    });
    const handPoints = [...unique.values()];
    const end = Math.min(...handPoints.map((point) => point.x));
    const fingerX = handProfile.fingerKnuckleX;
    const thumbPivot = new Vector3().fromArray(handProfile.thumbPivot);
    requireValue(end < fingerX && fingerX < -0.1, `${side} knuckle loop is missing`);
    const proportions = (point) => {
      const lateral = (side === "L" ? -point.y : point.y) + (profile.thumbDepthWeight ?? 0) * point.z;
      const thumb = smoothstep(...profile.thumbWeightBand, lateral) * smoothstep(end * 0.90, end * 0.75, point.x);
      // Separate the thumb first so the finger curl cannot drag its tip along.
      const fingers = (1 - thumb) * smoothstep(fingerX + 0.08, fingerX - 0.08, point.x);
      return [1 - thumb - fingers, fingers, thumb];
    };
    const knuckles = handPoints.filter((point) => Math.abs(point.x - fingerX) < 0.09 && proportions(point)[2] < 0.2);
    requireValue(knuckles.length >= 3, `${side} knuckle cross section is missing`);
    const center = (axis) => (Math.min(...knuckles.map((point) => point[axis])) + Math.max(...knuckles.map((point) => point[axis]))) / 2;
    const fingerPivot = new Vector3(fingerX, center("y"), center("z"));
    const fingerTip = centroid(handPoints.filter((point) => point.x < end * 0.92 && proportions(point)[2] < 0.1));
    const thumbCandidates = handPoints.filter((point) => proportions(point)[2] > 0.8)
      .sort((a, b) => b.distanceToSquared(thumbPivot) - a.distanceToSquared(thumbPivot));
    requireValue(thumbCandidates.length >= 3, `${side} thumb lobe is missing`);
    const thumbTip = centroid(thumbCandidates.slice(0, 3));
    const oldJointCount = skin.joints.length;
    metadata.hands.push({
      hand: handIndex, children: json.nodes[handIndex].children ?? null,
      mesh: meshNode.mesh, skin: meshNode.skin,
      joints: primitive.attributes.JOINTS_0, weights: primitive.attributes.WEIGHTS_0,
      skinDefinition: JSON.parse(JSON.stringify(skin)),
    });
    const addHinge = (name, pivot, tip) => {
      const joint = json.nodes.length;
      const direction = tip.clone().sub(pivot).multiplyScalar(length);
      json.nodes.push({
        name: `Bip01_${side}_${name}`, translation: pivot.clone().multiplyScalar(length).toArray(),
        rotation: [0, 0, 0, 1], children: [joint + 1],
      }, {
        name: `Bip01_${side}_${name}Tip`, translation: direction.toArray(),
        rotation: [0, 0, 0, 1],
      });
      json.nodes[handIndex].children = [...(json.nodes[handIndex].children ?? []), joint];
      return joint;
    };
    const fingerIndex = addHinge("Fingers", fingerPivot, fingerTip);
    const thumbIndex = addHinge("Thumb", thumbPivot, thumbTip);
    const joints = Array(count * 4).fill(0);
    const weights = Array(count * 4).fill(0);
    const influenced = { palm: 0, fingers: 0, thumb: 0 };
    for (let i = 0; i < count; i++) {
      const share = proportions(local[i]);
      const handWeight = baseWeights[i][handJoint];
      const values = [...baseWeights[i], handWeight * share[1], handWeight * share[2]];
      values[handJoint] = handWeight * share[0];
      values.forEach((weight, joint) => {
        joints[i * 4 + joint] = joint;
        weights[i * 4 + joint] = Math.fround(weight);
      });
      if (values[handJoint] > 0.5) influenced.palm++;
      if (values[oldJointCount] > 0.5) influenced.fingers++;
      if (values[oldJointCount + 1] > 0.5) influenced.thumb++;
    }
    requireValue(Object.values(influenced).every((value) => value >= 3), `${side} missing visible articulation region`);
    const newInverses = [...inverses];
    for (const pivot of [fingerPivot, thumbPivot]) {
      newInverses.push(...new Matrix4().makeTranslation(-pivot.x * length, -pivot.y * length, -pivot.z * length)
        .multiply(handInverse).elements.map(Math.fround));
    }
    primitive.attributes.JOINTS_0 = output.append(joints, 5123, "VEC4", 34962);
    primitive.attributes.WEIGHTS_0 = output.append(weights, 5126, "VEC4", 34962);
    skin.inverseBindMatrices = output.append(newInverses, 5126, "MAT4");
    skin.joints.push(fingerIndex, thumbIndex);
    stats.push({
      side, vertices: count, uniqueHandPoints: handPoints.length, ...influenced,
      fingerPivot: fingerPivot.toArray(), thumbPivot: thumbPivot.toArray(),
      restFingerCurl: Math.atan2(fingerTip.z - fingerPivot.z, fingerPivot.x - fingerTip.x),
    });
  }
  json.asset.extras = { ...(json.asset.extras ?? {}), [metadataKey]: metadata };
  return { buffer: output.encode(), changed: true, stats };
}

/** Rebuild from the preserved source, so editing a hand profile replaces the
 * existing articulation instead of adding another set of joints and weights.
 * This is intentionally different from the strict low-level validation above. */
export function buildPlayerRig(buffer, model) {
  requireValue(handProfiles[model], `unknown player model ${model}`);
  let source = restoreUnarticulatedModel(buffer);
  if (model === "hbioderm") source = repairPlayerModel(source).buffer;
  const result = articulatePlayerModel(source, model);
  return { ...result, changed: !result.buffer.equals(buffer) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  if (!["--check", "--write"].includes(mode) || process.argv.length !== 3) {
    console.error("Usage: node scripts/buildPlayerRigs.mjs --check|--write");
    process.exitCode = 1;
  } else {
    for (const model of Object.keys(handProfiles)) {
      for (const suffix of ["", ".anim"]) {
        const name = `${model}${suffix}.glb`;
        try {
          const path = fileURLToPath(new URL(`../public/${name}`, import.meta.url));
          const buffer = await readFile(path);
          const result = buildPlayerRig(buffer, model);
          if (mode === "--check") {
            // Verify the existing wrist partition and articulation metadata as
            // well as comparing the regenerated output. Never alter the file.
            if (model === "hbioderm") repairPlayerModel(buffer);
            articulatePlayerModel(buffer, model);
          }
          if (result.changed && mode === "--write") await writeFile(path, result.buffer);
          if (result.changed && mode === "--check") process.exitCode = 1;
          const status = result.changed ? mode === "--write" ? "rebuilt" : "needs rebuild" : "verified";
          console.log(`${name}: ${status} (${result.stats.map((hand) => `${hand.side}: ${hand.fingers} fingers / ${hand.thumb} thumb vertices`).join(", ")})`);
        } catch (error) {
          console.error(`${name}: ${error.message}`);
          process.exitCode = 1;
        }
      }
    }
  }
}

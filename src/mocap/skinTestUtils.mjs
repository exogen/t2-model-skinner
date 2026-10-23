import { expect } from "vitest";
import { Vector3 } from "three";

export function vertices(scene, include = () => true) {
  const samples = [];
  scene.traverse((mesh) => {
    if (!mesh.isMesh || !include(mesh)) return;
    for (let index = 0; index < mesh.geometry.attributes.position.count; index++) samples.push({ mesh, index });
  });
  return samples;
}

export function worldVertex({ mesh, index }) {
  return mesh.getVertexPosition(index, new Vector3()).applyMatrix4(mesh.matrixWorld);
}

export function snapshot(samples) {
  return samples.map((sample) => ({ sample, position: worldVertex(sample) }));
}

export function maxMovement(saved) {
  return Math.max(...saved.map(({ sample, position }) => worldVertex(sample).distanceTo(position)));
}

/** Every saved vertex is within tolerance of its transformed position. */
export function expectUnmoved(saved, { tolerance = 1e-7, transform = (position) => position, label = "unchanged" } = {}) {
  let error = 0;
  let worst;
  for (const { sample, position } of saved) {
    const distance = worldVertex(sample).distanceTo(transform(position.clone()));
    // NaN is never <= error, so it is kept as the error and fails below.
    if (!(distance <= error)) { error = distance; worst = sample; }
    if (Number.isNaN(error)) break;
  }
  expect(error, `${label}: ${worst?.mesh.name} vertex ${worst?.index}`).toBeLessThan(tolerance);
}

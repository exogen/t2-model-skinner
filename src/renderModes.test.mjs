import { expect, test, vi } from "vitest";
import { Color, MeshBasicMaterial, MeshStandardMaterial, Scene } from "three";
import Viewer, { disposeObject } from "./Viewer";
import { randomColorGeometry, triangleHue } from "./renderModes";
import { loadPlayer } from "./mocap/playerTestUtils.mjs";

function meshes(root) {
  const found = [];
  root.traverse((object) => {
    if (object.isMesh) found.push(object);
  });
  return found;
}

test("neighboring triangles get hues far apart", () => {
  for (let triangle = 0; triangle < 200; triangle++) {
    const step = Math.abs(triangleHue(triangle + 1) - triangleHue(triangle));
    expect(Math.min(step, 1 - step)).toBeGreaterThan(0.35);
  }
});

test("a real player's Random Colors copy gives every triangle one color and keeps skinning and groups", async () => {
  const gltf = await loadPlayer("lmale");
  const skinned = meshes(gltf.scene).filter((mesh) => mesh.isSkinnedMesh);
  expect(skinned.length).toBeGreaterThan(0);
  for (const mesh of skinned) {
    const { geometry } = mesh;
    const ownColors = geometry.attributes.color;
    const copy = randomColorGeometry(geometry);
    expect(copy.index).toBeNull();
    expect(copy.attributes.position.count).toBe(geometry.index.count);
    expect(copy.attributes.skinIndex.count).toBe(
      copy.attributes.position.count,
    );
    expect(copy.attributes.skinWeight.count).toBe(
      copy.attributes.position.count,
    );
    expect(copy.groups).toEqual(geometry.groups);
    const colors = copy.attributes.color;
    const first = new Color();
    const corner = new Color();
    for (let vertex = 0; vertex < colors.count; vertex += 3) {
      first.fromBufferAttribute(colors, vertex);
      expect(corner.fromBufferAttribute(colors, vertex + 1).equals(first)).toBe(
        true,
      );
      expect(corner.fromBufferAttribute(colors, vertex + 2).equals(first)).toBe(
        true,
      );
    }
    // The model's own geometry is left as it was.
    expect(geometry.attributes.color).toBe(ownColors);
    copy.dispose();
  }
  disposeObject(gltf.scene);
});

function renderModeHarness(scene) {
  return Object.assign(Object.create(Viewer.prototype), {
    scene: new Scene(),
    invalidate: vi.fn(),
    renderMode: "skin",
    model: { scene },
    randomColorGeometries: new Map(),
    randomColorMaterial: new MeshStandardMaterial({ vertexColors: true }),
    wireframeMaterial: new MeshBasicMaterial({ wireframe: true }),
  });
}

test("render modes swap in their material and geometry, and Skin restores the model's own", async () => {
  const gltf = await loadPlayer("lmale");
  const viewer = renderModeHarness(gltf.scene);
  const originals = new Map(
    meshes(gltf.scene).map((mesh) => [mesh, mesh.geometry]),
  );
  const materials = new Map(
    meshes(gltf.scene).map((mesh) => [mesh, mesh.material]),
  );

  viewer.setRenderMode("random");
  expect(viewer.scene.overrideMaterial).toBe(viewer.randomColorMaterial);
  const randoms = new Map();
  for (const [mesh, original] of originals) {
    expect(mesh.geometry).not.toBe(original);
    expect(mesh.geometry.attributes.color).toBeDefined();
    expect(mesh.material).toBe(materials.get(mesh));
    randoms.set(mesh, mesh.geometry);
  }

  viewer.setRenderMode("wireframe");
  expect(viewer.scene.overrideMaterial).toBe(viewer.wireframeMaterial);
  for (const [mesh, original] of originals)
    expect(mesh.geometry).toBe(original);

  // Coming back reuses the copies made the first time.
  viewer.setRenderMode("random");
  for (const [mesh, random] of randoms) expect(mesh.geometry).toBe(random);

  viewer.setRenderMode("skin");
  expect(viewer.scene.overrideMaterial).toBeNull();
  for (const [mesh, original] of originals)
    expect(mesh.geometry).toBe(original);
  expect(viewer.invalidate).toHaveBeenCalledTimes(4);
  disposeObject(gltf.scene);
});

test("clearing a model shown in Random Colors disposes the copies and the model's own geometry", async () => {
  const gltf = await loadPlayer("lmale");
  const viewer = Object.assign(renderModeHarness(gltf.scene), {
    rig: null,
    mixer: null,
    originalTextures: new Set(),
  });
  viewer.scene.add(gltf.scene);
  const originals = meshes(gltf.scene).map((mesh) => [
    mesh,
    mesh.geometry,
    vi.spyOn(mesh.geometry, "dispose"),
  ]);
  viewer.setRenderMode("random");
  const copies = meshes(gltf.scene).map((mesh) =>
    vi.spyOn(mesh.geometry, "dispose"),
  );
  viewer.clearModel();
  for (const [mesh, original, dispose] of originals) {
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(mesh.geometry).toBe(original);
  }
  for (const dispose of copies) expect(dispose).toHaveBeenCalledTimes(1);
  expect(viewer.randomColorGeometries.size).toBe(0);
});

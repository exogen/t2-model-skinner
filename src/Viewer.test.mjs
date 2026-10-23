import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { expect, test, vi } from "vitest";
import {
  AnimationClip, AnimationMixer, EquirectangularReflectionMapping, Group, Mesh, MeshStandardMaterial, Object3D,
  PerspectiveCamera, PlaneGeometry, Scene, Texture, Vector3, VectorKeyframeTrack, WebGLRenderTarget,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import Viewer, { collectMaterials, disposeObject } from "./Viewer";
import { configureMaterial } from "./materialBinding";

const config = JSON.parse(readFileSync(new URL("../models.json", import.meta.url), "utf8"));

async function loadModel(name) {
  const buffer = readFileSync(new URL(`../public/${name}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  // Keep the real glTF parser and material associations; image decoding needs
  // browser APIs and is independent of this binding/disposal coverage.
  loader.register(() => ({ name: "test-image-decoder", loadTexture: async () => new Texture() }));
  return loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), "");
}

test.each(Object.keys(config.materials))("%s binds every real GLB material to its original configured index", async (name) => {
  const gltf = await loadModel(name);
  const grouped = collectMaterials(gltf);
  const sourceMaterials = gltf.parser.json.materials;
  expect(grouped).toHaveLength(sourceMaterials.length);
  const encountered = new Set();
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      encountered.add(material);
      const index = gltf.parser.associations.get(material)?.materials;
      expect(index, material.name).not.toBeUndefined();
      expect(grouped[index]).toContain(material);
    }
  });
  expect(new Set(grouped.flat())).toEqual(encountered);
  grouped.forEach((materials, index) => {
    expect(new Set(materials).size).toBe(materials.length);
    for (const material of materials) {
      expect(material.name).toBe(sourceMaterials[index].name);
      const definition = config.materials[name][index];
      configureMaterial(material, definition);
      expect(material.visible).toBe(definition != null && !definition.hidden);
    }
  });
  disposeObject(gltf.scene);
});

test("material grouping retains runtime clones and does not confuse source names with configuration aliases", async () => {
  const gltf = await loadModel("elf");
  const original = collectMaterials(gltf)[0][0];
  const clone = original.clone();
  const mesh = new Mesh(new PlaneGeometry(), clone);
  gltf.parser.associations.set(clone, { materials: 0 });
  gltf.scene.add(mesh, new Mesh(mesh.geometry, clone));
  const grouped = collectMaterials(gltf);
  expect(config.materials.elf[0].name).toBe("weapon_elf");
  expect(original.name).toBe("weapon_elf0");
  expect(grouped[0]).toEqual([original, clone]);
  expect(grouped[1][0].name).toBe("weapon_elf");
  configureMaterial(grouped[0][0], config.materials.elf[0]);
  configureMaterial(grouped[1][0], config.materials.elf[1]);
  expect(grouped[0][0].visible).toBe(true);
  expect(grouped[1][0].visible).toBe(false);
  disposeObject(gltf.scene);
});

test("disposing a scene releases shared geometry, materials and texture slots once", () => {
  const root = new Group();
  const geometry = new PlaneGeometry();
  const texture = new Texture();
  const material = new MeshStandardMaterial({ map: texture, roughnessMap: texture, metalnessMap: texture });
  const other = new MeshStandardMaterial({ map: texture });
  const geometryDispose = vi.spyOn(geometry, "dispose");
  const textureDispose = vi.spyOn(texture, "dispose");
  const materialDispose = vi.spyOn(material, "dispose");
  const otherDispose = vi.spyOn(other, "dispose");
  root.add(new Mesh(geometry, [material, other]), new Mesh(geometry, material));
  disposeObject(root);
  expect(geometryDispose).toHaveBeenCalledTimes(1);
  expect(textureDispose).toHaveBeenCalledTimes(1);
  expect(materialDispose).toHaveBeenCalledTimes(1);
  expect(otherDispose).toHaveBeenCalledTimes(1);
});

test("disposing a real skinned player releases every skeleton bone texture", async () => {
  const gltf = await loadModel("lmale");
  const skeletons = new Set();
  gltf.scene.traverse((object) => {
    if (object.isSkinnedMesh) skeletons.add(object.skeleton);
  });
  expect(skeletons.size).toBeGreaterThan(1);
  const disposals = Array.from(skeletons, (skeleton) => {
    skeleton.computeBoneTexture();
    return vi.spyOn(skeleton.boneTexture, "dispose");
  });
  disposeObject(gltf.scene);
  for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
});

test("disposing a model also releases embedded textures replaced by editor textures", () => {
  const embedded = new Texture();
  const replacement = new Texture();
  const mesh = new Mesh(new PlaneGeometry(), new MeshStandardMaterial({ map: replacement }));
  const embeddedDispose = vi.spyOn(embedded, "dispose");
  const replacementDispose = vi.spyOn(replacement, "dispose");
  disposeObject(mesh, new Set([embedded]));
  expect(embeddedDispose).toHaveBeenCalledTimes(1);
  expect(replacementDispose).toHaveBeenCalledTimes(1);
});

function environmentHarness() {
  return Object.assign(Object.create(Viewer.prototype), {
    environmentGeneration: 0, disposed: false,
    scene: new Scene(), controls: {}, invalidate: vi.fn(),
    environment: null, background: null,
    defaultEnvironment: new WebGLRenderTarget(1, 1),
    pmrem: {
      fromEquirectangular: vi.fn(() => new WebGLRenderTarget(1, 1)),
      fromScene: vi.fn(() => new WebGLRenderTarget(1, 1)),
    },
  });
}

test("HDR backgrounds use spherical mapping and switching to default releases their resources", async () => {
  const viewer = environmentHarness();
  const texture = new Texture();
  const textureDispose = vi.spyOn(texture, "dispose");
  const load = vi.spyOn(RGBELoader.prototype, "loadAsync").mockResolvedValueOnce(texture);
  try {
    viewer.setBackgroundVisible(true);
    await viewer.setEnvironment("/environment.hdr");
    expect(texture.mapping).toBe(EquirectangularReflectionMapping);
    expect(viewer.scene.background).toBe(texture);
    expect(viewer.scene.environment).toBe(viewer.environment.texture);
    expect(viewer.controls.maxPolarAngle).toBe(Math.PI / 2);
    const environmentDispose = vi.spyOn(viewer.environment, "dispose");
    await viewer.setEnvironment(null);
    expect(viewer.scene.background).toBeNull();
    expect(viewer.scene.environment).toBe(viewer.defaultEnvironment.texture);
    expect(viewer.controls.maxPolarAngle).toBe(Math.PI * 7 / 8);
    expect(textureDispose).toHaveBeenCalledTimes(1);
    expect(environmentDispose).toHaveBeenCalledTimes(1);
  } finally {
    load.mockRestore();
  }
});

test("toggling the background reuses the loaded HDR", async () => {
  const viewer = environmentHarness();
  const texture = new Texture();
  const load = vi.spyOn(RGBELoader.prototype, "loadAsync").mockResolvedValueOnce(texture);
  try {
    await viewer.setEnvironment("/environment.hdr");
    expect(viewer.scene.background).toBeNull();
    viewer.setBackgroundVisible(true);
    expect(viewer.scene.background).toBe(texture);
    expect(viewer.controls.maxPolarAngle).toBe(Math.PI / 2);
    viewer.setBackgroundVisible(false);
    expect(viewer.scene.background).toBeNull();
    expect(viewer.controls.maxPolarAngle).toBe(Math.PI * 7 / 8);
    expect(load).toHaveBeenCalledTimes(1);
    expect(viewer.pmrem.fromEquirectangular).toHaveBeenCalledTimes(1);
  } finally {
    load.mockRestore();
    texture.dispose();
  }
});

test("an obsolete HDR request cannot replace the selected environment", async () => {
  const viewer = environmentHarness();
  const texture = new Texture();
  const textureDispose = vi.spyOn(texture, "dispose");
  let resolve;
  const load = vi.spyOn(RGBELoader.prototype, "loadAsync")
    .mockReturnValueOnce(new Promise((ready) => { resolve = ready; }));
  try {
    viewer.setBackgroundVisible(true);
    const pending = viewer.setEnvironment("/old.hdr");
    await viewer.setEnvironment(null);
    resolve(texture);
    await pending;
    expect(viewer.scene.environment).toBe(viewer.defaultEnvironment.texture);
    expect(viewer.scene.background).toBeNull();
    expect(viewer.pmrem.fromEquirectangular).not.toHaveBeenCalled();
    expect(textureDispose).toHaveBeenCalledTimes(1);
  } finally {
    load.mockRestore();
  }
});

test.each([false, true])("restoring a GL context rebuilds lost environment pixels (HDR: %s)", (withHdr) => {
  const viewer = environmentHarness();
  const oldDefault = viewer.defaultEnvironment;
  const defaultDispose = vi.spyOn(oldDefault, "dispose");
  const hdr = withHdr ? new Texture() : null;
  viewer.background = hdr;
  viewer.scene.background = hdr;
  viewer.environment = withHdr ? new WebGLRenderTarget(1, 1) : null;
  const oldHdr = viewer.environment;
  const hdrDispose = oldHdr && vi.spyOn(oldHdr, "dispose");
  viewer.rebuildEnvironment();
  expect(defaultDispose).toHaveBeenCalledTimes(1);
  expect(viewer.defaultEnvironment).not.toBe(oldDefault);
  expect(viewer.pmrem.fromScene).toHaveBeenCalledTimes(1);
  expect(viewer.scene.background).toBe(hdr);
  if (withHdr) {
    expect(hdrDispose).toHaveBeenCalledTimes(1);
    expect(viewer.environment).not.toBe(oldHdr);
    expect(viewer.pmrem.fromEquirectangular).toHaveBeenCalledWith(hdr);
    expect(viewer.scene.environment).toBe(viewer.environment.texture);
  } else {
    expect(viewer.pmrem.fromEquirectangular).not.toHaveBeenCalled();
    expect(viewer.scene.environment).toBe(viewer.defaultEnvironment.texture);
  }
  expect(viewer.invalidate).toHaveBeenCalledTimes(1);
  viewer.environment?.dispose();
  viewer.defaultEnvironment.dispose();
  hdr?.dispose();
});

/** A viewer with a real mixer. "Hold" keeps a node at x = 1, and "Slide"
 * moves it from x = 3 to x = 5 over a second. `first` is the clip listed
 * first. */
function animationHarness(first = "Hold") {
  const scene = new Group();
  const node = new Object3D();
  node.name = "node";
  scene.add(node);
  const animations = [
    new AnimationClip("Hold", 1, [new VectorKeyframeTrack("node.position", [0, 1], [1, 0, 0, 1, 0, 0])]),
    new AnimationClip("Slide", 1, [new VectorKeyframeTrack("node.position", [0, 1], [3, 0, 0, 5, 0, 0])]),
  ];
  if (first === "Slide") animations.reverse();
  const viewer = Object.assign(Object.create(Viewer.prototype), {
    model: { scene, animations }, mixer: new AnimationMixer(scene), action: null, rig: null,
    posing: false, paused: false, playbackSpeed: 1, poseAnimationTime: 0,
    camera: new PerspectiveCamera(), controls: { target: new Vector3(), update() {} }, invalidate: vi.fn(),
  });
  return { viewer, node, animations };
}

test("while playing, a newly chosen animation blends in from its start over 0.3 s of animation time", () => {
  const { viewer, node } = animationHarness();
  viewer.setAnimation("Hold", false, 0.5);
  viewer.mixer.update(0.5);
  viewer.setAnimation("Slide", false, 0.5);
  expect(node.position.x).toBeCloseTo(1, 12);
  // Halfway, each counts for half, and Slide is at 3.3.
  viewer.mixer.update(0.15);
  expect(node.position.x).toBeCloseTo((1 + 3.3) / 2, 6);
  viewer.mixer.update(0.2);
  expect(node.position.x).toBeCloseTo(3.7, 6);
  // Animations chosen again start over, too.
  viewer.setAnimation("Hold", false, 0.5);
  viewer.mixer.update(0.35);
  expect(node.position.x).toBeCloseTo(1, 6);
  viewer.setAnimation("Slide", false, 0.5);
  viewer.mixer.update(0.35);
  expect(node.position.x).toBeCloseTo(3.7, 6);
});

test("while paused, a newly chosen animation shows its first frame at once", () => {
  const { viewer, node, animations } = animationHarness();
  viewer.setAnimation("Hold", false, 0.5);
  viewer.mixer.update(0.5);
  viewer.setAnimation("Slide", true, 0.5);
  expect(node.position.x).toBe(3);
  expect(viewer.mixer.existingAction(animations[0]).isScheduled()).toBe(false);
});

test("posing while animations blend stops both, and only the new one comes back", () => {
  const { viewer, node } = animationHarness();
  viewer.setAnimation("Hold", false, 0.5);
  viewer.setAnimation("Slide", false, 0.5);
  viewer.mixer.update(0.1);
  viewer.setPoseMode(true);
  // The rest pose, for the rig to pose.
  expect(node.position.x).toBe(0);
  viewer.setPoseMode(false);
  expect(node.position.x).toBeCloseTo(3.2, 6);
  viewer.mixer.update(0.1);
  expect(node.position.x).toBeCloseTo(3.4, 6);
});

test("an animation chosen while posing comes back at full weight, from its start", () => {
  const { viewer, node } = animationHarness();
  viewer.setAnimation("Hold", false, 0.5);
  viewer.mixer.update(0.2);
  viewer.setPoseMode(true);
  viewer.setAnimation("Slide", false, 0.5);
  viewer.setPoseMode(false);
  expect(node.position.x).toBeCloseTo(3, 6);
  viewer.mixer.update(0.15);
  expect(node.position.x).toBeCloseTo(3.3, 6);
});

test("with no animation chosen, a weapon or vehicle plays its first clip once and holds its last frame", () => {
  const { viewer, node } = animationHarness("Slide");
  viewer.setAnimation(null, false, 0.5, true);
  expect(node.position.x).toBe(3);
  viewer.mixer.update(0.5);
  expect(node.position.x).toBeCloseTo(4, 6);
  viewer.mixer.update(0.75);
  expect(node.position.x).toBe(5);
  viewer.mixer.update(1);
  expect(node.position.x).toBe(5);
  // The frame loop stops at a paused action.
  expect(viewer.action.paused).toBe(true);
});

test("pausing, changing speed or choosing nothing again doesn't restart the first clip", () => {
  const { viewer, node } = animationHarness("Slide");
  viewer.setAnimation(null, false, 0.5, true);
  viewer.mixer.update(0.5);
  viewer.setAnimation(null, true, 0.5, true);
  expect(node.position.x).toBeCloseTo(4, 6);
  viewer.setAnimation(null, false, 0.05, true);
  expect(node.position.x).toBeCloseTo(4, 6);
  viewer.mixer.update(1);
  viewer.setAnimation(null, false, 0.5, true);
  viewer.mixer.update(0.25);
  expect(node.position.x).toBe(5);
});

test("paused, the first clip shows its first frame, and plays once when unpaused", () => {
  const { viewer, node } = animationHarness("Slide");
  viewer.setAnimation(null, true, 0.5, true);
  expect(node.position.x).toBe(3);
  viewer.setAnimation(null, false, 0.5, true);
  expect(node.position.x).toBe(3);
  viewer.mixer.update(1.5);
  expect(node.position.x).toBe(5);
});

test("players show no animation until one is chosen, and chosen ones loop", () => {
  const { viewer, node } = animationHarness("Slide");
  viewer.setAnimation(null, false, 0.5);
  viewer.setAnimation(null, false, 0.5, false);
  expect(viewer.action).toBeNull();
  expect(node.position.x).toBe(0);
  viewer.setAnimation("Slide", false, 0.5);
  viewer.mixer.update(1.25);
  expect(node.position.x).toBeCloseTo(3.5, 6);
});

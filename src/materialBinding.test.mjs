import { expect, test, vi } from "vitest";
import {
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from "three";
import { configureMaterial, createMaterialBinding } from "./materialBinding";

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function texture(name) {
  const result = new Texture();
  result.name = name;
  vi.spyOn(result, "dispose");
  return result;
}

function fixture(definition = { name: "base" }, overrides = {}) {
  const frames = new Set();
  const viewer = {
    invalidate: vi.fn(),
    subscribeFrame: vi.fn((callback) => {
      frames.add(callback);
      return () => frames.delete(callback);
    }),
  };
  const loaded = [];
  const loadTexture = vi.fn(async (url) => {
    const result = texture(url);
    loaded.push(result);
    return result;
  });
  const materials = [new MeshStandardMaterial(), new MeshStandardMaterial()];
  const binding = createMaterialBinding({
    materials,
    definition,
    viewer,
    loadTexture,
    ...overrides,
  });
  return {
    materials,
    binding,
    loaded,
    loadTexture,
    viewer,
    frames,
    tick: (seconds) => frames.forEach((callback) => callback(seconds)),
  };
}

test("all runtime material instances receive correctly oriented color and packed metallic textures", async () => {
  const app = fixture({ name: "base", emissiveTexture: true });
  app.binding.setTextures({
    colorUrls: ["color"],
    metallicUrls: ["packed"],
    fallbackUrl: "white",
  });
  await flush();
  for (const material of app.materials) {
    expect(material.map.name).toBe("color");
    expect(material.map.colorSpace).toBe(SRGBColorSpace);
    expect(material.map.flipY).toBe(false);
    expect(material.emissiveMap).toBe(material.map);
    expect(material.metalnessMap.name).toBe("packed");
    expect(material.roughnessMap).toBe(material.metalnessMap);
    expect(material.roughnessMap.colorSpace).toBe(NoColorSpace);
    expect(material.roughnessMap.flipY).toBe(false);
  }
  expect(app.materials[0].map).toBe(app.materials[1].map);
  expect(app.viewer.subscribeFrame).not.toHaveBeenCalled();
  app.binding.dispose();
  for (const result of app.loaded)
    expect(result.dispose).toHaveBeenCalledTimes(1);
});

test("skin, animation frame and placeholder textures repeat past their edges and use anisotropic filtering", async () => {
  const app = fixture({ name: "glow", frameCount: 2 });
  app.binding.setTextures({ colorUrls: ["c0", "c1"], fallbackUrl: "white" });
  await flush();
  expect(app.loaded.map(({ name }) => name).sort()).toEqual([
    "c0",
    "c1",
    "white",
  ]);
  for (const result of app.loaded) {
    expect(
      [result.wrapS, result.wrapT, result.anisotropy],
      result.name,
    ).toEqual([RepeatWrapping, RepeatWrapping, 4]);
  }
  app.binding.dispose();
});

test("unconfigured and hidden material slots stay hidden without loading textures or running frames", () => {
  for (const definition of [undefined, { name: "flare", hidden: true }]) {
    const material = new MeshStandardMaterial();
    configureMaterial(material, definition);
    expect(material.visible).toBe(false);
    const loadTexture = vi.fn();
    const app = fixture(definition, { definition, loadTexture });
    app.binding.setTextures({ fallbackUrl: "white" });
    expect(loadTexture).not.toHaveBeenCalled();
    expect(app.viewer.subscribeFrame).not.toHaveBeenCalled();
    app.binding.dispose();
  }
});

test("material factors preserve linear values, transparency and cutoff", () => {
  const material = new MeshStandardMaterial();
  configureMaterial(material, {
    name: "glass",
    baseColorFactor: [0.2, 0.4, 0.6, 0.5],
    emissiveFactor: [0.1, 0.3, 0.5],
    alphaMode: "BLEND",
    metallicFactor: 0,
    roughnessFactor: 1,
  });
  expect(material.color.toArray()).toEqual([0.2, 0.4, 0.6]);
  expect(material.emissive.toArray()).toEqual([0.1, 0.3, 0.5]);
  expect(material.opacity).toBe(0.5);
  expect(material.transparent).toBe(true);
  expect(material.depthWrite).toBe(false);
  expect(material.metalness).toBe(0);
  expect(material.roughness).toBe(1);
  configureMaterial(material, {
    name: "mask",
    alphaMode: "MASK",
    alphaCutoff: 0,
  });
  expect(material.transparent).toBe(false);
  expect(material.depthWrite).toBe(true);
  expect(material.alphaTest).toBe(0);
  configureMaterial(material, {
    name: "mask",
    alphaMode: "MASK",
    alphaCutoff: 0.75,
  });
  expect(material.alphaTest).toBe(0.75);
  configureMaterial(material, { name: "opaque", alphaMode: "OPAQUE" });
  expect(material.alphaTest).toBe(0);
});

test("nonmetallic fully rough materials do not load unused metallic images", async () => {
  const app = fixture({ name: "glow", metallicFactor: 0, roughnessFactor: 1 });
  app.binding.setTextures({
    colorUrls: ["color"],
    metallicUrls: ["unused"],
    fallbackUrl: "white",
  });
  await flush();
  expect(app.loadTexture.mock.calls).toEqual([["color"]]);
  expect(app.materials[0].metalnessMap).toBe(null);
  expect(app.materials[0].roughnessMap).toBe(null);
  app.binding.dispose();
});

test("animated color, emissive and metallic frames share one time-based playback clock", async () => {
  const app = fixture({
    name: "glow",
    frameCount: 3,
    frameTimings: [2, 1, 1],
    emissiveTexture: true,
  });
  app.binding.setTextures({
    colorUrls: ["c0", "c1", "c2"],
    metallicUrls: ["m0", "m1", "m2"],
    fallbackUrl: "white",
  });
  await flush();
  expect(app.viewer.subscribeFrame).toHaveBeenCalledTimes(1);
  app.tick(1 / 120);
  app.tick(1 / 120);
  expect(app.materials[0].map.name).toBe("c0");
  app.tick(1 / 60);
  expect(app.materials[0].map.name).toBe("c1");
  expect(app.materials[0].emissiveMap.name).toBe("c1");
  expect(app.materials[0].metalnessMap.name).toBe("m1");
  app.binding.setSlowMode(true);
  const count = app.loadTexture.mock.calls.length;
  app.tick(0.3);
  expect(app.materials[0].map.name).toBe("c1");
  app.tick(0.04);
  expect(app.materials[0].map.name).toBe("c2");
  expect(app.materials[0].metalnessMap.name).toBe("m2");
  expect(app.loadTexture).toHaveBeenCalledTimes(count);
  app.binding.dispose();
  expect(app.frames.size).toBe(0);
});

test("replacement textures keep the old preview until ready, then dispose only replaced images", async () => {
  let finish;
  const original = texture("original");
  const replacement = texture("replacement");
  const packed = texture("packed");
  const loadTexture = vi.fn((url) =>
    url === "replacement"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(url === "original" ? original : packed),
  );
  const app = fixture({ name: "base" }, { loadTexture });
  app.binding.setTextures({
    colorUrls: ["original"],
    metallicUrls: ["packed"],
    fallbackUrl: "white",
  });
  await flush();
  app.binding.setTextures({
    colorUrls: ["replacement"],
    metallicUrls: ["packed"],
    fallbackUrl: "white",
  });
  expect(app.materials[0].map).toBe(original);
  expect(original.dispose).not.toHaveBeenCalled();
  finish(replacement);
  await flush();
  expect(app.materials[0].map).toBe(replacement);
  expect(original.dispose).toHaveBeenCalledTimes(1);
  expect(packed.dispose).not.toHaveBeenCalled();
  expect(loadTexture.mock.calls).toEqual([
    ["original"],
    ["packed"],
    ["replacement"],
  ]);
  app.binding.dispose();
  expect(replacement.dispose).toHaveBeenCalledTimes(1);
  expect(packed.dispose).toHaveBeenCalledTimes(1);
});

test("superseded and unmounted async loads never update the scene and release their textures", async () => {
  const pending = new Map();
  const loadTexture = vi.fn(
    (url) => new Promise((resolve) => pending.set(url, resolve)),
  );
  const app = fixture(
    { name: "base", metallicFactor: 0, roughnessFactor: 1 },
    { loadTexture },
  );
  const stale = texture("stale");
  const current = texture("current");
  app.binding.setTextures({ colorUrls: ["stale"], fallbackUrl: "white" });
  app.binding.setTextures({ colorUrls: ["current"], fallbackUrl: "white" });
  pending.get("stale")(stale);
  await flush();
  expect(app.materials[0].map).toBe(null);
  expect(stale.dispose).toHaveBeenCalledTimes(1);
  app.binding.dispose();
  const invalidations = app.viewer.invalidate.mock.calls.length;
  pending.get("current")(current);
  await flush();
  expect(app.materials[0].map).toBe(null);
  expect(current.dispose).toHaveBeenCalledTimes(1);
  expect(app.viewer.invalidate).toHaveBeenCalledTimes(invalidations);
});

test("a partially failed texture sequence disposes completed and late frames", async () => {
  const ready = texture("ready");
  const late = texture("late");
  let reject;
  let finish;
  const onError = vi.fn();
  const app = fixture(
    { name: "frames", frameCount: 3, metallicFactor: 0, roughnessFactor: 1 },
    {
      onError,
      loadTexture: (url) =>
        url === "ready"
          ? Promise.resolve(ready)
          : url === "fail"
            ? new Promise((_, rejectLoad) => {
                reject = rejectLoad;
              })
            : new Promise((resolve) => {
                finish = resolve;
              }),
    },
  );
  app.binding.setTextures({
    colorUrls: ["ready", "fail", "late"],
    fallbackUrl: "white",
  });
  await flush();
  reject(new Error("failed"));
  await flush();
  expect(onError).toHaveBeenCalledTimes(1);
  expect(ready.dispose).toHaveBeenCalledTimes(1);
  finish(late);
  await flush();
  expect(late.dispose).toHaveBeenCalledTimes(1);
  expect(app.materials[0].map).toBe(null);
  app.binding.dispose();
});

test("repeated placeholder frame URLs load and dispose one texture per channel", async () => {
  const app = fixture({ name: "frames", frameCount: 6 });
  app.binding.setTextures({ fallbackUrl: "white" });
  await flush();
  expect(app.loadTexture.mock.calls).toEqual([["white"], ["white"]]);
  app.binding.dispose();
  app.binding.dispose();
  for (const result of app.loaded)
    expect(result.dispose).toHaveBeenCalledTimes(1);
});

test("clearing textures shows the material as it came, frees them, and the same textures can load again", async () => {
  const app = fixture();
  const own = texture("own");
  app.materials.forEach((material) => {
    material.map = own;
  });
  const rebound = createMaterialBinding({
    materials: app.materials,
    definition: { name: "base" },
    viewer: app.viewer,
    loadTexture: app.loadTexture,
  });
  rebound.setTextures({
    colorUrls: ["skin"],
    metallicUrls: ["packed"],
    fallbackUrl: "white",
  });
  await flush();
  const [color, metallic] = app.loaded;
  expect(app.materials[0].map).toBe(color);
  rebound.clearTextures();
  for (const material of app.materials) {
    expect(material.map).toBe(own);
    expect(material.metalnessMap).toBeNull();
  }
  expect(color.dispose).toHaveBeenCalledOnce();
  expect(metallic.dispose).toHaveBeenCalledOnce();
  // The same URLs aren't skipped as already shown.
  rebound.setTextures({
    colorUrls: ["skin"],
    metallicUrls: ["packed"],
    fallbackUrl: "white",
  });
  await flush();
  expect(app.materials[0].map).toBe(app.loaded[2]);
  rebound.dispose();
  expect(own.dispose).not.toHaveBeenCalled();
});

test("clearing an animated material's textures stops its frames until new ones load", async () => {
  const app = fixture({
    name: "case",
    frameCount: 2,
    metallicFactor: 0,
    roughnessFactor: 1,
  });
  app.binding.setTextures({ colorUrls: ["a", "b"], fallbackUrl: "white" });
  await flush();
  expect(app.frames.size).toBe(1);
  app.binding.clearTextures();
  expect(app.frames.size).toBe(0);
  app.binding.setTextures({ colorUrls: ["a", "b"], fallbackUrl: "white" });
  await flush();
  expect(app.frames.size).toBe(1);
  app.binding.dispose();
  expect(app.frames.size).toBe(0);
});

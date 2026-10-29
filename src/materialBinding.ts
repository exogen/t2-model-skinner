import { captureActivity } from "./captureActivity";
import {
  Material,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from "three";
import { hasMetallicMap, type MaterialDefinition } from "./models";
import type Viewer from "./Viewer";

type TextureChannel = "color" | "metallic";
type TextureRequest = { urls: string[]; textures: Set<Texture> };
type MaterialMaps = Pick<
  MeshStandardMaterial,
  "map" | "emissiveMap" | "metalnessMap" | "roughnessMap"
>;

function isPbrMaterial(material: Material): material is MeshStandardMaterial {
  return (material as MeshStandardMaterial).isMeshStandardMaterial === true;
}

export function configureMaterial(
  material: Material,
  definition?: MaterialDefinition,
) {
  material.visible = definition != null && !definition.hidden;
  if (!material.visible || !isPbrMaterial(material)) return;

  if (definition?.baseColorFactor) {
    material.color.fromArray(definition.baseColorFactor);
    material.opacity = definition.baseColorFactor[3];
  }
  if (definition?.emissiveFactor)
    material.emissive.fromArray(definition.emissiveFactor);
  material.metalness = definition?.metallicFactor ?? 1;
  material.roughness = definition?.roughnessFactor ?? 1;
  if (definition?.alphaMode) {
    material.transparent = definition.alphaMode === "BLEND";
    material.depthWrite = !material.transparent;
    material.alphaTest =
      definition.alphaMode === "MASK" ? (definition.alphaCutoff ?? 0.5) : 0;
  } else if (definition?.alphaCutoff != null && material.alphaTest > 0) {
    material.alphaTest = definition.alphaCutoff;
  }
  material.needsUpdate = true;
}

function disposeTextures(textures: Iterable<Texture>) {
  for (const texture of Array.from(new Set(textures))) texture.dispose();
}

// A glTF material can have several runtime instances, for example when its
// primitives have different vertex attributes. Keep every instance in sync.
export function createMaterialBinding({
  materials,
  definition,
  viewer,
  loadTexture = (url: string) => new TextureLoader().loadAsync(url),
  onError = (error: unknown) =>
    console.error("Unable to load model texture", error),
}: {
  materials: Material[];
  definition?: MaterialDefinition;
  viewer: Pick<Viewer, "invalidate" | "subscribeFrame">;
  loadTexture?: (url: string) => Promise<Texture>;
  onError?: (error: unknown) => void;
}) {
  const pbrMaterials = materials.filter(isPbrMaterial);
  const originalMaps = new Map<MeshStandardMaterial, MaterialMaps>(
    pbrMaterials.map((material) => [
      material,
      {
        map: material.map,
        emissiveMap: material.emissiveMap,
        metalnessMap: material.metalnessMap,
        roughnessMap: material.roughnessMap,
      },
    ]),
  );
  const frameCount = Math.max(1, definition?.frameCount ?? 1);
  // Existing frameTimings are display frames at 60 Hz. Using elapsed time
  // preserves their speed on high-refresh displays and during slow mode.
  const durations = Array.from({ length: frameCount }, (_, index) =>
    Math.max(1, definition?.frameTimings?.[index] ?? 1),
  );
  const cycleDuration = durations.reduce((sum, duration) => sum + duration, 0);
  const textures: Record<TextureChannel, Texture[]> = {
    color: [],
    metallic: [],
  };
  const requests: Partial<Record<TextureChannel, TextureRequest>> = {};
  const currentUrls: Partial<Record<TextureChannel, string[]>> = {};
  let frameIndex = 0;
  let elapsedTicks = 0;
  let speed = 1;
  let disposed = false;
  let unsubscribe: (() => void) | undefined;
  const activity = captureActivity.register(
    `Texture ${definition?.name ?? "hidden"}`,
  );
  const errors: Partial<Record<TextureChannel, unknown>> = {};
  const publish = () =>
    activity.update(
      Object.keys(requests).length,
      errors.color ?? errors.metallic,
    );

  for (const material of materials) configureMaterial(material, definition);
  const active =
    definition != null && !definition.hidden && pbrMaterials.length > 0;

  const applyFrame = () => {
    for (const material of pbrMaterials) {
      const color = textures.color[frameIndex] ?? textures.color[0];
      const metallic = textures.metallic[frameIndex] ?? textures.metallic[0];
      let changedShader = false;
      if (color) {
        changedShader ||= material.map == null;
        material.map = color;
        if (definition?.emissiveTexture) {
          changedShader ||= material.emissiveMap == null;
          material.emissiveMap = color;
        }
      }
      if (metallic) {
        changedShader ||=
          material.metalnessMap == null || material.roughnessMap == null;
        material.metalnessMap = metallic;
        material.roughnessMap = metallic;
      } else if (definition && !hasMetallicMap(definition)) {
        changedShader ||=
          material.metalnessMap != null || material.roughnessMap != null;
        material.metalnessMap = null;
        material.roughnessMap = null;
      }
      if (changedShader) material.needsUpdate = true;
    }
    viewer.invalidate();
  };

  const advanceFrame = (deltaSeconds: number) => {
    if (disposed || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    elapsedTicks = (elapsedTicks + deltaSeconds * 60 * speed) % cycleDuration;
    let remaining = elapsedTicks;
    let nextFrame = 0;
    while (nextFrame < frameCount - 1 && remaining >= durations[nextFrame]) {
      remaining -= durations[nextFrame++];
    }
    if (frameIndex !== nextFrame) {
      frameIndex = nextFrame;
      applyFrame();
    }
  };

  const cancelRequest = (channel: TextureChannel) => {
    const request = requests[channel];
    delete requests[channel];
    if (request) disposeTextures(request.textures);
  };

  const loadChannel = (channel: TextureChannel, urls: string[]) => {
    const previousUrls = requests[channel]?.urls ?? currentUrls[channel];
    if (
      previousUrls?.length === urls.length &&
      previousUrls.every((url, index) => url === urls[index])
    )
      return;
    cancelRequest(channel);
    delete errors[channel];
    const request: TextureRequest = { urls, textures: new Set() };
    requests[channel] = request;
    publish();
    const loads = new Map<string, Promise<Texture | null>>();
    for (const url of urls) {
      if (loads.has(url)) continue;
      loads.set(
        url,
        loadTexture(url).then((texture) => {
          if (disposed || requests[channel] !== request) {
            texture.dispose();
            return null;
          }
          texture.flipY = false;
          texture.colorSpace =
            channel === "color" ? SRGBColorSpace : NoColorSpace;
          // glTF's default wrapping, and model-viewer's anisotropic filtering.
          texture.wrapS = RepeatWrapping;
          texture.wrapT = RepeatWrapping;
          texture.anisotropy = 4;
          texture.needsUpdate = true;
          request.textures.add(texture);
          return texture;
        }),
      );
    }
    void Promise.all(urls.map((url) => loads.get(url)!))
      .then((loaded) => {
        if (disposed || requests[channel] !== request) return;
        delete requests[channel];
        const oldTextures = textures[channel];
        textures[channel] = loaded.filter(
          (texture): texture is Texture => texture != null,
        );
        currentUrls[channel] = urls;
        applyFrame();
        disposeTextures(oldTextures);
        publish();
        if (frameCount > 1 && !unsubscribe)
          unsubscribe = viewer.subscribeFrame(advanceFrame);
      })
      .catch((error: unknown) => {
        if (disposed || requests[channel] !== request) return;
        cancelRequest(channel);
        errors[channel] = error;
        publish();
        onError(error);
      });
  };

  const clearTextures = () => {
    unsubscribe?.();
    unsubscribe = undefined;
    cancelRequest("color");
    cancelRequest("metallic");
    originalMaps.forEach((maps, material) => {
      Object.assign(material, maps);
      material.needsUpdate = true;
    });
    disposeTextures([...textures.color, ...textures.metallic]);
    textures.color = [];
    textures.metallic = [];
    delete currentUrls.color;
    delete currentUrls.metallic;
  };

  if (active) applyFrame();
  else viewer.invalidate();

  return {
    setTextures({
      colorUrls,
      metallicUrls,
      fallbackUrl,
    }: {
      colorUrls?: string[];
      metallicUrls?: string[];
      fallbackUrl: string;
    }) {
      if (disposed || !active) return;
      const frameUrls = (urls?: string[]) =>
        Array.from(
          { length: frameCount },
          (_, index) => urls?.[index] || urls?.[0] || fallbackUrl,
        );
      loadChannel("color", frameUrls(colorUrls));
      if (hasMetallicMap(definition)) {
        loadChannel("metallic", frameUrls(metallicUrls));
      }
    },
    setSlowMode(enabled: boolean) {
      speed = enabled ? 0.05 : 1;
    },
    /** Shows the material with the textures it came with again. */
    clearTextures() {
      if (disposed) return;
      clearTextures();
      delete errors.color;
      delete errors.metallic;
      publish();
      viewer.invalidate();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      activity.dispose();
      clearTextures();
      viewer.invalidate();
    },
  };
}

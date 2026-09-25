import modelConfig, { isTextureSourceMaterial } from "./models";

// Read only the PNG header; decoding the pixels is left to the image worker.
function pngSize(buffer: ArrayBuffer): [number, number] | undefined {
  if (buffer.byteLength < 24) return;
  const view = new DataView(buffer);
  if (
    view.getUint32(0) !== 0x89504e47 ||
    view.getUint32(4) !== 0x0d0a1a0a ||
    view.getUint32(12) !== 0x49484452
  ) {
    return;
  }
  return [view.getUint32(16), view.getUint32(20)];
}

export async function detectTextureSizeMultiplier(
  model: string,
  images: Record<string, string[]>,
  defaults: Record<string, string[]>,
  loadImage: (url: string) => Promise<ArrayBuffer>
): Promise<number | undefined> {
  const sizes = new Map<string, Promise<[number, number] | undefined>>();
  const loadSize = (url: string) => {
    if (!sizes.has(url)) {
      sizes.set(url, loadImage(url).then(pngSize));
    }
    return sizes.get(url)!;
  };
  const actualModel = model === "hfemale" ? "hmale" : model;
  // Shared/hidden copies may have different default sizes. Only the material
  // which supplies that texture to the preview determines its resolution.
  const materials = modelConfig.materials[actualModel].filter((material) =>
    isTextureSourceMaterial(material, actualModel)
  );
  const scales = await Promise.all(
    materials.flatMap((material) => {
      const file = material.file ?? material.name;
      const [width, height] = material.size ?? [512, 512];
      return Array.from(
        { length: material.frameCount ?? 1 },
        async (_, frame) => {
          const fallback = defaults[file]?.[frame];
          const url = images[file]?.[frame] ?? fallback;
          if (!url) return;
          let size;
          try {
            size = await loadSize(url);
          } catch {
            // Match the canvas loader's optional-material and fallback behavior.
            if (material.hasDefault === false || !fallback || fallback === url)
              return;
            size = await loadSize(fallback).catch(() => undefined);
          }
          if (!size) return;
          const widthScale = Math.max(1, size[0] / width);
          const heightScale = Math.max(1, size[1] / height);
          // Some shipped skins increase only one dimension (e.g. Neon shocklance).
          // Normalize to the larger scale, never downsample the HD dimension.
          if ([1, 2, 4].includes(widthScale) && [1, 2, 4].includes(heightScale))
            return Math.max(widthScale, heightScale);
          if (size[0] > width || size[1] > height) {
            throw new Error(
              `Unsupported texture size: ${size[0]} × ${size[1]} for ${material.label ?? file}. ` +
              `Use power-of-two multiples of ${width} × ${height}, up to ${width * 4} × ${height * 4}.`
            );
          }
        }
      );
    })
  );
  const supported = scales.filter((scale) => scale != null);
  // A shared resolution must preserve the largest material/frame in the skin.
  return supported.length ? Math.max(...supported) : undefined;
}

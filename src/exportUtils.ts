import JSZip from "jszip";
import { saveAs } from "file-saver";
import { getSkinAssetUrl } from "./deployPaths";
import { imageUrlToArrayBuffer } from "./imageUtils";
import { modelToModelType, type MaterialDefinition } from "./models";
import type { ImageFunctions } from "./imageProcessing.worker";

export function createZipFile(
  files: Array<{ name: string; data: ArrayBuffer | Blob }>
) {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(`textures/skins/${file.name}`, file.data);
  }
  return zip;
}

export async function saveZipFile(zip: JSZip, name: string) {
  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, name);
}

export function savePngFile(imageUrl: string, name: string) {
  saveAs(imageUrl, name);
}

// These snapshots contain image data, so switching sessions cannot change an export.
export async function exportSkinTextures(
  snapshots: Array<{
    material: MaterialDefinition;
    frameIndex: number;
    colorImageUrl: string;
    metallicImageUrl?: string;
  }>,
  {
    format,
    name,
    model,
    sizeMultiplier,
  }: {
    format: string;
    name: string;
    model: string;
    sizeMultiplier: number;
  },
  combineColorAndAlpha: ImageFunctions["combineColorAndAlphaImageUrls"]
) {
  name = name.trim() || "MyCustomSkin";
  const modelType = modelToModelType(model);
  if (!modelType) throw new Error("Unknown model type");
  const images = await Promise.all(
    snapshots.map(
      async ({ material, frameIndex, colorImageUrl, metallicImageUrl }) => {
        let filename = material.file ?? material.name;
        if (modelType === "player") {
          filename = `${name}.${model}`;
        } else if ((material.frameCount ?? 1) > 1) {
          const match = filename.match(/^(.+)(\d\d)$/);
          if (!match) throw new Error("Unexpected animation filename");
          filename = `${match[1]}${frameIndex.toString().padStart(2, "0")}`;
        }
        return {
          filename: `${filename}.png`,
          imageUrl: metallicImageUrl
            ? await combineColorAndAlpha({ colorImageUrl, metallicImageUrl })
            : colorImageUrl,
        };
      }
    )
  );

  if (format === "png") {
    images.forEach(({ imageUrl, filename }) =>
      savePngFile(imageUrl, filename)
    );
  } else if (format === "vl2") {
    const files = await Promise.all(
      images.map(async ({ imageUrl, filename }) => ({
        name: filename,
        data: await imageUrlToArrayBuffer(imageUrl),
      }))
    );
    const camelCaseModel = model.replace(
      /(?:^([a-z])|_([a-z]))/g,
      (match, a, b) => (a || b).toUpperCase()
    );
    const prefix = {
      player: "zPlayerSkin",
      weapon: `zWeapon${camelCaseModel}`,
      vehicle: `z${camelCaseModel}`,
    }[modelType];
    const suffix = sizeMultiplier > 1 ? `-@${sizeMultiplier}x` : "";
    await saveZipFile(createZipFile(files), `${prefix}-${name}${suffix}.vl2`);
  }
}

export async function collectFiles(
  files: string[],
  { skipNotFound = false }: { skipNotFound?: boolean } = {}
) {
  const results = await Promise.all(
    files.map(async (fileName) => {
      const url = getSkinAssetUrl(fileName);
      const res = await fetch(url);
      if (!res.ok) {
        if (skipNotFound && res.status === 404) {
          return null;
        }
        throw new Error(
          `Unable to download ${fileName}: ${res.status} ${res.statusText}`
        );
      }
      const arrayBuffer = await res.arrayBuffer();
      return {
        name: fileName.replace(/@1x\.png$/, ".png"),
        data: arrayBuffer,
      };
    })
  );
  return results.filter((fileInfo) => fileInfo != null);
}

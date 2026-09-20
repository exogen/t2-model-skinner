import JSZip from "jszip";
import { Canvas as FabricCanvas, FabricObject, util } from "fabric";
import { serializeCanvas, type CanvasSnapshot } from "./fabricUtils";
import modelConfig, { type MaterialDefinition } from "./models";

// New saves use version 2; the reader converts version 1 records in memory.
export const SKIN_PROJECT_VERSION = 2;

export interface SkinProjectMaterial {
  textureSize: [number, number];
  color: CanvasSnapshot;
  metallic: CanvasSnapshot;
}

export interface SkinProject {
  version: number;
  model?: string;
  name?: string;
  materials: Record<string, SkinProjectMaterial>;
}

export interface SkinProjectMaterialInput {
  name: string;
  textureSize: [number, number];
  colorCanvas: FabricCanvas;
  metallicCanvas?: FabricCanvas | null;
}

export interface PreparedMaterial {
  color: FabricObject[];
  metallic: FabricObject[];
}

export function materialArchiveKey(
  material: MaterialDefinition,
  frame: number
) {
  return (material.frameCount ?? 1) > 1
    ? `${material.name}-frame${frame}`
    : material.name;
}

function imageEntries(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(imageEntries);
  const object = value as Record<string, unknown>;
  const children = Object.values(object).flatMap(imageEntries);
  return typeof object.src === "string" &&
    String(object.type).toLowerCase() === "image"
    ? [object, ...children]
    : children;
}

export function captureSkinProject(
  materials: SkinProjectMaterialInput[],
  model?: string,
  name?: string
): SkinProject {
  return {
    version: SKIN_PROJECT_VERSION,
    model,
    name,
    materials: Object.fromEntries(
      materials.map((material) => [
        material.name,
        {
          textureSize: [...material.textureSize] as [number, number],
          color: serializeCanvas(material.colorCanvas),
          metallic: material.metallicCanvas
            ? serializeCanvas(material.metallicCanvas)
            : { objects: [] },
        },
      ])
    ),
  };
}

// Encoding owns plain snapshots and never reads live canvases after an await.
export async function createSkinProjectZip(
  project: SkinProject
): Promise<JSZip> {
  const zip = new JSZip();
  zip.file(
    "project.json",
    JSON.stringify({
      version: SKIN_PROJECT_VERSION,
      model: project.model,
      name: project.name,
    })
  );
  for (const [name, snapshot] of Object.entries(project.materials)) {
    const material = structuredClone(snapshot);
    const folder = zip.folder(name)!;
    const images: Record<string, string> = {};
    for (const [index, image] of Array.from(
      imageEntries(material).entries()
    )) {
      // Fabric's image JSON uses the original source, before filters or cropping.
      const response = await fetch(image.src as string);
      if (!response.ok) throw new Error("Unable to save a project image");
      const filename = `image-${index}`;
      images[filename] = response.headers.get("content-type") || "image/png";
      folder.file(filename, await response.arrayBuffer());
      image.src = filename;
    }
    folder.file(
      "material.json",
      JSON.stringify({ ...material, images }, null, 2)
    );
  }
  return zip;
}

// Version 1 stored only a subset of image properties. Restore the recorded
// values; missing image skew and the original filter order cannot be recovered.
interface LegacyImage {
  filename: string;
  zIndex: number;
  left: number;
  top: number;
  angle: number;
  scaleX: number;
  scaleY: number;
  flipX: boolean;
  flipY: boolean;
  locked: boolean;
  filterSettings?: {
    hueRotation: number;
    saturation: number;
    brightness: number;
    contrast: number;
    opacity: number;
  };
}
interface LegacyMaterial {
  textureSize: [number, number];
  background?: LegacyImage;
  metallicBackground?: LegacyImage;
  objects: LegacyImage[];
  metallicObjects?: LegacyImage[];
  metallicStrokes?: Array<Record<string, unknown> & { zIndex: number }>;
}

async function imageUrl(folder: JSZip, filename: string, mime = "image/png") {
  const image = folder.file(filename);
  if (!image) throw new Error(`Missing project image: ${filename}`);
  return `data:${mime};base64,${await image.async("base64")}`;
}

async function readLegacyMaterial(folder: JSZip, material: LegacyMaterial) {
  const restoreImage = async (
    image: LegacyImage,
    metallic: boolean,
    base = false
  ) => {
    const { filename, zIndex, locked, filterSettings, ...transform } = image;
    const filters: Record<string, unknown>[] = metallic
      ? [{ type: "Grayscale" }]
      : [];
    if (filterSettings?.hueRotation)
      filters.push({
        type: "HueRotation",
        rotation: filterSettings.hueRotation,
      });
    if (filterSettings?.saturation)
      filters.push({
        type: "Saturation",
        saturation: filterSettings.saturation,
      });
    if (filterSettings?.brightness)
      filters.push({
        type: "Brightness",
        brightness: filterSettings.brightness,
      });
    if (filterSettings?.contrast)
      filters.push({ type: "Contrast", contrast: filterSettings.contrast });
    return {
      type: "Image",
      ...transform,
      filters,
      src: await imageUrl(folder, filename),
      opacity: filterSettings?.opacity ?? 1,
      selectable: !base,
      lockMovementX: base || locked,
      lockMovementY: base || locked,
      lockScalingX: base || locked,
      lockScalingY: base || locked,
      lockRotation: base || locked,
      ...(base ? { hoverCursor: "default", moveCursor: "default" } : {}),
    };
  };
  const color = await Promise.all([
    ...(material.background
      ? [restoreImage(material.background, false, true)]
      : []),
    ...material.objects
      .slice()
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((image) => restoreImage(image, false)),
  ]);
  const metallicLayers = [
    ...(material.metallicObjects ?? []).map((image) => ({
      zIndex: image.zIndex,
      object: restoreImage(image, true),
    })),
    ...(material.metallicStrokes ?? []).map(({ zIndex, ...object }) => ({
      zIndex,
      object: Promise.resolve(object),
    })),
  ].sort((a, b) => a.zIndex - b.zIndex);
  const metallic = await Promise.all([
    ...(material.metallicBackground
      ? [restoreImage(material.metallicBackground, true, true)]
      : []),
    ...metallicLayers.map((layer) => layer.object),
  ]);
  return {
    textureSize: material.textureSize,
    color: { objects: color },
    metallic: { objects: metallic },
  };
}

export async function readSkinProjectZip(
  file: File | Blob
): Promise<SkinProject> {
  const zip = await JSZip.loadAsync(file);
  // Version 1 stored metadata per material and had no root project manifest.
  const manifest = zip.file("project.json");
  const metadata = manifest
    ? (JSON.parse(await manifest.async("string")) as {
        version: number;
        model?: string;
        name?: string;
      })
    : { version: 1 };
  if (metadata.version !== 1 && metadata.version !== SKIN_PROJECT_VERSION) {
    throw new Error(
      "This project was saved by an unsupported editor version"
    );
  }
  const materials: SkinProject["materials"] = {};
  for (const filename of Object.keys(zip.files)) {
    const match = /^([^/]+)\/material\.json$/.exec(filename);
    if (!match) continue;
    const folder = zip.folder(match[1])!;
    const json = JSON.parse(
      await folder.file("material.json")!.async("string")
    );
    if (metadata.version === 1) {
      materials[match[1]] = await readLegacyMaterial(folder, json);
    } else {
      const material = json as SkinProjectMaterial & {
        images: Record<string, string>;
      };
      for (const image of imageEntries(material)) {
        const filename = image.src as string;
        image.src = await imageUrl(
          folder,
          filename,
          material.images[filename]
        );
      }
      materials[match[1]] = {
        textureSize: material.textureSize,
        color: material.color,
        metallic: material.metallic,
      };
    }
  }
  if (!Object.keys(materials).length)
    throw new Error("No materials found in this project");
  return { ...metadata, materials };
}

export function getProjectTarget(project: SkinProject, currentModel: string) {
  const modelMaterials = (model: string) =>
    modelConfig.materials[model === "hfemale" ? "hmale" : model];
  const matches = (model: string) => {
    const definitions = modelMaterials(model);
    return (
      definitions &&
      Object.keys(project.materials).every((key) =>
        definitions.some((material) =>
          Array.from({ length: material.frameCount ?? 1 }, (_, frame) =>
            materialArchiveKey(material, frame)
          ).includes(key)
        )
      )
    );
  };
  // Old player archives share "base" and cannot distinguish armor models. Keep
  // the user's selected model in that case; infer unique weapon/vehicle matches.
  const candidates = Object.keys(modelConfig.materials).filter(matches);
  const model =
    project.model ??
    (matches(currentModel)
      ? currentModel
      : candidates.length === 1
        ? candidates[0]
        : undefined);
  if (!model || !matches(model))
    throw new Error(
      "Select the model this project was made for before opening it"
    );
  const definitions = modelMaterials(model);
  let sizeMultiplier: number | undefined;
  for (const material of definitions) {
    for (let frame = 0; frame < (material.frameCount ?? 1); frame++) {
      const loaded = project.materials[materialArchiveKey(material, frame)];
      if (!loaded) continue;
      const [width, height] = material.size ?? [512, 512];
      const scale = loaded.textureSize[0] / width;
      if (
        ![1, 2, 4].includes(scale) ||
        loaded.textureSize[1] / height !== scale ||
        (sizeMultiplier !== undefined && sizeMultiplier !== scale)
      ) {
        throw new Error("Project materials have incompatible texture sizes");
      }
      sizeMultiplier = scale;
    }
  }
  return { model, sizeMultiplier: sizeMultiplier ?? 1 };
}

export async function prepareSkinProject(
  project: SkinProject,
  signal?: AbortSignal
) {
  const prepared: Record<string, PreparedMaterial> = {};
  try {
    // Decode all materials before the caller switches models or touches live work.
    for (const [name, material] of Object.entries(project.materials)) {
      const color = await util.enlivenObjects<FabricObject>(
        material.color.objects,
        { signal }
      );
      prepared[name] = { color, metallic: [] };
      prepared[name].metallic = await util.enlivenObjects<FabricObject>(
        material.metallic.objects,
        { signal }
      );
    }
    return prepared;
  } catch (error) {
    Object.values(prepared).forEach(({ color, metallic }) =>
      [...color, ...metallic].forEach((object) => object.dispose())
    );
    throw error;
  }
}

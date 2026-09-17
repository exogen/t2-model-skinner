import JSZip from "jszip";
import {
  FabricImage,
  Canvas as FabricCanvas,
  FabricObject,
  Path,
  filters,
} from "fabric";
import { createFabricImage } from "./fabricUtils";

// The extra (non-default) properties fabric's toObject()/toJSON() include, matching
// what Canvas.tsx's undo/redo snapshot requests, so lock/selectable state round-trips.
const EXTRA_SERIALIZED_PROPERTIES = [
  "lockMovementX",
  "lockMovementY",
  "lockRotation",
  "lockScalingX",
  "lockScalingY",
  "selectable",
  "hoverCursor",
  "moveCursor",
];

export const SKIN_PROJECT_VERSION = 1;

export interface SkinProjectFilterSettings {
  hueRotation: number;
  saturation: number;
  brightness: number;
  contrast: number;
  opacity: number;
}

export interface SkinProjectObject {
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
  filterSettings: SkinProjectFilterSettings;
}

// Raw fabric Path.toObject() output (SVG path commands + standard object props),
// plus a zIndex shared with SkinProjectObject.zIndex so metallic images and
// strokes (which may be interleaved on the canvas) can be restored in order.
export interface SkinProjectStrokeData extends Record<string, unknown> {
  zIndex: number;
}

export interface SkinProjectFile {
  version: number;
  textureSize: [number, number];
  background?: SkinProjectObject;
  metallicBackground?: SkinProjectObject;
  objects: SkinProjectObject[];
  metallicObjects: SkinProjectObject[];
  metallicStrokes: SkinProjectStrokeData[];
}

export interface SkinProjectLoadedObject extends SkinProjectObject {
  imageUrl: string;
}

export interface SkinProjectLoaded
  extends Omit<
    SkinProjectFile,
    "objects" | "metallicObjects" | "background" | "metallicBackground"
  > {
  background?: SkinProjectLoadedObject;
  metallicBackground?: SkinProjectLoadedObject;
  objects: SkinProjectLoadedObject[];
  metallicObjects: SkinProjectLoadedObject[];
}

/**
 * The base/reference image added automatically by Canvas.tsx is locked and
 * non-selectable, unlike ordinary user-added layers (which may be locked via
 * the "lock selection" tool, but remain selectable). This lets us identify
 * and exclude it when serializing/restoring the user's editable layers.
 */
function isLockedBaseLayer(object: FabricObject) {
  return object.selectable === false && isLockedObject(object);
}

// True for objects locked via the app's "lock selection" tool (still selectable),
// as well as the (always non-selectable) locked base layer.
function isLockedObject(object: FabricObject) {
  return (
    object.lockMovementX === true &&
    object.lockMovementY === true &&
    object.lockScalingX === true &&
    object.lockScalingY === true &&
    object.lockRotation === true
  );
}

// Retrieves all user-editable image objects from the canvas, excluding the locked base layer.
export function getEditableObjects(canvas: FabricCanvas) {
  return canvas
    .getObjects()
    .filter((object): object is FabricImage => {
      return object instanceof FabricImage && !isLockedBaseLayer(object);
    });
}

// Retrieves all paint-mode brush strokes (drawn freehand as fabric Path objects).
function getStrokeObjects(canvas: FabricCanvas): Path[] {
  return canvas.getObjects().filter((object): object is Path => object instanceof Path);
}

// Retrieves the locked base layer (background) image from the canvas, if it exists.
// This is a sibling function to getEditableObjects, but specifically for the locked base layer which is excluded by that function.
function getLockedBaseLayer(canvas: FabricCanvas): FabricImage | undefined {
  return canvas.getObjects().find((object): object is FabricImage => {
    return object instanceof FabricImage && isLockedBaseLayer(object);
  });
}

// Serializes the properties of a FabricObject into a SkinProjectObject.
function serializeObjectTransform(
  object: FabricObject,
  filename: string,
  zIndex: number
): SkinProjectObject {
  return {
    filename,
    zIndex,
    left: object.left ?? 0,
    top: object.top ?? 0,
    angle: object.angle ?? 0,
    scaleX: object.scaleX ?? 1,
    scaleY: object.scaleY ?? 1,
    flipX: Boolean(object.flipX),
    flipY: Boolean(object.flipY),
    locked: isLockedObject(object),
    filterSettings: extractFilterSettings(object),
  };
}

// Reads only the app-exposed filter values (hue/saturation/brightness/contrast/opacity);
// other filters (e.g. the metallic canvas's grayscale filter) aren't user-editable and are ignored.
function extractFilterSettings(object: FabricObject): SkinProjectFilterSettings {
  const settings: SkinProjectFilterSettings = {
    hueRotation: 0,
    saturation: 0,
    brightness: 0,
    contrast: 0,
    opacity: object.opacity ?? 1,
  };
  if (object instanceof FabricImage) {
    for (const filter of object.filters ?? []) {
      if (filter instanceof filters.HueRotation) {
        settings.hueRotation = filter.rotation;
      } else if (filter instanceof filters.Saturation) {
        settings.saturation = filter.saturation;
      } else if (filter instanceof filters.Brightness) {
        settings.brightness = filter.brightness;
      } else if (filter instanceof filters.Contrast) {
        settings.contrast = filter.contrast;
      }
    }
  }
  return settings;
}

// Applies previously extracted filter settings to a restored FabricImage. The
// metallic canvas always renders in grayscale (an app-managed filter, not a
// user-editable setting), so it isn't part of SkinProjectFilterSettings.
function applyFilterSettings(
  image: FabricImage,
  settings: SkinProjectFilterSettings | undefined,
  { grayscale = false }: { grayscale?: boolean } = {}
) {
  image.opacity = settings?.opacity ?? 1;
  const newFilters = [];
  if (grayscale) {
    newFilters.push(new filters.Grayscale());
  }
  if (settings?.hueRotation) {
    newFilters.push(new filters.HueRotation({ rotation: settings.hueRotation }));
  }
  if (settings?.saturation) {
    newFilters.push(new filters.Saturation({ saturation: settings.saturation }));
  }
  if (settings?.brightness) {
    newFilters.push(new filters.Brightness({ brightness: settings.brightness }));
  }
  if (settings?.contrast) {
    newFilters.push(new filters.Contrast({ contrast: settings.contrast }));
  }
  image.filters = newFilters;
  if (newFilters.length) {
    image.applyFilters();
  }
}

// Recreates a locked, non-selectable base layer image from a restored background entry.
async function restoreLockedBaseLayerImage(
  info: SkinProjectLoadedObject,
  { grayscale = false }: { grayscale?: boolean } = {}
): Promise<FabricImage> {
  const image = await createFabricImage(info.imageUrl);
  image.set({
    left: info.left,
    top: info.top,
    angle: info.angle,
    scaleX: info.scaleX,
    scaleY: info.scaleY,
    flipX: info.flipX,
    flipY: info.flipY,
    selectable: false,
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    hoverCursor: "default",
    moveCursor: "default",
  });
  applyFilterSettings(image, info.filterSettings, { grayscale });
  return image;
}

function imageObjectToPngBlob(image: FabricImage): Promise<Blob> {
  // Use the pre-filter source so baked-in filters (hue/saturation/etc.) aren't exported.
  const element = (image._originalElement ?? image.getElement()) as
    | HTMLImageElement
    | HTMLCanvasElement;
  const width = image.width || element.width;
  const height = image.height || element.height;
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = width;
  tempCanvas.height = height;
  const ctx = tempCanvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to get 2D canvas context");
  }
  ctx.drawImage(element, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    tempCanvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Failed to create PNG image data"));
      }
    }, "image/png");
  });
}

export interface SkinProjectMaterialInput {
  name: string;
  textureSize: [number, number];
  colorCanvas: FabricCanvas;
  metallicCanvas?: FabricCanvas | null;
}

// Builds one material's material.json + images into the given zip folder.
async function writeMaterialProject(
  folder: JSZip,
  colorCanvas: FabricCanvas,
  textureSize: [number, number],
  metallicCanvas?: FabricCanvas | null
): Promise<void> {
  const objects = getEditableObjects(colorCanvas);
  const projectObjects = await Promise.all(
    objects.map(async (object, index) => {
      const filename = `layer-${index}.png`;
      const blob = await imageObjectToPngBlob(object);
      folder.file(filename, blob);
      return serializeObjectTransform(object, filename, index);
    })
  );

  const baseLayer = getLockedBaseLayer(colorCanvas);
  let background: SkinProjectObject | undefined;
  if (baseLayer) {
    const blob = await imageObjectToPngBlob(baseLayer);
    folder.file("background.png", blob);
    background = serializeObjectTransform(baseLayer, "background.png", -1);
  }

  // Metallic layers are kept separate from the color layers above so each is
  // restored to the correct canvas; paint-mode strokes are not FabricImages
  // and so are naturally left out of getEditableObjects(). zIndex is taken from
  // the canvas's actual object order (shared between images and strokes) so
  // their original interleaving can be reconstructed on restore.
  const metallicCanvasObjects = metallicCanvas ? metallicCanvas.getObjects() : [];
  const metallicObjects = metallicCanvas ? getEditableObjects(metallicCanvas) : [];
  const projectMetallicObjects = await Promise.all(
    metallicObjects.map(async (object, index) => {
      const filename = `metallic-layer-${index}.png`;
      const blob = await imageObjectToPngBlob(object);
      folder.file(filename, blob);
      return serializeObjectTransform(
        object,
        filename,
        metallicCanvasObjects.indexOf(object)
      );
    })
  );

  const metallicBaseLayer = metallicCanvas
    ? getLockedBaseLayer(metallicCanvas)
    : undefined;
  let metallicBackground: SkinProjectObject | undefined;
  if (metallicBaseLayer) {
    const blob = await imageObjectToPngBlob(metallicBaseLayer);
    folder.file("metallic-background.png", blob);
    metallicBackground = serializeObjectTransform(
      metallicBaseLayer,
      "metallic-background.png",
      -1
    );
  }

  const metallicStrokes: SkinProjectStrokeData[] = (
    metallicCanvas ? getStrokeObjects(metallicCanvas) : []
  ).map((path) => ({
    ...(path.toObject(EXTRA_SERIALIZED_PROPERTIES as never[]) as unknown as Record<
      string,
      unknown
    >),
    zIndex: metallicCanvasObjects.indexOf(path),
  }));

  const project: SkinProjectFile = {
    version: SKIN_PROJECT_VERSION,
    textureSize,
    background,
    metallicBackground,
    objects: projectObjects,
    metallicObjects: projectMetallicObjects,
    metallicStrokes,
  };
  folder.file("material.json", JSON.stringify(project, null, 2));
}

// Builds a .skin archive with one subfolder (named after the material) per
// input material; each subfolder is a self-contained material.json + images.
export async function createSkinProjectZip(
  materials: SkinProjectMaterialInput[]
): Promise<JSZip> {
  const zip = new JSZip();
  for (const material of materials) {
    const folder = zip.folder(material.name);
    if (!folder) {
      continue;
    }
    await writeMaterialProject(
      folder,
      material.colorCanvas,
      material.textureSize,
      material.metallicCanvas
    );
  }
  return zip;
}

// Reads one material's material.json + images from the given zip folder.
async function readMaterialProject(folder: JSZip): Promise<SkinProjectLoaded> {
  const projectFile = folder.file("material.json");
  if (!projectFile) {
    throw new Error("Invalid skin project: missing material.json");
  }
  const projectJson = await projectFile.async("string");
  const project: SkinProjectFile = JSON.parse(projectJson);

  const loadImageForObject = async (
    objectInfo: SkinProjectObject
  ): Promise<SkinProjectLoadedObject> => {
    const imageFile = folder.file(objectInfo.filename);
    if (!imageFile) {
      throw new Error(`Missing image file in skin project: ${objectInfo.filename}`);
    }
    const base64 = await imageFile.async("base64");
    return { ...objectInfo, imageUrl: `data:image/png;base64,${base64}` };
  };

  const loadObjectImages = (objectInfos: SkinProjectObject[]) =>
    Promise.all(
      objectInfos
        .slice()
        .sort((a, b) => a.zIndex - b.zIndex)
        .map(loadImageForObject)
    );

  const objects = await loadObjectImages(project.objects);
  const metallicObjects = await loadObjectImages(project.metallicObjects ?? []);

  const background = project.background
    ? await loadImageForObject(project.background)
    : undefined;
  const metallicBackground = project.metallicBackground
    ? await loadImageForObject(project.metallicBackground)
    : undefined;

  return {
    ...project,
    background,
    metallicBackground,
    objects,
    metallicObjects,
    metallicStrokes: project.metallicStrokes ?? [],
  };
}

// Reads a .skin archive, returning each material's loaded project keyed by material name.
// Materials are discovered by scanning for "<name>/material.json" entries (no manifest).
export async function readSkinProjectZip(
  file: File | Blob
): Promise<Record<string, SkinProjectLoaded>> {
  const content = await JSZip.loadAsync(file);
  const materialNames = new Set<string>();
  content.forEach((relativePath) => {
    const match = /^([^/]+)\/material\.json$/.exec(relativePath);
    if (match) {
      materialNames.add(match[1]);
    }
  });

  const result: Record<string, SkinProjectLoaded> = {};
  for (const materialName of Array.from(materialNames)) {
    const folder = content.folder(materialName);
    if (folder) {
      result[materialName] = await readMaterialProject(folder);
    }
  }
  return result;
}

// Recreates a restored editable layer image, reapplying its locked state.
async function restoreEditableLayerImage(
  info: SkinProjectLoadedObject,
  { grayscale = false }: { grayscale?: boolean } = {}
): Promise<FabricImage> {
  const image = await createFabricImage(info.imageUrl);
  image.set({
    left: info.left,
    top: info.top,
    angle: info.angle,
    scaleX: info.scaleX,
    scaleY: info.scaleY,
    flipX: info.flipX,
    flipY: info.flipY,
    lockMovementX: info.locked,
    lockMovementY: info.locked,
    lockScalingX: info.locked,
    lockScalingY: info.locked,
    lockRotation: info.locked,
  });
  applyFilterSettings(image, info.filterSettings, { grayscale });
  return image;
}

// Returns the restored objects that should be tracked as locked (via the app's
// "lock selection" tool state), since that's a separate Set kept by the caller.
export async function applySkinProjectToCanvas(
  colorCanvas: FabricCanvas,
  project: SkinProjectLoaded,
  metallicCanvas?: FabricCanvas | null
): Promise<FabricObject[]> {
  const lockedObjects: FabricObject[] = [];

  const existingObjects = getEditableObjects(colorCanvas);
  colorCanvas.remove(...existingObjects);

  if (project.background) {
    const existingBase = getLockedBaseLayer(colorCanvas);
    if (existingBase) {
      colorCanvas.remove(existingBase);
    }
    const backgroundImage = await restoreLockedBaseLayerImage(project.background);
    // Added before the editable layers so it stays behind them in the stack.
    colorCanvas.add(backgroundImage);
  }

  for (const objectInfo of project.objects) {
    const image = await restoreEditableLayerImage(objectInfo);
    colorCanvas.add(image);
    if (objectInfo.locked) {
      lockedObjects.push(image);
    }
  }
  colorCanvas.requestRenderAll();

  if (metallicCanvas) {
    const existingMetallicObjects = getEditableObjects(metallicCanvas);
    metallicCanvas.remove(...existingMetallicObjects);
    const existingStrokes = getStrokeObjects(metallicCanvas);
    metallicCanvas.remove(...existingStrokes);

    if (project.metallicBackground) {
      const existingMetallicBase = getLockedBaseLayer(metallicCanvas);
      if (existingMetallicBase) {
        metallicCanvas.remove(existingMetallicBase);
      }
      const metallicBackgroundImage = await restoreLockedBaseLayerImage(
        project.metallicBackground,
        { grayscale: true }
      );
      metallicCanvas.add(metallicBackgroundImage);
      // Explicitly send the restored background behind the layers/strokes
      // added below instead of relying on add-order.
      metallicCanvas.sendObjectToBack(metallicBackgroundImage);
    }

    // Images and strokes may be interleaved on the canvas, so merge both lists
    // and restore them in their original combined zIndex order.
    type MetallicLayerEntry =
      | { kind: "image"; zIndex: number; data: SkinProjectLoadedObject }
      | { kind: "stroke"; zIndex: number; data: SkinProjectStrokeData };
    const metallicLayerEntries: MetallicLayerEntry[] = [
      ...project.metallicObjects.map(
        (data): MetallicLayerEntry => ({ kind: "image", zIndex: data.zIndex, data })
      ),
      ...project.metallicStrokes.map(
        (data): MetallicLayerEntry => ({ kind: "stroke", zIndex: data.zIndex, data })
      ),
    ].sort((a, b) => a.zIndex - b.zIndex);

    for (const entry of metallicLayerEntries) {
      if (entry.kind === "image") {
        const image = await restoreEditableLayerImage(entry.data, { grayscale: true });
        metallicCanvas.add(image);
        if (entry.data.locked) {
          lockedObjects.push(image);
        }
      } else {
        const path = await Path.fromObject(entry.data);
        metallicCanvas.add(path);
        if (isLockedObject(path)) {
          lockedObjects.push(path);
        }
      }
    }

    metallicCanvas.requestRenderAll();
  }

  return lockedObjects;
}

import JSZip from "jszip";
import { FabricImage, Canvas as FabricCanvas, FabricObject } from "fabric";
import { createFabricImage } from "./fabricUtils";

export const SKIN_PROJECT_VERSION = 1;

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
}

export interface SkinProjectFile {
  version: number;
  textureSize: [number, number];
  background?: SkinProjectObject;
  objects: SkinProjectObject[];
}

export interface SkinProjectLoadedObject extends SkinProjectObject {
  imageUrl: string;
}

export interface SkinProjectLoaded
  extends Omit<SkinProjectFile, "objects" | "background"> {
  background?: SkinProjectLoadedObject;
  objects: SkinProjectLoadedObject[];
}

/**
 * The base/reference image added automatically by Canvas.tsx is locked and
 * non-selectable, unlike ordinary user-added layers (which may be locked via
 * the "lock selection" tool, but remain selectable). This lets us identify
 * and exclude it when serializing/restoring the user's editable layers.
 */
function isLockedBaseLayer(object: FabricObject) {
  return (
    object.selectable === false &&
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
  };
}

function imageObjectToPngBlob(image: FabricImage): Promise<Blob> {
  const element = image.getElement() as HTMLImageElement | HTMLCanvasElement;
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

export async function createSkinProjectZip(
  canvas: FabricCanvas,
  textureSize: [number, number]
) {
  const zip = new JSZip();
  const objects = getEditableObjects(canvas);
  const projectObjects = await Promise.all(
    objects.map(async (object, index) => {
      const filename = `layer-${index}.png`;
      const blob = await imageObjectToPngBlob(object);
      zip.file(filename, blob);
      return serializeObjectTransform(object, filename, index);
    })
  );

  const baseLayer = getLockedBaseLayer(canvas);
  let background: SkinProjectObject | undefined;
  if (baseLayer) {
    const blob = await imageObjectToPngBlob(baseLayer);
    zip.file("background.png", blob);
    background = serializeObjectTransform(baseLayer, "background.png", -1);
  }

  const project: SkinProjectFile = {
    version: SKIN_PROJECT_VERSION,
    textureSize,
    background,
    objects: projectObjects,
  };
  zip.file("project.json", JSON.stringify(project, null, 2));
  return zip;
}

export async function readSkinProjectZip(
  file: File | Blob
): Promise<SkinProjectLoaded> {
  const content = await JSZip.loadAsync(file);
  const projectFile = content.file("project.json");
  if (!projectFile) {
    throw new Error("Invalid skin project: missing project.json");
  }
  const projectJson = await projectFile.async("string");
  const project: SkinProjectFile = JSON.parse(projectJson);
  const objects = await Promise.all(
    project.objects
      .slice()
      .sort((a, b) => a.zIndex - b.zIndex)
      .map(async (objectInfo) => {
        const imageFile = content.file(objectInfo.filename);
        if (!imageFile) {
          throw new Error(`Missing image file in skin project: ${objectInfo.filename}`);
        }
        const base64 = await imageFile.async("base64");
        return {
          ...objectInfo,
          imageUrl: `data:image/png;base64,${base64}`,
        };
      })
  );

  let background: SkinProjectLoadedObject | undefined;
  if (project.background) {
    const backgroundFile = content.file(project.background.filename);
    if (!backgroundFile) {
      throw new Error(
        `Missing image file in skin project: ${project.background.filename}`
      );
    }
    const base64 = await backgroundFile.async("base64");
    background = {
      ...project.background,
      imageUrl: `data:image/png;base64,${base64}`,
    };
  }

  return { ...project, background, objects };
}

export async function applySkinProjectToCanvas(
  canvas: FabricCanvas,
  project: SkinProjectLoaded
) {
  const existingObjects = getEditableObjects(canvas);
  canvas.remove(...existingObjects);

  if (project.background) {
    const existingBase = getLockedBaseLayer(canvas);
    if (existingBase) {
      canvas.remove(existingBase);
    }
    const backgroundImage = await createFabricImage(project.background.imageUrl);
    backgroundImage.set({
      left: project.background.left,
      top: project.background.top,
      angle: project.background.angle,
      scaleX: project.background.scaleX,
      scaleY: project.background.scaleY,
      flipX: project.background.flipX,
      flipY: project.background.flipY,
      selectable: false,
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      hoverCursor: "default",
      moveCursor: "default",
    });
    // Added before the editable layers so it stays behind them in the stack.
    canvas.add(backgroundImage);
  }

  for (const objectInfo of project.objects) {
    const image = await createFabricImage(objectInfo.imageUrl);
    image.set({
      left: objectInfo.left,
      top: objectInfo.top,
      angle: objectInfo.angle,
      scaleX: objectInfo.scaleX,
      scaleY: objectInfo.scaleY,
      flipX: objectInfo.flipX,
      flipY: objectInfo.flipY,
    });
    canvas.add(image);
  }
  canvas.requestRenderAll();
}

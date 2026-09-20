import { Canvas, FabricImage, FabricObject } from "fabric";

export const SERIALIZED_PROPERTIES = [
  "lockMovementX",
  "lockMovementY",
  "lockRotation",
  "lockScalingX",
  "lockScalingY",
  "lockSkewingX",
  "lockSkewingY",
  "selectable",
  "hoverCursor",
  "moveCursor",
];

export interface CanvasSnapshot {
  objects: Record<string, unknown>[];
}

export async function createFabricImage(url: string, signal?: AbortSignal) {
  return FabricImage.fromURL(url, { crossOrigin: "anonymous", signal });
}

export function serializeCanvas(canvas: Canvas): CanvasSnapshot {
  // Canvas serialization converts selected children back to canvas coordinates.
  return canvas.toObject(SERIALIZED_PROPERTIES) as CanvasSnapshot;
}

export function replaceCanvasObjects(
  canvas: Canvas,
  objects: FabricObject[]
) {
  const renderOnAddRemove = canvas.renderOnAddRemove;
  const previous = canvas.getObjects();
  canvas.renderOnAddRemove = false;
  try {
    canvas.discardActiveObject();
    canvas.clear();
    canvas.add(...objects);
  } finally {
    canvas.renderOnAddRemove = renderOnAddRemove;
  }
  // Fabric.clear() detaches layers but leaves their image/filter caches alive.
  previous
    .filter((object) => !objects.includes(object))
    .forEach((object) => object.dispose());
  canvas.requestRenderAll();
}

export function isLockedObject(object: FabricObject) {
  return (
    object.lockMovementX &&
    object.lockMovementY &&
    object.lockRotation &&
    object.lockScalingX &&
    object.lockScalingY
  );
}

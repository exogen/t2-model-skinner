import { Canvas, Control, FabricImage, FabricObject, util } from "fabric";

// CSS scales the artwork down, but handles and hit targets remain screen-sized.
// Apply this on attachment and selection so restored layers and multi-selections
// get the same controls without changing their saved document coordinates.
export function configureCanvasControls(
  canvas: Canvas,
  sizeMultiplier: number,
) {
  const configure = (object: FabricObject) => {
    object.set({
      cornerSize: 9 * sizeMultiplier,
      touchCornerSize: 24 * sizeMultiplier,
      borderScaleFactor: sizeMultiplier,
    });
    if (object.controls.mtr) {
      object.controls = {
        ...object.controls,
        mtr: new Control({
          ...object.controls.mtr,
          offsetY: -40 * sizeMultiplier,
        }),
      };
    }
    object.setCoords();
  };
  const configureSelection = () => {
    const selected = canvas.getActiveObject();
    if (selected) configure(selected);
  };
  canvas.setTargetFindTolerance(2 * sizeMultiplier);
  canvas.selectionLineWidth = sizeMultiplier;
  canvas.getObjects().forEach(configure);
  configureSelection();
  const unsubscribe = [
    canvas.on("object:added", ({ target }) => configure(target)),
    canvas.on("selection:created", configureSelection),
    canvas.on("selection:updated", configureSelection),
  ];
  return () => unsubscribe.forEach((off) => off());
}

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

// A selected object's position is relative to the selection. Serialize it in
// the canvas plane, as canvas.toObject() does.
export function serializeObject(object: FabricObject) {
  const { group } = object;
  if (!group) return object.toObject(SERIALIZED_PROPERTIES);
  const transform = util.saveObjectTransform(object);
  util.addTransformToObject(object, group.calcTransformMatrix());
  try {
    return object.toObject(SERIALIZED_PROPERTIES);
  } finally {
    object.set(transform);
    object.setCoords();
  }
}

export function objectBounds(objects: FabricObject[]) {
  return util.makeBoundingBoxFromPoints(
    objects.flatMap((object) => object.getCoords()),
  );
}

// Renders objects alone at one image pixel per texture pixel, cropped to their
// bounds on the canvas.
export function renderObjects(canvas: Canvas, objects: FabricObject[]) {
  const bounds = objectBounds(objects);
  const left = Math.max(0, Math.floor(bounds.left));
  const top = Math.max(0, Math.floor(bounds.top));
  const width =
    Math.min(canvas.width, Math.ceil(bounds.left + bounds.width)) - left;
  const height =
    Math.min(canvas.height, Math.ceil(bounds.top + bounds.height)) - top;
  // Fabric renders the whole canvas for a zero width or height.
  if (width <= 0 || height <= 0) return null;
  return canvas.toCanvasElement(1, {
    left,
    top,
    width,
    height,
    filter: (object) => objects.includes(object as FabricObject),
  });
}

export function replaceCanvasObjects(canvas: Canvas, objects: FabricObject[]) {
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

"use client";
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  FabricImage,
  FabricObject,
  ActiveSelection,
  filters,
  PencilBrush,
  util,
  type Canvas,
  type TMat2D,
} from "fabric";
import { ToolsContext } from "./useTools";
import useCanvas, { type CanvasInfo } from "./useCanvas";
import useWarrior from "./useWarrior";
import {
  createFabricImage,
  isLockedObject,
  objectBounds,
  renderObjects,
  serializeObject,
  SERIALIZED_PROPERTIES,
} from "./fabricUtils";
import {
  materialArchiveKey,
  captureSkinProject,
  createSkinProjectZip,
} from "./skinProjectUtils";
import useEditorSession from "./useEditorSession";
import useImageWorker from "./useImageWorker";
import type { MaterialDefinition } from "./models";
import useSettings from "./useSettings";
import modelConfig, { hasMetallicMap } from "./models";
import {
  ImageError,
  imageTooBig,
  maxImageSize,
  unreadableImage,
} from "./importUtils";

const { materials } = modelConfig;

const defaultTextureSize = [512, 512] as [number, number];

// How far duplicates and repeated pastes shift from the original.
const copyOffset = 20;

function requireReadyCanvas(info: CanvasInfo | undefined) {
  if (info?.status === "error") {
    throw new Error(
      "A texture failed to load. Reload the skin before exporting.",
    );
  }
  if (!info || info.status !== "ready" || info.canvas.disposed) {
    throw new Error("Wait for all textures to finish loading before exporting");
  }
  return info.canvas;
}

function removeObjects(canvas: Canvas, objects: FabricObject[]) {
  canvas.discardActiveObject();
  canvas.remove(...objects);
  objects.forEach((object) => object.dispose());
  canvas.requestRenderAll();
}

// Metallic textures use one channel, so their layers stay gray.
function makeGrayscale(image: FabricImage) {
  if (image.filters.some((filter) => filter instanceof filters.Grayscale)) {
    return;
  }
  image.filters.push(new filters.Grayscale());
  image.applyFilters();
}

function setObjectLocked(object: FabricObject, locked: boolean) {
  object.set({
    lockMovementX: locked,
    lockMovementY: locked,
    lockScalingX: locked,
    lockScalingY: locked,
    lockRotation: locked,
  });
}

// Determines if a material is editable based on its properties.
function isEditableMaterial(material: MaterialDefinition | null | undefined) {
  return Boolean(material && material.selectable !== false && !material.hidden);
}

function getExportCanvases(
  materialDefs: MaterialDefinition[],
  canvases: Record<string, CanvasInfo>,
  sizeMultiplier: number,
) {
  return materialDefs.flatMap((material) => {
    const [width, height] = material.size ?? defaultTextureSize;
    const textureSize: [number, number] = [
      width * sizeMultiplier,
      height * sizeMultiplier,
    ];
    return Array.from(
      { length: material.frameCount ?? 1 },
      (_, frameIndex) => ({
        name: materialArchiveKey(material, frameIndex),
        material,
        frameIndex,
        textureSize,
        colorCanvas: requireReadyCanvas(
          canvases[`${material.name}:color:${frameIndex}:${sizeMultiplier}`],
        ),
        metallicCanvas: hasMetallicMap(material)
          ? requireReadyCanvas(
              canvases[
                `${material.name}:metallic:${frameIndex}:${sizeMultiplier}`
              ],
            )
          : null,
      }),
    );
  });
}

type ObjectFilters = {
  HueRotation?: number;
  Saturation?: number;
  Brightness?: number;
  Contrast?: number;
  Opacity?: number;
};

// Read directly from canvas objects so restored layers and inactive canvases
// retain their filter settings when the user resumes editing.
function extractObjectFilters(object: FabricObject): ObjectFilters {
  const objectFilters: ObjectFilters = { Opacity: object.opacity ?? 1 };
  if (object instanceof FabricImage) {
    for (const filter of object.filters ?? []) {
      if (filter instanceof filters.HueRotation) {
        objectFilters.HueRotation = filter.rotation;
      } else if (filter instanceof filters.Saturation) {
        objectFilters.Saturation = filter.saturation;
      } else if (filter instanceof filters.Brightness) {
        objectFilters.Brightness = filter.brightness;
      } else if (filter instanceof filters.Contrast) {
        objectFilters.Contrast = filter.contrast;
      }
    }
  }
  return objectFilters;
}

export default function ToolsProvider({ children }: { children: ReactNode }) {
  const { actualModel, selectedModel } = useWarrior();
  const {
    preferences,
    setPreferences,
    sizeMultiplier,
    setSizeMultiplier,
    loadSkinProject,
    loadSkinFiles,
    loadLocalProject,
    cancelSkinLoad,
    loadedLocalProject,
    runTask,
    clipboard,
  } = useEditorSession();
  const { backgroundColor, brushColor, brushSize, exportName } = preferences;
  const [selectedMaterialIndex, setSelectedMaterialIndex] = useState(0);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0);
  const materialDefs: MaterialDefinition[] = materials[actualModel];
  const materialDef = materialDefs[selectedMaterialIndex] ?? materialDefs[0];
  const frameCount = materialDef.frameCount ?? 1;
  const hasAnimation = frameCount > 1;
  const [selectedExportMaterials, setSelectedExportMaterials] = useState<
    boolean[]
  >(() => materialDefs.map(isEditableMaterial));

  const baseSize = materialDef.size ?? defaultTextureSize;
  const textureSize: [number, number] = useMemo(
    () => [baseSize[0] * sizeMultiplier, baseSize[1] * sizeMultiplier],
    [baseSize, sizeMultiplier],
  );

  const hasMetallic = hasMetallicMap(materialDef);

  const [activeCanvasType, setActiveCanvasType] = useState("color");

  if (!hasMetallic && activeCanvasType === "metallic") {
    setActiveCanvasType("color");
  }

  if (selectedFrameIndex >= frameCount) {
    setSelectedFrameIndex(0);
  }

  useEffect(() => {
    setSelectedFrameIndex(0);
  }, [materialDef]);

  const [, updateFilterControls] = useState(0);
  const [selectedObjects, setSelectedObjects] = useState<FabricObject[]>(
    () => [],
  );

  const activeCanvas = materialDef
    ? `${materialDef.name}:${activeCanvasType}:${selectedFrameIndex}:${sizeMultiplier}`
    : null;
  const metallicCanvasId = materialDef
    ? `${materialDef.name}:metallic:${selectedFrameIndex}:${sizeMultiplier}`
    : null;
  const { canvases } = useCanvas();
  const { canvas, status, notifyChange, undo, redo, canUndo, canRedo } =
    useCanvas(activeCanvas);
  const {
    canvas: metallicCanvas,
    status: metallicStatus,
    setDrawingMode,
  } = useCanvas(metallicCanvasId);
  const { combineColorAndAlphaImageUrls } = useImageWorker();
  const { canvasPadding } = useSettings();
  const [layerMode, setLayerMode] = useState("BaseLayer");

  if (selectedObjects.length) {
    if (layerMode !== "SelectedLayer") {
      setLayerMode("SelectedLayer");
    }
  } else {
    if (layerMode === "SelectedLayer") {
      setLayerMode("BaseLayer");
    }
  }

  const setFilter = useCallback(
    (name: keyof ObjectFilters, value: number) => {
      if (!canvas || status !== "ready") return;
      const applyObjects =
        layerMode === "AllLayers"
          ? (canvas?.getObjects() ?? [])
          : layerMode === "BaseLayer"
            ? (canvas?.getObjects().slice(0, 1) ?? [])
            : selectedObjects;
      for (const object of applyObjects) {
        if (!(object instanceof FabricImage)) continue;
        if (name === "Opacity") {
          object.set("opacity", value);
        } else {
          const filter =
            name === "HueRotation"
              ? new filters.HueRotation({ rotation: value })
              : name === "Saturation"
                ? new filters.Saturation({ saturation: value })
                : name === "Brightness"
                  ? new filters.Brightness({ brightness: value })
                  : new filters.Contrast({ contrast: value });
          const index = object.filters.findIndex(
            (existing) => existing.type === name,
          );
          // Replace in place: filter order is part of the image's appearance.
          if (index < 0) object.filters.push(filter);
          else object.filters[index] = filter;
          object.applyFilters();
        }
      }
      updateFilterControls((revision) => revision + 1);
      notifyChange?.();
    },
    [canvas, status, layerMode, selectedObjects, notifyChange],
  );

  const getFilter = (
    name: keyof ObjectFilters,
  ): [number | null, (value: number) => void] => {
    const defaultValue = name === "Opacity" ? 1 : 0;
    let applyObjects = selectedObjects;
    if (layerMode === "AllLayers") {
      applyObjects = canvas?.getObjects() ?? [];
    } else if (layerMode === "BaseLayer") {
      applyObjects = canvas?.getObjects().slice(0, 1) ?? [];
    }
    applyObjects = applyObjects.filter(
      (object) => object instanceof FabricImage,
    );
    if (applyObjects.length) {
      const getValue = (i: number) =>
        extractObjectFilters(applyObjects[i])[name] ?? defaultValue;
      const firstValue = getValue(0);
      if (
        applyObjects
          .slice(1)
          .every((applyObject, i) => getValue(i + 1) === firstValue)
      ) {
        return [firstValue, (value: number) => setFilter(name, value)];
      }
      return [null, (value: number) => setFilter(name, value)];
    } else {
      return [defaultValue, (value: number) => setFilter(name, value)];
    }
  };

  const [hueRotate, setHueRotate] = getFilter("HueRotation");
  const [saturation, setSaturation] = getFilter("Saturation");
  const [brightness, setBrightness] = getFilter("Brightness");
  const [contrast, setContrast] = getFilter("Contrast");
  const [opacity, setOpacity] = getFilter("Opacity");

  const setSelectionLocked = useCallback(
    (locked: boolean) => {
      if (!canvas || status !== "ready" || !selectedObjects.length) return;
      selectedObjects.forEach((object) => setObjectLocked(object, locked));
      updateFilterControls((revision) => revision + 1);
      notifyChange();
    },
    [canvas, status, selectedObjects, notifyChange],
  );
  const lockSelection = useCallback(
    () => setSelectionLocked(true),
    [setSelectionLocked],
  );
  const unlockSelection = useCallback(
    () => setSelectionLocked(false),
    [setSelectionLocked],
  );

  const bringForward = useCallback(() => {
    if (!canvas || status !== "ready") return;
    const object = canvas.getActiveObject();
    if (object) {
      canvas.bringObjectForward(object, true);
      notifyChange();
    }
  }, [canvas, status, notifyChange]);

  const sendBackward = useCallback(() => {
    if (!canvas || status !== "ready") return;
    const object = canvas.getActiveObject();
    if (object) {
      if (canvas._objects[0] === object || canvas._objects[1] === object) {
        return;
      }
      canvas.sendObjectBackwards(object, true);
      notifyChange();
    }
  }, [canvas, status, notifyChange]);

  const addImages = useCallback(
    async (imageUrls: string[]) => {
      if (!canvas || status !== "ready") return;
      await runTask(
        async (signal) => {
          const images: FabricImage[] = [];
          try {
            for (const url of imageUrls) {
              let image;
              try {
                image = await createFabricImage(url, signal);
              } catch (error) {
                signal.throwIfAborted();
                // Fabric's message includes the whole data URL.
                throw new ImageError(unreadableImage, { cause: error });
              }
              images.push(image);
              if (!image.width || !image.height)
                throw new ImageError(unreadableImage);
              if (image.width > maxImageSize || image.height > maxImageSize)
                throw new ImageError(imageTooBig);
              const scale = Math.min(
                1,
                textureSize[0] / image.width,
                textureSize[1] / image.height,
              );
              image.set({ scaleX: scale, scaleY: scale });
              if (activeCanvasType === "metallic") makeGrayscale(image);
            }
            return images;
          } catch (error) {
            images.forEach((image) => image.dispose());
            throw error;
          }
        },
        (images) => {
          if (metallicCanvas) setDrawingMode(false);
          images.forEach((image) => canvas.centerObject(image));
          canvas.add(...images);
          if (images.length) canvas.setActiveObject(images[images.length - 1]);
          canvas.requestRenderAll();
        },
        (images) => images.forEach((image) => image.dispose()),
      );
    },
    [
      canvas,
      status,
      runTask,
      textureSize,
      activeCanvasType,
      metallicCanvas,
      setDrawingMode,
    ],
  );

  const duplicate = useCallback(async () => {
    if (!canvas || status !== "ready") return;
    const object = canvas.getActiveObject();
    if (!object) return;
    await runTask(
      () => object.clone(SERIALIZED_PROPERTIES),
      (copy) => {
        copy.set({
          top: copy.top + copyOffset,
          left: copy.left + copyOffset,
          evented: true,
        });
        canvas.discardActiveObject();
        if (copy instanceof ActiveSelection) {
          copy.canvas = canvas;
          copy.forEachObject((child) => canvas.add(child));
          copy.setCoords();
        } else {
          canvas.add(copy);
        }
        canvas.setActiveObject(copy);
        notifyChange();
      },
      (copy) => copy.dispose(),
    );
  }, [canvas, status, runTask, notifyChange]);

  const deleteSelection = useCallback(() => {
    if (!canvas || status !== "ready") return;
    const objects = canvas
      .getActiveObjects()
      .filter((object) => !isLockedObject(object));
    if (!objects.length) return;
    removeObjects(canvas, objects);
  }, [canvas, status]);

  // Copies the selection to the in-app clipboard and returns an image of it
  // for the system clipboard. Cutting leaves locked layers behind.
  const copySelection = useCallback(
    (cut = false) => {
      if (!canvas || status !== "ready") return null;
      const order = canvas.getObjects();
      const objects = canvas
        .getActiveObjects()
        .filter(
          (object) =>
            object.selectable !== false && !(cut && isLockedObject(object)),
        )
        .sort((a, b) => order.indexOf(a) - order.indexOf(b));
      if (!objects.length) return null;
      const image = renderObjects(canvas, objects);
      const clip = clipboard.set({
        objects: objects.map(serializeObject),
        sizeMultiplier,
        baseSize,
        // A copy pasted on its own canvas is offset; a cut is pasted in place.
        pastes: new WeakMap([[canvas, cut ? 0 : 1]]),
      });
      if (cut) removeObjects(canvas, objects);
      return { id: clip.id, image };
    },
    [canvas, status, clipboard, sizeMultiplier, baseSize],
  );

  const pasteSelection = useCallback(async () => {
    const clip = clipboard.clip;
    if (!canvas || status !== "ready" || !clip) return;
    const toMetallic = activeCanvasType === "metallic";
    await runTask(
      async (signal) => {
        const objects = await util.enlivenObjects<FabricObject>(clip.objects, {
          signal,
        });
        if (toMetallic) {
          for (const object of objects) {
            if (object instanceof FabricImage) makeGrayscale(object);
          }
        }
        return objects;
      },
      (objects) => {
        const count = clip.pastes.get(canvas) ?? 0;
        clip.pastes.set(canvas, count + 1);
        const offset = copyOffset * count;
        let transform: TMat2D;
        if (
          baseSize[0] === clip.baseSize[0] &&
          baseSize[1] === clip.baseSize[1]
        ) {
          // Same texture layout: paste in place, scaled from the texture's
          // corner to this resolution.
          const scale = sizeMultiplier / clip.sizeMultiplier;
          const shift = canvasPadding * (1 - scale) + offset;
          transform = [scale, 0, 0, scale, shift, shift];
        } else {
          // Another layout: center on the texture, shrinking to fit like
          // added images.
          const bounds = objectBounds(objects);
          const scale = Math.min(
            sizeMultiplier / clip.sizeMultiplier,
            textureSize[0] / bounds.width,
            textureSize[1] / bounds.height,
          );
          const center = [
            canvasPadding + textureSize[0] / 2 + offset,
            canvasPadding + textureSize[1] / 2 + offset,
          ];
          transform = [
            scale,
            0,
            0,
            scale,
            center[0] - scale * (bounds.left + bounds.width / 2),
            center[1] - scale * (bounds.top + bounds.height / 2),
          ];
        }
        objects.forEach((object) => {
          if (transform[0] === 1) {
            // Moving alone keeps angles and scales exact.
            object.set({
              left: object.left + transform[4],
              top: object.top + transform[5],
            });
          } else {
            util.addTransformToObject(object, transform);
          }
          object.setCoords();
        });
        if (toMetallic) setDrawingMode(false);
        canvas.discardActiveObject();
        canvas.add(...objects);
        canvas.setActiveObject(
          objects.length > 1
            ? new ActiveSelection(objects, { canvas })
            : objects[0],
        );
        canvas.requestRenderAll();
      },
      (objects) => objects.forEach((object) => object.dispose()),
    );
  }, [
    canvas,
    status,
    clipboard,
    activeCanvasType,
    runTask,
    baseSize,
    sizeMultiplier,
    canvasPadding,
    textureSize,
    setDrawingMode,
  ]);

  const copyToMetallic = useCallback(async () => {
    if (
      activeCanvasType !== "color" ||
      !canvas ||
      !metallicCanvas ||
      metallicStatus !== "ready" ||
      status !== "ready"
    )
      return;
    const colorImageUrl = canvas.toDataURL({
      format: "png",
      multiplier: 1,
      top: canvasPadding,
      left: canvasPadding,
      width: textureSize[0],
      height: textureSize[1],
    });
    await runTask(
      async (signal) => {
        const image = await createFabricImage(colorImageUrl, signal);
        makeGrayscale(image);
        return image;
      },
      (image) => {
        metallicCanvas.centerObject(image);
        metallicCanvas.add(image);
        metallicCanvas.setActiveObject(image);
        setDrawingMode(false);
        setActiveCanvasType("metallic");
      },
      (image) => image.dispose(),
    );
  }, [
    activeCanvasType,
    canvas,
    metallicCanvas,
    metallicStatus,
    status,
    canvasPadding,
    textureSize,
    runTask,
    setDrawingMode,
  ]);

  const exportSkin = useCallback(
    async ({ format, name = "" }: { format: string; name: string }) => {
      const selectedMaterials = materialDefs.filter(
        (_, index) => selectedExportMaterials[index] !== false,
      );
      // Capture every canvas before importing the encoder or starting a worker.
      const snapshots = getExportCanvases(
        selectedMaterials,
        canvases,
        sizeMultiplier,
      ).map(
        ({
          material,
          frameIndex,
          textureSize,
          colorCanvas,
          metallicCanvas,
        }) => {
          const options = {
            format: "png" as const,
            multiplier: 1,
            top: canvasPadding,
            left: canvasPadding,
            width: textureSize[0],
            height: textureSize[1],
          };
          return {
            material,
            frameIndex,
            colorImageUrl: colorCanvas.toDataURL(options),
            metallicImageUrl: metallicCanvas?.toDataURL(options),
          };
        },
      );
      const { exportSkinTextures } = await import("./exportUtils");
      await exportSkinTextures(
        snapshots,
        { format, name, model: actualModel, sizeMultiplier },
        combineColorAndAlphaImageUrls,
      );
    },
    [
      materialDefs,
      selectedExportMaterials,
      canvases,
      sizeMultiplier,
      canvasPadding,
      actualModel,
      combineColorAndAlphaImageUrls,
    ],
  );

  const exportSkinProject = useCallback(
    async (name: string) => {
      // Project saves include fixed materials and every frame; material selection
      // applies only to texture exports.
      const inputs = getExportCanvases(materialDefs, canvases, sizeMultiplier);
      if (!inputs.length) return;
      name = name.trim() || "MyCustomSkin";
      const snapshot = captureSkinProject(inputs, selectedModel, name);
      const { saveZipFile } = await import("./exportUtils");
      const zip = await createSkinProjectZip(snapshot);
      await saveZipFile(zip, `${name}.skin`);
    },
    [materialDefs, canvases, sizeMultiplier, selectedModel],
  );

  const context = {
    activeCanvas,
    activeCanvasType,
    setActiveCanvasType,
    backgroundColor,
    setBackgroundColor: (backgroundColor: string) =>
      setPreferences((previous) => ({ ...previous, backgroundColor })),
    brushColor,
    setBrushColor: (brushColor: number) =>
      setPreferences((previous) => ({ ...previous, brushColor })),
    brushSize,
    setBrushSize: (brushSize: number) =>
      setPreferences((previous) => ({ ...previous, brushSize })),
    exportName,
    setExportName: (exportName: string) =>
      setPreferences((previous) => ({ ...previous, exportName })),
    hueRotate,
    setHueRotate,
    saturation,
    setSaturation,
    brightness,
    setBrightness,
    contrast,
    setContrast,
    opacity,
    setOpacity,
    layerMode,
    setLayerMode,
    selectedObjects,
    lockSelection,
    unlockSelection,
    bringForward,
    sendBackward,
    addImages,
    duplicate,
    deleteSelection,
    copySelection,
    pasteSelection,
    undo,
    redo,
    canUndo,
    canRedo,
    copyToMetallic,
    exportSkin,
    exportSkinProject,
    loadSkinProject,
    loadSkinFiles,
    loadLocalProject,
    cancelSkinLoad,
    loadedLocalProject,
    selectedMaterialIndex,
    setSelectedMaterialIndex,
    textureSize,
    hasMetallic,
    selectedFrameIndex,
    setSelectedFrameIndex,
    hasAnimation,
    frameCount,
    sizeMultiplier,
    setSizeMultiplier,
    selectedExportMaterials,
    setSelectedExportMaterials,
  };

  useEffect(() => {
    if (canvas) {
      const handleSelectionUpdated = () => {
        setSelectedObjects(canvas.getActiveObjects());
      };
      canvas.on("selection:cleared", handleSelectionUpdated);
      canvas.on("selection:updated", handleSelectionUpdated);
      canvas.on("selection:created", handleSelectionUpdated);

      handleSelectionUpdated();

      return () => {
        canvas.off("selection:cleared", handleSelectionUpdated);
        canvas.off("selection:updated", handleSelectionUpdated);
        canvas.off("selection:created", handleSelectionUpdated);
      };
    }
  }, [canvas]);

  useEffect(() => {
    if (!canvas) return;
    const refresh = () => {
      updateFilterControls((revision) => revision + 1);
    };
    refresh();
    canvas.on("object:added", refresh);
    canvas.on("object:removed", refresh);
    canvas.on("object:modified", refresh);
    return () => {
      canvas.off("object:added", refresh);
      canvas.off("object:removed", refresh);
      canvas.off("object:modified", refresh);
    };
  }, [canvas]);

  useEffect(() => {
    if (!metallicCanvas) return;
    metallicCanvas.freeDrawingBrush ??= new PencilBrush(metallicCanvas);
    metallicCanvas.freeDrawingBrush.width = brushSize;
    metallicCanvas.freeDrawingBrush.color = `rgb(${brushColor}, ${brushColor}, ${brushColor})`;
  }, [metallicCanvas, brushSize, brushColor]);

  return (
    <ToolsContext.Provider value={context}>{children}</ToolsContext.Provider>
  );
}

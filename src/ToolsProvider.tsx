"use client";
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  FabricImage,
  FabricObject,
  ActiveSelection,
  filters,
  PencilBrush,
} from "fabric";
import { ToolsContext } from "./useTools";
import useCanvas from "./useCanvas";
import useWarrior from "./useWarrior";
import { createFabricImage } from "./fabricUtils";
import useImageWorker from "./useImageWorker";
import type { MaterialDefinition } from "./models";
import useSettings from "./useSettings";
import { imageUrlToArrayBuffer } from "./imageUtils";
import modelConfig from "./models";

const { materials } = modelConfig;

const defaultTextureSize = [512, 512] as [number, number];

function lockObject(object: FabricObject) {
  object.lockMovementX = true;
  object.lockMovementY = true;
  object.lockScalingX = true;
  object.lockScalingY = true;
  object.lockRotation = true;
}

function unlockObject(object: FabricObject) {
  object.lockMovementX = false;
  object.lockMovementY = false;
  object.lockScalingX = false;
  object.lockScalingY = false;
  object.lockRotation = false;
}

function isActiveSelection(object: FabricObject): object is ActiveSelection {
  return object.type === "activeSelection";
}

// Determines if a material is editable based on its properties.
function isEditableMaterial(material: MaterialDefinition | null | undefined) {
  return Boolean(material && material.selectable !== false && !material.hidden);
}

// Determines if a material has a metallic component based on its properties.
function materialHasMetallic(material: MaterialDefinition) {
  return !(material.metallicFactor === 0 && material.roughnessFactor === 1);
}

// Key used for a material's zip subfolder; multi-frame materials get one subfolder per frame.
function materialArchiveKey(material: MaterialDefinition, frameIndex: number) {
  const frameCount = material.frameCount ?? 1;
  return frameCount > 1 ? `${material.name}-frame${frameIndex}` : material.name;
}

type ObjectFilters = {
  HueRotation?: number;
  Saturation?: number;
  Brightness?: number;
  Contrast?: number;
  Opacity?: number;
};

// Reads the filter/opacity values actually applied to a fabric object, so filterMap
// (which drives the slider UI) can be resynced after objects are replaced wholesale
// (undo/redo's canvas.loadFromJSON, or a .skin project load), rather than mutated
// in place through setFilter.
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
  const { actualModel, selectedModelType } = useWarrior();
  const [selectedMaterialIndex, setSelectedMaterialIndex] = useState(0);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0);
  const [sizeMultiplier, setSizeMultiplier] = useState<number>(1);
  const materialDefs: MaterialDefinition[] = materials[actualModel];
  const materialDef = materialDefs[selectedMaterialIndex] ?? null;
  const frameCount = materialDef.frameCount ?? 1;
  const hasAnimation = frameCount > 1;
  const [selectedExportMaterials, setSelectedExportMaterials] = useState<
    boolean[]
  >([]);

  const textureSize: [number, number] = useMemo(() => {
    const [width, height] = materialDef.size ?? defaultTextureSize;
    return [width * sizeMultiplier, height * sizeMultiplier];
  }, [materialDef.size, sizeMultiplier]);

  const hasMetallic = !(
    materialDef.metallicFactor === 0 && materialDef.roughnessFactor === 1
  );

  const [activeCanvasType, setActiveCanvasType] = useState("color");

  if (!hasMetallic && activeCanvasType === "metallic") {
    setActiveCanvasType("color");
  }

  if (selectedFrameIndex >= frameCount) {
    setSelectedFrameIndex(0);
  }

  useEffect(() => {
    try {
      const savedSizeMultiplier = localStorage.getItem("sizeMultiplier");
      switch (savedSizeMultiplier) {
        case "1":
        case "2":
        case "4":
          setSizeMultiplier(+savedSizeMultiplier);
          break;
      }
    } catch (err) {
      // Probably blocked. That's okay.
    }
  }, []);

  useEffect(() => {
    setSelectedExportMaterials(materialDefs.map(isEditableMaterial));
  }, [materialDefs]);

  useEffect(() => {
    setSelectedFrameIndex(0);
  }, [materialDef]);

  const [backgroundColor, setBackgroundColor] = useState("black");
  const [lockedObjects, setLockedObjects] = useState(
    () => new Set<FabricObject>()
  );
  const [brushColor, setBrushColor] = useState(200);
  const [brushSize, setBrushSize] = useState(10);
  const [filterMap, setFilterMap] = useState(
    () => new Map<FabricObject, ObjectFilters>()
  );
  const [selectedObjects, setSelectedObjects] = useState<FabricObject[]>(
    () => []
  );

  const activeCanvas = materialDef
    ? `${materialDef.name}:${activeCanvasType}:${selectedFrameIndex}:${sizeMultiplier}`
    : null;
  const metallicCanvasId = materialDef
    ? `${materialDef.name}:metallic:${selectedFrameIndex}:${sizeMultiplier}`
    : null;
  const { canvases } = useCanvas();
  const { canvas, notifyChange, undo, redo, canUndo, canRedo } =
    useCanvas(activeCanvas);
  const { canvas: metallicCanvas, setDrawingMode } =
    useCanvas(metallicCanvasId);
  const { combineColorAndAlphaImageUrls } = useImageWorker();
  const { canvasPadding } = useSettings();
  const [filterChanges, setFilterChanges] = useState<
    Array<[FabricObject, ObjectFilters]>
  >(() => []);
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
      const filterChanges: Array<[FabricObject, ObjectFilters]> = [];
      const newFilterMap = new Map(filterMap);
      let applyObjects = selectedObjects;
      if (layerMode === "AllLayers") {
        applyObjects = canvas?._objects ?? [];
      } else if (layerMode === "BaseLayer") {
        applyObjects = canvas?._objects.slice(0, 1) ?? [];
      }
      for (const applyObject of applyObjects) {
        if (applyObject instanceof FabricImage) {
          const existingFilters = filterMap.get(applyObject) ?? {};
          const newFilters = { ...existingFilters, [name]: value };
          newFilterMap.set(applyObject, newFilters);
          filterChanges.push([applyObject, newFilters]);
        }
      }
      setFilterMap(newFilterMap);
      setFilterChanges(filterChanges);
    },
    [canvas, layerMode, filterMap, selectedObjects]
  );

  const getFilter = (
    name: keyof ObjectFilters
  ): [number | null, (value: number) => void] => {
    const defaultValue = name === "Opacity" ? 1 : 0;
    let applyObjects = selectedObjects;
    if (layerMode === "AllLayers") {
      applyObjects = canvas?._objects ?? [];
    } else if (layerMode === "BaseLayer") {
      applyObjects = canvas?._objects.slice(0, 1) ?? [];
    }
    applyObjects = applyObjects.filter(
      (object) => object instanceof FabricImage
    );
    if (applyObjects.length) {
      const getValue = (i: number) =>
        (filterMap.get(applyObjects[i]) ?? {})[name] ?? defaultValue;
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

  useEffect(() => {
    if (!filterChanges.length) {
      return;
    }
    for (const [selectedObject, newFilters] of filterChanges) {
      if (selectedObject instanceof FabricImage) {
        selectedObject.filters = [];
        if (activeCanvasType === "metallic") {
          const grayscaleFilter = new filters.Grayscale();
          selectedObject.filters.push(grayscaleFilter);
        }
        for (const key in newFilters) {
          const filterValue = newFilters[key as keyof ObjectFilters];
          if (filterValue != null) {
            switch (key) {
              case "HueRotation":
                selectedObject.filters.push(
                  new filters.HueRotation({
                    rotation: filterValue,
                  })
                );
                break;
              case "Saturation":
                selectedObject.filters.push(
                  new filters.Saturation({
                    saturation: filterValue,
                  })
                );
                break;
              case "Brightness":
                selectedObject.filters.push(
                  new filters.Brightness({
                    brightness: filterValue,
                  })
                );
                break;
              case "Contrast":
                selectedObject.filters.push(
                  new filters.Contrast({
                    contrast: filterValue,
                  })
                );
                break;
              case "Opacity":
                selectedObject.opacity = filterValue;
                break;
            }
          }
        }
        selectedObject.applyFilters();
      }
    }
    setFilterChanges([]);
    if (notifyChange) {
      notifyChange();
    }
  }, [filterChanges, activeCanvasType, notifyChange]);

  const lockSelection = useCallback(() => {
    if (selectedObjects.length) {
      setLockedObjects((lockedObjects) => {
        const newLockedObjects = new Set(lockedObjects);
        for (const selectedObject of selectedObjects) {
          newLockedObjects.add(selectedObject);
          lockObject(selectedObject);
        }
        return newLockedObjects;
      });
    }
  }, [selectedObjects]);

  const unlockSelection = useCallback(() => {
    if (selectedObjects.length) {
      setLockedObjects((lockedObjects) => {
        const newLockedObjects = new Set(lockedObjects);
        for (const selectedObject of selectedObjects) {
          newLockedObjects.delete(selectedObject);
          unlockObject(selectedObject);
        }
        return newLockedObjects;
      });
    }
  }, [selectedObjects]);

  const bringForward = useCallback(async () => {
    const object = canvas.getActiveObject();
    if (object) {
      canvas.bringObjectForward(object, true);
      notifyChange();
    }
  }, [canvas, notifyChange]);

  const sendBackward = useCallback(async () => {
    const object = canvas.getActiveObject();
    if (object) {
      // Don't allow below base skin.
      if (canvas._objects[0] === object || canvas._objects[1] === object) {
        return;
      }
      canvas.sendObjectBackwards(object, true);
      notifyChange();
    }
  }, [canvas, notifyChange]);

  const addImages = useCallback(
    async (imageUrls: string[]) => {
      let lastAddedImage;
      for (const imageUrl of imageUrls) {
        const image = await createFabricImage(imageUrl);
        if (!image.width || !image.height) {
          throw new Error("Zero-height image");
        }
        const widthRatio = image.width / textureSize[0];
        const heightRatio = image.height / textureSize[1];
        if (widthRatio > 1 || heightRatio > 1) {
          let scale;
          if (widthRatio > heightRatio) {
            scale = 1 / widthRatio;
          } else {
            scale = 1 / heightRatio;
          }
          image.scaleX = scale;
          image.scaleY = scale;
        }
        if (activeCanvasType === "metallic") {
          if (!image.filters) {
            image.filters = [];
          }
          const grayscaleFilter = new filters.Grayscale();
          image.filters.push(grayscaleFilter);
          image.applyFilters();
        }
        if (metallicCanvas) {
          setDrawingMode(false);
        }
        canvas.centerObject(image);
        canvas.add(image);
        lastAddedImage = image;
      }
      if (lastAddedImage) {
        canvas.setActiveObject(lastAddedImage);
        canvas.requestRenderAll();
      }
    },
    [textureSize, activeCanvasType, metallicCanvas, canvas, setDrawingMode]
  );

  const duplicate = useCallback(async () => {
    const object = canvas.getActiveObject();
    if (object) {
      const copy = await object.clone();
      copy.set({
        top: (copy.top ?? 0) + 20,
        left: (copy.left ?? 0) + 20,
        evented: true,
      });

      if (isActiveSelection(copy)) {
        copy.canvas = canvas;
        copy.forEachObject((object) => {
          canvas.add(object);
        });
        copy.setCoords();
      }

      canvas.discardActiveObject();
      canvas.add(copy);
      canvas.setActiveObject(copy);
    }
  }, [canvas]);

  const deleteSelection = useCallback(async () => {
    const objects = canvas.getActiveObjects();
    canvas.discardActiveObject();
    canvas.remove(...objects);
    canvas.requestRenderAll();
    // forceUpdateRef.current();
  }, [canvas]);

  const copyToMetallic = useCallback(async () => {
    if (activeCanvasType === "color" && metallicCanvas) {
      const colorImageUrl = canvas.toDataURL({
        format: "png",
        multiplier: 1,
        top: canvasPadding,
        left: canvasPadding,
        width: textureSize[0],
        height: textureSize[1],
      });
      const image = await createFabricImage(colorImageUrl);
      if (!image.filters) {
        image.filters = [];
      }
      const grayscaleFilter = new filters.Grayscale();
      image.filters.push(grayscaleFilter);
      image.applyFilters();
      metallicCanvas.centerObject(image);
      metallicCanvas.add(image);
      metallicCanvas.setActiveObject(image);
      setDrawingMode(false);
      setActiveCanvasType("metallic");
    }
  }, [
    metallicCanvas,
    canvas,
    activeCanvasType,
    canvasPadding,
    setDrawingMode,
    textureSize,
  ]);

  const exportSkin = useCallback(
    async ({ format, name = "" }: { format: string; name: string }) => {
      const { savePngFile, saveZipFile, createZipFile } = await import(
        "./exportUtils"
      );

      name = name.trim() || "MyCustomSkin";

      const materialExports = await Promise.all(
        materialDefs
          .filter(
            (materialDef: MaterialDefinition, i) =>
              selectedExportMaterials[i] !== false
          )
          .map((materialDef: MaterialDefinition) => {
            const frameCount = materialDef.frameCount ?? 1;
            const frames = new Array(frameCount).fill(null);
            return frames.map(async (_, frameIndex) => {
              const colorCanvas =
                canvases[
                  `${materialDef.name}:color:${frameIndex}:${sizeMultiplier}`
                ]?.canvas;
              const metallicCanvas =
                canvases[
                  `${materialDef.name}:metallic:${frameIndex}:${sizeMultiplier}`
                ]?.canvas;

              const baseTextureSize = materialDef.size ?? defaultTextureSize;
              const textureSize = [
                baseTextureSize[0] * sizeMultiplier,
                baseTextureSize[1] * sizeMultiplier,
              ];
              let outputImageUrl;

              const colorImageUrl = colorCanvas.toDataURL({
                format: "png",
                multiplier: 1,
                top: canvasPadding,
                left: canvasPadding,
                width: textureSize[0],
                height: textureSize[1],
              });

              if (metallicCanvas) {
                const metallicImageUrl = metallicCanvas.toDataURL({
                  format: "png",
                  multiplier: 1,
                  top: canvasPadding,
                  left: canvasPadding,
                  width: textureSize[0],
                  height: textureSize[1],
                });
                outputImageUrl = await combineColorAndAlphaImageUrls({
                  colorImageUrl,
                  metallicImageUrl,
                });
              } else {
                outputImageUrl = colorImageUrl;
              }

              let filename: string;
              switch (selectedModelType) {
                case "player":
                  filename = `${name}.${actualModel}.png`;
                  break;
                case "weapon":
                case "vehicle":
                  if (materialDef) {
                    const frameZeroFile = materialDef.file ?? materialDef.name;
                    if (frameCount > 1) {
                      const match = frameZeroFile.match(/^(.+)(\d\d)$/);
                      if (match) {
                        const baseName = match[1];
                        filename = `${baseName}${frameIndex
                          .toString()
                          .padStart(2, "0")}.png`;
                      } else {
                        throw new Error("Unexpected animation filename");
                      }
                    } else {
                      filename = `${frameZeroFile}.png`;
                    }
                  } else if (selectedModelType === "weapon") {
                    filename = `weapon_${actualModel}.png`;
                  } else {
                    filename = `${actualModel}.png`;
                  }
                  break;
                default:
                  throw new Error("Unknown model type");
              }

              return { imageUrl: outputImageUrl, filename };
            });
          })
          .flat()
      );

      switch (format) {
        case "png": {
          materialExports.forEach((materialExport) => {
            const { imageUrl, filename } = materialExport;
            savePngFile(imageUrl, filename);
          });
          break;
        }
        case "vl2": {
          const files = await Promise.all(
            materialExports.map(async (materialExport) => ({
              data: await imageUrlToArrayBuffer(materialExport.imageUrl),
              name: materialExport.filename,
            }))
          );
          const zip = createZipFile(files);
          const camelCaseName = actualModel.replace(
            /(?:^([a-z])|_([a-z]))/g,
            (match, a, b) => (a || b).toUpperCase()
          );
          let zipFileName = "";
          const multiplierString =
            sizeMultiplier > 1 ? `-@${sizeMultiplier}x` : "";
          switch (selectedModelType) {
            case "player":
              zipFileName = `zPlayerSkin-${name}${multiplierString}.vl2`;
              break;
            case "weapon":
              zipFileName = `zWeapon${camelCaseName}-${name}${multiplierString}.vl2`;
              break;
            case "vehicle":
              zipFileName = `z${camelCaseName}-${name}${multiplierString}.vl2`;
              break;
          }
          await saveZipFile(zip, zipFileName);
        }
      }
      return;
    },
    [
      materialDefs,
      selectedExportMaterials,
      canvases,
      sizeMultiplier,
      canvasPadding,
      selectedModelType,
      combineColorAndAlphaImageUrls,
      actualModel,
    ]
  );

  const exportSkinProject = useCallback(
    async (name: string) => {
      const materialInputs = materialDefs
        .filter(isEditableMaterial)
        .map((material) => {
          const baseTextureSize = material.size ?? defaultTextureSize;
          const textureSize: [number, number] = [
            baseTextureSize[0] * sizeMultiplier,
            baseTextureSize[1] * sizeMultiplier,
          ];
          const frameCount = material.frameCount ?? 1;
          const frames = new Array(frameCount).fill(null);
          return frames.map((_, frameIndex) => {
            const colorCanvas =
              canvases[`${material.name}:color:${frameIndex}:${sizeMultiplier}`]
                ?.canvas;
            if (!colorCanvas) {
              return null;
            }
            const metallicCanvas = materialHasMetallic(material)
              ? canvases[
                  `${material.name}:metallic:${frameIndex}:${sizeMultiplier}`
                ]?.canvas
              : null;
            return {
              name: materialArchiveKey(material, frameIndex),
              textureSize,
              colorCanvas,
              metallicCanvas,
            };
          });
        })
        .flat()
        .filter((input): input is NonNullable<typeof input> => input !== null);

      if (!materialInputs.length) {
        return;
      }
      const { saveZipFile } = await import("./exportUtils");
      const { createSkinProjectZip } = await import("./skinProjectUtils");
      const zip = await createSkinProjectZip(materialInputs);
      const filename = `${name.trim() || "MyCustomSkin"}.skin`;
      await saveZipFile(zip, filename);
    },
    [materialDefs, canvases, sizeMultiplier]
  );

  const loadSkinProject = useCallback(
    async (file: File | Blob) => {
      const { readSkinProjectZip, applySkinProjectToCanvas } = await import(
        "./skinProjectUtils"
      );
      const materialsByName = await readSkinProjectZip(file);
      const restoredLockedObjects: FabricObject[] = [];
      for (const material of materialDefs) {
        if (!isEditableMaterial(material)) {
          continue;
        }
        const frameCount = material.frameCount ?? 1;
        for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
          const loaded = materialsByName[materialArchiveKey(material, frameIndex)];
          if (!loaded) {
            continue;
          }
          const colorCanvasId = `${material.name}:color:${frameIndex}:${sizeMultiplier}`;
          const colorCanvas = canvases[colorCanvasId]?.canvas;
          if (!colorCanvas) {
            continue;
          }
          const metallicCanvasId = `${material.name}:metallic:${frameIndex}:${sizeMultiplier}`;
          const metallicCanvas = materialHasMetallic(material)
            ? canvases[metallicCanvasId]?.canvas
            : null;
          const lockedObjects = await applySkinProjectToCanvas(
            colorCanvas,
            loaded,
            metallicCanvas
          );
          restoredLockedObjects.push(...lockedObjects);
          canvases[colorCanvasId]?.notifyChange();
          if (metallicCanvas) {
            canvases[metallicCanvasId]?.notifyChange();
          }
        }
      }
      if (restoredLockedObjects.length) {
        setLockedObjects((lockedObjects) => {
          const newLockedObjects = new Set(lockedObjects);
          restoredLockedObjects.forEach((object) => newLockedObjects.add(object));
          return newLockedObjects;
        });
      }
    },
    [materialDefs, canvases, sizeMultiplier]
  );

  const context = useMemo(
    () => ({
      activeCanvas,
      activeCanvasType,
      setActiveCanvasType,
      backgroundColor,
      setBackgroundColor,
      lockedObjects,
      setLockedObjects,
      brushColor,
      setBrushColor,
      brushSize,
      setBrushSize,
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
      undo,
      redo,
      canUndo,
      canRedo,
      copyToMetallic,
      exportSkin,
      exportSkinProject,
      loadSkinProject,
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
    }),
    [
      activeCanvas,
      activeCanvasType,
      backgroundColor,
      lockedObjects,
      brushColor,
      brushSize,
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
      selectedObjects,
      lockSelection,
      unlockSelection,
      bringForward,
      sendBackward,
      addImages,
      duplicate,
      deleteSelection,
      undo,
      redo,
      canUndo,
      canRedo,
      copyToMetallic,
      exportSkin,
      exportSkinProject,
      loadSkinProject,
      selectedMaterialIndex,
      textureSize,
      hasMetallic,
      selectedFrameIndex,
      hasAnimation,
      frameCount,
      sizeMultiplier,
      selectedExportMaterials,
    ]
  );

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

  // Undo/redo (canvas.loadFromJSON) and .skin project loads replace canvas objects
  // with new instances, so filterMap's per-object entries go stale. Resync from the
  // objects' actual filters/opacity whenever new objects are added to either canvas.
  useEffect(() => {
    const syncFilterMapForCanvas = (targetCanvas: typeof canvas) => {
      if (!targetCanvas) {
        return;
      }
      setFilterMap((filterMap) => {
        const newFilterMap = new Map(filterMap);
        for (const object of targetCanvas._objects) {
          if (object instanceof FabricImage) {
            newFilterMap.set(object, extractObjectFilters(object));
          }
        }
        return newFilterMap;
      });
    };

    const handleColorObjectAdded = () => syncFilterMapForCanvas(canvas);
    const handleMetallicObjectAdded = () => syncFilterMapForCanvas(metallicCanvas);

    canvas?.on("object:added", handleColorObjectAdded);
    metallicCanvas?.on("object:added", handleMetallicObjectAdded);

    return () => {
      canvas?.off("object:added", handleColorObjectAdded);
      metallicCanvas?.off("object:added", handleMetallicObjectAdded);
    };
  }, [canvas, metallicCanvas]);

  useEffect(() => {
    if (metallicCanvas) {
      if (!metallicCanvas.freeDrawingBrush) {
        metallicCanvas.freeDrawingBrush = new PencilBrush(metallicCanvas);
      }
      metallicCanvas.freeDrawingBrush.width = brushSize;
    }
  }, [metallicCanvas, brushSize]);

  useEffect(() => {
    if (metallicCanvas) {
      if (!metallicCanvas.freeDrawingBrush) {
        metallicCanvas.freeDrawingBrush = new PencilBrush(metallicCanvas);
      }
      metallicCanvas.freeDrawingBrush.color = `rgb(${brushColor}, ${brushColor}, ${brushColor})`;
    }
  }, [metallicCanvas, brushColor]);

  return (
    <ToolsContext.Provider value={context}>{children}</ToolsContext.Provider>
  );
}

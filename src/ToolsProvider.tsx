import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import getConfig from "next/config";
import { fabric } from "fabric";
import { ToolsContext } from "./useTools";
import useCanvas from "./useCanvas";
import useWarrior from "./useWarrior";
import { createFabricImage } from "./fabricUtils";
import useImageWorker from "./useImageWorker";
import { MaterialDefinition } from "./Material";
import useSettings from "./useSettings";
import { imageUrlToArrayBuffer } from "./imageUtils";

const { publicRuntimeConfig } = getConfig();

const { materials } = publicRuntimeConfig;

const defaultTextureSize = [512, 512] as [number, number];

function lockObject(object: fabric.Object) {
  object.lockMovementX = true;
  object.lockMovementY = true;
  object.lockScalingX = true;
  object.lockScalingY = true;
  object.lockRotation = true;
}

function unlockObject(object: fabric.Object) {
  object.lockMovementX = false;
  object.lockMovementY = false;
  object.lockScalingX = false;
  object.lockScalingY = false;
  object.lockRotation = false;
}

function isActiveSelection(
  object: fabric.Object
): object is fabric.ActiveSelection {
  return object.type === "activeSelection";
}

type ObjectFilters = {
  HueRotation?: number;
  Saturation?: number;
  Brightness?: number;
  Contrast?: number;
};

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
    setSelectedExportMaterials(
      materialDefs.map((material) =>
        Boolean(material && material.selectable !== false && !material.hidden)
      )
    );
  }, [materialDefs]);

  useEffect(() => {
    setSelectedFrameIndex(0);
  }, [materialDef]);

  const [backgroundColor, setBackgroundColor] = useState("magenta");
  const [lockedObjects, setLockedObjects] = useState(
    () => new Set<fabric.Object>()
  );
  const [brushColor, setBrushColor] = useState(200);
  const [brushSize, setBrushSize] = useState(10);
  const [filterMap, setFilterMap] = useState(
    () => new Map<fabric.Object, ObjectFilters>()
  );
  const [selectedObjects, setSelectedObjects] = useState<fabric.Object[]>(
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
    Array<[fabric.Object, ObjectFilters]>
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
      const filterChanges: Array<[fabric.Object, ObjectFilters]> = [];
      const newFilterMap = new Map(filterMap);
      let applyObjects = selectedObjects;
      if (layerMode === "AllLayers") {
        applyObjects = canvas?._objects ?? [];
      } else if (layerMode === "BaseLayer") {
        applyObjects = canvas?._objects.slice(0, 1) ?? [];
      }
      for (const applyObject of applyObjects) {
        if (applyObject instanceof fabric.Image) {
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
    let applyObjects = selectedObjects;
    if (layerMode === "AllLayers") {
      applyObjects = canvas?._objects ?? [];
    } else if (layerMode === "BaseLayer") {
      applyObjects = canvas?._objects.slice(0, 1) ?? [];
    }
    applyObjects = applyObjects.filter(
      (object) => object instanceof fabric.Image
    );
    if (applyObjects.length) {
      const getValue = (i: number) =>
        (filterMap.get(applyObjects[i]) ?? {})[name] ?? 0;
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
      return [0, (value: number) => setFilter(name, value)];
    }
  };

  const [hueRotate, setHueRotate] = getFilter("HueRotation");
  const [saturation, setSaturation] = getFilter("Saturation");
  const [brightness, setBrightness] = getFilter("Brightness");
  const [contrast, setContrast] = getFilter("Contrast");

  useEffect(() => {
    if (!filterChanges.length) {
      return;
    }
    for (const [selectedObject, newFilters] of filterChanges) {
      if (selectedObject instanceof fabric.Image) {
        selectedObject.filters = [];
        if (activeCanvasType === "metallic") {
          const grayscaleFilter = new fabric.Image.filters.Grayscale();
          selectedObject.filters.push(grayscaleFilter);
        }
        for (const key in newFilters) {
          const filterValue = newFilters[key as keyof ObjectFilters];
          if (filterValue != null) {
            switch (key) {
              case "HueRotation":
                selectedObject.filters.push(
                  // @ts-expect-error @types/fabric does not include HueRotation.
                  new fabric.Image.filters.HueRotation({
                    rotation: filterValue,
                  })
                );
                break;
              case "Saturation":
                selectedObject.filters.push(
                  new fabric.Image.filters.Saturation({
                    saturation: filterValue,
                  })
                );
                break;
              case "Brightness":
                selectedObject.filters.push(
                  new fabric.Image.filters.Brightness({
                    brightness: filterValue,
                  })
                );
                break;
              case "Contrast":
                selectedObject.filters.push(
                  new fabric.Image.filters.Contrast({
                    contrast: filterValue,
                  })
                );
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
      canvas.bringForward(object, true);
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
      canvas.sendBackwards(object, true);
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
          const grayscaleFilter = new fabric.Image.filters.Grayscale();
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
      }
    },
    [textureSize, activeCanvasType, metallicCanvas, canvas, setDrawingMode]
  );

  const duplicate = useCallback(async () => {
    const object = canvas.getActiveObject();
    if (object) {
      const copy = await new Promise<fabric.Object>((resolve) =>
        object.clone(resolve)
      );
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
        top: canvasPadding,
        left: canvasPadding,
        width: textureSize[0],
        height: textureSize[1],
      });
      const image = await createFabricImage(colorImageUrl);
      if (!image.filters) {
        image.filters = [];
      }
      const grayscaleFilter = new fabric.Image.filters.Grayscale();
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
                top: canvasPadding,
                left: canvasPadding,
                width: textureSize[0],
                height: textureSize[1],
              });

              if (metallicCanvas) {
                const metallicImageUrl = metallicCanvas.toDataURL({
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
      selectedMaterialIndex,
      textureSize,
      hasMetallic,
      selectedFrameIndex,
      hasAnimation,
      frameCount,
      sizeMultiplier,
      setSizeMultiplier,
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

  useEffect(() => {
    if (metallicCanvas) {
      metallicCanvas.freeDrawingBrush.width = brushSize;
    }
  }, [metallicCanvas, brushSize]);

  useEffect(() => {
    if (metallicCanvas) {
      metallicCanvas.freeDrawingBrush.color = `rgb(${brushColor}, ${brushColor}, ${brushColor})`;
    }
  }, [metallicCanvas, brushColor]);

  return (
    <ToolsContext.Provider value={context}>{children}</ToolsContext.Provider>
  );
}

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

export default function ToolsProvider({ children }: { children: ReactNode }) {
  const { actualModel, selectedModelType } = useWarrior();
  const [selectedMaterialIndex, setSelectedMaterialIndex] = useState(0);
  const materialDefs = materials[actualModel];
  const materialDef = materialDefs[selectedMaterialIndex] ?? null;

  const textureSize = useMemo(
    () => materialDef.size ?? [512, 512],
    [materialDef]
  );

  const hasMetallic = !(
    materialDef.metallicFactor === 0 && materialDef.roughnessFactor === 1
  );

  const [activeCanvasType, setActiveCanvasType] = useState("color");

  if (!hasMetallic && activeCanvasType === "metallic") {
    setActiveCanvasType("color");
  }

  const [backgroundColor, setBackgroundColor] = useState("magenta");
  const [lockedObjects, setLockedObjects] = useState(
    () => new Set<fabric.Object>()
  );
  const [brushColor, setBrushColor] = useState(200);
  const [brushSize, setBrushSize] = useState(10);
  const [selectedObjects, setSelectedObjects] = useState<fabric.Object[]>(
    () => []
  );

  const activeCanvas = materialDef
    ? `${materialDef.name}:${activeCanvasType}`
    : null;
  const metallicCanvasId = materialDef ? `${materialDef.name}:metallic` : null;
  const { canvases } = useCanvas();
  const { canvas, notifyChange, undo, redo, canUndo, canRedo } =
    useCanvas(activeCanvas);
  const { canvas: metallicCanvas } = useCanvas(metallicCanvasId);
  const [isDrawingMode, setDrawingMode] = useState(false);
  const { combineColorAndAlphaImageUrls } = useImageWorker();
  const { canvasPadding } = useSettings();

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
        setDrawingMode(false);
        canvas.centerObject(image);
        canvas.add(image);
        lastAddedImage = image;
      }
      if (lastAddedImage) {
        canvas.setActiveObject(lastAddedImage);
      }
    },
    [canvas, activeCanvasType, textureSize]
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

  const exportSkin = useCallback(
    async ({ format, name = "" }: { format: string; name: string }) => {
      const { savePngFile, saveZipFile, createZipFile } = await import(
        "./exportUtils"
      );

      name = name.trim() || "MyCustomSkin";

      const materialExports = await Promise.all(
        materialDefs.map(async (materialDef: MaterialDefinition) => {
          const colorCanvas = canvases[`${materialDef.name}:color`]?.canvas;
          const metallicCanvas =
            canvases[`${materialDef.name}:metallic`]?.canvas;

          const textureSize = materialDef.size ?? [512, 512];
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

          const filename =
            selectedModelType === "player"
              ? `${name}.${actualModel}.png`
              : materialDef
              ? `${materialDef.file ?? materialDef.name}.png`
              : `weapon_${actualModel}.png`;

          return { imageUrl: outputImageUrl, filename };
        })
      );

      switch (format) {
        case "png": {
          const { imageUrl, filename } = materialExports[selectedMaterialIndex];
          savePngFile(imageUrl, filename);
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
          const zipFileName =
            selectedModelType === "player"
              ? `zPlayerSkin-${name}.vl2`
              : `zWeapon${camelCaseName}-${name}.vl2`;
          await saveZipFile(zip, zipFileName);
        }
      }
      return;
    },
    [
      actualModel,
      canvasPadding,
      canvases,
      combineColorAndAlphaImageUrls,
      materialDefs,
      selectedMaterialIndex,
      selectedModelType,
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
      exportSkin,
      isDrawingMode,
      setDrawingMode,
      selectedMaterialIndex,
      setSelectedMaterialIndex,
      textureSize,
      hasMetallic,
    }),
    [
      activeCanvas,
      activeCanvasType,
      backgroundColor,
      lockedObjects,
      brushColor,
      brushSize,
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
      exportSkin,
      isDrawingMode,
      selectedMaterialIndex,
      textureSize,
      hasMetallic,
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

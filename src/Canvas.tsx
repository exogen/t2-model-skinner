import { useCallback, useEffect, useRef, useState } from "react";
import useCanvas from "./useCanvas";
import useSettings from "./useSettings";
import useTools from "./useTools";
import { fabric } from "fabric";
import { createFabricImage } from "./fabricUtils";

function updateObjectControlOptions() {
  fabric.Object.prototype.set({
    transparentCorners: false,
    borderColor: "#8afff1",
    cornerSize: 9,
    cornerStyle: "circle",
    cornerColor: "#8afff1",
    cornerStrokeColor: "#1c9f7c",
    strokeWidth: 10,
    perPixelTargetFind: true,
  });
}

export interface CanvasProps {
  canvasId: string;
  canvasType: "color" | "metallic";
  onChange: (canvas: fabric.Canvas) => void;
  baseImageUrl: string | null;
  textureSize: [number, number];
  defaultDrawingMode?: boolean;
}

export default function Canvas({
  canvasId,
  onChange,
  baseImageUrl,
  textureSize,
  defaultDrawingMode = false,
}: CanvasProps) {
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);
  const { activeCanvas } = useTools();
  const { canvasPadding } = useSettings();
  const { registerCanvas, unregisterCanvas } = useCanvas();
  const [isDrawingMode, setDrawingMode] = useState(defaultDrawingMode);
  const handleChangeRef = useRef<CanvasProps["onChange"]>();

  const handleChange: CanvasProps["onChange"] = useCallback((canvas) => {
    const handleChange = handleChangeRef.current;
    if (handleChange) {
      handleChange(canvas);
    }
  }, []);

  useEffect(() => {
    handleChangeRef.current = onChange;
  }, [onChange]);

  const isActive = activeCanvas === canvasId;

  useEffect(() => {
    const options = {
      preserveObjectStacking: true,
      targetFindTolerance: 2,
      // imageSmoothingEnabled: false,
    };
    updateObjectControlOptions();

    const canvas = new fabric.Canvas(canvasElementRef.current, options);

    const handleChangeWithCanvasArg = () => {
      handleChange(canvas);
    };

    canvas.on("object:modified", handleChangeWithCanvasArg);
    canvas.on("object:added", handleChangeWithCanvasArg);
    canvas.on("object:removed", handleChangeWithCanvasArg);

    setCanvas(canvas);

    return () => {
      setCanvas(null);
      canvas.dispose();
    };
  }, [handleChange]);

  useEffect(() => {
    if (canvas) {
      canvas.isDrawingMode = isDrawingMode;
    }
  }, [canvas, isDrawingMode]);

  useEffect(() => {
    if (canvas && isActive) {
      canvas.calcOffset();
    }
  }, [canvas, isActive]);

  useEffect(() => {
    if (canvas) {
      registerCanvas(canvasId, {
        canvas,
        notifyChange: () => {
          canvas.renderAll();
          handleChange(canvas);
        },
        isDrawingMode,
        setDrawingMode,
      });
      return () => {
        unregisterCanvas(canvasId);
      };
    }
  }, [
    canvas,
    registerCanvas,
    unregisterCanvas,
    canvasId,
    handleChange,
    isDrawingMode,
    setDrawingMode,
  ]);

  useEffect(() => {
    if (canvas && textureSize) {
      canvas.clear();
      if (baseImageUrl) {
        let stale = false;
        const addImage = async () => {
          const image = await createFabricImage(baseImageUrl);
          if (!stale) {
            if (!image.width || !image.height) {
              throw new Error("Zero-height image");
            }
            image.selectable = false;
            image.lockMovementX = true;
            image.lockMovementY = true;
            image.lockScalingX = true;
            image.lockScalingY = true;
            image.lockRotation = true;
            image.hoverCursor = "default";
            image.moveCursor = "default";
            const [expectedWidth, expectedHeight] = textureSize;
            const scaleX =
              image.width === expectedWidth ? 1 : expectedWidth / image.width;
            const scaleY =
              image.height === expectedHeight
                ? 1
                : expectedHeight / image.height;
            if (scaleX !== 1 || scaleY !== 1) {
              image.scaleX = scaleX;
              image.scaleY = scaleY;
            }
            canvas.centerObject(image);
            canvas.add(image);
          }
        };

        addImage();

        return () => {
          stale = true;
        };
      }
    }
  }, [canvas, baseImageUrl, textureSize]);

  return (
    <div className="CanvasContainer" data-active={isActive ? "true" : "false"}>
      <canvas
        width={textureSize[0] + canvasPadding * 2}
        height={textureSize[1] + canvasPadding * 2}
        ref={canvasElementRef}
      />
    </div>
  );
}

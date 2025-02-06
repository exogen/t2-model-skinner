import { useCallback, useEffect, useRef, useState } from "react";
import useCanvas from "./useCanvas";
import useSettings from "./useSettings";
import useTools from "./useTools";
import { fabric } from "fabric";
import { createFabricImage } from "./fabricUtils";

type JSONSnapshot = ReturnType<(typeof Canvas.prototype)["toJSON"]>;

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
  const trackChanges = useRef(true);
  const [undoHistory, setUndoHistory] = useState<JSONSnapshot[]>(() => []);
  const [redoHistory, setRedoHistory] = useState<JSONSnapshot[]>(() => []);

  const canUndo = undoHistory.length > 1;
  const canRedo = redoHistory.length > 0;

  const handleChange: CanvasProps["onChange"] = useCallback((canvas) => {
    const handleChange = handleChangeRef.current;
    if (handleChange) {
      handleChange(canvas);
    }
  }, []);

  const undo = useCallback(async () => {
    if (!canvas) {
      return;
    }
    if (undoHistory.length > 1) {
      const [restoreState, currentState] = undoHistory.slice(-2);
      trackChanges.current = false;
      canvas.renderOnAddRemove = false;
      canvas.clear();
      canvas.loadFromJSON(restoreState, () => {
        canvas.renderAll();
        trackChanges.current = true;
        canvas.renderOnAddRemove = true;
      });
      setUndoHistory((undoHistory) => undoHistory.slice(0, -1));
      setRedoHistory((redoHistory) => [currentState, ...redoHistory]);
    }
  }, [canvas, undoHistory]);

  const redo = useCallback(() => {
    if (!canvas) {
      return;
    }
    if (redoHistory.length > 0) {
      const nextState = redoHistory[0];
      trackChanges.current = false;
      canvas.renderOnAddRemove = false;
      canvas.clear();
      canvas.loadFromJSON(nextState, () => {
        canvas.renderAll();
        trackChanges.current = true;
        canvas.renderOnAddRemove = true;
      });
      setUndoHistory((undoHistory) => [...undoHistory, nextState]);
      setRedoHistory((redoHistory) => redoHistory.slice(1));
    }
  }, [canvas, redoHistory]);

  useEffect(() => {
    handleChangeRef.current = onChange;
  }, [onChange]);

  const isActive = activeCanvas === canvasId;

  useEffect(() => {
    const options = {
      preserveObjectStacking: true,
      targetFindTolerance: 2,
    };
    updateObjectControlOptions();

    const canvas = new fabric.Canvas(canvasElementRef.current, options);

    let isSnapshotting = false;
    let changeTimer: ReturnType<typeof setTimeout>;

    const handleChangeWithCanvasArg = () => {
      handleChange(canvas);
    };

    const handleRender = () => {
      if (isSnapshotting) {
        return;
      }
      if (!trackChanges.current) {
        return;
      }
      clearTimeout(changeTimer);
      changeTimer = setTimeout(() => {
        const snapshot = snapshotCanvas();
        setUndoHistory((history) => [...history.slice(-5), snapshot]);
        setRedoHistory([]);
      }, 150);
    };

    const snapshotCanvas = () => {
      isSnapshotting = true;
      const snapshot = canvas.toJSON([
        "lockMovementX",
        "lockMovementY",
        "lockRotation",
        "lockScalingX",
        "lockScalingY",
        "selectable",
        "hoverCursor",
        "moveCursor",
      ]);
      isSnapshotting = false;
      return snapshot;
    };

    canvas.on("object:modified", handleChangeWithCanvasArg);
    canvas.on("object:added", handleChangeWithCanvasArg);
    canvas.on("object:removed", handleChangeWithCanvasArg);
    canvas.on("after:render", handleRender);

    setCanvas(canvas);

    return () => {
      clearTimeout(changeTimer);
      setCanvas(null);
      canvas.dispose();
    };
  }, [handleChange]);

  useEffect(() => {
    if (canvas) {
      canvas.isDrawingMode = isDrawingMode;
      if (isDrawingMode) {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
      }
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
        undo,
        redo,
        canUndo,
        canRedo,
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
    undo,
    redo,
    canUndo,
    canRedo,
  ]);

  useEffect(() => {
    if (canvas && textureSize) {
      trackChanges.current = false;
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
          trackChanges.current = true;
          canvas.requestRenderAll();
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

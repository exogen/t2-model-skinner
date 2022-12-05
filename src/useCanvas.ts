import React, { useContext } from "react";
import { fabric } from "fabric";

export interface CanvasInfo {
  canvas: fabric.Canvas;
  notifyChange: () => void;
  isDrawingMode: boolean;
  setDrawingMode: (isDrawingMode: boolean) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

interface CanvasContextValue {
  canvases: Record<string, CanvasInfo>;
  registerCanvas: (canvasId: string, canvasInfo: CanvasInfo) => void;
  unregisterCanvas: (canvasId: string) => void;
}

const CanvasContext = React.createContext<CanvasContextValue | null>(null);
CanvasContext.displayName = "CanvasContext";

export { CanvasContext };

function useCanvas(canvasId: string | null): CanvasInfo;
function useCanvas(): CanvasContextValue;

function useCanvas(canvasId?: string | null) {
  const context = useContext(CanvasContext);
  if (!context) {
    throw new Error("No CanvasContext.Provider");
  }
  if (typeof canvasId === "undefined") {
    return context;
  } else if (canvasId == null) {
    return {};
  } else {
    return context.canvases[canvasId] ?? {};
  }
}

export default useCanvas;

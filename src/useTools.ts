import React, { useContext } from "react";
import { fabric } from "fabric";

interface ToolsContextValue {
  activeCanvas: string | null;
  activeCanvasType: string;
  setActiveCanvasType: (canvasType: string) => void;
  selectedObjects: Array<fabric.Object>;
  brushSize: number;
  setBrushSize: (brushSize: number) => void;
  brushColor: number;
  setBrushColor: (brushColor: number) => void;
  deleteSelection: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  addImages: (imageUrls: string[]) => void;
  duplicate: () => void;
  sendBackward: () => void;
  bringForward: () => void;
  lockSelection: () => void;
  unlockSelection: () => void;
  exportSkin: ({
    name,
    format,
  }: {
    name: string;
    format: string;
  }) => Promise<void>;
  lockedObjects: Set<fabric.Object>;
  backgroundColor: string;
  setBackgroundColor: (backgroundColor: string) => void;
  selectedMaterialIndex: number;
  setSelectedMaterialIndex: (materialIndex: number) => void;
  textureSize: [number, number];
  hasMetallic: boolean;
}

const ToolsContext = React.createContext<ToolsContextValue | null>(null);
ToolsContext.displayName = "ToolsContext";

export { ToolsContext };

export default function useTools() {
  const context = useContext(ToolsContext);
  if (!context) {
    throw new Error("No ToolsContext.Provider");
  }
  return context;
}

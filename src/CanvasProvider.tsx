import { ReactNode, useCallback, useMemo, useState } from "react";
import { CanvasContext, CanvasInfo } from "./useCanvas";

export default function CanvasProvider({ children }: { children: ReactNode }) {
  const [canvases, setCanvases] = useState<Record<string, CanvasInfo>>({});

  const registerCanvas = useCallback(
    (canvasId: string, canvasInfo: CanvasInfo) => {
      setCanvases((canvases) => {
        return { ...canvases, [canvasId]: canvasInfo };
      });
    },
    []
  );

  const unregisterCanvas = useCallback((canvasId: string) => {
    setCanvases((canvases) => {
      const { [canvasId]: canvas, ...rest } = canvases;
      return rest;
    });
  }, []);

  const context = useMemo(() => {
    return {
      canvases,
      registerCanvas,
      unregisterCanvas,
    };
  }, [canvases, registerCanvas, unregisterCanvas]);

  return (
    <CanvasContext.Provider value={context}>{children}</CanvasContext.Provider>
  );
}

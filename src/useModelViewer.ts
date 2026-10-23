import React, { useContext } from "react";
import type Viewer from "./Viewer";
import type { LoadedModel } from "./Viewer";

export const ModelViewerContext = React.createContext<LoadedModel & { viewer: Viewer } | null>(null);
ModelViewerContext.displayName = "ModelViewerContext";

export default function useModelViewer() {
  const context = useContext(ModelViewerContext);
  if (!context) {
    throw new Error("No ModelViewerContext.Provider");
  }
  return context;
}

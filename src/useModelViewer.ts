import React, { useContext } from "react";
import { ModelViewerElement } from "@google/model-viewer";

export const ModelViewerContext = React.createContext<{
  modelViewer: ModelViewerElement;
  model: NonNullable<ModelViewerElement["model"]>;
  isLoaded: boolean;
} | null>(null);
ModelViewerContext.displayName = "ModelViewerContext";

export default function useModelViewer() {
  const context = useContext(ModelViewerContext);
  if (!context) {
    throw new Error("No ModelViewerContext.Provider");
  }
  return context;
}

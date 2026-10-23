import { createContext, useContext } from "react";
import type Viewer from "./Viewer";

interface ViewerContextValue {
  /** Set while the 3D view shows a loaded model. */
  viewer: Viewer | null;
  setViewer: (viewer: Viewer | null) => void;
}

/** The editor's 3D viewer, for controls outside WarriorViewer, like Save image. */
export const ViewerContext = createContext<ViewerContextValue | null>(null);
ViewerContext.displayName = "ViewerContext";

export default function useViewer() {
  const context = useContext(ViewerContext);
  if (!context) throw new Error("No ViewerProvider");
  return context;
}

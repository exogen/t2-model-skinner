import { ReactNode, useMemo, useState } from "react";
import { ViewerContext } from "./useViewer";
import type Viewer from "./Viewer";

export default function ViewerProvider({ children }: { children: ReactNode }) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const value = useMemo(() => ({ viewer, setViewer }), [viewer]);
  return (
    <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>
  );
}

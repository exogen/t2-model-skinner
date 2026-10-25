import React, { useContext } from "react";
import type { RenderMode } from "./renderModes";

interface EnvironmentContextValue {
  selectedEnvironment: string | null;
  setSelectedEnvironment: (selectedEnvironment: string | null) => void;
  showEnvironment: boolean;
  setShowEnvironment: (showEnvironment: boolean) => void;
  exposure: number;
  setExposure: (exposure: number) => void;
  environmentImageUrl: string | null;
  renderMode: RenderMode;
  setRenderMode: (renderMode: RenderMode) => void;
}

const EnvironmentContext = React.createContext<EnvironmentContextValue | null>(
  null
);
EnvironmentContext.displayName = "EnvironmentContext";

export { EnvironmentContext };

export default function useEnvironment() {
  const context = useContext(EnvironmentContext);
  if (!context) {
    throw new Error("No EnvironmentContext.Provider");
  }
  return context;
}

import React, { useContext } from "react";

interface EnvironmentContextValue {
  selectedEnvironment: string | null;
  setSelectedEnvironment: (selectedEnvironment: string | null) => void;
  showEnvironment: boolean;
  setShowEnvironment: (showEnvironment: boolean) => void;
  exposure: number;
  setExposure: (exposure: number) => void;
  environmentImageUrl: string | null;
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

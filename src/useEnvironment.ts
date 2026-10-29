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
  /** The weapon players hold, or null for none. */
  heldWeapon: string | null;
  setHeldWeapon: (heldWeapon: string | null) => void;
  /** The held weapon's skin, as its type and name like "custom/Name", or
   * null for its default skin. */
  heldWeaponSkin: string | null;
  setHeldWeaponSkin: (heldWeaponSkin: string | null) => void;
}

const EnvironmentContext = React.createContext<EnvironmentContextValue | null>(
  null,
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

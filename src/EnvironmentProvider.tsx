import { ReactNode, useCallback, useMemo, useState } from "react";
import { EnvironmentContext } from "./useEnvironment";
import useSettings from "./useSettings";
import { getLocalAssetUrl } from "./deployPaths";
import type { RenderMode } from "./renderModes";

export default function EnvironmentProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [selectedEnvironment, setSelectedEnvironment] = useState<string | null>(
    null
  );
  const [showEnvironment, setShowEnvironment] = useState(false);
  const [exposure, setExposure] = useState(1);
  const [renderMode, setRenderMode] = useState<RenderMode>("skin");
  const [heldWeapon, setWeapon] = useState<string | null>(null);
  const [heldWeaponSkin, setHeldWeaponSkin] = useState<string | null>(null);
  // Each weapon has its own skins.
  const setHeldWeapon = useCallback((weapon: string | null) => {
    setWeapon(weapon);
    setHeldWeaponSkin(null);
  }, []);
  const { basePath } = useSettings();

  const context = useMemo(() => {
    const environmentImageUrl = selectedEnvironment
      ? getLocalAssetUrl(basePath, selectedEnvironment)
      : null;
    return {
      selectedEnvironment,
      setSelectedEnvironment,
      showEnvironment,
      setShowEnvironment,
      exposure,
      setExposure,
      environmentImageUrl,
      renderMode,
      setRenderMode,
      heldWeapon,
      setHeldWeapon,
      heldWeaponSkin,
      setHeldWeaponSkin,
    };
  }, [basePath, selectedEnvironment, showEnvironment, exposure, renderMode, heldWeapon, setHeldWeapon, heldWeaponSkin]);

  return (
    <EnvironmentContext.Provider value={context}>
      {children}
    </EnvironmentContext.Provider>
  );
}

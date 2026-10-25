import { ReactNode, useMemo, useState } from "react";
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
    };
  }, [basePath, selectedEnvironment, showEnvironment, exposure, renderMode]);

  return (
    <EnvironmentContext.Provider value={context}>
      {children}
    </EnvironmentContext.Provider>
  );
}

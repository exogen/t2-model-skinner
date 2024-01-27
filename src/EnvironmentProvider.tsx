import { ReactNode, useMemo, useState } from "react";
import { EnvironmentContext } from "./useEnvironment";
import useSettings from "./useSettings";

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
  const { basePath } = useSettings();

  const context = useMemo(() => {
    const environmentImageUrl = selectedEnvironment
      ? `${basePath}/${selectedEnvironment}`
      : null;
    return {
      selectedEnvironment,
      setSelectedEnvironment,
      showEnvironment,
      setShowEnvironment,
      exposure,
      setExposure,
      environmentImageUrl,
    };
  }, [basePath, selectedEnvironment, showEnvironment, exposure]);

  return (
    <EnvironmentContext.Provider value={context}>
      {children}
    </EnvironmentContext.Provider>
  );
}

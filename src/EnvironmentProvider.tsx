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
  const { basePath } = useSettings();

  const context = useMemo(() => {
    const environmentImageUrl = selectedEnvironment
      ? `${basePath}/${selectedEnvironment}`
      : null;
    return {
      selectedEnvironment,
      setSelectedEnvironment,
      environmentImageUrl,
    };
  }, [basePath, selectedEnvironment, setSelectedEnvironment]);

  return (
    <EnvironmentContext.Provider value={context}>
      {children}
    </EnvironmentContext.Provider>
  );
}

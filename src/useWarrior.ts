import React, { useContext } from "react";
import { Skin } from "./importUtils";
import type { ModelType } from "./models";

type WarriorContextValue = {
  actualModel: string;
  selectedModel: string;
  setSelectedModel: (selectedModel: string) => void;
  selectedModelType: ModelType | undefined;
  selectedAnimation: string | null;
  selectedModelUrl: string;
  setSelectedAnimation: (selectedAnimation: string | null) => void;
  animationPaused: boolean;
  setAnimationPaused: (
    animationPaused: boolean | ((animationPaused: boolean) => boolean)
  ) => void;
  skinImageUrls: Record<string, string[]>;
  defaultSkinImageUrls: Record<string, string[]>;
  selectedSkinType: string | null;
  setSelectedSkinType: (selectedSkinType: string | null) => void;
  selectedSkin: string | null;
  setSelectedSkin: (selectedSkin: string | null) => void;
  slowModeEnabled: boolean;
  setSlowModeEnabled: (slowModeEnabled: boolean) => void;
  importedSkins: Map<string, Map<string | null, Skin>>;
  addImportedSkins: (newSkins: Map<string, Map<string | null, Skin>>) => void;
};

const WarriorContext = React.createContext<WarriorContextValue | null>(null);
WarriorContext.displayName = "WarriorContext";

export { WarriorContext };

export default function useWarrior() {
  const context = useContext(WarriorContext);
  if (!context) {
    throw new Error("No WarriorContext.Provider");
  }
  return context;
}

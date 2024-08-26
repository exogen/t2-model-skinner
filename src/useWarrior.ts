import React, { useContext } from "react";

type WarriorContextValue = {
  actualModel: string;
  selectedModel: string;
  setSelectedModel: (selectedModel: string) => void;
  selectedModelType: string;
  selectedAnimation: string | null;
  selectedModelUrl: string;
  setSelectedAnimation: (selectedAnimation: string | null) => void;
  animationPaused: boolean;
  setAnimationPaused: (
    animationPaused: boolean | ((animationPaused: boolean) => boolean)
  ) => void;
  skinImageUrls: Record<string, string[]>;
  defaultSkinImageUrls: Record<string, string[]>;
  setSkinImageUrls: (
    value:
      | Record<string, string[]>
      | ((
          prevSkinImageUrls: Record<string, string[]>
        ) => Record<string, string[]>)
  ) => void;
  selectedSkinType: string | null;
  setSelectedSkinType: (selectedSkinType: string | null) => void;
  selectedSkin: string | null;
  setSelectedSkin: (selectedSkin: string | null) => void;
  setSelectedModelType: (selectedModelType: string) => void;
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

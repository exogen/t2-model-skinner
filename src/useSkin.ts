import React, { useContext } from "react";

export type SkinImages = {
  colorImageUrl?: string[];
  metallicImageUrl?: string[];
};

export type MaterialSkins = Record<string, SkinImages>;

interface SkinContextValue {
  getSkinImages: (materialFile: string) => SkinImages;
  setColorImageUrl: (
    materialFile: string,
    colorImageUrl: string,
    frameIndex: number
  ) => void;
  setMetallicImageUrl: (
    materialFile: string,
    metallicImageUrl: string,
    frameIndex: number
  ) => void;
}

const SkinContext = React.createContext<SkinContextValue | null>(null);
SkinContext.displayName = "SkinContext";

export { SkinContext };

export default function useSkin() {
  const context = useContext(SkinContext);
  if (!context) {
    throw new Error("No SkinContext.Provider");
  }
  return context;
}

import React, { useContext } from "react";

export type SkinImages = {
  colorImageUrl?: string[];
  metallicImageUrl?: string[];
};

export type MaterialSkins = Record<string, SkinImages>;

interface SkinContextValue {
  materialSkins: MaterialSkins;
  getSkinImages: (materialFile: string) => SkinImages;
  setSkinImages: (materialFile: string, skinImages: SkinImages) => void;
  getColorImageUrl: (
    materialFile: string,
    frameIndex: number
  ) => string | undefined;
  setColorImageUrl: (
    materialFile: string,
    colorImageUrl: string,
    frameIndex: number
  ) => void;
  getMetallicImageUrl: (
    materialFile: string,
    frameIndex: number
  ) => string | undefined;
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

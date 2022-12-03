import React, { useContext } from "react";

export type SkinImages = {
  colorImageUrl?: string;
  metallicImageUrl?: string;
};

export type MaterialSkins = Record<string, SkinImages>;

interface SkinContextValue {
  materialSkins: MaterialSkins;
  getSkinImages: (materialName: string) => SkinImages;
  setSkinImages: (materialName: string, skinImages: SkinImages) => void;
  getColorImageUrl: (materialName: string) => string | undefined;
  setColorImageUrl: (materialName: string, colorImageUrl: string) => void;
  getMetallicImageUrl: (materialName: string) => string | undefined;
  setMetallicImageUrl: (materialName: string, colorImageUrl: string) => void;
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

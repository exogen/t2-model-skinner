import React, { useContext } from "react";

export type SkinImages = {
  colorImageUrl?: string;
  metallicImageUrl?: string;
};

export type MaterialSkins = Record<string, SkinImages>;

interface SkinContextValue {
  materialSkins: MaterialSkins;
  getSkinImages: (materialFile: string) => SkinImages;
  setSkinImages: (materialFile: string, skinImages: SkinImages) => void;
  getColorImageUrl: (materialFile: string) => string | undefined;
  setColorImageUrl: (materialFile: string, colorImageUrl: string) => void;
  getMetallicImageUrl: (materialFile: string) => string | undefined;
  setMetallicImageUrl: (materialFile: string, colorImageUrl: string) => void;
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

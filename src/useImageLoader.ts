import React, { useContext } from "react";

interface ImageLoaderContextValue {
  loadImage: (url: string) => Promise<ArrayBuffer>;
}

export const ImageLoaderContext =
  React.createContext<ImageLoaderContextValue | null>(null);
ImageLoaderContext.displayName = "ImageLoaderContext";

export default function useImageLoader() {
  const context = useContext(ImageLoaderContext);
  if (!context) {
    throw new Error("ImageLoaderContext.Provider not found!");
  }
  return context;
}

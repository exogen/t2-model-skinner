import { useState, useEffect } from "react";
import { SKIN_MANIFEST_URL } from "./deployPaths";
import useAsyncTask from "./useAsyncTask";

export type Manifest = {
  customSkins: Record<string, string[]>;
  newSkins: Record<string, string[]>;
  packs: Record<
    string,
    {
      version: string;
      skins: Record<string, string[]>;
      files: string[];
    }
  >;
  sizeMultiplier: Record<string, number>;
};

export const defaultManifest: Manifest = {
  customSkins: {},
  newSkins: {},
  packs: {},
  sizeMultiplier: {},
};

export default function useManifest(): [Manifest, boolean] {
  const [manifest, setManifest] = useState<Manifest>(defaultManifest);

  const load = useAsyncTask();
  useEffect(() => {
    void load(async (signal) => {
      const response = await fetch(SKIN_MANIFEST_URL, { signal });
      if (!response.ok) throw new Error("Unable to load the skin manifest");
      return (await response.json()) as Manifest;
    }, setManifest).catch(console.error);
  }, [load]);

  const isLoaded = manifest !== defaultManifest;
  return [manifest, isLoaded];
}

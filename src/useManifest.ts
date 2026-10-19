import { useState, useEffect, useCallback } from "react";
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

export default function useManifest(): [Manifest, boolean, { error: boolean; retry: () => void }] {
  const [manifest, setManifest] = useState<Manifest>(defaultManifest);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setError(false);
    setAttempt((value) => value + 1);
  }, []);

  const load = useAsyncTask(true);
  useEffect(() => {
    void load(async (signal) => {
      const response = await fetch(SKIN_MANIFEST_URL, { signal });
      if (!response.ok) throw new Error("Unable to load the skin manifest");
      return (await response.json()) as Manifest;
    }, (value) => {
      setManifest(value);
      setError(false);
    }).catch((cause: unknown) => {
      setError(true);
      console.error(cause);
    });
  }, [load, attempt]);

  const isLoaded = manifest !== defaultManifest;
  return [manifest, isLoaded, { error, retry }];
}

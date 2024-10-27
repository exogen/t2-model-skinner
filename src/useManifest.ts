import { useState, useEffect } from "react";

export type Manifest = {
  customSkins: Record<string, string[]>;
  newSkins: Record<string, string[]>;
};

const baseManifestPath = `https://exogen.github.io/t2-skins`;
export const defaultManifest: Manifest = {
  customSkins: {},
  newSkins: {},
};

export default function useManifest(): [Manifest, boolean] {
  const [manifest, setManifest] = useState<Manifest>(defaultManifest);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    let ignore = false;

    const loadCustomSkins = async () => {
      let res;
      try {
        res = await fetch(`${baseManifestPath}/skins.json`, { signal });
        if (!ignore) {
          const json = await res.json();
          if (!ignore) {
            setManifest(json as Manifest);
          }
        }
      } catch (err) {
        console.error(err);
      }
    };

    loadCustomSkins();

    return () => {
      ignore = true;
      controller.abort();
    };
  }, []);

  const isLoaded = manifest !== defaultManifest;
  return [manifest, isLoaded];
}

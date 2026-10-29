import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { SKIN_MANIFEST_URL } from "./deployPaths";

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

async function fetchManifest({ signal }: { signal: AbortSignal }) {
  try {
    const response = await fetch(SKIN_MANIFEST_URL, { signal });
    if (!response.ok) throw new Error("Unable to load the skin manifest");
    return (await response.json()) as Manifest;
  } catch (error) {
    // Logged once per failed request, not per component. Leaving the page
    // while it loads isn't a failure.
    if (!signal.aborted) console.error(error);
    throw error;
  }
}

/** The skin manifest, loaded once per page and shared by everything that
 * uses it. A failed load waits for `retry`. */
export default function useManifest(): [
  Manifest,
  boolean,
  { error: boolean; retry: () => void },
] {
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: [SKIN_MANIFEST_URL],
    queryFn: fetchManifest,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  // A retry clears the error while it loads.
  return [
    data ?? defaultManifest,
    data !== undefined,
    { error: !!error && !isFetching, retry },
  ];
}

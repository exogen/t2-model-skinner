import { ReactNode, useLayoutEffect, useMemo, useRef } from "react";
import * as Comlink from "comlink";
import type { ImageFunctions } from "./imageProcessing.worker";
import { ImageWorkerContext } from "./useImageWorker";

export default function ImageWorkerProvider({
  children,
}: {
  children: ReactNode;
}) {
  const functionsRef = useRef<ReturnType<
    typeof Comlink.wrap<ImageFunctions>
  > | null>(null);

  const value = useMemo<ImageFunctions>(() => {
    const getFunctions = () => {
      if (!functionsRef.current) throw new Error("Image worker is not ready");
      return functionsRef.current;
    };
    return {
      async combineColorAndAlphaImageUrls(...args) {
        const functions = getFunctions();
        return await functions.combineColorAndAlphaImageUrls(...args);
      },
      async removeAlphaFromArrayBuffer(...args) {
        const functions = getFunctions();
        return await functions.removeAlphaFromArrayBuffer(...args);
      },
      async convertArrayBufferAlphaToGrayscale(...args) {
        const functions = getFunctions();
        return await functions.convertArrayBufferAlphaToGrayscale(...args);
      },
      async convertGrayscaleImageUrlToMetallicRoughness(...args) {
        const functions = getFunctions();
        return functions.convertGrayscaleImageUrlToMetallicRoughness(...args);
      },
    };
  }, []);

  useLayoutEffect(() => {
    const worker = new Worker(
      new URL("./imageProcessing.worker.ts", import.meta.url)
    );
    const proxy = Comlink.wrap<ImageFunctions>(worker);

    functionsRef.current = proxy;

    return () => {
      proxy[Comlink.releaseProxy]();
      functionsRef.current = null;
      worker.terminate();
    };
  }, []);

  return (
    <ImageWorkerContext.Provider value={value}>
      {children}
    </ImageWorkerContext.Provider>
  );
}

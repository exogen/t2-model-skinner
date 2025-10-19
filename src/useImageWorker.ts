import { useEffect, useMemo, useRef } from "react";
import * as Comlink from "comlink";
import type { ImageFunctions } from "./imageProcessing.worker";

export default function useImageWorker() {
  const workerRef = useRef<Worker | null>(null);
  const functionsRef = useRef<ReturnType<
    typeof Comlink.wrap<ImageFunctions>
  > | null>(null);

  const value = useMemo(() => {
    const getFunctions = () => {
      return functionsRef.current;
    };
    return {
      async combineColorAndAlphaImageUrls(...args) {
        const functions = getFunctions();
        return await functions?.combineColorAndAlphaImageUrls(...args);
      },
      async removeAlphaFromArrayBuffer(...args) {
        const functions = getFunctions();
        return await functions?.removeAlphaFromArrayBuffer(...args);
      },
      async convertArrayBufferAlphaToGrayscale(...args) {
        const functions = getFunctions();
        return await functions?.convertArrayBufferAlphaToGrayscale(...args);
      },
      async convertGrayscaleImageUrlToMetallicRoughness(...args) {
        const functions = await getFunctions();
        return functions?.convertGrayscaleImageUrlToMetallicRoughness(...args);
      },
    } as ImageFunctions;
  }, []);

  useEffect(() => {
    const worker = new Worker(
      new URL("./imageProcessing.worker.ts", import.meta.url)
    );
    const proxy = Comlink.wrap<ImageFunctions>(worker);

    workerRef.current = worker;
    functionsRef.current = proxy;

    return () => {
      proxy[Comlink.releaseProxy]();
      functionsRef.current = null;
      worker.terminate();
    };
  }, []);

  return value;
}

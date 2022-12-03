import { useEffect, useMemo, useRef } from "react";
import * as Comlink from "comlink";
import Worker from "worker-loader!./imageProcessing.worker";
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
        const functions = await getFunctions();
        return functions?.combineColorAndAlphaImageUrls(...args);
      },
      async removeAlphaFromArrayBuffer(...args) {
        const functions = await getFunctions();
        return functions?.removeAlphaFromArrayBuffer(...args);
      },
      async convertArrayBufferAlphaToGrayscale(...args) {
        const functions = await getFunctions();
        return functions?.convertArrayBufferAlphaToGrayscale(...args);
      },
      async convertGrayscaleImageUrlToMetallicRoughness(...args) {
        const functions = await getFunctions();
        return functions?.convertGrayscaleImageUrlToMetallicRoughness(...args);
      },
    } as ImageFunctions;
  }, []);

  useEffect(() => {
    const worker = new Worker();
    const functions = Comlink.wrap<ImageFunctions>(worker);

    workerRef.current = worker;
    functionsRef.current = functions;

    return () => {
      functions[Comlink.releaseProxy]();
      worker.terminate();
    };
  }, []);

  return value;
}

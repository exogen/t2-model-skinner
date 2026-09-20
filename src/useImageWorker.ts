import { createContext, useContext } from "react";
import type { ImageFunctions } from "./imageProcessing.worker";

export const ImageWorkerContext = createContext<ImageFunctions | null>(null);

export default function useImageWorker() {
  const worker = useContext(ImageWorkerContext);
  if (!worker) throw new Error("No ImageWorkerContext.Provider");
  return worker;
}

import * as Comlink from "comlink";
import {
  combineColorAndAlphaImageUrls,
  removeAlphaFromArrayBuffer,
  convertGrayscaleImageUrlToMetallicRoughness,
  convertArrayBufferAlphaToGrayscale,
} from "./imageUtils";

const exports = {
  combineColorAndAlphaImageUrls,
  removeAlphaFromArrayBuffer,
  convertArrayBufferAlphaToGrayscale,
  convertGrayscaleImageUrlToMetallicRoughness,
};

export type ImageFunctions = typeof exports;

Comlink.expose(exports);

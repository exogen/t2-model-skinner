declare module "pngjs/browser" {
  import type { PNG as NodePNG } from "pngjs";

  export class PNG extends NodePNG {
    data: Uint8Array;

    parse(
      arrayBuffer: ArrayBuffer,
      callback: (error: Error, data: PNG) => void
    );
  }
}

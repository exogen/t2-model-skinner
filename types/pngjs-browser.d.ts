declare module "pngjs/browser" {
  import type { PNG as NodePNG } from "pngjs";

  export class PNG extends NodePNG {
    data: Uint8Array;
    width: number;
    height: number;

    constructor(options?: {
      width?: number;
      height?: number;
      inputHasAlpha?: boolean;
    });

    on(eventName: "data", callback: (chunk: Uint8Array) => void);
    on(eventName: "end", callback: () => void);
    on(eventName: "error", callback: (err: Error | string) => void);

    pack: () => PNG;

    parse(
      arrayBuffer: ArrayBuffer,
      callback: (error: Error, data: PNG) => void
    );
  }
}

export {};

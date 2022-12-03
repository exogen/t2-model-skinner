import { fabric } from "fabric";

export function createFabricImage(url: string) {
  return new Promise<fabric.Image>((resolve) =>
    fabric.Image.fromURL(url, resolve, {
      crossOrigin: "anonymous",
    })
  );
}

import { FabricImage } from "fabric";

export async function createFabricImage(url: string) {
  const img = await FabricImage.fromURL(url, { crossOrigin: "anonymous" });
  return img;
}

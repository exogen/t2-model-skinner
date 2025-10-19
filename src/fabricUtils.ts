"use client";
import { fabric } from "fabric";

export async function createFabricImage(url: string) {
  const promise = new Promise<fabric.Image>((resolve) =>
    fabric.Image.fromURL(url, resolve, {
      crossOrigin: "anonymous",
    })
  );
  const img = await promise;
  return img;
}

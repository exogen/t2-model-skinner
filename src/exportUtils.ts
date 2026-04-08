import JSZip from "jszip";
import { saveAs } from "file-saver";
import { SKIN_ASSET_BASE_URL } from "./deployPaths";

export function createZipFile(
  files: Array<{ name: string; data: ArrayBuffer | Blob }>,
) {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(`textures/skins/${file.name}`, file.data);
  }
  return zip;
}

export async function saveZipFile(zip: JSZip, name: string) {
  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, name);
}

export function savePngFile(imageUrl: string, name: string) {
  saveAs(imageUrl, name);
}

export async function collectFiles(
  files: string[],
  { skipNotFound = false }: { skipNotFound?: boolean } = {},
) {
  const results = await Promise.all(
    files.map(async (fileName) => {
      const url = `${SKIN_ASSET_BASE_URL}/${fileName}`;
      const res = await fetch(url);
      if (!res.ok) {
        if (skipNotFound && res.status === 404) {
          return null;
        }
        throw new Error(`Response failed: ${res.status} ${res.statusText}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      return {
        name: fileName.replace(/@1x\.png$/, ".png"),
        data: arrayBuffer,
      };
    }),
  );
  return results.filter((fileInfo) => fileInfo != null);
}

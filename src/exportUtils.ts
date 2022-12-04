import JSZip from "jszip";
import { saveAs } from "file-saver";

export function createZipFile(
  files: Array<{ name: string; data: ArrayBuffer }>
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

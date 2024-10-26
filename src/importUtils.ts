import JSZip from "jszip";

export async function readZipFile(inputFile: File) {
  const content = await JSZip.loadAsync(inputFile);
  const skins = await Promise.all(
    Object.entries(content.files).map(async ([path, file]) => {
      const match = /([^/]+)\.([lmh](?:male|female|bioderm))\.png$/g.exec(path);
      if (match) {
        const base64string = await file.async("base64");
        return {
          name: match[1],
          model: match[2],
          imageUrl: `data:image/png;base64,${base64string}`,
        };
      }
    })
  );
  return skins.filter(Boolean);
}

export function detectFileType(file: File) {
  if (file.name.match(/\.png$/i)) {
    return "png";
  } else if (file.name.match(/\.zip$/i)) {
    return "zip";
  } else if (file.name.match(/\.vl2$/i)) {
    return "vl2";
  }
}

export function nameToMaterial(filename: string) {}

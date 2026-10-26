import JSZip from "jszip";
import { util } from "fabric";
import modelConfig, { type MaterialDefinition } from "./models";

const materialMap: Record<string, MaterialDefinition[]> = modelConfig.materials;

const ignoreFilePattern = /^(\.|__MACOSX)/;

export async function readZipFile(inputFile: File) {
  const content = await JSZip.loadAsync(inputFile);
  const skins = await Promise.all(
    Object.entries(content.files).map(async ([path, file]) => {
      if (!ignoreFilePattern.test(path)) {
        const match = /\.png$/i.exec(path);
        if (match) {
          const base64string = await file.async("base64");
          return {
            path,
            imageUrl: `data:image/png;base64,${base64string}`,
          };
        }
      }
    })
  );
  return skins.filter((x): x is NonNullable<typeof x> => Boolean(x));
}

export function detectFileType(file: File) {
  if (file.name.match(/\.png$/i)) {
    return "png";
  } else if (file.name.match(/\.skin$/i)) {
    return "skin";
  } else if (file.name.match(/\.zip$/i)) {
    return "zip";
  } else if (file.name.match(/\.vl2$/i)) {
    return "vl2";
  }
}

// Images can be at most this big, as files and in pixels on each side.
export const maxImageBytes = 50 * 1024 * 1024;
export const maxImageSize = 8192;

/** An error whose message is meant for the user. */
export class ImageError extends Error {}

export const unreadableImage =
  "This image couldn't be opened. Try saving it as a PNG.";
export const imageTooBig =
  "This image is too big. The limit is 8192 × 8192 pixels and 50 MB.";

function readBlob<T extends string | ArrayBuffer>(
  blob: Blob,
  method: "readAsDataURL" | "readAsText" | "readAsArrayBuffer"
) {
  return new Promise<T>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as T));
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Unable to read file"));
    });
    reader[method](blob);
  });
}

export function blobToDataUrl(blob: Blob) {
  return readBlob<string>(blob, "readAsDataURL");
}

function sniffImageType(bytes: Uint8Array) {
  const head = String.fromCharCode(...Array.from(bytes));
  if (head.startsWith("\x89PNG\r\n\x1A\n")) return "image/png";
  if (head.startsWith("\xFF\xD8\xFF")) return "image/jpeg";
  if (/^GIF8[79]a/.test(head)) return "image/gif";
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "image/webp";
  if (head.startsWith("BM")) return "image/bmp";
}

/** The type of image a file holds, judged by its first bytes, not its label.
 * SVG has no signature, so it counts by its type or name and is checked when
 * it's read. */
export async function imageFileType(file: Blob, name = (file as File).name ?? "") {
  const head = await readBlob<ArrayBuffer>(file.slice(0, 12), "readAsArrayBuffer");
  return (
    sniffImageType(new Uint8Array(head)) ??
    (file.type === "image/svg+xml" || /\.svg$/i.test(name)
      ? "image/svg+xml"
      : undefined)
  );
}

const svgNamespace = "http://www.w3.org/2000/svg";

/** A width or height in plain pixels, like "24" or "24px". */
function pixelLength(value: string | null) {
  const match = value?.trim().match(/^(\d*\.?\d+)(?:px)?$/);
  return match ? Number(match[1]) : null;
}

/** SVG markup as an image data URL, or null if it has no SVG. Images need
 * valid XML, which markup copied from a web page often isn't. An SVG sized
 * only by its viewBox has no natural size in some browsers, and some SVG
 * renderers need both a width and a height, so a missing one is filled in
 * from the viewBox's shape, as browsers do. */
function svgDataUrl(markup: string) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(markup, "image/svg+xml");
  let svg: Element | null = xml.documentElement;
  if (
    svg.namespaceURI !== svgNamespace ||
    svg.localName !== "svg" ||
    xml.getElementsByTagName("parsererror").length
  ) {
    svg = parser.parseFromString(markup, "text/html").querySelector("svg");
  }
  if (!svg) return null;
  const viewBox = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
    const [, , viewWidth, viewHeight] = viewBox;
    const hasWidth = svg.hasAttribute("width");
    const hasHeight = svg.hasAttribute("height");
    const width = pixelLength(svg.getAttribute("width"));
    const height = pixelLength(svg.getAttribute("height"));
    if (!hasWidth && !hasHeight) {
      svg.setAttribute("width", String(viewWidth));
      svg.setAttribute("height", String(viewHeight));
    } else if (width != null && !hasHeight) {
      svg.setAttribute("height", String((width * viewHeight) / viewWidth));
    } else if (height != null && !hasWidth) {
      svg.setAttribute("width", String((height * viewWidth) / viewHeight));
    }
  }
  const source = new XMLSerializer().serializeToString(svg);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}

// Layers keep SVGs as PNGs, so projects never hold SVG code.
async function svgToPng(markup: string) {
  const url = svgDataUrl(markup);
  if (!url) throw new ImageError(unreadableImage);
  const image = await util.loadImage(url).catch((error: unknown) => {
    throw new ImageError(unreadableImage, { cause: error });
  });
  const { naturalWidth: width, naturalHeight: height } = image;
  if (!width || !height) throw new ImageError(unreadableImage);
  if (width > maxImageSize || height > maxImageSize) {
    throw new ImageError(imageTooBig);
  }
  const canvas = util.createCanvasElement();
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(image, 0, 0, width, height);
  try {
    // Throws if the browser won't let a page read this SVG's pixels.
    return canvas.toDataURL("image/png");
  } catch (error) {
    throw new ImageError(unreadableImage, { cause: error });
  }
}

/** Reads an image file into a data URL for a layer, typed by its contents.
 * Rejects files that aren't a supported image or are too big. */
export async function readImageFile(file: Blob, name = (file as File).name ?? "") {
  if (file.size > maxImageBytes) throw new ImageError(imageTooBig);
  const type = await imageFileType(file, name);
  if (!type) throw new ImageError(unreadableImage);
  if (type === "image/svg+xml") {
    return svgToPng(await readBlob<string>(file, "readAsText"));
  }
  return blobToDataUrl(new Blob([file], { type }));
}

export async function readMultipleFiles(fileList: FileList | File[]) {
  const files = await Promise.all(
    Array.from(fileList).map(async (file) => {
      if (ignoreFilePattern.test(file.name)) {
        return null;
      }
      const fileType = detectFileType(file);
      switch (fileType) {
        case "zip":
        case "vl2": {
          const match = file.name.match(/^(.+)\.(zip|vl2)$/i);
          const name = match ? match[1] : file.name;
          return (await readZipFile(file)).map(
            (imageFile: { path: string; imageUrl: string }) => ({
              ...imageFile,
              path: `${file.name}/${imageFile.path}`,
              name,
            })
          );
        }
        case "png":
          return {
            path: file.name,
            imageUrl: await blobToDataUrl(file),
            name: null,
          };
        default:
          return null;
      }
    })
  );
  return files.flat().filter((x): x is NonNullable<typeof x> => Boolean(x));
}

function createReverseFileMap() {
  const map = new Map();
  for (const modelName in materialMap) {
    materialMap[modelName].forEach((material, i) => {
      let filename;
      if (material.fileSuffix) {
        filename = material.fileSuffix;
      } else if (
        material.selectable !== false &&
        material.hidden !== true &&
        (material.file || material.name)
      ) {
        filename = material.file || material.name;
      }
      if (filename) {
        const models = map.get(filename) ?? [];
        models.push({ modelName, material, index: i });
        map.set(filename, models);
      }
    });
  }
  return map;
}

let pathToModelMap: Map<
  string,
  Array<{
    modelName: string;
    material: MaterialDefinition;
    index: number;
    frameIndex?: number;
  }>
>;

function getFrameInfo(nameWithoutExtension: string) {
  const match = /^(.+[^\d])(\d{2,})$/.exec(nameWithoutExtension);
  if (match) {
    const head = match[1];
    const tail = match[2];
    const frameIndex = parseInt(tail, 10);
    const frameZeroFile = `${head}${"0".padStart(tail.length, "0")}`;
    const models = pathToModelMap.get(frameZeroFile) ?? [];
    return models
      .filter((model) => typeof model.material.frameCount === "number")
      .map((model) => {
        return {
          ...model,
          frameIndex,
        };
      });
  }
  return [];
}

function pathToModels(path: string, skinName: string | null = null) {
  if (!pathToModelMap) {
    pathToModelMap = createReverseFileMap();
  }
  const basename = path.split("/").slice(-1)[0];
  const match = basename.match(/^(.+)\.(PNG|png)$/);
  if (match) {
    const nameWithoutExtension = match[1];
    const parts = nameWithoutExtension.split(".");
    if (parts.length > 1) {
      const key = `.${parts[parts.length - 1]}`;
      const models = pathToModelMap.get(key);
      if (models) {
        return {
          path,
          basename,
          nameWithoutExtension,
          extension: match[2],
          skinName: parts.slice(0, parts.length - 1).join("."),
          models,
        };
      }
    } else {
      const frameInfo = getFrameInfo(parts[0]);
      if (frameInfo.length) {
        return {
          path,
          basename,
          nameWithoutExtension,
          extension: match[2],
          skinName,
          models: frameInfo,
        };
      } else {
        const models = pathToModelMap.get(parts[0]);
        if (models) {
          return {
            path,
            basename,
            nameWithoutExtension,
            extension: match[2],
            skinName,
            models,
          };
        }
      }
    }
  }
  return null;
}

export type Skin = {
  name: string | null;
  isComplete: null | boolean;
  materials: Map<string, string[]>;
};

export function fileArrayToModels(
  files: Array<{ path: string; name: string | null; imageUrl: string }>
) {
  const foundModels: Map<string, Map<string | null, Skin>> = new Map();
  files.forEach((file) => {
    const fileInfo = pathToModels(file.path, file.name);
    if (fileInfo) {
      fileInfo.models.forEach((model) => {
        const skinsByName: Map<string | null, Skin> =
          foundModels.get(model.modelName) ?? new Map();
        const skinMaterials: Skin = skinsByName.get(fileInfo.skinName) ?? {
          name: fileInfo.skinName,
          isComplete: null,
          materials: new Map(),
        };
        const key = model.material.file ?? model.material.name;
        const materialFrames = skinMaterials.materials.get(key) ?? [];
        materialFrames[model.frameIndex ?? 0] = file.imageUrl;
        skinMaterials.materials.set(key, materialFrames);
        skinsByName.set(fileInfo.skinName, skinMaterials);
        foundModels.set(model.modelName, skinsByName);
      });
    }
  });
  foundModels.forEach((skinsByName, modelName) => {
    const requiredMaterials = materialMap[modelName].filter(
      (material) =>
        material.selectable !== false &&
        material.hidden !== true &&
        material.optional !== true
    );
    skinsByName.forEach((skin) => {
      skin.isComplete = requiredMaterials.every((material) =>
        skin.materials.has(material.file ?? material.name)
      );
    });
  });
  return foundModels;
}

export async function importMultipleFilesToModels(fileList: FileList | File[]) {
  const imageFiles = await readMultipleFiles(fileList);
  return fileArrayToModels(imageFiles);
}

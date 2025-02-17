import JSZip from "jszip";
import getConfig from "next/config";

type MaterialDefinition = {
  name: string;
  file?: string;
  fileSuffix?: string;
  hidden?: boolean;
  selectable?: boolean;
  optional?: boolean;
  frameCount?: number;
};

const { publicRuntimeConfig } = getConfig();
const materialMap: Record<string, MaterialDefinition[]> =
  publicRuntimeConfig.materials;

const ignoreFilePattern = /^(\.|__MACOSX)/;

export function modelToModelType(modelName: string) {
  switch (modelName) {
    case "lmale":
    case "mmale":
    case "hmale":
    case "lfemale":
    case "mfemale":
    case "hfemale":
    case "lbioderm":
    case "mbioderm":
    case "hbioderm":
      return "player";
    case "disc":
    case "chaingun":
    case "grenade_launcher":
    case "sniper":
    case "plasmathrower":
    case "energy":
    case "shocklance":
    case "elf":
    case "missile":
    case "mortar":
    case "repair":
    case "targeting":
      return "weapon";
    case "vehicle_grav_scout":
    case "vehicle_grav_tank":
    case "vehicle_land_mpbbase":
    case "vehicle_air_scout":
    case "vehicle_air_bomber":
    case "vehicle_air_hapc":
      return "vehicle";
    default:
      throw new Error("Unknown model");
  }
}

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
  } else if (file.name.match(/\.zip$/i)) {
    return "zip";
  } else if (file.name.match(/\.vl2$/i)) {
    return "vl2";
  }
}

export async function readImageFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", (event) => {
      if (typeof event.target?.result === "string") {
        resolve(event.target.result);
      } else {
        reject();
      }
    });
    reader.addEventListener("error", (event) => {
      reject();
    });
    reader.readAsDataURL(file);
  });
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
            imageUrl: await readImageFile(file),
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

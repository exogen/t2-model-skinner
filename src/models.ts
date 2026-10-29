import modelConfig from "@config/models.json";
import { modelOptions } from "./modelOptions";

export type ModelType = "player" | "weapon" | "vehicle";

export const modelTypes = Object.fromEntries(
  modelOptions.map(({ type, options }) => [
    type,
    options.map((option) => option.value),
  ]),
) as Record<ModelType, string[]>;

const modelGroups = Object.entries(modelTypes) as [ModelType, string[]][];

export function modelToModelType(model: string): ModelType | undefined {
  return modelGroups.find(([, names]) => names.includes(model))?.[0];
}

export type MaterialDefinition = {
  name: string;
  label?: string;
  file?: string;
  fileSuffix?: string;
  hasDefault?: boolean;
  size?: [number, number];
  hidden?: boolean;
  selectable?: boolean;
  optional?: boolean;
  alphaMode?: "BLEND" | "MASK" | "OPAQUE";
  alphaCutoff?: number;
  baseColorFactor?: [number, number, number, number];
  emissiveFactor?: [number, number, number];
  emissiveTexture?: boolean;
  metallicFactor?: number;
  roughnessFactor?: number;
  frameCount?: number;
  frameTimings?: number[];
  /** The mounted model this material belongs to, not the model itself. */
  mount?: string;
};

export type MountDefinition = { model: string; node: string };

export interface ModelConfig {
  defaultSkins: Record<string, string[]>;
  modelDefaults: Record<string, string>;
  materials: Record<string, Array<MaterialDefinition>>;
  animations: Record<string, string[]>;
  animationLabels: Record<string, string>;
  animationLabelOverrides: Record<string, Record<string, string>>;
  cameraOverrides: Record<
    string,
    { target?: string; fov?: string; orbit?: string }
  >;
  mounts: Record<string, MountDefinition[]>;
  armThreads: Record<string, string>;
  armThreadOverrides: Record<string, Record<string, string>>;
}

const typedModelConfig = modelConfig as unknown as ModelConfig;

export default typedModelConfig;

/** The definitions for the materials of `model`'s own file, or of the model
 * mounted on it, in the order of that file's materials. */
export function partMaterials(model: string, mount?: string) {
  return typedModelConfig.materials[model].filter(
    (material) => material.mount === mount,
  );
}

/** Whether a material has a metallic map, edited on its own canvas. Without
 * one it's fully rough and not metallic. */
export function hasMetallicMap(material: MaterialDefinition) {
  return material.metallicFactor !== 0 || (material.roughnessFactor ?? 1) !== 1;
}

/** The arm animation `model` uses to hold `weapon`, if it's not the
 * default. */
export function armThread(model: string, weapon: string) {
  const thread = typedModelConfig.armThreads[weapon];
  return (
    thread && (typedModelConfig.armThreadOverrides[model]?.[thread] ?? thread)
  );
}

// Prefer an editable canvas for each shared texture, falling back to the first
// material when none is editable. This prevents late loads of fixed duplicates
// from overwriting the preview.
export function isTextureSourceMaterial(
  material: MaterialDefinition,
  model: string,
) {
  const definitions = typedModelConfig.materials[model];
  const sharesTexture = (candidate: MaterialDefinition) =>
    (candidate.file ?? candidate.name) === (material.file ?? material.name);
  const source =
    definitions.find(
      (candidate) =>
        sharesTexture(candidate) &&
        !candidate.hidden &&
        candidate.selectable !== false,
    ) ?? definitions.find(sharesTexture);
  return source?.name === material.name;
}

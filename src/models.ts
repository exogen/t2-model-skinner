import modelConfig from "@config/models.json";

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
};

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
}

const typedModelConfig = modelConfig as unknown as ModelConfig;

export default typedModelConfig;

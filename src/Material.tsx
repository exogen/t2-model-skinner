import { useEffect } from "react";
import type { ModelViewerElement } from "@google/model-viewer";
import useSettings from "./useSettings";
import useSkin from "./useSkin";
import useModelViewer from "./useModelViewer";

// const secondaryMaterialTextures: Record<string, string[]> = {
//   disc: ["textures/discshield2"],
// };

export type ModelMaterial = NonNullable<
  ModelViewerElement["model"]
>["materials"][number];

export type MaterialDefinition = {
  index?: number;
  name: string;
  label?: string;
  file?: string;
  hasDefault?: boolean;
  size?: [number, number];
  hidden?: boolean;
  selectable?: boolean;
  alphaMode?: "BLEND" | "MASK" | "OPAQUE";
  alphaCutoff?: number;
  baseColorFactor?: [number, number, number, number];
  emissiveFactor?: [number, number, number];
  emissiveTexture?: boolean;
  metallicFactor?: number;
  roughnessFactor?: number;
};

function useTexture({
  material,
  materialDef,
  textureType,
  imageUrl,
}: {
  material: ModelMaterial;
  materialDef?: MaterialDefinition;
  textureType: "baseColorTexture" | "metallicRoughnessTexture";
  imageUrl?: string;
}) {
  const { modelViewer } = useModelViewer();
  const { basePath } = useSettings();

  useEffect(() => {
    let stale = false;

    const updateTexture = async () => {
      if (!materialDef || materialDef.hidden) {
        if (textureType === "metallicRoughnessTexture") {
          return;
        } else {
          material.setAlphaMode("BLEND");
          material.pbrMetallicRoughness.setBaseColorFactor([0, 0, 0, 0]);
        }
      } else {
        const {
          alphaMode,
          alphaCutoff,
          baseColorFactor,
          emissiveFactor,
          emissiveTexture = false,
          metallicFactor = 1,
          roughnessFactor = 1,
        } = materialDef;
        let textureUrl = imageUrl ?? `${basePath}/white.png`;
        switch (textureType) {
          case "baseColorTexture":
            if (baseColorFactor) {
              material.pbrMetallicRoughness.setBaseColorFactor(baseColorFactor);
            }
            if (alphaMode) {
              material.setAlphaMode(alphaMode);
            }
            if (alphaCutoff) {
              material.setAlphaCutoff(alphaCutoff);
            }
            if (emissiveFactor) {
              material.setEmissiveFactor(emissiveFactor);
            }
            break;
          case "metallicRoughnessTexture":
            material.pbrMetallicRoughness.setMetallicFactor(metallicFactor);
            material.pbrMetallicRoughness.setRoughnessFactor(roughnessFactor);
            if (metallicFactor === 0 && roughnessFactor === 1) {
              textureUrl = `${basePath}/green.png`;
            }
        }
        const texture = await modelViewer.createTexture(textureUrl);
        if (!stale) {
          material.pbrMetallicRoughness[textureType].setTexture(texture);
          if (textureType === "baseColorTexture" && emissiveTexture) {
            material.emissiveTexture.setTexture(texture);
          }
        }
      }
    };

    updateTexture();

    return () => {
      stale = true;
    };
  }, [basePath, modelViewer, material, materialDef, textureType, imageUrl]);
}

interface MaterialProps {
  material: ModelMaterial;
  materialDef?: MaterialDefinition;
}

export default function Material({ material, materialDef }: MaterialProps) {
  const { getSkinImages } = useSkin();
  const { colorImageUrl, metallicImageUrl } =
    getSkinImages(material.name) ?? {};

  useTexture({
    material,
    materialDef,
    textureType: "baseColorTexture",
    imageUrl: colorImageUrl,
  });
  useTexture({
    material,
    materialDef,
    textureType: "metallicRoughnessTexture",
    imageUrl: metallicImageUrl,
  });

  return null;
}

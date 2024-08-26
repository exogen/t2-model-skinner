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
  frameCount?: number;
  frameTimings?: number[];
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
  imageUrl?: string[];
}) {
  const { modelViewer } = useModelViewer();
  const { basePath } = useSettings();

  useEffect(() => {
    let stale = false;
    let animationFrame: ReturnType<typeof requestAnimationFrame>;

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
          frameCount = 1,
          frameTimings,
        } = materialDef;
        let textureUrls =
          imageUrl ?? new Array(frameCount).fill(`${basePath}/white.png`);
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
              textureUrls = new Array(frameCount).fill(`${basePath}/green.png`);
            }
        }
        const textures = await Promise.all(
          textureUrls.map((textureUrl) => modelViewer.createTexture(textureUrl))
        );
        if (!stale) {
          let frameIndex = 0;
          let frameProgress = 0;
          const frame: FrameRequestCallback = (timestamp) => {
            const frameTiming = frameTimings?.[frameIndex] ?? 1;
            const texture = textures[frameIndex];
            material.pbrMetallicRoughness[textureType].setTexture(texture);
            if (textureType === "baseColorTexture" && emissiveTexture) {
              material.emissiveTexture.setTexture(texture);
            }
            frameProgress += 1;
            if (frameCount > 1) {
              if (frameProgress >= frameTiming) {
                frameIndex = (frameIndex + 1) % frameCount;
                frameProgress = 0;
              }
              animationFrame = requestAnimationFrame(frame);
            }
          };
          animationFrame = requestAnimationFrame(frame);
        }
      }
    };

    updateTexture();

    return () => {
      stale = true;
      cancelAnimationFrame(animationFrame);
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
    getSkinImages(materialDef?.file ?? material.name) ?? {};

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

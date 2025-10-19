import { useEffect, useRef, RefObject } from "react";
import type { ModelViewerElement } from "@google/model-viewer";
import useSettings from "./useSettings";
import useSkin from "./useSkin";
import useModelViewer from "./useModelViewer";
import useWarrior from "./useWarrior";
import type { MaterialDefinition } from "./models";

// const secondaryMaterialTextures: Record<string, string[]> = {
//   disc: ["textures/discshield2"],
// };

export type ModelMaterial = NonNullable<
  ModelViewerElement["model"]
>["materials"][number];

type FrameInfo = {
  frameIndex: number;
  frameProgress: number;
};

function useTexture({
  material,
  materialDef,
  textureType,
  imageUrl,
  frameRef,
  onReady,
}: {
  material: ModelMaterial;
  materialDef?: MaterialDefinition;
  textureType: "baseColorTexture" | "metallicRoughnessTexture";
  imageUrl?: string[];
  frameRef: RefObject<FrameInfo>;
  onReady?: () => void;
}) {
  const { modelViewer } = useModelViewer();
  const { basePath } = useSettings();
  const { slowModeEnabled } = useWarrior();

  useEffect(() => {
    let stale = false;
    let animationFrame: ReturnType<typeof requestAnimationFrame>;

    const updateTexture = async () => {
      if (!materialDef || materialDef.hidden) {
        if (textureType === "metallicRoughnessTexture") {
          if (onReady) {
            onReady();
          }
          return;
        } else {
          material.setAlphaMode("BLEND");
          material.pbrMetallicRoughness.setBaseColorFactor([0, 0, 0, 0]);
          if (onReady) {
            onReady();
          }
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

        if (textureUrls.some((url) => !url)) {
          return;
        }

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
          const isMasterTexture = textureType === "baseColorTexture";
          const frameInfo = frameRef.current;

          const frame: FrameRequestCallback = () => {
            const texture = textures[frameInfo.frameIndex];
            material.pbrMetallicRoughness[textureType].setTexture(texture);
            if (isMasterTexture && emissiveTexture) {
              material.emissiveTexture.setTexture(texture);
            }
            if (isMasterTexture) {
              frameInfo.frameProgress += slowModeEnabled ? 0.05 : 1;
            }
            if (frameCount > 1) {
              const frameTiming = frameTimings?.[frameInfo.frameIndex] ?? 1;
              if (isMasterTexture && frameInfo.frameProgress >= frameTiming) {
                frameInfo.frameIndex = (frameInfo.frameIndex + 1) % frameCount;
                frameInfo.frameProgress = 0;
              }
              animationFrame = requestAnimationFrame(frame);
            }
          };

          frame(0);
          if (onReady) {
            onReady();
          }
        }
      }
    };

    updateTexture();

    return () => {
      stale = true;
      if (animationFrame != null) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [
    basePath,
    modelViewer,
    material,
    materialDef,
    textureType,
    imageUrl,
    frameRef,
    slowModeEnabled,
    onReady,
  ]);
}

interface MaterialProps {
  material: ModelMaterial;
  materialDef?: MaterialDefinition;
  onReady?: (imageUrls: Array<string[] | undefined>) => void;
}

export default function Material({
  material,
  materialDef,
  onReady,
}: MaterialProps) {
  const { getSkinImages } = useSkin();
  const { colorImageUrl, metallicImageUrl } =
    getSkinImages(materialDef?.file ?? material.name) ?? {};
  const frameRef = useRef<FrameInfo>({ frameIndex: 0, frameProgress: 0 });

  useTexture({
    material,
    materialDef,
    textureType: "baseColorTexture",
    imageUrl: colorImageUrl,
    frameRef,
  });
  useTexture({
    material,
    materialDef,
    textureType: "metallicRoughnessTexture",
    imageUrl: metallicImageUrl,
    frameRef,
  });

  return null;
}

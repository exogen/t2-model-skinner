import { ReactNode, useEffect, useMemo, useState } from "react";
import getConfig from "next/config";
import useSettings from "./useSettings";
import { WarriorContext } from "./useWarrior";
import type { MaterialDefinition } from "./Material";

const { publicRuntimeConfig } = getConfig();
const { materials, modelDefaults } = publicRuntimeConfig;
const baseSkinPath = `https://exogen.github.io/t2-skins/skins`;

function getFrameNames(frameZeroFile: string, frameCount: number) {
  if (frameCount < 2) {
    return [frameZeroFile];
  }
  const match = frameZeroFile.match(/^(.+)(\d\d)$/);
  if (match) {
    const baseName = match[1];
    const frames = new Array(frameCount).fill(null);
    return frames.map((_, i) => `${baseName}${i.toString().padStart(2, "0")}`);
  } else {
    throw new Error("Did not match expected frame format");
  }
}

export function getSkinImageUrls({
  basePath,
  actualModel,
  selectedModelType,
  selectedSkin,
  selectedSkinType,
}: {
  basePath: string;
  actualModel: string;
  selectedModelType: string;
  selectedSkin: string | null;
  selectedSkinType: string | null;
}): Record<string, string[]> {
  const materialDefs = materials[actualModel];
  switch (selectedModelType) {
    case "player":
      switch (selectedSkinType) {
        case "default":
          return {
            base: [`${basePath}/textures/${selectedSkin}.${actualModel}.png`],
          };
        case "custom":
          return {
            base: [`${baseSkinPath}/${selectedSkin}.${actualModel}.png`],
          };
      }
      break;
    case "weapon":
    case "vehicle":
      return materialDefs.reduce(
        (
          skinImageUrls: Record<string, string[]>,
          materialDef: MaterialDefinition
        ) => {
          if (materialDef) {
            const frameCount = materialDef.frameCount ?? 1;
            switch (selectedSkinType) {
              case "default":
                if (materialDef.hasDefault !== false) {
                  skinImageUrls[materialDef.file ?? materialDef.name] =
                    getFrameNames(
                      materialDef.file ?? materialDef.name,
                      frameCount
                    ).map((name) => `${basePath}/textures/${name}.png`);
                }
                break;
              case "custom":
                skinImageUrls[materialDef.file ?? materialDef.name] =
                  getFrameNames(
                    materialDef.file ?? materialDef.name,
                    frameCount
                  ).map(
                    (name) => `${baseSkinPath}/${selectedSkin}/${name}.png`
                  );
                break;
            }
          }
          return skinImageUrls;
        },
        {}
      );
  }
  return {};
}

function getModelUrl(
  basePath: string,
  actualModel: string,
  selectedAnimation: string | null
) {
  switch (actualModel) {
    default:
      return `${basePath}/${actualModel}${
        selectedAnimation ? ".anim" : ""
      }.glb`;
  }
}

// const queryParamSeparator = ".";

// function parseQuerySelection(searchParams: URLSearchParams) {
//   const modelWithTypeFromUrl = searchParams.get("m");
//   const skinWithTypeFromUrl = searchParams.get("s");
//   let selectedModel;
//   let selectedModelType;
//   if (typeof modelWithTypeFromUrl === "string") {
//     [selectedModelType, selectedModel] =
//       modelWithTypeFromUrl.split(queryParamSeparator);
//   }
//   let selectedSkin;
//   let selectedSkinType;
//   if (typeof skinWithTypeFromUrl === "string") {
//     [selectedSkinType, selectedSkin] =
//       skinWithTypeFromUrl.split(queryParamSeparator);
//   }
//   return {
//     selectedModel: selectedModel || null,
//     selectedModelType: selectedModelType || null,
//     selectedSkin: selectedSkin || null,
//     selectedSkinType: selectedSkinType || null,
//   };
// }

export default function WarriorProvider({ children }: { children: ReactNode }) {
  const [selectedModel, setSelectedModel] = useState<string>("lmale");
  const [selectedModelType, setSelectedModelType] = useState("player");
  const [selectedSkin, setSelectedSkin] = useState<string | null>(
    "Blood Eagle"
  );
  const [selectedSkinType, setSelectedSkinType] = useState<string | null>(
    "default"
  );
  const [selectedAnimation, setSelectedAnimation] = useState<string | null>(
    null
  );
  const [animationPaused, setAnimationPaused] = useState(false);
  const [slowModeEnabled, setSlowModeEnabled] = useState(false);
  const { basePath } = useSettings();
  const actualModel = selectedModel === "hfemale" ? "hmale" : selectedModel;
  const selectedModelUrl = getModelUrl(
    basePath,
    actualModel,
    selectedAnimation
  );

  const [skinImageUrls, setSkinImageUrls] = useState<Record<string, string[]>>(
    () =>
      getSkinImageUrls({
        basePath,
        actualModel,
        selectedModelType,
        selectedSkin,
        selectedSkinType,
      })
  );

  const defaultSkinImageUrls = useMemo(
    () =>
      getSkinImageUrls({
        basePath,
        actualModel,
        selectedModelType,
        selectedSkin: modelDefaults[actualModel],
        selectedSkinType: "default",
      }),
    [actualModel, basePath, selectedModelType]
  );

  const context = useMemo(() => {
    return {
      selectedModel,
      setSelectedModel,
      selectedModelType,
      setSelectedModelType,
      actualModel,
      selectedModelUrl,
      animationPaused,
      setAnimationPaused,
      selectedSkin,
      setSelectedSkin,
      selectedSkinType,
      setSelectedSkinType,
      selectedAnimation,
      setSelectedAnimation,
      skinImageUrls,
      setSkinImageUrls,
      defaultSkinImageUrls,
      slowModeEnabled,
      setSlowModeEnabled,
    };
  }, [
    selectedModel,
    setSelectedModel,
    selectedModelType,
    setSelectedModelType,
    actualModel,
    selectedModelUrl,
    animationPaused,
    setAnimationPaused,
    selectedSkin,
    setSelectedSkin,
    selectedSkinType,
    setSelectedSkinType,
    selectedAnimation,
    setSelectedAnimation,
    skinImageUrls,
    setSkinImageUrls,
    defaultSkinImageUrls,
    slowModeEnabled,
  ]);

  useEffect(() => {
    if (selectedSkin) {
      setSkinImageUrls(
        getSkinImageUrls({
          basePath,
          actualModel,
          selectedModelType,
          selectedSkin,
          selectedSkinType,
        })
      );
    }
  }, [
    basePath,
    actualModel,
    selectedModelType,
    selectedSkin,
    selectedSkinType,
  ]);

  return (
    <WarriorContext.Provider value={context}>
      {children}
    </WarriorContext.Provider>
  );
}

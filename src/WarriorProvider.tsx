import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import getConfig from "next/config";
import useSettings from "./useSettings";
import { WarriorContext } from "./useWarrior";
import type { MaterialDefinition } from "./Material";
import type { Skin } from "./importUtils";

const { publicRuntimeConfig } = getConfig();
const { materials, modelDefaults } = publicRuntimeConfig;
const baseSkinPath = `https://exogen.github.io/t2-skins/skins`;

let IMPORTED_SKINS: Map<string, Map<string | null, Skin>> = new Map();

function mergeNewImportedSkins(newSkins: typeof IMPORTED_SKINS) {
  const newImportedSkins = new Map(IMPORTED_SKINS.entries());
  newSkins.forEach((newSkinsByName, modelName) => {
    const skinsByName =
      newImportedSkins.get(modelName) ?? new Map<string | null, Skin>();
    newSkinsByName.forEach((skin, skinName) => {
      skinsByName.set(skinName, skin);
    });
    newImportedSkins.set(modelName, skinsByName);
  });
  IMPORTED_SKINS = newImportedSkins;
}

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
  if (selectedSkin && selectedSkinType === "import") {
    const skinsByName = IMPORTED_SKINS.get(actualModel);
    if (skinsByName) {
      const key = selectedSkin === "__untitled__" ? null : selectedSkin;
      const skin = skinsByName.get(key);
      if (skin && skin.isComplete) {
        return Object.fromEntries(skin.materials);
      }
    }
    throw new Error("No skin found");
  }
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
  const [importedSkins, setImportedSkins] = useState(IMPORTED_SKINS);

  const addImportedSkins = useCallback((newSkins: typeof IMPORTED_SKINS) => {
    mergeNewImportedSkins(newSkins);
    setImportedSkins(IMPORTED_SKINS);
  }, []);

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
      importedSkins,
      addImportedSkins,
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
    importedSkins,
    addImportedSkins,
  ]);

  useEffect(() => {
    if (selectedSkin) {
      try {
        const skinImageUrls = getSkinImageUrls({
          basePath,
          actualModel,
          selectedModelType,
          selectedSkin,
          selectedSkinType,
        });
        setSkinImageUrls(skinImageUrls);
      } catch (err) {
        setSelectedSkinType("default");
        setSelectedSkin(modelDefaults[actualModel]);
      }
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

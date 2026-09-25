import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSettings from "./useSettings";
import { WarriorContext } from "./useWarrior";
import type { MaterialDefinition } from "./models";
import type { Skin } from "./importUtils";
import modelConfig, { modelToModelType } from "./models";
import { getLocalAssetUrl, getSkinAssetUrl } from "./deployPaths";

const { materials, modelDefaults, defaultSkins } = modelConfig;

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

function skinToType(actualModel: string, skinName: string) {
  const defaultSkin = modelDefaults[actualModel];
  if (skinName === defaultSkin) {
    return "default";
  } else if (defaultSkins[actualModel]?.includes(skinName)) {
    return "default";
  } else {
    return "custom";
  }
}

export function getSkinImageUrls({
  basePath,
  actualModel,
  selectedSkin,
  selectedSkinType,
  importedSkins = IMPORTED_SKINS,
}: {
  basePath: string;
  actualModel: string;
  selectedSkin: string | null;
  selectedSkinType: string | null;
  importedSkins?: typeof IMPORTED_SKINS;
}): Record<string, string[]> {
  // Materials omitted from a legacy project use the model's default textures.
  if (selectedSkinType === "project") {
    selectedSkinType = "default";
    selectedSkin = modelDefaults[actualModel] ?? null;
  }
  const materialDefs = materials[actualModel];
  if (selectedSkin && selectedSkinType === "import") {
    const skinsByName = importedSkins.get(actualModel);
    if (skinsByName) {
      const key = selectedSkin === "__untitled__" ? null : selectedSkin;
      const skin = skinsByName.get(key);
      if (skin && skin.isComplete) {
        return Object.fromEntries(skin.materials);
      }
    }
    throw new Error("No skin found");
  }
  switch (modelToModelType(actualModel)) {
    case "player":
      switch (selectedSkinType) {
        case "default":
          return {
            base: [getLocalAssetUrl(basePath, `textures/${selectedSkin}.${actualModel}.png`)],
          };
        case "custom":
          return {
            base: [getSkinAssetUrl(`${selectedSkin}.${actualModel}.png`)],
          };
      }
      break;
    case "weapon":
    case "vehicle":
      return materialDefs.reduce(
        (
          skinImageUrls: Record<string, string[]>,
          materialDef: MaterialDefinition,
        ) => {
          if (materialDef) {
            const frameCount = materialDef.frameCount ?? 1;
            switch (selectedSkinType) {
              case "default":
                if (materialDef.hasDefault !== false) {
                  skinImageUrls[materialDef.file ?? materialDef.name] =
                    getFrameNames(
                      materialDef.file ?? materialDef.name,
                      frameCount,
                    ).map((name) => getLocalAssetUrl(basePath, `textures/${name}.png`));
                }
                break;
              case "custom":
                skinImageUrls[materialDef.file ?? materialDef.name] =
                  getFrameNames(
                    materialDef.file ?? materialDef.name,
                    frameCount,
                  ).map(
                    (name) =>
                      getSkinAssetUrl(`${selectedSkin}/${name}.png`),
                  );
                break;
            }
          }
          return skinImageUrls;
        },
        {},
      );
  }
  return {};
}

function getModelUrl(
  basePath: string,
  actualModel: string,
  selectedAnimation: string | null,
) {
  return getLocalAssetUrl(
    basePath,
    `${actualModel}${selectedAnimation ? ".anim" : ""}.glb`,
  );
}

export default function WarriorProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchParamsInitialized, setSearchParamsInitialized] = useState(false);

  const [selectedModel, setSelectedModel] = useState<string>("lmale");
  const selectedModelType = modelToModelType(selectedModel);
  const [selectedSkin, setSelectedSkin] = useState<string | null>(
    "Blood Eagle",
  );
  const [selectedSkinType, setSelectedSkinType] = useState<string | null>(
    "default",
  );
  const [selectedAnimation, setSelectedAnimation] = useState<string | null>(
    null,
  );
  const [animationPaused, setAnimationPaused] = useState(false);
  const [slowModeEnabled, setSlowModeEnabled] = useState(false);
  const { basePath } = useSettings();
  const actualModel = selectedModel === "hfemale" ? "hmale" : selectedModel;
  const selectedModelUrl = getModelUrl(
    basePath,
    actualModel,
    selectedAnimation,
  );
  const [importedSkins, setImportedSkins] = useState(IMPORTED_SKINS);

  const addImportedSkins = useCallback((newSkins: typeof IMPORTED_SKINS) => {
    mergeNewImportedSkins(newSkins);
    setImportedSkins(IMPORTED_SKINS);
  }, []);

  const defaultSkinImageUrls = useMemo(
    () =>
      getSkinImageUrls({
        basePath,
        actualModel,
        selectedSkin: modelDefaults[actualModel],
        selectedSkinType: "default",
      }),
    [actualModel, basePath],
  );

  const skinImageUrls = useMemo(() => {
    if (!selectedSkin) return {};
    try {
      return getSkinImageUrls({
        basePath,
        actualModel,
        selectedSkin,
        selectedSkinType,
        importedSkins,
      });
    } catch {
      return defaultSkinImageUrls;
    }
  }, [
    basePath,
    actualModel,
    selectedSkin,
    selectedSkinType,
    defaultSkinImageUrls,
    importedSkins,
  ]);

  const context = useMemo(() => {
    return {
      selectedModel,
      setSelectedModel,
      selectedModelType,
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
    defaultSkinImageUrls,
    slowModeEnabled,
    importedSkins,
    addImportedSkins,
  ]);

  if (!searchParamsInitialized) {
    const modelName = searchParams.get("m");
    const skinPath = searchParams.get("s");
    if (typeof modelName === "string") {
      const modelType = modelToModelType(modelName);
      const actualModel = modelName === "hfemale" ? "hmale" : modelName;
      if (modelType) {
        setSelectedModel(modelName);
        if (typeof skinPath === "string") {
          const skinType = skinToType(actualModel, skinPath);
          setSelectedSkin(skinPath);
          setSelectedSkinType(skinType);
        }
      }
    }
    setSearchParamsInitialized(true);
  }

  useEffect(() => {
    if (!selectedSkin) {
      return;
    }
    const modelName = searchParams.get("m");
    const skinPath = searchParams.get("s");
    if (modelName !== selectedModel || skinPath !== selectedSkin) {
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.set("m", selectedModel);
      newSearchParams.set("s", selectedSkin);
      const url = `${pathname}?${newSearchParams}`;
      router.replace(url, { scroll: false });
    }
  }, [pathname, router, searchParams, selectedModel, selectedSkin]);


  return (
    <WarriorContext.Provider value={context}>
      {children}
    </WarriorContext.Provider>
  );
}

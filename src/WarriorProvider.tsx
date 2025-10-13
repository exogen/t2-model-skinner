import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import getConfig from "next/config";
import useSettings from "./useSettings";
import { WarriorContext } from "./useWarrior";
import type { MaterialDefinition } from "./Material";
import type { Skin } from "./importUtils";
import { useRouter } from "next/router";

const { publicRuntimeConfig } = getConfig();
const { materials, modelDefaults, defaultSkins } = publicRuntimeConfig;
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

function modelToType(model: string) {
  switch (model) {
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
    case "mine":
      return "weapon";
    case "vehicle_grav_scout":
    case "vehicle_grav_tank":
    case "vehicle_land_mpbbase":
    case "vehicle_air_scout":
    case "vehicle_air_bomber":
    case "vehicle_air_hapc":
      return "vehicle";
    default:
      return null;
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

export default function WarriorProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
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
    if (router.isReady) {
      const modelName = router.query.m;
      if (typeof modelName === "string") {
        const modelType = modelToType(modelName);
        const actualModel = modelName === "hfemale" ? "hmale" : modelName;
        if (modelType) {
          setSelectedModel(modelName);
          setSelectedModelType(modelType);
          const skinPath = router.query.s;
          if (typeof skinPath === "string") {
            const skinType = skinToType(actualModel, skinPath);
            setSelectedSkin(skinPath);
            setSelectedSkinType(skinType);
            console.log("set model and skin from route:", modelName, skinPath);
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  const { replace: replaceRoute } = router;

  useEffect(() => {
    if (router.isReady) {
      if (router.query.m !== selectedModel || router.query.s !== selectedSkin) {
        console.log(
          "router is ready. query params do not match, replacing:",
          selectedModel,
          selectedSkin
        );
        replaceRoute(
          {
            pathname: router.pathname,
            query: { ...router.query, m: selectedModel, s: selectedSkin },
          },
          undefined,
          { shallow: true }
        );
      }
    }
  }, [
    replaceRoute,
    router.isReady,
    router.pathname,
    router.query,
    selectedSkin,
    selectedModel,
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

import { ReactNode, useEffect, useMemo, useState } from "react";
import getConfig from "next/config";
import useSettings from "./useSettings";
import { WarriorContext } from "./useWarrior";
import type { MaterialDefinition } from "./Material";
import Router, { useRouter } from "next/router";

const { publicRuntimeConfig } = getConfig();
const { materials, modelDefaults } = publicRuntimeConfig;
const baseSkinPath = `https://exogen.github.io/t2-skins/skins`;

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
}): Record<string, string> {
  const materialDefs = materials[actualModel];
  switch (selectedModelType) {
    case "player":
      switch (selectedSkinType) {
        case "default":
          return {
            base: `${basePath}/textures/${selectedSkin}.${actualModel}.png`,
          };
        case "custom":
          return { base: `${baseSkinPath}/${selectedSkin}.${actualModel}.png` };
      }
      break;
    case "weapon":
    case "vehicle":
      return materialDefs.reduce(
        (
          skinImageUrls: Record<string, string>,
          materialDef: MaterialDefinition
        ) => {
          if (materialDef) {
            switch (selectedSkinType) {
              case "default":
                if (materialDef.hasDefault !== false) {
                  skinImageUrls[
                    materialDef.file ?? materialDef.name
                  ] = `${basePath}/textures/${
                    materialDef.file ?? materialDef.name
                  }.png`;
                }
                break;
              case "custom":
                skinImageUrls[
                  materialDef.file ?? materialDef.name
                ] = `${baseSkinPath}/${selectedSkin}/${
                  materialDef.file ?? materialDef.name
                }.png`;
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

function parseQuerySelection(query: {
  model?: string | string[];
  skin?: string | string[];
}) {
  const { model: modelWithTypeFromUrl, skin: skinWithTypeFromUrl } = query;
  let selectedModel;
  let selectedModelType;
  if (typeof modelWithTypeFromUrl === "string") {
    [selectedModelType, selectedModel] = modelWithTypeFromUrl.split("|");
  }
  let selectedSkin;
  let selectedSkinType;
  if (typeof skinWithTypeFromUrl === "string") {
    [selectedSkinType, selectedSkin] = skinWithTypeFromUrl.split("|");
  }
  return {
    selectedModel: selectedModel || null,
    selectedModelType: selectedModelType || null,
    selectedSkin: selectedSkin || null,
    selectedSkinType: selectedSkinType || null,
  };
}

export default function WarriorProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const defaultsFromUrl = parseQuerySelection(router.query);
  const [selectedModel, setSelectedModel] = useState<string>(
    defaultsFromUrl.selectedModel || "lmale"
  );
  const [selectedModelType, setSelectedModelType] = useState(
    defaultsFromUrl.selectedModelType || "player"
  );
  const [selectedSkin, setSelectedSkin] = useState<string | null>(
    defaultsFromUrl.selectedSkin || "Blood Eagle"
  );
  const [selectedSkinType, setSelectedSkinType] = useState<string | null>(
    defaultsFromUrl.selectedSkinType || "default"
  );
  const [selectedAnimation, setSelectedAnimation] = useState<string | null>(
    null
  );
  const [animationPaused, setAnimationPaused] = useState(false);
  const { basePath } = useSettings();
  const actualModel = selectedModel === "hfemale" ? "hmale" : selectedModel;
  const selectedModelUrl = getModelUrl(
    basePath,
    actualModel,
    selectedAnimation
  );

  const [skinImageUrls, setSkinImageUrls] = useState<Record<string, string>>(
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

  useEffect(() => {
    Router.replace({
      query: {
        model: `${selectedModelType ?? ""}|${selectedModel ?? ""}`,
        skin: `${selectedSkinType ?? ""}|${selectedSkin ?? ""}`,
      },
    });
  }, [selectedModel, selectedModelType, selectedSkin, selectedSkinType]);

  return (
    <WarriorContext.Provider value={context}>
      {children}
    </WarriorContext.Provider>
  );
}

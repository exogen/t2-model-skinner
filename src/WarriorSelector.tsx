import getConfig from "next/config";
import useWarrior from "./useWarrior";
import { FaFolderOpen } from "react-icons/fa";
import { BsFillGrid3X3GapFill } from "react-icons/bs";
import { useEffect, useRef, useState } from "react";
import useTools from "./useTools";
import { importMultipleFilesToModels, modelToModelType } from "./importUtils";

const { publicRuntimeConfig } = getConfig();
const { defaultSkins, modelDefaults /*materials*/ } = publicRuntimeConfig;

const baseManifestPath = `https://exogen.github.io/t2-skins`;
const defaultCustomSkins = {};

const emptyMap = new Map();

export default function WarriorSelector() {
  const {
    selectedModel,
    setSelectedModel,
    selectedModelType,
    setSelectedModelType,
    selectedSkin,
    setSelectedSkin,
    setSelectedSkinType,
    actualModel,
    setSelectedAnimation,
    setAnimationPaused,
    importedSkins,
    addImportedSkins,
  } = useWarrior();
  const { /*selectedMaterialIndex,*/ setSelectedMaterialIndex } = useTools();
  // const materialDefs = materials[actualModel];
  // const materialDef = materialDefs[selectedMaterialIndex];
  const [customSkins, setCustomSkins] =
    useState<Record<string, string[]>>(defaultCustomSkins);
  const [newSkins, setNewSkins] =
    useState<Record<string, string[]>>(defaultCustomSkins);
  const [selectedSkinSection, setSelectedSkinSection] = useState<string | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const importedSkinsForModel = importedSkins.get(actualModel) ?? emptyMap;

  const selectableImportedSkins = Array.from(
    importedSkinsForModel.values()
  ).filter((skin) => skin.isComplete);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    let ignore = false;

    const loadCustomSkins = async () => {
      let res;
      try {
        res = await fetch(`${baseManifestPath}/skins.json`, { signal });
      } catch (err) {
        return;
      }
      if (!ignore) {
        const json = await res.json();
        if (!ignore) {
          setCustomSkins(json.customSkins ?? {});
          setNewSkins(json.newSkins ?? {});
        }
      }
    };

    loadCustomSkins();

    return () => {
      ignore = true;
      controller.abort();
    };
  }, []);

  let skinSelectValue = selectedSkin ?? "";
  if (selectedSkin && selectedSkinSection) {
    skinSelectValue = `${selectedSkinSection}/${selectedSkin}`;
  }

  return (
    <div className="Toolbar">
      <div className="Field">
        <label htmlFor="ModelSelect">Model</label>
        <select
          id="ModelSelect"
          value={selectedModel}
          onChange={(event) => {
            const parentNode = event.target.selectedOptions[0]
              .parentNode as HTMLElement;
            const newSelectedModel = event.target.value;
            const newActualModel =
              newSelectedModel === "hfemale" ? "hmale" : newSelectedModel;
            const { modelType } = parentNode.dataset;
            if (!modelType) {
              throw new Error("No data-model-type found");
            }
            const newModelHasSkin =
              (selectedSkin &&
                (defaultSkins[newActualModel]?.includes(selectedSkin) ||
                  customSkins[newActualModel]?.includes(selectedSkin))) ||
              false;

            let newModelHasSection = false;
            if (
              selectedSkin &&
              selectedSkinSection === "new" &&
              newModelHasSkin
            ) {
              newModelHasSection =
                newSkins[newActualModel]?.includes(selectedSkin);
            }

            setSelectedAnimation(null);
            setAnimationPaused(false);
            setSelectedModelType(modelType);
            setSelectedModel(newSelectedModel);
            setSelectedMaterialIndex(0);
            if (!newModelHasSkin) {
              setSelectedSkin(modelDefaults[newActualModel] ?? null);
              setSelectedSkinType("default");
            }
            if (!newModelHasSection) {
              setSelectedSkinSection(null);
            }
          }}
        >
          <optgroup label="Players" data-model-type="player">
            <option value="lmale">Human Male &bull; Light</option>
            <option value="mmale">Human Male &bull; Medium</option>
            <option value="hmale">Human Male &bull; Heavy</option>
            <option value="lfemale">Human Female &bull; Light</option>
            <option value="mfemale">Human Female &bull; Medium</option>
            <option value="hfemale">Human Female &bull; Heavy</option>
            <option value="lbioderm">Bioderm &bull; Light</option>
            <option value="mbioderm">Bioderm &bull; Medium</option>
            <option value="hbioderm">Bioderm &bull; Heavy</option>
          </optgroup>
          <optgroup label="Weapons" data-model-type="weapon">
            <option value="disc">Disc Launcher</option>
            <option value="chaingun">Chaingun</option>
            <option value="grenade_launcher">Grenade Launcher</option>
            <option value="sniper">Laser Rifle</option>
            <option value="plasmathrower">Plasma Cannon</option>
            <option value="energy">Blaster</option>
            <option value="shocklance">Shocklance</option>
            <option value="elf">ELF Projector</option>
            <option value="missile">Missile Launcher</option>
            <option value="mortar">Mortar</option>
            <option value="repair">Repair Pack</option>
            <option value="targeting">Targeting Laser</option>
          </optgroup>
          <optgroup label="Vehicles" data-model-type="vehicle">
            <option value="vehicle_grav_scout">Wildcat Grav Cycle</option>
            <option value="vehicle_grav_tank">Beowulf Assault Tank</option>
            <option value="vehicle_land_mpbbase">
              Jericho Mobile Point Base
            </option>
            <option value="vehicle_air_scout">Shrike Scout Fighter</option>
            <option value="vehicle_air_bomber">Thundersword Bomber</option>
            <option value="vehicle_air_hapc">HAVOC Gunship Transport</option>
          </optgroup>
        </select>
      </div>
      <div className="Field">
        <label htmlFor="SkinSelect">Skin</label>
        <div className="Buttons">
          <select
            id="SkinSelect"
            value={skinSelectValue}
            onChange={(event) => {
              const parentNode = event.target.selectedOptions[0]
                .parentNode as HTMLElement;
              const skinType = event.target.value
                ? parentNode.dataset.skinType ?? null
                : null;
              const skinParts = event.target.value.split("/");
              const selectedSkin = skinParts.slice(-1)[0] ?? null;
              setSelectedSkin(selectedSkin);
              setSelectedSkinType(skinType);
              if (skinParts.length > 1) {
                setSelectedSkinSection(skinParts[0]);
              } else {
                setSelectedSkinSection(null);
              }
            }}
          >
            <option value="">Select a skin…</option>
            {selectedModelType === "player" ? (
              <>
                <optgroup label="Default Skins" data-skin-type="default">
                  {defaultSkins[actualModel]?.map((name: string) => {
                    return (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    );
                  })}
                </optgroup>
                {selectableImportedSkins.length ? (
                  <optgroup label="Imported Skins" data-skin-type="import">
                    {selectableImportedSkins.map((skin) => {
                      return (
                        <option
                          key={`import/${skin.name ?? "__untitled__"}`}
                          value={`import/${skin.name ?? "__untitled__"}`}
                        >
                          {skin.name || "Untitled Imported Skin"}
                        </option>
                      );
                    })}
                  </optgroup>
                ) : null}
                {newSkins[actualModel]?.length ? (
                  <optgroup label="New Skins ✨" data-skin-type="custom">
                    {newSkins[actualModel]?.map((name: string) => {
                      return (
                        <option key={`new/${name}`} value={`new/${name}`}>
                          {name} ✨
                        </option>
                      );
                    })}
                  </optgroup>
                ) : null}
                <optgroup label="Custom Skins" data-skin-type="custom">
                  {customSkins === defaultCustomSkins ? (
                    <option key="loading" value="">
                      Loading…
                    </option>
                  ) : (
                    customSkins[actualModel]?.map((name: string) => {
                      return (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      );
                    })
                  )}
                </optgroup>
              </>
            ) : null}
            {selectedModelType === "weapon" ||
            selectedModelType === "vehicle" ? (
              <>
                {modelDefaults[actualModel] ? (
                  <optgroup label="Default Skins" data-skin-type="default">
                    <option value={modelDefaults[actualModel]}>Default</option>
                  </optgroup>
                ) : null}
                {selectableImportedSkins.length ? (
                  <optgroup label="Imported Skins" data-skin-type="import">
                    {selectableImportedSkins.map((skin) => {
                      return (
                        <option
                          key={`import/${skin.name ?? "__untitled__"}`}
                          value={`import/${skin.name ?? "__untitled__"}`}
                        >
                          {skin.name || "Untitled Imported Skin"}
                        </option>
                      );
                    })}
                  </optgroup>
                ) : null}
                {customSkins[actualModel]?.length ? (
                  <optgroup label="Custom Skins" data-skin-type="custom">
                    {customSkins[actualModel].map((name: string) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </>
            ) : null}
          </select>
          <button
            type="button"
            aria-label="Load Skin"
            title="Load a Skin"
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.click();
              }
            }}
          >
            <FaFolderOpen style={{ fontSize: 18 }} />
          </button>
          <input
            ref={fileInputRef}
            onChange={async (event) => {
              const foundModels = await importMultipleFilesToModels(
                event.target.files ?? []
              );
              addImportedSkins(foundModels);
              const currentModelSkins = foundModels.get(actualModel);
              if (currentModelSkins) {
                const completeSkins = Array.from(
                  currentModelSkins.values()
                ).filter((skin) => skin.isComplete);
                if (completeSkins.length) {
                  const skin = completeSkins[0];
                  setSelectedSkinType("import");
                  setSelectedSkinSection("import");
                  setSelectedSkin(skin.name ?? "__untitled__");
                  setSelectedMaterialIndex(0);
                  setSelectedAnimation(null);
                  return;
                }
              }
              for (const [modelName, skinsByName] of Array.from(
                foundModels.entries()
              )) {
                for (const skin of Array.from(skinsByName.values())) {
                  if (skin.isComplete) {
                    setSelectedModel(modelName);
                    setSelectedModelType(modelToModelType(modelName));
                    setSelectedSkinType("import");
                    setSelectedSkinSection("import");
                    setSelectedSkin(skin.name ?? "__untitled__");
                    setSelectedMaterialIndex(0);
                    setSelectedAnimation(null);
                    break;
                  }
                }
              }
            }}
            type="file"
            accept=".png, image/png, .vl2, .zip, application/zip, application/zip-compressed"
            multiple
            hidden
          />
        </div>
      </div>
      <div className="Field GalleryField">
        <a
          href="gallery/"
          target="_blank"
          className="GalleryLink"
          title="Open skin gallery"
        >
          <span className="FieldLabel">Gallery</span>
          <BsFillGrid3X3GapFill />
        </a>
      </div>
    </div>
  );
}

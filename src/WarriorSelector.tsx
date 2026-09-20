import useWarrior from "./useWarrior";
import { FaFolderOpen } from "react-icons/fa";
import { BsFillGrid3X3GapFill } from "react-icons/bs";
import { useRef, useState } from "react";
import useTools from "./useTools";
import useManifest from "./useManifest";
import modelConfig from "./models";

const { defaultSkins, modelDefaults } = modelConfig;

const emptyMap = new Map();

export default function WarriorSelector() {
  const {
    selectedModel,
    setSelectedModel,
    selectedModelType,
    selectedSkin,
    selectedSkinType,
    setSelectedSkin,
    setSelectedSkinType,
    actualModel,
    setSelectedAnimation,
    setAnimationPaused,
    importedSkins,
  } = useWarrior();
  const { setSelectedMaterialIndex, loadSkinFiles } = useTools();
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [manifest, isManifestLoaded] = useManifest();

  const importedSkinsForModel = importedSkins.get(actualModel) ?? emptyMap;

  const selectableImportedSkins = Array.from(
    importedSkinsForModel.values()
  ).filter((skin) => skin.isComplete);

  const { customSkins, newSkins } = manifest;
  const defaultNames =
    selectedModelType === "player"
      ? (defaultSkins[actualModel] ?? [])
      : modelDefaults[actualModel]
        ? [modelDefaults[actualModel]]
        : [];
  const skinSelectValue = selectedSkin
    ? `${selectedSkinType}/${selectedSkin}`
    : "";

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setImportError(null);
    try {
      await loadSkinFiles(Array.from(event.target.files ?? []));
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Unable to open this skin"
      );
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const newSkinGroup = newSkins[actualModel]?.length ? (
    <optgroup label="New Skins ✨" data-skin-type="custom">
      {newSkins[actualModel].map((name) => (
        <option key={`new/${name}`} value={`custom/${name}`}>
          {name} ✨
        </option>
      ))}
    </optgroup>
  ) : null;

  return (
    <div className="Toolbar">
      <div className="Field">
        <label htmlFor="ModelSelect">Model</label>
        <select
          id="ModelSelect"
          value={selectedModel}
          onChange={(event) => {
            const newSelectedModel = event.target.value;
            const newActualModel =
              newSelectedModel === "hfemale" ? "hmale" : newSelectedModel;
            const availableSkins =
              selectedSkinType === "default"
                ? (defaultSkins[newActualModel] ?? [
                    modelDefaults[newActualModel],
                  ])
                : selectedSkinType === "custom"
                  ? customSkins[newActualModel]
                  : [];
            const newModelHasSkin =
              selectedSkin && availableSkins?.includes(selectedSkin);

            setSelectedAnimation(null);
            setAnimationPaused(false);
            setSelectedModel(newSelectedModel);
            setSelectedMaterialIndex(0);
            if (!newModelHasSkin) {
              setSelectedSkin(modelDefaults[newActualModel] ?? null);
              setSelectedSkinType("default");
            }
          }}
        >
          <optgroup label="Players">
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
          <optgroup label="Weapons">
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
            <option value="mine">Mine</option>
          </optgroup>
          <optgroup label="Vehicles">
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
                ? (parentNode.dataset.skinType ?? null)
                : null;
              const value = event.target.value;
              setSelectedSkin(
                value ? value.slice(value.indexOf("/") + 1) : null
              );
              setSelectedSkinType(skinType);
            }}
          >
            <option value="">Select a skin…</option>
            {selectedSkinType === "project" ? (
              <optgroup label="Project" data-skin-type="project">
                <option value={`project/${selectedSkin}`}>
                  {selectedSkin}
                </option>
              </optgroup>
            ) : null}
            {defaultNames.length ? (
              <optgroup label="Default Skins" data-skin-type="default">
                {defaultNames.map((name) => (
                  <option key={name} value={`default/${name}`}>
                    {selectedModelType === "player" ? name : "Default"}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {selectableImportedSkins.length ? (
              <optgroup label="Imported Skins" data-skin-type="import">
                {selectableImportedSkins.map((skin) => (
                  <option
                    key={skin.name ?? "__untitled__"}
                    value={`import/${skin.name ?? "__untitled__"}`}
                  >
                    {skin.name || "Untitled Imported Skin"}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {newSkinGroup}
            {selectedModelType === "player" ||
            customSkins[actualModel]?.length ? (
              <optgroup label="Custom Skins" data-skin-type="custom">
                {!isManifestLoaded ? (
                  <option value="">Loading…</option>
                ) : (
                  customSkins[actualModel]?.map((name) => (
                    <option key={name} value={`custom/${name}`}>
                      {name}
                    </option>
                  ))
                )}
              </optgroup>
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
            onChange={handleFileChange}
            type="file"
            accept=".png, image/png, .vl2, .zip, application/zip, application/zip-compressed, .skin"
            multiple
            hidden
          />
        </div>
      </div>
      {importError ? <p role="alert">{importError}</p> : null}
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

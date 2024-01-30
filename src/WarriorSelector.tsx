import getConfig from "next/config";
import useWarrior from "./useWarrior";
import { AiTwotoneFolderOpen } from "react-icons/ai";
import { useRef } from "react";
import useTools from "./useTools";

const { publicRuntimeConfig } = getConfig();
const { defaultSkins, customSkins, modelDefaults, materials } =
  publicRuntimeConfig;

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
    setSkinImageUrls,
    setAnimationPaused,
  } = useWarrior();
  const { selectedMaterialIndex, setSelectedMaterialIndex } = useTools();
  const materialDefs = materials[actualModel];
  const materialDef = materialDefs[selectedMaterialIndex];
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
            const { modelType } = parentNode.dataset;
            if (!modelType) {
              throw new Error("No data-model-type found");
            }
            const newModelHasSkin =
              defaultSkins[newSelectedModel]?.includes(selectedSkin) ||
              customSkins[newSelectedModel]?.includes(selectedSkin) ||
              false;
            // startTransition(() => {
            setSelectedAnimation(null);
            setAnimationPaused(false);
            setSelectedModelType(modelType);
            setSelectedModel(newSelectedModel);
            setSelectedMaterialIndex(0);
            if (!newModelHasSkin) {
              setSelectedSkin(modelDefaults[newSelectedModel] ?? null);
              setSelectedSkinType("default");
            }
            // });
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
            value={selectedSkin ?? ""}
            onChange={async (event) => {
              const parentNode = event.target.selectedOptions[0]
                .parentNode as HTMLElement;
              const skinType = event.target.value
                ? parentNode.dataset.skinType ?? null
                : null;
              setSelectedSkin(event.target.value || null);
              setSelectedSkinType(skinType);
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
                <optgroup label="Custom Skins" data-skin-type="custom">
                  {customSkins[actualModel]?.map((name: string) => {
                    return (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    );
                  })}
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
            <AiTwotoneFolderOpen style={{ fontSize: 18 }} />
          </button>
          <input
            ref={fileInputRef}
            onChange={async (event) => {
              const imageUrl = await new Promise<string>((resolve, reject) => {
                const inputFile = event.target.files?.[0];
                if (inputFile) {
                  const reader = new FileReader();
                  reader.addEventListener("load", (event) => {
                    resolve(event.target?.result as string);
                  });
                  reader.readAsDataURL(inputFile);
                } else {
                  reject(new Error("No input file provided."));
                }
              });
              setSelectedSkin(null);
              setSkinImageUrls({
                [materialDef.file ?? materialDef.name]: imageUrl,
              });
            }}
            type="file"
            accept=".png, image/png"
            hidden
          />
        </div>
      </div>
    </div>
  );
}

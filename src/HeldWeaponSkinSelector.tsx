import Select from "./Select";
import useEnvironment from "./useEnvironment";
import useManifest from "./useManifest";
import useWarrior from "./useWarrior";
import { skinOptionGroups } from "./skinOptions";

// The chosen skin's name, even before the skin lists have loaded.
function skinLabel(skin: string | null) {
  const name = skin?.slice(skin.indexOf("/") + 1);
  return !name ? "Default" : name === "__untitled__" ? "Untitled Imported Skin" : name;
}

export default function HeldWeaponSkinSelector({ weapon }: { weapon: string }) {
  const { heldWeaponSkin, setHeldWeaponSkin } = useEnvironment();
  const { importedSkins } = useWarrior();
  const [manifest, isManifestLoaded] = useManifest();

  return (
    <>
      <label htmlFor="HeldWeaponSkinSelect">Weapon Skin</label>
      <Select
        id="HeldWeaponSkinSelect"
        searchable
        searchPlaceholder="Search skins…"
        value={heldWeaponSkin ?? ""}
        selectedLabel={skinLabel(heldWeaponSkin)}
        onChange={(value) => setHeldWeaponSkin(value || null)}
        options={[
          { value: "", label: "Default" },
          ...skinOptionGroups(weapon, { importedSkins, manifest, isManifestLoaded, alwaysShowCustom: true }),
        ]}
      />
    </>
  );
}

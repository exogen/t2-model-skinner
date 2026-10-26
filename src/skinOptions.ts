import type { Skin } from "./importUtils";
import type { SelectGroup } from "./Select";
import type { Manifest } from "./useManifest";

/** The groups of imported, new and custom skins for `model` in a skin list.
 * Custom skins show while the manifest loads, and with `alwaysShowCustom`
 * even when there are none. */
export function skinOptionGroups(
  model: string,
  {
    importedSkins,
    manifest: { customSkins, newSkins },
    isManifestLoaded,
    alwaysShowCustom = false,
  }: {
    importedSkins: Map<string, Map<string | null, Skin>>;
    manifest: Manifest;
    isManifestLoaded: boolean;
    alwaysShowCustom?: boolean;
  }
) {
  const groups: SelectGroup[] = [];
  const imported = Array.from(importedSkins.get(model)?.values() ?? [])
    .filter((skin) => skin.isComplete);
  const newNames = newSkins[model] ?? [];
  if (imported.length) {
    groups.push({
      label: "Imported Skins",
      options: imported.map((skin) => ({
        value: `import/${skin.name ?? "__untitled__"}`,
        label: skin.name || "Untitled Imported Skin",
      })),
    });
  }
  if (newNames.length) {
    groups.push({
      label: "New Skins ✨",
      options: newNames.map((name) => ({
        value: `custom/${name}`, label: `${name} ✨`,
      })),
    });
  }
  if (alwaysShowCustom || customSkins[model]?.length) {
    groups.push({
      label: "Custom Skins",
      options: !isManifestLoaded
        ? [{ value: "__loading__", label: "Loading…", disabled: true }]
        : (customSkins[model] ?? [])
          .filter((name) => !newNames.includes(name))
          .map((name) => ({ value: `custom/${name}`, label: name })),
    });
  }
  return groups;
}

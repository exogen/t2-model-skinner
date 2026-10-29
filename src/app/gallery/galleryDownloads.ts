import modelConfig, { modelToModelType, modelTypes } from "../../models";
import type { Manifest } from "../../useManifest";

export type DownloadTarget =
  | { kind: "skin"; name: string; model: string }
  | { kind: "pack"; name: string; pack: Manifest["packs"][string] };
export type HdPreference = "prompt" | "yes" | "no";

export const weaponLabels: Record<string, string> = {
  disc: "Disc Launcher",
  chaingun: "Chaingun",
  grenade_launcher: "Grenade Launcher",
  sniper: "Laser Rifle",
  plasmathrower: "Plasma Cannon",
  energy: "Blaster",
  shocklance: "Shocklance",
  elf: "ELF Projector",
  missile: "Missile Launcher",
  mortar: "Mortar",
  repair: "Repair Pack",
  targeting: "Targeting Laser",
  mine: "Mine",
};
const modelOrder = Object.values(modelTypes).flat();
export const sortModels = (models: string[]) =>
  Array.from(new Set(models)).sort(
    (a, b) =>
      (modelOrder.indexOf(a) < 0 ? Infinity : modelOrder.indexOf(a)) -
      (modelOrder.indexOf(b) < 0 ? Infinity : modelOrder.indexOf(b)),
  );

export function weaponSetModels(target: DownloadTarget, manifest: Manifest) {
  if (target.kind !== "skin" || modelToModelType(target.model) !== "weapon")
    return [];
  return modelTypes.weapon.filter(
    (model) =>
      model === target.model ||
      manifest.customSkins[model]?.includes(target.name),
  );
}

function modelFiles(model: string, skin: string): string[] {
  if (modelToModelType(model) === "player") return [`${skin}.${model}.png`];
  return (modelConfig.materials[model] ?? []).flatMap((material) => {
    if (material.hidden || material.selectable === false) return [];
    const file = material.file ?? material.name;
    const frameCount = material.frameCount ?? 1;
    if (frameCount < 2) return [`${skin}/${file}.png`];
    const match = /^(.+[^\d])(\d{2,})$/.exec(file);
    if (!match)
      throw new Error("Unable to determine the texture animation filenames.");
    return Array.from(
      { length: frameCount },
      (_, frame) =>
        `${skin}/${match[1]}${frame.toString().padStart(match[2].length, "0")}.png`,
    );
  });
}

export function planDownload(
  target: DownloadTarget,
  fullSet: boolean,
  manifest: Manifest,
) {
  let models: string[];
  let filesByModel: Record<string, string[]>;
  let fileNames: string[];
  let zipFileName: string;
  if (target.kind === "pack") {
    models = sortModels(
      Object.keys(target.pack.skins).filter(
        (model) => target.pack.skins[model].length,
      ),
    );
    filesByModel = Object.fromEntries(
      models.map((model) => [
        model,
        target.pack.skins[model].flatMap((name) => modelFiles(model, name)),
      ]),
    );
    fileNames = target.pack.files;
    zipFileName = `zSkinPack-${target.name}-v${target.pack.version}.vl2`;
  } else {
    const type = modelToModelType(target.model);
    if (!type) throw new Error("Unknown model");
    models =
      type === "player"
        ? modelTypes.player.filter(
            (model) =>
              model === target.model ||
              manifest.customSkins[model]?.includes(target.name),
          )
        : type === "weapon" && fullSet
          ? weaponSetModels(target, manifest)
          : [target.model];
    models = sortModels(models);
    filesByModel = Object.fromEntries(
      models.map((model) => [model, modelFiles(model, target.name)]),
    );
    fileNames = Object.values(filesByModel).flat();
    const camelCaseModel = target.model.replace(
      /(?:^([a-z])|_([a-z]))/g,
      (_, a, b) => (a || b).toUpperCase(),
    );
    const prefix =
      type === "player"
        ? "zPlayerSkin"
        : type === "weapon"
          ? fullSet && models.length > 1
            ? "zWeaponSkinSet"
            : `zWeapon${camelCaseModel}`
          : `z${camelCaseModel}`;
    zipFileName = `${prefix}-${target.name}.vl2`;
  }
  fileNames = Array.from(new Set(fileNames));
  return {
    models,
    filesByModel,
    fileNames,
    zipFileName,
    hasHiRes: fileNames.some((file) => manifest.sizeMultiplier[file] > 1),
    skipNotFound: target.kind === "skin",
  };
}

import { useEffect, useRef, useState } from "react";
import { createMaterialBinding } from "./materialBinding";
import modelConfig, { armThread, hasMetallicMap, partMaterials, type MaterialDefinition } from "./models";
import { loadArmPoses } from "./armPoses";
import { getLocalAssetUrl } from "./deployPaths";
import { getSkinImageUrls } from "./WarriorProvider";
import useImageLoader from "./useImageLoader";
import useImageWorker from "./useImageWorker";
import useModelViewer from "./useModelViewer";
import useSettings from "./useSettings";
import useWarrior from "./useWarrior";
import type { MountedModel } from "./Viewer";

const { modelDefaults } = modelConfig;

type Binding = ReturnType<typeof createMaterialBinding>;

/** `weapon` in the shown player's hand like in the game, in `skin`, a type
 * and name like "custom/Name", or its default skin. Show another weapon with
 * another instance, keyed by weapon. */
export default function HeldWeapon({ weapon, skin }: { weapon: string; skin: string | null }) {
  const { viewer, scene } = useModelViewer();
  const { actualModel, slowModeEnabled, importedSkins } = useWarrior();
  const { basePath } = useSettings();
  const { loadImage } = useImageLoader();
  const {
    removeAlphaFromArrayBuffer,
    convertArrayBufferAlphaToGrayscale,
    convertGrayscaleImageUrlToMetallicRoughness,
  } = useImageWorker();
  // The shown weapon's materials, in the order of its definitions.
  const [bindings, setBindings] = useState<Binding[] | null>(null);
  const bindingsRef = useRef<Binding[]>([]);
  const slowModeRef = useRef(slowModeEnabled);

  useEffect(() => {
    let stale = false;
    let mounted: MountedModel | null = null;
    let created: Binding[] = [];
    viewer.mount(getLocalAssetUrl(basePath, `${weapon}.glb`), "Mount0").then((model) => {
      if (!model) return;
      if (stale) {
        viewer.unmount(model);
        return;
      }
      mounted = model;
      const definitions = partMaterials(weapon);
      created = model.materials.map((materials, index) => {
        const binding = createMaterialBinding({ materials, definition: definitions[index], viewer });
        binding.setSlowMode(slowModeRef.current);
        return binding;
      });
      bindingsRef.current = created;
      setBindings(created);
    }).catch((error: unknown) => console.error("Unable to load weapon", error));
    return () => {
      stale = true;
      created.forEach((binding) => binding.dispose());
      bindingsRef.current = [];
      setBindings(null);
      if (mounted) viewer.unmount(mounted);
    };
  }, [viewer, scene, weapon, basePath]);

  useEffect(() => {
    if (!bindings) return;
    let stale = false;
    // Each frame of a texture as the editor shows it: the color without the
    // alpha channel, and the metallic map made from it.
    const loadTextures = async (definition: MaterialDefinition, urls: string[]) => {
      const buffers = await Promise.all(urls.map((url) => loadImage(url)));
      return {
        colorUrls: await Promise.all(buffers.map((buffer) => removeAlphaFromArrayBuffer(buffer))),
        metallicUrls: hasMetallicMap(definition)
          ? await Promise.all(buffers.map(async (buffer) =>
            convertGrayscaleImageUrlToMetallicRoughness(await convertArrayBufferAlphaToGrayscale(buffer))))
          : undefined,
      };
    };
    const defaults = getSkinImageUrls({
      basePath, actualModel: weapon, selectedSkin: modelDefaults[weapon], selectedSkinType: "default",
    });
    let chosen = defaults;
    if (skin) {
      const separator = skin.indexOf("/");
      try {
        chosen = getSkinImageUrls({
          basePath,
          actualModel: weapon,
          selectedSkin: skin.slice(separator + 1),
          selectedSkinType: skin.slice(0, separator),
          importedSkins,
        });
      } catch {
        // An imported skin that's gone shows the default.
      }
    }
    const definitions = partMaterials(weapon);
    bindings.forEach((binding, index) => {
      const definition = definitions[index];
      if (!definition) return;
      const file = definition.file ?? definition.name;
      // A skin can leave out a texture, like the disc's case: the default
      // shows instead. Some, like the laser rifle's lights, have no default,
      // and then the material shows as it came.
      const load = async () => {
        const candidates = Array.from(new Set([chosen[file], defaults[file]]))
          .filter((urls) => urls != null);
        for (let attempt = 0; attempt < candidates.length; attempt++) {
          try {
            return await loadTextures(definition, candidates[attempt]);
          } catch (error) {
            if (attempt === candidates.length - 1 && definition.hasDefault !== false) throw error;
          }
        }
        return null;
      };
      load().then((textures) => {
        if (stale) return;
        if (textures) binding.setTextures({ ...textures, fallbackUrl: `${basePath}/white.png` });
        else binding.clearTextures();
      }).catch((error: unknown) => console.error("Unable to load weapon texture", error));
    });
    return () => { stale = true; };
  }, [
    bindings, weapon, skin, basePath, importedSkins, loadImage, removeAlphaFromArrayBuffer,
    convertArrayBufferAlphaToGrayscale, convertGrayscaleImageUrlToMetallicRoughness,
  ]);

  // The missile launcher and laser rifle are held their own way. Only the
  // animated model has the arm animations.
  const arm = armThread(actualModel, weapon);
  useEffect(() => {
    if (!arm) return;
    let stale = false;
    loadArmPoses(getLocalAssetUrl(basePath, `${actualModel}.anim.glb`)).then((poses) => {
      if (!stale) viewer.setArmPose(poses.get(arm) ?? null);
    }).catch((error: unknown) => console.error("Unable to load arm pose", error));
    return () => {
      stale = true;
      viewer.setArmPose(null);
    };
  }, [viewer, scene, actualModel, arm, basePath]);

  useEffect(() => {
    slowModeRef.current = slowModeEnabled;
    bindingsRef.current.forEach((binding) => binding.setSlowMode(slowModeEnabled));
  }, [slowModeEnabled]);

  return null;
}

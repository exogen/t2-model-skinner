import { useEffect, useRef } from "react";
import type { Material as ThreeMaterial } from "three";
import useSettings from "./useSettings";
import useSkin from "./useSkin";
import useModelViewer from "./useModelViewer";
import useWarrior from "./useWarrior";
import type { MaterialDefinition } from "./models";
import { createMaterialBinding } from "./materialBinding";

interface MaterialProps {
  materials: ThreeMaterial[];
  materialDef?: MaterialDefinition;
}

export default function Material({ materials, materialDef }: MaterialProps) {
  const { viewer } = useModelViewer();
  const { basePath } = useSettings();
  const { getSkinImages } = useSkin();
  const { slowModeEnabled } = useWarrior();
  const file = materialDef?.file ?? materialDef?.name ?? materials[0]?.name;
  const { colorImageUrl, metallicImageUrl } =
    (file ? getSkinImages(file) : undefined) ?? {};
  const bindingRef = useRef<ReturnType<typeof createMaterialBinding> | null>(
    null,
  );

  useEffect(() => {
    const binding = createMaterialBinding({
      materials,
      definition: materialDef,
      viewer,
    });
    bindingRef.current = binding;
    return () => {
      binding.dispose();
      bindingRef.current = null;
    };
  }, [materials, materialDef, viewer]);

  useEffect(() => {
    bindingRef.current?.setTextures({
      colorUrls: colorImageUrl,
      metallicUrls: metallicImageUrl,
      fallbackUrl: `${basePath}/white.png`,
    });
  }, [
    basePath,
    colorImageUrl,
    metallicImageUrl,
    materials,
    materialDef,
    viewer,
  ]);

  useEffect(() => {
    bindingRef.current?.setSlowMode(slowModeEnabled);
  }, [slowModeEnabled, materials, materialDef, viewer]);

  return null;
}

import getConfig from "next/config";
import Material, { MaterialDefinition } from "./Material";
import useModelViewer from "./useModelViewer";
import useWarrior from "./useWarrior";

const { publicRuntimeConfig } = getConfig();

const { materials } = publicRuntimeConfig;

export default function Materials() {
  const { actualModel } = useWarrior();
  const { model } = useModelViewer();
  const materialDefs: MaterialDefinition[] = materials[actualModel];

  return (
    <>
      {model.materials.map((material, i) => {
        const materialDef =
          materialDefs.find((materialDef) => materialDef.index === i) ??
          materialDefs[i];
        return (
          <Material
            key={material.name}
            material={material}
            materialDef={materialDef}
          />
        );
      })}
    </>
  );
}

import Material from "./Material";
import useModelViewer from "./useModelViewer";
import useWarrior from "./useWarrior";
import modelConfig from "./models";
import type { MaterialDefinition } from "./models";

const { materials } = modelConfig;

export default function Materials() {
  const { actualModel } = useWarrior();
  const { model } = useModelViewer();
  const materialDefs: MaterialDefinition[] = materials[actualModel];

  return (
    <>
      {model.materials.map((materials, i) => {
        const materialDef = materialDefs[i];
        return (
          <Material
            key={i}
            materials={materials}
            materialDef={materialDef}
          />
        );
      })}
    </>
  );
}

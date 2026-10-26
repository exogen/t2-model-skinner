import Material from "./Material";
import useModelViewer from "./useModelViewer";
import useWarrior from "./useWarrior";
import modelConfig, { partMaterials } from "./models";

const { mounts: modelMounts } = modelConfig;

export default function Materials() {
  const { actualModel } = useWarrior();
  const { model, mounts } = useModelViewer();
  // Each file's materials, with the definitions for them, in the same order.
  const parts = [
    { materials: model.materials, definitions: partMaterials(actualModel) },
    ...mounts.map(({ materials }, index) => ({
      materials,
      definitions: partMaterials(actualModel, modelMounts[actualModel]?.[index]?.model),
    })),
  ];

  return (
    <>
      {parts.map(({ materials, definitions }, part) =>
        materials.map((materials, i) => (
          <Material
            key={`${part}:${i}`}
            materials={materials}
            materialDef={definitions[i]}
          />
        ))
      )}
    </>
  );
}

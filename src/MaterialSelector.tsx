import useTools from "./useTools";
import useWarrior from "./useWarrior";
import type { MaterialDefinition } from "./models";
import modelConfig from "./models";
import Select from "./Select";

const { materials } = modelConfig;

export default function MaterialSelector() {
  const { actualModel } = useWarrior();
  const { selectedMaterialIndex, setSelectedMaterialIndex } = useTools();
  const materialDefs: MaterialDefinition[] = materials[actualModel];

  return (
    <Select
      aria-label="Material"
      value={String(selectedMaterialIndex)}
      onChange={(value) => {
        setSelectedMaterialIndex(parseInt(value, 10));
      }}
      options={materialDefs.flatMap((materialDef, i) =>
        materialDef &&
        !materialDef.hidden &&
        materialDef.selectable !== false ? [{
          value: String(i), label: materialDef.label ?? materialDef.name,
        }] : []
      )}
    />
  );
}

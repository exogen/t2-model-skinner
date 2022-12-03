import getConfig from "next/config";
import useTools from "./useTools";
import useWarrior from "./useWarrior";
import { MaterialDefinition } from "./Material";

const { publicRuntimeConfig } = getConfig();

const { materials } = publicRuntimeConfig;

export default function MaterialSelector() {
  const { actualModel } = useWarrior();
  const { selectedMaterialIndex, setSelectedMaterialIndex } = useTools();
  const materialDefs: MaterialDefinition[] = materials[actualModel];

  return (
    <select
      value={selectedMaterialIndex}
      onChange={(event) => {
        setSelectedMaterialIndex(parseInt(event.target.value, 10));
      }}
    >
      {materialDefs.map((materialDef, i) =>
        materialDef ? (
          <option key={materialDef.name} value={i}>
            {materialDef.label ?? materialDef.name}
          </option>
        ) : null
      )}
    </select>
  );
}

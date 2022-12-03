import React from "react";
import getConfig from "next/config";
import ColorCanvas from "./ColorCanvas";
import MetallicCanvas from "./MetallicCanvas";
import useWarrior from "./useWarrior";
import { MaterialDefinition } from "./Material";

const { publicRuntimeConfig } = getConfig();

const { materials } = publicRuntimeConfig;

export default function MaterialCanvases() {
  const { actualModel } = useWarrior();
  const materialDefs: MaterialDefinition[] = materials[actualModel];

  return (
    <>
      {materialDefs.map((materialDef) => {
        if (!materialDef) {
          return null;
        }
        const hasMetallic = !(
          materialDef.metallicFactor === 0 && materialDef.roughnessFactor === 1
        );
        return (
          <React.Fragment key={`${actualModel}-${materialDef.name}`}>
            <ColorCanvas materialDef={materialDef} />
            {hasMetallic ? <MetallicCanvas materialDef={materialDef} /> : null}
          </React.Fragment>
        );
      })}
    </>
  );
}

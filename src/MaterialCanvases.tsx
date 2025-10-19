import React from "react";
import ColorCanvas from "./ColorCanvas";
import MetallicCanvas from "./MetallicCanvas";
import useWarrior from "./useWarrior";
import type { MaterialDefinition } from "./models";
import modelConfig from "./models";

const { materials } = modelConfig;

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
        const frameCount = materialDef.frameCount ?? 1;
        const frames = new Array(frameCount).fill(null);
        return (
          <React.Fragment key={`${actualModel}-${materialDef.name}`}>
            {frames.map((_, i) => (
              <ColorCanvas
                materialDef={materialDef}
                frameIndex={i}
                key={`color:${i}`}
              />
            ))}
            {hasMetallic
              ? frames.map((_, i) => (
                  <MetallicCanvas
                    materialDef={materialDef}
                    frameIndex={i}
                    key={`metallic:${i}`}
                  />
                ))
              : null}
          </React.Fragment>
        );
      })}
    </>
  );
}

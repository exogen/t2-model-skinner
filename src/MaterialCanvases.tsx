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

import { useMemo } from "react";
import getConfig from "next/config";
import { IoMdPlay, IoMdPause } from "react-icons/io";
import useWarrior from "./useWarrior";

const { publicRuntimeConfig } = getConfig();
const { animations, animationLabels, animationLabelOverrides } =
  publicRuntimeConfig;

export default function AnimationSelector() {
  const {
    actualModel,
    selectedModelType,
    selectedAnimation,
    setSelectedAnimation,
    animationPaused,
    setAnimationPaused,
  } = useWarrior();

  const animationList = useMemo(
    () => [
      ...(selectedModelType === "player" ? animations.global : []),
      ...(animations[actualModel] ?? []),
    ],
    [actualModel, selectedModelType]
  );

  return (
    <>
      <label>Animation</label>
      <div className="Buttons">
        <select
          value={selectedAnimation ?? ""}
          onChange={(event) => {
            setSelectedAnimation(event.target.value || null);
            setAnimationPaused(false);
          }}
        >
          <option value="">None</option>
          {animationList.map((animationName) => {
            const label =
              animationLabelOverrides[actualModel]?.[animationName] ??
              animationLabels[animationName];
            return (
              <option key={animationName} value={animationName}>
                {label ?? animationName}
              </option>
            );
          })}
        </select>
        <button
          type="button"
          disabled={!selectedAnimation}
          onClick={() => {
            setAnimationPaused((animationPaused) => !animationPaused);
          }}
        >
          {animationPaused || !selectedAnimation ? <IoMdPlay /> : <IoMdPause />}
        </button>
      </div>
    </>
  );
}

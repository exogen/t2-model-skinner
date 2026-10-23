import { useMemo } from "react";
import { IoMdPlay, IoMdPause } from "react-icons/io";
import useWarrior from "./useWarrior";
import modelConfig from "./models";
import { useMocap } from "./MocapProvider";
import Select from "./Select";

const { animations, animationLabels, animationLabelOverrides } = modelConfig;

export default function AnimationSelector() {
  const { active: mocapActive } = useMocap();
  const {
    actualModel,
    selectedModelType,
    selectedAnimation,
    setSelectedAnimation,
    animationPaused,
    setAnimationPaused,
    slowModeEnabled,
    setSlowModeEnabled,
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
      <div className="LabelWithControls">
        <label htmlFor="AnimationSelect">Animation</label>
        <div className="AnimationSpeed">
          <input
            type="checkbox"
            id="SlowDownCheckbox"
            disabled={mocapActive}
            checked={slowModeEnabled}
            onChange={(event) => {
              setSlowModeEnabled(event.target.checked);
            }}
          />{" "}
          <label htmlFor="SlowDownCheckbox">Slow?</label>
        </div>
      </div>
      <div className="Buttons">
        <Select
          id="AnimationSelect"
          aria-label="Animation"
          disabled={mocapActive}
          value={selectedAnimation ?? ""}
          onChange={(value) => {
            setSelectedAnimation(value || null);
            setAnimationPaused(false);
          }}
          options={[
            { value: "", label: "None" },
            ...animationList.map((animationName) => ({
              value: animationName,
              label: animationLabelOverrides[actualModel]?.[animationName]
                ?? animationLabels[animationName] ?? animationName,
            })),
          ]}
        />
        <button
          type="button"
          disabled={!selectedAnimation || mocapActive}
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

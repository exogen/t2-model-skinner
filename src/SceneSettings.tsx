import { useState } from "react";
import { FloatingFocusManager } from "@floating-ui/react";
import { IoMdSettings } from "react-icons/io";
import EnvironmentSelector from "./EnvironmentSelector";
import RenderModeSelector from "./RenderModeSelector";
import HeldWeaponSelector from "./HeldWeaponSelector";
import HeldWeaponSkinSelector from "./HeldWeaponSkinSelector";
import useEnvironment from "./useEnvironment";
import useWarrior from "./useWarrior";
import EnvironmentExposure from "./EnvironmentExposure";
import useToolPopup from "./useToolPopup";

export default function SceneSettings() {
  const [isOpen, setOpen] = useState(false);
  const { selectedModelType } = useWarrior();
  const { heldWeapon } = useEnvironment();
  const { refs, floatingStyles, context, getReferenceProps, getFloatingProps } =
    useToolPopup(isOpen, setOpen);

  return (
    <>
      <button
        type="button"
        className="SceneSettingsButton"
        data-active={isOpen ? "" : undefined}
        aria-label="Scene settings"
        title="Scene settings"
        ref={refs.setReference}
        {...getReferenceProps()}
      >
        <IoMdSettings aria-hidden="true" />
        <span className="ButtonText">Scene settings</span>
      </button>
      {isOpen ? (
        // The skin lists open outside the popup and focus their search box,
        // so moving focus out doesn't close it. Clicking outside still does.
        <FloatingFocusManager context={context} modal={false} closeOnFocusOut={false}>
          <div
            className="SceneSettingsPopup"
            aria-label="Scene settings"
            // eslint-disable-next-line react-hooks/refs
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
          >
            <div className="Fields">
              <div className="Field">
                <EnvironmentSelector />
              </div>
              <div className="Field">
                <EnvironmentExposure />
              </div>
              <div className="Field">
                <RenderModeSelector />
              </div>
              {selectedModelType === "player" ? (
                <div className="Field">
                  <HeldWeaponSelector />
                </div>
              ) : null}
              {selectedModelType === "player" && heldWeapon ? (
                <div className="Field">
                  <HeldWeaponSkinSelector weapon={heldWeapon} />
                </div>
              ) : null}
            </div>
          </div>
        </FloatingFocusManager>
      ) : null}
    </>
  );
}

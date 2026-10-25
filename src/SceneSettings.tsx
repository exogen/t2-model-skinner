import { useState } from "react";
import { FloatingFocusManager } from "@floating-ui/react";
import { IoMdSettings } from "react-icons/io";
import EnvironmentSelector from "./EnvironmentSelector";
import RenderModeSelector from "./RenderModeSelector";
import EnvironmentExposure from "./EnvironmentExposure";
import useToolPopup from "./useToolPopup";

export default function SceneSettings() {
  const [isOpen, setOpen] = useState(false);
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
        <FloatingFocusManager context={context} modal={false}>
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
            </div>
          </div>
        </FloatingFocusManager>
      ) : null}
    </>
  );
}

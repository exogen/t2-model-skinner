import AppFooter from "./AppFooter";
import CanvasBackdrop from "./CanvasBackdrop";
import CanvasInteractions from "./CanvasInteractions";
import CanvasToggle from "./CanvasToggle";
import CanvasTools from "./CanvasTools";
import MaterialCanvases from "./MaterialCanvases";
import MaterialSelector from "./MaterialSelector";
import WarriorSelector from "./WarriorSelector";
import { LiveMocapPreview, useMocap } from "./MocapProvider";

export default function EditorWorkspace() {
  const { active } = useMocap();

  return (
    <CanvasInteractions disabled={active}>
      <WarriorSelector />
      <div className="CanvasViewport" data-mocap-active={active}>
        {/* Keep the canvases and their undo histories alive while tracking. */}
        <div className="TextureCanvas" inert={active}>
          <div className="CanvasSelector">
            <CanvasToggle />
            <MaterialSelector />
          </div>
          <CanvasBackdrop />
          <MaterialCanvases />
        </div>
        <LiveMocapPreview />
      </div>
      <div className="CanvasToolsRegion" data-mocap-active={active} inert={active}>
        <CanvasTools />
      </div>
      <AppFooter />
    </CanvasInteractions>
  );
}

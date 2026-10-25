import Select from "./Select";
import useEnvironment from "./useEnvironment";
import { renderModeOptions, type RenderMode } from "./renderModes";

export default function RenderModeSelector() {
  const { renderMode, setRenderMode } = useEnvironment();

  return (
    <>
      <label htmlFor="RenderModeSelect">Render Mode</label>
      <Select
        id="RenderModeSelect"
        value={renderMode}
        onChange={(value) => setRenderMode(value as RenderMode)}
        options={renderModeOptions}
      />
    </>
  );
}

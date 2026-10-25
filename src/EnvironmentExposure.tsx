import useEnvironment from "./useEnvironment";

export default function EnvironmentExposure() {
  const { exposure, setExposure } = useEnvironment();

  return (
    <>
      <label htmlFor="EnvExposure">Brightness</label>
      <input
        id="EnvExposure"
        type="range"
        min={0.2}
        max={2.2}
        step={0.1}
        value={exposure}
        onChange={(event) => {
          setExposure(parseFloat(event.target.value));
        }}
      />
    </>
  );
}

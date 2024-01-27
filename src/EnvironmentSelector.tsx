import useEnvironment from "./useEnvironment";

export default function EnvironmentSelector() {
  const { selectedEnvironment, setSelectedEnvironment } = useEnvironment();

  return (
    <>
      <label htmlFor="EnvMapSelect">Environment</label>
      <select
        id="EnvMapSelect"
        value={selectedEnvironment ?? ""}
        onChange={(event) => {
          setSelectedEnvironment(event.target.value || null);
        }}
      >
        <option value="">Default</option>
        <option value="clarens_night_02_1k.hdr">Clarens Night</option>
        <option value="dry_cracked_lake_1k.hdr">Dry Cracked Lake</option>
        <option value="fouriesburg_mountain_midday_1k.hdr">
          Fouriesburg Mountain
        </option>
        <option value="goegap_1k.hdr">Goegap</option>
        <option value="hilly_terrain_01_1k.hdr">Hilly Terrain</option>
        <option value="kloofendal_48d_partly_cloudy_puresky_1k.hdr">
          Kloofendal Partly Cloudy
        </option>
        <option value="kloppenheim_06_puresky_1k.hdr">Kloppenheim</option>
        <option value="lilienstein_1k.hdr">Lilienstein</option>
        <option value="spruit_sunrise_1k_HDR.hdr">Spruit Sunrise</option>
        <option value="umhlanga_sunrise_1k.hdr">Umhlanga Sunrise</option>
      </select>
    </>
  );
}

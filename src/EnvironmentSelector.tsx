import Select from "./Select";
import useEnvironment from "./useEnvironment";

export default function EnvironmentSelector() {
  const { selectedEnvironment, setSelectedEnvironment } = useEnvironment();

  return (
    <>
      <label htmlFor="EnvMapSelect">Environment</label>
      <Select
        id="EnvMapSelect"
        value={selectedEnvironment ?? ""}
        onChange={(value) => setSelectedEnvironment(value || null)}
        options={[
          { value: "", label: "Default" },
          { value: "clarens_night_02_1k.hdr", label: "Clarens Night" },
          { value: "dry_cracked_lake_1k.hdr", label: "Dry Cracked Lake" },
          { value: "fouriesburg_mountain_midday_1k.hdr", label: "Fouriesburg Mountain" },
          { value: "goegap_1k.hdr", label: "Goegap" },
          { value: "hilly_terrain_01_1k.hdr", label: "Hilly Terrain" },
          { value: "kloofendal_48d_partly_cloudy_puresky_1k.hdr", label: "Kloofendal Partly Cloudy" },
          { value: "kloppenheim_06_puresky_1k.hdr", label: "Kloppenheim" },
          { value: "lilienstein_1k.hdr", label: "Lilienstein" },
          { value: "spruit_sunrise_1k_HDR.hdr", label: "Spruit Sunrise" },
          { value: "umhlanga_sunrise_1k.hdr", label: "Umhlanga Sunrise" },
        ]}
      />
    </>
  );
}

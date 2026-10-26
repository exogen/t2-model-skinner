import Select from "./Select";
import useEnvironment from "./useEnvironment";
import { heldWeaponOptions } from "./modelOptions";

export default function HeldWeaponSelector() {
  const { heldWeapon, setHeldWeapon } = useEnvironment();

  return (
    <>
      <label htmlFor="HeldWeaponSelect">Weapon</label>
      <Select
        id="HeldWeaponSelect"
        value={heldWeapon ?? ""}
        onChange={(value) => setHeldWeapon(value || null)}
        options={[{ value: "", label: "None" }, ...heldWeaponOptions]}
      />
    </>
  );
}

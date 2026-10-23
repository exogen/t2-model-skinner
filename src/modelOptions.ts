import type { ModelType } from "./models";
import type { SelectGroup } from "./Select";

export const modelOptions: (SelectGroup & { type: ModelType })[] = [
  {
    type: "player",
    label: "Players",
    options: [
      { value: "lmale", label: "Human Male • Light" },
      { value: "mmale", label: "Human Male • Medium" },
      { value: "hmale", label: "Human Male • Heavy" },
      { value: "lfemale", label: "Human Female • Light" },
      { value: "mfemale", label: "Human Female • Medium" },
      { value: "hfemale", label: "Human Female • Heavy" },
      { value: "lbioderm", label: "Bioderm • Light" },
      { value: "mbioderm", label: "Bioderm • Medium" },
      { value: "hbioderm", label: "Bioderm • Heavy" },
    ],
  },
  {
    type: "weapon",
    label: "Weapons",
    options: [
      { value: "disc", label: "Disc Launcher" },
      { value: "chaingun", label: "Chaingun" },
      { value: "grenade_launcher", label: "Grenade Launcher" },
      { value: "sniper", label: "Laser Rifle" },
      { value: "plasmathrower", label: "Plasma Cannon" },
      { value: "energy", label: "Blaster" },
      { value: "shocklance", label: "Shocklance" },
      { value: "elf", label: "ELF Projector" },
      { value: "missile", label: "Missile Launcher" },
      { value: "mortar", label: "Mortar" },
      { value: "repair", label: "Repair Pack" },
      { value: "targeting", label: "Targeting Laser" },
      { value: "mine", label: "Mine" },
    ],
  },
  {
    type: "vehicle",
    label: "Vehicles",
    options: [
      { value: "vehicle_grav_scout", label: "Wildcat Grav Cycle" },
      { value: "vehicle_grav_tank", label: "Beowulf Assault Tank" },
      { value: "vehicle_land_mpbbase", label: "Jericho Mobile Point Base" },
      { value: "vehicle_air_scout", label: "Shrike Scout Fighter" },
      { value: "vehicle_air_bomber", label: "Thundersword Bomber" },
      { value: "vehicle_air_hapc", label: "HAVOC Gunship Transport" },
    ],
  },
];

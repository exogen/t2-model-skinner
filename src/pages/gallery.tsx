import { useEffect, useMemo, useState } from "react";
import { CgSpinnerTwo } from "react-icons/cg";
import { FaChevronLeft, FaGithub } from "react-icons/fa";
import { useRouter } from "next/router";
import orderBy from "lodash.orderby";
import useManifest from "../useManifest";
import styles from "./gallery.module.css";
import Head from "next/head";
import Link from "next/link";

const baseManifestPath = `https://exogen.github.io/t2-skins`;
const emptySkins: string[] = [];

const modelOrder: Record<string, number> = {
  lmale: 0,
  mmale: 1,
  lfemale: 2,
  mfemale: 3,
  hmale: 4,
  lbioderm: 5,
  mbioderm: 6,
  hbioderm: 7,
  energy: 8,
  disc: 9,
  chaingun: 10,
  grenade_launcher: 11,
  sniper: 12,
  elf: 13,
  shocklance: 14,
  plasmathrower: 15,
  missile: 16,
  mortar: 17,
  repair: 18,
  targeting: 19,
  vehicle_grav_scout: 20,
  vehicle_grav_tank: 21,
  turret_assaulttank_mortar: 22,
  vehicle_land_mpbbase: 23,
  vehicle_air_scout: 24,
  vehicle_air_bomber: 25,
  vehicle_air_hapc: 26,
};

export default function GalleryPage() {
  const router = useRouter();
  const [manifest, isLoaded] = useManifest();
  const [selectedModel, setSelectedModel] = useState("lmale");
  const actualModel = selectedModel === "hfemale" ? "hmale" : selectedModel;
  const customSkins = manifest.customSkins?.[actualModel] ?? emptySkins;

  const newSkinList = useMemo(() => {
    if (manifest?.newSkins && selectedModel === "new") {
      const allNewSkins: Array<{ name: string; model: string }> = [];

      Object.entries(manifest.newSkins).forEach(([model, names]) => {
        allNewSkins.push(...names.map((name) => ({ name, model })));
      });

      return orderBy(
        allNewSkins,
        [(skin) => skin.name.toLowerCase(), (skin) => modelOrder[skin.model]],
        ["asc", "asc"]
      );
    } else {
      return [];
    }
  }, [selectedModel, manifest]);

  const filteredSkins = selectedModel === "new" ? newSkinList : customSkins;

  const filter =
    router.query.filter && typeof router.query.filter === "string"
      ? router.query.filter
      : "lmale";

  useEffect(() => {
    setSelectedModel(filter);
  }, [filter]);

  return (
    <>
      <Head>
        <title>Tribes 2 Skin Gallery</title>
      </Head>
      <main className={styles.GalleryPage}>
        <div className={styles.Tools}>
          <Link className={styles.Back} href="../">
            <FaChevronLeft size={12} className={styles.Icon} />{" "}
            <span className={styles.Label}>Back to Editor</span>
          </Link>
          <select
            tabIndex={0}
            id="ModelSelect"
            aria-label="Player model"
            onChange={(event) => {
              router.push(`?filter=${event.target.value}`);
            }}
            value={selectedModel}
          >
            <option value="new">All new skins ✨</option>
            <optgroup label="Players" data-model-type="player">
              <option value="lmale">Human Male &bull; Light</option>
              <option value="mmale">Human Male &bull; Medium</option>
              <option value="hmale">Human Male &bull; Heavy</option>
              <option value="lfemale">Human Female &bull; Light</option>
              <option value="mfemale">Human Female &bull; Medium</option>
              <option value="hfemale">Human Female &bull; Heavy</option>
              <option value="lbioderm">Bioderm &bull; Light</option>
              <option value="mbioderm">Bioderm &bull; Medium</option>
              <option value="hbioderm">Bioderm &bull; Heavy</option>
            </optgroup>
            <optgroup label="Weapons" data-model-type="weapon">
              <option value="disc">Disc Launcher</option>
              <option value="chaingun">Chaingun</option>
              <option value="grenade_launcher">Grenade Launcher</option>
              <option value="sniper">Laser Rifle</option>
              <option value="plasmathrower">Plasma Cannon</option>
              <option value="energy">Blaster</option>
              <option value="shocklance">Shocklance</option>
              <option value="elf">ELF Projector</option>
              <option value="missile">Missile Launcher</option>
              <option value="mortar">Mortar</option>
              <option value="repair">Repair Pack</option>
              <option value="targeting">Targeting Laser</option>
            </optgroup>
            <optgroup label="Vehicles" data-model-type="vehicle">
              <option value="vehicle_grav_scout">Wildcat Grav Cycle</option>
              <option value="vehicle_grav_tank">Beowulf Assault Tank</option>
              <option value="vehicle_land_mpbbase">
                Jericho Mobile Point Base
              </option>
              <option value="vehicle_air_scout">Shrike Scout Fighter</option>
              <option value="vehicle_air_bomber">Thundersword Bomber</option>
              <option value="vehicle_air_hapc">HAVOC Gunship Transport</option>
            </optgroup>
          </select>
          <a
            href="https://github.com/exogen/t2-model-skinner"
            className={styles.IconLink}
          >
            <FaGithub size={32} />
          </a>
        </div>
        {isLoaded ? (
          <div className={styles.Gallery}>
            {filteredSkins.map((name) => {
              let skinName;
              let skinModel;
              if (typeof name === "string") {
                skinName = name;
                skinModel = actualModel;
              } else {
                skinName = name.name;
                skinModel = name.model;
              }
              const url = `${baseManifestPath}/gallery/${encodeURIComponent(
                skinName
              )}.${skinModel}.webp`;

              return (
                <div key={`${skinName}:${skinModel}`} className={styles.Skin}>
                  <img
                    className={styles.Preview}
                    loading="lazy"
                    src={url}
                    width={680}
                    height={800}
                    alt={skinName}
                  />
                  <div className={styles.Name}>{skinName}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <CgSpinnerTwo className={styles.Spinner} />
        )}
      </main>
    </>
  );
}

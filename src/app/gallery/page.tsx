"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CgSpinnerTwo } from "react-icons/cg";
import { BsBadge3dFill } from "react-icons/bs";
import { FaDownload } from "react-icons/fa";
import { FaChevronLeft } from "react-icons/fa";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import orderBy from "lodash.orderby";
import useManifest from "../../useManifest";
import styles from "./gallery.module.css";
import Head from "next/head";
import Link from "next/link";
import { collectFiles, createZipFile, saveZipFile } from "../../exportUtils";
import { modelToModelType, modelTypes } from "../../importUtils";
import modelConfig from "../../models";

const baseManifestPath = `https://exogen.github.io/t2-skins`;
const emptySkins: string[] = [];

function modelToFileList(modelName: string) {
  return modelConfig.materials[modelName]
    .map((material) => {
      if (material.hidden || material.selectable === false) {
        return null;
      }
      const file = material.file ?? material.name;
      if (file) {
        if (
          typeof material.frameCount === "number" &&
          material.frameCount > 1
        ) {
          return new Array(material.frameCount)
            .fill(file)
            .map((fileName, i) => {
              if (i > 0) {
                const match = /^(.+[^\d])(\d{2,})$/.exec(fileName);
                if (match) {
                  const head = match[1];
                  const tail = match[2];
                  return `${head}${i.toString().padStart(tail.length, "0")}`;
                } else {
                  throw new Error("frameCount > 0, but could not parse index");
                }
              } else {
                return fileName;
              }
            });
        } else {
          return file;
        }
      }
    })
    .flat()
    .filter((fileName) => fileName != null)
    .map((fileName) => `${fileName}.png`);
}

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

function skinDataToList(
  skinData: Record<string, string[]>
): Array<{ name: string; model: string }> {
  const allSkins: Array<{ name: string; model: string }> = [];

  Object.entries(skinData).forEach(([model, names]) => {
    allSkins.push(...names.map((name) => ({ name, model })));
  });

  return orderBy(
    allSkins,
    [(skin) => skin.name.toLowerCase(), (skin) => modelOrder[skin.model]],
    ["asc", "asc"]
  );
}

function Gallery() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hiResSelectRef = useRef<HTMLSelectElement>(null);
  const [manifest, isLoaded] = useManifest();
  const [selectedModel, setSelectedModel] = useState("lmale");
  const [isPreparingDownload, setPreparingDownload] = useState(false);
  const [hiResDownload, setHiResDownload] = useState<"prompt" | "yes" | "no">(
    "prompt"
  );
  const actualModel = selectedModel === "hfemale" ? "hmale" : selectedModel;
  const customSkins = manifest.customSkins?.[actualModel] ?? emptySkins;

  const isNew = selectedModel === "new";
  const pack = manifest?.packs?.[selectedModel];
  const isPack = pack != null;

  useEffect(() => {
    const savedHiResDownload = localStorage.getItem("hiResDownload");
    switch (savedHiResDownload) {
      case "yes":
      case "no":
        setHiResDownload(savedHiResDownload);
        break;
    }
  }, []);

  useEffect(() => {
    if (pack && isPreparingDownload) {
      let ignore = false;

      const download = async () => {
        const fileNames = pack.files;

        const hasHiRes = fileNames.some(
          (fileName) => manifest.sizeMultiplier[fileName] > 1
        );

        if (hasHiRes && hiResDownload === "prompt") {
          window.alert(
            "This download contains HD textures, which require the QoL patch. Select “yes” or “no” for HD support, then try again."
          );
          if (hiResSelectRef.current) {
            hiResSelectRef.current.focus();
          }
          setPreparingDownload(false);
          return;
        }

        const collectFileNames =
          hiResDownload === "yes"
            ? fileNames
            : fileNames.map((fileName) => {
                return manifest.sizeMultiplier[fileName] > 1
                  ? fileName.replace(/\.png$/, "@1x.png")
                  : fileName;
              });

        let zipFileName = `zSkinPack-${selectedModel}-v${pack.version}.vl2`;

        if (hasHiRes && hiResDownload === "no") {
          zipFileName = zipFileName.replace(/\.vl2$/, "@1x.vl2");
        }

        const files = await collectFiles(collectFileNames);
        if (!ignore) {
          const zip = createZipFile(files);
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (!ignore) {
            await saveZipFile(zip, zipFileName);
          }
          if (!ignore) {
            setPreparingDownload(false);
          }
        }
      };

      download();

      return () => {
        ignore = true;
        setPreparingDownload(false);
      };
    }
  }, [
    hiResDownload,
    isPreparingDownload,
    manifest.sizeMultiplier,
    pack,
    selectedModel,
  ]);

  const packList = useMemo(() => {
    return orderBy(
      Object.keys(manifest?.packs ?? {}),
      (name) => name.toLowerCase(),
      ["asc"]
    );
  }, [manifest]);

  const selectedSkinList = useMemo(() => {
    const skinData = isNew
      ? manifest?.newSkins
      : isPack
      ? manifest?.packs?.[selectedModel]?.skins
      : null;
    if (skinData) {
      return skinDataToList(skinData);
    } else {
      return [];
    }
  }, [isNew, isPack, selectedModel, manifest]);

  const filteredSkins = isNew || isPack ? selectedSkinList : customSkins;

  const filter = searchParams.get("filter") || "lmale";

  useEffect(() => {
    setPreparingDownload(false);
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
              router.push(`${pathname}?filter=${event.target.value}`);
            }}
            value={selectedModel}
          >
            <option value="new">All new skins ✨</option>
            <optgroup label="Packs">
              {packList.map((packName) => (
                <option value={packName} key={packName}>
                  {packName}
                </option>
              ))}
            </optgroup>
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
          <div className={styles.HeaderEnd}>
            {isPack ? (
              <div className={styles.DownloadSection}>
                <button
                  type="button"
                  className={styles.DownloadButton}
                  onClick={async () => {
                    setPreparingDownload(true);
                  }}
                >
                  Download
                </button>{" "}
                {isPreparingDownload ? (
                  <CgSpinnerTwo className={styles.DownloadSpinner} />
                ) : (
                  <span className={styles.PackVersion}>
                    v{pack.version} &bull; {pack.files.length.toLocaleString()}{" "}
                    {pack.files.length === 1 ? "file" : "files"}
                  </span>
                )}
              </div>
            ) : null}
            <div className={styles.DownloadHiRes}>
              <label htmlFor="hiResSelect">HD support?</label>
              <select
                id="hiResSelect"
                className={styles.HiResSelect}
                ref={hiResSelectRef}
                value={hiResDownload}
                disabled={isPreparingDownload}
                onChange={(event) => {
                  switch (event.target.value) {
                    case "prompt":
                      setHiResDownload(event.target.value);
                      localStorage.removeItem("hiResDownload");
                      break;
                    case "yes":
                    case "no":
                      setHiResDownload(event.target.value);
                      localStorage.setItem("hiResDownload", event.target.value);
                      break;
                  }
                }}
              >
                <option value="prompt">Ask</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>
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
                  <div className={styles.Detail}>
                    <Link
                      className={styles.LoadInEditor}
                      href={`/?m=${skinModel}&s=${encodeURIComponent(
                        skinName
                      )}`}
                    >
                      <BsBadge3dFill
                        title="Load in Editor"
                        aria-label="Load in Editor"
                      />
                    </Link>
                    <span className={styles.Name}>{skinName}</span>
                    <button
                      type="button"
                      className={styles.DownloadSkin}
                      title={`Download ${skinName} skin`}
                      aria-label={`Download ${skinName} skin`}
                      onClick={async () => {
                        const modelType = modelToModelType(skinModel);
                        const camelCaseModelName = skinModel.replace(
                          /(?:^([a-z])|_([a-z]))/g,
                          (match, a, b) => (a || b).toUpperCase()
                        );
                        let zipFileName = "";
                        let fileNames: string[] = [];

                        switch (modelType) {
                          case "player":
                            zipFileName = `zPlayerSkin-${skinName}.vl2`;
                            fileNames = modelTypes.player
                              .filter((modelName) =>
                                manifest.customSkins[modelName].includes(
                                  skinName
                                )
                              )
                              .map(
                                (modelName) => `${skinName}.${modelName}.png`
                              );
                            break;
                          case "weapon":
                            zipFileName = `zWeapon${camelCaseModelName}-${skinName}.vl2`;
                            fileNames = modelToFileList(skinModel).map(
                              (fileName) => `${skinName}/${fileName}`
                            );
                            break;
                          case "vehicle":
                            zipFileName = `z${camelCaseModelName}-${skinName}.vl2`;
                            fileNames = modelToFileList(skinModel).map(
                              (fileName) => `${skinName}/${fileName}`
                            );
                            break;
                        }
                        if (fileNames.length) {
                          const hasHiRes = fileNames.some(
                            (fileName) => manifest.sizeMultiplier[fileName] > 1
                          );

                          if (hasHiRes && hiResDownload === "prompt") {
                            window.alert(
                              "This download contains HD textures, which require the QoL patch. Select “yes” or “no” for HD support, then try again."
                            );
                            if (hiResSelectRef.current) {
                              hiResSelectRef.current.focus();
                            }
                            return;
                          }

                          const collectFileNames =
                            hiResDownload === "yes"
                              ? fileNames
                              : fileNames.map((fileName) => {
                                  return manifest.sizeMultiplier[fileName] > 1
                                    ? fileName.replace(/\.png$/, "@1x.png")
                                    : fileName;
                                });

                          if (hasHiRes && hiResDownload === "no") {
                            zipFileName = zipFileName.replace(
                              /\.vl2$/,
                              "@1x.vl2"
                            );
                          }

                          const files = await collectFiles(collectFileNames, {
                            skipNotFound: true,
                          });
                          const zip = createZipFile(
                            files.map(({ name, data }) => {
                              return {
                                name: name.split("/").slice(-1)[0],
                                data,
                              };
                            })
                          );
                          await saveZipFile(zip, zipFileName);
                        }
                      }}
                    >
                      <FaDownload />
                    </button>
                  </div>
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

export default function GalleryPage() {
  return (
    <Suspense>
      <Gallery />
    </Suspense>
  );
}

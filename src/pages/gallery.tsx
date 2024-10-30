import { useState } from "react";
import { CgSpinnerTwo } from "react-icons/cg";
import { FaChevronLeft, FaGithub } from "react-icons/fa";
import useManifest from "../useManifest";
import styles from "./gallery.module.css";
import Head from "next/head";
import Link from "next/link";

const baseManifestPath = `https://exogen.github.io/t2-skins`;
const emptySkins: string[] = [];

export default function GalleryPage() {
  const [manifest, isLoaded] = useManifest();
  const [selectedModel, setSelectedModel] = useState("lmale");
  const actualModel = selectedModel === "hfemale" ? "hmale" : selectedModel;
  const customSkins = manifest.customSkins?.[actualModel] ?? emptySkins;

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
              setSelectedModel(event.target.value);
            }}
            value={selectedModel}
          >
            <option value="lmale">Human Male &middot; Light</option>
            <option value="mmale">Human Male &middot; Medium</option>
            <option value="hmale">Human Male &middot; Heavy</option>
            <option value="lfemale">Human Female &middot; Light</option>
            <option value="mfemale">Human Female &middot; Medium</option>
            <option value="hfemale">Human Female &middot; Heavy</option>
            <option value="lbioderm">Bioderm &middot; Light</option>
            <option value="mbioderm">Bioderm &middot; Medium</option>
            <option value="hbioderm">Bioderm &middot; Heavy</option>
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
            {customSkins.map((name) => {
              return (
                <div key={name} className={styles.Skin}>
                  <img
                    className={styles.Preview}
                    loading="lazy"
                    src={`${baseManifestPath}/gallery/${encodeURIComponent(
                      name
                    )}.${actualModel}.webp`}
                    width={680}
                    height={800}
                    alt={name}
                  />
                  <div className={styles.Name}>{name}</div>
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

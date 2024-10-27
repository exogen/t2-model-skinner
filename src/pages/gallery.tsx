import { useState } from "react";
import useManifest from "../useManifest";
import styles from "./gallery.module.css";
import Head from "next/head";

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
          <select
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
        </div>
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
                />
                <div className={styles.Label}>{name}</div>
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}

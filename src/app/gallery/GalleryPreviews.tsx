import { memo, useMemo } from "react";
import Link from "next/link";
import { BsBadge3dFill } from "react-icons/bs";
import { FaDownload } from "react-icons/fa";
import { matchSorter } from "match-sorter";
import { SKIN_GALLERY_BASE_URL } from "../../deployPaths";
import type { DownloadTarget } from "./galleryDownloads";
import styles from "./gallery.module.css";

export type GallerySkin = { name: string; model: string };

type DownloadProps = {
  isDownloadBusy: boolean;
  onDownload: (target: DownloadTarget) => void;
};

const SkinPreview = memo(function SkinPreview({
  name, model, isDownloadBusy, onDownload,
}: GallerySkin & DownloadProps) {
  const encodedName = encodeURIComponent(name);
  return (
    <div className={styles.Skin}>
      <img
        className={styles.Preview}
        loading="lazy"
        src={`${SKIN_GALLERY_BASE_URL}/${encodedName}.${model}.webp`}
        width={680}
        height={800}
        alt={name}
      />
      <div className={styles.Detail}>
        <Link className={styles.LoadInEditor} href={`/?m=${model}&s=${encodedName}`} prefetch={false}>
          <BsBadge3dFill title="Load in Editor" aria-label="Load in Editor" />
        </Link>
        <span className={styles.Name}>{name}</span>
        <button
          type="button"
          className={styles.DownloadSkin}
          title={`Download ${name} skin`}
          aria-label={`Download ${name} skin`}
          disabled={isDownloadBusy}
          onClick={() => onDownload({ kind: "skin", name, model })}
        >
          <FaDownload />
        </button>
      </div>
    </div>
  );
});

// With stable props, urgent input updates can skip the entire grid. Filtering
// and reconciliation run when React renders the deferred query instead.
export default memo(function GalleryPreviews({
  skins, query, isDownloadBusy, onDownload,
}: { skins: GallerySkin[]; query: string } & DownloadProps) {
  const filteredSkins = useMemo(() => query.trim()
    ? matchSorter(skins, query, { keys: ["name"] })
    : skins, [skins, query]);

  return (
    <div className={styles.Gallery} aria-label="Skin previews">
      {filteredSkins.map(({ name, model }) => (
        <SkinPreview key={`${name}:${model}`} name={name} model={model}
          isDownloadBusy={isDownloadBusy} onDownload={onDownload} />
      ))}
      {!filteredSkins.length ? (
        <p className={styles.EmptyResults} role="status">No skins match these filters.</p>
      ) : null}
    </div>
  );
});

"use client";
import { useState } from "react";
import { FaDownload } from "react-icons/fa";
import Dialog from "../../Dialog";
import dialogStyles from "../../Dialog.module.css";
import { PLAYER_SKINS_RELEASE_BASE_URL } from "../../deployPaths";
import DownloadResolution from "./DownloadResolution";
import type { HdPreference } from "./galleryDownloads";
import styles from "./DownloadDialog.module.css";

export default function AllSkinsDownloadDialog({ hdPreference, onHdPreferenceChange, onClose }: {
  hdPreference: HdPreference;
  onHdPreferenceChange: (value: HdPreference) => void;
  onClose: () => void;
}) {
  const [resolution, setResolution] = useState(hdPreference);
  const buttonClass = `${dialogStyles.Button} ${dialogStyles.Primary}`;

  return (
    <Dialog title="All player skins" icon={<FaDownload role="img" aria-label="Download" />} onClose={onClose}>
      <div className={dialogStyles.Body}>
        <p className={styles.Description}>The latest full collection of player skins in one .vl2 file. Both versions include the same skins, with the SD release downscaling any HD skins.</p>
        <DownloadResolution value={resolution} onChange={(value) => {
          setResolution(value);
          onHdPreferenceChange(value);
        }} />
      </div>
      <footer className={dialogStyles.Footer}>
        <button type="button" className={dialogStyles.Button} onClick={onClose}>Cancel</button>
        {resolution === "prompt" ? (
          <button type="button" className={buttonClass} disabled><FaDownload aria-hidden="true" />Download .vl2</button>
        ) : (
          <a className={buttonClass}
            href={`${PLAYER_SKINS_RELEASE_BASE_URL}/zPlayerSkins-All${resolution === "yes" ? "-HD" : ""}.vl2`}
            onClick={onClose}>
            <FaDownload aria-hidden="true" />Download .vl2
          </a>
        )}
      </footer>
    </Dialog>
  );
}

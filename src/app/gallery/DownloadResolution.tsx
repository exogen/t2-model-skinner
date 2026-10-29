import type { HdPreference } from "./galleryDownloads";
import styles from "./DownloadDialog.module.css";

export default function DownloadResolution({
  value,
  onChange,
  disabled = false,
}: {
  value: HdPreference;
  onChange: (value: "yes" | "no") => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className={styles.Options} disabled={disabled}>
      <legend>Texture resolution</legend>
      <div className={styles.ResolutionChoices}>
        {(["no", "yes"] as const).map((resolution) => (
          <label className={styles.Choice} key={resolution}>
            <input
              type="radio"
              name="download-resolution"
              checked={value === resolution}
              onChange={() => onChange(resolution)}
            />
            <span>
              <strong>{resolution === "yes" ? "HD" : "Standard"}</strong>
              <small>
                {resolution === "yes"
                  ? "Requires the QoL patch"
                  : "Works with any T2 install"}
              </small>
            </span>
          </label>
        ))}
      </div>
      {value === "prompt" ? (
        <p className={styles.Hint}>Choose a resolution to continue.</p>
      ) : null}
    </fieldset>
  );
}

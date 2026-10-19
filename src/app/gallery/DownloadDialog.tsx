"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { FaCheck, FaDownload, FaExclamationTriangle } from "react-icons/fa";
import { CgSpinnerTwo } from "react-icons/cg";
import Dialog from "../../Dialog";
import DownloadResolution from "./DownloadResolution";
import dialogStyles from "../../Dialog.module.css";
import styles from "./DownloadDialog.module.css";
import { collectFiles, createZipFile, saveZipFile } from "../../exportUtils";
import type { Manifest } from "../../useManifest";
import { modelToModelType } from "../../models";
import { DownloadTarget, HdPreference, planDownload, weaponLabels, weaponSetModels } from "./galleryDownloads";

type Plan = ReturnType<typeof planDownload>;
type Preparation = {
  plan: Plan;
  resolution: HdPreference;
} & ({ error: string } | {
  files: Awaited<ReturnType<typeof collectFiles>>;
  models: string[];
  includesHiRes: boolean;
});
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Unable to prepare this download.";

function PlayerModels({ models }: { models: string[] }) {
  const hasMaleVariants = models.includes("lmale") || models.includes("mmale");
  const hasFemaleVariants = models.includes("lfemale") || models.includes("mfemale");
  const hasHeavyHuman = models.includes("hmale");

  return (
    <table className={styles.PlayerModels} aria-label="Included player models">
      <thead>
        <tr>
          <th scope="col" className={styles.ModelCount}>Models: <strong>{models.length.toLocaleString()}</strong></th>
          <th scope="col">Light</th>
          <th scope="col">Medium</th>
          <th scope="col">Heavy</th>
        </tr>
      </thead>
      <tbody>
        {(["Male", "Female", "Bioderm"] as const).map((label) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            {["l", "m", "h"].map((weight) => {
              // Assign the shared heavy texture to the genders represented by
              // light/medium variants, defaulting to male without female variants.
              const included = weight === "h" && label === "Male"
                ? hasHeavyHuman && (hasMaleVariants || !hasFemaleVariants)
                : weight === "h" && label === "Female"
                  ? hasHeavyHuman && hasFemaleVariants
                  : models.includes(`${weight}${label.toLowerCase()}`);
              const status = included ? "Included" : "Not included";
              return (
                <td key={weight} className={included ? styles.IncludedModel : styles.MissingModel}
                  aria-label={status} title={status}>
                  {included ? <FaCheck aria-hidden="true" /> : <span aria-hidden="true">—</span>}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function DownloadDialog({ target, manifest, hdPreference, onHdPreferenceChange, onClose }: {
  target: DownloadTarget;
  manifest: Manifest;
  hdPreference: HdPreference;
  onHdPreferenceChange: (value: HdPreference) => void;
  onClose: () => void;
}) {
  const [fullSet, setFullSet] = useState(false);
  const [resolution, setResolution] = useState(hdPreference);
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveController = useRef<AbortController | null>(null);
  const setModels = weaponSetModels(target, manifest);
  const { plan, planError } = useMemo(() => {
    try { return { plan: planDownload(target, fullSet, manifest), planError: null }; }
    catch (error) { return { plan: null, planError: errorMessage(error) }; }
  }, [target, fullSet, manifest]);
  const needsResolution = plan?.hasHiRes && resolution === "prompt";
  const current = preparation?.plan === plan && preparation?.resolution === resolution ? preparation : null;
  const ready = current && "files" in current ? current : null;
  const error = planError ?? saveError ?? (current && "error" in current ? current.error : null);
  const models = ready?.models ?? plan?.models ?? [];
  const isPlayerSkin = target.kind === "skin" && modelToModelType(target.model) === "player";
  const loading = !!plan && !needsResolution && !current;

  useEffect(() => () => saveController.current?.abort(), []);

  useEffect(() => {
    if (!plan || needsResolution) return;
    const controller = new AbortController();
    const fileNames = plan.fileNames.map((name) => resolution !== "yes" && manifest.sizeMultiplier[name] > 1
      ? name.replace(/\.png$/, "@1x.png") : name);
    void collectFiles(fileNames, { skipNotFound: plan.skipNotFound, signal: controller.signal })
      .then((files) => {
        if (controller.signal.aborted) return;
        if (!files.length) throw new Error("No skin files are available to download.");
        const available = new Set(files.map(({ name }) => name));
        setPreparation({ plan, resolution, files,
          models: plan.models.filter((model) => plan.filesByModel[model].some((file) => available.has(file))),
          includesHiRes: resolution === "yes" && files.some(({ name }) => manifest.sizeMultiplier[name] > 1),
        });
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setPreparation({ plan, resolution, error: errorMessage(error) });
        controller.abort();
      });
    return () => controller.abort();
  }, [plan, resolution, needsResolution, manifest, attempt]);

  const download = async () => {
    if (!ready || !plan || saveController.current) return;
    const controller = new AbortController();
    saveController.current = controller;
    setSaving(true);
    setSaveError(null);
    try {
      const files = target.kind === "pack" ? ready.files : ready.files.map(({ name, data }) => ({
        name: name.split("/").at(-1)!, data,
      }));
      const filename = plan.hasHiRes && resolution === "no"
        ? plan.zipFileName.replace(/\.vl2$/, "@1x.vl2") : plan.zipFileName;
      await saveZipFile(createZipFile(files), filename, { signal: controller.signal });
      if (!controller.signal.aborted) onClose();
    } catch (error) {
      if (!controller.signal.aborted) setSaveError(errorMessage(error));
    } finally {
      saveController.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  };

  return (
    <Dialog title={target.name} icon={<FaDownload role="img" aria-label="Download" />} onClose={onClose}>
      <div className={dialogStyles.Body}>
        {target.kind === "skin" && setModels.length > 1 ? (
          <fieldset className={styles.Options} disabled={saving}>
            <legend>What would you like to download?</legend>
            <div className={styles.Choices}>
              <label className={styles.Choice}>
                <input type="radio" name="weapon-scope" checked={!fullSet} onChange={() => { setFullSet(false); setSaveError(null); }} />
                <span><strong>{weaponLabels[target.model]} only</strong><small>Keep your other weapon skins</small></span>
              </label>
              <label className={styles.Choice}>
                <input type="radio" name="weapon-scope" checked={fullSet} onChange={() => { setFullSet(true); setSaveError(null); }} />
                <span><strong>Full weapon set</strong><small>{setModels.length} matching weapon skins</small></span>
              </label>
            </div>
          </fieldset>
        ) : null}

        {plan?.hasHiRes ? (
          <DownloadResolution value={resolution} disabled={saving}
            onChange={(value) => { setResolution(value); setSaveError(null); onHdPreferenceChange(value); }} />
        ) : null}

        <section className={styles.Summary} aria-label="Download contents">
          {isPlayerSkin ? <PlayerModels models={models} /> : null}
          <dl className={styles.SummaryFields}>
            {!isPlayerSkin ? (
              <div><dt>Models:</dt><dd><strong>{models.length.toLocaleString()}</strong>{models.length ? <span> ({models.join(", ")})</span> : null}</dd></div>
            ) : null}
            <div><dt>Files:</dt><dd>{ready ? ready.files.length.toLocaleString() : error || needsResolution ? "—" : "Checking…"}</dd></div>
            <div><dt>HD:</dt><dd>{needsResolution ? "Choose a resolution" :
              (ready?.includesHiRes ?? (plan?.hasHiRes && resolution === "yes")) ? "Yes (requires QoL patch)" : "No"}</dd></div>
          </dl>
        </section>
        {error ? (
          <div className={styles.Error} role="alert">
            <FaExclamationTriangle aria-hidden="true" /><div><strong>Unable to download</strong><p>{error}</p></div>
          </div>
        ) : null}
      </div>
      <footer className={dialogStyles.Footer}>
        <button type="button" className={dialogStyles.Button} onClick={onClose}>Cancel</button>
        {error ? (
          <button type="button" className={`${dialogStyles.Button} ${dialogStyles.Primary}`} disabled={!plan}
            onClick={() => { setSaveError(null); setPreparation(null); setAttempt((n) => n + 1); }}>Try again</button>
        ) : (
          <button type="button" className={`${dialogStyles.Button} ${dialogStyles.Primary} ${styles.DownloadAction}`}
            disabled={!ready || saving || !!needsResolution} onClick={download}>
            <span aria-live="polite" className={styles.DownloadActionLabel}>
              {loading || saving ? (
                <><CgSpinnerTwo className={styles.Spinner} aria-hidden="true" />Preparing…</>
              ) : (
                <><FaDownload aria-hidden="true" />Download .vl2</>
              )}
            </span>
          </button>
        )}
      </footer>
    </Dialog>
  );
}

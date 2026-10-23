import Select from "../Select";
import { useId } from "react";
import { BsCaretDownFill, BsPersonArmsUp } from "react-icons/bs";
import { useMocap } from "../MocapProvider";
import type { PoseTrackingSettings } from "./poseSettings";
import styles from "./MocapDebugPanel.module.css";

const confidenceControls = [
  ["minDetectionConfidence", "Detection"],
  ["minPresenceConfidence", "Presence"],
  ["minTrackingConfidence", "Tracking"],
] as const;

/** Opens and closes the pose debug panel, from the camera panel's toolbar. */
export function PoseDebugToggle({ open, onToggle, controls }: { open: boolean; onToggle: () => void; controls: string }) {
  return (
    <button type="button" className={styles.Toggle} aria-expanded={open} aria-controls={open ? controls : undefined} onClick={onToggle}>
      <BsPersonArmsUp size={16} aria-hidden="true" />
      Pose debug
      <BsCaretDownFill size={10} className={styles.Caret} aria-hidden="true" />
    </button>
  );
}

/** Tracking settings and performance, over the camera image. */
export default function MocapDebugPanel({ id: panelId }: { id?: string }) {
  const { tracking } = useMocap();
  const { settings, updateSettings, resetSettings, switching, stats } = tracking!;
  const id = useId();

  return (
    <div id={panelId} className={styles.Panel} role="group" aria-label="Pose debug">
      <div className={styles.Body}>
        <div className={styles.Field}>
          <label htmlFor={`${id}-model`}>Model quality</label>
          <Select
            id={`${id}-model`}
            value={settings.model}
            onChange={(value) => updateSettings({ model: value as PoseTrackingSettings["model"] })}
            options={[
              { value: "lite", label: "Lite" },
              { value: "full", label: "Full" },
            ]}
          />
          <p className={styles.Hint}>Full balances accuracy and speed. Try Lite on slower devices.</p>
        </div>

        <div className={styles.Field}>
          <label htmlFor={`${id}-smoothing`}>Rig smoothing</label>
          <Select
            id={`${id}-smoothing`}
            value={settings.smoothing}
            onChange={(value) => updateSettings({ smoothing: value as PoseTrackingSettings["smoothing"] })}
            options={[
              { value: "none", label: "No extra" },
              { value: "classic", label: "Original" },
              { value: "adaptive", label: "Adaptive" },
              { value: "stable", label: "Steady" },
            ]}
          />
        </div>

        <div className={styles.Field}>
          <label className={styles.Checkbox}>
            <input
              type="checkbox"
              checked={settings.handTracking}
              onChange={(event) => updateSettings({ handTracking: event.target.checked })}
            />
            Detailed hands
          </label>
          <p className={styles.Hint}>Track palms, thumbs, and finger curl. Turn off for faster tracking.</p>
        </div>

        <fieldset className={styles.Confidence}>
          <legend>Minimum confidence</legend>
          {confidenceControls.map(([key, label]) => (
            <div className={styles.Slider} key={key}>
              <label htmlFor={`${id}-${key}`}>
                {label} <output htmlFor={`${id}-${key}`}>{settings[key].toFixed(1)}</output>
              </label>
              <input
                id={`${id}-${key}`}
                type="range"
                min={0.1}
                max={0.9}
                step={0.1}
                value={settings[key]}
                onChange={(event) => updateSettings({ [key]: Number(event.target.value) })}
              />
            </div>
          ))}
          <p className={styles.Hint}>Higher values reject more uncertain poses.</p>
        </fieldset>

        <dl className={styles.Metrics} aria-label="Tracking performance" title="Frame time includes capture and worker processing. Initial frames also include model warm-up.">
          <div><dt>Tracking</dt><dd>{stats ? `${stats.fps.toFixed(1)} fps` : "—"}</dd></div>
          <div><dt>Frame time</dt><dd>{stats ? `${stats.frameMs.toFixed(1)} ms` : "—"}</dd></div>
          <div><dt>Body processing</dt><dd>{stats?.delegate ?? "—"}</dd></div>
          {settings.handTracking && <div><dt>Hand processing</dt><dd>{stats?.handDelegate ?? "—"}</dd></div>}
          <div><dt>Camera</dt><dd>{stats?.width && stats?.height ? `${stats.width} × ${stats.height}` : "—"}</dd></div>
        </dl>

        <div className={styles.Footer}>
          <span role="status">{switching ? "Switching…" : ""}</span>
          <button type="button" onClick={resetSettings} title="Restore Full model, adaptive smoothing, detailed hands, and 0.5 confidence">Reset defaults</button>
        </div>
      </div>
    </div>
  );
}

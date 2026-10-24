import { useCallback, useDeferredValue, useEffect, useId, useRef, useState, type MouseEvent, type RefObject } from "react";
import {
  Combobox, ComboboxItem, ComboboxItemCheck, ComboboxLabel, ComboboxList, ComboboxProvider, useComboboxStore,
  VisuallyHidden,
} from "@ariakit/react";
import { saveAs } from "file-saver";
import { matchSorter } from "match-sorter";
import { FiCamera, FiDownload, FiRotateCcw, FiX } from "react-icons/fi";
import { GrPauseFill, GrPlayFill, GrStopFill } from "react-icons/gr";
import Dialog from "../Dialog";
import dialogStyles from "../Dialog.module.css";
import { canvasBlob, imageFileName, skinLabel } from "../modelImage";
import { modelOptions } from "../modelOptions";
import Select, { type SelectGroup, type SelectOption } from "../Select";
import selectStyles from "../Select.module.css";
import useAsyncTask from "../useAsyncTask";
import useMessageDialog from "../useMessageDialog";
import useWarrior from "../useWarrior";
import { chooseMapBackground, chosenMapBackground, loadMapPictures, loadMaps, type MapEntry } from "./mapBackgrounds";
import { renderBoothStrip } from "./photos";
import type { TrackingStatus } from "./poseTracking";
import { formatTime, MAX_RECORDING_SECONDS, type Recording } from "./recording";
import { useActivityClock } from "./useActivityClock";
import { BOOTH_SHOTS, COUNTDOWN_SECONDS, type BoothNames, type PhotoStrip, type PlaybackState, type Recorder } from "./useRecorder";
import styles from "./RecorderControls.module.css";

const TIMELINE_STEP = 1 / 30;
// A capture button's action changes as soon as it's clicked, so the second
// click of a double-click would undo the first (Record, then Cancel).
const REPEAT_CLICK_MS = 400;

interface PhotoNames {
  skin: string;
  model: string;
  modelLabel: string;
}

/** Names the strip after the skin shown, like Save image does. */
function usePhotoNames(): PhotoNames {
  const { selectedSkin, selectedSkinType, selectedModel, selectedModelType } = useWarrior();
  const modelLabel = modelOptions.flatMap((group) => group.options)
    .find((option) => option.value === selectedModel)?.label ?? selectedModel;
  return {
    skin: skinLabel(selectedModelType, selectedSkinType, selectedSkin) || "Untitled skin",
    model: selectedModel,
    modelLabel,
  };
}

function boothNames({ skin, model, modelLabel }: PhotoNames): BoothNames {
  const date = new Date();
  // Player labels read like "Human Male • Light".
  const [modelName, armorClass] = modelLabel.split(" • ");
  return {
    caption: { skin, model: modelName, armor: armorClass ? `${armorClass} armor` : "" },
    fileName: imageFileName(skin, model, "Photo strip", date),
    alt: `Photo strip with ${BOOTH_SHOTS} poses of ${skin} on ${modelLabel}`,
  };
}

/** Record and Photo booth. Each button stays one element through its
 * states, so it keeps focus; numbers that tick are hidden from screen readers. */
export function CaptureControls({ recorder, status }: { recorder: Recorder; status: TrackingStatus }) {
  const { activity, attached, strip, failure, record, startBooth, stop, dismissStrip, dismissFailure } = recorder;
  const names = usePhotoNames();
  const { showMessage, messageDialog } = useMessageDialog();
  const { countdown, elapsed } = useActivityClock(activity);
  const lastClick = useRef(-Infinity);
  const cameraReady = status === "tracking" || status === "lost";
  const ready = attached && cameraReady;
  const unavailable = cameraReady ? "Available once the model has loaded" : "Available while the camera is tracking";
  const phase = activity?.phase;
  const recording = phase === "record-countdown" || phase === "recording";
  const booth = phase === "booth-countdown" || phase === "booth-hold" || phase === "developing";

  // The recorder keeps the failure, so a panel that remounted during the
  // booth (after a skin change, say) still shows it.
  useEffect(() => {
    if (!failure) return;
    showMessage(failure, "Unable to finish photo booth");
    dismissFailure();
  }, [failure, showMessage, dismissFailure]);

  const beginBooth = () => { void startBooth(boothNames(names), chosenMapBackground()); };
  const ignoreRepeats = (action: () => void) => () => {
    const now = performance.now();
    if (now - lastClick.current < REPEAT_CLICK_MS) return;
    lastClick.current = now;
    action();
  };

  return (
    <div role="group" aria-label="Capture" className={styles.Capture}>
      {phase === "record-countdown" ? (
        <button type="button" className={styles.Button} data-state="countdown"
          aria-label="Cancel recording" title="Cancel before recording starts" onClick={ignoreRepeats(stop)}>
          <FiX aria-hidden="true" />Cancel<span className={styles.Number} aria-hidden="true"> · {countdown}</span>
        </button>
      ) : phase === "recording" ? (
        <button type="button" className={styles.Button} data-state="recording"
          aria-label="Stop recording" title="Stop and keep the animation" onClick={ignoreRepeats(stop)}>
          <GrStopFill aria-hidden="true" />Stop<span className={styles.Number} aria-hidden="true"> · {formatTime(elapsed ?? 0)}</span>
        </button>
      ) : (
        <button type="button" className={styles.Button} data-state="idle" disabled={!ready || booth}
          title={!ready ? unavailable
            : booth ? "Available after the photo booth"
              : `Record your motion after a ${COUNTDOWN_SECONDS}-second countdown, up to ${MAX_RECORDING_SECONDS} seconds`}
          onClick={ignoreRepeats(() => void record())}>
          <span className={styles.RecordDot} aria-hidden="true" />Record
        </button>
      )}
      {phase === "booth-countdown" || phase === "booth-hold" ? (
        <button type="button" className={styles.Button} aria-label="Cancel photo booth" title="Cancel the photo booth"
          onClick={ignoreRepeats(stop)}>
          <FiX aria-hidden="true" />Cancel
          {phase === "booth-countdown" && <span className={styles.Number} aria-hidden="true"> · {countdown}</span>}
        </button>
      ) : phase === "developing" ? (
        <button type="button" className={styles.Button} aria-disabled="true" aria-label="Developing the photo strip">
          <FiCamera aria-hidden="true" />Developing…
        </button>
      ) : (
        <button type="button" className={styles.Button} disabled={!ready || recording}
          title={!ready ? unavailable
            : recording ? "Available after recording"
              : `Take ${BOOTH_SHOTS} photos, each after a countdown, and make a photo strip`}
          onClick={ignoreRepeats(beginBooth)}>
          <FiCamera aria-hidden="true" />Photo booth
        </button>
      )}
      {messageDialog}
      {strip && (
        <PhotoStripDialog
          strip={strip}
          canRetake={ready}
          onRetake={() => { dismissStrip(); beginBooth(); }}
          onDownload={(blob) => { saveAs(blob, strip.fileName); dismissStrip(); }}
          onClose={dismissStrip}
        />
      )}
    </div>
  );
}

type MapList = { status: "loading" | "ready" | "failed"; maps: readonly MapEntry[] };

/** The t2-maps gallery's maps, once they've loaded, and a way to try again
 * after the list failed. Loaded like the skin manifest (useManifest); the
 * list itself is fetched once per page load by loadMaps. */
function useMaps() {
  const [attempt, setAttempt] = useState(0);
  const [list, setList] = useState<MapList>({ status: "loading", maps: [] });
  const load = useAsyncTask(true);
  useEffect(() => {
    void load(() => loadMaps(), (maps) => setList({ status: "ready", maps })).catch((cause: unknown) => {
      setList({ status: "failed", maps: [] });
      console.error(cause);
    });
  }, [load, attempt]);
  const retry = useCallback(() => {
    setList({ status: "loading", maps: [] });
    setAttempt((count) => count + 1);
  }, []);
  return { ...list, retry };
}

/** The map chosen for the strip's background (null for the gradient) and the
 * strip as drawn, starting with the booth's. While the strip is being drawn
 * over a new choice, `pending` is set. A map whose screenshots don't load is
 * reported in `failed`, and the choice goes back to the one shown, so choosing
 * the map again tries again. */
function useStripBackground(strip: PhotoStrip) {
  const [choice, setChoice] = useState(chosenMapBackground);
  const [shown, setShown] = useState(() => ({
    blob: strip.blob, width: strip.width, height: strip.height, background: strip.background,
  }));
  const [failed, setFailed] = useState<string | null>(null);
  const pending = choice !== shown.background;
  const choose = useCallback((mission: string | null) => {
    setFailed(null);
    setChoice(mission);
    chooseMapBackground(mission);
  }, []);
  useEffect(() => {
    if (!pending) return;
    let stale = false;
    const showing = shown.background;
    void (async () => {
      const pictures = choice ? await loadMapPictures(choice, strip.frames.length) : [];
      if (stale) return;
      if (choice && !pictures.length) throw new Error("The map's screenshots didn't load.");
      const canvas = renderBoothStrip(strip.frames, strip.caption, strip.art, pictures);
      const blob = await canvasBlob(canvas);
      if (!stale) setShown({ blob, width: canvas.width, height: canvas.height, background: choice });
    })().catch(() => {
      if (stale) return;
      setFailed(choice);
      setChoice(showing);
      chooseMapBackground(showing);
    });
    return () => { stale = true; };
  }, [strip, choice, pending, shown.background]);
  return { choice, choose, shown, pending, failed };
}

/** The strip's background: a search box over a list of the gallery's maps,
 * always shown. Arrow keys move through the list while the search box keeps
 * focus, starting at the chosen map; Enter or a click chooses. */
function BackgroundPicker({ list: { status, maps, retry }, choice, onChoose }: {
  list: ReturnType<typeof useMaps>;
  choice: string | null;
  onChoose: (mission: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  // Clearing the search brings back every map, which takes a while to render,
  // so that waits. Narrowing it doesn't: Ariakit's autoSelect would mark an
  // item of the old list, and Enter would then choose nothing.
  const deferredSearch = useDeferredValue(search);
  const filter = search || deferredSearch;
  const chosen = choice ?? "";
  const store = useComboboxStore({
    // The list is always shown.
    open: true,
    value: search,
    setValue: setSearch,
    selectedValue: chosen,
    setSelectedValue: (value) => onChoose(value || null),
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Whether the last press in the box was a tap, with a finger or a pen.
  const tapRef = useRef(false);
  const chosenLabelId = useId();
  const options: SelectOption[] = [
    { value: "", label: "Default background" },
    ...maps.map(({ mission, label }) => ({ value: mission, label })),
  ];
  const matches = new Set(matchSorter(options, filter, { keys: ["label"] }));
  const chosenLabel = options.find((option) => option.value === chosen)?.label ?? chosen;
  const message = status === "loading" ? "Loading maps…"
    : status === "failed" ? "The map list couldn't load."
      : !matches.size ? "No matches" : "";

  // Scrolls the chosen map into the middle of the list once the list loads. A
  // list that loads before the strip's image has its size (one loaded for an
  // earlier strip) has no height yet, so that waits for one.
  useEffect(() => {
    const list = listRef.current;
    if (status !== "ready" || !list) return;
    const center = () => {
      const item = list.querySelector<HTMLElement>("[aria-selected='true']");
      if (!item) return;
      const top = item.getBoundingClientRect().top - list.getBoundingClientRect().top;
      list.scrollTop += top - (list.clientHeight - item.offsetHeight) / 2;
    };
    if (list.clientHeight) {
      center();
      return;
    }
    const observer = new ResizeObserver(() => {
      if (!list.clientHeight) return;
      observer.disconnect();
      // Not if the user has typed or scrolled in the meantime.
      if (!store.getState().inputValue && !list.scrollTop) center();
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [status, store]);

  // A tap would focus the map, which hands focus to the search box and opens
  // the on-screen keyboard. It still makes the map active, like a click.
  const keepFocusOnTap = (event: MouseEvent<HTMLElement>) => {
    if (!tapRef.current) return;
    event.preventDefault();
    store.setActiveId(event.currentTarget.id);
  };
  const chosenItem = () => store.getState().renderedItems.find((entry) => entry.value === chosen);
  // An arrow key pressed before the full list is back from clearing the
  // search moves to the chosen map once it's there.
  const arrowPending = useRef(false);
  useEffect(() => {
    if (!arrowPending.current) return;
    arrowPending.current = false;
    // Not if something was typed or made active in the meantime.
    if (filter || store.getState().activeId) return;
    const item = listRef.current?.querySelector<HTMLElement>("[aria-selected='true']");
    if (item) store.move(item.id);
  }, [filter, store]);

  return (
    <ComboboxProvider store={store}>
      <div className={styles.Backgrounds}>
        <ComboboxLabel className={styles.Label}>Background</ComboboxLabel>
        {/* The chosen background, read with the search box. */}
        <VisuallyHidden id={chosenLabelId}>{chosenLabel}</VisuallyHidden>
        <div className={styles.BackgroundBox}
          onPointerDown={(event) => { tapRef.current = event.pointerType !== "mouse"; }}>
          <div className={selectStyles.Search}>
            <Combobox
              ref={inputRef}
              autoSelect
              placeholder="Search maps…"
              aria-describedby={chosenLabelId}
              className={selectStyles.Input}
              onFocus={() => {
                // Arrow keys start at the chosen map, as in a native select.
                if (search || store.getState().activeId) return;
                const item = chosenItem();
                if (item) store.setActiveId(item.id);
              }}
              onKeyDown={(event) => {
                // Also after Escape, which leaves no map active.
                if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !search && !store.getState().activeId) {
                  const item = chosenItem();
                  // Until the full list is back, Ariakit would move within
                  // the old one, without the chosen map.
                  if (!item && !filter) return;
                  event.preventDefault();
                  if (item) store.move(item.id);
                  else arrowPending.current = true;
                }
                // Escape clears the search before it closes the dialog. The
                // map that matched would stay active, out of sight, and Enter
                // would choose it.
                if (event.key !== "Escape" || !search) return;
                event.preventDefault();
                setSearch("");
                store.setActiveId(null);
              }}
            />
          </div>
          <ComboboxList ref={listRef} alwaysVisible className={styles.BackgroundList}>
            {options.filter((option) => matches.has(option)).map((option) => (
              <ComboboxItem key={option.value} value={option.value} hideOnClick={false} setValueOnClick={false}
                // Ariakit marks only the active item, not the chosen one.
                aria-selected={option.value === chosen} className={selectStyles.Item} onMouseDown={keepFocusOnTap}>
                <ComboboxItemCheck className={selectStyles.Check} />
                <span>{option.label}</span>
              </ComboboxItem>
            ))}
          </ComboboxList>
          {/* Always there, so screen readers hear when its text changes. */}
          <p className={`${selectStyles.Empty} ${styles.Status}`} role="status">
            {message}
            {status === "failed" && <>
              {" "}
              <button type="button" className={styles.TextButton} onClick={(event) => {
                // The button goes away, which would leave focus nowhere. Not
                // after a tap, where the search box would open the on-screen
                // keyboard. A click from a key has no detail.
                if (!event.detail || !tapRef.current) inputRef.current?.focus();
                retry();
              }}>Try again</button>
            </>}
          </p>
        </div>
      </div>
    </ComboboxProvider>
  );
}

function PhotoStripDialog({ strip, canRetake, onRetake, onDownload, onClose }: {
  strip: PhotoStrip;
  canRetake: boolean;
  onRetake: () => void;
  onDownload: (blob: Blob) => void;
  onClose: () => void;
}) {
  const { choice, choose, shown, pending, failed } = useStripBackground(strip);
  const mapList = useMaps();
  const imageRef = useRef<HTMLImageElement>(null);
  const downloadRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(shown.blob);
    if (imageRef.current) imageRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [shown.blob]);
  // Runs after Dialog has opened, which would otherwise focus the close button.
  useEffect(() => { downloadRef.current?.focus(); }, []);
  const mapLabel = (mission: string) => mapList.maps.find((map) => map.mission === mission)?.label ?? mission;
  return (
    <Dialog title="Photo strip" icon={<FiCamera aria-hidden="true" />} onClose={onClose}>
      <div className={`${dialogStyles.Body} ${styles.StripBody}`}>
        <BackgroundPicker list={mapList} choice={choice} onChoose={choose} />
        <div className={styles.StripColumn}>
          <img ref={imageRef} className={styles.StripImage} width={shown.width} height={shown.height} alt={strip.alt}
            data-pending={pending || undefined} />
          {failed && <p className={styles.Hint} role="alert">{mapLabel(failed)}&apos;s screenshots couldn&apos;t load.</p>}
        </div>
      </div>
      <footer className={dialogStyles.Footer}>
        <button type="button" className={dialogStyles.Button} disabled={!canRetake} onClick={onRetake}>
          <FiRotateCcw className={styles.StripActionIcon} aria-hidden="true" />Retake
        </button>
        {/* Focusable while the strip is drawn, so it keeps the focus it gets
            when the dialog opens. */}
        <button type="button" ref={downloadRef} className={`${dialogStyles.Button} ${dialogStyles.Primary}`}
          aria-disabled={pending || undefined} onClick={() => { if (!pending) onDownload(shown.blob); }}>
          <FiDownload className={styles.StripActionIcon} aria-hidden="true" />{pending ? "Drawing…" : "Download"}
        </button>
      </footer>
    </Dialog>
  );
}

function playbackOptions(recordings: readonly Recording[]) {
  const options: (SelectOption | SelectGroup)[] = [{ value: "live", label: "Live camera" }];
  const groups = [
    { label: "Animations", kind: "recording" },
    { label: "Poses", kind: "pose" },
  ] as const;
  for (const { label, kind } of groups) {
    const entries = recordings.filter((entry) => entry.kind === kind);
    if (!entries.length) continue;
    options.push({
      label,
      options: entries.map((entry) => ({
        value: String(entry.id),
        label: kind === "recording" ? `${entry.label} · ${formatTime(Math.max(1, Math.round(entry.duration)))}` : entry.label,
      })),
    });
  }
  return options;
}

/** Choose the live camera or an animation or pose, and control playback. */
export function PlaybackControls({ recorder }: { recorder: Recorder }) {
  const { recordings, selected, paused, activity, playbackRef, select, setPaused, seek } = recorder;

  if (!recordings.length) return null;

  return (
    <div className={styles.Playback}>
      <label htmlFor="MocapPlayback" className={styles.Label}>Playback</label>
      <Select
        id="MocapPlayback"
        className={styles.PlaybackSelect}
        disabled={!!activity}
        value={selected ? String(selected.id) : "live"}
        onChange={(value) => select(value === "live" ? null : Number(value))}
        options={playbackOptions(recordings)}
      />
      {selected?.kind === "recording" && (
        <div className={styles.Transport}>
          <button type="button" className={`${styles.Button} ${styles.IconButton}`}
            aria-label={paused ? "Play animation" : "Pause animation"} onClick={() => setPaused(!paused)}>
            {paused ? <GrPlayFill aria-hidden="true" /> : <GrPauseFill aria-hidden="true" />}
          </button>
          <Timeline key={selected.id} recording={selected} playbackRef={playbackRef} paused={paused} seek={seek} />
        </div>
      )}
    </div>
  );
}

/** Follows the shared playback time by writing to the DOM directly, so
 * playback doesn't re-render React every frame. */
function Timeline({ recording, playbackRef, paused, seek }: {
  recording: Recording;
  playbackRef: RefObject<PlaybackState>;
  paused: boolean;
  seek: (seconds: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const spokenSecondRef = useRef(-1);

  const show = useCallback((fromInput = false) => {
    const input = inputRef.current;
    const readout = readoutRef.current;
    if (!input || !readout) return;
    const time = Math.min(playbackRef.current.time, recording.duration);
    const position = formatTime(time, true);
    const duration = formatTime(recording.duration, true);
    if (!fromInput) input.value = String(time);
    readout.textContent = `${position} / ${duration}`;
    // Screen readers hear the position at most once a second during playback.
    const second = Math.floor(time);
    if (fromInput || second !== spokenSecondRef.current) {
      spokenSecondRef.current = second;
      input.setAttribute("aria-valuetext", `${position} of ${duration}`);
    }
  }, [playbackRef, recording]);

  useEffect(() => {
    // Once paused, screen readers should hear the exact position.
    if (paused) spokenSecondRef.current = -1;
    show();
    if (paused) return;
    let frame = requestAnimationFrame(function update() {
      show();
      frame = requestAnimationFrame(update);
    });
    return () => cancelAnimationFrame(frame);
  }, [paused, show]);

  return (
    <>
      <input
        ref={inputRef}
        type="range"
        className={styles.Range}
        min={0}
        max={recording.duration}
        step={TIMELINE_STEP}
        defaultValue={0}
        aria-label="Playback position"
        onChange={(event) => {
          seek(event.currentTarget.valueAsNumber);
          show(true);
        }}
      />
      <span ref={readoutRef} className={styles.Time} aria-hidden="true" />
    </>
  );
}

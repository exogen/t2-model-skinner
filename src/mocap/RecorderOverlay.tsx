import { memo } from "react";
import { VisuallyHidden } from "@ariakit/react";
import { GrPauseFill, GrPlayFill } from "react-icons/gr";
import { formatTime, MAX_RECORDING_SECONDS, type Recording } from "./recording";
import { useActivityClock } from "./useActivityClock";
import { BOOTH_SHOTS, type RecorderActivity } from "./useRecorder";
import styles from "./RecorderOverlay.module.css";

function captionText(activity: RecorderActivity) {
  switch (activity.phase) {
    case "record-countdown": return "Recording starts in";
    case "booth-countdown": return `Photo ${activity.taken + 1} of ${BOOTH_SHOTS}`;
    case "booth-hold": return `Photo ${activity.taken} of ${BOOTH_SHOTS} taken`;
    case "developing": return "Developing photos…";
    default: return null;
  }
}

/** A white flash for each photo booth shot. */
function ShotFlash({ activity }: { activity: RecorderActivity | null }) {
  const taken = activity && "taken" in activity ? activity.taken : 0;
  // A new key replays the flash once per shot.
  return taken > 0 ? <div key={taken} className={styles.Flash} data-flash="" /> : null;
}

/** Countdowns, the recording badge and frame, and the shot flash, over the
 * camera preview. Never drawn into the WebGL canvas, so photos don't include
 * them. Screen readers get RecorderAnnouncer's messages instead. */
export default memo(function RecorderOverlay({ activity }: { activity: RecorderActivity | null }) {
  const { countdown, elapsed } = useActivityClock(activity);
  const caption = activity && captionText(activity);
  return (
    <div className={styles.Overlay} data-recording={activity?.phase === "recording" || undefined} aria-hidden="true">
      <ShotFlash activity={activity} />
      {activity && (
        <div className={styles.Hud}>
          {caption && <span className={styles.Caption}>{caption}</span>}
          {countdown !== null && <span key={countdown} className={styles.Digit}>{countdown}</span>}
          {elapsed !== null && (
            <span className={styles.Rec}>
              <span className={styles.RecDot} />
              REC {formatTime(elapsed)} / {formatTime(MAX_RECORDING_SECONDS)}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

/** Over the 3D view: the shot flash, and the name of the animation or pose
 * being played back. */
export const ViewerOverlay = memo(function ViewerOverlay({ activity, playback, paused }: {
  activity: RecorderActivity | null;
  playback: Pick<Recording, "kind" | "label"> | null;
  paused: boolean;
}) {
  return (
    <div className={styles.Overlay} data-placement="viewer" aria-hidden="true">
      <ShotFlash activity={activity} />
      {!activity && playback && (
        <span className={styles.Badge}>
          {playback.kind === "recording" && (paused ? <GrPauseFill /> : <GrPlayFill />)}
          {playback.label}
        </span>
      )}
    </div>
  );
});

/** The recorder's spoken messages, one per change. Rendered by the Controller,
 * which stays mounted, so messages sent while the camera panel hides (like
 * "Animation 2 saved" when the camera stops) are still read. */
export function RecorderAnnouncer({ announcement }: { announcement: { id: number; text: string } | null }) {
  return (
    <VisuallyHidden render={<p />} role="status">
      {/* A trailing no-break space on every other message makes a repeated
          message read again. A normal space would collapse. */}
      {announcement ? announcement.text + (announcement.id % 2 ? " " : "") : ""}
    </VisuallyHidden>
  );
}

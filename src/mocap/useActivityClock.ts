import { useLayoutEffect, useState } from "react";
import { MAX_RECORDING_SECONDS } from "./recording";
import type { RecorderActivity } from "./useRecorder";

// The clock is read in effects, never during render, and each value
// re-renders only when its whole second changes.

/** Whole seconds, and the milliseconds until they change (null to stop). */
type Tick = (time: number) => [seconds: number, delay: number | null];

/** Whole seconds left until `endsAt`. Stops at 1. */
const secondsLeft: Tick = (endsAt) => {
  const left = endsAt - performance.now();
  const next = Math.max(1, Math.ceil(left / 1000));
  return [next, next > 1 ? left - (next - 1) * 1000 : null];
};

/** Whole seconds since `startedAt`. */
const secondsSince: Tick = (startedAt) => {
  const elapsed = Math.max(0, performance.now() - startedAt);
  const whole = Math.floor(elapsed / 1000);
  return [whole, (whole + 1) * 1000 - elapsed];
};

/** `time` is a performance.now() time. */
function useWholeSeconds(time: number | null, tick: Tick) {
  const [seconds, setSeconds] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (time === null) {
      setSeconds(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const [next, delay] = tick(time);
      setSeconds(next);
      if (delay !== null) timer = setTimeout(update, delay);
    };
    update();
    return () => clearTimeout(timer);
  }, [time, tick]);
  return time === null ? null : seconds;
}

/** Whole seconds left in a countdown, and whole seconds recorded (up to
 * MAX_RECORDING_SECONDS). Each is null outside its phase. */
export function useActivityClock(activity: RecorderActivity | null) {
  const countdown = useWholeSeconds(
    activity && "endsAt" in activity ? activity.endsAt : null,
    secondsLeft,
  );
  const elapsed = useWholeSeconds(
    activity?.phase === "recording" ? activity.startedAt : null,
    secondsSince,
  );
  return {
    countdown,
    elapsed: elapsed === null ? null : Math.min(elapsed, MAX_RECORDING_SECONDS),
  };
}

import {
  createContext, ReactNode, useCallback, useContext, useEffect,
  useLayoutEffect, useRef, useState,
} from "react";
import { MdVideoCameraFront } from "react-icons/md";
import useWarrior from "./useWarrior";
// Type-only, so the shell never loads the runtime.
import type { MocapTracking } from "./mocap/MocapRuntime";
import styles from "./mocap.module.css";

type Tracking = MocapTracking;
type Runtime = typeof import("./mocap/MocapRuntime");

const MocapContext = createContext<{
  tracking: Tracking | null;
  runtime: Runtime | null;
  active: boolean;
  loading: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
} | null>(null);

export function useMocap() {
  const context = useContext(MocapContext);
  if (!context) throw new Error("No MocapProvider");
  return context;
}

// Keep this shell small: importing the editor must not import the tracker, rigs,
// preview, or their libraries. The camera button is the only runtime entry point.
export default function MocapProvider({ children }: { children: ReactNode }) {
  const { selectedModelType } = useWarrior();
  const player = selectedModelType === "player";
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);
  const [requestId, setRequestId] = useState(0);
  const runtimePromise = useRef<Promise<Runtime> | null>(null);
  const trackingRef = useRef<Tracking | null>(null);
  const generation = useRef(0);
  const intent = useRef(false);
  const mounted = useRef(false);
  const playerRef = useRef(player);

  const onTracking = useCallback((next: Tracking) => {
    trackingRef.current = next;
    setTracking(next);
  }, []);

  const stop = useCallback(() => {
    generation.current += 1;
    intent.current = false;
    setRequested(false);
    setLoading(false);
    setError(null);
    trackingRef.current?.stop();
  }, []);

  useLayoutEffect(() => {
    playerRef.current = player;
    if (!player) stop();
  }, [player, stop]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  const start = useCallback(async () => {
    if (!mounted.current || !playerRef.current) return;
    if (intent.current && trackingRef.current?.status !== "error") return;
    intent.current = true;
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      // A direct import inside this handler avoids route preloading of mocap.
      const pending = runtimePromise.current ?? import("./mocap/MocapRuntime");
      runtimePromise.current = pending;
      const loaded = await pending;
      if (!mounted.current || !playerRef.current || generation.current !== current) return;
      setRuntime(loaded);
      setRequested(true);
      setRequestId((id) => id + 1);
      setLoading(false);
    } catch {
      // A failed chunk can be retried without reloading or losing editor work.
      runtimePromise.current = null;
      if (!mounted.current || generation.current !== current) return;
      intent.current = false;
      setRequested(false);
      setLoading(false);
      setError("Motion tracking could not load. Try again.");
    }
  }, []);

  const active = player && (loading || (requested && !tracking)
    || (tracking !== null && tracking.status !== "idle" && tracking.status !== "error"));

  return (
    <MocapContext.Provider value={{ tracking, runtime, active, loading, error, start, stop }}>
      {runtime && <runtime.Controller onTracking={onTracking} requested={requested && player} requestId={requestId} />}
      {children}
    </MocapContext.Provider>
  );
}

export function LiveMocapControls() {
  const { tracking, loading, error, start, stop } = useMocap();
  const { selectedModelType } = useWarrior();
  if (selectedModelType !== "player") return null;
  const status = loading ? "loading" : tracking?.status ?? "idle";
  const message = error ?? tracking?.error ?? null;
  const active = status !== "idle" && status !== "error";

  return (
    <div className={styles.Controls}>
      <button
        type="button"
        className={styles.CameraButton}
        aria-label="Motion capture"
        title={active ? "Stop motion capture" : "Start motion capture"}
        aria-pressed={active}
        aria-controls="MocapPreview"
        onClick={active ? stop : start}
      >
        <MdVideoCameraFront aria-hidden="true" />
        <span className="ButtonText">Motion capture</span>
      </button>
      {message && <p className={styles.Error} role="alert">{message}</p>}
    </div>
  );
}

export function LiveMocapPreview() {
  const { runtime, tracking, active } = useMocap();
  if (runtime && tracking) return <runtime.Preview />;
  return active ? <div id="MocapPreview" className={styles.Loading} role="status">Loading motion tracking…</div> : null;
}

export function LiveMocapPose() {
  const { runtime, tracking } = useMocap();
  return runtime && tracking ? <runtime.Pose /> : null;
}

import { captureActivity } from "./captureActivity";
import { useLayoutEffect, useMemo, useRef } from "react";

interface Scope {
  pending: Set<AbortController>;
  closed: boolean;
  activity: ReturnType<typeof captureActivity.register>;
  error: unknown;
}

// Work belongs to the mounted owner and is aborted on unmount. With `latest`,
// starting a run aborts the previous ones; otherwise independent runs (like
// separate edits in the same session) may all complete. `cancel` aborts every
// pending run. Only asset initialization should retain capture errors: a failed
// command or import can leave the currently displayed document unchanged.
export default function useAsyncTask(
  latest = false,
  { captureErrors = false }: { captureErrors?: boolean } = {},
) {
  const scopeRef = useRef<Scope | null>(null);

  useLayoutEffect(() => {
    const scope: Scope = {
      pending: new Set(),
      closed: false,
      activity: captureActivity.register("Editor"),
      error: null,
    };
    scopeRef.current = scope;
    return () => {
      scope.closed = true;
      scope.activity.dispose();
      scope.pending.forEach((controller) => controller.abort());
      scope.pending.clear();
    };
  }, []);

  return useMemo(() => {
    async function run<T>(
      prepare: (signal: AbortSignal) => Promise<T>,
      commit: (value: T) => void,
      dispose?: (value: T) => void,
    ): Promise<boolean> {
      const scope = scopeRef.current;
      if (!scope || scope.closed) return false;
      if (latest) {
        scope.pending.forEach((controller) => controller.abort());
        scope.pending.clear();
      }
      const controller = new AbortController();
      scope.pending.add(controller);
      scope.error = null;
      scope.activity.update(scope.pending.size);
      const { signal } = controller;
      try {
        const value = await prepare(signal);
        if (signal.aborted) {
          dispose?.(value);
          return false;
        }
        commit(value);
        return true;
      } catch (error) {
        if (!signal.aborted) {
          if (captureErrors) scope.error = error;
          throw error;
        }
        return false;
      } finally {
        scope.pending.delete(controller);
        scope.activity.update(scope.pending.size, scope.error);
      }
    }

    run.cancel = () => {
      const scope = scopeRef.current;
      if (!scope) return;
      scope.pending.forEach((controller) => controller.abort());
      scope.pending.clear();
      scope.error = null;
      scope.activity.update(0);
    };
    return run;
  }, [latest, captureErrors]);
}

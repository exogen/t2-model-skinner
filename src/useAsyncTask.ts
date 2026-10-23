import { useLayoutEffect, useMemo, useRef } from "react";

interface Scope {
  pending: Set<AbortController>;
  closed: boolean;
}

// Work belongs to the mounted owner and is aborted on unmount. With `latest`,
// starting a run aborts the previous ones; otherwise independent runs (like
// separate edits in the same session) may all complete. `cancel` aborts every
// pending run.
export default function useAsyncTask(latest = false) {
  const scopeRef = useRef<Scope | null>(null);

  useLayoutEffect(() => {
    const scope: Scope = { pending: new Set(), closed: false };
    scopeRef.current = scope;
    return () => {
      scope.closed = true;
      scope.pending.forEach((controller) => controller.abort());
      scope.pending.clear();
    };
  }, []);

  return useMemo(() => {
    async function run<T>(
      prepare: (signal: AbortSignal) => Promise<T>,
      commit: (value: T) => void,
      dispose?: (value: T) => void
    ): Promise<boolean> {
      const scope = scopeRef.current;
      if (!scope || scope.closed) return false;
      if (latest) {
        scope.pending.forEach((controller) => controller.abort());
        scope.pending.clear();
      }
      const controller = new AbortController();
      scope.pending.add(controller);
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
        if (!signal.aborted) throw error;
        return false;
      } finally {
        scope.pending.delete(controller);
      }
    }

    run.cancel = () => {
      const scope = scopeRef.current;
      if (!scope) return;
      scope.pending.forEach((controller) => controller.abort());
      scope.pending.clear();
    };
    return run;
  }, [latest]);
}

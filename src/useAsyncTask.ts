import { useCallback, useLayoutEffect, useRef } from "react";

// Work belongs to the mounted owner. Preview/load callers can also discard
// superseded results; independent edits in the same session may all complete.
export default function useAsyncTask(latest = false) {
  const scopeRef = useRef<{
    controller: AbortController;
    revision: number;
  } | null>(null);

  useLayoutEffect(() => {
    const scope = { controller: new AbortController(), revision: 0 };
    scopeRef.current = scope;
    return () => scope.controller.abort();
  }, []);

  return useCallback(
    async <T>(
      prepare: (signal: AbortSignal) => Promise<T>,
      commit: (value: T) => void,
      dispose?: (value: T) => void
    ): Promise<boolean> => {
      const scope = scopeRef.current;
      if (!scope || scope.controller.signal.aborted) return false;
      const revision = ++scope.revision;
      const isCurrent = () =>
        !scope.controller.signal.aborted &&
        (!latest || scope.revision === revision);
      try {
        const value = await prepare(scope.controller.signal);
        if (!isCurrent()) {
          dispose?.(value);
          return false;
        }
        commit(value);
        return true;
      } catch (error) {
        if (isCurrent()) throw error;
        return false;
      }
    },
    [latest]
  );
}

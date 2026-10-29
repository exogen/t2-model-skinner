/** Pending work which can change the next exported image. Each mounted owner
 * removes its own entry on disposal, so cancelled sessions cannot stay busy. */
export function createCaptureActivity() {
  const entries = new Map<
    object,
    { label: string; pending: number; error: string | null }
  >();
  let revision = 0;
  return {
    register(label: string) {
      const key = {};
      const entry = { label, pending: 0, error: null as string | null };
      entries.set(key, entry);
      revision++;
      return {
        update(pending: number, error: unknown = null) {
          if (!entries.has(key)) return;
          const message =
            error == null
              ? null
              : error instanceof Error
                ? error.message
                : String(error);
          if (entry.pending === pending && entry.error === message) return;
          entry.pending = pending;
          entry.error = message;
          revision++;
        },
        dispose() {
          if (entries.delete(key)) revision++;
        },
      };
    },
    snapshot() {
      return {
        revision,
        pending: Array.from(entries.values()).reduce(
          (sum, entry) => sum + entry.pending,
          0,
        ),
        errors: Array.from(entries.values()).flatMap((entry) =>
          entry.error ? [`${entry.label}: ${entry.error}`] : [],
        ),
      };
    },
  };
}

export const captureActivity = createCaptureActivity();

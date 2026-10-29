// Tasks Vision 1.1.1 sends usage metrics through fetch, with no public opt-out.
// This worker only needs our hosted model and WASM. Keep its network local to
// this origin without changing fetch for the editor or other workers.
export function sameOriginFetch(
  nativeFetch: typeof fetch,
  workerUrl: string,
): typeof fetch {
  const workerLocation = new URL(workerUrl);
  const base =
    workerLocation.protocol === "blob:"
      ? `${workerLocation.origin}/`
      : workerLocation.href;
  return async (input, init) => {
    const isRequest = input instanceof Request;
    const url = new URL(isRequest ? input.url : String(input), base);
    if (url.origin !== workerLocation.origin) {
      // The pinned runtime catches this and disables its metrics logger.
      throw new TypeError(
        "Cross-origin requests are disabled in the motion tracking worker",
      );
    }
    return nativeFetch(isRequest ? input : url.href, {
      ...init,
      redirect: "error",
    });
  };
}

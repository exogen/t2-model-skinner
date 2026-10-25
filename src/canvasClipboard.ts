import type { Canvas } from "fabric";
import {
  blobToDataUrl,
  ImageError,
  imageTooBig,
  maxImageBytes,
  readImageFile,
  unreadableImage,
} from "./importUtils";
import { canvasBlob } from "./modelImage";

const CLIP_ATTRIBUTE = "data-t2-skinner-clip";

const TEXT_ENTRY = [
  "textarea",
  '[contenteditable]:not([contenteditable="false"])',
  "input:not([type])",
  ...["text", "search", "url", "tel", "email", "password", "number"].map(
    (type) => `input[type="${type}"]`
  ),
].join(", ");

/** Layers copied in this tab. Other apps and tabs get a flattened PNG; the
 * layers themselves stay here, named by a token in the copied HTML. */
export interface CanvasClip {
  id: string;
  objects: Record<string, unknown>[];
  sizeMultiplier: number;
  baseSize: [number, number];
  // Pastes so far on each canvas, to offset repeated pastes.
  pastes: WeakMap<Canvas, number>;
}

export type CanvasClipboard = ReturnType<typeof createCanvasClipboard>;

export function createCanvasClipboard() {
  let clip: CanvasClip | null = null;
  // Whether our system clipboard write for the clip finished, and whether
  // anything else might have written the clipboard since.
  let write: "pending" | "written" | "failed" = "pending";
  let replaced = false;
  return {
    get clip() {
      return clip;
    },
    set(next: Omit<CanvasClip, "id">) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const id = Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("");
      clip = { ...next, id };
      write = "pending";
      replaced = false;
      return clip;
    },
    track(id: string, written: Promise<boolean>) {
      void written.then((ok) => {
        if (clip?.id === id) write = ok ? "written" : "failed";
      });
    },
    markReplaced() {
      replaced = true;
    },
    /** Whether a paste holds our last copy: its HTML has the token. While our
     * write is pending, or if it failed, a paste counts as the copy unless
     * something else may have written the clipboard since. */
    holds(html: string) {
      if (!clip) return false;
      return (
        new RegExp(`${CLIP_ATTRIBUTE}=["']?${clip.id}\\b`).test(html) ||
        (write !== "written" && !replaced)
      );
    },
  };
}

export function isTextEntry(target: EventTarget | null) {
  return Boolean((target as Element | null)?.closest?.(TEXT_ENTRY));
}

// Apps that prefer HTML over images, like word processors, get the image too.
function clipHtml(id: string, src: string | null) {
  return src
    ? `<img src="${src}" ${CLIP_ATTRIBUTE}="${id}">`
    : `<span ${CLIP_ATTRIBUTE}="${id}"></span>`;
}

/** Puts a copy on the system clipboard during a copy or cut event: a PNG for
 * other apps, and HTML with the token that identifies it when pasted here.
 * Resolves to whether the write succeeded. */
export function writeClip(
  event: ClipboardEvent,
  id: string,
  image: HTMLCanvasElement | null
): Promise<boolean> {
  event.preventDefault();
  if (typeof ClipboardItem === "function" && navigator.clipboard?.write) {
    // Safari loses user activation at the first await, so start the write
    // now and let the item resolve its data. Calling setData() as well would
    // cancel this write in Safari and Firefox.
    const png = image ? canvasBlob(image) : null;
    const html = (png ? png.then(blobToDataUrl) : Promise.resolve(null)).then(
      (src) => new Blob([clipHtml(id, src)], { type: "text/html" })
    );
    try {
      const item = new ClipboardItem(
        png ? { "image/png": png, "text/html": html } : { "text/html": html }
      );
      return navigator.clipboard.write([item]).then(
        () => true,
        () => false
      );
    } catch {
      return Promise.resolve(false);
    }
  }
  if (!event.clipboardData) return Promise.resolve(false);
  event.clipboardData.setData(
    "text/html",
    clipHtml(id, image?.toDataURL("image/png") ?? null)
  );
  return Promise.resolve(true);
}

/** Reads a paste event's data. Browsers clear it once the event returns. */
export function readPaste(data: DataTransfer) {
  return {
    files: Array.from(data.files ?? []),
    html: data.getData("text/html"),
    text: data.getData("text/plain"),
  };
}

// Pasted links are downloaded only if they end in an image file name.
const IMAGE_LINK = /^https:\/\/\S+\.(?:png|jpe?g|gif|webp|bmp|svg)(?:[?#]\S*)?$/i;

const imageTypes = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/svg+xml",
];

const downloadFailed =
  "The pasted image couldn't be downloaded. Save it, then add the file.";

/** An image in pasted text: SVG markup, a data URL, or a link to an image.
 * Other pasted content, like a copied web page, is left alone. */
export function findImageUrl(text: string) {
  const value = text.trim();
  // SVG text may start with an XML declaration, comments or a doctype.
  if (value.startsWith("<") && /<\/svg>$/i.test(value)) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(value)}`;
  }
  if (/^data:image\/[^\s]+$/i.test(value) || IMAGE_LINK.test(value)) {
    return value;
  }
  return null;
}

function dataUrlBlob(url: string) {
  const match = /^data:([^,]*?)(;base64)?,/i.exec(url);
  if (!match) throw new ImageError(unreadableImage);
  const data = url.slice(match[0].length);
  if (data.length * (match[2] ? 0.75 : 1) > maxImageBytes) {
    throw new ImageError(imageTooBig);
  }
  try {
    const bytes = match[2]
      ? Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(data));
    return new Blob([bytes], { type: match[1].split(";")[0] });
  } catch (error) {
    throw new ImageError(unreadableImage, { cause: error });
  }
}

// Stops a download once it passes the size limit.
async function readResponse(response: Response, type: string) {
  if (Number(response.headers.get("content-length")) > maxImageBytes) {
    throw new ImageError(imageTooBig);
  }
  if (!response.body) throw new Error("Empty response");
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return new Blob(chunks, { type });
    size += value.byteLength;
    if (size > maxImageBytes) {
      void reader.cancel();
      throw new ImageError(imageTooBig);
    }
    chunks.push(value);
  }
}

/** Reads a pasted image URL into a data URL for a layer. Links are
 * downloaded without cookies or a referrer, and only if the server says it's
 * an image. Either way, the image must pass the same checks as a file. */
export async function loadImageUrl(url: string) {
  if (/^data:/i.test(url)) return readImageFile(dataUrlBlob(url));
  let blob;
  try {
    const response = await fetch(url, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(10_000),
    });
    const type = response.headers
      .get("content-type")
      ?.split(";")[0]
      .trim()
      .toLowerCase();
    if (!response.ok || !type || !imageTypes.includes(type)) {
      throw new Error(`Not an image: ${url}`);
    }
    blob = await readResponse(response, type);
  } catch (error) {
    if (error instanceof ImageError) throw error;
    throw new ImageError(downloadFailed, { cause: error });
  }
  return readImageFile(blob, new URL(url).pathname);
}

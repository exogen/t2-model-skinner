import type Viewer from "./Viewer";
import { getLocalProject } from "./localProjects";

/** The skin's name as the Skin dropdown shows it, without the ✨ it adds to
 * new skins. */
export function skinLabel(
  modelType: string | undefined,
  skinType: string | null,
  skin: string | null,
) {
  if (skinType === "local") return getLocalProject(skin)?.name ?? "";
  if (skin === "__untitled__") return "Untitled Imported Skin";
  if (skinType === "default" && modelType !== "player") return "Default";
  return skin ?? "";
}

/** Like "Blood Eagle - lmale - Pose 2 - 2026-10-20 14-03-05.png", in local
 * time. Texture exports use "NAME.MODEL.png", which this never matches. */
export function imageFileName(
  skin: string,
  model: string,
  subject: string | null,
  date: Date,
) {
  // Array.from splits by code point, so the cut can't land inside an emoji.
  const name =
    Array.from(skin.replace(/\s+/g, " ").trim(), (character) =>
      character < " " || '\\/:*?"<>|'.includes(character) ? "-" : character,
    )
      .slice(0, 60)
      .join("")
      .trim() || "Untitled skin";
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return (
    [name, model, subject, `${day} ${time}`].filter(Boolean).join(" - ") +
    ".png"
  );
}

export function canvasBlob(
  canvas: HTMLCanvasElement,
  type = "image/png",
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The image could not be encoded."));
      },
      type,
      quality,
    );
  });
}

/** A copy of `canvas` cut down to the pixels that aren't fully transparent,
 * with `margin` transparent pixels around them. Null if every pixel is
 * transparent. */
export function trimTransparent(canvas: HTMLCanvasElement, margin = 0) {
  const { width, height } = canvas;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The image could not be read.");
  const { data } = context.getImageData(0, 0, width, height);
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (!data[row + x * 4 + 3]) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      bottom = y;
    }
  }
  if (right < 0) return null;
  const trimmed = document.createElement("canvas");
  trimmed.width = right - left + 1 + 2 * margin;
  trimmed.height = bottom - top + 1 + 2 * margin;
  const output = trimmed.getContext("2d");
  if (!output) throw new Error("Could not create an image.");
  output.drawImage(
    canvas,
    left,
    top,
    right - left + 1,
    bottom - top + 1,
    margin,
    margin,
    right - left + 1,
    bottom - top + 1,
  );
  return trimmed;
}

/** Shared by the Save image button and gallery automation. */
export async function exportModelImage(
  viewer: Pick<Viewer, "captureFrame">,
  {
    type = "image/png",
    quality,
    trim = true,
  }: {
    type?: "image/png" | "image/webp";
    quality?: number;
    trim?: boolean;
  } = {},
) {
  const frame = await viewer.captureFrame({ background: false });
  const image = trim ? trimTransparent(frame, 8) : frame;
  if (!image)
    throw new Error("The model is out of view, so there is nothing to save.");
  return canvasBlob(image, type, quality);
}

export interface VideoRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The area a video covers inside a box with `object-fit: contain`. */
export function containedVideoRect(
  width: number,
  height: number,
  videoWidth: number,
  videoHeight: number,
): VideoRect | null {
  if (![width, height, videoWidth, videoHeight].every((value) => Number.isFinite(value) && value > 0)) {
    return null;
  }
  const scale = Math.min(width / videoWidth, height / videoHeight);
  const fittedWidth = videoWidth * scale;
  const fittedHeight = videoHeight * scale;
  return {
    x: (width - fittedWidth) / 2,
    y: (height - fittedHeight) / 2,
    width: fittedWidth,
    height: fittedHeight,
  };
}

/** The canvas pixels `rect` covers, given in CSS pixels from the top left:
 * each edge scaled by `pixelRatio` and rounded, clamped to the canvas. */
export function pixelBox(rect: VideoRect, pixelRatio: number, canvasWidth: number, canvasHeight: number): VideoRect {
  const left = Math.max(0, Math.round(rect.x * pixelRatio));
  const top = Math.max(0, Math.round(rect.y * pixelRatio));
  const right = Math.min(canvasWidth, Math.round((rect.x + rect.width) * pixelRatio));
  const bottom = Math.min(canvasHeight, Math.round((rect.y + rect.height) * pixelRatio));
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

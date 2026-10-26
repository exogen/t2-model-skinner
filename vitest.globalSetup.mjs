import { createCanvas } from "canvas";

// Laying out text with node-canvas for the first time builds fontconfig's font
// cache. On a fresh machine, like a CI runner, test workers that do it at the
// same time all build it at once and stall, so build it once here before they
// start.
export default function setup() {
  createCanvas(1, 1).getContext("2d").measureText("a");
}

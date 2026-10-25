import { BufferAttribute, BufferGeometry, Color } from "three";

export type RenderMode = "skin" | "random" | "wireframe";

export const renderModeOptions: { value: RenderMode; label: string }[] = [
  { value: "skin", label: "Skin" },
  { value: "random", label: "Random Colors" },
  { value: "wireframe", label: "Wireframe" },
];

// Each step turns the hue by the golden ratio, so triangles next to each other
// in the index buffer, which are usually next to each other on the model, get
// very different hues. Saturation and lightness stay fixed so every color is
// bright.
const GOLDEN_RATIO = 0.618033988749895;
const SATURATION = 1;
const LIGHTNESS = 0.45;

export function triangleHue(triangle: number, seed = 0) {
  return (seed + triangle * GOLDEN_RATIO) % 1;
}

/** A copy of `geometry` where every triangle has its own vertices, all three
 * in that triangle's color. Skinning, morph targets and groups are kept. */
export function randomColorGeometry(geometry: BufferGeometry, seed = 0) {
  const copy = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const count = copy.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const color = new Color();
  for (let vertex = 0; vertex < count; vertex += 3) {
    color.setHSL(triangleHue(vertex / 3, seed), SATURATION, LIGHTNESS);
    for (let corner = 0; corner < 3 && vertex + corner < count; corner++) {
      color.toArray(colors, (vertex + corner) * 3);
    }
  }
  copy.setAttribute("color", new BufferAttribute(colors, 3));
  return copy;
}

import { Buffer } from "node:buffer";
import { expect, test } from "vitest";
import { PNG } from "pngjs";
import {
  combineColorAndAlphaImageUrls,
  convertArrayBufferAlphaToGrayscale,
  convertGrayscaleImageUrlToMetallicRoughness,
  removeAlphaFromArrayBuffer,
} from "./imageUtils";

function read(url) {
  return PNG.sync.read(Buffer.from(url.split(",")[1], "base64"));
}

test.each([[1024, 1024], [2048, 1024]])(
  "real color/metallic conversion preserves HD %i × %i pixels and alpha",
  async (width, height) => {
    const source = new PNG({ width, height });
    for (let i = 0; i < source.data.length; i += 4) {
      source.data.set([i % 251, (i + 73) % 251, (i + 121) % 251, (i / 4) % 256], i);
    }
    const bytes = PNG.sync.write(source);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const [color, metallic] = await Promise.all([
      removeAlphaFromArrayBuffer(buffer),
      convertArrayBufferAlphaToGrayscale(buffer),
    ]);
    const grayscale = read(metallic);
    const preview = read(await convertGrayscaleImageUrlToMetallicRoughness(metallic));
    const exported = read(await combineColorAndAlphaImageUrls({
      colorImageUrl: color, metallicImageUrl: metallic,
    }));
    for (const output of [read(color), grayscale, preview, exported]) {
      expect([output.width, output.height]).toEqual([width, height]);
    }
    for (const pixel of [0, 1, 64, 127, 255, width + 10, width * height - 1]) {
      const offset = pixel * 4;
      const alpha = source.data[offset + 3];
      expect([...grayscale.data.subarray(offset, offset + 4)]).toEqual([alpha, alpha, alpha, 255]);
      expect(preview.data[offset + 2]).toBe(alpha ? Math.min(alpha + 64, 255) : 0);
    }
    // Zero alpha is deliberately clamped to 1 for the game's metallic format.
    for (let i = 3; i < source.data.length; i += 4) {
      source.data[i] = Math.max(1, source.data[i]);
    }
    expect(exported.data.equals(source.data)).toBe(true);
  },
  15000
);

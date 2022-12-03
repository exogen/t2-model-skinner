import { PNG } from "pngjs/browser";
import getStream from "get-stream";

export function arrayBufferToBase64(arrayBuffer: ArrayBuffer) {
  let base64 = "";
  const encodings =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  const bytes = new Uint8Array(arrayBuffer);
  const byteLength = bytes.byteLength;
  const byteRemainder = byteLength % 3;
  const mainLength = byteLength - byteRemainder;

  let a, b, c, d;
  let chunk;

  // Main loop deals with bytes in chunks of 3
  for (let i = 0; i < mainLength; i = i + 3) {
    // Combine the three bytes into a single integer
    chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];

    // Use bitmasks to extract 6-bit segments from the triplet
    a = (chunk & 16515072) >> 18; // 16515072 = (2^6 - 1) << 18
    b = (chunk & 258048) >> 12; // 258048 = (2^6 - 1) << 12
    c = (chunk & 4032) >> 6; // 4032 = (2^6 - 1) << 6
    d = chunk & 63; // 63 = 2^6 - 1

    // Convert the raw binary segments to the appropriate ASCII encoding
    base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d];
  }

  // Deal with the remaining bytes and padding
  if (byteRemainder == 1) {
    chunk = bytes[mainLength];

    a = (chunk & 252) >> 2; // 252 = (2^6 - 1) << 2

    // Set the 4 least significant bits to zero
    b = (chunk & 3) << 4; // 3   = 2^2 - 1

    base64 += encodings[a] + encodings[b] + "==";
  } else if (byteRemainder == 2) {
    chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];

    a = (chunk & 64512) >> 10; // 64512 = (2^6 - 1) << 10
    b = (chunk & 1008) >> 4; // 1008 = (2^6 - 1) << 4

    // Set the 2 least significant bits to zero
    c = (chunk & 15) << 2; // 15 = 2^4 - 1

    base64 += encodings[a] + encodings[b] + encodings[c] + "=";
  }

  return base64;
}

export async function rgbaToArrayBuffer(
  rgba: Uint8Array,
  {
    width,
    height,
  }: {
    width: number;
    height: number;
  }
) {
  const png = new PNG({
    width,
    height,
    inputHasAlpha: true,
  });
  png.data = rgba;
  png.pack();
  const arrayBuffer = await getStream.buffer(png);
  return arrayBuffer;
}

export function arrayBufferToImageUrl(arrayBuffer: ArrayBuffer) {
  const base64 = arrayBufferToBase64(arrayBuffer);
  return `data:image/png;base64,${base64}`;
}

export async function imageUrlToArrayBuffer(url: string) {
  const response = await fetch(url);
  if (response.ok) {
    const arrayBuffer = await response.arrayBuffer();
    return arrayBuffer;
  } else {
    throw new Error(`Failed to load image URL: ${url}`);
  }
}

export async function arrayBufferToRgba(arrayBuffer: ArrayBuffer) {
  const png = await new Promise<PNG>((resolve, reject) =>
    new PNG().parse(arrayBuffer, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    })
  );
  return { rgba: png.data, width: png.width, height: png.height };
}

export async function setGrayscaleFromAlpha(rgba: Uint8Array) {
  const length = rgba.length;
  for (let i = 0; i < length; i += 4) {
    const alpha = rgba[i + 3];
    rgba[i] = alpha;
    rgba[i + 1] = alpha;
    rgba[i + 2] = alpha;
    rgba[i + 3] = 255;
  }
}

export async function setAlphaFromGrayscale(
  rgba: Uint8Array,
  grayscaleRgba: Uint8Array
) {
  const length = rgba.length;
  // Modify image to map white pixels on the metallic canvas
  // to the alpha channel.
  for (let i = 0; i < length; i += 4) {
    rgba[i + 3] = Math.max(1, grayscaleRgba[i]);
  }
}

export async function setAlphaToMax(rgba: Uint8Array) {
  const length = rgba.length;
  for (let i = 0; i < length; i += 4) {
    rgba[i + 3] = 255;
  }
}

export function setMetallicFromGrayscale(rgba: Uint8Array) {
  const length = rgba.length;
  for (let i = 0; i < length; i += 4) {
    const grayscale = rgba[i];
    // Red meanings nothing, set to 0.
    rgba[i] = 0;
    // Green maps to roughness. We want more metallic to be less rough.
    rgba[i + 1] = 255 - grayscale;
    // Blue and alpha values should already be correct.
  }
}

export async function imageUrlToRgba(imageUrl: string) {
  const arrayBuffer = await imageUrlToArrayBuffer(imageUrl);
  const { rgba, width, height } = await arrayBufferToRgba(arrayBuffer);
  return { rgba, width, height };
}

type ImageSize = {
  width: number;
  height: number;
};

export async function rgbaToImageUrl(
  rgba: Uint8Array,
  { width, height }: ImageSize
) {
  const arrayBuffer = await rgbaToArrayBuffer(rgba, {
    width,
    height,
  });
  const imageUrl = arrayBufferToImageUrl(arrayBuffer);
  return imageUrl;
}

export async function combineColorAndAlphaImageUrls({
  colorImageUrl,
  metallicImageUrl,
}: {
  colorImageUrl: string;
  metallicImageUrl: string;
}) {
  const [{ rgba, width, height }, { rgba: metallicRgba }] = await Promise.all([
    imageUrlToRgba(colorImageUrl),
    imageUrlToRgba(metallicImageUrl),
  ]);
  setAlphaFromGrayscale(rgba, metallicRgba);
  const outputImageUrl = await rgbaToImageUrl(rgba, { width, height });
  return outputImageUrl;
}

export async function removeAlphaFromArrayBuffer(arrayBuffer: ArrayBuffer) {
  const { rgba, width, height } = await arrayBufferToRgba(arrayBuffer);
  setAlphaToMax(rgba);
  const outputImageUrl = await rgbaToImageUrl(rgba, { width, height });
  return outputImageUrl;
}

export async function convertArrayBufferAlphaToGrayscale(
  arrayBuffer: ArrayBuffer
) {
  const { rgba, width, height } = await arrayBufferToRgba(arrayBuffer);
  setGrayscaleFromAlpha(rgba);
  const outputImageUrl = await rgbaToImageUrl(rgba, { width, height });
  return outputImageUrl;
}

export async function convertGrayscaleImageUrlToMetallicRoughness(
  imageUrl: string
) {
  const { rgba, width, height } = await imageUrlToRgba(imageUrl);
  setMetallicFromGrayscale(rgba);
  const outputImageUrl = await rgbaToImageUrl(rgba, { width, height });
  return outputImageUrl;
}

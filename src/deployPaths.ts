export const SKIN_ASSET_BASE_URL = `https://assets.tribes2.online/skins/files`;
export const SKIN_MANIFEST_URL = `https://assets.tribes2.online/skins/manifest.json`;
export const SKIN_GALLERY_BASE_URL = `https://assets.tribes2.online/skins/gallery`;

// Only encode raw filenames here, preserving directory separators.
// Complete URLs (including data URLs from imports) must be used as-is.
function encodeAssetPath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function getSkinAssetUrl(fileName: string) {
  return `${SKIN_ASSET_BASE_URL}/${encodeAssetPath(fileName)}`;
}

export function getLocalAssetUrl(basePath: string, fileName: string) {
  return `${basePath}/${encodeAssetPath(fileName)}`;
}

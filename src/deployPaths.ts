export const SKIN_ASSET_BASE_URL = `https://assets.tribes2.online/skins/files`;
export const SKIN_MANIFEST_URL = `https://assets.tribes2.online/skins/manifest.json`;
export const SKIN_GALLERY_BASE_URL = `https://assets.tribes2.online/skins/gallery`;
export const PLAYER_SKINS_RELEASE_BASE_URL =
  "https://github.com/exogen/t2-skins/releases/latest/download";
// The path the app is served under, set for GitHub Pages builds.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

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

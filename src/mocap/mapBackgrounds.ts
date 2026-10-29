// Photo booth backgrounds from the t2-maps gallery
// (https://exogen.github.io/t2-maps/): screenshots of every map, the same
// art t2-mapper shows on its demo cards.

import { loadImage } from "./photos";

const GALLERY_URL = "https://exogen.github.io/t2-maps";
const MAPS_URL = `${GALLERY_URL}/missions.json`;
// Screenshots kept loaded, for switching back and forth in the strip dialog:
// three maps' worth for three photos.
const IMAGE_CACHE_SIZE = 9;
// How long a map's screenshots get to load before the photos go without.
const LOAD_SECONDS = 10;

export interface MapEntry {
  /** The mission's file name, like "DX_Ice". */
  mission: string;
  /** Its display name, with the file name added when another map shares it. */
  label: string;
  imageCount: number;
}

/** The URL of a map's screenshot; `image` counts from 1. */
export function mapImageUrl(mission: string, image: number) {
  return `${GALLERY_URL}/images/${encodeURIComponent(mission)}.${image}.webp`;
}

/** The gallery's maps that have screenshots, sorted by name. */
export function parseMaps(json: unknown): MapEntry[] {
  if (!json || typeof json !== "object") return [];
  const maps = Object.values(json).flatMap((value: unknown) => {
    const { missionName, displayName, imageCount } = (value ?? {}) as Record<
      string,
      unknown
    >;
    if (
      typeof missionName !== "string" ||
      !missionName ||
      typeof imageCount !== "number" ||
      imageCount < 1
    )
      return [];
    const name =
      typeof displayName === "string" && displayName.trim()
        ? displayName.trim()
        : missionName;
    return [{ mission: missionName, name, imageCount: Math.floor(imageCount) }];
  });
  const counts = new Map<string, number>();
  for (const { name } of maps) counts.set(name, (counts.get(name) ?? 0) + 1);
  return maps
    .map(({ mission, name, imageCount }) => ({
      mission,
      label: (counts.get(name) ?? 0) > 1 ? `${name} (${mission})` : name,
      imageCount,
    }))
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
}

let maps: Promise<MapEntry[]> | null = null;

/** The gallery's maps. Rejects when the list can't load; the next call tries
 * again. */
export function loadMaps(): Promise<MapEntry[]> {
  maps ??= fetch(MAPS_URL)
    .then((response) => {
      if (!response.ok)
        throw new Error(
          `The map list could not load (HTTP ${response.status}).`,
        );
      return response.json();
    })
    .then((json) => {
      const list = parseMaps(json);
      if (!list.length) throw new Error("The map list has no maps.");
      return list;
    })
    .catch((error) => {
      maps = null;
      throw error;
    });
  return maps;
}

const images = new Map<string, Promise<HTMLImageElement | null>>();

/** A screenshot, loaded so that a canvas it's drawn on can still be saved.
 * Null if it can't load; the next call tries again. */
function loadMapImage(
  mission: string,
  image: number,
): Promise<HTMLImageElement | null> {
  const url = mapImageUrl(mission, image);
  let loading = images.get(url);
  if (!loading) {
    loading = loadImage(url, "anonymous").then((element) => {
      if (!element) images.delete(url);
      return element;
    });
    images.set(url, loading);
    if (images.size > IMAGE_CACHE_SIZE)
      images.delete(images.keys().next().value!);
  }
  return loading;
}

/** A screenshot for each of `count` photos: the map's first ones in order,
 * starting over when it has fewer. Empty if none load in time. */
export function loadMapPictures(
  mission: string,
  count: number,
): Promise<HTMLImageElement[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<HTMLImageElement[]>((resolve) => {
    timer = setTimeout(() => resolve([]), LOAD_SECONDS * 1000);
  });
  return Promise.race([mapPictures(mission, count), late]).finally(() =>
    clearTimeout(timer),
  );
}

async function mapPictures(
  mission: string,
  count: number,
): Promise<HTMLImageElement[]> {
  // Without the list, screenshots that don't exist fail to load and are
  // skipped.
  const imageCount = await loadMaps().then(
    (list) => list.find((map) => map.mission === mission)?.imageCount,
    () => undefined,
  );
  const numbers = Array.from(
    { length: Math.min(count, imageCount ?? count) },
    (_, index) => index + 1,
  );
  const loaded = (
    await Promise.all(numbers.map((image) => loadMapImage(mission, image)))
  ).filter((image): image is HTMLImageElement => !!image);
  return loaded.length
    ? Array.from({ length: count }, (_, index) => loaded[index % loaded.length])
    : [];
}

// The map chosen last, for Retake and later booths. Like the recordings, it
// lasts until the page reloads.
let chosenMap: string | null = null;

export function chosenMapBackground() {
  return chosenMap;
}

export function chooseMapBackground(mission: string | null) {
  chosenMap = mission;
}

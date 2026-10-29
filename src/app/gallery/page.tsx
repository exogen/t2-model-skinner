"use client";
import {
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { CgSpinnerTwo } from "react-icons/cg";
import { FaChevronLeft, FaSearch, FaTimes } from "react-icons/fa";
import { FiDownload } from "react-icons/fi";
import { useQueryState } from "nuqs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import orderBy from "lodash.orderby";
import useManifest from "../../useManifest";
import Select from "../../Select";
import { modelOptions } from "../../modelOptions";
import styles from "./gallery.module.css";
import DownloadDialog from "./DownloadDialog";
import AllSkinsDownloadDialog from "./AllSkinsDownloadDialog";
import GalleryPreviews, { type GallerySkin } from "./GalleryPreviews";
import type { DownloadTarget, HdPreference } from "./galleryDownloads";

type GalleryDownloadTarget = DownloadTarget | { kind: "all" };

const modelOrder: Record<string, number> = {
  lmale: 0,
  mmale: 1,
  lfemale: 2,
  mfemale: 3,
  hmale: 4,
  lbioderm: 5,
  mbioderm: 6,
  hbioderm: 7,
  energy: 8,
  disc: 9,
  chaingun: 10,
  grenade_launcher: 11,
  sniper: 12,
  elf: 13,
  shocklance: 14,
  plasmathrower: 15,
  missile: 16,
  mortar: 17,
  repair: 18,
  targeting: 19,
  vehicle_grav_scout: 20,
  vehicle_grav_tank: 21,
  turret_assaulttank_mortar: 22,
  vehicle_land_mpbbase: 23,
  vehicle_air_scout: 24,
  vehicle_air_bomber: 25,
  vehicle_air_hapc: 26,
};

function skinDataToList(skinData: Record<string, string[]>): GallerySkin[] {
  const allSkins: GallerySkin[] = [];

  Object.entries(skinData).forEach(([model, names]) => {
    allSkins.push(...names.map((name) => ({ name, model })));
  });

  return orderBy(
    allSkins,
    [(skin) => skin.name.toLowerCase(), (skin) => modelOrder[skin.model]],
    ["asc", "asc"],
  );
}

function Gallery() {
  const [searchQuery, setSearchQuery] = useQueryState("q", {
    defaultValue: "",
    clearOnDefault: true,
  });
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [manifest, isLoaded, { error: manifestError, retry: retryManifest }] =
    useManifest();
  const [filterQuery, setFilterQuery] = useQueryState("filter", {
    defaultValue: "all",
    clearOnDefault: true,
  });
  const [collectionQuery, setCollectionQuery] = useQueryState("collection", {
    defaultValue: "",
    clearOnDefault: true,
  });
  const [downloadTarget, setDownloadTarget] =
    useState<GalleryDownloadTarget | null>(null);
  const downloadOpen = useRef(false);
  const isDownloadBusy = downloadTarget !== null;
  const [hiResDownload, setHiResDownload] = useState<HdPreference>("prompt");
  const openDownload = useCallback((target: GalleryDownloadTarget) => {
    if (downloadOpen.current) return;
    downloadOpen.current = true;
    setDownloadTarget(target);
  }, []);
  const closeDownload = () => {
    downloadOpen.current = false;
    setDownloadTarget(null);
  };
  const changeHdPreference = (value: HdPreference) => {
    setHiResDownload(value);
    try {
      if (value === "prompt") localStorage.removeItem("hiResDownload");
      else localStorage.setItem("hiResDownload", value);
    } catch {
      /* Download choices still work when storage is unavailable. */
    }
  };
  // Older links used one filter for either a model or a collection, and
  // search links searched every model. Preserve those entry points.
  const legacyCollection =
    filterQuery === "new" || manifest.packs[filterQuery] != null;
  const legacySearch = !collectionQuery && !!searchQuery.trim();
  const selectedCollection =
    collectionQuery ||
    (!legacySearch && legacyCollection ? filterQuery : "all");
  const selectedModel =
    legacySearch || legacyCollection ? "all" : filterQuery || "all";
  const actualModel = selectedModel === "hfemale" ? "hmale" : selectedModel;
  const pack =
    selectedCollection !== "all" && selectedCollection !== "new"
      ? manifest.packs[selectedCollection]
      : undefined;
  const changeFilters = (collection: string, model: string) => {
    if (collection !== collectionQuery) setCollectionQuery(collection);
    if (model !== filterQuery) setFilterQuery(model);
  };
  const changeSearch = (query: string) => {
    // Make the visible scope explicit before editing a legacy search URL.
    changeFilters(selectedCollection, selectedModel);
    setSearchQuery(query);
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem("hiResDownload");
      if (saved === "yes" || saved === "no") setHiResDownload(saved);
    } catch {
      /* Keep asking when storage is unavailable. */
    }
  }, []);

  const packList = useMemo(() => {
    return orderBy(
      Object.keys(manifest?.packs ?? {}),
      (name) => name.toLowerCase(),
      ["asc"],
    );
  }, [manifest]);

  const totalSkinCount = useMemo(
    () =>
      Object.values(manifest.customSkins).reduce(
        (count, names) => count + names.length,
        0,
      ),
    [manifest.customSkins],
  );

  const selectedSkinList = useMemo(() => {
    const skinData =
      selectedCollection === "new"
        ? manifest.newSkins
        : selectedCollection === "all"
          ? manifest.customSkins
          : (pack?.skins ?? {});
    return skinDataToList(
      actualModel === "all"
        ? skinData
        : { [actualModel]: skinData[actualModel] ?? [] },
    );
  }, [selectedCollection, actualModel, pack, manifest]);

  const searchRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <main className={styles.GalleryPage}>
        <header className={styles.Tools}>
          <div className={styles.HeaderMain}>
            <div className={styles.Identity}>
              <Link
                className={styles.Back}
                href="../"
                aria-label="Back to Editor"
              >
                <FaChevronLeft size={12} aria-hidden="true" /> Editor
              </Link>
              <h1>Skin gallery</h1>
            </div>
            <button
              type="button"
              className={`${styles.DownloadButton} ${styles.DownloadAll}`}
              aria-label="Download all player skins"
              disabled={isDownloadBusy}
              onClick={() => openDownload({ kind: "all" })}
            >
              <FiDownload className={styles.DownloadIcon} aria-hidden="true" />
              <span>Download all player skins</span>
              <span className={styles.DownloadFormat} aria-hidden="true">
                .VL2
              </span>
            </button>
          </div>
          <div
            className={styles.Filters}
            role="search"
            aria-label="Filter skins"
          >
            <div className={`${styles.Field} ${styles.SearchField}`}>
              <label htmlFor="SkinSearch">Search</label>
              <div className={styles.SearchBox}>
                <FaSearch aria-hidden="true" />
                <input
                  id="SkinSearch"
                  type="search"
                  ref={searchRef}
                  className={styles.SearchInput}
                  placeholder={
                    isLoaded
                      ? `Search ${totalSkinCount.toLocaleString()} skins…`
                      : "Search skins…"
                  }
                  value={searchQuery}
                  onChange={(event) => changeSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") changeSearch("");
                  }}
                />
                {searchQuery ? (
                  <button
                    type="button"
                    className={styles.ClearSearch}
                    aria-label="Clear search"
                    onClick={() => {
                      changeSearch("");
                      searchRef.current?.focus();
                    }}
                  >
                    <FaTimes aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>
            <div className={styles.Field}>
              <label htmlFor="CollectionSelect">Collection</label>
              <Select
                id="CollectionSelect"
                className={styles.SelectControl}
                value={selectedCollection}
                onChange={(value) => changeFilters(value, selectedModel)}
                options={[
                  { value: "all", label: "All skins" },
                  { value: "new", label: "New skins" },
                  {
                    label: "Packs",
                    options: packList.map((name) => ({
                      value: name,
                      label: name,
                    })),
                  },
                ]}
              />
            </div>
            <div className={styles.Field}>
              <label htmlFor="ModelSelect">Model</label>
              <Select
                id="ModelSelect"
                className={styles.SelectControl}
                value={selectedModel}
                onChange={(value) => changeFilters(selectedCollection, value)}
                options={[
                  { value: "all", label: "All models" },
                  ...modelOptions.map((group) => ({
                    ...group,
                    options: group.options.filter(
                      (option) => option.value !== "mine",
                    ),
                  })),
                ]}
              />
            </div>
          </div>
          {pack ? (
            <section
              className={styles.PackHeader}
              aria-label={`${selectedCollection} pack`}
            >
              <div className={styles.PackInfo}>
                <h2>{selectedCollection}</h2>
                <span className={styles.PackVersion}>
                  v{pack.version} &bull; {pack.files.length.toLocaleString()}{" "}
                  {pack.files.length === 1 ? "file" : "files"}
                </span>
              </div>
              <button
                type="button"
                className={styles.DownloadButton}
                aria-label={`Download ${selectedCollection} pack`}
                disabled={isDownloadBusy}
                onClick={() =>
                  openDownload({ kind: "pack", name: selectedCollection, pack })
                }
              >
                <FiDownload
                  className={styles.DownloadIcon}
                  aria-hidden="true"
                />
                <span>Download pack</span>
                <span className={styles.DownloadFormat} aria-hidden="true">
                  .VL2
                </span>
              </button>
            </section>
          ) : null}
        </header>
        {isLoaded ? (
          <GalleryPreviews
            skins={selectedSkinList}
            query={deferredSearchQuery}
            isDownloadBusy={isDownloadBusy}
            onDownload={openDownload}
          />
        ) : manifestError ? (
          <div className={styles.LoadError} role="alert">
            <p>Unable to load skins. Check your connection and try again.</p>
            <button
              type="button"
              className={styles.DownloadButton}
              onClick={retryManifest}
            >
              Try again
            </button>
          </div>
        ) : (
          <CgSpinnerTwo
            className={styles.Spinner}
            role="status"
            aria-label="Loading skins"
          />
        )}
      </main>
      {downloadTarget?.kind === "all" ? (
        <AllSkinsDownloadDialog
          hdPreference={hiResDownload}
          onHdPreferenceChange={changeHdPreference}
          onClose={closeDownload}
        />
      ) : downloadTarget ? (
        <DownloadDialog
          target={downloadTarget}
          manifest={manifest}
          hdPreference={hiResDownload}
          onHdPreferenceChange={changeHdPreference}
          onClose={closeDownload}
        />
      ) : null}
    </>
  );
}

const queryClient = new QueryClient();

export default function GalleryPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense>
        <Gallery />
      </Suspense>
    </QueryClientProvider>
  );
}

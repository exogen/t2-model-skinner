import useWarrior from "./useWarrior";
import { FaFolderOpen } from "react-icons/fa";
import { BsFillGrid3X3GapFill } from "react-icons/bs";
import { useCallback, useEffect, useRef, useState } from "react";
import useTools from "./useTools";
import useManifest from "./useManifest";
import modelConfig from "./models";
import Select, { type SelectGroup } from "./Select";
import { modelOptions } from "./modelOptions";
import { getLocalProject, localProjects } from "./localProjects";
import { skinOptionGroups } from "./skinOptions";
import styles from "./WarriorSelector.module.css";

const { defaultSkins, modelDefaults } = modelConfig;

function renderSkinLabel(label: string, value: string) {
  const separator = value.indexOf("/");
  const type = value.slice(0, separator);
  const skin = value.slice(separator + 1);
  const name = type === "local" ? getLocalProject(skin)?.name : skin;
  return name === "Thriller" ? (
    <>
      <span className={styles.Thriller}>{name}</span>
      {label.slice(name.length)}
    </>
  ) : (
    label
  );
}

export default function WarriorSelector() {
  const {
    selectedModel,
    setSelectedModel,
    selectedModelType,
    selectedSkin,
    selectedSkinType,
    setSelectedSkin,
    setSelectedSkinType,
    actualModel,
    setSelectedAnimation,
    setAnimationPaused,
    importedSkins,
  } = useWarrior();
  const {
    setSelectedMaterialIndex,
    loadSkinFiles,
    loadLocalProject,
    cancelSkinLoad,
    loadedLocalProject,
  } = useTools();
  const [importError, setImportError] = useState<string | null>(null);
  const [failedProject, setFailedProject] = useState<string | null>(null);
  const [pendingProject, setPendingProject] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const attemptedLocalSelection = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [manifest, isManifestLoaded] = useManifest();

  const openLocalProject = useCallback(
    async (file: string) => {
      const generation = ++requestGeneration.current;
      setPendingProject(file);
      setImportError(null);
      setFailedProject(null);
      try {
        await loadLocalProject(file);
      } catch (error) {
        if (generation !== requestGeneration.current) return;
        setImportError(
          error instanceof Error
            ? error.message
            : "Unable to open this project",
        );
        setFailedProject(file);
      } finally {
        if (generation === requestGeneration.current) setPendingProject(null);
      }
    },
    [loadLocalProject],
  );

  useEffect(() => {
    if (selectedSkinType !== "local" || !selectedSkin) {
      attemptedLocalSelection.current = null;
    } else if (selectedSkin === loadedLocalProject) {
      attemptedLocalSelection.current = selectedSkin;
    } else if (attemptedLocalSelection.current !== selectedSkin) {
      attemptedLocalSelection.current = selectedSkin;
      void openLocalProject(selectedSkin);
    }
  }, [selectedSkinType, selectedSkin, loadedLocalProject, openLocalProject]);

  useEffect(
    () => () => {
      requestGeneration.current++;
      attemptedLocalSelection.current = null;
    },
    [],
  );

  const cancelPendingProject = () => {
    requestGeneration.current++;
    cancelSkinLoad();
    setPendingProject(null);
    setImportError(null);
    setFailedProject(null);
  };

  const cancelOptionalProjectLoad = () => {
    // A URL project is already the selected editor state. Merely opening the
    // picker or reselecting its model must not strand that state without a
    // load (or clear the Retry action after a failure).
    if (
      selectedSkinType === "local" &&
      selectedSkin &&
      selectedSkin !== loadedLocalProject
    )
      return;
    cancelPendingProject();
  };

  const { customSkins } = manifest;
  const defaultNames =
    selectedModelType === "player"
      ? (defaultSkins[actualModel] ?? [])
      : modelDefaults[actualModel]
        ? [modelDefaults[actualModel]]
        : [];
  const skinSelectValue = selectedSkin
    ? `${selectedSkinType}/${selectedSkin}`
    : "";

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    cancelPendingProject();
    const generation = requestGeneration.current;
    try {
      await loadSkinFiles(files);
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setImportError(
        error instanceof Error ? error.message : "Unable to open this skin",
      );
      if (
        selectedSkinType === "local" &&
        selectedSkin &&
        selectedSkin !== loadedLocalProject
      ) {
        setFailedProject(selectedSkin);
      }
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const skinGroups: SelectGroup[] = [];
  const projectOptions = localProjects.map((project) => ({
    value: `local/${project.file}`,
    label: project.name,
  }));
  if (selectedSkinType === "project" && selectedSkin) {
    projectOptions.push({
      value: `project/${selectedSkin}`,
      label: selectedSkin,
    });
  }
  if (defaultNames.length) {
    skinGroups.push({
      label: "Default Skins",
      options: defaultNames.map((name) => ({
        value: `default/${name}`,
        label: selectedModelType === "player" ? name : "Default",
      })),
    });
  }
  if (projectOptions.length) {
    skinGroups.push({ label: "Projects", options: projectOptions });
  }
  skinGroups.push(
    ...skinOptionGroups(actualModel, {
      importedSkins,
      manifest,
      isManifestLoaded,
      alwaysShowCustom: selectedModelType === "player",
    }),
  );

  return (
    <div className="Toolbar">
      <div className="Field ModelField">
        <label htmlFor="ModelSelect">Model</label>
        <Select
          id="ModelSelect"
          options={modelOptions}
          value={selectedModel}
          onReselect={cancelOptionalProjectLoad}
          onChange={(newSelectedModel) => {
            cancelPendingProject();
            const newActualModel =
              newSelectedModel === "hfemale" ? "hmale" : newSelectedModel;
            const availableSkins =
              selectedSkinType === "default"
                ? (defaultSkins[newActualModel] ?? [
                    modelDefaults[newActualModel],
                  ])
                : selectedSkinType === "custom"
                  ? customSkins[newActualModel]
                  : [];
            const newModelHasSkin =
              selectedSkin && availableSkins?.includes(selectedSkin);

            setSelectedAnimation(null);
            setAnimationPaused(false);
            setSelectedModel(newSelectedModel);
            setSelectedMaterialIndex(0);
            if (!newModelHasSkin) {
              setSelectedSkin(modelDefaults[newActualModel] ?? null);
              setSelectedSkinType("default");
            }
          }}
        />
      </div>
      <div className="Field SkinField">
        <label htmlFor="SkinSelect">
          Skin
          {pendingProject ? (
            <span
              role="status"
              style={{
                marginLeft: "0.5em",
                fontSize: "0.8em",
                textTransform: "none",
              }}
            >
              Loading…
            </span>
          ) : null}
        </label>
        <div className="Buttons">
          <Select
            id="SkinSelect"
            searchable
            searchPlaceholder="Search skins…"
            value={skinSelectValue}
            onReselect={() => {
              cancelPendingProject();
              if (
                selectedSkinType === "local" &&
                selectedSkin &&
                selectedSkin !== loadedLocalProject
              ) {
                void openLocalProject(selectedSkin);
              }
            }}
            selectedLabel={
              (selectedSkinType === "local"
                ? getLocalProject(selectedSkin)?.name
                : selectedSkin) ?? undefined
            }
            renderLabel={renderSkinLabel}
            options={skinGroups}
            onChange={(value) => {
              const separator = value.indexOf("/");
              const type = value.slice(0, separator);
              const skin = value.slice(separator + 1);
              if (type === "local") {
                void openLocalProject(skin);
                return;
              }
              cancelPendingProject();
              setSelectedSkin(skin);
              setSelectedSkinType(type);
            }}
          />
          <button
            type="button"
            className="LoadSkinButton"
            aria-label="Load Skin"
            title="Load a Skin"
            onClick={() => {
              cancelOptionalProjectLoad();
              if (fileInputRef.current) {
                fileInputRef.current.click();
              }
            }}
          >
            <FaFolderOpen style={{ fontSize: 18 }} />
          </button>
          <input
            ref={fileInputRef}
            onChange={handleFileChange}
            type="file"
            accept=".png, image/png, .vl2, .zip, application/zip, application/zip-compressed, .skin"
            multiple
            hidden
          />
        </div>
      </div>
      {importError ? (
        <p role="alert">
          {importError}
          {failedProject ? (
            <button
              type="button"
              onClick={() => void openLocalProject(failedProject)}
            >
              Retry
            </button>
          ) : null}
        </p>
      ) : null}
      <div className="Field GalleryField">
        <a
          href="gallery/"
          target="_blank"
          className="GalleryLink"
          title="Open skin gallery"
        >
          <span className="FieldLabel">Gallery</span>
          <BsFillGrid3X3GapFill />
        </a>
      </div>
    </div>
  );
}

import { ReactNode, useCallback, useEffect, useState } from "react";
import CanvasProvider from "./CanvasProvider";
import ToolsProvider from "./ToolsProvider";
import useWarrior from "./useWarrior";
import useAsyncTask from "./useAsyncTask";
import useImageLoader from "./useImageLoader";
import useSettings from "./useSettings";
import { getLocalAssetUrl } from "./deployPaths";
import { getLocalProject } from "./localProjects";
import { detectTextureSizeMultiplier } from "./textureResolution";
import { detectFileType, importMultipleFilesToModels } from "./importUtils";
import { createCanvasClipboard, type CanvasClipboard } from "./canvasClipboard";
import {
  EditorSessionContext,
  type EditorSessionValue,
} from "./useEditorSession";
import {
  getProjectTarget,
  prepareSkinProject,
  readSkinProjectZip,
  type SkinProject,
} from "./skinProjectUtils";

type OpenProject = {
  document: SkinProject;
  model: string;
  sizeMultiplier: number;
  name: string;
  localFile?: string;
};

function sameTextureUrls(
  a: Record<string, string[]>,
  b: Record<string, string[]>,
) {
  return (
    a === b ||
    (Object.keys(a).length === Object.keys(b).length &&
      Object.entries(a).every(
        ([key, urls]) =>
          urls.length === b[key]?.length &&
          urls.every((url, frame) => url === b[key][frame]),
      ))
  );
}

export default function EditorProvider({ children }: { children: ReactNode }) {
  const warrior = useWarrior();
  const [project, setProject] = useState<OpenProject | null>(null);
  const [preferredSize, setPreferredSize] = useState(1);
  const [preferences, setPreferences] = useState({
    backgroundColor: "black",
    brushColor: 200,
    brushSize: 10,
    exportName: "",
  });
  // Copied layers outlive sessions, so they can be pasted into another skin.
  const [clipboard] = useState(createCanvasClipboard);

  useEffect(() => {
    try {
      const size = Number(localStorage.getItem("sizeMultiplier"));
      if ([1, 2, 4].includes(size)) setPreferredSize(size);
    } catch {
      // Storage may be unavailable.
    }
  }, []);

  const openProject = useCallback(
    (opened: OpenProject) => {
      setProject(opened);
      const name = opened.document.name;
      if (name) {
        setPreferences((previous) => ({ ...previous, exportName: name }));
      }
      warrior.setSelectedModel(opened.model);
      warrior.setSelectedAnimation(null);
      warrior.setAnimationPaused(false);
      warrior.setSelectedSkinType(opened.localFile ? "local" : "project");
      warrior.setSelectedSkin(opened.localFile ?? opened.name);
    },
    [warrior],
  );

  const activeProject =
    project?.model === warrior.selectedModel &&
    ((warrior.selectedSkinType === "project" &&
      !project.localFile &&
      project.name === warrior.selectedSkin) ||
      (warrior.selectedSkinType === "local" &&
        project.localFile === warrior.selectedSkin))
      ? project
      : null;
  // A project's dimensions belong to the document, not the default preference.
  const sizeMultiplier = activeProject?.sizeMultiplier ?? preferredSize;
  const source = {
    model: warrior.selectedModel,
    skinType: warrior.selectedSkinType,
    skin: warrior.selectedSkin,
    images: warrior.skinImageUrls,
    defaultImages: warrior.defaultSkinImageUrls,
    sizeMultiplier,
    project: activeProject,
  };
  const [session, setSession] = useState({ source, revision: 0 });
  const previous = session.source;
  // Compare source values, not memoized object identity: an unrelated import
  // can rebuild the URL map without changing the document being edited.
  if (
    previous.model !== source.model ||
    previous.skinType !== source.skinType ||
    previous.skin !== source.skin ||
    previous.sizeMultiplier !== source.sizeMultiplier ||
    previous.project !== source.project ||
    !sameTextureUrls(previous.images, source.images) ||
    !sameTextureUrls(previous.defaultImages, source.defaultImages)
  ) {
    setSession({ source, revision: session.revision + 1 });
  }

  return (
    <EditorSession
      key={session.revision}
      source={session.source}
      preferences={preferences}
      setPreferences={setPreferences}
      project={activeProject?.document ?? null}
      localProjectFile={activeProject?.localFile ?? null}
      sizeMultiplier={sizeMultiplier}
      setSizeMultiplier={setPreferredSize}
      openProject={openProject}
      clipboard={clipboard}
    >
      {children}
    </EditorSession>
  );
}

function EditorSession({
  children,
  source,
  preferences,
  setPreferences,
  project,
  localProjectFile,
  sizeMultiplier: preferredSize,
  setSizeMultiplier,
  openProject,
  clipboard,
}: {
  children: ReactNode;
  source: {
    model: string;
    skin: string | null;
    skinType: string | null;
    images: Record<string, string[]>;
    defaultImages: Record<string, string[]>;
  };
  preferences: EditorSessionValue["preferences"];
  setPreferences: EditorSessionValue["setPreferences"];
  project: SkinProject | null;
  localProjectFile: string | null;
  sizeMultiplier: number;
  setSizeMultiplier: (value: number | ((previous: number) => number)) => void;
  openProject: (project: OpenProject) => void;
  clipboard: CanvasClipboard;
}) {
  const warrior = useWarrior();
  const { selectedModel } = warrior;
  const { basePath } = useSettings();
  const { loadImage } = useImageLoader();
  const [detectedSize, setDetectedSize] = useState<number | undefined | null>(
    null,
  );
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const resolveSize = useAsyncTask();
  const awaitingLocalProject = source.skinType === "local" && !project;
  useEffect(() => {
    if (project || awaitingLocalProject) return;
    void resolveSize(
      () =>
        detectTextureSizeMultiplier(
          source.model,
          source.images,
          source.skin ? source.defaultImages : {},
          loadImage,
        ),
      setDetectedSize,
    ).catch((error: unknown) => {
      setResolutionError(
        error instanceof Error
          ? error.message
          : "Unable to determine texture size",
      );
    });
  }, [project, awaitingLocalProject, source, loadImage, resolveSize]);
  const isResolvingSize =
    awaitingLocalProject ||
    (!project && detectedSize === null && !resolutionError);
  const sizeMultiplier = project
    ? preferredSize
    : (detectedSize ?? preferredSize);
  const runTask = useAsyncTask();
  const runLoad = useAsyncTask(true);
  const prepareProject = useCallback(
    async (file: File | Blob, signal: AbortSignal) => {
      const document = await readSkinProjectZip(file);
      signal.throwIfAborted();
      const target = getProjectTarget(document, selectedModel);
      // Preflight before replacing the current session. Each mounted canvas
      // owns its Fabric objects; the document itself stores only snapshots.
      const prepared = await prepareSkinProject(document, signal);
      Object.values(prepared).forEach(({ color, metallic }) =>
        [...color, ...metallic].forEach((object) => object.dispose()),
      );
      const filename =
        "name" in file ? String(file.name).replace(/\.skin$/i, "") : "";
      return {
        document: { ...document, name: document.name || filename },
        ...target,
        name: filename || "Project",
      };
    },
    [selectedModel],
  );
  const loadSkinProject = useCallback(
    async (file: File | Blob) => {
      await runLoad((signal) => prepareProject(file, signal), openProject);
    },
    [runLoad, openProject, prepareProject],
  );

  const loadLocalProject = useCallback(
    async (file: string) => {
      await runLoad(async (signal) => {
        const entry = getLocalProject(file);
        if (!entry)
          throw new Error("This local project is no longer available.");
        const response = await fetch(
          getLocalAssetUrl(basePath, `projects/${entry.file}`),
          { signal },
        );
        if (!response.ok)
          throw new Error(`Unable to load ${entry.name} (${response.status}).`);
        const bytes = await response.arrayBuffer();
        signal.throwIfAborted();
        const opened = await prepareProject(
          new File([bytes], entry.file.split("/").at(-1)!),
          signal,
        );
        return { ...opened, localFile: entry.file };
      }, openProject);
    },
    [basePath, runLoad, openProject, prepareProject],
  );

  const loadSkinFiles = useCallback(
    async (files: File[]) => {
      const projects = files.filter((file) => detectFileType(file) === "skin");
      if (projects.length) {
        // A project replaces the editor; the last selected project wins.
        await loadSkinProject(projects[projects.length - 1]);
        return;
      }
      await runLoad(
        () => importMultipleFilesToModels(files),
        (foundModels) => {
          warrior.addImportedSkins(foundModels);
          // Prefer a complete skin for the current model before switching models.
          for (const model of [
            warrior.actualModel,
            ...Array.from(foundModels.keys()),
          ]) {
            const skin = Array.from(
              foundModels.get(model)?.values() ?? [],
            ).find((skin) => skin.isComplete);
            if (!skin) continue;
            if (model !== warrior.actualModel) warrior.setSelectedModel(model);
            warrior.setSelectedSkinType("import");
            warrior.setSelectedSkin(skin.name ?? "__untitled__");
            warrior.setSelectedAnimation(null);
            warrior.setAnimationPaused(false);
            return;
          }
        },
      );
    },
    [loadSkinProject, runLoad, warrior],
  );

  return (
    <EditorSessionContext.Provider
      value={{
        preferences,
        setPreferences,
        project,
        sizeMultiplier,
        isResolvingSize,
        resolutionError,
        setSizeMultiplier,
        loadSkinProject,
        loadSkinFiles,
        loadLocalProject,
        cancelSkinLoad: runLoad.cancel,
        loadedLocalProject: localProjectFile,
        runTask,
        clipboard,
      }}
    >
      <CanvasProvider key={sizeMultiplier}>
        <ToolsProvider>{children}</ToolsProvider>
      </CanvasProvider>
    </EditorSessionContext.Provider>
  );
}

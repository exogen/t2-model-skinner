import { ReactNode, useCallback, useEffect, useState } from "react";
import CanvasProvider from "./CanvasProvider";
import ToolsProvider from "./ToolsProvider";
import useWarrior from "./useWarrior";
import useAsyncTask from "./useAsyncTask";
import { detectFileType, importMultipleFilesToModels } from "./importUtils";
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
};

function sameTextureUrls(
  a: Record<string, string[]>,
  b: Record<string, string[]>
) {
  return (
    a === b ||
    (Object.keys(a).length === Object.keys(b).length &&
      Object.entries(a).every(
        ([key, urls]) =>
          urls.length === b[key]?.length &&
          urls.every((url, frame) => url === b[key][frame])
      ))
  );
}

export default function EditorProvider({
  children,
}: {
  children: ReactNode;
}) {
  const warrior = useWarrior();
  const [project, setProject] = useState<OpenProject | null>(null);
  const [preferredSize, setPreferredSize] = useState(1);
  const [preferences, setPreferences] = useState({
    backgroundColor: "black",
    brushColor: 200,
    brushSize: 10,
    exportName: "",
  });

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
      warrior.setSelectedSkinType("project");
      warrior.setSelectedSkin(opened.name);
    },
    [warrior]
  );

  const activeProject =
    warrior.selectedSkinType === "project" &&
    project?.model === warrior.selectedModel &&
    project.name === warrior.selectedSkin
      ? project
      : null;
  // A project's dimensions belong to the document, not the default preference.
  const sizeMultiplier = activeProject?.sizeMultiplier ?? preferredSize;
  const source = {
    model: warrior.selectedModel,
    skinType: warrior.selectedSkinType,
    skin: warrior.selectedSkin,
    images: warrior.skinImageUrls,
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
    !sameTextureUrls(previous.images, source.images)
  ) {
    setSession({ source, revision: session.revision + 1 });
  }

  return (
    <EditorSession
      key={session.revision}
      preferences={preferences}
      setPreferences={setPreferences}
      project={activeProject?.document ?? null}
      sizeMultiplier={sizeMultiplier}
      setSizeMultiplier={setPreferredSize}
      openProject={openProject}
    >
      {children}
    </EditorSession>
  );
}

function EditorSession({
  children,
  preferences,
  setPreferences,
  project,
  sizeMultiplier,
  setSizeMultiplier,
  openProject,
}: {
  children: ReactNode;
  preferences: EditorSessionValue["preferences"];
  setPreferences: EditorSessionValue["setPreferences"];
  project: SkinProject | null;
  sizeMultiplier: number;
  setSizeMultiplier: (value: number | ((previous: number) => number)) => void;
  openProject: (project: OpenProject) => void;
}) {
  const warrior = useWarrior();
  const { selectedModel } = warrior;
  const runTask = useAsyncTask();
  const runLoad = useAsyncTask(true);
  const loadSkinProject = useCallback(
    async (file: File | Blob) => {
      await runLoad(async (signal) => {
        const document = await readSkinProjectZip(file);
        const target = getProjectTarget(document, selectedModel);
        // Preflight every layer before replacing the current session. Keep only
        // snapshots in React state; each mounted canvas owns its Fabric objects.
        const prepared = await prepareSkinProject(document, signal);
        Object.values(prepared).forEach(({ color, metallic }) =>
          [...color, ...metallic].forEach((object) => object.dispose())
        );
        const filename =
          "name" in file ? String(file.name).replace(/\.skin$/i, "") : "";
        return {
          document: { ...document, name: document.name || filename },
          ...target,
          name: filename || "Project",
        };
      }, openProject);
    },
    [runLoad, openProject, selectedModel]
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
              foundModels.get(model)?.values() ?? []
            ).find((skin) => skin.isComplete);
            if (!skin) continue;
            if (model !== warrior.actualModel) warrior.setSelectedModel(model);
            warrior.setSelectedSkinType("import");
            warrior.setSelectedSkin(skin.name ?? "__untitled__");
            warrior.setSelectedAnimation(null);
            return;
          }
        }
      );
    },
    [loadSkinProject, runLoad, warrior]
  );

  return (
    <EditorSessionContext.Provider
      value={{
        preferences,
        setPreferences,
        project,
        sizeMultiplier,
        setSizeMultiplier,
        loadSkinProject,
        loadSkinFiles,
        runTask,
      }}
    >
      <CanvasProvider>
        <ToolsProvider>{children}</ToolsProvider>
      </CanvasProvider>
    </EditorSessionContext.Provider>
  );
}

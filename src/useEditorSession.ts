import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { CanvasClipboard } from "./canvasClipboard";
import type { SkinProject } from "./skinProjectUtils";
import type useAsyncTask from "./useAsyncTask";

export interface EditorPreferences {
  backgroundColor: string;
  brushColor: number;
  brushSize: number;
  exportName: string;
}

export interface EditorSessionValue {
  preferences: EditorPreferences;
  setPreferences: Dispatch<SetStateAction<EditorPreferences>>;
  project: SkinProject | null;
  sizeMultiplier: number;
  isResolvingSize: boolean;
  resolutionError: string | null;
  setSizeMultiplier: (value: number | ((previous: number) => number)) => void;
  loadSkinProject: (file: File | Blob) => Promise<void>;
  loadSkinFiles: (files: File[]) => Promise<void>;
  loadLocalProject: (file: string) => Promise<void>;
  cancelSkinLoad: () => void;
  loadedLocalProject: string | null;
  runTask: ReturnType<typeof useAsyncTask>;
  clipboard: CanvasClipboard;
}

export const EditorSessionContext = createContext<EditorSessionValue | null>(
  null,
);

export default function useEditorSession() {
  const session = useContext(EditorSessionContext);
  if (!session) throw new Error("No EditorSessionContext.Provider");
  return session;
}

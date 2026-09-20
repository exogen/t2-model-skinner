import {
  createContext,
  useContext,
  type Dispatch,
  type SetStateAction,
} from "react";
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
  setSizeMultiplier: (value: number | ((previous: number) => number)) => void;
  loadSkinProject: (file: File | Blob) => Promise<void>;
  loadSkinFiles: (files: File[]) => Promise<void>;
  runTask: ReturnType<typeof useAsyncTask>;
}

export const EditorSessionContext = createContext<EditorSessionValue | null>(
  null
);

export default function useEditorSession() {
  const session = useContext(EditorSessionContext);
  if (!session) throw new Error("No EditorSessionContext.Provider");
  return session;
}

export interface LocalProject {
  file: string;
  name: string;
  model?: string;
}

// Set by next.config.ts in the dev server only. Production builds have no
// local projects.
export const localProjects: readonly LocalProject[] =
  process.env.NODE_ENV === "development"
    ? JSON.parse(process.env.LOCAL_PROJECTS || "[]")
    : [];

export function getLocalProject(file: string | null): LocalProject | undefined {
  return localProjects.find((project) => project.file === file);
}

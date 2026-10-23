import type { LocalProject } from "../src/localProjects";

export const projectsDirectory: string;
export function buildProjects(directory?: string): Promise<LocalProject[]>;

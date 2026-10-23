import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildProjects, projectsDirectory } from "../../../../scripts/buildProjects.mjs";

// Serves local projects from the dev server. Not part of production builds.
export async function generateStaticParams() {
  const projects = await buildProjects();
  return projects.map((project) => ({ file: project.file.split("/") }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string[] }> }) {
  const { file } = await params;
  const projects = await buildProjects();
  const name = file.map(decodeURIComponent).join("/");
  if (!projects.some((project) => project.file === name)) {
    return new Response("Not found", { status: 404 });
  }
  const bytes = await readFile(path.join(projectsDirectory, ...name.split("/")));
  return new Response(bytes, { headers: { "Content-Type": "application/zip" } });
}

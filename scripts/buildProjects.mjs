import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import JSZip from "jszip";

// Local projects are private and only available in the dev server. Keep this
// directory out of public/ so its files are never copied into a build.
export const projectsDirectory = path.join(process.cwd(), "projects");

async function projectFiles(directory, prefix = "") {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (!prefix && error.code === "ENOENT") return [];
    throw error;
  }
  const files = await Promise.all(entries.map(async (entry) => {
    const file = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return projectFiles(path.join(directory, entry.name), file);
    return entry.isFile() && /\.skin$/i.test(entry.name) ? [file] : [];
  }));
  return files.flat();
}

/** List the .skin files in the projects directory. Only project.json is read
 * from each archive. `file` is the unencoded path relative to the directory. */
export async function buildProjects(directory = projectsDirectory) {
  const files = (await projectFiles(directory)).sort();
  const projects = [];
  for (const file of files) {
    try {
      const archive = await JSZip.loadAsync(await readFile(path.join(directory, ...file.split("/"))));
      const manifest = archive.file("project.json");
      // Legacy version-1 projects have no root manifest or saved model.
      const metadata = manifest ? JSON.parse(await manifest.async("string")) : {};
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        throw new Error("project.json must contain an object");
      }
      if (metadata.model !== undefined && typeof metadata.model !== "string") {
        throw new Error("project.json model must be a string");
      }
      projects.push({
        file,
        name: path.posix.basename(file).slice(0, -".skin".length),
        ...(metadata.model ? { model: metadata.model } : {}),
      });
    } catch (error) {
      throw new Error(`Could not read local project "${file}": ${error.message}`, { cause: error });
    }
  }
  return projects;
}

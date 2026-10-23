import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, expect, test } from "vitest";
import { buildProjects } from "../scripts/buildProjects.mjs";

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "t2-project-catalog-"));
  directories.push(directory);
  return directory;
}

async function project(directory, file, metadata, { legacy = false } = {}) {
  const archive = new JSZip();
  if (!legacy) archive.file("project.json", JSON.stringify(metadata));
  archive.file("base/material.json", "{}");
  const destination = path.join(directory, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return destination;
}

test("lists .skin files in nested directories, named after the file", async () => {
  const directory = await fixture();
  await project(directory, "z.skin", { name: "Internal name", model: "hfemale" });
  await project(directory, "nested %2F/日本語.skin", { model: "lbioderm" });
  await project(directory, "A.SKIN", { name: "Different saved name", model: "lmale" });
  await project(directory, "nested %2F/Case 100% #?&+.sKiN", { model: "disc" });
  await project(directory, "ignore.skin.png", { model: "mmale" });
  expect(await buildProjects(directory)).toEqual([
    { file: "A.SKIN", name: "A", model: "lmale" },
    { file: "nested %2F/Case 100% #?&+.sKiN", name: "Case 100% #?&+", model: "disc" },
    { file: "nested %2F/日本語.skin", name: "日本語", model: "lbioderm" },
    { file: "z.skin", name: "z", model: "hfemale" },
  ]);
});

test("missing and empty directories have no projects", async () => {
  const directory = await fixture();
  expect(await buildProjects(path.join(directory, "missing"))).toEqual([]);
  await mkdir(path.join(directory, "empty"), { recursive: true });
  expect(await buildProjects(directory)).toEqual([]);
});

test("projects without a saved model omit it", async () => {
  const directory = await fixture();
  await project(directory, "Legacy.skin", undefined, { legacy: true });
  await project(directory, "Unnamed.skin", { version: 2, name: "Saved name" });
  expect(await buildProjects(directory)).toEqual([
    { file: "Legacy.skin", name: "Legacy" },
    { file: "Unnamed.skin", name: "Unnamed" },
  ]);
});

test("a broken archive is reported by filename", async () => {
  const directory = await fixture();
  await project(directory, "Good.skin", { model: "lmale" });
  await writeFile(path.join(directory, "Broken.skin"), "not a ZIP");
  await expect(buildProjects(directory)).rejects.toThrow('Could not read local project "Broken.skin":');
});

test.each([
  ["null", "must contain an object"],
  ["[]", "must contain an object"],
  ['{"model":7}', "model must be a string"],
  ["{broken", "Could not read local project"],
])("malformed manifest %s is reported", async (manifest, expected) => {
  const directory = await fixture();
  const archive = new JSZip().file("project.json", manifest);
  await writeFile(path.join(directory, "Malformed.skin"), await archive.generateAsync({ type: "nodebuffer" }));
  await expect(buildProjects(directory)).rejects.toThrow(expected);
});

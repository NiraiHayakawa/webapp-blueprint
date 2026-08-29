import { Project } from "ts-morph";
import fs from "node:fs";
import path from "node:path";

/**
 * architecture checker のテストで使う fixture（`test/fixtures/` 配下）を
 * 読み込むための共有ヘルパー。checker.test.ts から import して使う。
 */
const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures");

function loadProject(fixtureDir: string): Project {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  project.addSourceFilesAtPaths(path.join(fixtureDir, "**/*.{ts,tsx}"));
  return project;
}

function fixturePath(...segments: string[]): string {
  return path.join(FIXTURES_ROOT, ...segments);
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

export { fixturePath, loadProject, readFile };

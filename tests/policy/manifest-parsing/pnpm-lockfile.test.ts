import { describe, expect, it, vi } from "vitest";

import { extractLockfileSpecifiers } from "./pnpm-lockfile.ts";

vi.setConfig({ testTimeout: 5000 });

const SAMPLE_LOCKFILE_YAML = [
  "lockfileVersion: '9.0'",
  "",
  "catalogs:",
  "  default:",
  "    typescript:",
  "      specifier: 7.0.2",
  "      version: 7.0.2",
  "",
  "importers:",
  "",
  "  .:",
  "    devDependencies:",
  "      typescript:",
  "        specifier: 'catalog:'",
  "        version: 7.0.2",
  "",
  "  apps/api:",
  "    dependencies:",
  "      left-pad:",
  "        specifier: ^1.3.0",
  "        version: 1.3.0",
].join("\n");

describe(extractLockfileSpecifiers, () => {
  it("catalogs と importers の specifier をキー経路付きで取り出す", () => {
    expect.hasAssertions();
    const specifiers = extractLockfileSpecifiers(SAMPLE_LOCKFILE_YAML);

    expect(specifiers).toStrictEqual([
      { path: ["catalogs", "default", "typescript"], specifier: "7.0.2", line: 6 },
      {
        path: ["importers", ".", "devDependencies", "typescript"],
        specifier: "catalog:",
        line: 14,
      },
      {
        path: ["importers", "apps/api", "dependencies", "left-pad"],
        specifier: "^1.3.0",
        line: 20,
      },
    ]);
  });

  it("specifier: の値が空（次行以降に続く想定が無いケース）は無視する", () => {
    expect.hasAssertions();
    expect(extractLockfileSpecifiers("importers:\n  .:\n    devDependencies: {}\n")).toStrictEqual(
      [],
    );
  });
});

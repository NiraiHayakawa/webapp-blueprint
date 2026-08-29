// GraphStore の永続化まわりの公開契約（設計正本 §4）:
// archiveUnsupportedVersion による v1 ファイルの raw 退避、および
// v2 の fenced assignment / integration journal を含むグラフが欠落なく往復すること。
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  GraphStore,
  GraphArchiveTargetExistsError,
  GraphNotInitializedError,
} from "../src/store.ts";
import {
  allocationIdSchema,
  assignmentIdSchema,
  commitIdSchema,
  epochSchema,
  isoDateTimeSchema,
  nonEmptyStringSchema,
  plannedNodeIdSchema,
  runIdSchema,
  workspaceIdSchema,
  type GraphV2,
} from "@webapp-blueprint/ramune-graph";
import {
  graphPathOf,
  makeRepositoryRoot,
  readPersistedText,
  writeRawGraph,
  LEGACY_V1_RAW,
} from "./store-support.ts";

function workspaceId() {
  return workspaceIdSchema.parse("ws-1");
}

function commitOf(value: string) {
  return commitIdSchema.parse(value);
}

/** claim_ready 相当の状態（running ノード + allocator 進行）を直接組み立てる。 */
function buildRunningGraph(base: GraphV2): GraphV2 {
  const startedSession: GraphV2 = {
    ...base,
    session: { state: "active", runId: runIdSchema.parse("run-1"), epoch: epochSchema.parse(0) },
    nodes: base.nodes.map((node) =>
      node.kind === "boundary" && node.boundary === "start"
        ? {
            ...node,
            status: "done",
            result: {
              kind: "boundary",
              runId: runIdSchema.parse("run-1"),
              summary: nonEmptyStringSchema.parse("開始"),
            },
          }
        : node,
    ),
  };
  return {
    ...startedSession,
    nextAllocationId: allocationIdSchema.parse(2),
    nodes: [
      ...startedSession.nodes,
      {
        kind: "task",
        id: plannedNodeIdSchema.parse("r1"),
        title: nonEmptyStringSchema.parse("r1"),
        deps: ["start"],
        resolutions: [],
        purpose: "planned",
        effect: "repository_change",
        status: "running",
        assignment: {
          role: "worker",
          effect: "repository_change",
          id: assignmentIdSchema.parse(1),
          nodeId: plannedNodeIdSchema.parse("r1"),
          runId: runIdSchema.parse("run-1"),
          epoch: epochSchema.parse(0),
          workspaceId: workspaceId(),
          baseCommit: commitOf("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
          startedAt: isoDateTimeSchema.parse("2026-08-24T00:00:00Z"),
        },
      },
    ],
  } satisfies GraphV2;
}

describe("GraphStore.archiveUnsupportedVersion", () => {
  let repositoryRoot: string;

  beforeEach(() => {
    repositoryRoot = makeRepositoryRoot();
  });

  afterEach(() => {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  });

  it("v1 ファイルを raw バイトのまま別名へ退避し、元のパスから取り除く", async () => {
    expect.hasAssertions();
    writeRawGraph(repositoryRoot, LEGACY_V1_RAW);
    const store = new GraphStore({ repositoryRoot });

    const result = await store.archiveUnsupportedVersion();
    if (result.outcome !== "archived") {
      throw new Error("archived になるべき");
    }

    const backupPath = path.join(repositoryRoot, ".ramune", "graph.v1.backup.json");
    expect(result.archivedTo).toBe(backupPath);
    // 中身を解釈せず raw バイトがそのまま保存される
    expect(fs.readFileSync(backupPath, "utf-8")).toBe(LEGACY_V1_RAW);
    expect(fs.existsSync(graphPathOf(repositoryRoot))).toBe(false);
  });

  it("退避後の initialize() は version 2 として初期化できる", async () => {
    expect.hasAssertions();
    writeRawGraph(repositoryRoot, LEGACY_V1_RAW);
    const store = new GraphStore({ repositoryRoot });
    await store.archiveUnsupportedVersion();

    const fresh = await store.initialize("新しいゴール");

    expect(fresh.version).toBe(2);
    expect(fresh.goal).toBe("新しいゴール");
  });
});

describe("GraphStore.archiveUnsupportedVersion: 失敗経路", () => {
  let repositoryRoot: string;

  beforeEach(() => {
    repositoryRoot = makeRepositoryRoot();
  });

  afterEach(() => {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  });

  it("退避先が既に存在する場合は上書きせず GraphArchiveTargetExistsError で失敗する", async () => {
    expect.hasAssertions();
    writeRawGraph(repositoryRoot, LEGACY_V1_RAW);
    const backupPath = path.join(repositoryRoot, ".ramune", "graph.v1.backup.json");
    fs.writeFileSync(backupPath, "前回の退避内容");
    const store = new GraphStore({ repositoryRoot });

    await expect(store.archiveUnsupportedVersion()).rejects.toThrow(GraphArchiveTargetExistsError);
    // 元ファイルも退避先も壊されていない
    expect(readPersistedText(repositoryRoot)).toBe(LEGACY_V1_RAW);
    expect(fs.readFileSync(backupPath, "utf-8")).toBe("前回の退避内容");
  });

  it("version 2 のファイルには何もせず already_version_2 を返す", async () => {
    expect.hasAssertions();
    const store = new GraphStore({ repositoryRoot });
    await store.initialize("テスト用ゴール");

    const result = await store.archiveUnsupportedVersion();

    expect(result).toStrictEqual({ outcome: "already_version_2" });
    expect(fs.existsSync(graphPathOf(repositoryRoot))).toBe(true);
  });

  it("ファイルが存在しない場合は GraphNotInitializedError", async () => {
    expect.hasAssertions();
    const store = new GraphStore({ repositoryRoot });

    await expect(store.archiveUnsupportedVersion()).rejects.toThrow(GraphNotInitializedError);
  });
});

describe("GraphStore: v2 の fenced assignment / integration journal を含むグラフの往復", () => {
  let repositoryRoot: string;

  beforeEach(() => {
    repositoryRoot = makeRepositoryRoot();
  });

  afterEach(() => {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  });

  it("running ノード（assignment 保持）を持つグラフも失なくならない", async () => {
    expect.hasAssertions();
    const store = new GraphStore({ repositoryRoot });
    await store.initialize("テスト用ゴール");

    const withRunning = buildRunningGraph(await store.read());
    await store.transaction({ expectedRevision: withRunning.revision }, () => withRunning);

    await expect(store.read()).resolves.toStrictEqual(withRunning);
  });
});

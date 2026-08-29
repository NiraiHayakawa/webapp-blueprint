// GraphStore.transaction の公開契約（設計正本 §4）: mutate 結果の永続化と async mutex
// 直列化、expected_revision 検査、mutate 例外 / atomic replace 失敗時のロールバック。
//
// store 自体は revision を加算しない（加算はドメイン層の transaction の責務）。
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GraphStore, RevisionConflictError } from "../src/store.ts";
import { nonEmptyStringSchema, revisionSchema, type GraphV2 } from "@webapp-blueprint/ramune-graph";
import { captureRejection, makeRepositoryRoot, readPersistedText } from "./store-support.ts";

const GOAL = (value: string) => nonEmptyStringSchema.parse(value);
const STALE_REVISION_VALUE = 999;
const STALE_REVISION = revisionSchema.parse(STALE_REVISION_VALUE);

function renameGoalTo(graph: GraphV2, goal: string): GraphV2 {
  return { ...graph, goal: GOAL(goal) };
}

/**
 * atomic replace の失敗経路（fsync）を注入する。実ファイルシステムへの実際の open /
 * write は素通しし、返す FileHandle のうち sync だけを条件付きで失敗させる。vi.mock に
 * よるモジュール全体の置き換え（no-module-mocking）ではなく、実装が実際に呼ぶ関数を
 * spy で個別に差し替えるため、実ファイル I/O はそのまま動く。
 */
function installSyncFailureInjection() {
  let shouldThrow = false;
  const originalOpen = fsPromises.open.bind(fsPromises);
  vi.spyOn(fsPromises, "open").mockImplementation(async (...args) => {
    const handle = await originalOpen(...args);
    if (!shouldThrow) {
      return handle;
    }
    return {
      ...handle,
      writeFile: handle.writeFile.bind(handle),
      sync: async () => {
        throw new Error("sync 失敗を注入した");
      },
      close: handle.close.bind(handle),
    };
  });
  return {
    setShouldThrow: (value: boolean) => {
      shouldThrow = value;
    },
  };
}

describe("GraphStore.transaction — 基本", () => {
  let repositoryRoot: string;
  let store: GraphStore;

  beforeEach(async () => {
    repositoryRoot = makeRepositoryRoot();
    store = new GraphStore({ repositoryRoot });
    await store.initialize("テスト用ゴール");
  });

  afterEach(() => {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  });

  it("mutate の結果を永続化し、read() で読み直せる", async () => {
    expect.hasAssertions();

    const next = await store.transaction({}, (graph) => renameGoalTo(graph, "更新後"));

    expect(next.goal).toBe("更新後");
    const reloaded = await store.read();
    expect(reloaded.goal).toBe("更新後");
  });

  it("並行に呼んだ 2 つの transaction は直列化され、後続は先行の結果の上に適用される", async () => {
    expect.hasAssertions();
    // lost update の回帰: 直列化されていなければ、両方が同じベースを読んで
    // 片方の変更が消える
    const observedGoals: string[] = [];
    const appendSuffix =
      (suffix: string) =>
      (graph: GraphV2): GraphV2 => {
        observedGoals.push(graph.goal);
        return renameGoalTo(graph, `${graph.goal}${suffix}`);
      };

    await Promise.all([
      store.transaction({}, appendSuffix("A")),
      store.transaction({}, appendSuffix("B")),
    ]);

    // 先行の結果（A or B のどちらかが反映された goal）の上にもう一方が乗る
    const final = await store.read();
    expect(final.goal === "テスト用ゴールAB" || final.goal === "テスト用ゴールBA").toBe(true);
    expect(observedGoals).not.toContain("テスト用ゴールAB");
  });
});

describe("GraphStore.transaction — expected_revision", () => {
  let repositoryRoot: string;
  let store: GraphStore;

  beforeEach(async () => {
    repositoryRoot = makeRepositoryRoot();
    store = new GraphStore({ repositoryRoot });
    await store.initialize("テスト用ゴール");
  });

  afterEach(() => {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  });

  it("expected_revision が一致する場合は成功する", async () => {
    expect.hasAssertions();
    const current = await store.read();

    const next = await store.transaction({ expectedRevision: current.revision }, (graph) =>
      renameGoalTo(graph, "更新後"),
    );

    expect(next.goal).toBe("更新後");
  });

  it("expected_revision の不一致は RevisionConflictError で拒否され、書き込みも行われない", async () => {
    expect.hasAssertions();
    const before = readPersistedText(repositoryRoot);

    const error = await captureRejection(
      store.transaction({ expectedRevision: STALE_REVISION }, (graph) =>
        renameGoalTo(graph, "反映されるべきでない"),
      ),
    );

    expect(error).toBeInstanceOf(RevisionConflictError);
    if (!(error instanceof RevisionConflictError)) {
      throw new Error("RevisionConflictError になるべき");
    }
    expect(error.expectedRevision).toBe(STALE_REVISION);
    expect(error.actualRevision).toBe(0);
    // 自動リトライしないため、ファイルは変化しない
    expect(readPersistedText(repositoryRoot)).toBe(before);
  });
});

describe("GraphStore.transaction — mutate の失敗と検証", () => {
  let repositoryRoot: string;
  let store: GraphStore;

  beforeEach(async () => {
    repositoryRoot = makeRepositoryRoot();
    store = new GraphStore({ repositoryRoot });
    await store.initialize("テスト用ゴール");
  });

  afterEach(() => {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  });

  it("mutate が例外を投げた場合は永続化せず、mutex は解放されて後続が進める", async () => {
    expect.hasAssertions();

    await expect(
      store.transaction({}, () => {
        throw new Error("mutate 内の失敗");
      }),
    ).rejects.toThrow("mutate 内の失敗");

    const afterFailure = await store.read();
    expect(afterFailure.goal).toBe("テスト用ゴール");

    const recovered = await store.transaction({}, (graph) => renameGoalTo(graph, "回復後"));
    expect(recovered.goal).toBe("回復後");
  });

  it("契約を満たさないグラフを返した mutate の結果は永続化されない（永続化の境界で検証）", async () => {
    expect.hasAssertions();
    const before = readPersistedText(repositoryRoot);
    const current = await store.read();
    // SAFETY: revision は本来 revisionSchema（0 以上の整数）でしか作れないブランド型
    // だが、このテストは「永続化の境界で契約違反を検出できるか」を確かめるためだけに
    // 意図的に不正な値（-1）を持つ GraphV2 を組み立てている。
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 上記 SAFETY のとおり
    const invalid = { ...current, revision: -1 as GraphV2["revision"] };

    await expect(store.transaction({}, () => invalid)).rejects.toThrow(Error);

    expect(readPersistedText(repositoryRoot)).toBe(before);
  });
});

describe("GraphStore.transaction — atomic replace 失敗時のクリーンアップ", () => {
  let repositoryRoot: string;
  let store: GraphStore;
  let injection: ReturnType<typeof installSyncFailureInjection>;

  beforeEach(async () => {
    repositoryRoot = makeRepositoryRoot();
    store = new GraphStore({ repositoryRoot });
    await store.initialize("テスト用ゴール");
    injection = installSyncFailureInjection();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  });

  it("writeFile / sync の失敗でも一時ファイルを .ramune/ に残さない（失敗注入）", async () => {
    expect.hasAssertions();

    injection.setShouldThrow(true);
    await expect(
      store.transaction({}, (graph) => renameGoalTo(graph, "永続化されるべきでない")),
    ).rejects.toThrow("sync 失敗を注入した");
    injection.setShouldThrow(false);

    // 一時ファイルは掃除され、元のグラフは無傷のまま残る
    expect(fs.readdirSync(path.join(repositoryRoot, ".ramune"))).toStrictEqual(["graph.json"]);
    const afterFailure = await store.read();
    expect(afterFailure.goal).toBe("テスト用ゴール");

    // 掃除後も transaction は継続して使える
    const recovered = await store.transaction({}, (graph) => renameGoalTo(graph, "回復後"));
    expect(recovered.goal).toBe("回復後");
  });
});

describe("GraphStore.transaction — revision", () => {
  let repositoryRoot: string;
  let store: GraphStore;

  beforeEach(async () => {
    repositoryRoot = makeRepositoryRoot();
    store = new GraphStore({ repositoryRoot });
    await store.initialize("テスト用ゴール");
  });

  afterEach(() => {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  });

  it("store 自身は revision を加算しない（加算はドメイン層の transaction の責務）", async () => {
    expect.hasAssertions();
    const current = await store.read();

    const next = await store.transaction({}, (graph) => graph);

    expect(next.revision).toBe(current.revision);
  });
});

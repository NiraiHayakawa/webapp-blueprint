// GraphStore の公開契約（設計正本 §4）: initialize / read による初期化と読み戻し、
// および version !== 2 の拒否（v1 は transaction 前に raw のまま残す）。
//
// transaction（mutex 直列化・expected_revision 検査・atomic replace の失敗注入）は
// store-transaction.test.ts、v1 の退避は store-persistence.test.ts へ分割した。
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  GraphStore,
  GraphFileCorruptedError,
  GraphNotInitializedError,
  UnsupportedGraphVersionError,
} from "../src/store.ts";
import { createGraph, type GraphV2 } from "@webapp-blueprint/ramune-graph";
import {
  captureRejection,
  makeRepositoryRoot,
  readPersistedText,
  writeRawGraph,
  LEGACY_V1_RAW,
} from "./store-support.ts";

describe("GraphStore.initialize / read", () => {
  let repositoryRoot: string;

  beforeEach(() => {
    repositoryRoot = makeRepositoryRoot();
  });

  afterEach(() => {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  });

  it("ファイルが無ければ goal で初期グラフを作って永続化する", async () => {
    expect.hasAssertions();
    const store = new GraphStore({ repositoryRoot });

    const graph = await store.initialize("テスト用ゴール");

    expect(graph).toStrictEqual(createGraph("テスト用ゴール"));
    // SAFETY: 直前で store.initialize が書いた永続化フォーマットそのものを読み戻して
    // いるため、GraphV2 の形であることは書き込み側（store.ts）の契約から保証される。
    // この後の toStrictEqual(graph) がその形の食い違いを検出する。
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- 上記 SAFETY のとおり
    const persisted = JSON.parse(readPersistedText(repositoryRoot)) as GraphV2;
    expect(persisted).toStrictEqual(graph);
  });

  it("initialize の戻り値を read() で同値に読み戻せる", async () => {
    expect.hasAssertions();
    const store = new GraphStore({ repositoryRoot });
    const created = await store.initialize("テスト用ゴール");

    const loaded = await store.read();

    expect(loaded).toStrictEqual(created);
  });
});

describe("GraphStore: 永続化フォーマット", () => {
  let repositoryRoot: string;

  beforeEach(() => {
    repositoryRoot = makeRepositoryRoot();
  });

  afterEach(() => {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  });

  it("永続化フォーマットは整形済み JSON + 末尾改行であり、一時ファイルを残さない", async () => {
    expect.hasAssertions();
    const store = new GraphStore({ repositoryRoot });
    await store.initialize("テスト用ゴール");

    const text = readPersistedText(repositoryRoot);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.startsWith('{\n  "version": 2')).toBe(true);

    const directoryEntries = fs.readdirSync(path.join(repositoryRoot, ".ramune"));
    expect(directoryEntries).toStrictEqual(["graph.json"]);
  });

  it("既にファイルがある場合、initialize の goal は無視され既存内容が返る", async () => {
    expect.hasAssertions();
    const store = new GraphStore({ repositoryRoot });
    const first = await store.initialize("最初のゴール");

    const second = await store.initialize("無視されるべきゴール");

    expect(second).toStrictEqual(first);
  });
});

describe("GraphStore.read: 未初期化", () => {
  let repositoryRoot: string;

  beforeEach(() => {
    repositoryRoot = makeRepositoryRoot();
  });

  afterEach(() => {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  });

  it("ファイルも無く initialize もしていない状態での read() は GraphNotInitializedError", async () => {
    expect.hasAssertions();
    const store = new GraphStore({ repositoryRoot });

    await expect(store.read()).rejects.toThrow(GraphNotInitializedError);
  });
});

describe("GraphStore: version ゲート（§4）", () => {
  let repositoryRoot: string;

  beforeEach(() => {
    repositoryRoot = makeRepositoryRoot();
  });

  afterEach(() => {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  });

  it("version 1 のファイルに対する read() は UnsupportedGraphVersionError（Corrupted ではない）", async () => {
    expect.hasAssertions();
    writeRawGraph(repositoryRoot, LEGACY_V1_RAW);
    const store = new GraphStore({ repositoryRoot });

    const capturedError = await captureRejection(store.read());

    expect(capturedError).toBeInstanceOf(UnsupportedGraphVersionError);
    if (!(capturedError instanceof UnsupportedGraphVersionError)) {
      throw new Error("UnsupportedGraphVersionError になるべき");
    }
    expect(capturedError.actualVersion).toBe(1);
  });

  it("version 1 のファイルに対する transaction は、mutate を実行せず拒否する", async () => {
    expect.hasAssertions();
    writeRawGraph(repositoryRoot, LEGACY_V1_RAW);
    const store = new GraphStore({ repositoryRoot });
    let mutateCalled = false;

    await expect(
      store.transaction({}, (graph) => {
        mutateCalled = true;
        return graph;
      }),
    ).rejects.toThrow(UnsupportedGraphVersionError);

    expect(mutateCalled).toBe(false);
    // 変更操作よりも先に拒否されているため、raw ファイルはそのまま残る
    expect(readPersistedText(repositoryRoot)).toBe(LEGACY_V1_RAW);
  });
});

describe("GraphStore.read: 壊れたファイル", () => {
  let repositoryRoot: string;

  beforeEach(() => {
    repositoryRoot = makeRepositoryRoot();
  });

  afterEach(() => {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  });

  it("version フィールドが無い JSON オブジェクトは GraphFileCorruptedError", async () => {
    expect.hasAssertions();
    writeRawGraph(
      repositoryRoot,
      JSON.stringify({
        goal: "g",
        revision: 0,
        nextAllocationId: 1,
        session: { state: "inactive" },
        nodes: [],
      }),
    );
    const store = new GraphStore({ repositoryRoot });

    await expect(store.read()).rejects.toThrow(GraphFileCorruptedError);
  });

  it("JSON として壊れているファイルは SyntaxError のまま伝播する", async () => {
    expect.hasAssertions();
    writeRawGraph(repositoryRoot, "{ not valid json");
    const store = new GraphStore({ repositoryRoot });

    await expect(store.read()).rejects.toThrow(SyntaxError);
  });
});

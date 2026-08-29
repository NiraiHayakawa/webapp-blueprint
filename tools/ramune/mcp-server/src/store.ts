// .ramune/graph.json への単一 writer としての読み書き（設計正本 §4）。
//
// ドメインの形・不変条件は @webapp-blueprint/ramune-graph の責務であり、ここでは持たない
// （docs/principles/contract-is-ssot.md）。この store が持つ責務は次の通り:
//   1. 全ての変更を transaction() へ集約し、プロセス内では async mutex で明示的に直列化する。
//      HTTP transport（§5）ではリクエストが並行に届くため「同期ハンドラだから事実上
//      直列」という v1 の暗黙の性質に頼らない
//   2. 永続化は同一ディレクトリの一時ファイルへ書いて fsync → rename → 親ディレクトリ
//      fsync の atomic replace で行う。読み手は rename の瞬間以前か以降の完全な内容の
//      どちらかしか見ない（torn write を構造的に排除）
//   3. 判断系ツールのための expected_revision 検査を transaction の入口で行う。
//      mismatch は RevisionConflictError。自動リトライはしない（§7。失敗の隠蔽禁止）
//   4. version !== 2 のファイルは、いかなる変更よりも先に UnsupportedGraphVersionError で
//      拒否する。v1 ファイルの退避は archiveUnsupportedVersion()（raw のまま別名保存）という
//      明示操作だけが行う。runtime migration / 互換 alias は存在しない（絶対規約 3）
//   5. クロスプロセスのファイルロックは作らない。「writer は単一プロセス」は §5 の
//      port bind 排他が担う
//
// goal についての設計判断:
// ファイルが無い場合、goal を空文字列などで穴埋めして継続することはしない
// （原則2 fail-fast「デフォルト値フォールバックの禁止」）。作成は initialize(goal)
// のみが行い、goal はその引数で必ず受け取る。
//
// import/no-nodejs-modules: mcp-server/src/main.ts のコメント参照
// （apps/api と同じ扱いで、ディレクトリ一括除外ではなく行単位で抑制する）。
// oxlint-disable-next-line import/no-nodejs-modules -- 上のコメント参照。
import fs from "node:fs/promises";
// oxlint-disable-next-line import/no-nodejs-modules -- 上のコメント参照。
import path from "node:path";
import { z } from "zod";
import {
  createGraph,
  GRAPH_FILE_RELATIVE_PATH,
  parseGraph,
  type GraphV2,
} from "@webapp-blueprint/ramune-graph";
import { GraphFileCorruptedError } from "./graph-file-corrupted-error.ts";
import { GraphNotInitializedError } from "./graph-not-initialized-error.ts";
import { GraphArchiveTargetExistsError } from "./graph-archive-target-exists-error.ts";
import { isErrnoException } from "./is-errno-exception.ts";
import { persistGraphAtomically } from "./persist-graph-atomically.ts";
import { RevisionConflictError } from "./revision-conflict-error.ts";
import { UnsupportedGraphVersionError } from "./unsupported-graph-version-error.ts";

export { GraphFileCorruptedError } from "./graph-file-corrupted-error.ts";
export { GraphNotInitializedError } from "./graph-not-initialized-error.ts";
export { GraphArchiveTargetExistsError } from "./graph-archive-target-exists-error.ts";
export { RevisionConflictError } from "./revision-conflict-error.ts";
export { UnsupportedGraphVersionError } from "./unsupported-graph-version-error.ts";

/** グラフファイルの version フィールドが数値であることの境界検査。 */
const schemaVersionSchema = z.number();

export interface GraphStoreOptions {
  readonly repositoryRoot: string;
}

export interface TransactionOptions {
  /**
   * 判断系ツール（claim 系 / apply_ops / resume）は読み取った時点の revision を提示し、
   * 入口で一致検査を受ける。完了系ツール（fence で認証する操作）は指定せず、
   * 状態前提条件だけで競合を判定する（§4 の粒度分け）。
   */
  readonly expectedRevision?: GraphV2["revision"];
}

/** archiveUnsupportedVersion() の結果。退避の要否を呼び出し側が観測できる形で返す。 */
export type ArchiveUnsupportedVersionResult =
  | { readonly outcome: "archived"; readonly archivedTo: string }
  | { readonly outcome: "already_version_2" };

export class GraphStore {
  readonly #filePath: string;
  readonly #directory: string;
  /** 直前の排他区間の完了を表す Promise。これへの連結で async mutex を実現する。 */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(options: GraphStoreOptions) {
    this.#filePath = path.join(options.repositoryRoot, GRAPH_FILE_RELATIVE_PATH);
    this.#directory = path.dirname(this.#filePath);
  }

  /** グラフを読んで検証して返す。変更は行わない（ramune_read_graph 用）。 */
  async read(): Promise<GraphV2> {
    const raw = await this.#readRawText();
    return this.#parseOrClassify(raw);
  }

  /**
   * ファイルが存在すればそれを返し、無ければ渡された goal で初期グラフを作って
   * 永続化してから返す（ramune_start 用）。goal はこの呼び出しで必須の入力であり、
   * 省略時の補完は存在しない。
   */
  async initialize(goal: string): Promise<GraphV2> {
    return await this.#exclusive(async () => {
      const existing = await this.#loadInsideLock();
      if (existing !== undefined) {
        return existing;
      }
      const graph = createGraph(goal);
      await this.#persist(graph);
      return graph;
    });
  }

  /**
   * グラフへの全ての変更の唯一の入口（§4）。
   *
   * 排他区間内で「読み込み → 検証 → expected_revision 検査 → 遷移 → 永続化」を行う。
   * mutate は現在のグラフを受け取り、次の状態を返す純粋な遷移であり、ドメイン層の
   * 差分操作を組み立てる責務を持つ（store はドメイン操作を持たない）。mutate が例外を投げたら永続化は行われず、
   * 例外はそのまま伝播する。戻り値は永続化済みの次のグラフ。
   *
   * expectedRevision を指定した場合、読み込んだグラフの revision との一致を
   * 入口で検査する。不一致は RevisionConflictError であり、自動リトライは
   * 行われない。呼び出し側が read() で読み直して判断からやり直すこと。
   */
  async transaction(
    options: TransactionOptions,
    mutate: (graph: GraphV2) => GraphV2 | Promise<GraphV2>,
  ): Promise<GraphV2> {
    return await this.#exclusive(async () => {
      const current = await this.#requireLoadedGraph();
      if (options.expectedRevision !== undefined && options.expectedRevision !== current.revision) {
        throw new RevisionConflictError(options.expectedRevision, current.revision);
      }
      const next = await mutate(current);
      await this.#persist(next);
      return next;
    });
  }

  /**
   * サポート外バージョンのグラフファイルを、中身を解釈せず raw バイトのまま
   * 同一ディレクトリの別名へ退避する明示操作（§4。v1 ファイルの取り扱い）。
   * 退避後、元のパスにはファイルが無いため initialize() で version 2 として
   * 初期化できる。既に version 2 の場合は何もせずその旨を返す。
   */
  async archiveUnsupportedVersion(): Promise<ArchiveUnsupportedVersionResult> {
    return await this.#exclusive(async () => {
      const raw = await this.#readRawText();
      const version = GraphStore.#peekSchemaVersion(raw);
      if (version === undefined) {
        // version を読めないファイルは退避対象として名指しできないため、
        // 通常の壊れたファイルとして扱う（silent に消さない）
        throw new GraphFileCorruptedError(
          this.#filePath,
          "version フィールドを持つ JSON オブジェクトではない",
        );
      }
      if (version === 2) {
        return { outcome: "already_version_2" };
      }
      return await this.#archiveRawText(raw, version);
    });
  }

  /** サポート外バージョンの raw テキストを別名へ退避し、元ファイルを取り除く。 */
  async #archiveRawText(raw: string, version: number): Promise<ArchiveUnsupportedVersionResult> {
    const archivedTo = path.join(this.#directory, `graph.v${String(version)}.backup.json`);
    try {
      await fs.writeFile(archivedTo, raw, { encoding: "utf-8", flag: "wx" });
    } catch (error) {
      if (isErrnoException(error) && error.code === "EEXIST") {
        throw new GraphArchiveTargetExistsError(archivedTo);
      }
      throw error;
    }
    await fs.unlink(this.#filePath);
    return { outcome: "archived", archivedTo };
  }

  /**
   * プロセス内の async mutex。#queue への連結により、排他区間は開始順に実行され、
   * ある区間の失敗が後続の区間を詰まらせない。クロスプロセスの排他は意図的に
   * 存在しない（§4。二重起動の排除は §5 の port bind が担う）。
   */
  async #exclusive<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.#queue;
    const run = (async () => {
      try {
        await previous;
      } catch {
        // 直前の区間の失敗を握りつぶすのではなく、実行順序を守るためだけに待つ。
        // 直前の失敗自体は、その呼び出し元が受け取った Promise が既に伝えている。
      }
      return await task();
    })();
    this.#queue = (async () => {
      try {
        await run;
      } catch {
        // 同上。#queue はチェーン用の完了シグナルであり、値・エラーは運ばない。
        // このタスクの成否は呼び出し元へ返す `run` が伝える。
      }
    })();
    return await run;
  }

  async #readRawText(): Promise<string> {
    try {
      return await fs.readFile(this.#filePath, "utf-8");
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        throw new GraphNotInitializedError(this.#filePath);
      }
      throw error;
    }
  }

  /** 生テキストを検証して GraphV2 へ変換する。version 判定はスキーマ検査より先に行う。 */
  #parseOrClassify(raw: string): GraphV2 {
    const version = GraphStore.#peekSchemaVersion(raw);
    if (version !== undefined && version !== 2) {
      // スキーマ検査より先に version を名指しして拒否する（§4。v1 は ZodError の
      // 詳細ではなく「サポートしないバージョン」として扱われるべき）
      throw new UnsupportedGraphVersionError(this.#filePath, version);
    }
    try {
      return parseGraph(raw);
    } catch (error) {
      // parseGraph は「形が契約を満たさない」を ZodError、「JSON として壊れている」を
      // SyntaxError で投げ分ける。形の違反だけを GraphFileCorruptedError に読み替え、
      // SyntaxError はそのまま伝播させる（どちらも握りつぶさない）。
      if (error instanceof z.ZodError) {
        throw new GraphFileCorruptedError(this.#filePath, z.prettifyError(error));
      }
      throw error;
    }
  }

  /**
   * raw JSON から version フィールドだけを覗き見する。グラフ全体のスキーマ検査は
   * 行わない（v1 ファイルを「parse せず」扱うため。§4）。読めなければ undefined。
   */
  static #peekSchemaVersion(raw: string): number | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    if (!(parsed instanceof Object) || !("version" in parsed)) {
      return undefined;
    }
    const result = schemaVersionSchema.safeParse(parsed.version);
    return result.success ? result.data : undefined;
  }

  /** 排他区間内でグラフを読む。ファイルが無ければ undefined を返す（initialize 専用）。 */
  async #loadInsideLock(): Promise<GraphV2 | undefined> {
    try {
      const raw = await fs.readFile(this.#filePath, "utf-8");
      return this.#parseOrClassify(raw);
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  /** 排他区間内でグラフを読む。無ければ GraphNotInitializedError（変更の前提条件）。 */
  async #requireLoadedGraph(): Promise<GraphV2> {
    const graph = await this.#loadInsideLock();
    if (graph === undefined) {
      throw new GraphNotInitializedError(this.#filePath);
    }
    return graph;
  }

  /**
   * 永続化するバイト列が GraphV2 契約を満たすことを、atomic replace（実体は
   * persist-graph-atomically.ts）へ渡す前に parseGraph で確認する（store が
   * 壊れたバイト列をディスクへ出さないことを永続化の境界で保証する）。
   */
  async #persist(graph: GraphV2): Promise<void> {
    const text = `${JSON.stringify(graph, null, 2)}\n`;
    parseGraph(text);
    await persistGraphAtomically(this.#directory, this.#filePath, text);
  }
}

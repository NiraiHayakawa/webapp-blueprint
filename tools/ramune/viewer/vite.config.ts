// oxlint-disable-next-line import/no-nodejs-modules -- このファイルはビルド時/開発サーバの Node プロセスでのみ実行され、ブラウザに配信される tools/ramune/viewer のコードには含まれない（import/no-nodejs-modules が防ごうとしている「ブラウザ配信コードへの node: 混入」に該当しない）。
import { readFile } from "node:fs/promises";
// oxlint-disable-next-line import/no-nodejs-modules -- 上のコメント参照。
import path from "node:path";
import type { Connect } from "vite";
import { defineConfig } from "vitest/config";
import { z } from "zod";

// tools/ramune/viewer 専用の vite/vitest 設定。
//
// - dev/build/preview は vite（移設元 ramune リポジトリでは
//   e2e/playwright.config.ts が `pnpm --filter ./apps/viewer run preview` の
//   4173 番ポートに依存する契約を持っていた。webapp-blueprint の e2e/ は
//   2026-08-09 時点でこの viewer をまだ配線しておらず、同様の契約は存在
//   しない — 配線する場合は `pnpm --filter ./tools/ramune/viewer run preview`
//   に読み替えること）。
// - .ramune/graph.json はリポジトリ直下の実行時生成物であり、.gitignore 済み
//   （clone 直後には存在しない）。当初は public/graph.json をそこへの
//   シンボリックリンクとして置き、Vite の既定の public 配信に委ねていたが、
//   その方式は「viewer のビルドが実行時生成物の存在に依存する」欠陥を持って
//   いた（clone 直後は symlink が dangling になり、`vite build` が
//   public ディレクトリのコピー処理で ENOENT を投げて落ちる。2026-08-08 に
//   `mise run test:e2e` の失敗として実測）。symlink をやめ、`/graph.json`
//   へのリクエストをミドルウェアでリポジトリ直下の .ramune/graph.json に
//   都度中継する方式に切り替える。これで viewer のビルド自体は
//   .ramune/graph.json の有無と無関係になる。
// - dev（`vite`）と preview（`vite preview`。e2e が使う）の両方でこの
//   ミドルウェアが要る。Vite の Plugin フックはこの2つを別々に持つため
//   （configureServer は dev、configurePreviewServer は preview）、
//   同じハンドラを両方の hook から呼ぶ。
// - server.middlewares.use(...) をフック内で直接呼ぶ（関数を return しない）。
//   Vite は configureServer/configurePreviewServer から関数が return
//   された場合はそれを「内部ミドルウェア設置後」に呼ぶが、直接
//   server.middlewares.use(...) を呼んだ場合は内部ミドルウェアより前に
//   差し込まれる（Vite の Plugin API のドキュメントに明記された挙動）。
//   `/graph.json` は public ディレクトリにもう存在しないため、内部の
//   静的配信/フォールバックより先にこのミドルウェアで応答を確定させる。
// - ミドルウェアは .ramune/graph.json の中身を検証しない（読んでそのまま
//   返すだけ）。形の検証（fail-fast）は src/lib/graph-source/graph-source.ts
//   の責務であり、ここに持ち込むと @webapp-blueprint/ramune-graph への実行時依存が生まれ、
//   「viewer は .ramune/graph.json を読むだけ・@webapp-blueprint/ramune-graph への依存は型のみ」
//   という疎結合の要件を壊す。
// - test.environment は apps/web の vitest.config.ts と同じ理由で "node"
//   にする: features/components は DOM API に依存しない純粋関数として
//   実装しており、jsdom は catalog に pin されていないため導入しない
//   （実 DOM の検証は e2e/ の Playwright が担う）。

const GRAPH_JSON_REQUEST_PATH = "/graph.json";
const HTTP_STATUS_OK = 200;
const HTTP_STATUS_NOT_FOUND = 404;

// Connect.NextHandleFunction の第2引数・第3引数の型をそのまま再利用する
// （node:http を追加 import せずに ServerResponse / next の型を得るため）。
type ConnectHandlerParams = Parameters<Connect.NextHandleFunction>;
type ConnectResponse = ConnectHandlerParams[1];
type ConnectNext = ConnectHandlerParams[2];

/**
 * .ramune/graph.json を読んだ結果。「まだ存在しない」ことは正当な状態であり
 * silent fallback ではなく明示的な結果として表現する（docs/principles/fail-fast.md
 * の対象は「失敗を隠すこと」であり、「まだ存在しない」という事実を判別可能な
 * 形で返すことはこれに反しない）。ENOENT 以外の読み取り失敗（権限エラー等）は
 * ここでは吸収せず、呼び出し元に投げ返す。
 */
type GraphJsonReadResult =
  | { readonly found: true; readonly content: string }
  | { readonly found: false };

function resolveGraphJsonFilePath(): string {
  // tools/ramune/viewer/vite.config.ts から見てリポジトリ直下は3階層上。
  return path.resolve(import.meta.dirname, "../../../.ramune/graph.json");
}

// 「ファイルが無い」という事実は、node:fs が投げる例外の `code` プロパティに
// しか現れない。@types/node の NodeJS.ErrnoException は catch 節の unknown を
// 狭める手段を与えないため、ここも他の I/O 境界と同じくスキーマで読む
// （`Reflect.get` で生の値を覗くより、何を期待しているかが宣言として残る）。
// z.looseObject なので、Error インスタンスが持つ他のプロパティは素通りする。
const enoentErrorSchema = z.looseObject({ code: z.literal("ENOENT") });

async function readGraphJson(): Promise<GraphJsonReadResult> {
  try {
    const content = await readFile(resolveGraphJsonFilePath(), "utf-8");
    return { found: true, content };
  } catch (error) {
    if (!(error instanceof Error) || !enoentErrorSchema.safeParse(error).success) {
      throw error;
    }
    return { found: false };
  }
}

function respondWithGraphJson(res: ConnectResponse, content: string): void {
  res.statusCode = HTTP_STATUS_OK;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(content);
}

/**
 * ramune を一度も実行していないことは正当な状態であり、silent fallback ではなく
 * 明示的に「まだ無い」と答える。
 */
function respondGraphJsonNotFound(res: ConnectResponse): void {
  res.statusCode = HTTP_STATUS_NOT_FOUND;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(
    "ramune をまだ実行していないため .ramune/graph.json が存在しない（`mise run mcp:ramune` 等で ramune を実行するとグラフが生成される）",
  );
}

/**
 * `/graph.json` へのリクエストをリポジトリ直下の .ramune/graph.json に中継する。
 * readGraphJson が投げた「本当の失敗」（ENOENT 以外）は `next(error)` で
 * Vite のエラーハンドリングに渡し、隠蔽しない（fail-fast）。
 */
async function respondToGraphJsonRequest(res: ConnectResponse, next: ConnectNext): Promise<void> {
  let result: GraphJsonReadResult;
  try {
    result = await readGraphJson();
  } catch (error) {
    next(error);
    return;
  }
  if (!result.found) {
    respondGraphJsonNotFound(res);
    return;
  }
  respondWithGraphJson(res, result.content);
}

/**
 * Connect ミドルウェアは同期関数として登録する（Express/Connect は
 * async ハンドラの reject を自動では捕捉しないため、`void` で意図的に
 * fire-and-forget にする。失敗の転送は respondToGraphJsonRequest 自身の
 * try/catch が担う）。
 */
const serveGraphJson: Connect.NextHandleFunction = (req, res, next) => {
  if (req.url !== GRAPH_JSON_REQUEST_PATH) {
    next();
    return;
  }
  void respondToGraphJsonRequest(res, next);
};

export default defineConfig({
  plugins: [
    {
      name: "ramune-serve-graph-json",
      configureServer(server) {
        server.middlewares.use(serveGraphJson);
      },
      configurePreviewServer(server) {
        server.middlewares.use(serveGraphJson);
      },
    },
  ],
  test: {
    environment: "node",
    globals: false,
  },
});

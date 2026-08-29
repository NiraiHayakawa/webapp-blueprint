// serve-built-frontend.mjs
// これは配線の実証であり、消して始めてよい（docs/plan/Template/20260807_template-design.md §9）。
//
// apps/web のビルド済み出力（apps/web/dist）だけを静的配信する薄いサーバ。
// バックエンド（apps/api）には一切繋がない（§9「この縦切りは契約層の境界を越えない」）。
// 新規の npm 依存を追加しないため、node:http / node:fs のみで実装している。

import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../apps/web/dist", import.meta.url));
const port = 4173;

/** @type {Record<string, string>} */
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

const server = createServer((req, res) => {
  // handleRequest は内部の try/catch が全ての失敗を 404 応答に変換しており
  // reject しない。http.createServer のコールバック型は void 返却を期待する
  // ため（no-misused-promises / strict-void-return）、ここでは async 関数の
  // 返り値を待たず明示的に無視する。
  void handleRequest(req, res);
});

/**
 * リクエスト URL から配信対象のファイルパスを解決する。
 * @param {import("node:http").IncomingMessage} req
 * @returns {string}
 */
function resolveFilePath(req) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const requestedPath = path.normalize(decodeURIComponent(url.pathname));

  let relativePath = requestedPath;
  if (requestedPath === "/") {
    relativePath = "/index.html";
  }

  return path.join(root, relativePath);
}

/**
 * ファイルを読み込んで 200 応答として書き出す。ファイルが存在しない・
 * ディレクトリである場合は呼び出し側の catch に委ねるため、そのまま throw する。
 * @param {import("node:http").ServerResponse} res
 * @param {string} filePath
 */
async function respondWithFile(res, filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error("not a file");
  }
  const body = await readFile(filePath);
  res.writeHead(HTTP_OK, {
    "content-type": contentTypes[path.extname(filePath)] ?? "application/octet-stream",
  });
  res.end(body);
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
async function handleRequest(req, res) {
  const filePath = resolveFilePath(req);

  try {
    await respondWithFile(res, filePath);
  } catch {
    res.writeHead(HTTP_NOT_FOUND);
    res.end("not found");
  }
}

server.listen(port, () => {
  // eslint系はこのパッケージの対象外（oxlint はこのリポジトリ全体を対象にするが、
  // console 出力自体を禁止するルールは設定されていない前提。禁止されていた場合は
  // 抑制コメントに理由を書くこと・原則4）。
  console.log(`serving apps/web/dist at http://127.0.0.1:${port}`);
});

// check-unused-steps.mjs
//
// 未使用 step 検出ゲート（docs/plan/Template/20260807_template-design.md §4「機械強制」表、
// 受入条件13「E2E 側は未定義 step と未使用 step の双方が CI で検出される」の受け皿）。
//
// playwright-bdd は `bddgen export --unused-steps` で未使用 step を一覧表示できるが、
// 検出件数に関わらず exit code は常に 0 を返す（2026-08-08、playwright-bdd 9.2.0 で実測）。
// つまり検出手段はあるが、それ単体では CI ゲートにならない。このスクリプトは出力を
// 解析し、1 件以上検出されたら非ゼロで終了させる薄いラッパーである。

import { spawnSync } from "node:child_process";

const result = spawnSync("pnpm", ["exec", "bddgen", "export", "--unused-steps"], {
  cwd: import.meta.dirname,
  encoding: "utf-8",
});

if (result.error) {
  throw result.error;
}

process.stdout.write(result.stdout ?? "");
if (result.stderr) {
  process.stderr.write(result.stderr);
}

if (result.status === 0) {
  const match = /^Unused steps \((?<count>\d+)\):/mu.exec(result.stdout ?? "");
  if (!match) {
    // 出力形式が変わっていた場合、件数を誤読して検出漏れのまま緑になることを防ぐため
    // fail-fast する(原則2)。既知の出力形式(playwright-bdd 9.2.0 で確認済み)と
    // 一致しないのは版差分か想定外の破壊的変更であり、silent fallback で握り潰さない。
    throw new Error(
      "bddgen export --unused-steps の出力から検出件数を抽出できなかった。" +
        "playwright-bdd のバージョンが変わり出力形式が変化した可能性がある。",
    );
  }

  const unusedCount = Number(match.groups?.["count"]);
  if (unusedCount > 0) {
    console.error(
      `\n未使用 step が ${unusedCount} 件検出された。上記の一覧を参照し、step を削除するか使用箇所を追加すること。`,
    );
    process.exitCode = 1;
  }
} else {
  // bddgen 自体が失敗した場合（設定エラー等）はそのまま伝播する。
  // process.exit() ではなく exitCode を設定するだけにする理由: process.exit()
  // は標準出力への書き込みが完了する前にプロセスを終了させることがあり、
  // 直前の process.stdout.write / process.stderr.write が切れる可能性がある
  // （Node.js 公式ドキュメントが明記する既知の問題。unicorn/no-process-exit の
  // 推奨に合わせて exitCode に変更する）。
  process.exitCode = result.status ?? 1;
}

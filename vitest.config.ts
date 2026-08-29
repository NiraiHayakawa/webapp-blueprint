import { defineConfig } from "vitest/config";

// ルートの vitest 設定（§4「テスト戦略」/ §5 選定ツール）。
//
// 各ワークスペースパッケージ（apps/*, packages/*, tools/*）はそれぞれ独自の
// vitest 設定と "test" script を持ち、mise.toml の `test` task
// （`pnpm -r --if-present run test`）がそれらに委譲する。
//
// tests/policy/ はそのどのワークスペースにも属さない
// （pnpm-workspace.yaml のコメント参照: tests/policy/ と scripts/ は
// pnpm workspace パッケージではない）。そのため mise.toml の
// `test:policy` task はルートの vitest を直接呼ぶ
// （`pnpm exec vitest run tests/policy`）。この設定ファイルはその実行の
// ためだけに存在する。
//
// include を tests/policy/ に絞っているのは意図的。デフォルトの
// include（**/*.{test,spec}.*）のままだと、各ワークスペースパッケージが
// 持つ独自のテストファイルまでルートの vitest がスキャンしてしまい、
// パッケージごとの vitest 設定（environment・setupFiles 等）を無視した
// 状態で二重に実行されてしまう。
export default defineConfig({
  test: {
    include: ["tests/policy/**/*.{test,spec}.ts"],
    environment: "node",
    // strict な tsconfig（noUnusedLocals 等）と合わせ、暗黙 globals に
    // 頼らず describe/it/expect を明示 import する運用にする。
    globals: false,
    // tests/policy/ にテストが 1 件もない状態は「対象ゼロの緑」であり、
    // 受入条件1が明示的に不合格とする状態と同じ種類の空振り。そのため
    // passWithNoTests は設定しない（既定 false のまま）。ここが空振りする
    // ときは vitest 自体が非ゼロ終了で知らせるのが正しい振る舞い。
  },
});

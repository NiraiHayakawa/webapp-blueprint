// ファイル名について: 当初 `.oxlintrc.json` を実体として置いていたが、ultracite の
// oxlint preset（`ultracite/oxlint/*`）は `defineConfig({ ... })` を default export する
// TS/JS モジュールとして配布されており、`.oxlintrc.json` の `extends` はファイルパスの
// 文字列配列しか受け付けない（oxlint 1.76.0 で実測: JSON 以外の config へのパス指定は
// "Only JSON configuration files are supported" で loud fail する）。JS のオブジェクトを
// import してそのまま渡す `extends: [core, ...]` の書き方は `oxlint.config.ts` /
// `oxlint.config.mts` 側の型（`OxlintConfig["extends"]: OxlintConfig[]`）でのみ可能。
// preset を実際に extends するにはこの形式が必須のため、oxlint が自動探索する
// 4 種の設定ファイル名のうち `.oxlintrc.json` から `oxlint.config.ts` に切り替える
// （mise.toml の lint task は `-c` を渡さず自動探索に依存しているため変更不要）。
// 設計の経緯（2026-08-08）: 全カテゴリ "error" の opt-out 方式は Go / golangci-lint の
// 作法であり、TypeScript / oxlint の作法ではない。ultracite の opt-out 方式の厳格
// preset を extends し、preset が off にしているが本テンプレートに必要なルールだけを
// 明示的に再有効化する（opt-out 方式: 全部厳格 → 必要な箇所だけ緩める）。
import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
// 採用テストランナーである vitest（§4）の誤用検出を preset 側に委ねる。
// core だけでは vitest プラグイン自体が入らず、テストファイルの検査が
// 丸ごと欠落する（core の対象は browser env と汎用の test override のみ）。
import vitestPreset from "ultracite/oxlint/vitest";

// react / vue / jsx-a11y / nextjs 等のフレームワーク別 preset は入れていない。
// フロントエンドのUIコンポーネントライブラリの選定は本テンプレートの非対象
// （design doc 冒頭「非対象」節）であり、apps/web が実際にフレームワークを選んだ
// ADR の後に追加すべきもの。先に入れると存在しないフレームワークのルールが
// 常時 no-op で走るだけになる。
export default defineConfig({
  extends: [core, vitestPreset],

  // anti-slop（ADR 0009 / docs/recipes/tools/typescript.md「anti-slop — 個別の
  // 丁寧な記録」）。vendor したプラグインの相対 specifier は、extends した設定側
  // に書くと oxlint が拒否する（2026-08-18 実測: "Relative JS plugin specifiers
  // are not supported in configs provided via `extends`"）。ルート設定に置く。
  jsPlugins: [{ name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" }],

  // vitest プラグインは preset（vitestPreset）内でテストファイル向けの
  // override としてのみ有効化されており、トップレベルの plugins には
  // 含まれない。以下の overrides で `vitest/*` を上書きするために、
  // このファイル自身のスコープでも明示しておく（2026-08-08 に実測:
  // これを欠くと override 内の `vitest/*` の再設定が無効になり、preset の
  // 既定値が勝ち続ける）。
  plugins: ["vitest"],

  // mise.toml の lint task は CLI フラグ `--type-aware` で型情報付き診断を有効にして
  // いるが、エディタ拡張など CLI を経由しない実行経路のために config 側にも明示する
  // （options.typeAware は CLI フラグと同義。実行時のスキーマ確認: oxlint 1.76.0 は
  // トップレベルの `typeAware` を受け付けず `options.typeAware` のみを認識する）。
  options: {
    typeAware: true,
  },

  // ルールごとの再設定。preset（core / vitest）の既定と本テンプレートの要件が
  // ずれる箇所だけを列挙する。preset が既にこちらの要件どおりに設定している
  // ルール（例: capitalized-comments・no-rest-spread-properties・no-continue・
  // no-relative-parent-imports・no-named-export・prefer-default-export・
  // no-top-level-await・no-async-await・no-optional-chaining・no-undefined・
  // init-declarations・new-cap・typescript/require-await・
  // typescript/prefer-readonly-parameter-types・import/max-dependencies 等）は
  // 二重管理を避けるためここには書かない（原則8「検査ロジックの二重管理を禁止」）。
  rules: {
    // anti-slop の 15 ルールは全て "error"（ADR 0009）。preset の再設定ではなく
    // 新規追加なので、ルールごとではなく 1 つの決定としてまとめる。ここから 1 つ
    // でも外すときは ADR 0009 を上書きする ADR を書くこと。
    // 例外は tools/ramune/hooks/src/role.ts の 2 行のみ（ADR 0004 との衝突。
    // 理由は当該行のコメント）。ここで overrides にせず行単位に留めている。
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
    // eslint/sort-keys: preset は "error"。blume.config.ts のトップレベルキー
    // （content → i18n → search → ai → deployment）を design doc §6 の表と同じ
    // 順序に意図的に揃えており、アルファベット順に並べ替えると仕様書の表との
    // 対応が読み取れなくなる。設定ファイル全般で「意味のある順序」を選ぶ
    // 本プロジェクトの書き方と構造的に噛み合わない(元の .oxlintrc.json でも
    // 全体 off だった)。
    "eslint/sort-keys": "off",

    // eslint/func-style: preset は ["error", "expression", ...]（アロー関数の
    // const 代入を要求）。本テンプレートは 40 ファイル超で named function
    // declaration（相互再帰・ホイスティングに依存した記述を含む）を一貫して
    // 使っており、preset の既定は既存の一貫した書き方と逆。off にはせず
    // 既存の書き方を正として設定し直す。
    "eslint/func-style": ["error", "declaration", { allowArrowFunctions: true }],

    // eslint/require-await: preset は "error"（typescript/require-await は
    // preset 側で既に off）。typescript/promise-function-async（preset も
    // "error"）と組みになる自己矛盾ペア。port / interface の契約が
    // `Promise<T>` を返すことを要求する pass-through 実装（driving adapter・
    // フェイク実装）は async を外せない。2026-08-08 に実測: 対象は
    // apps/web/src/lib/api/greeting-api.ts のフェイク実装と
    // apps/web/src/features/greeting/greeting.spec.ts の 2 箇所のみ。
    "eslint/require-await": "off",

    // import/consistent-type-specifier-style: preset は ["error",
    // "prefer-top-level"]。preset の no-duplicate-imports は
    // allowSeparateTypeImports: true で、値と型を 1 つの import 文にまとめる
    // 書き方（`import { foo, type Bar } from "mod"`）を許容する一方、この
    // ルールは型だけの specifier を別の top-level `import type` 文に分けろと
    // 要求し、両立しない。inline `type` 修飾子で 1 文にまとめる書き方を正とする。
    "import/consistent-type-specifier-style": "off",

    // eslint/no-magic-numbers: preset は "off"（restriction 由来のピックリスト
    // ルールとして preset が既定で見送っている）。既定（ignore 無し）だと
    // `0` `1` のような比較・添字にまで反応してノイズが大きい一方、意味のある
    // named constant を要求する価値自体は原則7の趣旨と一致するため、
    // ルールごと off にはせず -1/0/1/2 の 4 値だけを ignore して再有効化する
    // （原則4「抑制は影響範囲の狭い順に選ぶ」）。2026-08-08 に
    // `oxlint --type-aware .` を実行し、この ignore で残る違反が 0 件である
    // ことを確認した（実装が既に named constant を使っている）。
    "eslint/no-magic-numbers": ["error", { ignore: [-1, 0, 1, 2] }],

    // import/no-nodejs-modules・node/no-sync・eslint/no-console:
    // preset はいずれも "off"（ブラウザ/汎用フレームワーク横断で無難な既定）。
    // 本テンプレートは apps/web（ブラウザに配信される）・apps/api（長時間稼働
    // する Node サーバ）で意図的にこれらを "error" に戻す:
    // - import/no-nodejs-modules: node: 組み込みモジュールがブラウザ配信コード
    //   に紛れ込むことを防ぐ。
    // - node/no-sync: 長時間稼働のサーバでイベントループを塞ぐ同期 I/O を防ぐ。
    // - eslint/no-console: アプリケーションコードに debug 用の console.log が
    //   残留することを防ぐ（CLI・tooling の意図的な標準出力とは種類が異なる）。
    // Node 専用の CLI / テスト / tooling コード（下の overrides）はいずれも
    // 対象外にする。2026-08-08 に `oxlint --type-aware apps/web apps/api` を
    // 実行し、この再有効化で新規違反が 0 件であることを確認した。
    "import/no-nodejs-modules": "error",
    "node/no-sync": "error",
    "eslint/no-console": "error",

    // 複雑度・肥大の検出を明示的に再有効化する（spec 原則7「拡張はファイル
    // 追加で表現される。既存ファイルの行数純増は分割サイン」の受け皿）。
    // preset（core）は max-depth・max-lines・max-lines-per-function・
    // max-params・max-statements を "off" にしている
    // （max-classes-per-file のみ preset で既に "error"）。閾値は指定しない
    // （= oxlint の既定閾値のまま。元の .oxlintrc.json も閾値を指定していない）。
    "eslint/max-classes-per-file": "error",
    "eslint/max-depth": "error",
    "eslint/max-lines": "error",
    "eslint/max-lines-per-function": "error",
    "eslint/max-params": "error",
    "eslint/max-statements": "error",
  },

  overrides: [
    {
      // *.config.ts は host 側のツール（blume / vitest / playwright 等）が
      // `import config from "./x.config.ts"` の形で default export を
      // 要求する契約になっている。import/no-default-export はこの
      // 1 ファイルカテゴリに限って対象外にする。
      files: ["**/*.config.ts", "**/*.config.mts"],
      rules: {
        "import/no-default-export": "off",
      },
    },
    {
      // Node 専用の CLI / テスト / tooling コード（tests/policy, tools/,
      // scripts/, e2e/ の *.mjs・*.ts）。ブラウザに届くアプリケーションコード
      // (apps/web) でも長時間稼働の Node サーバ (apps/api) でもない、
      // 一回実行で終わる CLI・テストプロセス。
      //
      // tools/ramune/graph/test・tools/ramune/mcp-server/test・tools/ramune/hooks
      // を追加した理由（2026-08-09、ramune 統合時に判断）: いずれも
      // tests/policy・e2e と同じ「一回実行で終わる」カテゴリに該当する
      // （graph/test は .feature ファイル解決に `node:url`、mcp-server/test は
      // 一時ディレクトリの setup/teardown に `node:fs`/`node:os`/`node:path` の
      // 同期 API を使う）。tools/ramune/hooks（src/test 双方）は Claude Code の
      // PreToolUse hook 本体であり、ツール呼び出しごとに毎回新しいプロセスとして
      // 起動されては即座に終了する（サーバのようにプロセスを維持し続けて複数の
      // 呼び出しを裁くことはしない）。したがって「イベントループを塞ぐ同期 I/O
      // を避ける」という長時間稼働サーバ向けの理由（apps/api）が当てはまらず、
      // `.ramune/graph.json` を毎回同期的に読む（mode.ts）ことも問題にならない。
      // tools/ramune/git を追加した理由(2026-08-24、並列実行 WP6): node:child_process
      // が必須。src は同期 I/O を使わず async、test は同期 API(一回実行カテゴリ)。
      // 一方 tools/ramune/mcp-server/src（stdio サーバ本体）は対象に含めない —
      // apps/api と同じ「長時間稼働の Node サーバ」であり、1プロセスが複数の
      // MCP リクエストを継続して処理し続けるため、rule は有効のまま行単位で
      // 抑制する（main.ts / store.ts 参照）。tools/ramune/viewer はブラウザ配信
      // コードであり対象外（vite.config.ts の node: import のみ、ファイル自身に
      // 理由付きの行単位抑制がある）。
      files: [
        "tests/policy/**",
        "tools/architecture/**",
        "tools/ramune/graph/test/**",
        "tools/ramune/mcp-server/test/**",
        "tools/ramune/hooks/**",
        "tools/ramune/git/**",
        "scripts/**",
        "e2e/**",
      ],
      rules: {
        // node: 組み込みモジュールの import はこれらのコードの目的そのもの。
        "import/no-nodejs-modules": "off",
        // 同期 API（readFileSync 等）。一回実行で終わるプロセスであり、
        // 同期 I/O が他のリクエストの待ち時間に影響することがない。
        // ts-morph（tools/architecture の必須依存）自体も同期 API のみを提供する。
        "node/no-sync": "off",
        // console 出力。CLI の観測可能な結果として mise.toml の各 task が
        // 実際に使っており、アプリケーションコードの debug 用 console.log
        // とは種類が異なる。
        "eslint/no-console": "off",
        // jsdoc/require-param-description・require-returns-description:
        // これらのディレクトリの JSDoc `@param`/`@returns` は plain JS
        // （.mjs）に型情報を与えるための型注釈としての用途が主で、prose の
        // 説明文を書く運用にしていない（2026-08-08 に実測: 該当 48 件は
        // scripts/・e2e/ の一行ヘルパーで、関数名・param 名だけで意図が
        // 読み取れるもの）。apps/web・apps/api の型は TypeScript の型注釈
        // そのものが担うためこの対象にならず、影響はこのディレクトリ群に閉じる。
        "jsdoc/require-param-description": "off",
        "jsdoc/require-returns-description": "off",
      },
    },
    {
      // vitest/no-standalone-expect: ultracite の vitest preset は "error"。
      // 採用テストツール `@amiceli/vitest-cucumber` の `describeFeature`/
      // `Scenario`/`Then` 等が describe/it を薄く包む（§4「ツール」）。
      // oxlint の vitest プラグインはこの DSL 経由の expect を「it の外の
      // standalone expect」と誤検知する。Gherkin レイヤ特有の誤検知であり、
      // コードを直しても解消しない。
      //
      // vitest/consistent-test-filename: 同 preset は "error"（既定で
      // `.test.ts` 以外を禁止）。§4「テスト戦略」・architecture checker が
      // 要求する命名は「use case / 契約の振る舞いテストは `.feature` と
      // colocate する `.spec.ts`」であり、preset の既定と直接矛盾する。
      //
      // vitest/prefer-strict-boolean-matchers ⇄ prefer-to-be-truthy /
      // prefer-to-be-falsy は自己矛盾ペア（`toBe(true)` と `toBeTruthy()` を
      // 互いに要求し合う）。ultracite の vitest preset は truthy/falsy 側を
      // 選んでいるが、本テンプレートは元の .oxlintrc.json の判断を維持する:
      // より厳密な比較（`true` という値そのものと一致するかを見る。真偽値以外の
      // truthy な値も許してしまう toBeTruthy/toBeFalsy より原則2の fail-fast に
      // 近い）である prefer-strict-boolean-matchers 側を残す。
      //
      // preset がこれらを「トップレベルの rules」ではなく test ファイル向けの
      // override として設定しているため、こちら側も同じ file スコープの
      // override で上書きする必要がある（2026-08-08 に実測: トップレベルの
      // rules に書いても override 側の設定が勝ち、無効化されなかった）。
      files: ["**/*.{test,spec}.{ts,tsx,js,jsx}", "**/__tests__/**/*.{ts,tsx,js,jsx}"],
      rules: {
        "vitest/no-standalone-expect": "off",
        "vitest/consistent-test-filename": "off",
        "vitest/prefer-strict-boolean-matchers": "error",
        "vitest/prefer-to-be-truthy": "off",
        "vitest/prefer-to-be-falsy": "off",
      },
    },
    {
      // tools/architecture/test/*.test.ts は vitest ではなく Node 組み込みの
      // test runner（`node --test`）を使う（ts-morph 以外の実行時依存を
      // 増やさないための選択。checker.test.ts の分割先である
      // load-project.test.ts も同じ実行方式を使うため、ファイル名固定ではなく
      // このディレクトリの *.test.ts 全体を対象にする）。
      // vitest/no-import-node-test は「node:test の代わりに vitest から
      // import しろ」と要求するが、それをすると `node --test` が自動で
      // 登録する describe/it のグローバルと衝突し構文的に壊れる。
      // vitest/prefer-importing-vitest-globals も同じ理由（vitest を一切
      // import していないファイルに vitest からの import を要求する誤検知）
      // で対象に加える。
      files: ["tools/architecture/test/*.test.ts"],
      rules: {
        "vitest/no-import-node-test": "off",
        "vitest/prefer-importing-vitest-globals": "off",
      },
    },
  ],

  ignorePatterns: [
    ".agents/**",
    // vendor した anti-slop 自身。他所のコードであり、このファイルが定める規約で
    // 縛る対象ではない。
    "tools/oxlint/anti-slop/**",
    // ビルド生成物・ローカル作業ディレクトリ。.gitignore と対応させている。
    "dist",
    "build",
    ".blume",
    "coverage",
    "playwright-report",
    "test-results",
    // playwright-bdd の生成物(既定 outputDir)。手で書いたコードではないため
    // 対象外にする。
    "**/.features-gen",
    // architecture checker（tools/architecture）自身の fixture テスト。
    // `forbidden/` 配下は「禁止パターン」を検証するための、意図的に規約
    // 違反を含むサンプルコード。architecture checker が検出できることを
    // テストするためのものであり、oxlint が別の理由で無関係にエラーを出すと
    // fixture の意図と関係ない場所でゲートが赤くなる。checker 自身の正しさは
    // `test` task（turbo 経由で tools/architecture の `node --test` を走らせる）
    // が別途検証する（原則8）。
    "tools/architecture/test/fixtures/**",
  ],
});

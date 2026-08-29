# 契約層レシピ: protobuf + buf + ConnectRPC

原則: [`docs/principles/contract-is-ssot.md`](../../principles/contract-is-ssot.md)（契約が単一の真実源）

このレシピは**手順と設定の雛形までを持ち、動く最小 API は持たない**。動く例を同梱すると、`contract/` が事実上このレシピに固定され、`docs/adr/README.md` が案内する「ADR 0001 で選ぶ空スロット」の意味が失われるためである。実際に採用するプロジェクトは、`docs/adr/0001-contract-layer.md` にこのレシピを選んだ理由を書いてから中身を作る。

## 向いているとき

- 将来 backend を TypeScript 以外の言語に逃がす道を残したい
- streaming RPC がある

## ツールとバージョン（2026-08-08 に npm registry で確認）

| パッケージ                  | バージョン | 役割                                                                   |
| --------------------------- | ---------- | ---------------------------------------------------------------------- |
| `@bufbuild/buf`             | 1.72.0     | `buf generate` / `buf breaking` を実行する CLI                         |
| `@bufbuild/protobuf`        | 2.13.0     | 生成コードが依存する protobuf ランタイム                               |
| `@connectrpc/connect`       | 2.1.2      | RPC クライアント / サーバーの共通ランタイム                            |
| `@connectrpc/connect-web`   | 2.1.2      | ブラウザ向け transport                                                 |
| `@connectrpc/connect-query` | 2.2.0      | unary RPC 用の TanStack Query フックを `.proto` から生成するプラグイン |

すべて `pnpm-workspace.yaml` の `catalog:` に完全 pin で宣言する（原則10）。

## 手順

1. `contract/proto/` に `.proto` を置く。`buf.yaml` で `lint` と `breaking` の設定を持つ
2. `buf generate` の出力先は **リポジトリにコミットしないディレクトリ**（例: `contract/generated/`）に向け、`.gitignore` に加える。生成にはプラグインを 2 系統使う:
   - unary RPC 用: 標準の TypeScript プラグイン + `@connectrpc/connect-query` の生成クエリフック（`useQuery` / `useMutation` としてそのまま呼べる）
   - streaming RPC 用: connect-query は unary しか対応しないため、標準の client（`@connectrpc/connect` が返す素の client）をそのまま使う。生成されるのは型付きの client メソッドまでで、呼び出し側は `for await` で受け取る
3. `mise.toml` に `contract:generate` task を切り、`typecheck` と `test` の依存に加える。コード生成をビルド手順の一部にすることで、生成コードを常に最新の `.proto` から作り直す状態にする
4. CI に `buf breaking --against '.git#branch=main'` を配線する

## 原則1（契約が単一の真実源）の要件をどう満たすか

| 要件                                     | このレシピでの実現                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ① 生成物を持たない                       | `contract/generated/` を `.gitignore` する。committed layer には `.proto` と `buf.yaml`/`buf.gen.yaml` しか置かない                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ② drift を検出して止める                 | **このレシピでは「再生成 → 差分検査」という形の drift 検査を持たない。** 生成物そのものを一切コミットしないため、比較対象が存在せず、drift という状態が構造的に発生しない。`contract:generate` を `typecheck`/`test` の前提タスクにすることで「常に .proto から生成し直した最新のコードだけが存在する」状態を保つ。これは TypeSpec レシピ（`typespec-openapi.md`）が採る「lock ディレクトリと diff で drift を検出する」方式とは異なる手段だが、要件が求めているのは「drift が起きないこと」であり「diff で検出すること」自体は手段の一つにすぎない |
| ③ 破壊的変更を機械ブロックする           | `buf breaking` を CI に配線し、main に対する破壊的変更を検出したら失敗させる                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ④ 契約と実装を同じ PR で原子的に変更する | `.proto` の変更と、それを使う実装コードの変更を 1 PR に収める運用で満たす（これはツールが強制するものではなく、レビュー運用の話であり原則層のレビュー観点に対応する）                                                                                                                                                                                                                                                                                                                                                                               |

## テストでの外部境界の扱い

`docs/plan/Template/20260807_template-design.md` §4「外部境界の扱い」の通り、テストは**公式のインメモリ transport**（`@connectrpc/connect` が提供する in-memory transport）を使う。モックライブラリ（MSW 等）は入れない。契約から型が生成されるため、モックの返り値が契約と食い違う「モック drift」が構造的に起こらない。

## 落とし穴

- `@connectrpc/connect-query` は unary RPC しかフックを生成しない。streaming RPC にフックを期待して詰まらないこと
- `buf breaking` の対象範囲（`--against` の指定）を間違えると、常に空の差分と比較して「常に緑」になる空振りが起きる。`docs/principles/enforce-with-machines.md` が要求する fixture テスト（意図的に破壊的変更を混ぜて赤くなることを確認する）を導入時に一度実行すること

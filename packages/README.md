# packages/

`apps/*` の間で共有するパッケージを置く場所。現時点では空
（テンプレート設計 `docs/plan/Template/20260807_template-design.md` §3「monorepo（前提）」
が正本）。

## 公開面の規約

`pnpm-workspace.yaml` の `packages:` はすでに `packages/*` を workspace パッケージとして
含めている。ここに新しいパッケージを追加するときは、次の規約に従う
（§3「workspace パッケージの公開面」）。

- パッケージ間参照は workspace 依存経由のみとし、`package.json` の `exports` で公開面を宣言する
- **`exports` は `"."` のみ。** `"./*"` のようなワイルドカードを書かない。書くと内部の任意
  ファイルが外から参照可能になり、公開面の宣言が形骸化する
- `index` は re-export のみにする

## one-version rule

共有依存は `pnpm-workspace.yaml` の `catalog:` にルートで一元宣言し、各パッケージの
`package.json` は `"catalog:"` でのみ参照する。パッケージ間のバージョン分裂を構造的に
禁止するための規約であり、`packages/*` に追加するパッケージも同じ規約に従う。

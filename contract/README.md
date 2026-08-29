# contract/

契約層の**空スロット**。中身はまだ選ばれていない
（テンプレート設計 `docs/plan/Template/20260807_template-design.md` §3「monorepo（前提）」
/ §6「契約層のレシピ」が正本）。

## 何をここに置くか

プロジェクト開始時、`docs/adr/0001-*.md` として契約層を選んだ時点でこのディレクトリの
中身が決まる。選択肢は 2 つで、どちらも [docs/recipes/contract-layer/](../docs/recipes/contract-layer/)
にレシピを用意している。

| レシピ                                                                               | 向き                                                         |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| [protobuf + buf + ConnectRPC](../docs/recipes/contract-layer/protobuf-connectrpc.md) | 将来 backend を他言語に逃がす道を残したい / streaming がある |
| [TypeSpec → OpenAPI → zod 生成](../docs/recipes/contract-layer/typespec-openapi.md)  | HTTP API が主で streaming が不要                             |

どちらを選んでも、原則1（[contract-is-ssot.md](../docs/principles/contract-is-ssot.md)）の要件
（生成物を持たない・drift 拒否・破壊的変更の機械ブロック）を満たす。

## 動く最小 API は置かない

レシピは手順と設定の雛形までを持ち、動く最小 API は同梱しない。動く例を置くと、
テンプレートが片方の契約層に事実上固定され、選択スロットである意味が失われるため。

## 縦切りとの関係

`apps/web` `apps/api` の最小縦切り（§9）はこの契約層の境界を越えない。フロントと
バックエンドは配線されておらず、それぞれ注入された境界の後ろで完結している。フロントの
API 接点は `apps/web/src/lib/api/` に閉じており、契約層を選んだ時点でその 1 ファイルの
中身だけが置き換わる。

# レシピ: Testcontainers によるデータベース統合テスト

原則: [`docs/principles/test-public-contract-only.md`](../../principles/test-public-contract-only.md)（テスト対象は公開契約のみ）、[`docs/principles/fail-fast.md`](../../principles/fail-fast.md)（fail fast）、[`docs/principles/one-command-verification.md`](../../principles/one-command-verification.md)（検証は1コマンド）

実体層（`apps/api` の既定コード）には DB 接続を配線しない（最小縦切りはインメモリ）。PostgreSQL などの実 DB をプロジェクトで導入した時点で、このレシピと `@webapp-blueprint/test-db` を見て統合テストを配線する。

## なぜ Testcontainers か

1. **モックを排除し公開契約を検証する（原則6）**:
   インメモリ fake や ORM のモックでは、SQL 構文・インデックス・外部キー制約・トランザクション分離レベル・JSONB 挙動などの「本物の DB の契約」を検証できない。Testcontainers を使うことで、本物の PostgreSQL コンテナに対してマイグレーションとリポジトリ層の振る舞いを検証する。
2. **fail-fast（原則2）**:
   Docker デーモンが未起動、またはコンテナの起動に失敗した場合は、インメモリへの自動 fallback を行わず `PostgresContainerStartupError` で即座にテストを落とす（fail-closed）。
3. **1コマンド検証の維持（原則8）**:
   コンテナ起動〜マイグレーション〜テスト〜破棄が `test` コマンド 1 回で完結する。テスト前に手動で `docker-compose up` しておく必要がない。

## アーキテクチャとライフサイクル

```
Vitest Test Runner
  ├── globalSetup (初回のみ)
  │     └── @webapp-blueprint/test-db (PostgreSQL コンテナ起動 + マイグレーション)
  ├── 各 test ファイル (*.integration.test.ts)
  │     ├── トランザクション分離 / テスト用スキーマ分離
  │     └── Repository / DB クエリの振る舞い検証
  └── globalTeardown
        └── コンテナ停止・破棄 (Ryuk による自動リーク防止)
```

### パッケージ構成: `@webapp-blueprint/test-db`

本テンプレートには `@webapp-blueprint/test-db` ハーネスが同梱されている。

```typescript
import { startPostgresContainer } from "@webapp-blueprint/test-db";

// コンテナ起動 (ポート・認証情報は動的に割り当てられる)
const container = await startPostgresContainer({
  image: "postgres:17-alpine",
  database: "app_test",
});

// container.connectionUri から接続 URI（動的ポート・認証情報を含む）を取得
console.log(container.connectionUri);

// テスト終了時
await container.stop();
```

## 導入手順

### 1. 依存の参照

利用するアプリ（例: `apps/api/package.json`）に `@webapp-blueprint/test-db` を追加する。

```json
{
  "devDependencies": {
    "@webapp-blueprint/test-db": "workspace:*"
  }
}
```

### 2. Vitest globalSetup の設定

テストスイート全体で 1 つの PostgreSQL コンテナを共有し、テスト実行速度を最大化する。

`apps/api/test/global-setup.ts`:

```typescript
import {
  startPostgresContainer,
  type StartedPostgresContainerHandle,
} from "@webapp-blueprint/test-db";

let container: StartedPostgresContainerHandle | undefined;

export async function setup() {
  container = await startPostgresContainer();
  process.env.DATABASE_URL = container.connectionUri;

  // ここでマイグレーションを実行 (例: kysely / node-pg-migrate / prisma migrate 等)
  // await runMigrations(process.env.DATABASE_URL);
}

export async function teardown() {
  if (container) {
    await container.stop();
  }
}
```

`apps/api/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    globalSetup: ["./test/global-setup.ts"],
    include: ["src/**/*.{test,spec}.ts"],
  },
});
```

### 3. テスト間でのデータ分離パターン

共有コンテナを使用する場合、テストケース間でデータが汚染されないよう以下のいずれかのパターンを適用する:

- **トランザクションロールバック方式**: 各テストを `BEGIN` で開始し、テスト終了（`afterEach`）で `ROLLBACK` する。最も高速。
- **スキーマ分離方式**: 各テストスイートごとに `CREATE SCHEMA test_xxx` を切り、テスト終了時に `DROP SCHEMA` する。

## 日常の `check` との分離（原則8の運用）

Docker コンテナを起動するテストは、ネットワーク通信やコンテナスピンアップのオーバーヘッドがあり、Docker デーモンの常駐を前提とする。

- **`mise run check`（日常・高速）**: ユニットテスト・振る舞いテスト（インメモリ）のみを走らせ、オフラインかつ数秒で完走させる。
- **`mise run test:db` / `mise run test:integration`**: 統合テスト・DB テストを実行する独立タスクとして定義する。CI では Docker が利用可能なジョブで実行する。

## 落とし穴

- **Ryuk（リソースリーク防止）のポートブロック**: 社内プロキシや厳しいファイアウォール環境では、Ryuk コンテナの通信が遮断される場合がある。その場合は `TESTCONTAINERS_RYUK_DISABLED=true` の環境変数を検討する。
- **コンテナ起動タイムアウト**: CI 等のリソースが逼迫した環境で初回イメージ pull に時間がかかる場合がある。ベースイメージは軽量な `alpine`（`postgres:17-alpine`）を指定する。
- **ハードコードされたポートの衝突**: コンテナ側のポート（5432）をホスト側の固定ポートにバインドしない。必ず `container.port` または `container.connectionUri` から動的に割り当てられたポートを取得して接続する。

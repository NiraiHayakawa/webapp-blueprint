// 合成ルート（DI はコンストラクタ手組み。DI コンテナは使わない）。
// これは配線の実証であり、消して始めてよい（docs/plan/Template/20260807_template-design.md §9）。

import { NodeSDK } from "@opentelemetry/sdk-node";
import { ConsoleSpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { InMemoryTaskRepository } from "./infrastructure/in-memory-task-repository.js";
import { RetryingTaskRepository } from "./infrastructure/retrying-task-repository.js";
import { RegisterTaskUseCase } from "./application/register-task/register-task.use-case.js";
import { createRegisterTaskHandler } from "./presentation/register-task-handler.js";
import { classifyRegisterTaskFailure } from "./presentation/register-task-failure-classification.js";
import { createInMemorySink } from "./logging/sink.js";

const MAX_TASK_SAVE_ATTEMPTS = 3;
const REGISTER_TASK_OPERATION = "task.register";
const SERVICE_NAME = "webapp-blueprint-api";

/**
 * トレースの送り先（exporter）は合成ルートだけが選ぶ（原則12「トレースの
 * 送り先」節。tools/architecture の third-party-sdk-composition-root ルールが
 * `@opentelemetry/sdk-node` / `@opentelemetry/sdk-trace-base` の import を
 * この 1 ファイルに限定する）。
 *
 * 既定は開発向けの ConsoleSpanExporter（logging/sink.ts の
 * createInMemorySink と対になる、送り先が未選択の状態での動く実装）。
 * `spanProcessors` を明示することで、環境変数（`OTEL_TRACES_EXPORTER` 等）
 * 経由で NodeSDK が黙って OTLP へフォールバックする経路を断つ
 * （原則2 fail-fast: 実際の送り先を選ぶ際は、この 1 箇所を明示的に
 * 差し替えること。差し替え方は docs/recipes/tools/observability.md 参照）。
 */
const tracingSdk = new NodeSDK({
  serviceName: SERVICE_NAME,
  spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
});
tracingSdk.start();

const taskRepository = new RetryingTaskRepository({
  delegate: new InMemoryTaskRepository(),
  maxAttempts: MAX_TASK_SAVE_ATTEMPTS,
});
const registerTaskUseCase = new RegisterTaskUseCase(taskRepository);

export const registerTaskHandler = createRegisterTaskHandler(registerTaskUseCase, {
  operation: REGISTER_TASK_OPERATION,
  // 送り先は空スロット（logging/sink.ts 参照）。実プロジェクトはここだけを差し替える。
  sink: createInMemorySink(),
  classifyFailure: classifyRegisterTaskFailure,
});

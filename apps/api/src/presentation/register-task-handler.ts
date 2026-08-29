import type {
  RegisterTaskInput,
  RegisterTaskOutput,
  RegisterTaskUseCase,
} from "../application/register-task/register-task.use-case.js";
import type { AppException } from "../logging/app-exception.js";
import type { Sink } from "../logging/sink.js";
import { observeResult } from "../logging/observe.js";

interface RegisterTaskHandlerObservability {
  readonly operation: string;
  readonly sink: Sink;
  /** 引数名 `cause` の理由は observe.ts の ObserveResultParams を参照。 */
  readonly classifyFailure: (cause: unknown) => AppException;
}

/**
 * Driving adapter（§9「最小の縦切り」）。契約層（ADR 0001）が未選択のため、
 * 特定の HTTP/RPC フレームワークには意図的に繋がない、フレームワーク非依存の
 * ハンドラ関数として実装する。契約層を選んだ時点でここだけが差し替わる。
 *
 * use case の実行を横断境界（observeResult）でラップする。成功・失敗
 * どちらでも 1 本だけログを残し、失敗時は分類済みの AppException を
 * そのまま呼び出し元へ伝播する（原則12 の受け皿）。
 */
export const createRegisterTaskHandler =
  (
    useCase: Readonly<RegisterTaskUseCase>,
    observability: Readonly<RegisterTaskHandlerObservability>,
  ): ((input: Readonly<RegisterTaskInput>) => Promise<RegisterTaskOutput>) =>
  async (input) =>
    await observeResult({
      operation: observability.operation,
      sink: observability.sink,
      classifyFailure: observability.classifyFailure,
      work: async () => await useCase.execute(input),
    });

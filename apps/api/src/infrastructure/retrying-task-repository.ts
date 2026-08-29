import type { Task } from "../domain/task/task.js";
import type { TaskRepository } from "../application/register-task/register-task.port.js";
import { TaskRepositoryUnavailableError } from "../application/register-task/task-repository-unavailable.error.js";

interface RetryingTaskRepositoryInit {
  readonly delegate: TaskRepository;
  readonly maxAttempts: number;
}

/**
 * TaskRepository（port）のリトライ decorator（driven adapter。§9）。
 *
 * リトライは「失敗を隠す」ためではなく、一時的な障害を吸収しつつ、
 * 最終的に失敗した場合はそれを {@link TaskRepositoryUnavailableError} として
 * 可視化するために使う（原則2 fail-fast: リトライ自体は禁止しないが、
 * 失敗が起きたこと自体を呼び出し側から見えなくする目的で使ってはならない）。
 * ループではなく再帰で実装し、`await` を含むループを避ける
 * （`eslint/no-await-in-loop` を抑制コメントなしで満たすための構造上の選択。
 * 逐次リトライの意図は再帰でも変わらない）。
 */
class RetryingTaskRepository implements TaskRepository {
  private readonly delegate: TaskRepository;
  private readonly maxAttempts: number;

  public constructor(init: Readonly<RetryingTaskRepositoryInit>) {
    this.delegate = init.delegate;
    this.maxAttempts = init.maxAttempts;
  }

  public async save(task: Readonly<Task>): Promise<void> {
    await this.saveWithRetry(task, 1);
  }

  private async saveWithRetry(task: Readonly<Task>, attempt: number): Promise<void> {
    try {
      await this.delegate.save(task);
    } catch {
      if (attempt >= this.maxAttempts) {
        throw new TaskRepositoryUnavailableError({ attempts: this.maxAttempts });
      }
      await this.saveWithRetry(task, attempt + 1);
    }
  }
}

export { RetryingTaskRepository };

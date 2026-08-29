interface TaskRepositoryUnavailableErrorInit {
  readonly attempts: number;
}

/**
 * TaskRepository（port）の障害モード。domain のエラーと同様、port の契約の
 * 一部として application 層に置く（driven adapter の実装詳細ではなく、
 * 「この port はこう失敗しうる」という契約側の型）。
 *
 * repository がここまで試行しても保存に成功しなかったことを表す
 * （§9「最小の縦切り」/ RetryingTaskRepository が最大試行回数を使い切ったときに throw する）。
 */
class TaskRepositoryUnavailableError extends Error {
  public readonly attempts: number;

  public constructor(init: Readonly<TaskRepositoryUnavailableErrorInit>) {
    super(`タスクの保存が${init.attempts}回試行しても失敗し続けた`);
    this.name = "TaskRepositoryUnavailableError";
    this.attempts = init.attempts;
  }
}

export { TaskRepositoryUnavailableError };

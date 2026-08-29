/**
 * TaskTitle の不変条件違反: trim 後の文字数が上限を超えている。
 */
class TaskTitleTooLongError extends Error {
  public constructor(maxLength: number) {
    super(`タスク名は${maxLength}文字以内にする必要がある`);
    this.name = "TaskTitleTooLongError";
  }
}

export { TaskTitleTooLongError };

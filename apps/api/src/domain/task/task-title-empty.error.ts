/**
 * TaskTitle の不変条件違反: 空文字（trim 後 0 文字）。
 */
class TaskTitleEmptyError extends Error {
  public constructor() {
    super("タスク名は空にできない");
    this.name = "TaskTitleEmptyError";
  }
}

export { TaskTitleEmptyError };

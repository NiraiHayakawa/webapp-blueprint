import type { TaskTitle } from "./task-title.js";

/**
 * Aggregate root（repository は aggregate root にのみ生やす。§3「バックエンド」）。
 * 同一 domain 層内のファイルへの相対 import のみで、外部パッケージには依存しない。
 */
export class Task {
  public readonly id: string;
  public readonly title: TaskTitle;

  private constructor(id: string, title: TaskTitle) {
    this.id = id;
    this.title = title;
  }

  public static create(id: string, title: TaskTitle): Task {
    return new Task(id, title);
  }
}

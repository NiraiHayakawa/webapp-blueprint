import type { Task } from "../../domain/task/task.js";

/**
 * Port（driven adapter 側の interface。§3「バックエンド」）。
 * repository は aggregate root（Task）にのみ生やす。
 */
export interface TaskRepository {
  save: (task: Task) => Promise<void>;
}

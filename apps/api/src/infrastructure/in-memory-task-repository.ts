import type { Task } from "../domain/task/task.js";
import type { TaskRepository } from "../application/register-task/register-task.port.js";

/**
 * Port のインメモリ実装（driven adapter。§9「最小の縦切り」）。
 */
export class InMemoryTaskRepository implements TaskRepository {
  private readonly tasks = new Map<string, Task>();

  public async save(task: Readonly<Task>): Promise<void> {
    await Promise.resolve();
    this.tasks.set(task.id, task);
  }

  public findById(id: string): Task | undefined {
    return this.tasks.get(id);
  }
}

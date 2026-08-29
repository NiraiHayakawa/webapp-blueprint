import { Task } from "../../domain/task/task.js";
import type { TaskRepository } from "./register-task.port.js";
import { TaskTitle } from "../../domain/task/task-title.js";

interface RegisterTaskInput {
  readonly title: string;
}

interface RegisterTaskOutput {
  readonly id: string;
  readonly title: string;
}

const ID_RADIX = 36;
const ID_RANDOM_SLICE_START = 2;
const ID_RANDOM_SLICE_END = 10;

/**
 * ID 生成は application 層に置く（domain 層を外部 import ゼロに保つため。
 * node:crypto を使わないのは、catalog に @types/node が pin されておらず
 * 型定義を推測で追加しないため。report に明記）。
 */
const generateTaskId = (): string =>
  `${Date.now().toString(ID_RADIX)}-${Math.random().toString(ID_RADIX).slice(ID_RANDOM_SLICE_START, ID_RANDOM_SLICE_END)}`;

/**
 * Use case（DI はコンストラクタ手組み。DI コンテナは使わない。§3「バックエンド」）。
 * TaskTitle の不変条件違反はここで catch せず、そのまま呼び出し側へ throw する
 * （原則2「fail-fast」: silent fallback しない）。
 */
class RegisterTaskUseCase {
  private readonly taskRepository: TaskRepository;

  public constructor(taskRepository: Readonly<TaskRepository>) {
    this.taskRepository = taskRepository;
  }

  public async execute(input: Readonly<RegisterTaskInput>): Promise<RegisterTaskOutput> {
    const title = TaskTitle.create(input.title);
    const task = Task.create(generateTaskId(), title);

    await this.taskRepository.save(task);

    return { id: task.id, title: task.title.value };
  }
}

export { RegisterTaskUseCase };
export type { RegisterTaskInput, RegisterTaskOutput };

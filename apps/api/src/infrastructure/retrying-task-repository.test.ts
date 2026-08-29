import { describe, expect, it, vi } from "vitest";
import { Task } from "../domain/task/task.js";
import { TaskTitle } from "../domain/task/task-title.js";
import type { TaskRepository } from "../application/register-task/register-task.port.js";
import { TaskRepositoryUnavailableError } from "../application/register-task/task-repository-unavailable.error.js";
import { RetryingTaskRepository } from "./retrying-task-repository.js";

vi.setConfig({ testTimeout: 5000 });

/** delegate.save が `failCount` 回失敗した後に成功する fake（境界の後ろに置く二重）。 */
function createFlakyRepository(failCount: number): TaskRepository & { calls: number } {
  let remainingFailures = failCount;
  const state = {
    calls: 0,
    save: async (): Promise<void> => {
      state.calls += 1;
      await Promise.resolve();
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error("一時的な保存失敗");
      }
    },
  };
  return state;
}

const STUB_TASK = Task.create("stub-task-id", TaskTitle.create("スタブタスク"));

describe("retryingTaskRepository", () => {
  it.each([
    { failCount: 0, maxAttempts: 3, expectedCalls: 1 },
    { failCount: 2, maxAttempts: 3, expectedCalls: 3 },
  ])(
    "delegate が $failCount 回失敗した後に成功すれば、$expectedCalls 回目までに保存が成功する",
    async ({ failCount, maxAttempts, expectedCalls }) => {
      expect.hasAssertions();
      const delegate = createFlakyRepository(failCount);
      const repository = new RetryingTaskRepository({ delegate, maxAttempts });

      await expect(repository.save(STUB_TASK)).resolves.toBeUndefined();
      expect(delegate.calls).toBe(expectedCalls);
    },
  );

  it("maxAttempts まで delegate が失敗し続けると TaskRepositoryUnavailableError を throw する", async () => {
    expect.hasAssertions();
    const maxAttempts = 3;
    const delegate = createFlakyRepository(maxAttempts);
    const repository = new RetryingTaskRepository({ delegate, maxAttempts });

    await expect(repository.save(STUB_TASK)).rejects.toStrictEqual(
      new TaskRepositoryUnavailableError({ attempts: maxAttempts }),
    );
    expect(delegate.calls).toBe(maxAttempts);
  });
});

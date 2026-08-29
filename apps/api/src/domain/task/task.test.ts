import { describe, expect, it, vi } from "vitest";

import { Task } from "./task.js";
import { TaskTitle } from "./task-title.js";

vi.setConfig({ testTimeout: 5000 });

describe("task.create", () => {
  it("id と title をそのまま保持する", () => {
    expect.hasAssertions();
    const title = TaskTitle.create("買い物リストを作る");
    const task = Task.create("task-1", title);

    expect(task.id).toBe("task-1");
    expect(task.title).toBe(title);
  });
});
